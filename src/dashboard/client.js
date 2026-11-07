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
  function money(v) { if (v === null || v === undefined) return '–'; var c = D.currency || ''; var n = v >= 100 ? fmt.format(Math.round(v)) : v.toFixed(2); return c.length > 1 ? n + ' ' + c : c + n; }
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

  // Sidebar
  $('#company').textContent = D.company.name || 'Your workspace';
  $('#domain').textContent = D.company.domain || 'no domain set';
  $('#play-count').textContent = D.plays.length;
  var nav = $('#plays-nav');
  if (!D.plays.length) add(nav, el('li', 'empty', 'No plays yet.'));
  D.plays.forEach(function (p) {
    var a = el('a'); a.href = '#play-' + p.id;
    var v = verdictOf(p);
    add(a, el('span', 'dot ' + (STATUS[p.status] || '')), el('span', 'id', p.id), el('span', 'sub', (p.status || 'unknown') + ' · ' + v[1].toLowerCase()));
    a.title = p.hypothesis || p.id;
    add(nav, add(el('li'), a));
  });
  var facts = [
    ['Rule tests', D.tests.rules.passed + '/' + D.tests.rules.total],
    ['Agent tests', D.tests.agent.correct + '/' + D.tests.agent.answered + (D.tests.agent.pending ? ' · ' + D.tests.agent.pending + ' waiting' : '')],
    ['Open lessons', D.learning.open],
    ['Promoted', D.learning.promoted],
    ['Decisions', D.learning.decisions],
  ];
  facts.forEach(function (f) { add($('#facts'), add(el('div'), el('dt', '', f[0]), el('dd', '', f[1]))); });
  $('#generated').textContent = 'Drawn ' + D.generated_at.slice(0, 16).replace('T', ' ') + ' UTC';
  $('#version').textContent = 'Context ' + D.context_version;

  // Hero
  $('#eyebrow-domain').textContent = D.company.domain || 'workspace';
  $('#eyebrow-version').textContent = 'context ' + D.context_version;
  $('#eyebrow-plays').textContent = D.plays.filter(function (p) { return p.status === 'active'; }).length + ' active plays';
  $('#hero-title').textContent = D.company.name || 'Your GTM loop';
  var last = D.plays.map(function (p) { return p.last_at; }).filter(Boolean).sort().pop();
  var lede = $('#lede');
  if (D.totals.touches) {
    add(lede, document.createTextNode(''), el('b', 'num', fmt.format(D.totals.touches)), document.createTextNode(' touches, '),
      el('b', 'num', fmt.format(D.totals.positive)), document.createTextNode(' positive, '),
      el('b', 'num', fmt.format(D.totals.meetings)), document.createTextNode(' meetings. Last result ' + ago(last) + '.'));
  } else lede.textContent = 'No results yet. The loop starts when the first batch comes back.';
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

  // Activity
  var METRICS = [['touches', 'Touches'], ['replies', 'Replies'], ['positive', 'Positive'], ['meetings', 'Meetings'], ['decisions', 'Decisions']];
  var metric = 'touches';
  try { metric = localStorage.getItem('gluely.metric') || metric; } catch (e) { /* storage is optional */ }
  if (!METRICS.some(function (m) { return m[0] === metric; })) metric = 'touches';
  var tabs = $('#tabs');
  METRICS.forEach(function (m) {
    var b = el('button', '', m[1]); b.type = 'button'; b.dataset.metric = m[0];
    b.addEventListener('click', function () { metric = m[0]; try { localStorage.setItem('gluely.metric', metric); } catch (e) { /* optional */ } drawHeat(); });
    add(tabs, b);
  });

  var cal = D.calendar;
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
    var months = el('div', 'heat-months'); add(months, el('span'));
    var grid = el('div', 'heat-grid');
    var values = cal.days.map(function (d) { return d[metric]; });
    var level = levels(values);
    var lastMonth = -1;
    for (var w = 0; w < cal.weeks; w++) {
      var first = cal.days[w * 7];
      var m = new Date(first.date + 'T00:00:00Z').getUTCMonth();
      var span = el('span', '', m !== lastMonth && (w > 0 || new Date(first.date + 'T00:00:00Z').getUTCDate() <= 7) ? MONTHS[m] : '');
      if (m !== lastMonth) lastMonth = m;
      add(months, span);
    }
    for (var r = 0; r < 7; r++) add(grid, el('span', 'wd', r % 2 === 0 ? DAYS[r] : ''));
    for (var i = 0; i < cal.weeks * 7; i++) {
      var day = cal.days[i];
      var cell = el('span', 'cell');
      if (!day) { cell.className = 'cell future'; add(grid, cell); continue; }
      cell.className = 'cell l' + level(day[metric]) + (day.date === cal.end ? ' today' : '');
      cell.title = longDay(day.date) + ': ' + fmt.format(day[metric]) + ' ' + label;
      cell.dataset.i = i;
      add(grid, cell);
    }
    add(heat, months, grid);
    var total = values.reduce(function (a, b) { return a + b; }, 0);
    var activeDays = values.filter(function (v) { return v > 0; }).length;
    var best = cal.days.reduce(function (a, d) { return d[metric] > (a ? a[metric] : 0) ? d : a; }, null);
    var summary = $('#heat-summary'); summary.textContent = '';
    add(summary, el('b', 'num', fmt.format(total)), document.createTextNode(' ' + label + ' in ' + cal.weeks + ' weeks, on ' + activeDays + (activeDays === 1 ? ' day' : ' days')),
      best ? document.createTextNode('. Busiest: ' + longDay(best.date) + ', ' + fmt.format(best[metric]) + '.') : document.createTextNode('.'));
    heat.setAttribute('aria-label', fmt.format(total) + ' ' + label + ' logged over the last ' + cal.weeks + ' weeks');
    var wrap = heat.parentNode; wrap.scrollLeft = wrap.scrollWidth;
    caption.textContent = total ? 'Point at a day to see it.' : (metric === 'decisions' ? 'Nothing logged yet. Decisions land here as you go.' : 'Nothing yet. Add a batch with gluely results add <play> --touches <n> --positive <n>.');
  }
  heat.addEventListener('pointerover', function (e) {
    var i = e.target && e.target.dataset ? e.target.dataset.i : undefined;
    if (i === undefined) return;
    var d = cal.days[Number(i)];
    caption.textContent = longDay(d.date) + ': ' + fmt.format(d.touches) + ' touches, ' + fmt.format(d.replies) + ' replies, ' + fmt.format(d.positive) + ' positive, ' + fmt.format(d.meetings) + ' meetings, ' + d.decisions + ' decisions';
  });
  drawHeat();

  // Funnel
  var T = D.totals;
  var steps = [['Touches', T.touches, null], ['Replies', T.replies, D.rates.reply], ['Positive', T.positive, D.rates.positive], ['Meetings', T.meetings, D.rates.meeting]];
  var funnel = $('#funnel');
  steps.forEach(function (s) {
    var bar = el('span', 'bar'); var fill = el('i'); fill.style.width = (T.touches ? Math.max(0, s[1] / T.touches) * 100 : 0) + '%';
    add(bar, fill);
    add(funnel, add(el('li'), el('span', '', s[0]), bar, el('span', 'n num', fmt.format(s[1])), el('span', 'r num', s[2] === null ? '' : pct(s[2]))));
  });
  var range = D.rates.positive_could_be;
  var rangeText = $('#range-text');
  if (range) {
    var top = Math.max(0.05, Math.ceil(range[1] * 1.25 * 20) / 20);
    var track = $('#range-track');
    var spanEl = el('span', 'span'); spanEl.style.left = (range[0] / top) * 100 + '%'; spanEl.style.width = ((range[1] - range[0]) / top) * 100 + '%';
    var pt = el('span', 'pt'); pt.style.left = (D.rates.positive / top) * 100 + '%';
    add(track, spanEl, pt);
    add($('#range-scale'), el('span', '', '0%'), el('span', '', pct(top / 2)), el('span', '', pct(top)));
    add(rangeText, document.createTextNode('Positive rate '), el('b', 'num', pct(D.rates.positive)),
      document.createTextNode(T.touches < D.rules.kill_from ? '. Under ' + D.rules.kill_from + ' touches, so it is still noise.' : '. It could really be anywhere from ' + pct(range[0]) + ' to ' + pct(range[1]) + '.'));
  } else { rangeText.textContent = 'No touches yet, so there is no rate to show.'; $('#range-track').hidden = true; }
  var moneyRows = [['Spent', T.spent ? money(T.spent) : null], ['Per meeting', D.roi.per_meeting === null ? null : money(D.roi.per_meeting)], ['Pipeline', D.roi.pipeline_per_spent === null ? null : D.roi.pipeline_per_spent.toFixed(1) + '× spend']];
  moneyRows.forEach(function (m) { add($('#money'), add(el('div'), el('dt', '', m[0]), el('dd', m[1] === null ? 'none' : 'num', m[1] === null ? 'not yet' : m[1]))); });

  // Decision log
  var GLYPH = { decision: '◆', correction: '✎', input: '↳', result: '▪' };
  var log = $('#log');
  if (!D.log.length) add(log, add(el('li', 'empty'), document.createTextNode('Nothing logged yet. Keep a decision with '), el('code', '', 'gluely log add')));
  D.log.forEach(function (e) {
    var meta = add(el('span', 'm'), el('span', '', e.kind + ' · ' + e.area), el('span', '', e.by || ''), el('span', 'num', ago(e.at)));
    if (e.state && e.state !== 'open') add(meta, el('span', 'chip ' + (e.state === 'promoted' ? 'ok' : ''), e.state));
    add(log, add(el('li'), el('span', 'k ' + e.kind, GLYPH[e.kind] || '·'), el('span', 't', e.text), meta));
  });

  // Plays
  var rows = $('#rows');
  if (!D.plays.length) add(rows, add(el('p', 'empty'), document.createTextNode('No plays yet. Set one up with '), el('code', '', 'gluely plays start')));
  else add(rows, add(el('div', 'row head'), el('span', '', 'Play'), el('span', '', 'Verdict'), el('span', '', 'Toward a decision'), el('span', 'rate', 'Positive')));
  D.plays.forEach(function (p) {
    var v = verdictOf(p);
    var row = el('div', 'row'); row.id = 'play-' + p.id;
    var name = add(el('b'), el('span', 'dot ' + (STATUS[p.status] || '')), el('span', '', p.id));
    var who = add(el('div', 'who'), name, p.hypothesis ? el('p', '', p.hypothesis) : null, p.kill_if ? el('p', 'rule', 'kill if ' + p.kill_if) : null);
    var chip = el('span', 'chip ' + v[0], v[1]); chip.title = p.why || '';
    var verdict = add(el('div', 'verdict'), chip);
    var progress = el('div', 'progress');
    if (p.totals) {
      var goal = Math.max(p.decide_at || D.rules.decide_at, 1);
      var trackEl = el('div', 'track');
      var fillEl = el('i', v[0] || 'quiet'); fillEl.style.width = Math.min(1, p.totals.touches / goal) * 100 + '%';
      add(trackEl, fillEl);
      if (D.rules.kill_from < goal) { var tick = el('span', 'tick'); tick.style.left = (D.rules.kill_from / goal) * 100 + '%'; tick.title = 'From ' + D.rules.kill_from + ' touches a play with no positive reply can die'; add(trackEl, tick); }
      add(progress, trackEl, add(el('div', 'track-label'), el('span', 'num', fmt.format(p.totals.touches) + ' / ' + goal + ' touches'), el('span', 'num', p.batches + (p.batches === 1 ? ' batch' : ' batches') + (p.last_at ? ' · ' + ago(p.last_at) : ''))));
    } else add(progress, el('p', 'empty', p.why));
    var r = p.rates;
    var rate = add(el('div', 'rate num'), document.createTextNode(r && p.totals.touches ? pct(r.positive) : '–'),
      r && r.positive_could_be ? el('small', '', pct(r.positive_could_be[0]) + '–' + pct(r.positive_could_be[1])) : null);
    add(rows, add(row, who, verdict, progress, rate));
  });

  // The loop, with each stage only as far along as it really is.
  var loop = $('#loop'); var detail = $('#loop-detail');
  var STAGE = { working: 'ok', started: 'warn', later: '', tool: 'sky' };
  D.stages.forEach(function (s) {
    var b = add(el('span', 'stage ' + s.status), el('span', 'dot ' + (STAGE[s.status] || '')), el('span', '', s.label));
    b.title = s.status + ': ' + s.detail; b.tabIndex = 0;
    var show = function () { detail.textContent = s.label + ' (' + s.status + '): ' + s.detail; };
    b.addEventListener('pointerenter', show); b.addEventListener('focus', show);
    add(loop, add(el('li'), b));
  });
  detail.textContent = D.note;

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
