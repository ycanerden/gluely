import fs from 'node:fs';
import path from 'node:path';
import { addCase, checkCompany, checkDraft, pendingCases, runTests, submitAnswer } from './brain-tests.js';
import { scanContext } from './context.js';
import { estimateCost, setAssumptions, setPrice } from './cost.js';
import { buildDashboard, DEFAULT_OUT, writeDashboard } from './dashboard.js';
import { renderDashboardPage } from './dashboard-page.js';
import { diagnose } from './doctor.js';
import { buildFlow, renderFlow } from './flow.js';
import { initWorkspace } from './init.js';
import { addTool, loadLibrary, loadPlaybooks, toolsForJob } from './library.js';
import { addEntry, dropEntry, learn, listEntries, logCorrection, promoteEntry, recall } from './log.js';
import { color, fail, GluelyError, mark, printIssues } from './output.js';
import { guardFile } from './guard.js';
import { validatePlays } from './plays.js';
import { answerStep, nextStep, startPlay } from './playbooks.js';
import { serve } from './mcp.js';
import { addResult, judgePlay, renderJudgement } from './results.js';
import { planWaterfall, recordTest, renderWaterfall } from './waterfall.js';
import { loadPrices } from './cost.js';
import { HOSTS, installSkills, listSkills } from './skills.js';
import { loadStack, setStack } from './stack.js';
import { CHANNELS } from './vocab.js';
import { beside, Cancelled, interactive, mascot, say } from './ui.js';
import { confirmApproval, costFlow, pickPlaybook, renderCost, walkPlay } from './walk.js';
import { installInfo, updateGluely } from './update.js';
import { contextVersion, findWorkspace, GLUELY_ROOT, requireWorkspace } from './workspace.js';

const VERSION = JSON.parse(fs.readFileSync(path.join(GLUELY_ROOT, 'package.json'), 'utf8')).version;
const BOOLEAN_FLAGS = new Set(['json', 'help', 'version', 'no-git', 'no-skills', 'strict']);

const HELP = `gluely ${VERSION}: an open-source GTM brain. Your agent thinks. Gluely remembers and checks.

Start
  gluely init <dir> --company <name> [--market b2b|b2c|both] [--motion m]   create your private workspace
  gluely                                                         your home screen
  gluely doctor                                                  where you stand and what to do next
  gluely flow                                                    the loop, drawn from real state
  gluely dashboard [--out <file>] [--weeks 26]                   the loop's numbers on one page you open in a browser

Brain
  gluely context check | version                                 is the context filled and valid?
  gluely plays start [playbook] [--as id]                        set up a play, one question at a time
  gluely plays next <id> | answer <id> <step> <value>            the same steps, for agents
  gluely plays list | validate | new <id>                        hypotheses with kill rules
  gluely playbooks                                               example plays to start from
  gluely check draft --channel <c> (--text <t> | --file <f>)     test a draft against your voice
  gluely check company <domain>                                  is this company excluded?
  gluely guard <list.csv> [--to <tool>] [--customers <csv>]      sort a list before it leaves: clear, to owners, held

Tests
  gluely test                                                    run tests and compare context versions
  gluely test pending                                            cases waiting for your agent
  gluely test submit <id> <answer> --by <agent/model>            record your agent's answer
  gluely test add --kind <k> --input <t> --expect <e>            turn a correction into a test

Learning
  gluely log                                                     every decision and correction
  gluely log add --kind <k> --area <a> --text <t> [--why <w>]    keep a decision or human input
  gluely log add --kind correction --area voice --before <b> --after <a>   keep an edit
  gluely recall --area <a> [--scope <person>]                    lessons to read before writing
  gluely learn                                                   what keeps coming up
  gluely log promote <id> --to <file> | drop <id> --why <why>    close a lesson

Results
  gluely results <play>                                          what a play produced, and keep or kill
  gluely results add <play> --touches <n> --positive <n> [--replies n] [--meetings n] [--spent n] [--placement inbox|spam] [--on YYYY-MM-DD]

Cost
  gluely cost <play> [--fit 30%] [--touches 2] [--checks 1]      estimate before spending credits
  gluely cost price <tool> --job <j> --each <n> | --credits <n>  add your own price
  gluely cost approve <play>                                     a person approves the estimate

Tools
  gluely stack                                                   the tools you use, by layer
  gluely stack set <layer> <any tool name>                       name a tool. Any tool works
  gluely tools [job]                                             the tool library, by job
  gluely tools add <name> --job <job> [--access <kind>]          add your own tool
  gluely waterfall <job> [--tools "A, B"]                        order your tools by your own price and tests
  gluely waterfall test <tool> --job <j> --tried 20 --right <n> [--wrong n] [--unprovable n]   a blind test

Skills
  gluely skills list | install [--host claude,cursor]            the GTM skill pack

Gluely itself
  gluely update                                                  get the latest Gluely, with git. Your workspace is not touched

Agents
  gluely mcp [--workspace <dir>]                                 every command above as MCP tools, over stdio

Add --json to any command for agents. Gluely never sends a message and never calls a model.`;

export function parseArgs(argv) {
  const parsed = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { parsed._.push(arg); continue; }
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq > -1) parsed.flags[body.slice(0, eq)] = body.slice(eq + 1);
    else if (BOOLEAN_FLAGS.has(body)) parsed.flags[body] = true;
    else if (i + 1 < argv.length) parsed.flags[body] = argv[++i];
    else fail('usage', `--${body} needs a value.`);
  }
  return parsed;
}

const activeWorkspace = () => process.env.GLUELY_WORKSPACE || findWorkspace();
const line = (ok, text) => console.log(`${ok ? mark.ok() : mark.bad()} ${text}`);

// Each command returns { data, render, exit }. `render` is skipped under --json.
export const commands = {
  init(args) {
    const data = initWorkspace({
      dir: args._[0],
      company: args.flags.company,
      domain: args.flags.domain,
      motion: args.flags.motion,
      market: args.flags.market,
      noGit: args.flags['no-git'],
      noSkills: args.flags['no-skills'],
    });
    return {
      data,
      render() {
        line(true, `Brain created at ${data.dir}`);
        console.log(`\n${mark.next()} cd ${path.relative(process.cwd(), data.dir) || '.'}`);
        console.log(`${mark.next()} Open your agent there and run ${color.bold('/setup-gluely')}`);
      },
    };
  },

  doctor() {
    const data = { ...diagnose(requireWorkspace()), install: installInfo() };
    return {
      data,
      render() {
        console.log(color.bold(`Gluely doctor: ${data.company.name || 'workspace'}`));
        for (const check of data.checks) line(check.ok, `${check.name.padEnd(11)} ${color.dim(check.detail)}`);
        console.log();
        printNext(data.next, '');
        printUpdate(data.install, '');
      },
    };
  },

  flow() {
    const state = diagnose(requireWorkspace());
    const data = buildFlow(state);
    return { data, render: () => console.log(renderFlow(data, state.company.name)) };
  },

  dashboard(args) {
    const ws = requireWorkspace();
    const data = buildDashboard(ws, { weeks: args.flags.weeks ?? 26 });
    data.file = writeDashboard(ws, data, args.flags.out || DEFAULT_OUT, renderDashboardPage);
    return {
      data,
      render() {
        line(true, `Dashboard written to ${data.file}`);
        console.log(color.dim(`  ${data.totals.touches} touches, ${data.plays.length} plays, ${data.log.length ? 'recent decisions' : 'no decisions yet'}. Open it in any browser.`));
      },
    };
  },

  update() {
    const data = updateGluely();
    return {
      data,
      render() {
        if (!data.updated) { line(true, `Gluely ${data.to.version} (${data.to.commit}) is already the latest.`); return; }
        line(true, `Gluely updated from ${data.from.commit} to ${data.to.commit}`);
        for (const change of data.changes.slice(0, 12)) console.log(`  ${mark.next()} ${change}`);
        if (data.changes.length > 12) console.log(color.dim(`  and ${data.changes.length - 12} more`));
        if (data.needs_install) console.log(`${mark.warn()} Dependencies changed. Run ${color.cyan('npm install')} in ${data.root}`);
        console.log(color.dim('  Your workspace was not touched. Run gluely skills install there to refresh the skills.'));
      },
    };
  },

  context(args) {
    const ws = requireWorkspace();
    if (args._[0] === 'version') {
      const data = contextVersion(ws);
      return { data, render: () => console.log(data.version) };
    }
    if (args._[0] !== 'check') fail('usage', 'Usage: gluely context check | version');
    const data = scanContext(ws);
    const failed = data.issues.some((i) => i.level === 'error');
    return {
      data: { ok: !failed, ...data },
      exit: failed ? 1 : 0,
      render() {
        const s = data.summary;
        line(!failed, `${s.total} context files: ${s.confirmed} confirmed, ${s.draft} draft, ${s.template} templates`);
        if (s.hunches) console.log(`  ${s.hunches} ${s.hunches === 1 ? 'claim is' : 'claims are'} still a hunch. Plays can't lean on ${s.hunches === 1 ? 'it' : 'them'} yet`);
        printIssues(data.issues);
      },
    };
  },

  async plays(args) {
    const ws = requireWorkspace();
    const sub = args._[0] || 'list';
    if (sub === 'new') return newPlay(ws, args._[1]);
    if (sub === 'start') return startCommand(ws, args);
    if (sub === 'next') {
      if (!args._[1]) fail('usage', 'Usage: gluely plays next <id>');
      const data = nextStep(ws, args._[1]);
      return { data, render: () => renderStep(data) };
    }
    if (sub === 'answer') {
      const [, id, step, ...value] = args._;
      if (!id || !step) fail('usage', 'Usage: gluely plays answer <id> <step> <value> --by <agent/model>');
      const data = answerStep(ws, id, step, value.join(' '), args.flags.by);
      return { data, render: () => { line(true, `Saved ${step}: ${data.saved.value}`); renderStep(data.next); } };
    }
    if (!['list', 'validate'].includes(sub)) fail('usage', 'Usage: gluely plays start | next | answer | list | validate | new <id>');
    const data = validatePlays(ws);
    const failed = data.issues.some((i) => i.level === 'error');
    return {
      data: { ok: !failed, ...data },
      exit: sub === 'validate' && failed ? 1 : 0,
      render() {
        if (!data.plays.length) console.log(color.dim('No plays yet.'));
        for (const play of data.plays) {
          console.log(`${String(play.id).padEnd(24)} ${String(play.status).padEnd(8)} ${color.dim(play.signal || '')}`);
        }
        if (sub === 'validate') { line(!failed, failed ? 'Plays need fixing' : 'Plays are valid'); printIssues(data.issues); }
      },
    };
  },

  guard(args) {
    const ws = requireWorkspace();
    const data = guardFile(ws, args._[0], { to: args.flags.to, by: args.flags.by, customers: args.flags.customers });
    return {
      data,
      render() {
        line(true, `${data.total} rows${data.to ? ` before ${data.to}` : ''}: ${data.counts.clear} clear, ${data.counts.owner} to owners, ${data.counts.held} held`);
        for (const warning of data.warnings) console.log(`  ${mark.warn()} ${warning}`);
        for (const row of data.rows.slice(0, 20)) console.log(`  ${row.bucket === 'held' ? mark.bad() : mark.next()} line ${row.line}: ${row.reason}`);
        if (data.rows.length > 20) console.log(color.dim(`  and ${data.rows.length - 20} more in the files below`));
        for (const [bucket, file] of Object.entries(data.files)) console.log(`  ${bucket.padEnd(5)} ${color.dim(file)}`);
        if (data.counts.clear) console.log(`${mark.next()} Only ${data.files.clear} may go to an outside tool.`);
      },
    };
  },

  waterfall(args) {
    const ws = requireWorkspace();
    const { job, tried, right, wrong, unprovable, by, tools } = args.flags;
    const data = args._[0] === 'test'
      ? recordTest(ws, args._.slice(1).join(' '), { job, tried, right, wrong, unprovable, by })
      : args._[0] ? planWaterfall(ws, args._[0], { tools }) : fail('usage', 'Usage: gluely waterfall <job> [--tools "A, B"] | gluely waterfall test <tool> --job <job> --tried 20 --right <n>');
    return { data, render: () => renderWaterfall(data, { color, line, mark }, loadPrices(ws).currency) };
  },

  results(args) {
    const ws = requireWorkspace();
    const sub = args._[0];
    const id = sub === 'add' ? args._[1] : sub;
    if (!id) fail('usage', 'Usage: gluely results <play> | gluely results add <play> --touches <n> --positive <n>');
    const data = sub === 'add' ? addResult(ws, id, args.flags) : judgePlay(ws, id);
    return {
      data,
      render() {
        if (data.added) line(true, `Added ${data.added.touches} touches to ${id} on ${data.added.on}`);
        for (const warning of data.warnings || []) console.log(`${mark.warn()} ${warning}`);
        renderJudgement(data, { color, line });
      },
    };
  },

  check(args) {
    const ws = requireWorkspace();
    if (args._[0] === 'company') {
      if (!args._[1]) fail('usage', 'Usage: gluely check company <domain>');
      const data = checkCompany(ws, args._[1]);
      return {
        data,
        exit: data.blocked ? 1 : 0,
        render: () => line(!data.blocked, data.blocked ? `${data.domain} is excluded: ${data.reason}` : `${data.domain} is not on your exclusion list`),
      };
    }
    if (args._[0] !== 'draft') fail('usage', 'Usage: gluely check draft --channel <c> (--text <t> | --file <f>) | gluely check company <domain>');
    const { channel, text, file } = args.flags;
    if (!CHANNELS.includes(channel)) fail('usage', `--channel must be one of ${CHANNELS.join(', ')}.`);
    const draft = text ?? (file && fs.readFileSync(file, 'utf8'));
    if (!draft) fail('usage', 'Pass --text or --file.');
    const data = checkDraft(ws, draft, channel);
    return {
      data,
      exit: data.pass ? 0 : 1,
      render() {
        line(data.pass, data.pass ? `Draft passes (${data.words} words)` : 'Draft breaks your voice rules');
        for (const v of data.violations) console.log(`  ${mark.bad()} ${v}`);
      },
    };
  },

  test(args) {
    const ws = requireWorkspace();
    const sub = args._[0];
    if (sub === 'pending') {
      const data = pendingCases(ws);
      return {
        data,
        render() {
          console.log(`${data.cases.length} cases waiting for your agent ${color.dim(`(context ${data.context_version})`)}`);
          for (const c of data.cases) console.log(`  ${c.id}  ${color.dim(`${c.kind}: ${String(c.input).slice(0, 60)}`)}`);
        },
      };
    }
    if (sub === 'submit') {
      const data = submitAnswer(ws, { id: args._[1], answer: args._[2], by: args.flags.by });
      return { data, render: () => line(true, `Recorded ${data.answer} for ${data.case_id} under context ${data.context_version}`) };
    }
    if (sub === 'add') {
      const { kind, input, expect, channel, why } = args.flags;
      const data = addCase(ws, { kind, input, expect, channel, why });
      logCorrection(ws, data, args.flags.by);
      return { data, render: () => line(true, `Correction saved as test ${data.id}`) };
    }
    if (sub) fail('usage', 'Usage: gluely test [pending | submit | add]');
    const data = runTests(ws);
    const r = data.reasoned;
    const incomplete = r.pending.length > 0 || r.wrong.length > 0;
    return {
      data,
      exit: !data.passed || (args.flags.strict && incomplete) ? 1 : 0,
      render() {
        console.log(color.bold('Brain tests') + color.dim(`   context ${data.context_version}`));
        line(!data.deterministic.failed.length, `Rule tests   ${data.deterministic.passed}/${data.deterministic.total}`);
        for (const f of data.deterministic.failed) console.log(`  ${mark.bad()} ${f.id}: expected ${f.expect}, got ${f.actual}${f.detail ? ` (${f.detail})` : ''}`);
        const compare = r.previous ? color.dim(`   was ${r.previous.correct}/${r.previous.answered} on ${r.previous_version}`) : '';
        line(!r.regressions.length, `Agent tests  ${r.correct}/${r.answered} correct${compare}`);
        for (const w of r.wrong) console.log(`  ${mark.bad()} ${w.id}: answered ${w.answered}, expected ${w.expected} (${w.by})`);
        for (const id of r.regressions) console.log(`  ${mark.bad()} ${id} got worse under this context`);
        for (const id of r.improved) console.log(`  ${mark.ok()} ${id} got better under this context`);
        if (r.pending.length) console.log(`${mark.next()} ${r.pending.length} waiting for your agent: run /gtm-mode`);
        for (const bad of data.invalid) console.log(`  ${mark.bad()} ${bad.file}: ${bad.id || 'case'} ${bad.problem}`);
      },
    };
  },

  stack(args) {
    const ws = requireWorkspace();
    if (args._[0] === 'set') {
      const data = setStack(ws, args._[1], args._.slice(2).join(' '));
      return { data, render: () => line(true, `${data.layer} is ${data.tool}`) };
    }
    if (args._[0]) fail('usage', 'Usage: gluely stack | gluely stack set <layer> <any tool name>');
    const data = loadStack(ws);
    return {
      data,
      render() {
        console.log(color.bold('Your stack') + color.dim('   any tool works'));
        for (const layer of data.layers) {
          const hint = color.dim(`for example ${layer.options.slice(0, 3).join(', ')}`);
          console.log(`${layer.label.padEnd(13)} ${layer.tool || hint}`);
        }
      },
    };
  },

  tools(args) {
    if (args._[0] === 'add') {
      const data = addTool(requireWorkspace(), { name: args._.slice(1).join(' '), job: args.flags.job, access: args.flags.access });
      return { data, render: () => line(true, `${data.name} is in your library for ${data.jobs[0]}`) };
    }
    const ws = activeWorkspace();
    const library = loadLibrary(ws);
    const yours = ws ? loadStack(ws).layers.map((l) => l.tool).filter(Boolean) : [];
    const jobs = args._[0] ? [args._[0]] : Object.keys(library.jobs);
    const data = {
      note: 'Listed alphabetically, with your own tools first. Gluely ranks nobody and any tool works.',
      jobs: jobs.map((job) => ({ job, label: library.jobs[job], tools: toolsForJob(ws, job, yours) })),
    };
    return {
      data,
      render() {
        console.log(color.bold('Tool library') + color.dim('   listed alphabetically, nobody is ranked, any tool works'));
        for (const group of data.jobs) {
          console.log(`\n${color.bold(group.label)} ${color.dim(group.job)}`);
          if (args._[0]) for (const tool of group.tools) console.log(`  ${tool.name.padEnd(22)} ${tool.yours ? color.green('yours  ') : '       '}${color.dim(tool.hint)}`);
          else console.log(`  ${group.tools.map((t) => (t.yours ? color.green(t.name) : t.name)).join(', ')}`);
        }
        console.log(`\n${mark.next()} ${color.dim('gluely tools <job> shows the details. gluely tools add puts your own in.')}`);
      },
    };
  },

  playbooks() {
    const data = { playbooks: loadPlaybooks().map(({ id, name, summary, steps }) => ({ id, name, summary, steps: steps.length })) };
    return {
      data,
      render() {
        console.log(color.bold('Playbooks') + color.dim('   start one with gluely plays start <id>'));
        for (const book of data.playbooks) console.log(`  ${book.id.padEnd(15)} ${book.name.padEnd(22)} ${color.dim(book.summary)}`);
      },
    };
  },

  async cost(args) {
    const ws = requireWorkspace();
    const sub = args._[0];
    if (sub === 'price') {
      const { job, each, credits, monthly, currency, by } = args.flags;
      const data = setPrice(ws, { tool: args._.slice(1).join(' '), job, each, credits, monthly, currency, by, creditPrice: args.flags['credit-price'], creditsLeft: args.flags['credits-left'] });
      return { data, render: () => line(true, `Saved your price for ${data.tool}`) };
    }
    if (sub === 'approve') {
      if (!args._[1]) fail('usage', 'Usage: gluely cost approve <play>');
      if (!interactive() || args.flags.json) fail('needs_a_person', 'Only a person can approve spending.', `Ask them to run gluely cost approve ${args._[1]} in a terminal.`);
      const data = await confirmApproval(ws, args._[1]);
      return { data, render() {}, exit: data.can_spend ? 0 : 1 };
    }
    if (!sub) fail('usage', 'Usage: gluely cost <play> | price <tool> | approve <play>');
    setAssumptions(ws, sub, args.flags);
    if (interactive() && !args.flags.json) {
      const data = await costFlow(ws, sub);
      return { data, render() {}, exit: data.can_spend ? 0 : 1 };
    }
    const data = estimateCost(ws, sub);
    return { data, render: () => renderCost(data), exit: data.can_spend ? 0 : 1 };
  },

  log(args) {
    const ws = requireWorkspace();
    const sub = args._[0];
    if (sub === 'add') {
      const { kind, area, text, why, before, after, scope, play, by, from } = args.flags;
      const data = addEntry(ws, { kind, area, text, why, before, after, scope, play, by, source: from || 'human' });
      return { data, render: () => line(true, `Kept as ${data.id}`) };
    }
    if (sub === 'promote') {
      const data = promoteEntry(ws, args._[1], args.flags.to);
      return { data, render: () => line(true, `${data.id} now lives in ${data.to}`) };
    }
    if (sub === 'drop') {
      const data = dropEntry(ws, args._[1], args.flags.why);
      return { data, render: () => line(true, `Dropped ${data.id}`) };
    }
    if (sub) fail('usage', 'Usage: gluely log [add | promote <id> | drop <id>]');
    const { kind, area, play, scope, limit } = args.flags;
    const data = listEntries(ws, { kind, area, play, scope, limit: limit ? Number(limit) : undefined });
    return {
      data,
      render() {
        if (!data.total) console.log(color.dim('Nothing logged yet. Decisions land here as you go.'));
        for (const e of data.entries) {
          const state = e.state === 'open' ? '' : color.dim(` ${e.state}`);
          console.log(`${color.dim(e.at.slice(0, 10))} ${e.id}  ${e.kind.padEnd(10)} ${e.area.padEnd(9)} ${e.text}${state}`);
        }
      },
    };
  },

  recall(args) {
    const { area, scope, play, limit } = args.flags;
    const data = recall(requireWorkspace(), { area, scope, play, limit: limit ? Number(limit) : undefined });
    return {
      data,
      render() {
        console.log(color.bold(`Lessons for ${data.area}`) + (data.read_first ? color.dim(`   read ${data.read_first} first`) : ''));
        if (!data.lessons.length) console.log(color.dim('No lessons yet.'));
        for (const l of data.lessons) console.log(`  ${l.after ? `${l.before} ${color.dim('became')} ${l.after}` : l.text}${l.why ? color.dim(`  because ${l.why}`) : ''}`);
      },
    };
  },

  learn() {
    const data = learn(requireWorkspace());
    return {
      data,
      render() {
        console.log(color.bold('What your brain has learned') + color.dim(`   ${data.decisions} decisions, ${data.promoted} lessons promoted, ${data.dropped} dropped`));
        if (!data.open) console.log(color.dim('Nothing is waiting. New corrections and inputs land here.'));
        for (const group of data.areas) {
          console.log(`\n${color.bold(group.area)} ${color.dim(`${group.open} open${group.home ? `, belongs in ${group.home}` : ''}`)}`);
          for (const e of group.entries) console.log(`  ${e.id}  ${e.text}${e.why ? color.dim(`  because ${e.why}`) : ''}`);
        }
        const removed = data.edits.keeps_removing.slice(0, 5);
        if (removed.length) console.log(`\n${color.bold('You keep removing')}  ${removed.map((w) => `"${w.word}" ${w.times}x`).join(', ')}`);
        const added = data.edits.keeps_adding.slice(0, 5);
        if (added.length) console.log(`${color.bold('You keep adding')}    ${added.map((w) => `"${w.word}" ${w.times}x`).join(', ')}`);
        if (data.open) console.log(`\n${mark.next()} Ask your agent to turn these into context changes and tests. You approve each one.`);
      },
    };
  },

  skills(args) {
    const sub = args._[0] || 'list';
    if (sub === 'list') {
      const data = { skills: listSkills() };
      return {
        data,
        render() {
          for (const s of data.skills) console.log(`${s.name.padEnd(36)} ${color.dim(s.principle ? 'principle' : 'skill')}`);
        },
      };
    }
    if (sub !== 'install') fail('usage', 'Usage: gluely skills list | install [--host claude,cursor]');
    const hosts = args.flags.host ? args.flags.host.split(',') : Object.keys(HOSTS);
    for (const host of hosts) if (!HOSTS[host]) fail('bad_host', `Unknown host "${host}". Use ${Object.keys(HOSTS).join(', ')}.`);
    const data = installSkills(requireWorkspace(), hosts);
    return { data, render: () => line(true, `${data.count} skills installed for ${data.hosts.join(', ')}`) };
  },
};

async function startCommand(ws, args) {
  const humans = interactive() && !args.flags.json;
  if (!args._[1] && !humans) fail('usage', 'Usage: gluely plays start <playbook> [--as id]', 'Run gluely playbooks --json to see them.');
  const playbook = args._[1] || await pickPlaybook();
  const id = args.flags.as || playbook;
  if (humans) {
    await walkPlay(ws, playbook, id);
    return { data: null, render() {} };
  }
  const data = startPlay(ws, playbook, id);
  return { data, render: () => renderStep(data) };
}

function renderStep(state) {
  if (state.done) { line(true, `${state.play} has every answer. Next: gluely cost ${state.play}`); return; }
  const { step } = state;
  console.log(`${state.number}/${state.total}  ${color.bold(step.ask)}\n${color.dim(step.why)}`);
  for (const option of step.options || []) console.log(`  ${option.value === option.label ? option.label : `${option.value}: ${option.label}`}`);
  console.log(`${mark.next()} gluely plays answer ${state.play} ${step.id} <value>`);
}

// A nudge, never a check: Gluely does not go online to see if it is behind.
function printUpdate(install, indent) {
  if (!install.remind) return;
  console.log(`${indent}${mark.warn()} ${color.dim(`This copy of Gluely is ${install.days_old} days old. Run`)} ${color.cyan('gluely update')} ${color.dim('for the latest.')}`);
}

// Commands sit on their own line, so the words around them can't be mistaken for one.
function printNext(next, indent) {
  console.log(`${indent}${mark.next()} ${color.bold(next.step)}`);
  console.log(`${indent}  ${next.command ? color.cyan(`$ ${next.command}`) : next.how}`);
}

function renderHome(state) {
  const ready = state.stack ? Object.values(state.stack).filter(Boolean) : [];
  const count = (status) => state.plays.filter((p) => p.status === status).length;
  const r = state.tests.reasoned;
  const d = state.tests.deterministic;
  const label = (text) => color.dim(text.padEnd(9));
  const info = [
    color.bold(`Gluely  ${state.company.name || 'your workspace'}`),
    color.dim(`context ${state.context_version}`),
    '',
    `${label('Stack')}${ready.length ? ready.join(', ') : 'no tools named yet'}`,
    `${label('Plays')}${count('active')} active, ${count('draft')} draft`,
    `${label('Tests')}${d.passed}/${d.total} rules, ${r.correct}/${r.answered} agent answers correct`,
    `${label('Learned')}${state.learning.open} open, ${state.learning.promoted} promoted, ${state.learning.decisions} decisions`,
  ];
  console.log();
  console.log(beside(mascot(), info));
  console.log();
  printNext(state.next, '  ');
  console.log();
  printUpdate(state.install, '  ');
  if (!state.context.template) say(`${color.bold('With your agent')}  open claude or cursor in this folder, then type ${color.cyan('/gtm-mode')}`);
  say(color.dim('More: gluely tools, gluely flow, gluely learn, gluely --help'));
  console.log();
}

function renderWelcome() {
  const info = [
    color.bold('Gluely'),
    'Glue for your GTM stack.',
    '',
    `${mark.next()} Create your brain: gluely init <dir> --company <name>`,
    color.dim('gluely --help shows everything.'),
  ];
  console.log();
  console.log(beside(mascot(), info));
  console.log();
}

function home() {
  const ws = activeWorkspace();
  if (!ws) return { data: { workspace: null, next: 'gluely init <dir> --company <name>' }, render: renderWelcome };
  const data = { ...diagnose(ws), install: installInfo() };
  return { data, render: () => renderHome(data) };
}

function newPlay(ws, id) {
  if (!id || !/^[a-z0-9-]+$/.test(id)) fail('usage', 'Usage: gluely plays new <id>. Use lowercase letters, numbers and dashes.');
  const target = path.join(ws, 'plays', `${id}.yaml`);
  if (fs.existsSync(target)) fail('exists', `plays/${id}.yaml already exists.`);
  const template = fs.readFileSync(path.join(ws, 'plays', '_template.yaml'), 'utf8');
  fs.writeFileSync(target, template.replace(/^id: .*$/m, `id: ${id}`));
  return { data: { file: `plays/${id}.yaml` }, render: () => line(true, `Created plays/${id}.yaml. Now write the hypothesis.`) };
}

export async function main(argv) {
  const wantsJson = argv.includes('--json');
  try {
    const args = parseArgs(argv);
    const [name, ...rest] = args._;
    args._ = rest;
    if (args.flags.version) { console.log(VERSION); return 0; }
    if (args.flags.help) { console.log(HELP); return 0; }
    if (name === 'mcp') { await serve(commands, { workspace: args.flags.workspace, version: VERSION }); return 0; }
    const command = name ? commands[name] : home;
    if (!command) fail('unknown_command', `Unknown command "${name}".`, 'Run gluely --help.');
    const { data, render, exit = 0 } = await command(args);
    if (args.flags.json) console.log(JSON.stringify(data, null, 2));
    else render();
    return exit;
  } catch (error) {
    if (error instanceof Cancelled) { say(); say(color.dim('Stopped. Your answers are saved, so run the same command to pick up here.')); return 130; }
    if (!(error instanceof GluelyError)) throw error;
    if (wantsJson) console.log(JSON.stringify({ ok: false, error: { code: error.code, message: error.message, hint: error.hint } }, null, 2));
    else {
      console.error(`${mark.bad()} ${error.message}`);
      if (error.hint) console.error(`${mark.next()} ${error.hint}`);
    }
    return 1;
  }
}

