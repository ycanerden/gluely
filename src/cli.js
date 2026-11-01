import fs from 'node:fs';
import path from 'node:path';
import { addCase, checkCompany, checkDraft, pendingCases, runTests, submitAnswer } from './brain-tests.js';
import { scanContext } from './context.js';
import { diagnose } from './doctor.js';
import { buildFlow, renderFlow } from './flow.js';
import { initWorkspace } from './init.js';
import { color, fail, GluelyError, mark, printIssues } from './output.js';
import { validatePlays } from './plays.js';
import { HOSTS, installSkills, listSkills } from './skills.js';
import { loadStack, setStack } from './stack.js';
import { CHANNELS } from './vocab.js';
import { contextVersion, GLUELY_ROOT, requireWorkspace } from './workspace.js';

const VERSION = JSON.parse(fs.readFileSync(path.join(GLUELY_ROOT, 'package.json'), 'utf8')).version;
const BOOLEAN_FLAGS = new Set(['json', 'help', 'version', 'no-git', 'no-skills', 'strict']);

const HELP = `gluely ${VERSION}: an open-source GTM brain. Your agent thinks. Gluely remembers and checks.

Start
  gluely init <dir> --company <name> [--domain d] [--motion m]   create your private workspace
  gluely doctor                                                  where you stand and what to do next
  gluely flow                                                    the loop, drawn from real state

Brain
  gluely context check | version                                 is the context filled and valid?
  gluely plays list | validate | new <id>                        hypotheses with kill rules
  gluely check draft --channel <c> (--text <t> | --file <f>)     test a draft against your voice
  gluely check company <domain>                                  is this company excluded?

Tests
  gluely test                                                    run tests and compare context versions
  gluely test pending                                            cases waiting for your agent
  gluely test submit <id> <answer> --by <agent/model>            record your agent's answer
  gluely test add --kind <k> --input <t> --expect <e>            turn a correction into a test

Stack
  gluely stack                                                   the tools you use, by layer
  gluely stack set <layer> <any tool name>                       name a tool. Any tool works

Skills
  gluely skills list | install [--host claude,cursor]            the GTM skill pack

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

const line = (ok, text) => console.log(`${ok ? mark.ok() : mark.bad()} ${text}`);

// Each command returns { data, render, exit }. `render` is skipped under --json.
const commands = {
  init(args) {
    const data = initWorkspace({
      dir: args._[0],
      company: args.flags.company,
      domain: args.flags.domain,
      motion: args.flags.motion,
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
    const data = diagnose(requireWorkspace());
    return {
      data,
      render() {
        console.log(color.bold(`Gluely doctor: ${data.company.name || 'workspace'}`));
        for (const check of data.checks) line(check.ok, `${check.name.padEnd(11)} ${color.dim(check.detail)}`);
        console.log(`\n${mark.next()} ${color.bold(data.next.step)}: ${data.next.how}`);
      },
    };
  },

  flow() {
    const state = diagnose(requireWorkspace());
    const data = buildFlow(state);
    return { data, render: () => console.log(renderFlow(data, state.company.name)) };
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
        printIssues(data.issues);
      },
    };
  },

  plays(args) {
    const ws = requireWorkspace();
    const sub = args._[0] || 'list';
    if (sub === 'new') return newPlay(ws, args._[1]);
    if (!['list', 'validate'].includes(sub)) fail('usage', 'Usage: gluely plays list | validate | new <id>');
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
    if (args.flags.help || !name) { console.log(HELP); return 0; }
    const command = commands[name];
    if (!command) fail('unknown_command', `Unknown command "${name}".`, 'Run gluely --help.');
    const { data, render, exit = 0 } = command(args);
    if (args.flags.json) console.log(JSON.stringify(data, null, 2));
    else render();
    return exit;
  } catch (error) {
    if (!(error instanceof GluelyError)) throw error;
    if (wantsJson) console.log(JSON.stringify({ ok: false, error: { code: error.code, message: error.message, hint: error.hint } }, null, 2));
    else {
      console.error(`${mark.bad()} ${error.message}`);
      if (error.hint) console.error(`${mark.next()} ${error.hint}`);
    }
    return 1;
  }
}

