// `gluely retro`: the week, turned into decisions. It reads everything the loop recorded,
// the tests, results, verdicts, lessons and claims, and says what needs a person, what
// needs the agent and what is still collecting. It writes nothing and calls nothing.
// The agent drafts each change, and a person approves it.
import { runTests } from './brain-tests.js';
import { loadVoice, scanContext } from './context.js';
import { learn } from './log.js';
import { fail, GluelyError } from './output.js';
import { validatePlays } from './plays.js';
import { compareAll, dayOf, DECIDE_AT, judgePlay, KILL_FROM, readResults } from './results.js';
import { verdictsFor } from './verdicts.js';
import { contextVersion, git, loadConfig } from './workspace.js';

const DAY = 86400000;
// At most this many context changes a week, so each one can be measured on its own.
export const MAX_CONTEXT_CHANGES = 3;
const COUNTS = ['touches', 'replies', 'positive', 'meetings', 'unsubscribes', 'spent'];

// Lower runs first. A broken brain beats a broken inbox beats a decision beats an upgrade.
const RANK = {
  fix_regression: 1, fix_deliverability: 2, check_deliverability: 3, record_verdict: 4,
  fix_play: 5, favor_play: 6, favor_variant: 7, ban_word: 8, write_lessons: 9, review_claims: 10,
};
const CHANGES_CONTEXT = new Set(['ban_word', 'write_lessons', 'review_claims']);

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const pct = (v) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
const range = (r) => (r ? `${pct(r[0])} to ${pct(r[1])}` : 'unknown');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function sum(rows) {
  return Object.fromEntries(COUNTS.map((k) => [k, rows.reduce((n, r) => n + (r[k] || 0), 0)]));
}

function windowOf(ws, days, now) {
  const end = isoDay(now);
  const start = isoDay(Date.parse(end) - (days - 1) * DAY);
  const before = isoDay(Date.parse(start) - days * DAY);
  const results = readResults(ws);
  const inside = (from, to) => results.filter((r) => dayOf(r) >= from && dayOf(r) <= to);
  const prior = isoDay(Date.parse(start) - DAY);
  return { start, end, week: sum(inside(start, end)), last_week: sum(inside(before, prior)) };
}

// What the brain changed its mind about: commits that touched context/ in the window.
function contextChanges(ws, start) {
  const out = git(ws, ['log', `--since=${start}T00:00:00`, '--format=%h%x09%ad%x09%s', '--date=short', '--', 'context/']);
  if (!out) return [];
  return out.split('\n').filter(Boolean).map((row) => {
    const [version, on, ...subject] = row.split('\t');
    return { version, on, subject: subject.join('\t') };
  });
}

const proposal = (kind, fields) => ({ kind, rank: RANK[kind], changes_context: CHANGES_CONTEXT.has(kind), ...fields });

const action = (todo, needs, next) => ({ do: todo, needs, next });

function brainProposals(tests) {
  const r = tests.reasoned;
  if (!r.regressions.length) return [];
  return [proposal('fix_regression', {
    title: `Fix ${plural(r.regressions.length, 'regression')} in the brain tests`,
    why: 'A case that was right under an earlier context is wrong now, so the last context change made the brain worse. Fix the context or revert the change before anything else ships.',
    evidence: r.regression_details.map((d) => `${d.id}: right under ${d.was_right_under}, now answered ${d.answered} (expected ${d.expected})`),
    target: 'context/',
    actions: [action('Find what the change broke, then fix or revert it', 'approve_context', 'gluely test')],
  })];
}

const rateLine = (label, row) => `${label} ${pct(row.rate)}, could really be ${range(row.could_be)}`;

// One decision per play. Everything Gluely can say about a play is folded into it, so the
// founder decides once ("keep it, scale it, send variant b") instead of four times.
function playProposal(ws, play, judged, vs, decided) {
  const id = play.id;
  const t = judged.totals;
  const evidence = [`${t.touches} touches, ${t.positive} positive, ${t.meetings} meetings${t.unsubscribes ? `, ${t.unsubscribes} unsubscribed` : ''}${t.spent ? `, ${t.spent} spent` : ''}`];
  const base = { play: id, target: `plays/${id}.yaml` };

  if (judged.verdict === 'fix_deliverability' || judged.verdict === 'check_deliverability') {
    return proposal(judged.verdict, {
      ...base,
      title: judged.verdict === 'fix_deliverability' ? `Fix where ${id}'s emails land` : `Check where ${id}'s emails land`,
      why: `${judged.why} No verdict on the play until this is answered.`,
      evidence,
      actions: [action('Send test emails and record where they land', 'a person', `gluely results add ${id} --touches 0 --placement inbox`)],
    });
  }

  const better = vs?.positive.call === 'better';
  const worse = vs?.positive.call === 'worse';
  const noisy = vs?.unsubscribes.call === 'worse';
  if (vs && vs.positive.call !== 'too_early') evidence.push(`${rateLine('positive', vs.positive)}, against ${pct(vs.positive.baseline_rate)} (${range(vs.positive.baseline_could_be)}) on your other plays`);
  else evidence.push(rateLine('positive', { rate: judged.rates.positive, could_be: judged.rates.positive_could_be }));
  if (noisy) evidence.push(`${rateLine('unsubscribes', vs.unsubscribes)}, against ${pct(vs.unsubscribes.baseline_rate)} (${range(vs.unsubscribes.baseline_could_be)}) on your other plays`);

  // With two variants, one winning means the other losing. Say it once.
  const won = (vs?.variants || []).filter((v) => v.positive?.call === 'better');
  const lost = (vs?.variants || []).filter((v) => v.positive?.call === 'worse');
  const variantActions = [];
  if (won.length) {
    const losers = lost.map((v) => v.variant);
    variantActions.push(action(`Send variant ${won.map((v) => v.variant).join(' and ')}${losers.length ? ` instead of ${losers.join(' and ')}` : ' more often'}`, 'approve_copy', `gluely results ${id}`));
    for (const v of won) evidence.push(`${rateLine(`variant ${v.variant}`, v.positive)}, against ${pct(v.positive.baseline_rate)} (${range(v.positive.baseline_could_be)}) on the others`);
  } else if (lost.length) {
    variantActions.push(action(`Drop variant ${lost.map((v) => v.variant).join(' and ')}`, 'approve_copy', `gluely results ${id}`));
    for (const v of lost) evidence.push(`${rateLine(`variant ${v.variant}`, v.positive)}, against ${pct(v.positive.baseline_rate)} (${range(v.positive.baseline_could_be)}) on the others`);
  }
  const scale = action('Give it more volume. That changes the cost, so approve it again', 'approve_spend', `gluely cost ${id}`);
  const close = (verdict) => action(`Record your verdict and the reason`, 'a person', `gluely plays close ${id} --verdict ${verdict} --why "<what you learned>"`);
  const fixOrder = 'Check in this order: whether the people fit the ICP, the excuse, and only then the copy.';

  const due = ['kill', 'keep', 'decide'].includes(judged.verdict) && !decided;
  if (due && judged.verdict === 'kill') {
    return proposal('record_verdict', {
      ...base,
      title: `Decide on ${id}: the numbers say kill it`,
      why: `${judged.why}${noisy ? ' It also makes people unsubscribe more than anything else you run.' : ''} Gluely suggests, you decide, and your reason is what the next play reads.`,
      evidence, actions: [close('killed')],
    });
  }
  if (due && judged.verdict === 'keep') {
    return proposal('record_verdict', {
      ...base,
      title: better ? `${id} is your best play: keep it and scale it` : `Decide on ${id}: the numbers say keep it`,
      why: `${judged.why}${better ? " It also beats your other plays, and the ranges don't overlap." : ''} Your reason is what the next play reads.`,
      evidence, actions: [close('kept'), ...(better ? [scale] : []), ...variantActions],
    });
  }
  if (due) {
    return proposal('record_verdict', { ...base, title: `Decide on ${id}: its kill rule can't be read`, why: judged.why, evidence, actions: [close('kept'), action('Rewrite the kill rule so Gluely can read it', 'a person', 'gluely plays validate')] });
  }
  if (worse || noisy) {
    return proposal('fix_play', {
      ...base,
      title: noisy ? `${id} makes people unsubscribe more than your other plays` : `${id} does worse than your other plays`,
      why: `${noisy ? 'Unsubscribes cost you more than silence: they close the door.' : "Its range sits below your other plays', with no overlap."} ${fixOrder}`,
      evidence, actions: [action('Find the cause and change one thing', 'approve_copy', `gluely results ${id}`), ...variantActions],
    });
  }
  if (better) {
    return proposal('favor_play', {
      ...base,
      title: `${id} beats your other plays: give it more volume`,
      why: "Its positive rate is above everything else you ran, and the ranges don't overlap.",
      evidence, actions: [scale, ...variantActions],
    });
  }
  if (variantActions.length) {
    return proposal('favor_variant', { ...base, title: `${id}: ${variantActions[0].do.charAt(0).toLowerCase()}${variantActions[0].do.slice(1)}`, why: "Against the play's other variants, the ranges don't overlap.", evidence, actions: variantActions });
  }
  return null;
}

function playProposals(ws, plays, verdicts, compared) {
  const out = [];
  const waiting = [];
  const results = readResults(ws);
  for (const play of plays.filter((p) => p.id && ['active', 'paused'].includes(p.status))) {
    let judged;
    try { judged = judgePlay(ws, play.id); } catch (error) {
      if (!(error instanceof GluelyError)) throw error;
      continue;
    }
    if (!judged.batches) { waiting.push({ play: play.id, touches: 0, why: 'no results yet' }); continue; }
    // Decided already, if a person gave a verdict after the latest numbers came in.
    const lastVerdict = verdicts.filter((v) => v.play === play.id).at(-1);
    const lastResult = results.filter((r) => r.play === play.id).at(-1);
    const decided = Boolean(lastVerdict && lastResult && lastVerdict.at > lastResult.at);
    // A person already looked at these exact numbers. Raise the play again when new ones arrive.
    if (decided) continue;
    const made = playProposal(ws, play, judged, compared.find((c) => c.play === play.id), decided);
    if (made) out.push(made);
    else if (['too_early', 'keep_going'].includes(judged.verdict)) {
      const goal = judged.verdict === 'too_early' ? KILL_FROM : DECIDE_AT;
      waiting.push({ play: play.id, touches: judged.totals.touches, needs: Math.max(0, goal - judged.totals.touches), until: judged.verdict === 'too_early' ? 'anything is known' : 'it is decided', why: judged.why });
    }
  }
  return { proposals: out, waiting };
}

function lessonProposals(ws, learned) {
  const out = [];
  const banned = new Set(loadVoice(ws).banned.map((b) => String(b).toLowerCase()));
  const covered = new Set();
  for (const word of learned.edits.keeps_removing.filter((w) => !banned.has(w.word)).slice(0, 2)) {
    for (const id of word.entries) covered.add(id);
    out.push(proposal('ban_word', {
      title: `Ban "${word.word}" in your voice`,
      why: `You removed it ${word.times} times. Once it is banned, gluely check draft catches it before you have to.`,
      evidence: word.entries.map((id) => `edit ${id}`),
      target: 'context/messaging/voice.md',
      actions: [action(`Add "${word.word}" under banned:, then promote each edit above`, 'approve_context', `gluely log promote ${word.entries[0]} --to context/messaging/voice.md`)],
    }));
  }
  for (const area of learned.areas.filter((a) => a.home)) {
    const left = area.entries.filter((e) => !covered.has(e.id));
    if (left.length < 2) continue;
    out.push(proposal('write_lessons', {
      title: `Write ${left.length} open ${area.area} lessons into ${area.home}`,
      why: 'The same kind of correction keeps coming. Until it is in the context, the agent can repeat the mistake.',
      evidence: left.slice(0, 5).map((e) => `${e.id}: ${e.text}${e.why ? ` (${e.why})` : ''}`),
      target: area.home,
      actions: [action('Your agent drafts the smallest change that covers them', 'approve_context', 'gluely learn')],
    }));
  }
  return out;
}

function claimProposals(context) {
  const stale = context.issues.filter((i) => /not reviewed for/.test(i.message));
  if (!stale.length) return [];
  return [proposal('review_claims', {
    title: `Review ${plural(stale.length, 'claim')} nobody has checked in a while`,
    why: 'Old proof gets repeated long after it stopped being true.',
    evidence: stale.slice(0, 5).map((i) => `${i.file}: ${i.message.split(':')[0]}`),
    target: 'context/',
    actions: [action('Check each still holds, then set updated to today', 'approve_context', 'gluely context check')],
  })];
}

function agentTasks(tests, learned) {
  const r = tests.reasoned;
  const tasks = [];
  if (r.unproven.length) tasks.push({ task: `Re-answer ${plural(r.unproven.length, 'test')} under the new context`, why: 'They were answered before the last change, so the change is not proven yet.', cases: r.unproven, next: 'gluely test pending' });
  const fresh = r.pending.filter((id) => !r.unproven.includes(id));
  if (fresh.length) tasks.push({ task: `Answer ${plural(fresh.length, 'new test')}`, why: 'Each one is a correction the brain has not been checked against.', cases: fresh, next: 'gluely test pending' });
  if (r.wrong.length && !r.regressions.length) tasks.push({ task: `Find the context gap behind ${plural(r.wrong.length, 'wrong answer')}`, why: 'A wrong answer is a finding. Propose the context change that fixes it.', cases: r.wrong.map((w) => w.id), next: 'gluely test' });
  if (learned.open && !learned.areas.some((a) => a.open >= 2)) tasks.push({ task: `Read ${plural(learned.open, 'open lesson')}`, why: 'Not a pattern yet. Keep them in mind when you write.', next: 'gluely recall' });
  return tasks;
}

function headline(forYou, waiting) {
  if (!forYou.length) {
    return waiting.length ? `Nothing needs you this week. ${plural(waiting.length, 'play is', 'plays are')} still collecting results.` : 'Nothing needs you this week.';
  }
  const first = forYou[0].title;
  const rest = forYou.length - 1;
  return `${plural(forYou.length, 'decision', 'decisions')} this week. Start with: ${first.charAt(0).toLowerCase()}${first.slice(1)}${rest ? `, then ${rest} more` : ''}.`;
}

export function buildRetro(ws, { days = 7, now = Date.now() } = {}) {
  const span = Number(days);
  if (!Number.isInteger(span) || span < 1 || span > 90) fail('bad_number', '--days must be a whole number from 1 to 90.');
  const tests = runTests(ws);
  const learned = learn(ws);
  const context = scanContext(ws, { now });
  const plays = validatePlays(ws).plays;
  const verdicts = verdictsFor(ws);
  const compared = compareAll(ws);
  const when = windowOf(ws, span, now);

  const { proposals: fromPlays, waiting } = playProposals(ws, plays, verdicts, compared);
  const all = [...brainProposals(tests), ...fromPlays, ...lessonProposals(ws, learned), ...claimProposals(context)]
    .sort((a, b) => a.rank - b.rank);
  // Context changes are capped, so each one can be measured. The rest wait for next week.
  let changes = 0;
  const forYou = [];
  const heldBack = [];
  for (const p of all) {
    if (p.changes_context && changes >= MAX_CONTEXT_CHANGES) { heldBack.push(p.title); continue; }
    if (p.changes_context) changes += 1;
    forYou.push(p);
  }
  forYou.forEach((p, i) => { p.number = i + 1; });

  return {
    company: loadConfig(ws).company?.name || null,
    context_version: contextVersion(ws).version,
    window: { days: span, start: when.start, end: when.end },
    headline: headline(forYou, waiting),
    week: when.week,
    last_week: when.last_week,
    brain: {
      changes: contextChanges(ws, when.start),
      tests: { passed: tests.passed, correct: tests.reasoned.correct, answered: tests.reasoned.answered, total: tests.reasoned.total, regressions: tests.reasoned.regressions.length, unproven: tests.reasoned.unproven.length, rules: `${tests.deterministic.passed}/${tests.deterministic.total}` },
      lessons: { open: learned.open, promoted: learned.promoted },
      verdicts_this_week: verdicts.filter((v) => v.at.slice(0, 10) >= when.start).map(({ play, verdict, why }) => ({ play, verdict, why })),
    },
    for_you: forYou,
    held_back: heldBack,
    for_your_agent: agentTasks(tests, learned),
    collecting: waiting,
    rules: { max_context_changes: MAX_CONTEXT_CHANGES, kill_from: KILL_FROM, decide_at: DECIDE_AT, better_means: "the ranges don't overlap, against your own baseline" },
    note: 'Gluely proposes and a person decides. Your agent drafts each change on a branch, with its evidence and a test.',
  };
}

const NEEDS = { approve_context: 'you approve the context change', approve_copy: 'you approve the copy', approve_spend: 'you approve the spend', 'a person': 'your call' };

export function renderRetro(data, { color, mark }) {
  const w = data.week;
  const l = data.last_week;
  const t = data.brain.tests;
  const label = (text) => color.dim(text.padEnd(11));
  console.log(color.bold(`Weekly retro  ${data.company || ''}`) + color.dim(`   ${data.window.start} to ${data.window.end}, context ${data.context_version}`));
  console.log();
  console.log(`  ${color.bold(data.headline)}`);
  console.log();
  console.log(`${label('This week')}${w.touches} touches, ${w.positive} positive, ${w.meetings} meetings${w.spent ? `, ${w.spent} spent` : ''}${color.dim(`   the week before: ${l.touches} touches, ${l.positive} positive, ${l.meetings} meetings`)}`);
  const brain = [`${plural(data.brain.changes.length, 'context change')}`, `agent tests ${t.correct}/${t.answered}`, `rules ${t.rules}`];
  if (t.regressions) brain.push(color.red(plural(t.regressions, 'regression')));
  if (t.unproven) brain.push(color.yellow(`${t.unproven} unproven`));
  console.log(`${label('Brain')}${brain.join(color.dim(' · '))}`);
  for (const c of data.brain.changes) console.log(`${' '.repeat(11)}${color.dim(`${c.on} ${c.version}`)} ${c.subject}`);
  for (const v of data.brain.verdicts_this_week) console.log(`${' '.repeat(11)}${color.dim('verdict')} ${v.play} ${v.verdict}${color.dim(`: ${v.why}`)}`);

  if (data.for_you.length) {
    console.log(`\n${color.bold('For you')}`);
    for (const p of data.for_you) {
      console.log(`  ${color.bold(`${p.number}.`)} ${p.title}`);
      console.log(`     ${color.dim(p.why)}`);
      for (const e of p.evidence) console.log(`     ${color.dim('·')} ${color.dim(e)}`);
      for (const a of p.actions) {
        console.log(`     ${mark.next()} ${a.do} ${color.dim(`(${NEEDS[a.needs] || a.needs})`)}`);
        console.log(`       ${color.cyan(`$ ${a.next}`)}`);
      }
    }
    if (data.held_back.length) console.log(color.dim(`  ${plural(data.held_back.length, 'more context change')} next week: at most ${data.rules.max_context_changes} a week, so each one can be measured.`));
  }
  if (data.for_your_agent.length) {
    console.log(`\n${color.bold('For your agent')} ${color.dim('  open it here and type /gtm-mode, then ask for the weekly retro')}`);
    for (const a of data.for_your_agent) console.log(`  ${mark.next()} ${a.task}${color.dim(`   ${a.why}`)}`);
  }
  if (data.collecting.length) {
    console.log(`\n${color.bold('Still collecting')}`);
    for (const c of data.collecting) console.log(`  ${c.play.padEnd(22)} ${color.dim(c.touches ? `${c.touches} touches${c.needs ? `, ${c.needs} more before ${c.until}` : ''}` : c.why)}`);
  }
  console.log(`\n${color.dim(data.note)}`);
}
