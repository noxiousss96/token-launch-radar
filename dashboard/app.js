// Token Radar dashboard: renders window.RADAR with no network. Board, detail view,
// filters, live-token comparison, the model and a sandbox that re-ranks the board live.
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) { document.body.innerHTML = '<p style="padding:2em">No radar data found (data.js missing).</p>'; return; }

  var watchSet = {};
  R.watchlist.forEach(function (s) { watchSet[s] = true; });
  var rows = R.rows.slice();
  var state = { q: '', cat: '', chain: '', tvl: 0, watch: false, sort: 'rank', detail: null };
  var sandbox = { growth: R.model.growth_weight, maturity: R.model.maturity_range, mult: 1 };
  var sandboxOn = false;

  function $(id) { return document.getElementById(id); }
  function money(n) {
    if (n == null || !isFinite(n)) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n == null) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function ageFmt(days) {
    if (days == null) return '—';
    if (days >= 365) { var y = Math.floor(days / 365); var m = Math.floor((days % 365) / 30); return y + 'y' + (m ? ' ' + m + 'm' : ''); }
    if (days >= 30) return Math.floor(days / 30) + 'mo';
    return days + 'd';
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // Header stats.
  $('stats').innerHTML =
    '<div><dt>Ranked</dt><dd>' + R.board_size + '</dd></div>' +
    '<div><dt>Watchlist</dt><dd>' + R.watchlist_size + '</dd></div>' +
    '<div><dt>Early finds</dt><dd>' + R.early_size + '</dd></div>' +
    '<div><dt>Snapshot</dt><dd><small>' + esc(R.as_of) + '</small></dd></div>';

  // Filter options.
  var cats = {}, chains = {};
  rows.forEach(function (r) {
    if (r.category) cats[r.category] = true;
    r.chains.forEach(function (c) { chains[c] = true; });
  });
  Object.keys(cats).sort().forEach(function (c) { $('f-cat').insertAdjacentHTML('beforeend', '<option>' + esc(c) + '</option>'); });
  Object.keys(chains).sort().forEach(function (c) { $('f-chain').insertAdjacentHTML('beforeend', '<option>' + esc(c) + '</option>'); });

  // The model, re-implemented for the sandbox: the same formula as lib/model.ts.
  function recompute(r) {
    var m = R.model;
    var growth = r.change_7d == null ? 0 : Math.min(m.growth_cap, Math.max(m.growth_floor, r.change_7d));
    var gMult = 1 + (growth / 100) * sandbox.growth;
    var age = r.age_days == null ? m.unknown_age_days : r.age_days;
    var mat = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * sandbox.maturity;
    return Math.max(1, Math.round(r.tvl_usd * r.category_multiple * sandbox.mult * gMult * mat));
  }
  function visibleRows() {
    var list = rows.filter(function (r) {
      if (state.watch && !watchSet[r.slug]) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < state.tvl) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    if (sandboxOn) {
      list = list.map(function (r) { var c = {}; for (var k in r) c[k] = r[k]; c.implied_value_usd = recompute(r); return c; });
      list.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd; });
      list.forEach(function (r, i) { r.rank = i + 1; });
    }
    if (state.sort === 'tvl') list.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (state.sort === 'growth') list.sort(function (a, b) { return (b.change_7d || -1e9) - (a.change_7d || -1e9); });
    else if (state.sort === 'age') list.sort(function (a, b) { return (b.age_days || 0) - (a.age_days || 0); });
    else if (state.sort === 'name') list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    else if (!sandboxOn) list.sort(function (a, b) { return a.rank - b.rank; });
    return list;
  }

  function renderBoard() {
    var list = visibleRows();
    $('count').textContent = list.length + ' of ' + rows.length + ' protocols' + (sandboxOn ? ' — sandbox model active (re-ranked)' : '') + '. Click a row for its farm plan and value breakdown.';
    var html = '';
    list.forEach(function (r) {
      var g = r.change_7d;
      html += '<tr data-slug="' + esc(r.slug) + '"' + (state.detail === r.slug ? ' class="selected"' : '') + '>' +
        '<td class="num rank">' + r.rank + '</td>' +
        '<td class="name-cell">' + esc(r.name) + (watchSet[r.slug] ? '<span class="watch">WATCHLIST</span>' : '') + '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ') || '—') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + (g == null ? '' : g >= 0 ? 'up' : 'down') + '">' + pct(g) + '</td>' +
        '<td class="num">' + ageFmt(r.age_days) + '</td>' +
        '<td class="num implied">' + money(r.implied_value_usd) + '</td></tr>';
    });
    $('board').querySelector('tbody').innerHTML = html || '<tr><td colspan="8">No protocols match these filters.</td></tr>';
  }

  function renderDetail() {
    var el = $('detail');
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === state.detail) { r = rows[i]; break; }
    if (!r) { el.hidden = true; el.innerHTML = ''; return; }
    var m = R.model;
    var base = r.tvl_usd * r.category_multiple;
    var growthPct = r.change_7d == null ? 0 : Math.min(m.growth_cap, Math.max(m.growth_floor, r.change_7d));
    var steps = r.farm_steps.map(function (s) {
      var cut = s.lastIndexOf(' Cost: ');
      var text = cut > 0 ? s.slice(0, cut) : s;
      var cost = cut > 0 ? s.slice(cut + 1) : '';
      return '<li>' + esc(text) + (cost ? '<br><span class="cost">' + esc(cost) + '</span>' : '') + '</li>';
    }).join('');
    el.innerHTML =
      '<button class="close" type="button" id="detail-close">Close ✕</button>' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="meta">Rank #' + r.rank + ' · ' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ') || 'chain unlisted') +
      ' · TVL ' + money(r.tvl_usd) + ' · 7d ' + pct(r.change_7d) + ' · listed ' + esc(r.listed_at || 'unknown') +
      ' · records no token.</p>' +
      '<div class="detail-grid"><div>' +
      '<h3>How to farm it</h3><ol class="steps">' + steps + '</ol></div><div>' +
      '<h3>Why this value</h3><div class="math">' +
      '<div class="row"><span>TVL</span><span>' + money(r.tvl_usd) + '</span></div>' +
      '<div class="row"><span>× ' + esc(r.category || 'global') + ' multiple' + (r.category_fallback ? ' (fallback)' : ' · n=' + r.category_n) + '</span><span>×' + r.category_multiple.toFixed(3) + '</span></div>' +
      '<div class="row"><span>= base value</span><span>' + money(base) + '</span></div>' +
      '<div class="row"><span>× growth (' + pct(growthPct) + ' 7d)</span><span>×' + r.growth_multiplier.toFixed(3) + '</span></div>' +
      '<div class="row"><span>× maturity (' + ageFmt(r.age_days) + ' with no token)</span><span>×' + r.maturity_multiplier.toFixed(3) + '</span></div>' +
      '<div class="row total"><span>Implied value</span><span>' + money(r.implied_value_usd) + '</span></div>' +
      '</div>' +
      '<h3>Read this first</h3><p class="note">Implied value is this radar\u2019s own estimate from the snapshot\u2019s figures. It is not a prediction that a token launches, or when — and “records no token” means the snapshot\u2019s record carries none, not that the protocol has none. Farm only money you can afford to lock up, and claim only from links the protocol itself publishes.</p>' +
      '</div></div>';
    el.hidden = false;
    $('detail-close').addEventListener('click', function () { setDetail(null); });
  }

  function setDetail(slug) {
    state.detail = slug;
    renderBoard();
    renderDetail();
    if (slug) { location.hash = 'detail/' + slug; } else if (location.hash.indexOf('#detail/') === 0) { history.replaceState(null, '', ' '); }
    if (slug) $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Live tokens.
  $('live').querySelector('tbody').innerHTML = R.live.map(function (r) {
    return '<tr><td class="name-cell">' + esc(r.name) + '<span class="slug">' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.category || '—') + '</td><td>' + esc(r.chains.slice(0, 3).join(', ') || '—') + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + money(r.mcap_usd) + '</td>' +
      '<td class="num">' + (r.mcap_tvl == null ? '—' : r.mcap_tvl.toFixed(3) + '×') + '</td></tr>';
  }).join('');

  // Multiples table.
  $('multiples').querySelector('tbody').innerHTML = R.multiples.slice().sort(function (a, b) { return b.multiple - a.multiple; }).map(function (t) {
    var fb = t.n < R.model.min_category_n;
    return '<tr><td>' + esc(t.category) + (fb ? ' <span class="slug">(fallback)</span>' : '') + '</td>' +
      '<td class="num">' + t.n + '</td><td class="num">' + t.multiple.toFixed(3) + '×</td></tr>';
  }).join('');

  // Sandbox.
  function sandboxRow(id, label, min, max, step, value, fmt) {
    return '<label>' + label + ': <output id="out-' + id + '">' + fmt(value) + '</output>' +
      '<input type="range" id="sb-' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '"></label>';
  }
  $('sandbox').innerHTML =
    sandboxRow('growth', 'Growth weight', 0, 1, 0.05, sandbox.growth, function (v) { return (+v).toFixed(2); }) +
    sandboxRow('maturity', 'Maturity range (0.60 + range at 2y)', 0, 0.8, 0.05, sandbox.maturity, function (v) { return (+v).toFixed(2); }) +
    sandboxRow('mult', 'Multiple scale (all categories)', 0.25, 3, 0.05, sandbox.mult, function (v) { return (+v).toFixed(2) + '×'; }) +
    '<button class="tab active" type="button" id="sb-reset">Reset to the published model</button>';
  function onSandbox() {
    sandbox.growth = +$('sb-growth').value;
    sandbox.maturity = +$('sb-maturity').value;
    sandbox.mult = +$('sb-mult').value;
    $('out-growth').textContent = sandbox.growth.toFixed(2);
    $('out-maturity').textContent = sandbox.maturity.toFixed(2);
    $('out-mult').textContent = sandbox.mult.toFixed(2) + '×';
    sandboxOn = sandbox.growth !== R.model.growth_weight || sandbox.maturity !== R.model.maturity_range || sandbox.mult !== 1;
    var top = visibleRows()[0];
    $('sandbox-note').textContent = sandboxOn
      ? 'Sandbox active: with these settings the board re-ranks and #' + (top ? '1 is ' + top.name + ' at ' + money(top.implied_value_usd) : '1 changes') + '. The published board.json keeps the published model.'
      : 'Sliders at the published values: the board below shows the published ranking.';
    renderBoard();
  }
  ['growth', 'maturity', 'mult'].forEach(function (id) { $('sb-' + id).addEventListener('input', onSandbox); });
  $('sb-reset').addEventListener('click', function () {
    $('sb-growth').value = R.model.growth_weight;
    $('sb-maturity').value = R.model.maturity_range;
    $('sb-mult').value = 1;
    onSandbox();
  });
  onSandbox();

  // Tabs.
  document.querySelectorAll('.tab[data-view]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab[data-view]').forEach(function (b) { b.classList.toggle('active', b === btn); });
      document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + btn.dataset.view); });
    });
  });

  // Filters.
  $('q').addEventListener('input', function () { state.q = this.value; renderBoard(); });
  $('f-cat').addEventListener('change', function () { state.cat = this.value; renderBoard(); });
  $('f-chain').addEventListener('change', function () { state.chain = this.value; renderBoard(); });
  $('f-tvl').addEventListener('change', function () { state.tvl = +this.value; renderBoard(); });
  $('f-watch').addEventListener('change', function () { state.watch = this.checked; renderBoard(); });
  $('f-sort').addEventListener('change', function () { state.sort = this.value; renderBoard(); });
  $('board').querySelector('tbody').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) setDetail(tr.dataset.slug === state.detail ? null : tr.dataset.slug);
  });

  // Deep link: #detail/<slug> opens a protocol; #filter/<cat> filters by category.
  function fromHash() {
    var h = location.hash;
    if (h.indexOf('#detail/') === 0) { setDetail(decodeURIComponent(h.slice(8))); }
    else if (h.indexOf('#filter/') === 0) {
      var cat = decodeURIComponent(h.slice(8));
      $('f-cat').value = cat; state.cat = cat; renderBoard();
    }
  }
  window.addEventListener('hashchange', fromHash);
  renderBoard();
  fromHash();
})();
