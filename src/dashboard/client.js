// Draws the dashboard from the JSON in #gluely-data. It only draws: every number was
// computed by `gluely dashboard`. Text from the workspace is set with textContent only.
(function () {
  'use strict';
  var D = JSON.parse(document.getElementById('gluely-data').textContent);
  var SPRITE = JSON.parse(document.getElementById('gluely-sprite').textContent);
  var NOW = Date.parse(D.generated_at);
  var fmt = new Intl.NumberFormat('en');
  var $ = function (sel) { return document.querySelector(sel); };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }
  function pct(v) { if (v === null || v === undefined) return '–'; var p = v * 100; return (p > 0 && p < 10 ? p.toFixed(1) : p.toFixed(0)) + '%'; }
  function ago(iso) {
    if (!iso) return 'never';
    var s = Math.max(0, (NOW - Date.parse(iso)) / 1000);
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    if (s < 86400 * 60) return Math.round(s / 86400) + 'd ago';
    return Math.round(s / (86400 * 30)) + 'mo ago';
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  function longDay(iso) { var d = new Date(iso + 'T00:00:00Z'); return DAYS[(d.getUTCDay() + 6) % 7] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]; }

  var VERDICT = {
    keep: ['ok', 'Keep'], keep_going: ['ok', 'Keep going'], too_early: ['', 'Too early'], no_results: ['', 'No results'],
    kill: ['no', 'Kill suggested'], decide: ['warn', 'A person decides'], check_deliverability: ['warn', 'Check deliverability'],
    fix_deliverability: ['no', 'Fix deliverability'], unreadable: ['no', 'Unreadable'],
  };
  var STATUS = { active: 'ok', paused: 'warn', killed: 'no', draft: '' };
  var verdictOf = function (p) {
    if (p.status === 'killed') return ['no', 'Killed'];
    if (p.status === 'paused') return ['warn', 'Paused'];
    return VERDICT[p.verdict] || ['', String(p.verdict).replace(/_/g, ' ')];
  };

  // The mascot, pixel for pixel from the terminal home screen.
  (function mascot() {
    var c = $('#mascot'); var g = c.getContext('2d');
    c.width = SPRITE.rows[0].length; c.height = SPRITE.rows.length;
    SPRITE.rows.forEach(function (row, y) {
      for (var x = 0; x < row.length; x++) {
        var rgb = SPRITE.rgb[row[x]];
        if (!rgb) continue;
        g.fillStyle = 'rgb(' + rgb.join(',') + ')';
        g.fillRect(x, y, 1, 1);
      }
    });
  })();

  // Hero
  $('#eyebrow-domain').textContent = D.company.domain || 'workspace';
  $('#eyebrow-version').textContent = 'context ' + D.context_version;
  $('#eyebrow-plays').textContent = D.plays.filter(function (p) { return p.status === 'active'; }).length + ' active plays';
  $('#hero-title').textContent = D.company.name || 'Your GTM loop';
  var last = D.plays.map(function (p) { return p.last_at; }).filter(Boolean).sort().pop();
  $('#lede').textContent = D.totals.touches ? 'Last result ' + ago(last) + '. Drawn ' + D.generated_at.slice(0, 16).replace('T', ' ') + ' UTC.' : 'No results yet. The loop starts when the first batch comes back.';
  $('#next-step').textContent = D.next.step;
  $('#next-how').textContent = D.next.how || '';
  var cmd = D.next.command || 'gluely doctor';
  $('#next-label').textContent = D.next.command ? 'Next' : 'Where you stand';
  $('#next-cmd').textContent = '$ ' + cmd;
  $('#copy').addEventListener('click', function () {
    var btn = this;
    var done = function (label) { btn.textContent = label; setTimeout(function () { btn.textContent = 'Copy'; }, 1400); };
    var select = function () { var r = document.createRange(); r.selectNodeContents($('#next-cmd')); var s = getSelection(); s.removeAllRanges(); s.addRange(r); done('Selected'); };
    try { navigator.clipboard.writeText(cmd).then(function () { done('Copied'); }, select); } catch (e) { select(); }
  });

  // Activity. The tabs carry the totals, so they double as the funnel.
  var T = D.totals;
  var METRICS = [['touches', 'Touches', null], ['replies', 'Replies', D.rates.reply], ['positive', 'Positive', D.rates.positive], ['meetings', 'Meetings', D.rates.meeting], ['decisions', 'Decisions', null]];
  var metric = 'touches';
  try { metric = localStorage.getItem('gluely.metric') || metric; } catch (e) { /* storage is optional */ }
  if (!METRICS.some(function (m) { return m[0] === metric; })) metric = 'touches';
  var cal = D.calendar;
  var tabs = $('#tabs');
  METRICS.forEach(function (m) {
    var total = m[0] === 'decisions' ? cal.days.reduce(function (a, d) { return a + d.decisions; }, 0) : T[m[0]];
    var b = el('button'); b.type = 'button'; b.dataset.metric = m[0];
    add(b, el('span', 'tab-name', m[1]), el('span', 'tab-n num', fmt.format(total)), m[2] === null ? null : el('span', 'tab-r num', pct(m[2])));
    b.addEventListener('click', function () { metric = m[0]; try { localStorage.setItem('gluely.metric', metric); } catch (e) { /* optional */ } drawHeat(); });
    add(tabs, b);
  });

  var heat = $('#heat');
  heat.style.setProperty('--weeks', cal.weeks);
  var caption = $('#heat-caption');

  function levels(values) {
    var nz = values.filter(function (v) { return v > 0; }).sort(function (a, b) { return a - b; });
    if (!nz.length) return function () { return 0; };
    var q = function (f) { return nz[Math.min(nz.length - 1, Math.floor(f * nz.length))]; };
    var cuts = [q(0.25), q(0.5), q(0.75)];
    return function (v) { if (!v) return 0; if (v <= cuts[0]) return 1; if (v <= cuts[1]) return 2; if (v <= cuts[2]) return 3; return 4; };
  }

  function drawHeat() {
    tabs.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.metric === metric)); });
    var label = METRICS.filter(function (m) { return m[0] === metric; })[0][1].toLowerCase();
    heat.textContent = '';
    var months = el('div', 'heat-months');
    var grid = el('div', 'heat-grid');
    var values = cal.days.map(function (d) { return d[metric]; });
    var level = levels(values);
    var lastMonth = -1;
    for (var w = 0; w < cal.weeks; w++) {
      var first = new Date(cal.days[w * 7].date + 'T00:00:00Z');
      var m = first.getUTCMonth();
      add(months, el('span', '', m !== lastMonth && (w > 0 || first.getUTCDate() <= 7) ? MONTHS[m] : ''));
      lastMonth = m;
    }
    for (var i = 0; i < cal.weeks * 7; i++) {
      var day = cal.days[i];
      var cell = el('span', 'cell');
      if (!day) { cell.className = 'cell future'; add(grid, cell); continue; }
      cell.className = 'cell l' + level(day[metric]) + (day.date === cal.end ? ' today' : '');
      cell.title = longDay(day.date) + ': ' + fmt.format(day[metric]) + ' ' + label;
      cell.dataset.i = i;
      add(grid, cell);
    }
    var days = el('div', 'heat-days');
    for (var r = 0; r < 7; r++) add(days, el('span', '', r % 2 === 0 ? DAYS[r] : ''));
    add(heat, add(el('div', 'heat-body'), days, add(el('div', 'heat-scroll'), months, grid)));
    var scroller = heat.querySelector('.heat-scroll'); scroller.scrollLeft = scroller.scrollWidth;
    var total = values.reduce(function (a, b) { return a + b; }, 0);
    var activeDays = values.filter(function (v) { return v > 0; }).length;
    var best = cal.days.reduce(function (a, d) { return d[metric] > (a ? a[metric] : 0) ? d : a; }, null);
    var summary = $('#heat-summary'); summary.textContent = '';
    add(summary, el('b', 'num', fmt.format(total)), document.createTextNode(' ' + label + ' in ' + cal.weeks + ' weeks, on ' + activeDays + (activeDays === 1 ? ' day' : ' days')),
      document.createTextNode(best ? '. Busiest: ' + longDay(best.date) + ', ' + fmt.format(best[metric]) + '.' : '.'));
    heat.setAttribute('aria-label', fmt.format(total) + ' ' + label + ' logged over the last ' + cal.weeks + ' weeks');
    caption.textContent = total ? 'Point at a day to see it.' : (metric === 'decisions' ? 'Nothing logged yet. Decisions land here as you go.' : 'Nothing yet. Add a batch with gluely results add <play> --touches <n> --positive <n>.');
  }
  heat.addEventListener('pointerover', function (e) {
    var i = e.target && e.target.dataset ? e.target.dataset.i : undefined;
    if (i === undefined) return;
    var d = cal.days[Number(i)];
    caption.textContent = longDay(d.date) + ': ' + fmt.format(d.touches) + ' touches, ' + fmt.format(d.replies) + ' replies, ' + fmt.format(d.positive) + ' positive, ' + fmt.format(d.meetings) + ' meetings, ' + d.decisions + ' decisions';
  });
  drawHeat();

  // Plays: one line each, against the 50 and 100 rule.
  var rows = $('#rows');
  if (!D.plays.length) add(rows, add(el('li', 'empty'), document.createTextNode('No plays yet. Set one up with '), el('code', '', 'gluely plays start')));
  D.plays.forEach(function (p) {
    var v = verdictOf(p);
    var goal = Math.max(p.decide_at || D.rules.decide_at, 1);
    var touches = p.totals ? p.totals.touches : 0;
    var row = el('li', 'row');
    row.title = (p.hypothesis ? p.hypothesis + '\n' : '') + (p.kill_if ? 'Kill if ' + p.kill_if + '\n' : '') + (p.why || '');
    var track = el('span', 'track'); var fill = el('i', v[0] || 'quiet'); fill.style.width = Math.min(1, touches / goal) * 100 + '%';
    add(track, fill);
    if (D.rules.kill_from < goal) { var tick = el('span', 'tick'); tick.style.left = (D.rules.kill_from / goal) * 100 + '%'; add(track, tick); }
    add(rows, add(row,
      add(el('span', 'name'), el('span', 'dot ' + (STATUS[p.status] || '')), el('span', 'id', p.id)),
      el('span', 'chip ' + v[0], v[1]),
      track,
      el('span', 'n num', fmt.format(touches) + '/' + goal),
      el('span', 'r num', p.rates && touches ? pct(p.rates.positive) : '–')));
  });

  // Decision log: the five newest, one line each.
  var GLYPH = { decision: '◆', correction: '✎', input: '↳', result: '▪' };
  var log = $('#log');
  if (!D.log.length) add(log, add(el('li', 'empty'), document.createTextNode('Nothing logged yet. Keep a decision with '), el('code', '', 'gluely log add')));
  D.log.slice(0, 5).forEach(function (e) {
    var item = el('li'); item.title = e.kind + ' · ' + e.area + (e.by ? ' · ' + e.by : '') + (e.state && e.state !== 'open' ? ' · ' + e.state : '');
    add(log, add(item, el('span', 'k ' + e.kind, GLYPH[e.kind] || '·'), el('span', 't', e.text), el('span', 'a num', ago(e.at))));
  });
  $('#foot-note').textContent = D.note;

  // The hero: a light streak, ordered-dithered like a sprite, drifting slowly.
  (function hero() {
    var canvas = $('#hero-canvas'); var g = canvas.getContext('2d');
    var BAYER = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];
    var css = getComputedStyle(document.documentElement);
    var hex = function (name) { var h = css.getPropertyValue(name).trim().replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
    var ground = hex('--hero');
    var PAL = [[125, 136, 242], [170, 180, 255], [255, 244, 214], [255, 180, 46], [240, 96, 126]];
    var PX = 3; var w = 0; var h = 0; var img = null; var t = 0;
    var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    function size() {
      var r = canvas.getBoundingClientRect();
      w = Math.max(1, Math.ceil(r.width / PX)); h = Math.max(1, Math.ceil(r.height / PX));
      canvas.width = w; canvas.height = h; img = g.createImageData(w, h);
    }
    function hash(x, y) { var n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return n - Math.floor(n); }
    function draw() {
      var d = img.data; var narrow = w < 180;
      for (var y = 0; y < h; y++) {
        var v = y / h;
        for (var x = 0; x < w; x++) {
          var u = x / w;
          var centre = 1.05 - 0.95 * u + 0.08 * Math.sin(u * 4 + t) - 0.04 * Math.sin(u * 9 - t * 1.7);
          var off = v - centre;
          var width = 0.08 + 0.22 * Math.max(0, 1 - u);
          var core = Math.exp(-(off * off) / (2 * width * width));
          var fade = narrow ? 0.4 : Math.min(1, Math.max(0, (u - 0.28) / 0.35));
          var glow = 0.25 * Math.exp(-(off * off) / (2 * 0.3 * 0.3)) * fade;
          var lum = core * fade * 0.95 + glow + (hash(x, y + Math.floor(t * 8)) - 0.5) * 0.12;
          var limit = (BAYER[(y & 7) * 8 + (x & 7)] + 0.5) / 64;
          var i = (y * w + x) * 4; var c = ground;
          if (lum > limit) {
            var k = off / width;
            c = k < -1.1 ? PAL[0] : k < -0.35 ? PAL[1] : k < 0.25 ? PAL[2] : k < 0.9 ? PAL[3] : PAL[4];
            if (lum < limit + 0.12) c = [Math.round((c[0] + ground[0]) / 2), Math.round((c[1] + ground[1]) / 2), Math.round((c[2] + ground[2]) / 2)];
          }
          d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
    }
    size(); draw();
    addEventListener('resize', function () { size(); draw(); });
    if (still) return;
    var lastFrame = 0;
    (function tick(now) {
      if (!document.hidden && now - lastFrame > 90) { lastFrame = now; t += 0.018; draw(); }
      requestAnimationFrame(tick);
    })(0);
  })();
})();
