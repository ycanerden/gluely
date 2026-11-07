// Draws the dashboard page. It only draws: the numbers come from buildDashboard.
// The page is one file with its style, script and data inside, so it opens offline.
import fs from 'node:fs';
import path from 'node:path';
import { GLUELY_ROOT } from './workspace.js';
import { RGB, SPRITE } from './ui.js';

const asset = (name) => fs.readFileSync(path.join(GLUELY_ROOT, 'src', 'dashboard', name), 'utf8');
// JSON inside <script> must not be able to close the tag, whatever the workspace holds.
const embed = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const FONTS = 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Mono:wght@400;500&family=Atkinson+Hyperlegible+Next:wght@400;500;700&family=Jersey+20&display=swap';

// standalone: false leaves out the document shell, for hosts that add their own.
export function renderDashboardPage(data, { standalone = true } = {}) {
  const title = `${data.company.name || 'Gluely'} Loop Dashboard`;
  const body = `<title>${escape(title)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>
${asset('style.css')}
</style>
<main class="app">
  <section class="hero" aria-labelledby="hero-title">
    <canvas id="hero-canvas" aria-hidden="true"></canvas>
    <div class="hero-in">
      <p class="eyebrow"><canvas id="mascot" width="20" height="18" aria-hidden="true"></canvas><span id="eyebrow-domain"></span><span id="eyebrow-version"></span><span id="eyebrow-plays"></span></p>
      <div>
        <h1 id="hero-title">Your GTM loop</h1>
        <p class="lede" id="lede"></p>
      </div>
      <div class="prompt">
        <p class="ask"><span id="next-step"></span><small id="next-how"></small></p>
        <div class="prompt-row"><span id="next-label">Next</span><code id="next-cmd"></code><button class="copy" id="copy" type="button">Copy</button></div>
      </div>
    </div>
  </section>

  <section class="panel" aria-labelledby="activity-title">
    <div class="panel-head">
      <h2 id="activity-title"><span class="glyph">▦</span>Activity</h2>
    </div>
    <div class="tabs" id="tabs" role="group" aria-label="What to count"></div>
    <div class="heat" id="heat" role="img"></div>
    <div class="heat-foot">
      <span id="heat-summary"></span>
      <span class="legend" aria-hidden="true"><span>Less</span><i class="cell"></i><i class="cell l1"></i><i class="cell l2"></i><i class="cell l3"></i><i class="cell l4"></i><span>More</span></span>
    </div>
    <p class="heat-foot" id="heat-caption" aria-live="polite"></p>
  </section>

  <div class="pair">
    <section class="panel" aria-labelledby="plays-title">
      <div class="panel-head"><h2 id="plays-title"><span class="glyph">▶</span>Plays</h2><span class="hint">${data.rules.kill_from} touches to judge, ${data.rules.decide_at} to decide</span></div>
      <ul class="rows" id="rows"></ul>
    </section>
    <section class="panel" aria-labelledby="log-title">
      <div class="panel-head"><h2 id="log-title"><span class="glyph">◆</span>Decisions</h2><span class="hint">newest first</span></div>
      <ul class="log" id="log"></ul>
    </section>
  </div>

  <footer class="foot"><span id="foot-note"></span><span>Gluely never sends a message and never calls a model.</span></footer>
</main>
<script type="application/json" id="gluely-data">${embed(data)}</script>
<script type="application/json" id="gluely-sprite">${embed({ rows: SPRITE, rgb: RGB })}</script>
<script>
${asset('client.js')}
</script>
`;
  if (!standalone) return body;
  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${body}</body>\n</html>\n`;
}
