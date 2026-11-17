// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, the filters, and a pinned detail panel for
// the selected protocol. No network: every byte it shows is already in data.js.
//
// The page recomputes each row's implied value from the snapshot figures with the
// same formula main.ts used, and prints whether the recomputed number matches the
// one board.json carries — so a stale dataset would say so on the page itself.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, shown: 40 };
  var PAGE = 40;

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtChains(chains) {
    if (!chains || chains.length === 0) return 'an unnamed chain';
    if (chains.length <= 2) return chains.join(', ');
    return chains.slice(0, 2).join(', ') + ' +' + (chains.length - 2);
  }

  // The model, as main.ts computes it: base 0.30 of TVL, growth clamped to
  // [-50, 200] at weight 0.8, maturity 0.55 + 0.45 over 1095 days, reach
  // +0.03 per extra chain up to ten. Unknown age counts as 365 days.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var extra = Math.min(Math.max((row.chains || []).length - 1, 0), model.reach_max_chains);
    var reach = 1 + model.reach_per_chain * extra;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * reach));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'scope', 'aria-hidden': 'true' }),
        el('span', { class: 'brand-name' }, el('b', { text: 'Token' }), ' Radar — pre-token scope')
      ),
      el('div', { class: 'top-meta' },
        el('span', { class: 'chip' }, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', { class: 'chip' }, 'Source: ', el('b', { text: 'DefiLlama protocol index' })),
        el('span', { class: 'chip' }, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
  }

  function hero() {
    var top = DATA.rows[0];
    return el('section', { class: 'hero' },
      el('h1', null, 'Which pre-token protocol is ', el('span', { class: 'hl', text: 'worth farming next' }), '?'),
      el('p', null,
        'The watchlist is the floor: every protocol with at least ',
        el('b', { text: fmtUsd(DATA.floor_usd) }),
        ' of TVL and no token on record. The early radar adds ',
        el('b', { text: String(DATA.early_size) }),
        ' pre-token protocols below that floor, and ranks all ',
        el('b', { text: String(DATA.board_size) }),
        ' by implied value — what a token would be worth if the protocol kept its record. Implied value is a model, not a price and not a promise that a token launches.'
      ),
      el('p', null, 'Top of the board today: ', el('b', { text: top ? top.name + ' at ' + fmtUsd(top.implied_value_usd) : '—' }), '. Select any row to see its model and farm plan.')
    );
  }

  function stats() {
    return el('section', { class: 'stats', 'aria-label': 'Board totals' },
      el('div', { class: 'stat' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
      el('div', { class: 'stat' }, el('span', { text: 'Pre-token rows' }), el('b', { text: String(DATA.board_size) })),
      el('div', { class: 'stat' }, el('span', { text: 'Early rows, below floor' }), el('b', { text: String(DATA.early_size) })),
      el('div', { class: 'stat' }, el('span', { text: 'Live-token set aside' }), el('b', { text: String(DATA.live_size) }))
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, slug, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; state.shown = PAGE; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; state.shown = PAGE; writeHash(); render(); });
    var chain = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chain.addEventListener('change', function () { state.chain = chain.value; state.shown = PAGE; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; state.shown = PAGE; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Has token', onclick: function () { state.tab = 'live'; state.shown = PAGE; writeHash(); render(); } });
    var countText = state.tab === 'pre-token' ? visibleRows().length + ' of ' + DATA.board_size + ' rows' : DATA.live.length + ' live-token protocols';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chain),
      el('div', { class: 'field' }, el('span', { text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: countText })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ▼' : ' ▲' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortRows(visibleRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.shown = PAGE; writeHash(); render(); } })
      ));
    }
    var max = (sortRows(visibleRows())[0] || { implied_value_usd: 1 }).implied_value_usd || 1;
    var shown = list.slice(0, state.shown);
    var tbody = el('tbody');
    shown.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { selectRow(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRow(r.slug); } }
      },
        el('td', null, el('span', { class: 'rank-badge num', text: String(r.rank) })),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + fmtChains(r.chains) })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'tag', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    var panel = el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols, strongest implied value first. Select a row — its model and farm plan open beside the board.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
    if (list.length > state.shown) {
      panel.appendChild(el('div', { class: 'more' },
        el('button', { type: 'button', text: 'Show more — ' + (list.length - state.shown) + ' rows left', onclick: function () { state.shown += PAGE; render(); } })
      ));
    }
    return panel;
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'rank-badge num', text: 'live' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + fmtChains(r.chains) }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'tag live', text: 'trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function selectRow(slug) {
    state.selected = slug;
    writeHash();
    render();
    var panel = document.getElementById('detail-panel');
    if (panel && window.innerWidth <= 1020) panel.scrollIntoView({ block: 'start' });
  }

  function detailPanel() {
    var row = DATA.rows.filter(function (r) { return r.slug === state.selected; })[0];
    if (!row) {
      var top = DATA.rows[0];
      return el('aside', { class: 'panel detail', id: 'detail-panel' },
        el('div', { class: 'detail-empty' },
          el('span', { class: 'detail-kicker', text: 'Detail view' }),
          el('h2', { text: 'Pick a protocol' }),
          el('p', { text: 'Select any row and its implied-value breakdown and farm plan open here, beside the board.' }),
          top ? el('button', { class: 'button', type: 'button', text: 'Open rank 1 — ' + top.name, onclick: function () { selectRow(top.slug); } }) : null
        )
      );
    }
    var recomputed = impliedOf(row, DATA.model);
    var matches = recomputed === row.implied_value_usd;
    var m = row.model;
    var steps = (row.farm_steps || []).map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
    });
    return el('aside', { class: 'panel detail', id: 'detail-panel' },
      el('div', { class: 'detail-body' },
        el('div', null,
          el('span', { class: 'detail-kicker', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · ' + (row.tvl_usd >= DATA.floor_usd ? 'watchlist' : 'early radar') }),
          el('h2', { text: row.name }),
          el('p', { class: 'sub', text: (row.category || 'Other') + ' · ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · listed ' + (row.listed_at || 'date unknown') })
        ),
        el('div', { class: 'facts-grid' },
          el('div', { class: 'fact-cell wide' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) })),
          el('div', { class: 'fact-cell' }, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
          el('div', { class: 'fact-cell' }, el('span', { text: '7-day growth' }), el('b', { class: row.change_7d === null ? '' : row.change_7d >= 0 ? 'pos' : 'neg', text: fmtPct(row.change_7d) })),
          el('div', { class: 'fact-cell' }, el('span', { text: 'Age, no token' }), el('b', { text: fmtAge(row.age_days) })),
          el('div', { class: 'fact-cell' }, el('span', { text: 'Chains' }), el('b', { text: String((row.chains || []).length) }))
        ),
        el('div', null,
          el('h3', { text: 'How the number is built' }),
          el('div', { class: 'formula-line' },
            'TVL ', el('b', { text: fmtUsd(row.tvl_usd) }), ' × 0.30',
            ' × growth ', el('b', { text: String(m.growth_multiplier) }), ' (', fmtPct(m.growth_pct), ')',
            ' × maturity ', el('b', { text: String(m.maturity_multiplier) }),
            ' × reach ', el('b', { text: String(m.reach_multiplier) }),
            ' = ', el('b', { text: fmtUsd(row.implied_value_usd) })
          ),
          el('p', { class: 'check', text: matches ? '✓ Page recomputes ' + fmtUsd(recomputed) + ' — the same number board.json carries.' : '✗ Page recomputes ' + fmtUsd(recomputed) + ' — differs from the board; the data is stale.' })
        ),
        el('div', null,
          el('h3', { text: 'Farm plan — ' + steps.length + ' steps' }),
          el('ol', { class: 'steps' }, steps)
        ),
        el('p', { class: 'sub', text: 'Records no token — that is what the snapshot says, not proof it has none. Farming is a bet on the protocol, not a guarantee of an airdrop.' })
      )
    );
  }

  function modelSection() {
    var m = DATA.model;
    return el('section', { class: 'section' },
      el('div', { class: 'section-head' },
        el('h2', { text: 'How implied value is computed' }),
        el('p', { text: 'One function scores every row, from the snapshot figures alone. No protocol name is special-cased and no row is hand-picked.' })
      ),
      el('div', { class: 'panel model-panel' },
        el('div', { class: 'formula-line' },
          'implied = round( tvl_usd × ', el('b', { text: String(m.base_multiple) }),
          ' × (1 + clamp(change_7d, ', el('b', { text: String(m.growth_floor) }), ', ', el('b', { text: String(m.growth_cap) }), ') / 100 × ', el('b', { text: String(m.growth_weight) }), ')',
          ' × (', el('b', { text: String(m.maturity_floor) }), ' + min(age_days, ', el('b', { text: String(m.maturity_days) }), ') / ', el('b', { text: String(m.maturity_days) }), ' × ', el('b', { text: String(m.maturity_range) }), ')',
          ' × (1 + ', el('b', { text: String(m.reach_per_chain) }), ' × min(chains − 1, ', el('b', { text: String(m.reach_max_chains) }), ')) )'
        ),
        el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed — the best record of how long it has run with no token on record; an unlisted age counts as ' + m.unknown_age_days + ' days. Reach counts the chains beyond the first, capped at ' + m.reach_max_chains + '. Growth is clamped so one wild week cannot dominate the board. The live-token protocols are set aside with their market caps shown, and the early radar holds the same bar as the watchlist: no CEX, bridge, liquid-staking or wrapped product is ever ranked as a token that might launch.' })
      )
    );
  }

  function liveSection() {
    var cards = DATA.live.slice(0, 8).map(function (r) {
      return el('div', { class: 'live-card' },
        el('b', { text: r.name }),
        el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + fmtChains(r.chains) }),
        el('span', { class: 'num', text: 'mcap ' + fmtUsd(r.mcap_usd) }),
        el('span', { class: 'sub', text: 'TVL ' + fmtUsd(r.tvl_usd) + ' · 7d ' + fmtPct(r.change_7d) })
      );
    });
    return el('section', { class: 'section' },
      el('div', { class: 'section-head' },
        el('h2', { text: 'Already trading — set aside' }),
        el('p', { text: 'The largest live-token protocols by market cap. They are not pre-token, so they take no rank on this board.' })
      ),
      el('div', { class: 'live-strip' }, cards)
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    shell.appendChild(stats());
    shell.appendChild(controls());
    var layout = el('div', { class: 'layout' });
    layout.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    layout.appendChild(detailPanel());
    shell.appendChild(layout);
    if (state.tab === 'pre-token') shell.appendChild(modelSection());
    shell.appendChild(liveSection());
    shell.appendChild(el('footer', { class: 'foot' },
      el('span', { text: 'Token Radar · model ' + DATA.model_version + ' · snapshot ' + DATA.as_of + ' · ' + DATA.board_size + ' pre-token rows, ' + DATA.live_size + ' live-token protocols set aside.' }),
      el('span', { text: 'Implied value is this entry\u2019s own claim from the snapshot\u2019s figures. It is not a price, not a prediction that a token launches, and not financial advice.' })
    ));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
  }

  readHash();
  render();
  // A link to a filtered view or a protocol must work even when the page is
  // already open: re-read the hash and re-render on every change.
  window.addEventListener('hashchange', function () {
    state.q = '';
    state.category = 'all';
    state.chain = 'all';
    state.tab = 'pre-token';
    state.selected = null;
    readHash();
    render();
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected) { state.selected = null; writeHash(); render(); }
  });
})();
