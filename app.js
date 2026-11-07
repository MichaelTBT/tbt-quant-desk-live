// TBT Quant Desk dashboard. Reads state/dashboard.json (written by the bot every hour) and
// research/results/summary.json, then keeps prices live straight from Binance's public API.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAY = 86_400_000;

const S = { d: null, research: null, live: {}, liveAt: 0, range: '30D', tab: 'desk' };

// ---------- formatting ----------
const usd = (x, dp) => {
  if (x == null || !Number.isFinite(x)) return '–';
  const a = Math.abs(x);
  const d = dp ?? (a >= 100_000 ? 0 : 2);
  return `${x < 0 ? '−' : ''}$${a.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
};
const price = (x) => {
  if (!Number.isFinite(x)) return '–';
  if (x >= 1000) return '$' + x.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (x >= 1) return '$' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return '$' + x.toPrecision(4);
};
const pct = (x, dp = 1, sign = true) => (Number.isFinite(x) ? `${sign && x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(dp)}%` : '–');
const signUsd = (x) => (x > 0 ? '+' : '') + usd(x);
const cls = (x) => (x > 1e-9 ? 'up' : x < -1e-9 ? 'down' : 'flat');
const rFmt = (r) => `${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}R`;
// Trading days run on UTC (the daily close is 00:00 UTC), so day-level dates are shown in UTC.
const date = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const dateY = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); if (h < 48) return `${h} h ago`; return `${Math.round(h / 24)} days ago`; };
const PB = { trend: 'Breakout', momentum: 'Momentum', dip: 'Dip buy', dca: 'DCA bot', pump: 'Pump chase' };

function avatar(coin) {
  let h = 0; for (const c of coin) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `<span class="avatar" style="background:hsl(${h % 360} 65% 62%)"><span>${esc(coin.slice(0, 4))}</span><img alt="" loading="lazy" src="https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/${esc(coin.toLowerCase())}.svg" onerror="this.remove()"></span>`;
}

// ---------- data ----------
const DEMO = new URLSearchParams(location.search).has('demo');
// The hosted copy (built by src/live/site.ts) carries <meta name="desk-vault">: its data files are encrypted
// and open with the desk password. Locally (npm run dashboard) the plain JSON files are read directly.
const VAULT = !!document.querySelector('meta[name="desk-vault"]');
const KEY_STORE = 'tbt-desk-key';
let vault = null; let key = null;

async function fetchBin(kind) {
  const r = await fetch(`data/${kind}.bin?ts=${Date.now()}`, { cache: 'no-store' });
  return r.ok ? r.arrayBuffer() : null;
}
async function getData(kind) {
  if (VAULT) { const buf = await fetchBin(kind); return buf ? vault.open(key, buf) : null; }
  const url = { desk: `../state/dashboard.json?ts=${Date.now()}`, research: '../research/results/summary.json', demo: '../research/results/demo-dashboard.json' }[kind];
  const r = await fetch(url, { cache: 'no-store' });
  return r.ok ? r.json() : null;
}
async function loadState() {
  const d = await getData(DEMO ? 'demo' : 'desk');
  if (!d) throw new Error(DEMO ? 'No demo data. Run `node research/scripts/demo.ts`.' : VAULT ? 'The desk data is not published yet. Check back after the next hourly run.' : 'No dashboard data yet. Run `npm run tick` once.');
  S.d = d;
}
async function loadResearch() {
  try { S.research = await getData('research'); } catch { /* optional */ }
}

// Hosted copy: use the key remembered on this device if it still opens the data, otherwise ask for the password.
// Only the derived key is stored (never the password); "Lock this device" forgets it.
async function unlock() {
  vault = await import('./vault.js');
  const buf = await fetchBin(DEMO ? 'demo' : 'desk');
  if (!buf) throw new Error('The desk data is not published yet. Check back after the next hourly run.');
  const salt = vault.saltOf(buf);
  try {
    const saved = JSON.parse(localStorage.getItem(KEY_STORE) || 'null');
    if (saved?.salt === salt) { key = await vault.importKey(saved.k); await vault.open(key, buf); return; }
  } catch { key = null; }

  document.body.classList.add('locked');
  const form = document.createElement('form');
  form.className = 'panel unlock';
  form.innerHTML = `<h2>Enter the desk password</h2>
    <p class="muted small">The desk's data is encrypted. It opens only with the password.</p>
    <input class="sr-only" type="text" name="username" autocomplete="username" value="TBT Quant Desk" tabindex="-1" aria-hidden="true">
    <label class="label" for="pw">Password</label>
    <input id="pw" name="password" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false" required>
    <label class="check"><input type="checkbox" id="remember" checked> Remember on this device</label>
    <button class="btn" type="submit">Unlock</button>
    <p class="err" id="pw-err" role="alert"></p>`;
  $('main').prepend(form);
  $('#pw').focus();
  await new Promise((done) => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('button', form); btn.disabled = true; btn.textContent = 'Unlocking…'; $('#pw-err').textContent = '';
      try {
        const k = await vault.deriveKey($('#pw').value, salt);
        await vault.open(k, buf);
        key = k;
        if ($('#remember').checked) { try { localStorage.setItem(KEY_STORE, JSON.stringify({ salt, k: await vault.exportKey(k) })); } catch { /* private mode */ } }
        form.remove(); document.body.classList.remove('locked'); done();
      } catch {
        $('#pw-err').textContent = "That password didn't work. Check it and try again.";
        btn.disabled = false; btn.textContent = 'Unlock'; $('#pw').select();
      }
    };
  });
}
async function refreshPrices() {
  if (!S.d || DEMO) return;
  const syms = Object.keys(S.d.prices);
  if (!syms.length) return;
  try {
    const r = await fetch(`https://data-api.binance.vision/api/v3/ticker/24hr?type=MINI&symbols=${encodeURIComponent(JSON.stringify(syms))}`);
    if (!r.ok) return;
    for (const t of await r.json()) S.live[t.symbol] = { p: +t.lastPrice, ch: +t.openPrice ? +t.lastPrice / +t.openPrice - 1 : 0 };
    S.liveAt = Date.now();
    renderDesk();
  } catch { /* offline: keep the bot's last prices */ }
}
const px = (sym) => S.live[sym]?.p ?? S.d.prices[sym] ?? 0;

// Recompute everything that depends on price with live quotes (the bot itself only acts hourly / at the daily close).
function liveView() {
  const d = S.d;
  const positions = d.board.positions.map((p) => {
    const price = px(p.symbol) || p.price;
    const value = p.qty * price;
    const pnl = p.pnl + (value - p.value);
    return { ...p, price, value, pnl, pnlPct: p.cost ? pnl / p.cost : 0, r: p.r && p.pnl ? p.r * (pnl / p.pnl) : p.r, stopDistPct: p.stop > 0 ? 1 - p.stop / price : null };
  });
  const invested = positions.reduce((a, p) => a + p.value, 0);
  const equity = d.account.cash + invested;
  const btcPx = px('BTCUSDT') || d.regime.btc;
  const regimeLive = d.regime.sma ? btcPx > d.regime.sma : d.regime.on;
  const watch = d.board.watch.filter((w) => !positions.some((p) => p.symbol === w.symbol)).map((w) => {
    const price = px(w.symbol) || w.price;
    const lv = w.levels ?? {};
    const checks = (w.checks ?? []).map((c) => ({ ...c, ok: c.key === 'regime' ? regimeLive : c.key === 'trend' ? price > lv.sma : c.key === 'breakout' ? price > lv.hi : c.ok }));
    const dist = Math.max(0, w.trigger / price - 1);
    return { ...w, price, checks, distancePct: dist, change24h: S.live[w.symbol]?.ch ?? w.change24h, allOk: checks.length && checks.every((c) => c.ok) };
  }).sort((a, b) => (b.allOk - a.allOk) || (a.checks.filter((c) => !c.ok).length - b.checks.filter((c) => !c.ok).length) || a.distancePct - b.distancePct);
  const peak = Math.max(d.account.peak, equity);
  return { positions, equity, invested, btcPx, regimeLive, watch, peak, drawdown: 1 - equity / peak };
}

// ---------- charts ----------
function lineChart(svg, series, opts = {}) {
  const W = svg.clientWidth || 800, H = svg.clientHeight || 240, pad = { l: 58, r: 14, t: 12, b: 24 };
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) { svg.innerHTML = ''; return; }
  const t0 = Math.min(...pts.map((p) => p[0])), t1 = Math.max(...pts.map((p) => p[0]));
  const tf = (v) => (opts.log ? Math.log(v) : v);
  let lo = Math.min(...pts.map((p) => tf(p[1]))), hi = Math.max(...pts.map((p) => tf(p[1])));
  if (hi - lo < (opts.log ? 0.01 : Math.abs(hi) * 0.004 + 1e-9)) { const m = (hi + lo) / 2, span = opts.log ? 0.01 : Math.max(2, Math.abs(m) * 0.01); lo = m - span; hi = m + span; }
  const padY = (hi - lo) * 0.08; lo -= padY; hi += padY;
  const x = (t) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (tf(v) - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const inv = (yy) => { const f = lo + (1 - (yy - pad.t) / (H - pad.t - pad.b)) * (hi - lo); return opts.log ? Math.exp(f) : f; };
  let g = '';
  for (let k = 0; k <= 4; k++) {
    const yy = pad.t + (k / 4) * (H - pad.t - pad.b);
    g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}" stroke="rgba(163,173,187,.1)"/><text x="${pad.l - 8}" y="${yy + 4}" text-anchor="end">${(opts.yFmt ?? usd)(inv(yy))}</text>`;
  }
  const ticks = 5;
  for (let k = 0; k <= ticks; k++) { const t = t0 + (k / ticks) * (t1 - t0); g += `<text x="${x(t)}" y="${H - 6}" text-anchor="${k === 0 ? 'start' : k === ticks ? 'end' : 'middle'}">${(t1 - t0 > 400 * DAY ? dateY : date)(t)}</text>`; }
  for (const s of series) {
    if (!s.points.length) continue;
    const dpath = s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
    if (s.fill) g += `<path d="${dpath}L${x(s.points.at(-1)[0])},${H - pad.b}L${x(s.points[0][0])},${H - pad.b}Z" fill="${s.fill}"/>`;
    g += `<path d="${dpath}" fill="none" stroke="${s.color}" stroke-width="${s.width ?? 2}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
    if (s.dot) { const p = s.points.at(-1); g += `<circle cx="${x(p[0])}" cy="${y(p[1])}" r="4" fill="${s.color}" stroke="#07111f" stroke-width="2"/>`; }
  }
  g += `<line id="${svg.id}-cross" y1="${pad.t}" y2="${H - pad.b}" stroke="rgba(243,245,248,.25)" style="display:none"/>`;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = g;
  const tip = opts.tip;
  if (!tip) return;
  svg.onmousemove = (e) => {
    const rect = svg.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    const t = t0 + ((mx - pad.l) / (W - pad.l - pad.r)) * (t1 - t0);
    const rows = series.filter((s) => s.points.length).map((s) => { let best = s.points[0]; for (const p of s.points) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p; return { s, p: best }; });
    if (!rows.length) return;
    const cross = $(`#${svg.id}-cross`);
    cross.setAttribute('x1', x(rows[0].p[0])); cross.setAttribute('x2', x(rows[0].p[0])); cross.style.display = '';
    tip.style.display = 'block';
    tip.style.left = `${(x(rows[0].p[0]) / W) * rect.width}px`; tip.style.top = `${(y(rows[0].p[1]) / H) * rect.height}px`;
    tip.innerHTML = `<div class="faint">${(t1 - t0 > 400 * DAY ? dateY : (tt) => new Date(tt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' }))(rows[0].p[0])}</div>` + rows.map((r) => `<div><span style="color:${r.s.color}">●</span> ${esc(r.s.name)}: <b>${(opts.yFmt ?? usd)(r.p[1])}</b></div>`).join('');
  };
  svg.onmouseleave = () => { tip.style.display = 'none'; const c = $(`#${svg.id}-cross`); if (c) c.style.display = 'none'; };
}

function spark(values, color) {
  if (!values?.length) return '';
  const W = 110, H = 28, lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / Math.max(1, values.length - 1)) * W).toFixed(1)},${(H - 3 - ((v - lo) / span) * (H - 6)).toFixed(1)}`).join('');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.8"/></svg>`;
}

// ---------- desk view ----------
function renderHero(v) {
  const d = S.d, a = d.account, g = d.goal;
  const pnl = v.equity - a.startCash, pnlPct = v.equity / a.startCash - 1;
  const btcRet = d.btc.start ? v.btcPx / d.btc.start - 1 : 0;
  const prog = Math.max(0, Math.log(v.equity / g.start) / Math.log(g.target / g.start));
  const paceMark = Math.min(1, d.meta.dayN / g.days);
  const mc = S.research?.monteCarlo?.desk;
  const toSma = d.regime.sma ? d.regime.sma / v.btcPx - 1 : 0;
  const dayN = Math.min(g.days, d.meta.dayN + 1);
  const investedPct = v.equity ? v.invested / v.equity : 0;
  const openRisk = v.positions.reduce((s, p) => s + (p.stop > 0 ? Math.max(0, p.qty * (p.price - p.stop)) : p.value), 0);
  $('#hero').innerHTML = `
    <div class="panel">
      <div class="label">Account value</div>
      <div class="big num">${usd(v.equity)}</div>
      <div class="sub"><span class="delta ${cls(pnl)}">${signUsd(pnl)} (${pct(pnlPct)})</span> since ${date(d.meta.startDay)} · started with ${usd(a.startCash, 0)}</div>
      <div class="sub" style="margin-top:6px">Bitcoin since then: <span class="${cls(btcRet)}">${pct(btcRet)}</span> · ${a.trades} closed trade${a.trades === 1 ? '' : 's'}${a.trades ? ` · ${Math.round(a.winRate * 100)}% won` : ''}</div>
    </div>
    <div class="panel">
      <div class="label">Goal: ${usd(g.start, 0)} → ${usd(g.target, 0)} in 12 months</div>
      <div class="mid">Day ${dayN} of ${g.days}</div>
      <div class="goalbar" title="Log scale: halfway is $10,000"><i style="width:${(Math.min(1, prog) * 100).toFixed(2)}%"></i><b style="left:${(paceMark * 100).toFixed(2)}%"></b></div>
      <div class="ticks"><span>$1k</span><span>$10k</span><span>$100k</span></div>
      <div class="sub" style="margin-top:8px">On pace today means <b class="num" style="color:var(--gold)">${usd(g.pace, 0)}</b> (+46.8% every month). ${mc ? `Backtest odds of reaching $100k: <b>${mc.odds['100x'] < 0.001 ? 'under 0.1%' : pct(mc.odds['100x'], 1, false)}</b>; likely range ${usd(1000 * mc.p10, 0)}–${usd(1000 * mc.p90, 0)}.` : ''}</div>
    </div>
    <div class="panel">
      <div class="label">Market regime</div>
      <div class="regime ${v.regimeLive ? 'on' : 'off'}"><span class="chip">${v.regimeLive ? 'RISK-ON' : 'RISK-OFF'}</span></div>
      <div class="sub">Bitcoin <b class="num">${price(v.btcPx)}</b> vs its ${d.regime.smaDays}-day average <b class="num">${price(d.regime.sma)}</b>.</div>
      <div class="sub" style="margin-top:6px">${v.regimeLive
        ? (d.regime.on ? 'Uptrend: the desk may buy breakouts.' : `Above the average right now; the desk turns risk-on if Bitcoin <b>closes</b> above ${price(d.regime.sma)} (00:00 UTC).`)
        : `Downtrend: no new trades.${toSma > 0 ? ` Needs a daily close ${pct(toSma)} higher.` : ''}`}</div>
    </div>
    <div class="panel">
      <div class="label">Where the money is</div>
      <div class="meter" aria-label="Cash versus invested"><i style="width:${(investedPct * 100).toFixed(1)}%;background:var(--green)"></i><i style="width:${((1 - investedPct) * 100).toFixed(1)}%;background:var(--surface-3)"></i></div>
      <div class="kv num"><span>Invested</span><span>${usd(v.invested)} · ${pct(investedPct, 0, false)}</span><span>Cash</span><span>${usd(d.account.cash)}</span><span>At risk if all stops hit</span><span>${usd(openRisk)}</span><span>Drop from peak</span><span class="${v.drawdown > 0.001 ? 'down' : ''}">${pct(-v.drawdown, 1)}</span></div>
    </div>`;
}

function renderChart(v) {
  const d = S.d;
  const daily = d.equity.map((e) => [e[0] + DAY, e[1], e[2]]); // equity is recorded at each day's close
  const intra = d.intraday;
  const firstIntra = intra[0]?.[0] ?? Infinity;
  let pts = [...daily.filter((p) => p[0] < firstIntra), ...intra];
  const nowT = DEMO ? d.generatedAt : Date.now();
  pts.push([nowT, v.equity, v.btcPx]);
  const span = { '7D': 7 * DAY, '30D': 30 * DAY, ALL: Infinity }[S.range];
  pts = pts.filter((p) => p[0] >= Math.max(nowT - span, d.meta.startedAt - 3600_000)).sort((a, b) => a[0] - b[0]);
  if (pts.length === 1) pts.unshift([d.meta.startedAt, d.account.startCash, d.btc.start]);
  const b0 = d.btc.start || pts[0]?.[2];
  const start = d.meta.startDay;
  const goal = pts.map((p) => [p[0], d.goal.start * (d.goal.target / d.goal.start) ** (Math.max(0, p[0] - start) / DAY / d.goal.days)]);
  const series = [
    { name: 'Goal pace', points: goal, color: '#c8a96a', dash: '5 5', width: 1.5 },
    { name: 'Bitcoin, held', points: pts.filter((p) => p[2]).map((p) => [p[0], d.account.startCash * (p[2] / b0)]), color: '#3d94e0', width: 1.6 },
    { name: 'Desk account', points: pts.map((p) => [p[0], p[1]]), color: '#00cc00', width: 2.4, fill: 'rgba(0,204,0,.07)', dot: true },
  ];
  $('#legend').innerHTML = series.slice().reverse().map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('');
  lineChart($('#chart'), series, { tip: $('#tip') });
}

const SHORT = { regime: 'BTC uptrend', trend: 'Above 50-day', breakout: '20-day high' };
function checklist(checks) {
  return `<div class="chips">${checks.map((c) => `<span class="chip ${c.ok ? 'ok' : ''}" title="${esc(c.label)}">${c.ok ? '✓' : '✕'} ${SHORT[c.key] ?? esc(c.label)}</span>`).join('')}</div>`;
}

function ladder(p) {
  const lo = Math.min(p.initialStop || p.stop || p.price, p.stop || p.price, p.price, p.entry) * 0.99;
  const hi = Math.max(p.highest, p.price, p.entry) * 1.01;
  const pos = (v) => `${(((v - lo) / (hi - lo)) * 100).toFixed(2)}%`;
  const up = p.price >= p.entry;
  return `<div class="ladder" aria-hidden="true"><div class="rail"></div>
    <div class="zone" style="left:${pos(Math.min(p.entry, p.price))};width:calc(${pos(Math.max(p.entry, p.price))} - ${pos(Math.min(p.entry, p.price))});background:${up ? 'var(--green-line)' : 'var(--red-line)'}"></div>
    ${p.stop > 0 ? `<div class="mk" style="left:${pos(p.stop)};background:var(--red)" title="Stop ${price(p.stop)}"></div>` : ''}
    <div class="mk" style="left:${pos(p.entry)};background:var(--text)" title="Entry ${price(p.entry)}"></div>
    <div class="mk" style="left:${pos(p.highest)};background:var(--faint)" title="Highest ${price(p.highest)}"></div>
    <div class="now" style="left:${pos(p.price)};background:${up ? 'var(--green)' : 'var(--red)'}"></div></div>
    <div class="ladder-l num">${p.stop > p.entry
      ? `<span>entry ${price(p.entry)}</span><span class="down">stop ${price(p.stop)}</span>`
      : `<span class="down">stop ${p.stop > 0 ? price(p.stop) : 'none'}</span><span>entry ${price(p.entry)}</span>`}<span class="faint">high ${price(p.highest)}</span></div>`;
}

function positionCard(p) {
  const exitNote = p.exitPending ? '<span class="badge exit">Selling at the next check</span>' : '';
  const lock = p.locked ? `<span class="badge lock">Locked in: ${signUsd(p.lockedPnl)} even if stopped</span>` : '';
  return `<article class="card ${p.pnl >= 0 ? 'win' : 'loss'}" tabindex="0">
    <div class="card-top">${avatar(p.coin)}<div><div class="coin">${esc(p.coin)}</div><span class="tag">${PB[p.playbook] ?? p.playbook}</span></div>
      <div class="right"><div class="pnl num ${cls(p.pnl)}">${signUsd(p.pnl)}</div><div class="small num ${cls(p.pnl)}">${pct(p.pnlPct)} · ${rFmt(p.r)}</div></div></div>
    ${ladder(p)}
    <div class="small muted num" style="margin-top:8px">${usd(p.value)} position (${pct(p.weight, 0, false)} of account) · now ${price(p.price)} · ${p.daysHeld} day${p.daysHeld === 1 ? '' : 's'}${p.stopDistPct != null ? ` · stop ${pct(-p.stopDistPct)} away` : ''}</div>
    ${lock}${exitNote}
    <div class="why">${esc(p.why)}</div></article>`;
}

function renderBoard(v) {
  const d = S.d;
  const entries = d.board.pending.filter((o) => o.kind === 'entry');
  const inTrade = v.positions.filter((p) => !p.locked), locked = v.positions.filter((p) => p.locked);
  const closed = d.board.closed.slice(0, 15);
  const cols = [
    { key: 'watch', title: 'Watching', color: 'var(--blue)', help: `The ${d.rules.universe} most-traded coins. One is bought when all three are true at the daily close (00:00 UTC): Bitcoin above its 50-day average, the coin above its own 50-day average, and a new 20-day closing high.`, items: v.watch, limit: 6,
      empty: '<strong>Scanning…</strong>The watchlist fills after the first daily close.',
      card: (w) => `<article class="card compact ${w.allOk ? 'ready' : ''}" tabindex="0">
        <div class="card-top">${avatar(w.coin)}<div class="grow"><div class="coin">${esc(w.coin)}</div><div class="small num muted nowrap">${price(w.price)} <span class="${cls(w.change24h)}">${pct(w.change24h)}</span></div></div>
        <div class="right"><div class="pnl num">${w.allOk ? 'Ready' : pct(w.distancePct, 1, false)}</div><div class="small faint nowrap">${w.allOk ? 'all rules met' : 'to buy zone'}</div></div></div>
        ${checklist(w.checks ?? [])}
        <div class="prog" title="How close the price is to its buy zone"><i style="width:${Math.max(4, 100 - Math.min(100, w.distancePct * 100 * 5)).toFixed(0)}%"></i></div>
        <div class="why">${w.allOk ? 'If this holds at the close, the desk buys at the next check.' : w.distancePct > 0 ? `Needs a daily close above ${price(w.trigger)}.` : 'Price is in the buy zone; waiting on Bitcoin.'}</div></article>` },
    { key: 'buy', title: 'Buying next', color: 'var(--teal)', help: 'Orders placed at the next check. Each is sized so hitting its stop costs about 4% of the account.', items: entries,
      empty: d.regime.on ? '<strong>Nothing triggered</strong>No coin met all three rules at the last close.' : '<strong>No buys in a downtrend</strong>The desk waits for Bitcoin to close above its 50-day average.',
      card: (o) => `<article class="card ready" tabindex="0"><div class="card-top">${avatar(o.coin)}<div><div class="coin">${esc(o.coin)}</div><span class="tag">${PB[o.playbook]}</span></div>
        <div class="right"><div class="pnl num">${usd(o.usd)}</div><div class="small faint">to invest</div></div></div>
        <div class="small muted num" style="margin-top:8px">Now ${price(px(o.symbol) || o.price)}${o.stop ? ` · stop-loss ${price(o.stop)}` : ''}</div><div class="why">${esc(o.why)}</div></article>` },
    { key: 'trade', title: 'In trade', color: 'var(--green)', help: 'Open trades with their stop-loss (red). The stop only ever moves up.', items: inTrade,
      empty: '<strong>No open trades</strong>Cash is a position. The desk only buys strength in an uptrend.', card: positionCard },
    { key: 'locked', title: 'Profit locked', color: 'var(--gold)', help: 'The trailing stop is above the entry, so these trades can no longer lose money (unless the price gaps).', items: locked,
      empty: '<strong>Nothing here yet</strong>When a trade rises far enough, its trailing stop passes the entry and the card moves here.', card: positionCard },
    { key: 'closed', title: 'Closed', color: 'var(--faint)', help: 'Finished trades. About 4 in 10 win, and a few big winners pay for many small losses.', items: closed,
      empty: '<strong>No closed trades yet</strong>Finished trades and what they made show up here.',
      card: (t) => `<article class="card ${t.pnlUsd >= 0 ? 'win' : 'loss'}" tabindex="0"><div class="card-top">${avatar(t.coin)}<div><div class="coin">${esc(t.coin)}</div><span class="small faint">${date(t.openedT)} → ${date(t.closedT)} · ${t.holdDays}d</span></div>
        <div class="right"><div class="pnl num ${cls(t.pnlUsd)}">${signUsd(t.pnlUsd)}</div><div class="small num ${cls(t.pnlUsd)}">${pct(t.pnlPct)} · ${rFmt(t.r)}</div></div></div>
        <div class="why">${t.pnlUsd >= 0 ? 'Won' : 'Lost'}: ${esc(t.exitReason)}. Bought ${price(t.entryAvg)}, sold ${price(t.exitAvg)}.</div></article>` },
  ];
  $('#board').innerHTML = cols.map((c) => `<section class="col" aria-label="${c.title}"><div class="col-head"><span class="dot" style="background:${c.color}"></span><h3>${c.title}</h3><span class="count">${c.items.length}</span></div>
    <p class="col-help">${c.help}</p><div class="cards">${!c.items.length ? `<div class="empty">${c.empty}</div>`
      : c.limit && c.items.length > c.limit ? c.items.slice(0, c.limit).map(c.card).join('') + `<details class="more"><summary>Show ${c.items.length - c.limit} more</summary><div class="cards">${c.items.slice(c.limit).map(c.card).join('')}</div></details>`
      : c.items.map(c.card).join('')}</div></section>`).join('');
  $('#board-sub').textContent = `${v.watch.length} watching · ${entries.length} buying next · ${v.positions.length} open · ${d.account.trades} closed`;
}

function renderLog() {
  const icon = { buy: 'B', add: '+', sell: 'S', target: '◎', stop: '✕', regime: '!', info: 'i', learn: 'L' };
  const ev = S.d.events.slice(0, 40);
  $('#log').innerHTML = ev.length ? ev.map((e) => `<li><span class="ev ${e.type}">${icon[e.type] ?? '·'}</span><div>${esc(e.text)}<time>${new Date(e.t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time></div></li>`).join('')
    : '<li><span class="ev info">i</span><div>The desk started on ' + dateY(S.d.meta.startDay) + '. Every buy, sell and stop will be explained here.</div></li>';
}

function renderPeek() {
  const L = S.d.learning;
  const top = L.desks.slice(0, 5);
  $('#peek').innerHTML = `<div class="table-scroll"><table><thead><tr><th>Desk</th><th class="r">Return</th><th class="r">Trades</th><th></th></tr></thead><tbody>
    ${top.map((x) => `<tr class="${x.role === 'main' ? 'main' : ''}"><td><b>${esc(x.label)}</b> <span class="role ${x.role}">${x.role === 'main' ? 'Live account' : x.role}</span></td><td class="r num ${cls(x.ret)}">${pct(x.ret)}</td><td class="r num">${x.trades}</td><td>${spark(x.spark, x.ret >= 0 ? '#00cc00' : '#ff5a6a')}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="small muted" style="margin:12px 2px 0">${L.desks.length - 1} shadow desks trade the same live prices with pretend money. ${L.lessons.length ? esc(L.lessons[0].text) : 'Lessons appear once enough trades have closed (12+ on each side of a pattern).'}</p>`;
}

function renderDesk() {
  if (!S.d) return;
  const v = liveView();
  renderHero(v); renderChart(v); renderBoard(v); renderLog(); renderPeek();
  renderStatus();
}

function renderStatus() {
  if (!S.d) return;
  const age = Date.now() - S.d.generatedAt;
  const fresh = S.liveAt && Date.now() - S.liveAt < 60_000;
  if (DEMO) { $('#status').innerHTML = `<span class="live-dot stale"></span><span><b style="color:var(--gold)">Demo:</b> replay of ${esc(S.d.demo?.from)} to ${esc(S.d.demo?.to)} · <a href="./">back to the live desk</a></span>`; return; }
  $('#status').innerHTML = `<span class="live-dot ${fresh ? '' : 'stale'}"></span><span>${fresh ? 'Live prices' : 'Prices from the last check'} · bot checked ${ago(S.d.generatedAt)}${age > 3 * 3600_000 ? (VAULT ? ' (late: the bot may be delayed)' : ' (stale: pull the latest state)') : ''}</span>`;
}

// ---------- learning view ----------
function renderLearning() {
  const L = S.d.learning, R = S.research;
  const health = L.health.filter((h) => h.trades > 0 || h.playbook === 'trend');
  $('#view-learning').innerHTML = `
    <div class="section-head"><h2>How the desk learns</h2><p>Carefully: research showed that re-tuning too often lowers returns.</p></div>
    <div class="grid3">
      <div class="panel pad"><div class="label">1 · Playbook health</div><p class="prose">Each setup starts with the edge it showed in 6 years of backtests. Every closed trade updates that estimate. If the live edge fades, the desk <strong>cuts its bet size</strong>. If it turns negative, the setup is <strong>paused</strong> and keeps trading in practice mode until it recovers.</p></div>
      <div class="panel pad"><div class="label">2 · Lessons from the journal</div><p class="prose">Every trade records the conditions at entry. The desk looks for patterns with at least 12 trades on each side, then reports them. A pattern becomes a rule only if it holds in <strong>both</strong> halves of the history.</p></div>
      <div class="panel pad"><div class="label">3 · Challengers</div><p class="prose">${L.desks.length - 1} shadow desks with their own pretend $1,000 trade the same live prices: nearby settings plus the alternatives (DCA bot, dip buying, pumps, momentum). A challenger is flagged for promotion only after <strong>180+ days, 30+ trades and a clearly better Sharpe ratio</strong>. You approve the switch.</p></div>
    </div>
    <div class="section-head"><h2>Leaderboard</h2><p>Same start, same prices, same fees. Since ${dateY(S.d.meta.startDay)}.</p></div>
    <div class="panel table-scroll"><table><thead><tr><th>Desk</th><th>Type</th><th class="r">Account</th><th class="r">Return</th><th class="r">Worst drop</th><th class="r">Trades</th><th class="r">Won</th><th>Last 90 days</th><th>What it does</th></tr></thead><tbody>
      ${L.desks.map((x) => `<tr class="${x.role === 'main' ? 'main' : ''}"><td><b>${esc(x.label)}</b>${x.promote ? ' <span class="role main">promotion candidate</span>' : ''}</td><td><span class="role ${x.role}">${x.role === 'main' ? 'Live account' : x.role === 'challenger' ? 'Challenger' : 'Alternative'}</span></td>
        <td class="r num">${usd(x.equity)}</td><td class="r num ${cls(x.ret)}">${pct(x.ret)}</td><td class="r num">${pct(-x.maxDD)}</td><td class="r num">${x.trades}</td><td class="r num">${x.trades ? pct(x.winRate, 0, false) : '–'}</td>
        <td>${spark(x.spark, x.ret >= 0 ? '#00cc00' : '#ff5a6a')}</td><td class="muted small" style="min-width:240px">${esc(x.blurb)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="grid2" style="margin-top:14px">
      <div class="panel pad"><h2>Playbook health</h2><p class="small muted" style="margin:4px 0 0">Live trades from all desks. Trust 1.0 means trading at full size.</p>
        <div class="health">${health.map((h) => `<div class="health-row"><span><b>${PB[h.playbook]}</b><br><span class="faint small">${h.trades} trades${h.trades ? ` · avg ${rFmt(h.avgR)}` : ''}</span></span>
          <div class="trust"><i style="width:${Math.min(100, h.trust * 100).toFixed(0)}%;background:${h.status === 'paused' ? 'var(--red)' : h.status === 'watch' ? 'var(--gold)' : 'var(--green)'}"></i></div>
          <span class="small num" style="text-align:right">${h.status === 'no data' ? 'no data' : `${h.trust.toFixed(2)} · ${h.status}`}</span></div>`).join('')}</div></div>
      <div class="panel pad"><h2>Lessons</h2>
        <p class="small muted" style="margin:4px 0 0">From live trading</p>
        <ul class="lessons">${L.lessons.length ? L.lessons.slice(0, 5).map((l) =>`<li>${esc(l.text)}</li>`).join('') : '<li class="muted">None yet. Live lessons need 12+ trades on each side of a pattern.</li>'}</ul>
        ${R?.lessons?.length ? `<p class="small muted" style="margin:16px 0 0">From the 2020–2026 backtest (${R.rows.find((r) => r.group === 'final')?.trades} trades)</p><ul class="lessons">${R.lessons.slice(0, 4).map((l) =>`<li>${esc(l.text)}</li>`).join('')}</ul>
        <p class="small faint" style="margin-top:10px">Tested and rejected as a rule: skipping breakouts with RSI above 75. It helped at exactly 75 but not at 70 or 80, which is a sign of curve-fitting.</p>` : ''}</div>
    </div>`;
}

// ---------- research view ----------
function renderResearch() {
  const R = S.research;
  const el = $('#view-research');
  if (!R) { el.innerHTML = '<div class="section-head"><h2>Research</h2></div><div class="empty">Research summary not found. Run <code>npm run research:summary</code>.</div>'; return; }
  const final = R.rows.find((r) => r.group === 'final');
  const btc = R.rows.find((r) => r.label.startsWith('Bitcoin, buy'));
  const mc = R.monteCarlo.desk;
  const families = R.rows.filter((r) => r.group === 'benchmark' || r.group === 'family' || r.group === 'final');
  const maxM = Math.max(...families.map((r) => Math.log10(Math.max(1, r.multiple))));
  const wf = R.walkForward;
  el.innerHTML = `
    <div class="section-head"><h2>What 6 years of data say</h2><p>${R.data.coins} coins, including delisted ones · ${R.period.from} to ${R.period.to} · fees and slippage on every trade</p></div>
    <div class="callout"><strong>The honest answer on $1,000 → $100,000 in 12 months.</strong> No strategy we tested came close without leverage or luck. The best 12-month stretch of the chosen desk was <b>×${final.best12m.toFixed(1)}</b>. In 20,000 simulated years built from its daily results, <b>${mc.odds['100x'] < 0.001 ? 'fewer than 1 in 1,000' : pct(mc.odds['100x'])}</b> reached ×100; ${pct(mc.odds['10x'], 1, false)} reached ×10; ${pct(mc.odds['2x'], 0, false)} at least doubled; ${pct(1 - mc.odds['1x'], 0, false)} lost money. To compound ×100 a year, a strategy needs a Sharpe ratio of about ${R.monteCarlo.sharpeNeededFor100x.toFixed(1)} even at the growth-maximising leverage; strong systematic funds typically run 1–2. So the desk aims for the <b>fastest compounding that survives</b>, and the goal line stays on the chart as a yardstick.</div>
    <div class="grid3" style="margin-top:14px">
      <div class="panel pad verdict"><div class="label">Chosen: Desk v1</div><div class="k up">×${final.multiple.toFixed(0)}</div><div class="prose">$1,000 → ${usd(1000 * final.multiple, 0)} from 2020 to now (${pct(final.cagr, 0)} a year). Worst drop ${pct(-final.maxDD, 0)}. Bitcoin held: ×${btc.multiple.toFixed(1)} with a ${pct(-btc.maxDD, 0)} drop.</div></div>
      <div class="panel pad verdict"><div class="label">Tested on unseen years</div><div class="k">×${wf.outOfSample.desk.toFixed(1)}</div><div class="prose">Tuned on ${wf.inSample.from.slice(0, 4)}–${wf.inSample.to.slice(0, 4)} only, then run on ${wf.outOfSample.from.slice(0, 4)}–2026: ×${wf.outOfSample.desk.toFixed(1)} vs Bitcoin ×${wf.outOfSample.btc.toFixed(1)}, worst drop ${pct(-wf.outOfSample.deskDD, 0)} vs ${pct(-wf.outOfSample.btcDD, 0)}. All 45 trend settings tested made money on those years.</div></div>
      <div class="panel pad verdict"><div class="label">Survives higher fees</div><div class="k">×${R.costSensitivity.at(-1).multiple.toFixed(0)}</div><div class="prose">At 0.60% fee + 0.20% slippage per trade (a costly retail exchange) the desk still made ×${R.costSensitivity.at(-1).multiple.toFixed(0)}. At 0.10% + 0.05% (Binance-level), ×${R.costSensitivity[0].multiple.toFixed(0)}.</div></div>
    </div>
    <div class="panel chart-panel"><div class="chart-head"><h2>Desk v1 vs Bitcoin, $1,000 start (log scale)</h2><div class="legend"><span><i style="background:#00cc00"></i>Desk v1</span><span><i style="background:#3d94e0"></i>Bitcoin, held</span></div></div>
      <div style="position:relative"><svg class="chart" id="rchart" style="height:280px"></svg><div class="chart-tip" id="rtip"></div></div></div>
    <div class="section-head"><h2>Every approach you asked about</h2><p>Same coins, same costs, ${R.period.from.slice(0, 4)}–2026. Bar = growth multiple (log scale).</p></div>
    <div class="panel pad">${families.map((r) => `<div class="bar-row"><span><b>${esc(r.label)}</b><br><span class="faint small">${esc(r.note || (r.group === 'benchmark' ? 'Benchmark' : ''))}</span></span>
      <div class="b"><i style="width:${Math.max(2, (Math.log10(Math.max(1, r.multiple)) / maxM) * 100).toFixed(1)}%;background:${r.group === 'final' ? 'var(--green)' : r.group === 'benchmark' ? 'var(--blue)' : 'var(--faint)'}"></i></div>
      <span class="num" style="text-align:right"><b>×${r.multiple.toFixed(1)}</b><br><span class="faint small">drop ${pct(-r.maxDD, 0)}</span></span></div>`).join('')}</div>
    <div class="panel table-scroll" style="margin-top:14px"><table><thead><tr><th>Approach</th><th class="r">$1k became</th><th class="r">Per year</th><th class="r">Worst drop</th><th class="r">Sharpe</th><th class="r">Trades</th><th class="r">Won</th><th class="r">Best 12 mo</th><th class="r">Worst 12 mo</th></tr></thead><tbody>
      ${R.rows.map((r) => `<tr class="${r.group === 'final' ? 'main' : ''}"><td>${esc(r.label)}</td><td class="r num">${usd(1000 * r.multiple, 0)}</td><td class="r num">${pct(r.cagr, 0)}</td><td class="r num">${pct(-r.maxDD, 0)}</td><td class="r num">${r.sharpe.toFixed(2)}</td><td class="r num">${r.trades || '–'}</td><td class="r num">${r.trades ? pct(r.winRate, 0, false) : '–'}</td><td class="r num">×${r.best12m.toFixed(1)}</td><td class="r num">×${r.worst12m.toFixed(2)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="grid2" style="margin-top:14px">
      <div class="panel pad prose"><h2 style="color:var(--text)">Answers to your questions</h2><ul>
        <li><strong>Top 10, 20 or 100?</strong> Top 10 by trading volume. Wider lists looked great in the 2020–21 alt season, then badly lagged in 2023–26 and added much deeper drops. Buying and holding the top 10 alts lost 93% at the worst point.</li>
        <li><strong>Watchlist for pumps?</strong> Chasing volume spikes barely paid: ×1.4 in 6 years with a −44% drop. Research on pump groups finds prices revert within minutes to an hour, and late buyers pay the organisers.</li>
        <li><strong>Buy the dip?</strong> Small, steady, low-return (×1.3 in 6 years). In big coins, short-term momentum beats short-term reversal.</li>
        <li><strong>DCA bots / safety orders?</strong> 100% of closed deals won, but the account fell 71% at the worst point. Losing deals never close; they sit underwater.</li>
        <li><strong>Trailing stops?</strong> Yes, and wide ones: 6× the average daily range (ATR). Tight stops (3 ATR) cut winners short and made about half as much.</li>
        <li><strong>DCA in and out (pyramiding, partial profits)?</strong> Neither added return here. Selling half at +2R lowered growth from ×47 to ×32.</li>
        <li><strong>Scan news?</strong> No robust evidence that headlines predict prices once they are public. At most a risk filter.</li>
        <li><strong>The single biggest lever:</strong> stay out when Bitcoin is below its 50-day average. On its own, holding Bitcoin only above that line turned ×10.8 with a −77% drop into ×27 with a −57% drop. The full desk takes it to ×66 and −42%.</li></ul></div>
      <div class="panel pad prose"><h2 style="color:var(--text)">How the tests were kept honest</h2><ul>
        <li><strong>No survivorship bias:</strong> coins that later collapsed or were delisted (LUNA, FTT and others) are included, and the top 10 is rebuilt each day from that day's volume.</li>
        <li><strong>No peeking:</strong> decisions use the daily close and fill at the next open, with 0.10% fees and 0.05% slippage per side. Stops fill at the stop or worse on gaps.</li>
        <li><strong>Out-of-sample check:</strong> settings were chosen on 2020–2022 and checked on 2023–2026.</li>
        <li><strong>Plateau, not peak:</strong> nearby settings give similar results.</li>
        <li><strong>What it can't capture:</strong> exchange outages, liquidity in a crash, and the future being different. Expect less live than in backtests.</li></ul>
        <h3 style="color:var(--text);margin-top:12px">Further reading</h3><ul class="small">
        <li>Zarattini, Pagani & Barbon (2025), <a href="https://concretumgroup.com/wp-content/uploads/2026/02/Catching-Crypto-Trends.pdf" target="_blank" rel="noopener">Catching Crypto Trends</a>: Donchian trend-following on liquid coins, Sharpe about 1.5 net of costs.</li>
        <li>Liu, Tsyvinski & Wu (2022), <a href="https://www.nber.org/papers/w25882" target="_blank" rel="noopener">Common Risk Factors in Cryptocurrency</a>, Journal of Finance.</li>
        <li>Liu & Tsyvinski (2021), <a href="https://www.nber.org/papers/w24877" target="_blank" rel="noopener">Risks and Returns of Cryptocurrency</a>, Review of Financial Studies.</li>
        <li>Xu & Livshits (2019), <a href="https://arxiv.org/abs/1811.10109" target="_blank" rel="noopener">The Anatomy of a Cryptocurrency Pump-and-Dump Scheme</a>.</li>
        <li>MacLean, Thorp & Ziemba (2010), <a href="https://www.stat.berkeley.edu/~aldous/157/Papers/Good_Bad_Kelly.pdf" target="_blank" rel="noopener">Good and bad properties of the Kelly criterion</a>.</li></ul></div>
    </div>`;
  const curve = R.curve;
  requestAnimationFrame(() => lineChart($('#rchart'), [
    { name: 'Bitcoin, held', points: curve.filter((p) => Number.isFinite(p[2])).map((p) => [p[0], p[2]]), color: '#3d94e0', width: 1.6 },
    { name: 'Desk v1', points: curve.map((p) => [p[0], p[1]]), color: '#00cc00', width: 2.2, fill: 'rgba(0,204,0,.06)' },
  ], { log: true, tip: $('#rtip'), yFmt: (x) => usd(x, 0) }));
}

// ---------- rules view ----------
function renderRules() {
  const p = S.d.rules, t = p.playbooks.trend;
  $('#view-rules').innerHTML = `
    <div class="section-head"><h2>The rules, in plain English</h2><p>Desk v1. The bot follows these exactly; no hunches.</p></div>
    <div class="grid2">
      <div class="panel pad prose"><ol>
        <li><strong>What it trades:</strong> the ${p.universe} most-traded coins on Binance (30-day median volume), re-ranked daily. No stablecoins or leveraged tokens. Spot only, no leverage, never short.</li>
        <li><strong>When it is allowed to buy:</strong> only while Bitcoin closes above its ${p.regimeSma}-day average. Below it, the desk sells its trend trades and waits in cash.</li>
        <li><strong>What it buys:</strong> a coin that closes at a new ${t.breakout}-day high while above its own ${t.trendSma}-day average (a trend breakout).</li>
        <li><strong>How much:</strong> enough that hitting the stop-loss costs about ${(p.riskPerTrade * 100).toFixed(0)}% of the account, but never more than ${(p.maxWeight * 100).toFixed(0)}% of the account in one coin, at most ${p.maxPositions} coins, and never more cash than it has. Sizes grow as the account grows (compounding).</li>
        <li><strong>Stop-loss:</strong> ${t.atrInit}× the coin's average daily range (ATR) below the entry.</li>
        <li><strong>Trailing stop:</strong> as the price rises, the stop follows ${t.atrTrail}× ATR below the highest price. It only moves up.</li>
        <li><strong>Drawdown brake:</strong> if the account is ${(p.ddGovernor * 100).toFixed(0)}% below its peak, new trades are half size until it recovers.</li>
        <li><strong>Learning guardrail:</strong> if live results show the edge fading, bet sizes shrink automatically; if the edge turns negative, new trades become practice-only.</li>
        <li><strong>Timing:</strong> decisions at the daily close (00:00 UTC); stops are checked every hour.</li>
      </ol></div>
      <div class="panel pad"><h2>Exact settings</h2><div class="table-scroll"><table><tbody>
        ${[['Universe', `top ${p.universe} by volume`], ['Bitcoin filter', `close > ${p.regimeSma}-day SMA; ${p.riskOffAction} when it fails`], ['Breakout', `${t.breakout}-day closing high`], ['Trend filter', `close > ${t.trendSma}-day SMA`], ['Initial stop', `${t.atrInit} × ATR(14)`], ['Trailing stop', `${t.atrTrail} × ATR(14) below the high`], ['Risk per trade', pct(p.riskPerTrade, 0, false)], ['Max per coin', pct(p.maxWeight, 0, false)], ['Max positions', p.maxPositions], ['Drawdown brake', `${pct(p.ddGovernor, 0, false)} below peak → half size`], ['Fees + slippage', `${pct(p.feeRate, 2, false)} + ${pct(p.slippage, 2, false)} per side`]]
          .map(([k, v]) => `<tr><td class="muted">${k}</td><td class="num"><b>${esc(v)}</b></td></tr>`).join('')}
      </tbody></table></div>
      <h3 style="margin-top:18px">Taking it live later</h3><p class="prose small">The strategy code is exchange-agnostic. To trade real money you would implement the exchange adapter in <code>src/broker/exchange.ts</code> (for example with the ccxt library), run it against a small amount first, and compare its fills with this paper desk. See <code>README.md</code>. Paper results are not proof; give it months.</p></div>
    </div>`;
}

// ---------- shell ----------
function setTab(tab) {
  S.tab = tab;
  for (const b of $$('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const id of ['desk', 'learning', 'research', 'rules']) $(`#view-${id}`).hidden = id !== tab;
  if (tab === 'learning') renderLearning();
  if (tab === 'research') renderResearch();
  if (tab === 'rules') renderRules();
  if (tab === 'desk') renderDesk();
  renderStatus();
  try { localStorage.setItem('tbt-desk-tab', tab); } catch { /* ignore */ }
}

async function boot() {
  for (const b of $$('.tabs button')) b.onclick = () => setTab(b.dataset.tab);
  document.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) setTab(g.dataset.goto); });
  for (const b of $$('#range button')) b.onclick = () => { S.range = b.dataset.r; for (const x of $$('#range button')) x.setAttribute('aria-pressed', String(x === b)); renderDesk(); };
  if (VAULT) {
    try { await unlock(); } catch (e) { $('#hero').innerHTML = `<div class="panel" style="padding:20px;grid-column:1/-1">${esc(e.message)}</div>`; return; }
    const lock = document.createElement('a');
    lock.href = '#'; lock.textContent = 'Lock this device';
    lock.onclick = (e) => { e.preventDefault(); try { localStorage.removeItem(KEY_STORE); } catch { /* ignore */ } location.reload(); };
    $('.foot').append(' ', lock);
  }
  try { await Promise.all([loadState(), loadResearch()]); }
  catch (e) { $('#hero').innerHTML = `<div class="panel" style="padding:20px;grid-column:1/-1">${esc(e.message)}</div>`; return; }
  let saved = 'desk'; try { saved = localStorage.getItem('tbt-desk-tab') || 'desk'; } catch { /* ignore */ }
  setTab(saved);
  refreshPrices();
  setInterval(refreshPrices, 15_000);
  setInterval(async () => { try { await loadState(); if (S.tab === 'desk') renderDesk(); } catch { /* keep last */ } }, 120_000);
  addEventListener('resize', () => { if (S.tab === 'desk') renderChart(liveView()); if (S.tab === 'research') renderResearch(); });
}
boot();
