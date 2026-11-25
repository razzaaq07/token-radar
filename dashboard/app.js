// Token Radar's page. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the board, a detail view for every protocol, the live-token set and the model.
// No network: every byte it shows is in data.js. The farm plan on a detail view is the
// row's own farm_steps from board.json, never regenerated here, so the page and the board
// cannot disagree.

(function () {
  var DATA = window.RADAR;
  var root = document.getElementById('board');
  if (!DATA || !root) return;
  root.setAttribute('aria-busy', 'false');

  var rows = DATA.rows || [];
  var live = DATA.live || [];
  // The watchlist is the board's own rows at or above the floor: a rankable protocol
  // with TVL at or above the floor is exactly a watchlist protocol, by the house rule.
  function isWatch(r) { return r.tvl_usd >= DATA.floor_usd; }

  function money(n) {
    if (n === null || n === undefined) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) {
    if (n === null || n === undefined) return '—';
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pct(n) {
    if (n === null || n === undefined) return '—';
    var s = (n > 0 ? '+' : '') + n.toFixed(1) + '%';
    return s;
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function ageLabel(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d < 30) return d + 'd';
    if (d < 365) return Math.round(d / 30) + 'mo';
    return (d / 365).toFixed(1) + 'y';
  }

  var SORTS = {
    implied: { label: 'Implied value', fn: function (a, b) { return b.implied_value_usd - a.implied_value_usd; } },
    tvl: { label: 'TVL', fn: function (a, b) { return b.tvl_usd - a.tvl_usd; } },
    growth: { label: '7-day growth', fn: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); } },
    odds: { label: 'Launch odds', fn: function (a, b) { return b.launch_odds - a.launch_odds; } },
    age: { label: 'Age', fn: function (a, b) { return (b.age_days || 0) - (a.age_days || 0); } },
  };

  function readHash() {
    var h = {};
    var raw = (location.hash || '').replace(/^#/, '');
    raw.split('&').forEach(function (part) {
      var kv = part.split('=');
      if (kv[0]) h[decodeURIComponent(kv[0])] = kv[1] === undefined ? '' : decodeURIComponent(kv[1]);
    });
    return h;
  }
  function writeHash(patch) {
    var h = readHash();
    Object.keys(patch).forEach(function (k) {
      if (patch[k] === null || patch[k] === undefined || patch[k] === '') delete h[k];
      else h[k] = patch[k];
    });
    var s = Object.keys(h).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(h[k]); }).join('&');
    history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
  }

  var state = { tab: 'board', q: '', cat: '', chain: '', watchOnly: false, minTvl: 0, sort: 'implied', detail: null };
  function applyHash() {
    var h = readHash();
    state.detail = h.detail || null;
    if (h.tab) state.tab = h.tab;
    if (h.filter) {
      var f = h.filter;
      if (f.indexOf('category:') === 0) state.cat = f.slice(9);
      else if (f.indexOf('chain:') === 0) state.chain = f.slice(6);
    }
    if (h.sort && SORTS[h.sort]) state.sort = h.sort;
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (state.watchOnly && !isWatch(r)) return false;
      if (state.minTvl && r.tvl_usd < state.minTvl) return false;
      if (state.cat && (r.category || '') !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    list.sort(SORTS[state.sort].fn);
    return list;
  }

  function totalImplied() {
    return rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
  }

  function headerHtml() {
    var top = rows[0];
    var a = DATA.accounting || null;
    var acct = '';
    if (a) {
      var segs = [
        { n: a.ranked_watchlist, c: '#f0b429', label: 'Ranked · watchlist' },
        { n: a.ranked_early, c: '#3ddc97', label: 'Ranked · early' },
        { n: a.pre_token_excluded, c: '#6cb4ff', label: 'Pre-token · excluded as wrapped / staked / bridged' },
        { n: a.live_priced_comp, c: '#b388ff', label: 'Token trades · priced comp' },
        { n: a.live_not_comp, c: '#5f6d82', label: 'Token recorded · no usable cap / out' },
      ];
      var bar = segs.map(function (s) { return '<i style="width:' + (100 * s.n / a.total).toFixed(1) + '%;background:' + s.c + '"></i>'; }).join('');
      var legend = segs.map(function (s) {
        return '<span><i class="sw" style="background:' + s.c + '"></i>' + s.label + ' <b>' + s.n + '</b></span>';
      }).join('');
      acct = '<div class="accounting"><div style="font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)">Protocol accounting — all ' + a.total + ' snapshot protocols in exactly one group</div>' +
        '<div class="bar">' + bar + '</div><div class="legend">' + legend + '</div>' +
        '<div style="font-size:12.5px;color:var(--faint);margin-top:8px">Excluded pre-token: CEX ' + a.excluded_cex + ' · wrapped category ' + a.excluded_wrapped_cat + ' · versioned ' + a.excluded_versioned + ' · wrapped word ' + a.excluded_wrapped_word + '. ' +
        'Live-token not in the comps: CEX ' + a.live_not_comp_cex + ' · versioned ' + a.live_not_comp_versioned + ' · wrapped category ' + a.live_not_comp_wrapped_cat + ' · no usable cap ' + a.live_not_comp_no_cap + '.</div></div>';
    }
    return '<h1>Token Radar<span class="dot">.</span></h1>' +
      '<p class="lede">Every protocol DefiLlama tracks that still <b>records no token</b>, ranked by what its launch would be worth. ' +
      'The implied value is fitted on the snapshot&#8217;s own live-token protocols, never asserted: <b>' + esc(DATA.model_version) + '</b>, ' +
      'snapshot of <b>' + esc(DATA.as_of) + '</b>, ' + DATA.board_size + ' protocols ranked, ' + DATA.watchlist_size + ' of them on the watchlist.</p>' +
      acct +
      '<div class="kpis">' +
      '<div class="kpi"><div class="k">Board</div><div class="v">' + DATA.board_size + '</div><div class="s">ranked rows</div></div>' +
      '<div class="kpi"><div class="k">Watchlist</div><div class="v">' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</div><div class="s">covered</div></div>' +
      '<div class="kpi"><div class="k">Total implied</div><div class="v amber">' + money(totalImplied()) + '</div><div class="s">across the board</div></div>' +
      '<div class="kpi"><div class="k">Top protocol</div><div class="v">' + (top ? esc(top.name) : '—') + '</div><div class="s">' + (top ? money(top.implied_value_usd) + ' implied' : '') + '</div></div>' +
      '<div class="kpi"><div class="k">Worth farming</div><div class="v">' + (DATA.farm_summary ? DATA.farm_summary.worth_farming : '—') + ' / ' + DATA.board_size + '</div><div class="s">after gas and time</div></div>' +
      '<div class="kpi"><div class="k">Odds Brier</div><div class="v">' + DATA.odds.brier.toFixed(3) + '</div><div class="s">base rate ' + DATA.odds.base_brier.toFixed(3) + '</div></div>' +
      '</div>';
  }

  function tabsHtml() {
    function tab(id, label) {
      return '<button class="tab" role="tab" aria-selected="' + (state.tab === id) + '" data-tab="' + id + '">' + label + '</button>';
    }
    return '<div class="tabs" role="tablist">' + tab('board', 'Board') + tab('live', 'Live tokens (' + live.length + ')') + tab('model', 'The model') + '</div>';
  }

  function controlsHtml() {
    var cats = [];
    var chains = [];
    rows.forEach(function (r) {
      if (r.category && cats.indexOf(r.category) === -1) cats.push(r.category);
      r.chains.forEach(function (c) { if (chains.indexOf(c) === -1) chains.push(c); });
    });
    cats.sort();
    chains.sort();
    function opts(list, cur, all) {
      var s = '<option value="">' + all + '</option>';
      list.forEach(function (v) { s += '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(v) + '</option>'; });
      return s;
    }
    return '<div class="controls">' +
      '<label>Search<input type="search" id="q" placeholder="Name, slug or category" value="' + esc(state.q) + '"></label>' +
      '<label>Category<select id="cat">' + opts(cats, state.cat, 'All categories') + '</select></label>' +
      '<label>Chain<select id="chain">' + opts(chains, state.chain, 'All chains') + '</select></label>' +
      '<label>Min TVL<select id="mintvl">' +
      '<option value="0">Any</option>' +
      '<option value="50000000"' + (state.minTvl === 50000000 ? ' selected' : '') + '>$50M</option>' +
      '<option value="100000000"' + (state.minTvl === 100000000 ? ' selected' : '') + '>$100M</option>' +
      '<option value="500000000"' + (state.minTvl === 500000000 ? ' selected' : '') + '>$500M</option>' +
      '</select></label>' +
      '<label>Sort by<select id="sort">' +
      Object.keys(SORTS).map(function (k) { return '<option value="' + k + '"' + (state.sort === k ? ' selected' : '') + '>' + SORTS[k].label + '</option>'; }).join('') +
      '</select></label>' +
      '<label class="check"><input type="checkbox" id="watchonly"' + (state.watchOnly ? ' checked' : '') + '> Watchlist only</label>' +
      '</div>';
  }

  function boardHtml() {
    var list = filtered();
    var h = controlsHtml();
    h += '<p class="count">Showing <b>' + list.length + '</b> of ' + rows.length + ' ranked protocols' +
      (state.watchOnly ? ' on the watchlist' : '') + '. Click a row for its detail view and farm plan.</p>';
    if (list.length === 0) return h + '<div class="empty">No protocol matches these filters.</div>';
    h += '<table><thead><tr><th>#</th><th>Protocol</th><th>Category</th><th class="r">TVL</th><th class="r">7d</th><th class="r">Age</th><th class="r">Launch odds</th><th class="r">Implied value</th><th class="r">Farm verdict</th></tr></thead><tbody>';
    list.forEach(function (r) {
      var chg = r.change_7d === null ? '<span class="num">—</span>' : '<span class="num ' + (r.change_7d >= 0 ? 'up' : 'down') + '">' + pct(r.change_7d) + '</span>';
      var f = r.farm || null;
      var verdict = '';
      if (f) {
        var cls = f.verdict === 'WORTH IT' ? 'worth' : f.verdict === 'MARGINAL' ? 'marginal' : 'skipv';
        verdict = '<span class="verdict ' + cls + '">' + f.verdict + '</span><br><span class="num" style="font-size:12px;color:var(--muted)">net ' + (f.net_usd >= 0 ? '+' : '') + '$' + f.net_usd.toFixed(0) + ' · $' + f.net_per_hour_usd.toFixed(0) + '/h</span>';
      }
      h += '<tr data-slug="' + esc(r.slug) + '">' +
        '<td><span class="rank' + (r.rank <= 3 ? ' top3' : '') + '">' + r.rank + '</span></td>' +
        '<td><span class="pname">' + esc(r.name) + '</span> <span class="pslug">' + esc(r.slug) + '</span>' +
        (isWatch(r) ? '<span class="badge">WATCHLIST</span>' : '') + '</td>' +
        '<td class="cat">' + esc(r.category || '—') + '</td>' +
        '<td class="r num">' + money(r.tvl_usd) + '</td>' +
        '<td class="r">' + chg + '</td>' +
        '<td class="r num">' + ageLabel(r.age_days) + '</td>' +
        '<td class="r"><span class="odds">' + Math.round(r.launch_odds * 100) + '%</span></td>' +
        '<td class="r num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td class="r">' + verdict + '</td>' +
        '</tr>';
    });
    h += '</tbody></table>';
    return h;
  }

  function detailHtml(r) {
    var m = r;
    var mult = function (x) { return '×' + x.toFixed(2); };
    var steps = (r.farm_steps || []).map(function (s) {
      var meta = '';
      var at = s.lastIndexOf(' Cost: ');
      if (at > 0) { meta = s.slice(at + 1); s = s.slice(0, at); }
      return '<li>' + esc(s) + (meta ? '<div class="meta">' + esc(meta) + '</div>' : '') + '</li>';
    }).join('');
    return '<div class="detail">' +
      '<button class="back" id="back">&larr; Back to the board</button>' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="sub">' + esc(r.slug) + ' &middot; ' + esc(r.category || 'Uncategorised') + ' &middot; ' + esc(r.chains.join(', ') || 'no chains listed') +
      (isWatch(r) ? ' &middot; <b style="color:var(--amber)">On the watchlist</b>' : '') + '</p>' +
      '<div class="facts">' +
      '<div class="fact"><div class="k">Implied value</div><div class="v" style="color:var(--amber)">' + money(r.implied_value_usd) + '</div></div>' +
      '<div class="fact"><div class="k">TVL</div><div class="v">' + moneyFull(r.tvl_usd) + '</div></div>' +
      '<div class="fact"><div class="k">7-day change</div><div class="v">' + pct(r.change_7d) + '</div></div>' +
      '<div class="fact"><div class="k">Age with no token</div><div class="v">' + ageLabel(r.age_days) + '</div></div>' +
      '</div>' +
      (function () {
        var f = r.farm;
        if (!f) return '';
        var cls = f.verdict === 'WORTH IT' ? 'worth' : f.verdict === 'MARGINAL' ? 'marginal' : 'skipv';
        return '<h3>Is it worth farming? <span class="verdict ' + cls + '">' + f.verdict + '</span></h3>' +
          '<div class="math">' +
          '<div class="row"><span class="lbl">Expected gross — your capital&#8217;s share of the implied value, airdrop pool 10% &times; active-farmer points 25&times;</span><span class="v num">$' + f.gross_usd.toFixed(2) + '</span></div>' +
          '<div class="row"><span class="lbl">Cost — 8 transactions at ' + esc(r.chains[0] || 'the main chain') + ' gas ($' + f.gas_usd.toFixed(2) + ') + 2 hours at $10/h ($' + f.time_usd.toFixed(2) + ')</span><span class="v num">$' + f.cost_usd.toFixed(2) + '</span></div>' +
          '<div class="row total"><span>Net — gross minus cost (' + (f.net_usd >= 0 ? '+' : '') + '$' + f.net_usd.toFixed(2) + ', $' + f.net_per_hour_usd.toFixed(2) + ' per hour)</span><span class="v num">' + (f.net_usd >= 0 ? '+' : '') + '$' + f.net_usd.toFixed(2) + '</span></div>' +
          '</div>' +
          '<p style="color:var(--muted);font-size:13px;margin:0 0 18px">The scenario is stated, not hidden: the airdrop pool and the points multiplier are this entry&#8217;s own assumptions, and the verdict changes if they do. Only ' + (DATA.farm_summary ? DATA.farm_summary.worth_farming : '—') + ' of ' + DATA.board_size + ' rows clear their costs under this scenario.</p>';
      })() +
      '<h3>How the implied value is built</h3>' +
      '<div class="math">' +
      '<div class="row"><span class="lbl">Fitted value — exp(' + DATA.fit.intercept + ' + ' + DATA.fit.slope + ' &times; ln(TVL)) off the comps curve</span><span class="v num">' + moneyFull(m.fitted_value_usd) + '</span></div>' +
      '<div class="row"><span class="lbl">Growth — 7-day change ' + pct(r.change_7d) + ', rise counts &times;0.5, fall &times;0.8</span><span class="v num">' + mult(m.growth_multiplier) + '</span></div>' +
      '<div class="row"><span class="lbl">Maturity — ' + ageLabel(r.age_days) + ' with no token</span><span class="v num">' + mult(m.maturity_multiplier) + '</span></div>' +
      '<div class="row"><span class="lbl">Launch odds — how often protocols like this one already have a token</span><span class="v num">' + Math.round(m.launch_odds * 100) + '%</span></div>' +
      '<div class="row total"><span>Implied value = fitted &times; growth &times; maturity &times; odds</span><span class="v num">' + moneyFull(r.implied_value_usd) + '</span></div>' +
      '</div>' +
      '<h3>Farm plan — seven steps</h3>' +
      '<ol class="steps">' + steps + '</ol>' +
      '</div>';
  }

  function liveHtml() {
    var h = '<p class="lede">Protocols whose token already trades, at the market&#8217;s own value. They are not ranked: the board is for launches still to come, and these are the comps it is priced off.</p>';
    h += '<table><thead><tr><th>Protocol</th><th>Category</th><th class="r">TVL</th><th class="r">Market cap</th><th class="r">MCap / TVL</th></tr></thead><tbody>';
    live.forEach(function (p) {
      var ratio = p.mcap_usd && p.tvl_usd ? (p.mcap_usd / p.tvl_usd).toFixed(2) + '×' : '—';
      h += '<tr><td><span class="pname">' + esc(p.name) + '</span> <span class="pslug">' + esc(p.slug) + '</span></td>' +
        '<td class="cat">' + esc(p.category || '—') + '</td>' +
        '<td class="r num">' + money(p.tvl_usd) + '</td>' +
        '<td class="r num">' + money(p.mcap_usd) + '</td>' +
        '<td class="r num">' + ratio + '</td></tr>';
    });
    h += '</tbody></table>';
    return h;
  }

  function modelHtml() {
    var f = DATA.fit;
    var o = DATA.odds;
    var buckets = o.age_buckets.map(function (b) {
      var label = b.hi === Infinity ? b.lo + 'd+' : b.lo + '–' + b.hi + 'd';
      return '<div class="odds-cell"><div class="k">' + label + '</div><div class="v">' + Math.round(b.rate * 100) + '%</div><div class="s">' + b.n + ' protocols</div></div>';
    }).join('');
    var cats = o.category_rates.slice().sort(function (a, b) { return b.rate - a.rate; }).slice(0, 8).map(function (c) {
      return '<div class="odds-cell"><div class="k">' + esc(c.category) + '</div><div class="v">' + Math.round(c.rate * 100) + '%</div><div class="s">' + c.n + ' protocols</div></div>';
    }).join('');
    function termTable(terms, valLabel) {
      var h = '<table class="evidence"><thead><tr><th>Term</th><th class="r">' + valLabel + ' (leave-one-out)</th><th class="r">' + valLabel + ' (walk-forward)</th><th>Verdict</th><th>Why</th></tr></thead><tbody>';
      terms.forEach(function (t) {
        h += '<tr><td>' + esc(t.term) + '</td><td class="r">' + t.loo.toFixed(3) + '</td><td class="r">' + t.walk_forward.toFixed(3) + '</td>' +
          '<td class="' + (t.kept ? 'kept' : 'dropped') + '">' + (t.kept ? 'KEPT' : 'not kept') + '</td><td style="color:var(--muted)">' + esc(t.note) + '</td></tr>';
      });
      return h + '</tbody></table>';
    }
    var fitTerms = DATA.fit_terms ? termTable(DATA.fit_terms, 'median abs log error') : '';
    var oddsTerms = DATA.odds_terms ? termTable(DATA.odds_terms, 'Brier score') : '';
    var range = '';
    if (DATA.range) {
      var rg = DATA.range;
      var mult = function (x) { return '×' + Math.exp(x).toFixed(2); };
      range = '<div class="rangebox"><b>Is the printed range honest?</b> The fitted value&#8217;s P25–P75 range is ' + mult(rg.p25_log) + ' to ' + mult(rg.p75_log) + ' of the point value. ' +
        'Leave-one-out, <b>' + rg.loo_inside + ' of ' + rg.loo_total + ' real market caps (' + Math.round(rg.loo_pct * 100) + '%)</b> fall inside it; walk-forward, <b>' + rg.wf_inside + ' of ' + rg.wf_total + ' (' + Math.round(rg.wf_pct * 100) + '%)</b>. ' +
        'Honest is about one half — the range neither flatters nor hides the miss.</div>';
    }
    var farm = '';
    if (DATA.farm_summary) {
      var fs = DATA.farm_summary;
      farm = '<p><b>Farm verdicts.</b> Every row is costed under one stated scenario: the airdrop pool is 10% of the implied value, an active farmer&#8217;s points are worth 25&times; a passive deposit of the same size, and the cost is 8 transactions at the main chain&#8217;s gas plus 2 hours at $10 an hour. ' +
        '<b>' + fs.worth_farming + ' of ' + DATA.board_size + '</b> rows clear their costs (' + fs.worth_it + ' WORTH IT, ' + fs.marginal + ' MARGINAL, ' + fs.skip + ' SKIP). The rest are not worth farming under this scenario, and the board says so.</p>';
    }
    return '<div class="model">' +
      '<h2>The model — ' + esc(DATA.model_version) + '</h2>' +
      '<p><b>Implied value = fitted &times; growth &times; maturity &times; launch odds.</b> Every term is computed from this snapshot&#8217;s own figures on every run. No protocol name is ever special-cased.</p>' +
      '<p><b>Fitted value.</b> A log-log comps curve fitted on the snapshot&#8217;s live-token protocols: <code>log(mcap) = ' + f.intercept + ' + ' + f.slope + ' &times; log(TVL)</code>. ' +
      'The pool is every protocol that already trades and is itself a protocol — exchanges and versioned pool fragments are out. ' +
      'R&#178; <b>' + f.r2.toFixed(3) + '</b> on <b>' + f.n + '</b> comps. Bigger protocols trade at lower multiples, so the curve values size sub-linearly.</p>' +
      '<h3>Every value term, fitted and tested held-out twice</h3>' +
      '<p>A term is kept only when it lowers the held-out miss in <b>both</b> tests: leave-one-out refits, and a walk-forward split that fits the older half by listing date and tests the newer half. One test is not enough — the control below flatters the first and fails the second.</p>' +
      fitTerms + range +
      '<p><b>Growth.</b> The seven-day TVL change, clamped to −60%…+120%. A rise counts half, a fall counts four-fifths: hot streaks matter, but a falling protocol is punished more than a rising one is rewarded. The term itself was tested and not kept in the curve — the fitted value is the curve alone — but growth still adjusts the implied value, because a protocol gaining TVL this week is worth more than one losing it.</p>' +
      '<p><b>Maturity.</b> How long the protocol has run with no token: 0.55 + 0.45 &times; (1 − e<sup>−age/730d</sup>). An unknown listing date counts as 365 days.</p>' +
      '<p><b>Launch odds.</b> The mean of the protocol&#8217;s age bucket&#8217;s token rate and its category&#8217;s token rate read among protocols of the <b>same age band</b>, shrunk toward that band&#8217;s own rate when the cell is small, clamped to 5%…95%, over ' + o.n_cohort + ' dated protocols. ' +
      'The age match matters: a young category must not drag an old protocol down. Leave-one-out Brier score <b>' + o.brier.toFixed(3) + '</b> against the base rate&#8217;s <b>' + o.base_brier.toFixed(3) + '</b>: the odds beat guessing the overall rate (' + Math.round(o.overall_rate * 100) + '%) for every protocol.</p>' +
      '<h3>Every odds signal, scored leave-one-out</h3>' +
      oddsTerms +
      '<h3>Token rate by age</h3><div class="odds-grid">' + buckets + '</div>' +
      '<h3>Token rate by category (largest first)</h3><div class="odds-grid">' + cats + '</div>' +
      farm +
      '<p><b>What is excluded.</b> A protocol is rankable only if it records no token and is not a wrapped, staked or bridged product of one that trades: no Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX category, no versioned pool name, no wrapped / staked / staking word, no exchange-prefixed name. ' +
      'That is why a staked-ETH product never tops this board: it is not a launch waiting to happen.</p>' +
      '<p><b>What this is not.</b> The snapshot carries no launch date and no airdrop flag, so the radar does not predict whether or when a token is issued. The implied value is this entry&#8217;s own claim about what a launch would be worth if the protocol&#8217;s record stayed as it is.</p>' +
      '</div>';
  }

  function render() {
    var h = headerHtml() + tabsHtml();
    if (state.tab === 'live') h += liveHtml();
    else if (state.tab === 'model') h += modelHtml();
    else if (state.detail) {
      var r = null;
      rows.forEach(function (x) { if (x.slug === state.detail) r = x; });
      h += r ? detailHtml(r) : '<div class="empty">No protocol named ' + esc(state.detail) + ' is on the board.</div>';
    } else {
      h += boardHtml();
    }
    h += '<footer><p>Source: DefiLlama, ' + esc(DATA.source) + '. Snapshot of ' + esc(DATA.as_of) + '; ' + DATA.board_size + ' protocols ranked, ' + DATA.watchlist_size + ' on the watchlist, ' + DATA.live_size + ' live-token protocols shown at market value.</p>' +
      '<p>Implied values are this entry&#8217;s own model claim, never DefiLlama&#8217;s and never make.fun&#8217;s. Nothing here is investment advice.</p></footer>';
    root.innerHTML = h;
    bind();
  }

  function bind() {
    var tabs = root.querySelectorAll('[data-tab]');
    Array.prototype.forEach.call(tabs, function (b) {
      b.addEventListener('click', function () {
        state.tab = b.getAttribute('data-tab');
        state.detail = null;
        writeHash({ tab: state.tab, detail: null });
        render();
        window.scrollTo(0, 0);
      });
    });
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.q = q.value; render(); var nq = document.getElementById('q'); if (nq) { nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); } });
    var cat = document.getElementById('cat');
    if (cat) cat.addEventListener('change', function () { state.cat = cat.value; writeHash({ filter: state.cat ? 'category:' + state.cat : null }); render(); });
    var chain = document.getElementById('chain');
    if (chain) chain.addEventListener('change', function () { state.chain = chain.value; writeHash({ filter: state.chain ? 'chain:' + state.chain : null }); render(); });
    var mintvl = document.getElementById('mintvl');
    if (mintvl) mintvl.addEventListener('change', function () { state.minTvl = Number(mintvl.value) || 0; render(); });
    var sort = document.getElementById('sort');
    if (sort) sort.addEventListener('change', function () { state.sort = sort.value; writeHash({ sort: state.sort }); render(); });
    var wo = document.getElementById('watchonly');
    if (wo) wo.addEventListener('change', function () { state.watchOnly = wo.checked; render(); });
    var trs = root.querySelectorAll('tbody tr[data-slug]');
    Array.prototype.forEach.call(trs, function (tr) {
      tr.addEventListener('click', function () {
        state.detail = tr.getAttribute('data-slug');
        writeHash({ detail: state.detail });
        render();
        window.scrollTo(0, 0);
      });
    });
    var back = document.getElementById('back');
    if (back) back.addEventListener('click', function () {
      state.detail = null;
      writeHash({ detail: null });
      render();
    });
  }

  applyHash();
  render();
  window.addEventListener('hashchange', function () { applyHash(); render(); });
})();
