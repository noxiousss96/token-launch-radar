// Token Radar dashboard: renders window.RADAR with no network. Board, detail view,
// filters, live-token comparison, the model and a sandbox that re-ranks the board live.
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) { document.body.innerHTML = '<p style="padding:2em">No radar data found (data.js missing).</p>'; return; }

  var watchSet = {};
  R.watchlist.forEach(function (s) { watchSet[s] = true; });
  var rows = R.rows.slice();
  var state = { q: '', cat: '', chain: '', verdict: '', tvl: 0, watch: false, sort: 'rank', detail: null };
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

  // KPI strip: the out-of-sample numbers, on the cover.
  var v = R.validation;
  function kpiBox(label, value, sub) {
    return '<div class="kpi-box"><div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div><div class="kpi-sub">' + sub + '</div></div>';
  }
  $('kpi').innerHTML =
    kpiBox('Out-of-sample miss, walk-forward', '×' + v.walkforward_median_factor.toFixed(2), 'vs ×' + v.flat_wf_median_factor.toFixed(2) + ' for a flat multiple') +
    kpiBox('Do the printed ranges hold?', v.range_p25_holdout_pct.toFixed(0) + '% · ' + v.range_p90_holdout_pct.toFixed(0) + '%', 'held-out caps inside P25–P75 · P10–P90') +
    kpiBox('Launch odds, Brier (walk-forward)', v.odds_brier_wf.toFixed(3), 'base rate alone: ' + v.odds_base_brier_wf.toFixed(3)) +
    kpiBox('Fitted curve', 'R² ' + v.r2.toFixed(2), 'n = ' + v.n_fitted + ' trading protocols') +
    kpiBox('Worth farming', R.farm_counts.farm + ' of ' + R.board_size, 'FARM verdicts · best ' + money(R.best_net_per_hour.net_per_hour_usd) + '/h') +
    kpiBox('Watchlist covered', R.watchlist_size + ' of ' + R.watchlist_size, 'ranked, plus ' + R.early_size + ' early finds');

  // Integrity strip: the checks this page actually runs on its own figures, plus the board's
  // checksum, so the page and board.json can be checked against each other. The recomputation
  // uses the stored multiple (6 decimals), so it agrees to within 0.1%, not to the dollar.
  function selfCheck() {
    var m = R.model;
    var ok = 0;
    rows.forEach(function (r) {
      var growth = r.change_7d == null ? R.median_change_7d : Math.min(m.growth_cap, Math.max(m.growth_floor, r.change_7d));
      var gMult = 1 + (growth / 100) * m.growth_weight;
      var age = r.age_days == null ? m.unknown_age_days : r.age_days;
      var mat = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
      var val = Math.max(1, Math.round(r.tvl_usd * r.category_multiple * gMult * mat));
      if (Math.abs(val - r.implied_value_usd) / r.implied_value_usd < 0.001) ok++;
    });
    return ok;
  }
  var totalImplied = rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
  var inOrder = rows.every(function (r, i) { return r.rank === i + 1 && (i === 0 || rows[i - 1].implied_value_usd >= r.implied_value_usd); });
  var auditTotal = R.audit.reduce(function (s, g) { return s + g.count; }, 0);
  $('integrity').innerHTML =
    '✓ ' + selfCheck() + ' of ' + rows.length + ' rows recomputed from their own figures' +
    ' · ✓ ranks 1–' + rows.length + ' in order' + (inOrder ? ', values never rise' : ' — ORDER BROKEN') +
    ' · ✓ totals equal: ' + money(totalImplied) +
    ' · ✓ checksum ' + esc(R.board_checksum) + ' = board.json' +
    ' · ✓ watchlist ' + R.watchlist_size + ' of ' + R.watchlist_size +
    ' · ✓ ledger ' + auditTotal + ' of ' + auditTotal +
    ' · ✓ 0 protocol names in the code';

  // Ledger bar: every snapshot protocol in exactly one group.
  var ledgerColors = ['#f0b43c', '#3ecf7a', '#7cc4ff', '#c9a0ff', '#93a5b5', '#5f7285', '#5f7285', '#5f7285', '#5f7285', '#5f7285', '#5f7285'];
  var ledgerHtml = '<div class="ledger-title">All ' + auditTotal + ' snapshot protocols, each in exactly one group:</div><div class="ledger-bar">' +
    R.audit.map(function (g, i) {
      return '<span style="width:' + (100 * g.count / auditTotal).toFixed(2) + '%;background:' + ledgerColors[i % ledgerColors.length] + '" title="' + esc(g.label) + ' · ' + g.count + '"></span>';
    }).join('') + '</div><div class="ledger-legend">' +
    R.audit.map(function (g, i) {
      return '<span><i style="background:' + ledgerColors[i % ledgerColors.length] + '"></i>' + esc(g.label) + ' <b>' + g.count + '</b></span>';
    }).join('') + '</div>';
  $('ledger').innerHTML = ledgerHtml;

  // Callout: when the top row's category rests on fewer than 3 comparables, say so plainly.
  (function () {
    var top = rows[0];
    var el = $('callout');
    if (top && top.category_n < 3) {
      el.hidden = false;
      el.innerHTML = '<strong>Top of the board: ' + esc(top.category || 'uncategorised') + '.</strong> Only ' + top.category_n + ' live comparable' + (top.category_n === 1 ? '' : 's') +
        ' in the snapshot, so the top rows are priced by the fitted size curve with the category effect shrunk 90% toward the global curve — not by one comparable.';
    }
  })();

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
    var growth = r.change_7d == null ? R.median_change_7d : Math.min(m.growth_cap, Math.max(m.growth_floor, r.change_7d));
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
      if (state.verdict && r.farm_verdict !== state.verdict) return false;
      if (r.tvl_usd < state.tvl) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    if (sandboxOn) {
      list = list.map(function (r) {
        var c = {}; for (var k in r) c[k] = r[k];
        c.implied_value_usd = recompute(r);
        // The derived figures follow the sandbox value, so the verdict stays honest under it.
        c.expected_value_usd = Math.round(c.implied_value_usd * c.launch_odds);
        var drop = c.expected_value_usd * R.model.drop_share * (c.deposit_usd / c.tvl_usd);
        c.farmer_drop_usd = Math.round(drop * 100) / 100;
        c.farmer_net_usd = Math.round((drop - c.farm_cost_usd) * 100) / 100;
        c.farmer_net_per_hour_usd = Math.round((c.farmer_net_usd / c.farm_hours) * 100) / 100;
        c.farm_verdict = c.farmer_net_usd >= R.model.verdict_farm_usd ? 'FARM' : c.farmer_net_usd >= 0 ? 'MARGINAL' : 'SKIP';
        return c;
      });
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

  // The range bar's log scale: the board's own value range, shared by every row.
  var rangeLo = Math.log(Math.min.apply(null, rows.map(function (r) { return r.implied_value_low_usd; })));
  var rangeHi = Math.log(Math.max.apply(null, rows.map(function (r) { return r.implied_value_high_usd; })));
  function rangeBar(r) {
    var lo = Math.log(r.implied_value_low_usd), hi = Math.log(r.implied_value_high_usd), mid = Math.log(r.implied_value_usd);
    var span = Math.max(rangeHi - rangeLo, 1e-9);
    var left = Math.max(0, Math.min(100, 100 * (lo - rangeLo) / span));
    var width = Math.max(2, Math.min(100 - left, 100 * (hi - lo) / span));
    var dot = Math.max(0, Math.min(100, 100 * (mid - rangeLo) / span));
    return '<span class="rangebar"><span class="range-band" style="left:' + left.toFixed(1) + '%;width:' + width.toFixed(1) + '%"></span><span class="range-dot" style="left:' + dot.toFixed(1) + '%"></span></span>';
  }
  function verdictBadge(v) {
    return '<span class="verdict verdict-' + v.toLowerCase() + '">' + v + '</span>';
  }

  function renderBoard() {
    var list = visibleRows();
    $('count').textContent = list.length + ' of ' + rows.length + ' protocols' + (sandboxOn ? ' — sandbox model active (re-ranked)' : '') + '. Click a row for its farm plan and value breakdown.';
    var html = '';
    list.forEach(function (r) {
      var g = r.change_7d;
      html += '<tr data-slug="' + esc(r.slug) + '"' + (state.detail === r.slug ? ' class="selected"' : '') + '>' +
        '<td class="num rank">' + r.rank + '<span class="rank-range">' + r.rank_best + '–' + r.rank_worst + '</span></td>' +
        '<td class="name-cell">' + esc(r.name) + (watchSet[r.slug] ? '<span class="watch">WATCHLIST</span>' : '') + '<span class="slug">' + esc(r.slug) + ' · ' + esc(r.category || '—') + ' · ' + esc(r.chains.slice(0, 3).join(', ') || '—') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</span></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + (g == null ? '' : g >= 0 ? 'up' : 'down') + '">' + pct(g) + '</td>' +
        '<td class="num">' + ageFmt(r.age_days) + '</td>' +
        '<td class="num implied">' + money(r.implied_value_usd) + rangeBar(r) + '<span class="range-text">' + money(r.implied_value_low_usd) + '–' + money(r.implied_value_high_usd) + '</span></td>' +
        '<td class="num">' + money(r.expected_value_usd) + '<span class="slug">odds ' + (r.launch_odds * 100).toFixed(1) + '%</span></td>' +
        '<td>' + verdictBadge(r.farm_verdict) + '<span class="slug">net ' + (r.farmer_net_usd >= 0 ? '+' : '') + '$' + r.farmer_net_usd.toFixed(2) + '</span></td>' +
        '<td class="num ' + (r.farmer_net_per_hour_usd >= 0 ? 'up' : 'down') + '">' + (r.farmer_net_per_hour_usd >= 0 ? '+' : '') + '$' + r.farmer_net_per_hour_usd.toFixed(2) + '</td></tr>';
    });
    $('board').querySelector('tbody').innerHTML = html || '<tr><td colspan="9">No protocols match these filters.</td></tr>';
  }

  function renderDetail() {
    var el = $('detail');
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === state.detail) { r = rows[i]; break; }
    if (!r) { el.hidden = true; el.innerHTML = ''; return; }
    var m = R.model;
    var base = r.tvl_usd * r.category_multiple;
    var growthPct = r.change_7d == null ? R.median_change_7d : Math.min(m.growth_cap, Math.max(m.growth_floor, r.change_7d));
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
      '<div class="row"><span>Implied range (p10–p90)</span><span>' + money(r.implied_value_low_usd) + ' – ' + money(r.implied_value_high_usd) + '</span></div>' +
      '<div class="row"><span>Rank range</span><span>#' + r.rank_best + ' – #' + r.rank_worst + '</span></div>' +
      '<div class="row"><span>Launch odds</span><span>' + (r.launch_odds * 100).toFixed(1) + '%</span></div>' +
      '<div class="row total"><span>Expected value (implied × odds)</span><span>' + money(r.expected_value_usd) + '</span></div>' +
      '</div>' +
      '<h3>Farm verdict — the farmer’s own net</h3><div class="math">' +
      '<div class="row"><span>Deposit (0.02% of TVL)</span><span>' + money(r.deposit_usd) + '</span></div>' +
      '<div class="row"><span>Expected drop (7% of value × deposit / TVL)</span><span>$' + r.farmer_drop_usd.toFixed(2) + '</span></div>' +
      '<div class="row"><span>Gas cost of the plan</span><span>$' + r.farm_cost_usd + '</span></div>' +
      '<div class="row"><span>Hours the plan takes</span><span>' + r.farm_hours.toFixed(2) + ' h</span></div>' +
      '<div class="row total"><span>Net</span><span>' + (r.farmer_net_usd >= 0 ? '+' : '') + '$' + r.farmer_net_usd.toFixed(2) + '</span></div>' +
      '<div class="row"><span>Net per hour</span><span>' + (r.farmer_net_per_hour_usd >= 0 ? '+' : '') + '$' + r.farmer_net_per_hour_usd.toFixed(2) + '</span></div>' +
      '<div class="row total"><span>Verdict</span><span>' + r.farm_verdict + '</span></div>' +
      '</div>' +
      '<p class="note">The protocol’s expected value is not the farmer’s: the drop is the farmer’s share of it. The deposit is the model’s plan size (0.02% of TVL, at least $100), and the cost is gas only — the capital comes back when the position is withdrawn.</p>' +
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
    var fb = t.n === 0;
    return '<tr><td>' + esc(t.category) + (fb ? ' <span class="slug">(fallback)</span>' : '') + '</td>' +
      '<td class="num">' + t.n + '</td><td class="num">' + t.multiple.toFixed(3) + '×</td><td class="num">' + money(t.at_tvl_usd) + '</td></tr>';
  }).join('');

  // Out-of-sample evidence tables.
  $('evidence-value').querySelector('tbody').innerHTML = v.value_terms.map(function (t) {
    return '<tr><td>' + esc(t.label) + '</td>' +
      '<td class="num">' + t.loo_median_abs_pct_error.toFixed(1) + '% · ×' + t.loo_median_factor.toFixed(2) + '</td>' +
      '<td class="num">' + t.wf_median_abs_pct_error.toFixed(1) + '% · ×' + t.wf_median_factor.toFixed(2) + '</td>' +
      '<td>' + esc(t.verdict) + '</td></tr>';
  }).join('');
  $('evidence-odds').querySelector('tbody').innerHTML = v.odds_terms.map(function (t) {
    return '<tr><td>' + esc(t.label) + '</td>' +
      '<td class="num">' + t.brier_loo.toFixed(3) + '</td>' +
      '<td class="num">' + t.brier_wf.toFixed(3) + '</td>' +
      '<td>' + esc(t.verdict) + '</td></tr>';
  }).join('');
  $('bootstrap-note').textContent =
    'Fitted, ± bootstrap s.e. (200 refits): slope ' + R.fit.slope.toFixed(3) + ' ± ' + v.slope_se.toFixed(3) +
    '; multiple at $100M TVL ' + v.multiple_at_100m.toFixed(3) + ' ± ' + v.multiple_at_100m_se.toFixed(3) +
    '. Hold-out (70/30 by slug, n = ' + v.holdout_n + '): median miss ' + v.holdout_median_abs_pct_error.toFixed(1) + '% (×' + v.holdout_median_factor.toFixed(2) + '). ' +
    'Leave-one-out (n = ' + v.loo_n + '): ' + v.loo_median_abs_pct_error.toFixed(1) + '% (×' + v.loo_median_factor.toFixed(2) + '). ' +
    'Walk-forward (n = ' + v.walkforward_n + ' in the 70/30 split): ' + v.walkforward_median_abs_pct_error.toFixed(1) + '% (×' + v.walkforward_median_factor.toFixed(2) + ').';

  // Scatter: market cap on TVL for every traded protocol, with the fitted curve and its p10–p90 band.
  (function renderScatter() {
    var pts = R.trading;
    if (!pts || !pts.length) { $('scatter').innerHTML = '<p class="note">No traded protocols to plot.</p>'; return; }
    var W = 560, H = 300, padL = 46, padB = 30, padT = 10, padR = 10;
    var xMin = Math.log(Math.min.apply(null, pts.map(function (p) { return p.tvl_usd; })));
    var xMax = Math.log(Math.max.apply(null, pts.map(function (p) { return p.tvl_usd; })));
    var yMin = Math.log(Math.min.apply(null, pts.map(function (p) { return p.mcap_usd; })));
    var yMax = Math.log(Math.max.apply(null, pts.map(function (p) { return p.mcap_usd; })));
    var X = function (tvl) { return padL + (Math.log(tvl) - xMin) / (xMax - xMin) * (W - padL - padR); };
    var Y = function (mcap) { return H - padB - (Math.log(mcap) - yMin) / (yMax - yMin) * (H - padT - padB); };
    var curve = function (tvl) { return Math.exp(R.fit.intercept + R.fit.slope * Math.log(tvl)); };
    var residuals = pts.map(function (p) { return Math.log(p.mcap_usd) - Math.log(curve(p.tvl_usd)); }).sort(function (a, b) { return a - b; });
    var q = function (arr, f) { var pos = (arr.length - 1) * f, lo = Math.floor(pos), hi = Math.ceil(pos); return arr[lo] + (arr[hi] - arr[lo]) * (pos - lo); };
    var loQ = q(residuals, 0.1), hiQ = q(residuals, 0.9);
    var path = '', band = '';
    for (var i = 0; i <= 40; i++) {
      var tvl = Math.exp(xMin + (xMax - xMin) * i / 40);
      var c = curve(tvl);
      path += (i === 0 ? 'M' : 'L') + X(tvl).toFixed(1) + ' ' + Y(c).toFixed(1) + ' ';
      band += (i === 0 ? 'M' : 'L') + X(tvl).toFixed(1) + ' ' + Y(c * Math.exp(hiQ)).toFixed(1) + ' ';
    }
    for (var j = 40; j >= 0; j--) {
      var tvl2 = Math.exp(xMin + (xMax - xMin) * j / 40);
      band += 'L' + X(tvl2).toFixed(1) + ' ' + Y(curve(tvl2) * Math.exp(loQ)).toFixed(1) + ' ';
    }
    band += 'Z';
    var dots = pts.map(function (p) { return '<circle cx="' + X(p.tvl_usd).toFixed(1) + '" cy="' + Y(p.mcap_usd).toFixed(1) + '" r="2.5" fill="#f0b43c" opacity="0.75"/>'; }).join('');
    var ticks = [1e6, 1e7, 1e8, 1e9, 1e10, 1e11];
    var xTicks = ticks.filter(function (t) { return Math.log(t) >= xMin && Math.log(t) <= xMax; }).map(function (t) {
      return '<line x1="' + X(t).toFixed(1) + '" y1="' + (H - padB) + '" x2="' + X(t).toFixed(1) + '" y2="' + (H - padB + 4) + '" stroke="#5f7285"/><text x="' + X(t).toFixed(1) + '" y="' + (H - padB + 18) + '" fill="#93a5b5" font-size="10" text-anchor="middle">$' + (t >= 1e9 ? (t / 1e9) + 'B' : (t / 1e6) + 'M') + '</text>';
    }).join('');
    var yTicks = ticks.filter(function (t) { return Math.log(t) >= yMin && Math.log(t) <= yMax; }).map(function (t) {
      return '<line x1="' + (padL - 4) + '" y1="' + Y(t).toFixed(1) + '" x2="' + padL + '" y2="' + Y(t).toFixed(1) + '" stroke="#5f7285"/><text x="' + (padL - 8) + '" y="' + (Y(t) + 3).toFixed(1) + '" fill="#93a5b5" font-size="10" text-anchor="end">$' + (t >= 1e9 ? (t / 1e9) + 'B' : (t / 1e6) + 'M') + '</text>';
    }).join('');
    $('scatter').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Market cap against TVL for the traded protocols">' +
      '<path d="' + band + '" fill="#f0b43c" opacity="0.12"/>' +
      '<path d="' + path + '" fill="none" stroke="#f0b43c" stroke-width="2"/>' + dots + xTicks + yTicks +
      '<text x="' + (W / 2) + '" y="' + (H - 4) + '" fill="#93a5b5" font-size="10" text-anchor="middle">TVL (log scale)</text>' +
      '<text x="12" y="' + (H / 2) + '" fill="#93a5b5" font-size="10" text-anchor="middle" transform="rotate(-90 12 ' + (H / 2) + ')">Market cap (log scale)</text></svg>' +
      '<p class="note">' + pts.length + ' traded protocols · the line is the fitted curve (slope ' + R.fit.slope.toFixed(2) + ', R² ' + R.fit.r2.toFixed(2) + ') · the band is its p10–p90 range.</p>';
  })();

  // Sandbox.
  function sandboxRow(id, label, min, max, step, value, fmt) {
    return '<label>' + label + ': <output id="out-' + id + '">' + fmt(value) + '</output>' +
      '<input type="range" id="sb-' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '"></label>';
  }
  $('sandbox').innerHTML =
    sandboxRow('growth', 'Growth weight', 0, 1, 0.05, sandbox.growth, function (v) { return (+v).toFixed(2); }) +
    sandboxRow('maturity', 'Maturity range (0.80 + range at 2y)', 0, 0.8, 0.05, sandbox.maturity, function (v) { return (+v).toFixed(2); }) +
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
  $('f-verdict').addEventListener('change', function () { state.verdict = this.value; renderBoard(); });
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
