// Runs TLC on every chart, then breaks each model on purpose. A rule that still holds
// once its guard is gone can't fail at all, so this catches rules that prove nothing.
// Needs Java and TLA2TOOLS pointing at tla2tools.jar.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JAR = path.resolve(process.env.TLA2TOOLS || path.join(os.homedir(), '.cache/statechart/tla2tools.jar'));
const JAVA = process.env.JAVA || 'java';

const SPECS = {
  Person360: 'person-360',
  SendGates: 'send-gates',
  PlayArbitration: 'play-arbitration',
  LearnLoop: 'learn-loop',
};

// Each break removes one guard. The named rule must then fail.
const BREAKS = [
  ['Person360', 'CrmOnlyAfterSalesReady', '  /\\ log = <<"signal", "ready">>\n  /\\ crm = "out"\n', '  /\\ crm = "out"\n'],
  ['Person360', 'StageIsLogged', `  /\\ log' = <<"signal", "ready", "stage">>\n  /\\ UNCHANGED <<who, picture, idMinted>>`, '  /\\ UNCHANGED <<who, log, picture, idMinted>>'],
  ['Person360', 'ViewFollowsLedger', 'Refresh ==\n  /\\ log # <<>>\n', 'Refresh ==\n'],
  ['Person360', 'SignalNeedsAPerson', 'LogSignal ==\n  /\\ idMinted\n', 'LogSignal ==\n'],
  ['Person360', 'UrlOnInternalId', 'Link ==\n  /\\ idMinted\n  /\\ who = "id"\n', 'Link ==\n  /\\ who \\in {"none", "id"}\n'],
  ['SendGates', 'NoSendWhenSuppressed', 'Send ==\n  /\\ gate = "clear"\n', 'Send ==\n  /\\ gate # "excluded"\n'],
  ['SendGates', 'NoSendWhenExcluded', 'Send ==\n  /\\ gate = "clear"\n', 'Send ==\n  /\\ gate # "suppressed"\n'],
  ['SendGates', 'EverySendHasAttribution', `  /\\ attr' = "play, variant, context"\n  /\\ UNCHANGED <<gate, approved>>`, '  /\\ UNCHANGED <<gate, attr, approved>>'],
  ['SendGates', 'HumanApprovesBeforeSend', `  /\\ touch' = "approved"\n  /\\ approved' = TRUE\n  /\\ UNCHANGED <<gate, attr>>`, `  /\\ touch' = "approved"\n  /\\ UNCHANGED <<gate, attr, approved>>`],
  ['PlayArbitration', 'OneActivePlay', `  /\\ hiring' = "aside"\n  /\\ active' = "job"\n`, `  /\\ hiring' = "active"\n  /\\ active' = "job"\n`],
  ['PlayArbitration', 'LoserIsRecorded', `AsideHiring ==\n  /\\ active = "job"\n  /\\ job = "active"\n`, 'AsideHiring ==\n'],
  ['LearnLoop', 'LogHoldsNoPersonalData', 'Keep ==\n  /\\ draft = "clean"\n', 'Keep ==\n  /\\ draft # "none"\n'],
  ['LearnLoop', 'OnlyAPersonPromotes', `  /\\ proposal = "proposed"\n  /\\ proposal' = "approved"\n  /\\ entry' = "promoted"\n  /\\ UNCHANGED <<source, draft, suppressed>>`, `  /\\ entry' = "promoted"\n  /\\ UNCHANGED <<source, draft, proposal, suppressed>>`],
  ['LearnLoop', 'UnsubscribeSuppresses', `  /\\ suppressed' = (s = "unsubscribe")\n`, `  /\\ suppressed' = FALSE\n`],
  ['LearnLoop', 'OnlyUnsubscribeSuppresses', `  /\\ suppressed' = (s = "unsubscribe")\n`, `  /\\ suppressed' = TRUE\n`],
];

// These must be reachable, so the check fails if a source can never become a promoted lesson.
const REACHABLE = ['positive', 'not_now', 'negative', 'unsubscribe', 'human_edit'];

function tlc(name, text, cfg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gluely-tlc-'));
  fs.writeFileSync(path.join(dir, `${name}.tla`), text);
  fs.writeFileSync(path.join(dir, `${name}.cfg`), cfg);
  const run = spawnSync(JAVA, ['-XX:+UseParallelGC', '-cp', JAR, 'tlc2.TLC', '-workers', '1', '-config', `${name}.cfg`, `${name}.tla`], { cwd: dir, encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return { code: run.status, out: `${run.stdout}${run.stderr}` };
}

const read = (name) => ({
  text: fs.readFileSync(path.join(HERE, SPECS[name], `${name}.tla`), 'utf8'),
  cfg: fs.readFileSync(path.join(HERE, SPECS[name], `${name}.cfg`), 'utf8'),
});

let failed = 0;
const report = (ok, message) => { console.log(`${ok ? 'ok ' : 'NOT OK'} ${message}`); if (!ok) failed++; };

for (const name of Object.keys(SPECS)) {
  const { text, cfg } = read(name);
  const { code, out } = tlc(name, text, cfg);
  const states = out.match(/(\d+) distinct states found/)?.[1] ?? '?';
  report(code === 0, `${name}: every rule holds, ${states} states`);
}

for (const [name, rule, from, to] of BREAKS) {
  const { text, cfg } = read(name);
  if (!text.includes(from)) { report(false, `${name}: the break for ${rule} no longer matches the model`); continue; }
  const { code, out } = tlc(name, text.replace(from, to), cfg);
  report(code !== 0 && out.includes(`Invariant ${rule} is violated`), `${name}: removing its guard breaks ${rule}`);
}

for (const source of REACHABLE) {
  const { text, cfg } = read('LearnLoop');
  const claim = `NeverLearned == ~(source = "${source}" /\\ entry = "promoted")\n\n====`;
  const { code, out } = tlc('LearnLoop', text.replace(/====\s*$/, claim), `${cfg}INVARIANT NeverLearned\n`);
  report(code !== 0 && out.includes('Invariant NeverLearned is violated'), `LearnLoop: ${source} can become a promoted lesson`);
}

console.log(failed ? `${failed} failed` : 'All charts hold, and every rule can fail.');
process.exit(failed ? 1 : 0);
