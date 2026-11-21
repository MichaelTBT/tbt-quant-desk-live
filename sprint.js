// The goal desks' display. One page, three desks, chosen by ?desk=:
//   (none)    the Sprint: $1,000 -> $2,000 in 30 days            state/sprint.json
//   breakout  A/B desk A, daily breakout rules, no TBO           state/breakout.json
//   tbo       A/B desk B, the TBO on 4-hour charts               state/tbo.json
// The A/B desks share one goal: +50% before -25%, no time limit. The bot writes the state files every hour; this page
// keeps prices and candles live from Binance's public API. The Sprint can also replay past months (?demo=best|typical|worst).
// The hero mountain lives in sprint-scene.js; this file loads the data and draws everything else.
import { createScene } from './sprint-scene.js?v=7';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const DAY = 86_400_000;
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
const DESK = !DEMO && ['breakout', 'tbo'].includes(params.get('desk')) ? params.get('desk') : 'sprint';
const AB = DESK !== 'sprint', OTHER = DESK === 'breakout' ? 'tbo' : 'breakout'; // the A/B desks and their opposite number
const VAULT = !!document.querySelector('meta[name="desk-vault"]');
const KEY_STORE = 'tbt-desk-key';
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
// Chart colours: validated for colour-blind separation on the dark surface (account, Bitcoin, loss).
const C = { acct: '#20b062', btc: '#5596e8', loss: '#ec5e6d', gold: '#f2c66d', mint: '#5df28a', ink: '#f4f7fb', ink2: '#b4c0d2', ink3: '#7385a0', surf: '#0a1528', grid: 'rgba(180,200,230,0.09)' };

const S = { d: null, other: null, top: null, replay: null, frame: 0, playing: false, timer: 0, live: {}, liveAt: 0, candles: {}, candleAt: {}, sel: null, drawn: false, shownEq: null, scene: null, ends: null, endsFor: null };

// ---------- formatting ----------
const usd = (x, dp = 2) => (Number.isFinite(x) ? `${x < 0 ? '−' : ''}$${Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}` : '–');
const price = (x) => (!Number.isFinite(x) ? '–' : x >= 1000 ? '$' + x.toLocaleString('en-US', { maximumFractionDigits: 0 }) : x >= 1 ? '$' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '$' + x.toPrecision(4));
const pct = (x, dp = 1, sign = true) => (Number.isFinite(x) ? `${sign && x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(dp)}%` : '–');
const signUsd = (x, dp = 2) => (x > 0 ? '+' : '') + usd(x, dp);
const cls = (x) => (x > 1e-9 ? 'up' : x < -1e-9 ? 'down' : 'flat');
const dateU = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const dateY = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const when = (t) => (DEMO ? dateU(t - 1) : new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`; };
// The engine's log lines use two bits of desk jargon; say them the way the rest of the page does.
const plain = (t) => String(t ?? '').replace(/,\s*[-+−]?\d+(?:\.\d+)?R\)/g, ')').replace(/Market turned risk-off/g, 'Red light').replace(/Market turned risk-on/g, 'Green light').replace(/closing trend trades/g, 'selling everything');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function avatar(coin) {
  let h = 0; for (const c of coin) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `<span class="av" style="background:hsl(${h % 360} 60% 62%)"><span>${esc(coin.slice(0, 4))}</span><img alt="" loading="lazy" src="https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/${esc(coin.toLowerCase())}.svg" onerror="this.remove()"></span>`;
}

// ---------- data ----------
let vault = null; let key = null;
async function fetchBin(kind) { const r = await fetch(`data/${kind}.bin?ts=${Date.now()}`, { cache: 'no-store' }); return r.ok ? r.arrayBuffer() : null; }
async function getData(kind) {
  if (VAULT) { const buf = await fetchBin(kind); return buf ? vault.open(key, buf) : null; }
  const url = kind === 'sprint-demo' || kind === 'past-runs' ? `../research/results/${kind}.json` : `../state/${kind}.json?ts=${Date.now()}`;
  const r = await fetch(url, { cache: 'no-store' });
  return r.ok ? r.json() : null;
}
// Hosted copy: the data is encrypted. Reuse the key this device remembered for the main dashboard, or ask.
async function unlock() {
  vault = await import('./vault.js');
  const buf = await fetchBin(DEMO ? 'sprint-demo' : DESK);
  if (!buf) throw new Error('This desk is not published yet. Check back after the next hourly run.');
  const salt = vault.saltOf(buf);
  try {
    const saved = JSON.parse(localStorage.getItem(KEY_STORE) || 'null');
    if (saved?.salt === salt) { key = await vault.importKey(saved.k); await vault.open(key, buf); return; }
  } catch { key = null; }
  document.body.classList.add('locked');
  const form = document.createElement('form');
  form.className = 'panel unlock';
  form.innerHTML = `<h2>Enter the desk password</h2><p class="muted">The desk's data is encrypted. It opens only with the password.</p>
    <input class="sr-only" type="text" name="username" autocomplete="username" value="TBT Quant Desk" tabindex="-1" aria-hidden="true">
    <label class="label" for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false" required>
    <label class="check"><input type="checkbox" id="remember" checked> Remember on this device</label>
    <button class="btn" type="submit">Unlock</button><p class="err" id="pw-err" role="alert"></p>`;
  $('main').prepend(form);
  $('#pw').focus();
  await new Promise((done) => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('button', form); btn.disabled = true; btn.textContent = 'Unlocking…'; $('#pw-err').textContent = '';
      try {
        const k = await vault.deriveKey($('#pw').value, salt);
        await vault.open(k, buf); key = k;
        if ($('#remember').checked) { try { localStorage.setItem(KEY_STORE, JSON.stringify({ salt, k: await vault.exportKey(k) })); } catch { /* private mode */ } }
        form.remove(); document.body.classList.remove('locked'); done();
      } catch { $('#pw-err').textContent = "That password didn't work. Check it and try again."; btn.disabled = false; btn.textContent = 'Unlock'; $('#pw').select(); }
    };
  });
}
async function loadState() {
  if (DEMO) {
    if (!S.top) S.top = await getData('sprint-demo');
    if (!S.top) throw new Error('No replay data. Run `node research/scripts/sprint-demo.ts`.');
    const want = params.get('demo');
    S.replay = S.top.replays.find((r) => r.key === want) ?? S.top.replays[0];
    S.candles = S.replay.candles;
    setFrame(Math.min(S.frame, S.replay.frames.length - 1));
    return;
  }
  const d = await getData(DESK);
  if (!d) throw new Error('NOT_STARTED');
  S.d = d;
  if (AB) S.other = await getData(OTHER).catch(() => null); // the other half of the A/B test, for the head-to-head line
  // A TBO desk's charts show the indicator itself. The bot works the lines and signals out and sends the finished
  // numbers (state/<desk>-chart.json); the indicator's own settings are not in this page's code.
  if (isTbo(d)) S.tboChart = (await getData(`${DESK}-chart`).catch(() => null)) ?? S.tboChart;
  if (S.past === undefined) S.past = await getData('past-runs').catch(() => null); // the faint lines on the race chart
}
function setFrame(i) { S.frame = i; S.d = { ...S.replay.frames[i], rules: S.top.rules, research: S.top.research }; }
const nowT = () => (DEMO ? S.d.generatedAt : Date.now());

async function refreshPrices() {
  if (!S.d || DEMO) return;
  const syms = Object.keys(S.d.prices);
  try {
    const r = await fetch(`https://data-api.binance.vision/api/v3/ticker/24hr?type=MINI&symbols=${encodeURIComponent(JSON.stringify(syms))}`);
    if (!r.ok) return;
    for (const t of await r.json()) S.live[t.symbol] = { p: +t.lastPrice, ch: +t.openPrice ? +t.lastPrice / +t.openPrice - 1 : 0 };
    S.liveAt = Date.now();
    render();
  } catch { /* offline: keep the bot's last prices */ }
}
const px = (sym, fb = 0) => (!DEMO && S.live[sym]?.p) || S.d.prices[sym] || fb;

// Candles: embedded in a replay, fetched from Binance when live (refreshed every 10 minutes). Each row is
// [open time, open, high, low, close, dollar volume]. A TBO desk reads 4-hour candles; the other desks read daily ones.
const TF = { '1d': { ms: DAY, limit: 200, word: 'daily' }, '4h': { ms: 4 * 3_600_000, limit: 260, word: '4-hour' } };
const chartTf = () => (S.d && !DEMO && isTbo(S.d) ? '4h' : '1d');
function candlesFor(sym, tf = '1d') {
  const key = tf === '1d' ? sym : `${sym}|${tf}`, have = S.candles[key];
  if (!DEMO && (!have || Date.now() - (S.candleAt[key] ?? 0) > 600_000) && S.candleAt[key] !== -1) {
    S.candleAt[key] = -1; // loading
    fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(sym)}&interval=${tf}&limit=${TF[tf].limit}`).then((r) => (r.ok ? r.json() : null)).then((k) => {
      S.candleAt[key] = Date.now();
      if (k) { S.candles[key] = k.map((c) => [c[0], +c[1], +c[2], +c[3], +c[4], +c[7]]); render(); }
    }).catch(() => { S.candleAt[key] = Date.now(); });
  }
  if (!have) return null;
  if (DEMO) return have.filter((c) => c[0] < S.d.generatedAt);
  const rows = have.slice(); const last = rows.at(-1).slice(); const p = px(sym);
  if (p) { last[4] = p; last[2] = Math.max(last[2], p); last[3] = Math.min(last[3], p); rows[rows.length - 1] = last; }
  return rows;
}

// Where every past 30-day test run ended (a multiple of the start). Exact when the bot embeds them, else rebuilt from the histogram.
function endsOf(R) {
  if (R?.ends?.length) return R.ends;
  const out = [];
  for (const h of R?.hist ?? []) { const lo = h.lo || 0.56, hi = h.hi ?? 2.6; for (let i = 0; i < h.n; i++) out.push(lo + ((i + 0.5) / h.n) * (hi - lo)); }
  return out;
}

// What kind of desk this is, read from the data: its goal may have a time limit (the Sprint) or a loss limit (the A/B desks).
function isTbo(d) { return d.rules?.playbooks?.trend?.entry === 'tbo'; }
const nounOf = (d) => d.desk?.noun ?? 'Sprint';
const buyRule = (d) => (isTbo(d) ? 'the next coin whose TBO fires an Open Long on its 4-hour chart' : 'the next coin on the radar that closes the day at a new 20-day high');

// Everything that depends on price, recomputed with live quotes (the bot itself acts hourly / at each bar's close).
function view() {
  const d = S.d, g = d.goal, now = nowT(), timed = g.days != null, tbo = isTbo(d);
  const positions = d.positions.map((p) => {
    const last = px(p.symbol, p.price), value = p.qty * last, pnl = p.pnl + (value - p.value);
    return { ...p, price: last, value, pnl, pnlPct: p.cost ? pnl / p.cost : 0 };
  });
  const invested = positions.reduce((a, p) => a + p.value, 0);
  const equity = d.account.cash + invested;
  const btcNow = px('BTCUSDT', d.btc.now);
  const curve = DEMO ? d.curve : [...d.curve, [now, equity, btcNow]];
  const elapsed = Math.max(0, now - g.startedAt - (DEMO ? 1 : 0)); // a replay frame is the close of its day
  const daysLeft = timed ? Math.max(0, (g.deadline - now) / DAY) : Infinity;
  const paceAt = (t) => (timed ? g.start * (g.target / g.start) ** (Math.min(Math.max(t - g.startedAt, 0), g.days * DAY) / (g.days * DAY)) : NaN);
  // A TBO desk measures its own distance (how far the fast line is below the mid-fast line); a breakout desk's distance moves with the price.
  const radar = d.radar.map((r) => { const last = px(r.symbol, r.price); return { ...r, price: last, distancePct: tbo ? Math.max(0, r.gap ?? r.distancePct) : Math.max(0, r.trigger / last - 1), change24h: !DEMO && S.live[r.symbol] ? S.live[r.symbol].ch : r.change24h }; }).sort((a, b) => a.distancePct - b.distancePct);
  // What the account would be worth if every stop-loss were hit right now (after Kraken's fee and slippage).
  const cost = (d.account.feeRate ?? 0.008) + (d.rules?.slippage ?? 0.001);
  const floor = Math.min(equity, d.account.cash + positions.reduce((a, p) => a + (p.stop > 0 ? p.qty * p.stop * (1 - cost) : 0), 0));
  if (S.endsFor !== d.research) { S.endsFor = d.research; S.ends = endsOf(d.research); }
  const dayN = g.waiting ? 0 : timed ? Math.min(g.days, Math.floor(elapsed / DAY) + 1) : Math.floor(elapsed / DAY) + 1;
  return {
    d, g, now, timed, tbo, noun: nounOf(d), positions, invested, equity, btcNow, curve, radar, daysLeft, paceAt, pace: paceAt(now), floor,
    waiting: !!g.waiting, dayN, done: timed && !g.waiting && now >= g.deadline,
    peak: Math.max(d.account.peak, equity), low: Math.min(d.account.low, equity),
    need: !timed ? NaN : equity >= g.target ? 0 : daysLeft > 0 ? (g.target / equity) ** (1 / daysLeft) - 1 : NaN,
  };
}

// The market light: Bitcoin against its average. `on` is the bot's decision at the last daily close; the gap is live.
function light(v) {
  const rg = v.d.regime, n = rg.smaDays || 50, gap = rg.sma ? v.btcNow / rg.sma - 1 : 0, above = gap >= 0, on = !!rg.on;
  const idle = !v.positions.length && !v.d.pending.length, mag = pct(Math.abs(gap), 1, false);
  const where = `Bitcoin (${price(v.btcNow)}) is ${mag} ${above ? 'above' : 'below'} its ${n}-day average (${price(rg.sma)}).`;
  const body = on && above ? `${where} The trader buys ${buyRule(v.d)}.`
    : on ? `${where} If it closes the day there, the trader sells everything and waits in cash.`
    : above ? `${where} If it closes the day there, the light turns green and buying starts again.`
    : `${where} The trader does not buy in a falling market. It starts again when Bitcoin closes a day back above that line.`;
  return {
    on, gap, above, n, sma: rg.sma, body, short: on ? 'Green light' : 'Red light',
    line: `Bitcoin ${mag} ${above ? 'above' : 'below'} its ${n}-day average`,
    headline: on ? (idle ? `Green light. Waiting for ${v.tbo ? 'an Open Long' : 'a breakout'}.` : 'Green light: buying is allowed') : idle ? 'Red light. Waiting in cash.' : 'Red light: selling and waiting',
  };
}

// ---------- hero ----------
function tweenEquity(el, to) {
  const from = S.shownEq ?? to;
  S.shownEq = to;
  const show = (v) => { const [a, b] = Math.abs(v).toFixed(2).split('.'); el.innerHTML = `${v < 0 ? '−' : ''}$${Number(a).toLocaleString('en-US')}<small>.${b}</small>`; };
  if (REDUCED || Math.abs(to - from) < 0.005) { show(to); return; }
  el.classList.remove('flash-up', 'flash-down'); void el.offsetWidth; el.classList.add(to > from ? 'flash-up' : 'flash-down');
  const t0 = performance.now(), dur = 800;
  const step = (t) => { const k = Math.min(1, (t - t0) / dur), e = 1 - (1 - k) ** 3; show(from + (to - from) * e); if (k < 1 && S.shownEq === to) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function story(v, L) {
  const { g, equity, noun, timed } = v, names = v.positions.map((p) => p.coin);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  const short = `${L.line}${L.on === L.above ? '' : ', but the light only changes at the daily close'}.`;
  const clock = timed ? `Its ${g.days}-day clock starts` : 'It starts';
  if (v.done) return equity >= g.target ? `The ${g.days} days are over, and the account finished above the ${usd(g.target, 0)} goal.` : `The ${g.days} days are over. The account finished ${usd(g.target - equity, 0)} short of the ${usd(g.target, 0)} goal.`;
  const last = (v.d.history ?? []).at(-1);
  if (v.waiting && last) return `${noun} ${last.n} finished at ${usd(last.end, 0)}. ${noun} ${last.n + 1} is ${L.on ? 'at base camp with a green light' : `waiting at base camp: ${short.replace(/\.$/, '')}`}. ${clock} with the first trade.`;
  if (v.waiting) return L.on ? `At base camp with a green light. It buys ${buyRule(v.d)}, and ${timed ? `the ${g.days}-day clock` : 'the run'} starts then.` : `Waiting at base camp. ${short} It does not buy in a falling market. ${timed ? `The ${g.days}-day clock` : 'The run'} starts with the first trade.`;
  if (equity >= g.target) return timed ? `Above the ${usd(g.target, 0)} goal with ${plural(Math.ceil(v.daysLeft), 'day')} left. It keeps trading until day ${g.days}, so the result can still change.` : `At the ${usd(g.target, 0)} goal. The run is banked at the next hourly check.`;
  if (names.length) return `Holding ${list}. If every stop-loss were hit right now, the account would land near ${usd(v.floor, 0)}.`;
  return L.on ? `In cash with a green light, waiting for ${v.tbo ? 'the next Open Long' : 'the next coin to break out'}.` : `In cash. ${short}`;
}
function renderHero(v) {
  const { g, equity, timed, noun } = v, el = $('#copy'), L = light(v);
  if (!el.dataset.built) {
    el.dataset.built = '1';
    el.innerHTML = `<div class="chips" id="chips"></div>
      <div class="eyebrow">Paper account · ${timed ? `${usd(g.start, 0)} to ${usd(g.target, 0)} in ${g.days} days` : `${usd(g.start, 0)} to ${usd(g.target, 0)} before a fall to ${usd(g.floor, 0)}`}</div>
      <div class="eq" id="eq"></div><div class="delta" id="eq-delta"></div>
      <p class="story" id="story"></p>
      ${DEMO || AB ? '' : '<a class="btn ghost" href="?demo=best"><span aria-hidden="true">▶</span> Watch a past month play out</a>'}`;
  }
  const dayChip = v.waiting ? (timed ? 'Clock not started' : 'Not started') : v.done ? 'Finished' : timed ? `Day ${v.dayN} of ${g.days}` : `Day ${v.dayN}`;
  $('#chips').innerHTML = `${AB ? `<span class="chip ab-tag">${DESK === 'breakout' ? 'A · no TBO' : 'B · TBO, 4-hour'}</span>` : ''}${!DEMO && v.d.sprintNo ? `<span class="chip">${noun} ${v.d.sprintNo}</span>` : ''}<span class="chip ${L.on ? 'on' : 'off'}"><i></i>${L.short}</span><span class="chip">${dayChip}</span>${DEMO ? `<span class="chip gold">Replay · ${esc(S.replay.label)}</span>` : ''}`;
  tweenEquity($('#eq'), equity);
  $('#eq-delta').className = `delta ${cls(equity - g.start)}`;
  $('#eq-delta').textContent = v.waiting && Math.abs(equity - g.start) < 0.005 ? 'All in cash, ready at the start' : `${signUsd(equity - g.start)} (${pct(equity / g.start - 1)}) since the start`;
  $('#story').textContent = story(v, L);
  const hero = $('#hero'); hero.classList.toggle('off', !L.on); hero.classList.toggle('below', equity < g.start);
  const overlay = matchMedia('(min-width: 1000px)').matches, sc = $('#scene').getBoundingClientRect(), cp = el.getBoundingClientRect();
  S.scene.update({
    start: g.start, target: g.target, days: g.days ?? 30, timed, limit: g.floor ?? null, dayN: v.dayN, equity, pace: v.pace, floor: v.floor, peak: v.peak, waiting: v.waiting, done: v.done, on: L.on,
    showPace: timed && !v.waiting && !v.done, hasFloor: v.positions.length > 0, ends: S.ends, overlay, avoid: overlay ? { right: cp.right - sc.left, bottom: cp.bottom - sc.top } : null,
  });
  const R = v.d.research, all = R?.sprint?.all;
  const sky = `<span><i class="lampi"></i><i class="lampi red"></i>Summit lamp: green = may buy, red = waiting</span><span id="sky-note"><i class="sun"></i><span>${esc(skyNote())}</span></span>`;
  $('#scene-key').innerHTML = (all ? `<span><i class="lo"></i><i class="hi"></i>Each light on the mountain is where one of ${all.n} past 30-day runs ended</span><span><i class="gold"></i>${Math.round(all.p2x * all.n)} reached the summit</span><span><i class="moon"></i>The moon fills as the 30 days pass</span>`
    : timed ? '' : `<span><i class="gold"></i>The summit is the goal: ${usd(g.target, 0)}</span><span><i class="lo"></i>The valley floor is the loss limit: ${usd(g.floor, 0)}</span><span><i class="moon"></i>The moon fills once for every 30 days of the run</span>`) + sky;
}
// The sky over the mountain is Montreal's real sky (sprint-scene.js); this is the line in the legend that says so.
function skyNote() {
  const k = S.sky;
  if (!k) return "The sky follows Montreal's sun and weather";
  return k.known ? `The sky is Montreal right now: ${k.time}, ${Math.round(k.temp)}°C, ${k.label.toLowerCase()}` : `The sky follows Montreal's sun: ${k.time} there now`;
}

function renderHud(v) {
  const { g, equity, timed } = v, a = v.d.account, L = light(v), gap = equity - v.pace, reached = equity >= g.target;
  const pips = Array.from({ length: g.days ?? 0 }, (_, i) => `<i class="${v.done || i + 1 < v.dayN ? 'done' : i + 1 === v.dayN ? 'today' : ''}"></i>`).join('');
  const left = v.daysLeft >= 1 ? `${plural(Math.ceil(v.daysLeft), 'day')} left` : `${plural(Math.max(1, Math.round(v.daysLeft * 24)), 'hour')} left`;
  const cell = (k, b, s, c = '') => `<div class="${c}"><span class="k">${k}</span><b>${b}</b><span class="s">${s}</span></div>`;
  const progress = (equity - g.start) / (g.target - g.start);
  $('#hud').innerHTML = [
    timed ? `<div class="hud-day"><span class="k">The ${g.days} days</span><b>${v.waiting ? 'Not started' : v.done ? 'Finished' : `Day ${v.dayN}<small> of ${g.days}</small>`}</b><div class="pips" aria-hidden="true">${pips}</div><span class="s">${v.waiting ? 'The clock starts with the first trade' : v.done ? `Ended ${dateY(g.deadline)}` : `${left} · ends ${dateU(g.deadline)}`}</span></div>`
      : `<div class="hud-day"><span class="k">This run</span><b>${v.waiting ? 'Not started' : `Day ${v.dayN}`}</b><span class="s">${v.waiting ? 'The run starts with the first trade. There is no time limit.' : `Started ${dateU(g.startedAt)}. No time limit: it ends at ${usd(g.target, 0)} or ${usd(g.floor, 0)}.`}</span></div>`,
    cell('To the goal', reached ? 'Reached' : usd(g.target - equity, 0), reached ? `${usd(equity - g.target, 0)} above ${usd(g.target, 0)}` : `to reach ${usd(g.target, 0)}`, reached ? 'good' : ''),
    timed ? cell('Against the pace', v.waiting ? '–' : `<span class="${cls(v.done ? equity - g.target : gap)}">${signUsd(v.done ? equity - g.target : gap, 0)}</span>`, v.waiting ? 'starts with the first trade' : v.done ? `${reached ? 'above' : 'short of'} the goal at the finish` : `${gap >= 0 ? 'ahead of' : 'behind'} the doubling pace (${usd(v.pace, 0)} today)`)
      : cell('Above the loss limit', usd(equity - g.floor, 0), `the run ends if the account falls to ${usd(g.floor, 0)}`),
    timed ? cell('Needed per day', reached ? 'Done' : v.done ? '–' : pct(v.need, v.need < 0.1 ? 1 : 0, false), reached ? 'the goal is reached' : 'gain needed every day from here')
      : cell('Progress', pct(progress, 0, false).replace('−', '−'), progress >= 0 ? `of the way from ${usd(g.start, 0)} to ${usd(g.target, 0)}` : `below the ${usd(g.start, 0)} start`, progress < 0 ? 'bad' : ''),
    cell('Safety net', usd(v.positions.length ? v.floor : a.cash, 0), v.positions.length ? `left if every stop-loss is hit · ${usd(a.cash, 0)} in cash` : 'all in cash, nothing at risk'),
    `<div class="hud-light ${L.on ? 'on' : 'off'}"><span class="k">Market light</span><b><i class="lamp" aria-hidden="true"></i>${L.on ? 'Green' : 'Red'}</b><span class="s">${L.line}</span></div>`,
  ].join('');
  renderAB(v);
}

// The A/B test at a glance: both desks side by side, same money, same goal, same market light and fees.
function renderAB(v) {
  const el = $('#ab');
  el.hidden = !AB;
  if (!AB) return;
  const record = (h) => { const w = h.filter((r) => r.reached).length; return h.length ? `${w} won, ${h.length - w} lost` : 'no finished runs yet'; };
  const mine = { id: DESK, equity: v.equity, n: v.d.sprintNo, hist: v.d.history ?? [], open: v.positions.length, waiting: v.waiting, dayN: v.dayN, live: true };
  const o = S.other, theirs = o ? { id: OTHER, equity: o.account.equity, n: o.sprintNo, hist: o.history ?? [], open: o.positions.length, waiting: o.goal.waiting, dayN: o.goal.waiting ? 0 : Math.floor((Date.now() - o.goal.startedAt) / DAY) + 1 } : null;
  const card = (x) => `<a class="ab-card ${x.id === DESK ? 'me' : ''}" href="?desk=${x.id}"${x.id === DESK ? ' aria-current="page"' : ''}>
      <span class="k">${x.id === 'breakout' ? 'A · Breakout desk · no TBO · daily charts' : 'B · TBO desk · 4-hour charts'}</span>
      <b>${usd(x.equity, 0)} <small class="${cls(x.equity - v.g.start)}">${pct(x.equity / v.g.start - 1)}</small></b>
      <span class="s">Run ${x.n}${x.waiting ? ', not started' : `, day ${x.dayN}`} · ${plural(x.open, 'open trade')} · ${record(x.hist)}</span></a>`;
  const pair = [mine, theirs].filter(Boolean).sort((a, b) => (a.id === 'breakout' ? -1 : 1) - (b.id === 'breakout' ? -1 : 1));
  el.innerHTML = `<div class="ab-head"><span class="eyebrow">The A/B test</span><span>${usd(2 * v.g.start, 0)} of paper money, ${usd(v.g.start, 0)} on each desk. Same goal, market light and fees; only the buy and sell rules differ.</span></div><div class="ab-cards">${pair.map(card).join('')}</div>`;
}

// ---------- race chart ----------
// The faint lines are the runs these rules would have had since 2020, one after another, each drawn from its first
// trade (research/scripts/past-runs.ts). Tested history, not a forecast. While the desk waits for its first trade,
// they replay one at a time, so the chart is never an empty frame.
const REPLAY_MS = 9000, monthU = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const lasted = (days) => (days < 60 ? `${Math.round(days)} days` : `${Math.round(days / 30.4)} months`);
let RP = null, rpTimer = 0;
function replayPast() {
  clearTimeout(rpTimer);
  const el = $('#race-replay');
  if (!el || !RP) return;
  const now = Date.now(), o = RP.draw(RP.runs[Math.floor(now / REPLAY_MS) % RP.runs.length]), at = `animation-delay:-${now % REPLAY_MS}ms`;
  el.innerHTML = `<g clip-path="url(#cPlot)"><path class="rp-line" pathLength="1" d="${o.d}" style="color:${o.col};${at}"/><circle class="rp-head" r="4.5" style="color:${o.col};offset-path:path('${o.d}');${at}"/></g>
    <text class="rp-cap" x="${o.x}" y="${o.y}" text-anchor="${o.anchor}" style="${at}">${esc(o.text)}</text>`;
  rpTimer = setTimeout(replayPast, REPLAY_MS - (now % REPLAY_MS) + 30);
}
function renderRace(v) {
  const svg = $('#race'), box = svg.getBoundingClientRect();
  const W = Math.max(300, box.width), H = box.height || 380, narrow = W < 620, L = 4, Rm = narrow ? 54 : 66, T = 24, B = 32;
  const { g, curve } = v;
  const past = DEMO ? null : S.past?.desks?.[DESK], runs = past?.goal?.target === g.target ? past.runs : [], gk = runs.length ? g.start / past.goal.start : 1;
  // A run with no time limit typically takes months. While it waits, the chart shows six months of past runs; once it
  // is trading, the window follows the account's own line and keeps some room ahead of it.
  const timed = v.timed, t0 = g.startedAt;
  const t1 = timed ? Math.max(g.deadline, v.now) : !runs.length ? Math.max(v.now, t0 + 30 * DAY) : v.waiting ? t0 + 180 * DAY : t0 + Math.max(30 * DAY, (v.now - t0) * 1.6);
  const btcLine = curve.filter((c) => c[2] > 0 && v.d.btc.start > 0).map((c) => [c[0], (g.start * c[2]) / v.d.btc.start]);
  const vals = [...curve.map((c) => c[1]), ...btcLine.map((c) => c[1]), g.start, g.target, ...(g.floor ? [g.floor] : []), ...(timed && runs.length ? [Math.min(...runs.map((r) => Math.min(r.value, ...r.path))) * gk] : [])];
  const yMin = Math.min(...vals) * 0.95, yMax = Math.max(...vals) * 1.06;
  const X = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - Rm), Y = (y) => T + (1 - (y - yMin) / (yMax - yMin)) * (H - T - B);
  const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  const tone = (r) => (r.end === 'limit' || (r.end === 'time' && r.value < past.goal.start) ? C.loss : r.end === 'goal' || r.value >= past.goal.target ? C.gold : C.acct);
  const runPts = (r) => [...r.path.map((y, k) => [t0 + k * DAY, y * gk]), [t0 + r.days * DAY, r.value * gk]];
  const outcome = (r) => (r.end === 'goal' ? `reached ${pct(g.target / g.start - 1, 0)} in ${lasted(r.days)}` : r.end === 'limit' ? `hit ${pct(g.floor / g.start - 1, 0)} in ${lasted(r.days)}` : `ended at ${usd(r.value * gk, 0)} (${pct(r.value / past.goal.start - 1, 0)})`);
  const ghosts = runs.length ? `<g class="ghosts${v.waiting ? ' wait' : ''}" clip-path="url(#cPlot)">${runs.map((r, i) => { const pts = runPts(r), e = pts.at(-1); return `<path data-run="${i}" d="${path(pts)}" style="color:${tone(r)}"/><circle cx="${X(e[0]).toFixed(1)}" cy="${Y(e[1]).toFixed(1)}" r="2.6" style="color:${tone(r)}"/>`; }).join('')}</g><g id="race-replay"></g>` : '';
  RP = v.waiting && runs.length && !REDUCED ? { runs, draw: (r) => {
    const all = runPts(r), pts = all.filter((p) => p[0] <= t1), e = pts.at(-1), ex = X(e[0]), ey = Y(e[1]);
    const text = `${monthU(r.start)} · ${outcome(r)}${pts.length < all.length ? ' →' : ''}`, tw = text.length * 6.6;
    const side = ex + 12 + tw <= W - Rm ? 1 : ex - 12 - tw >= L ? -1 : 0;
    return { d: path(pts), col: tone(r), text, x: (side ? ex + side * 12 : L + 8).toFixed(1), y: clamp(r.end === 'goal' && pts.length === all.length ? Y(g.target) + 22 : r.end === 'limit' && pts.length === all.length ? Y(g.floor) - 12 : ey + (e[1] >= g.start ? -14 : 22), T + 14, H - B - 8).toFixed(1), anchor: side < 0 ? 'end' : 'start' };
  } } : null;
  const eqPts = curve.length ? [[t0, g.start], ...curve.filter((c) => c[0] > t0)] : [[t0, g.start]];
  const btcPts = [[t0, g.start], ...btcLine.filter((c) => c[0] > t0)];
  const last = eqPts.at(-1), down = last[1] < g.start, col = down ? C.loss : C.acct;
  const pacePts = timed ? Array.from({ length: 61 }, (_, i) => { const t = t0 + ((g.deadline - t0) * i) / 60; return [t, v.paceAt(t)]; }) : [];
  const step = yMax - yMin > 1500 ? 500 : yMax - yMin > 700 ? 250 : 100;
  let grid = '';
  for (let y = Math.ceil(yMin / step) * step; y <= yMax; y += step) if (Math.abs(y - g.target) > step * 0.3 && Math.abs(y - g.start) > step * 0.3) grid += `<line x1="${L}" x2="${W - Rm}" y1="${Y(y)}" y2="${Y(y)}" stroke="${C.grid}"/><text x="${W - Rm + 9}" y="${Y(y) + 4}">${usd(y, 0)}</text>`;
  let days = '';
  const span = timed ? g.days : Math.ceil((t1 - t0) / DAY), every = timed ? (narrow ? 10 : 5) : Math.max(5, Math.ceil(span / (narrow ? 3 : 6) / 5) * 5);
  for (let dN = 0; dN <= span; dN += every) { const x = X(t0 + dN * DAY), lastTick = dN + every > span; days += `<line x1="${x}" x2="${x}" y1="${H - B}" y2="${H - B + 5}" stroke="rgba(180,200,230,0.3)"/><text x="${x}" y="${H - 9}" text-anchor="${dN === 0 ? 'start' : lastTick ? 'end' : 'middle'}">${dN === 0 ? (narrow ? dateU(t0) : `Start · ${dateU(t0)}`) : timed && dN === g.days ? (narrow ? dateU(g.deadline) : `Day ${g.days} · ${dateU(g.deadline)}`) : `Day ${dN}`}</text>`; }
  // Trade markers sit on the account line at the time of the trade.
  const eqAt = (t) => { let best = eqPts[0]; for (const p of eqPts) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p; return best[1]; };
  const marks = [
    ...v.positions.map((p) => ({ t: p.openedT, buy: true, text: `Bought ${p.coin}` })),
    ...v.d.closed.flatMap((c) => [{ t: c.openedT, buy: true, text: `Bought ${c.coin}` }, { t: c.closedT, buy: false, win: c.pnlUsd > 0, text: `Sold ${c.coin} ${signUsd(c.pnlUsd)}` }]),
  ].filter((m) => m.t >= t0 && m.t <= t1).map((m) => { const x = X(Math.min(m.t, last[0])), y = Y(eqAt(m.t)); return m.buy
    ? `<path d="M${x},${y - 17}l6.5,11h-13z" fill="${C.acct}" stroke="${C.surf}" stroke-width="2" stroke-linejoin="round"><title>${esc(m.text)}</title></path>`
    : `<path d="M${x},${y + 17}l6.5,-11h-13z" fill="${m.win ? C.btc : C.loss}" stroke="${C.surf}" stroke-width="2" stroke-linejoin="round"><title>${esc(m.text)}</title></path>`; }).join('');
  const baseY = Y(g.start), lx = X(last[0]), ly = Y(last[1]);
  const area = `${path(eqPts)}L${lx.toFixed(1)},${baseY.toFixed(1)}L${X(t0).toFixed(1)},${baseY.toFixed(1)}Z`;
  const animate = !S.drawn && !REDUCED && !DEMO;
  // Direct labels at the line ends; nudged apart when the lines finish close together.
  const ends = [{ y: ly, text: usd(last[1], 0), k: 'Account', bold: true }];
  if (btcPts.length > 1) ends.push({ y: Y(btcPts.at(-1)[1]), text: usd(btcPts.at(-1)[1], 0), k: 'Bitcoin' });
  ends.sort((a, b) => a.y - b.y); if (ends[1] && ends[1].y - ends[0].y < 17) { const mid = (ends[0].y + ends[1].y) / 2; ends[0].y = mid - 8.5; ends[1].y = mid + 8.5; }
  const flip = lx > W - Rm - 132, ex = flip ? lx - 13 : lx + 13;
  const endLabels = v.waiting ? '' : ends.map((e) => `<text class="end ${e.bold ? 'b' : ''}" x="${ex}" y="${e.y + (flip ? -9 : 4)}" text-anchor="${flip ? 'end' : 'start'}"><tspan class="k">${e.k}</tspan> ${e.text}</text>`).join('');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `<defs>
      <linearGradient id="gUp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.acct}" stop-opacity="0.3"/><stop offset="1" stop-color="${C.acct}" stop-opacity="0"/></linearGradient>
      <linearGradient id="gDn" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${C.loss}" stop-opacity="0.28"/><stop offset="1" stop-color="${C.loss}" stop-opacity="0"/></linearGradient>
      <clipPath id="cPlot"><rect x="${L}" y="${T}" width="${W - L - Rm + 4}" height="${H - T - B}"/></clipPath>
      <clipPath id="cUp"><rect x="0" y="0" width="${W}" height="${baseY}"/></clipPath><clipPath id="cDn"><rect x="0" y="${baseY}" width="${W}" height="${H}"/></clipPath>
    </defs>
    ${grid}${days}
    <rect x="${L}" y="${T}" width="${W - L - Rm}" height="${Math.max(0, Y(g.target) - T)}" fill="rgba(242,198,109,0.05)"/>
    <line x1="${L}" x2="${W - Rm}" y1="${Y(g.target)}" y2="${Y(g.target)}" stroke="${C.gold}" stroke-width="1.5"/>
    <text class="ax-goal" x="${W - Rm + 9}" y="${Y(g.target) + 4}">${usd(g.target, 0)}</text><text class="ax-cap" x="${W - Rm + 9}" y="${Y(g.target) - 9}">Goal</text>
    <line x1="${L}" x2="${W - Rm}" y1="${baseY}" y2="${baseY}" stroke="rgba(180,200,230,0.34)"/>
    <text class="ax-start" x="${W - Rm + 9}" y="${baseY + 4}">${usd(g.start, 0)}</text><text class="ax-cap" x="${W - Rm + 9}" y="${baseY + 17}">Start</text>
    ${g.floor ? `<line x1="${L}" x2="${W - Rm}" y1="${Y(g.floor)}" y2="${Y(g.floor)}" stroke="${C.loss}" stroke-width="1.5"/><text class="ax-start" x="${W - Rm + 9}" y="${Y(g.floor) + 4}">${usd(g.floor, 0)}</text><text class="ax-cap" x="${W - Rm + 9}" y="${Y(g.floor) + 17}">Limit</text>` : ''}
    ${ghosts}
    ${pacePts.length ? `<path d="${path(pacePts)}" fill="none" stroke="rgba(220,230,245,0.62)" stroke-width="1.5" stroke-dasharray="5 6" stroke-linecap="round"/>` : ''}
    ${btcPts.length > 1 ? `<path d="${path(btcPts)}" fill="none" stroke="${C.btc}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
    <path d="${area}" fill="url(#gUp)" clip-path="url(#cUp)"/><path d="${area}" fill="url(#gDn)" clip-path="url(#cDn)"/>
    <path class="eq-line ${animate ? 'draw' : ''}" style="--len:${Math.ceil(W * 3)};color:${col}" d="${path(eqPts)}"/>
    ${marks}
    ${v.done ? '' : `<line x1="${lx}" x2="${lx}" y1="${T}" y2="${H - B}" stroke="rgba(244,247,251,0.16)"/><text class="ax-cap" x="${Math.min(lx + 7, W - Rm - 150)}" y="${T - 8}">${DEMO ? `Day ${S.frame + 1}` : v.waiting ? 'The line starts with the first trade' : 'Now'}</text>`}
    ${btcPts.length > 1 ? `<circle cx="${lx}" cy="${Y(btcPts.at(-1)[1])}" r="4" fill="${C.btc}" stroke="${C.surf}" stroke-width="2"/>` : ''}
    <circle class="now-ring" cx="${lx}" cy="${ly}" r="9" style="color:${col}"/><circle cx="${lx}" cy="${ly}" r="6" fill="${col}" stroke="${C.surf}" stroke-width="2"/>
    ${endLabels}
    <rect id="race-hit" x="${L}" y="${T}" width="${W - L - Rm}" height="${H - T - B}" fill="transparent"/><line id="race-x" y1="${T}" y2="${H - B}" stroke="rgba(244,247,251,0.4)" visibility="hidden"/>`;
  S.drawn = true;
  replayPast();
  const note = $('#race-note');
  if (note) {
    const n = (f) => runs.filter(f).length, long = n((r) => r.days * DAY > t1 - t0);
    note.hidden = !runs.length;
    if (runs.length) note.textContent = (timed
      ? `The faint lines are the ${runs.length} runs of ${g.days} days these rules would have had since 2020 on past prices, one after another, each drawn from its first trade. ${n((r) => r.value > past.goal.start)} ended higher (green; the ${n((r) => r.value >= past.goal.target)} in gold doubled) and ${n((r) => r.value <= past.goal.start)} ended lower (red).`
      : `The faint lines are the ${runs.length} runs these rules would have finished since 2020 on past prices, one after another, each drawn from its first trade. ${n((r) => r.end === 'goal')} reached ${pct(g.target / g.start - 1, 0)} (gold) and ${n((r) => r.end === 'limit')} hit ${pct(g.floor / g.start - 1, 0)} (red).${long ? ` ${long} took longer than this chart shows and leave it on the right.` : ''}`)
      + ` Kraken's fees are included. A test on past prices is not a forecast.`;
  }
  const tip = $('#race-tip'), cross = $('#race-x', svg), hit = $('#race-hit', svg);
  hit.onpointermove = (e) => {
    const r = svg.getBoundingClientRect(), mx = ((e.clientX - r.left) / r.width) * W;
    const t = t0 + ((mx - L) / (W - L - Rm)) * (t1 - t0);
    if (v.waiting && runs.length) { // nothing of our own to read yet: point at a past run instead
      const my = ((e.clientY - r.top) / r.height) * H, dN = (t - t0) / DAY; let best = -1, gap = Infinity, by = 0;
      runs.forEach((q, i) => { if (dN > q.days + 2) return; const y = Y((dN >= q.days ? q.value : q.path[clamp(Math.round(dN), 0, q.path.length - 1)]) * gk); if (Math.abs(y - my) < gap) { gap = Math.abs(y - my); best = i; by = y; } });
      for (const p of svg.querySelectorAll('.ghosts path')) p.classList.toggle('on', +p.dataset.run === best);
      tip.style.display = best < 0 ? 'none' : 'block';
      if (best >= 0) { tip.style.left = `${clamp((mx / W) * 100, 18, 82)}%`; tip.style.top = `${(by / H) * 100}%`; tip.innerHTML = `<b>Past run ${best + 1} of ${runs.length}</b> · ${monthU(runs[best].start)}<br><span>${outcome(runs[best])}</span>`; }
      return;
    }
    let p = eqPts[0]; for (const q of eqPts) if (Math.abs(q[0] - t) < Math.abs(p[0] - t)) p = q;
    const b = btcLine.find((c) => c[0] === p[0]);
    cross.setAttribute('x1', X(p[0])); cross.setAttribute('x2', X(p[0])); cross.setAttribute('visibility', 'visible');
    tip.style.display = 'block'; tip.style.left = `${clamp((X(p[0]) / W) * 100, 12, 88)}%`; tip.style.top = `${(Y(p[1]) / H) * 100}%`;
    tip.innerHTML = `<b>${usd(p[1])}</b> · ${when(p[0])}<br><span>${timed ? `Pace ${usd(v.paceAt(p[0]), 0)}` : `Day ${Math.floor((p[0] - t0) / DAY) + 1}`}${b ? ` · Bitcoin hold ${usd(b[1], 0)}` : ''}</span>`;
  };
  hit.onpointerleave = () => { tip.style.display = 'none'; cross.setAttribute('visibility', 'hidden'); for (const p of svg.querySelectorAll('.ghosts path.on')) p.classList.remove('on'); };
  if (!$('#race-legend').dataset.built) {
    $('#race-legend').dataset.built = '1';
    $('#race-h').textContent = `The race to ${usd(g.target, 0)}`;
    $('#race-legend').innerHTML = `<span><i class="ln" style="background:${C.acct}"></i>Account</span>${timed ? '<span><i class="ln dash"></i>Pace needed to double</span>' : `<span><i class="ln" style="background:${C.gold}"></i>Goal</span><span><i class="ln" style="background:${C.loss}"></i>Loss limit</span>`}<span><i class="ln" style="background:${C.btc}"></i>Just holding Bitcoin</span>${runs.length ? '<span><i class="ln past"></i>Past test runs</span>' : ''}<span><i class="tri" style="border-bottom-color:${C.acct}"></i>Bought</span><span><i class="tri dn" style="border-top-color:${C.btc}"></i>Sold</span>`;
  }
}

// ---------- candle charts ----------
const CH = []; // what each drawn candle chart holds, for the hover read-out
const SLOT = new Map(); let slotN = 0;
const slot = (sym, o) => { const id = `s${slotN++}`; SLOT.set(id, { sym, o }); return `<div class="chart-slot" data-slot="${id}"></div>`; };
// A chart sweeps in from the left the first time it appears. The page redraws often, so a sweep that is still
// running carries on from where it was instead of starting again.
const SWEPT = new Map(), SWEEP_MS = 1100;
function fillSlots(root) {
  for (const el of $$('.chart-slot', root)) {
    const s = SLOT.get(el.dataset.slot);
    if (!s) continue;
    el.innerHTML = candleChart(s.sym, { ...s.o, w: el.clientWidth });
    const svg = $('svg.candles', el), k = `${s.sym}|${s.o.tf ?? chartTf()}|${el.closest('[id]')?.id}`;
    if (!svg || REDUCED) continue;
    if (!SWEPT.has(k)) SWEPT.set(k, performance.now());
    const gone = performance.now() - SWEPT.get(k);
    if (gone < SWEEP_MS) { svg.classList.add('wipe'); svg.style.animationDelay = `${-gone.toFixed(0)}ms`; }
  }
}
function sma(rows, n) { const out = []; let sum = 0; for (let i = 0; i < rows.length; i++) { sum += rows[i][4]; if (i >= n) sum -= rows[i - n][4]; out.push(i >= n - 1 ? sum / n : NaN); } return out; }
// RSI (Wilder's, on closes): 0 to 100; above 70 a coin has run hard, below 30 it has been sold hard.
function rsiOf(rows, n = 14) {
  const out = new Array(rows.length).fill(NaN); let up = 0, dn = 0;
  for (let i = 1; i < rows.length; i++) {
    const ch = rows[i][4] - rows[i - 1][4], u = Math.max(ch, 0), d = Math.max(-ch, 0);
    if (i <= n) { up += u / n; dn += d / n; } else { up = (up * (n - 1) + u) / n; dn = (dn * (n - 1) + d) / n; }
    if (i >= n) out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
  }
  return out;
}
// The highest close of the n bars before each bar: the price a close has to beat to count as a breakout.
function highPrev(rows, n) { return rows.map((_, i) => { if (i < n) return NaN; let m = -Infinity; for (let j = i - n; j < i; j++) if (rows[j][4] > m) m = rows[j][4]; return m; }); }
const big = (x) => (!Number.isFinite(x) ? '–' : x >= 1e9 ? `$${(x / 1e9).toFixed(x >= 1e10 ? 0 : 1)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(x >= 1e7 ? 0 : 1)}M` : x >= 1e3 ? `$${(x / 1e3).toFixed(0)}K` : `$${Math.round(x)}`);
const barTime = (t, tf) => (tf === '4h' ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' }) : dateU(t));

// The TBO's marks, drawn the way the indicator draws them on TradingView: [name, side (-1 below the bar, 1 above), colour, shape].
const TBO_UP = '#6cd9ba', TBO_DN = '#f280b6';
const SIG = {
  ol: ['Open Long', -1, '#00e676', 'up'], bo: ['Breakout', -1, '#ffffff', 'arrowUp'], cs: ['Close Short', -1, '#ff9800', 'diamond'], cd: ['Cross Down', -1, '#ff5252', 'cross'],
  os: ['Open Short', 1, '#e040fb', 'down'], bd: ['Breakdown', 1, '#ffeb3b', 'arrowDown'], cl: ['Close Long', 1, '#5b8cff', 'diamond'], cu: ['Cross Up', 1, '#00e676', 'cross'], sq: ['Squeeze', 1, '#b4c0d2', 'ring'],
};
function glyph(shape, x, y, q, col) {
  const f = (n) => n.toFixed(1), edge = `stroke="${C.surf}" stroke-width="1"`;
  if (shape === 'up') return `<path d="M${f(x)},${f(y - q)}L${f(x + q)},${f(y + q)}H${f(x - q)}Z" fill="${col}" ${edge}/>`;
  if (shape === 'down') return `<path d="M${f(x)},${f(y + q)}L${f(x + q)},${f(y - q)}H${f(x - q)}Z" fill="${col}" ${edge}/>`;
  if (shape === 'diamond') return `<path d="M${f(x)},${f(y - q)}L${f(x + q)},${f(y)}L${f(x)},${f(y + q)}L${f(x - q)},${f(y)}Z" fill="${col}" ${edge}/>`;
  if (shape === 'cross') return `<path d="M${f(x - q)},${f(y - q)}L${f(x + q)},${f(y + q)}M${f(x + q)},${f(y - q)}L${f(x - q)},${f(y + q)}" stroke="${col}" stroke-width="2" stroke-linecap="round" fill="none"/>`;
  if (shape === 'ring') return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(q * 0.7)}" fill="none" stroke="${col}" stroke-width="1.4"/>`;
  const d = shape === 'arrowUp' ? -1 : 1; // a short arrow
  return `<path d="M${f(x)},${f(y + d * q * 1.2)}L${f(x + q)},${f(y)}H${f(x + q * 0.42)}V${f(y - d * q * 1.1)}H${f(x - q * 0.42)}V${f(y)}H${f(x - q)}Z" fill="${col}" ${edge}/>`;
}
// The bot's TBO numbers for a coin, lined up with the candles on screen (NaN where the bot has no bar yet).
function tboFor(sym, view) {
  const T = S.tboChart?.coins?.[sym];
  if (!T) return null;
  const at = new Map(), len = T.fast.length;
  for (let i = 0; i < len; i++) at.set(T.t0 + (T.t ? T.t[i] : i) * S.tboChart.bar, i);
  const idx = view.map((c) => at.get(c[0])), pick = (arr) => idx.map((j) => (j == null ? NaN : arr[j] ?? NaN));
  const steps = (list) => { const out = new Array(len).fill(NaN); list.forEach(([i, val], k) => { const end = list[k + 1]?.[0] ?? len; for (let j = i; j < end; j++) out[j] = val ?? NaN; }); return out; };
  const back = new Map(); idx.forEach((j, k) => { if (j != null) back.set(j, k); });
  return { fast: pick(T.fast), midFast: pick(T.midFast), midSlow: pick(T.midSlow), slow: pick(T.slow), sup: pick(steps(T.sup)), res: pick(steps(T.res)), avg: T.avg ? pick(T.avg) : null,
    sig: T.sig.flatMap(([j, code]) => (back.has(j) && SIG[code] ? [[back.get(j), code]] : [])) };
}
/** o: { lines: [{ y, label, color, dash }], zones: [{ y0, y1, color, fromT }], markT, avg: days, n, h, w, key }.
 *  Under the price pane sit a volume pane and an RSI pane. A daily chart also shows the breakout line (the highest
 *  close of the last 20 days); a TBO desk's 4-hour chart shows the TBO's own lines, clouds, signals and levels. */
function candleChart(sym, o = {}) {
  const tf = o.tf ?? chartTf(), rows = candlesFor(sym, tf);
  if (!rows || rows.length < 5) return `<div class="empty">Loading the chart…</div>`;
  const W = Math.max(260, Math.round(o.w || 640)), PR = 96, PT = 12, PB = 22, MH = (o.h ?? 250) - PB, GAP = 12;
  const hasVol = Number.isFinite(rows.at(-1)[5]), VH = hasVol ? 46 : 0, RH = 62;
  const yV = MH + GAP, yR = yV + (hasVol ? VH + GAP : 0), H = yR + RH + PB, plot = W - PR;
  const n = Math.min(o.n ?? Math.max(30, Math.min(110, Math.floor(plot / 7))), rows.length);
  const view = rows.slice(-n), coin = sym.replace('USDT', '');
  const tb = tf === '4h' ? tboFor(sym, view) : null;
  const avg = tf === '1d' ? (o.avg ? sma(rows, o.avg).slice(-n) : null) : tb?.avg ?? null;
  const boN = tf === '1d' && !isTbo(S.d) ? S.d.rules?.playbooks?.trend?.breakout ?? 0 : 0, bo = boN ? highPrev(rows, boN).slice(-n) : null;
  const rsi = rsiOf(rows).slice(-n);
  const lines = (o.lines ?? []).filter((l) => Number.isFinite(l.y) && l.y > 0);
  let lo = Math.min(...view.map((c) => c[3])), hi = Math.max(...view.map((c) => c[2]));
  const fit = (y) => { if (Number.isFinite(y) && y > lo * 0.6 && y < hi * 1.5) { lo = Math.min(lo, y); hi = Math.max(hi, y); } };
  const lo0 = lo, hi0 = hi; // extra lines may widen the scale, but only when they are near the candles
  for (const l of lines) if (l.y > lo0 * 0.6 && l.y < hi0 * 1.5) fit(l.y);
  for (const arr of [avg, bo, tb?.fast, tb?.midFast, tb?.midSlow, tb?.slow]) if (arr) for (const y of arr) if (y > lo0 * 0.8 && y < hi0 * 1.25) fit(y);
  const pad = (hi - lo) * 0.07; lo -= pad; hi += pad;
  const step = plot / n, bw = clamp(step * 0.6, 2, 9), f = (x) => x.toFixed(1);
  const X = (i) => i * step + step / 2, Y = (y) => PT + (1 - (y - lo) / (hi - lo)) * (MH - PT);
  const xOfT = (t) => { let k = view.findIndex((c) => c[0] + TF[tf].ms > t); if (k < 0) k = view.length - 1; return X(Math.max(0, k)); };
  const path = (arr, yOf = Y) => { let d = '', pen = false; arr.forEach((a, i) => { if (Number.isFinite(a)) { d += `${pen ? 'L' : 'M'}${f(X(i))},${f(yOf(a))}`; pen = true; } else pen = false; }); return d; };
  let s = `<clipPath id="cp${CH.length}"><rect x="0" y="${PT - 6}" width="${plot}" height="${MH - PT + 10}"/></clipPath>`;
  for (let k = 0; k <= 3; k++) { const y = lo + ((hi - lo) * (k + 0.5)) / 4; s += `<line x1="0" x2="${plot}" y1="${f(Y(y))}" y2="${f(Y(y))}" stroke="${C.grid}"/>`; }
  for (const z of o.zones ?? []) { const x0 = z.fromT ? Math.max(0, xOfT(z.fromT) - step / 2) : 0; const ya = Y(clamp(z.y1, lo, hi)), yb = Y(clamp(z.y0, lo, hi)); s += `<rect x="${x0}" y="${Math.min(ya, yb)}" width="${plot - x0}" height="${Math.abs(yb - ya)}" fill="${z.color}"/>`; }
  if (tb) {
    // Clouds between the TBO's lines: green where the faster line is on top, pink where it is underneath.
    let g = `<g clip-path="url(#cp${CH.length})">`;
    for (const [a, b, al] of [[tb.fast, tb.midFast, 0.16], [tb.midFast, tb.midSlow, 0.2], [tb.midSlow, tb.slow, 0.24]]) {
      const d = { up: '', dn: '' };
      for (let i = 0; i < n - 1; i++) if ([a[i], b[i], a[i + 1], b[i + 1]].every(Number.isFinite)) d[a[i] >= b[i] ? 'up' : 'dn'] += `M${f(X(i))},${f(Y(a[i]))}L${f(X(i + 1))},${f(Y(a[i + 1]))}L${f(X(i + 1))},${f(Y(b[i + 1]))}L${f(X(i))},${f(Y(b[i]))}Z`;
      g += `<path d="${d.up}" fill="${TBO_UP}" opacity="${al}"/><path d="${d.dn}" fill="${TBO_DN}" opacity="${al}"/>`;
    }
    // Support and resistance: a dot per bar, green while the price is above the level and red while it is below.
    const dots = { up: '', dn: '' }, dot = (x, y) => `M${f(x - 1.4)},${f(y)}a1.4,1.4 0 1,0 2.8,0a1.4,1.4 0 1,0 -2.8,0`;
    for (const arr of [tb.sup, tb.res]) arr.forEach((y, i) => { if (Number.isFinite(y) && y > lo && y < hi) dots[view[i][4] > y ? 'up' : 'dn'] += dot(X(i), Y(y)); });
    s += `${g}<path d="${dots.up}" fill="${C.acct}" opacity="0.9"/><path d="${dots.dn}" fill="${C.loss}" opacity="0.9"/></g>`;
  }
  view.forEach((c, i) => {
    const col = c[4] >= c[1] ? C.acct : C.loss, x = X(i);
    s += `<line x1="${f(x)}" x2="${f(x)}" y1="${f(Y(c[2]))}" y2="${f(Y(c[3]))}" stroke="${col}" stroke-width="1.2"/><rect x="${f(x - bw / 2)}" y="${f(Y(Math.max(c[1], c[4])))}" width="${f(bw)}" height="${f(Math.max(1.2, Math.abs(Y(c[1]) - Y(c[4]))))}" fill="${col}" rx="1.2"/>`;
  });
  if (bo) s += `<path d="${path(bo)}" fill="none" stroke="${C.mint}" stroke-width="1.3" stroke-dasharray="5 4" stroke-linejoin="round" opacity="0.85" clip-path="url(#cp${CH.length})"/>`;
  if (avg) s += `<path d="${path(avg)}" fill="none" stroke="${C.gold}" stroke-width="2" stroke-linejoin="round" clip-path="url(#cp${CH.length})"/>`;
  if (tb) {
    // The fast line, coloured like the indicator: green above its mid-fast line, pink below.
    const d = { up: '', dn: '' };
    for (let i = 0; i < n - 1; i++) if (Number.isFinite(tb.fast[i]) && Number.isFinite(tb.fast[i + 1])) d[tb.fast[i] >= tb.midFast[i] ? 'up' : 'dn'] += `M${f(X(i))},${f(Y(tb.fast[i]))}L${f(X(i + 1))},${f(Y(tb.fast[i + 1]))}`;
    s += `<g clip-path="url(#cp${CH.length})" fill="none" stroke-width="2.2" stroke-linecap="round"><path d="${d.up}" stroke="${TBO_UP}"/><path d="${d.dn}" stroke="${TBO_DN}"/></g>`;
    const stack = {};
    for (const [i, code] of tb.sig) {
      const [, side, col, shape] = SIG[code], k = `${i}|${side}`, m = (stack[k] = (stack[k] ?? 0) + 1) - 1, c = view[i];
      s += glyph(shape, X(i), clamp(side < 0 ? Y(c[3]) + 9 + m * 11 : Y(c[2]) - 9 - m * 11, PT + 2, MH - 4), clamp(step * 0.55, 3.4, 4.8), col);
    }
  }
  if (o.markT) { const x = xOfT(o.markT), c = view[Math.round((x - step / 2) / step)] ?? view.at(-1); s += `<path d="M${x},${Y(c[3]) + 7}l6,10h-12z" fill="${C.ink}" stroke="${C.surf}" stroke-width="1.5"/>`; }
  const lastC = view.at(-1)[4], end = (arr) => arr?.findLast?.(Number.isFinite);
  const named = (name) => lines.some((l) => l.label === name);
  const labs = [...lines.map((l) => ({ ...l, py: Y(clamp(l.y, lo, hi)) })),
    ...(avg && Number.isFinite(end(avg)) ? [{ y: end(avg), label: `${o.avg ?? 50}-day average`, color: C.gold, noLine: true }] : []),
    ...(bo && Number.isFinite(end(bo)) && !named('Breakout') ? [{ y: end(bo), label: `${boN}-day high`, color: C.mint, noLine: true }] : []),
    ...(tb && Number.isFinite(end(tb.fast)) ? [{ y: end(tb.fast), label: 'TBO fast line', color: end(tb.fast) >= end(tb.midFast) ? TBO_UP : TBO_DN, noLine: true }] : []),
    { y: lastC, label: 'Now', color: C.ink, now: true }].map((l) => ({ ...l, py: l.py ?? Y(clamp(l.y, lo, hi)) })).sort((a, b) => a.py - b.py);
  for (let i = 1; i < labs.length; i++) { const prev = labs[i - 1].ly ?? labs[i - 1].py; if (labs[i].py - prev < 27) labs[i].ly = prev + 27; }
  const over = (labs.at(-1).ly ?? labs.at(-1).py) - (MH - 10); if (over > 0) for (const l of labs) l.ly = (l.ly ?? l.py) - over;
  const tag = (ly, color, label, val) => `<rect x="${plot + 7}" y="${f(ly - 9)}" width="3" height="20" rx="1.5" fill="${color}"/><text class="lbl" x="${plot + 15}" y="${f(ly)}">${esc(label)}</text><text class="val" x="${plot + 15}" y="${f(ly + 12)}">${val}</text>`;
  for (const l of labs) {
    if (!l.noLine) s += `<line x1="0" x2="${plot}" y1="${f(l.py)}" y2="${f(l.py)}" stroke="${l.color}" stroke-width="${l.now ? 1 : 1.5}" stroke-dasharray="${l.now ? '1 4' : l.dash ?? ''}" opacity="${l.now ? 0.55 : 0.95}"/>`;
    s += tag(l.ly ?? l.py, l.color, l.label, price(l.y));
  }
  s += `${DEMO ? '' : `<circle class="now-pulse" cx="${f(X(n - 1))}" cy="${f(Y(lastC))}" r="4"/>`}<circle cx="${f(X(n - 1))}" cy="${f(Y(lastC))}" r="4" fill="${C.ink}" stroke="${C.surf}" stroke-width="2"/>`;
  // Volume: dollars traded in each bar, with its 20-bar average.
  if (hasVol) {
    const vAvg = sma(rows.map((c) => [0, 0, 0, 0, c[5]]), 20).slice(-n), vMax = Math.max(...view.map((c) => c[5]), 1), VY = (x) => yV + VH - (x / vMax) * (VH - 3);
    s += `<line x1="0" x2="${plot}" y1="${yV + VH}" y2="${yV + VH}" stroke="${C.grid}"/>`;
    view.forEach((c, i) => { s += `<rect x="${f(X(i) - bw / 2)}" y="${f(VY(c[5]))}" width="${f(bw)}" height="${f(Math.max(0.6, yV + VH - VY(c[5])))}" fill="${c[4] >= c[1] ? C.acct : C.loss}" opacity="0.6"/>`; });
    s += `<path d="${path(vAvg, VY)}" fill="none" stroke="${C.ink2}" stroke-width="1.2" opacity="0.8"/>${tag(yV + VH / 2 - 4, C.ink3, 'Volume', big(view.at(-1)[5]))}`;
  }
  // RSI with the usual 70 and 30 lines (the pane shows 10 to 90, where nearly all readings fall).
  const RY = (x) => yR + RH - ((clamp(x, 10, 90) - 10) / 80) * RH, rNow = end(rsi);
  s += `<rect x="0" y="${f(RY(70))}" width="${plot}" height="${f(RY(30) - RY(70))}" fill="rgba(180,200,230,0.045)"/>`;
  for (const lv of [70, 30]) s += `<line x1="0" x2="${plot}" y1="${f(RY(lv))}" y2="${f(RY(lv))}" stroke="rgba(180,200,230,0.28)" stroke-dasharray="3 4"/><text class="tick" x="${plot - 3}" y="${f(RY(lv) - 3)}" text-anchor="end">${lv}</text>`;
  s += `<path d="${path(rsi, RY)}" fill="none" stroke="${C.btc}" stroke-width="1.7" stroke-linejoin="round"/>`;
  if (Number.isFinite(rNow)) s += `<circle cx="${f(X(n - 1))}" cy="${f(RY(rNow))}" r="3" fill="${C.btc}" stroke="${C.surf}" stroke-width="1.5"/>${tag(yR + RH / 2 - 4, C.btc, 'RSI (14)', rNow.toFixed(0))}`;
  s += `<text x="0" y="${H - 5}">${barTime(view[0][0], tf)}</text><text x="${plot}" y="${H - 5}" text-anchor="end">${barTime(view.at(-1)[0], tf)}</text>`;
  s += `<line class="cx" x1="0" x2="0" y1="${PT}" y2="${yR + RH}" stroke="rgba(244,247,251,0.4)" visibility="hidden"/>`;
  CH.push({ view, step, W, plot, tf, rsi, tb });
  const key = !o.key ? '' : tb
    ? `<div class="ch-key"><span><i class="ln" style="background:linear-gradient(90deg,${TBO_UP} 50%,${TBO_DN} 50%)"></i>TBO fast line and trend clouds (green up, pink down)</span>${Object.values(SIG).slice(0, 8).map(([name, , col, shape]) => `<span><svg viewBox="-6 -6 12 12" width="12" height="12" aria-hidden="true">${glyph(shape, 0, 0, 4.2, col)}</svg>${name}</span>`).join('')}<span><i class="dotk"></i>Support and resistance</span>${avg ? `<span><i class="ln" style="background:${C.gold}"></i>${o.avg ?? 50}-day average (the market light)</span>` : ''}</div>`
    : `<div class="ch-key">${avg ? `<span><i class="ln" style="background:${C.gold}"></i>${o.avg}-day average${sym === 'BTCUSDT' ? ' (the market light)' : ''}</span>` : ''}${bo ? `<span><i class="ln dash" style="color:${C.mint}"></i>${boN}-day high: a daily close above it is a breakout</span>` : ''}${hasVol ? '<span>Volume in US dollars, with its 20-day average</span>' : ''}<span>RSI above 70: it has run hard · below 30: sold hard</span></div>`;
  return `<svg class="candles" data-ci="${CH.length - 1}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(coin)} ${TF[tf].word} price chart${tb ? ' with the TBO' : ''}, volume and RSI">${s}</svg>${key}`;
}
// One hover read-out for every candle chart: the bar, its close and range, its volume and RSI, and any TBO signal on it.
let hot = null;
function candleHover(e) {
  const svg = e.target.closest?.('svg.candles'), tip = $('#tip');
  if (hot && hot !== svg) { $('.cx', hot)?.setAttribute('visibility', 'hidden'); hot = null; }
  const c = svg && CH[+svg.dataset.ci];
  if (!c) { tip.style.display = 'none'; return; }
  const r = svg.getBoundingClientRect(), mx = ((e.clientX - r.left) / r.width) * c.W;
  if (mx > c.plot) { tip.style.display = 'none'; $('.cx', svg).setAttribute('visibility', 'hidden'); return; }
  const i = clamp(Math.floor(mx / c.step), 0, c.view.length - 1), k = c.view[i], x = i * c.step + c.step / 2, cx = $('.cx', svg);
  cx.setAttribute('x1', x); cx.setAttribute('x2', x); cx.setAttribute('visibility', 'visible'); hot = svg;
  const extra = [Number.isFinite(k[5]) ? `Volume ${big(k[5])}` : '', Number.isFinite(c.rsi[i]) ? `RSI ${c.rsi[i].toFixed(0)}` : ''].filter(Boolean).join(' · ');
  const sigs = c.tb ? c.tb.sig.filter((g) => g[0] === i).map((g) => SIG[g[1]][0]) : [];
  const tbo = c.tb && Number.isFinite(c.tb.fast[i]) ? `TBO fast line ${price(c.tb.fast[i])}, ${c.tb.fast[i] >= c.tb.midFast[i] ? 'above' : 'below'} its mid-fast line${sigs.length ? ` · <b>${sigs.join(', ')}</b>` : ''}` : '';
  tip.innerHTML = `<b>${price(k[4])}</b> · ${barTime(k[0], c.tf)}<br><span>${c.tf === '4h' ? "Bar's" : "Day's"} range ${price(k[3])} to ${price(k[2])} · ${pct(k[4] / k[1] - 1)}</span>${extra ? `<br><span>${extra}</span>` : ''}${tbo ? `<br><span>${tbo}</span>` : ''}`;
  tip.style.display = 'block';
  tip.style.left = `${clamp(e.clientX, 110, innerWidth - 110)}px`; tip.style.top = `${e.clientY - 14}px`;
}

// ---------- trades and the market light ----------
function renderTrades(v) {
  const d = v.d, L = light(v);
  const cards = v.positions.map((p) => {
    const dist = p.stop > 0 ? 1 - p.stop / p.price : null;
    const locked = p.lockedPnl != null && p.lockedPnl > 0;
    return `<article class="panel card ${p.pnl >= 0 ? 'win' : 'loss'}">
      <div class="card-top">${avatar(p.coin)}<div class="grow"><h3>${esc(p.coin)}</h3><div class="sub">${v.tbo ? 'TBO Open Long' : 'Breakout swing'} · bought ${when(p.openedT)}</div></div>
        <div class="right"><div class="pnl ${cls(p.pnl)}">${signUsd(p.pnl)}</div><div class="sub ${cls(p.pnl)}">${pct(p.pnlPct)}</div></div></div>
      ${slot(p.symbol, { avg: 50, markT: p.openedT, lines: [{ y: p.entry, label: 'Bought', color: C.btc }, { y: p.stop, label: p.stop > p.initialStop ? 'Trailing stop' : 'Stop-loss', color: C.loss, dash: '5 4' }],
        zones: [{ y0: p.stop, y1: p.entry, color: p.stop >= p.entry ? 'rgba(32,176,98,0.12)' : 'rgba(236,94,109,0.1)', fromT: p.openedT }, ...(p.price > p.entry ? [{ y0: Math.max(p.entry, p.stop), y1: p.price, color: 'rgba(32,176,98,0.12)', fromT: p.openedT }] : [])] })}
      <div class="stats"><div><b>${usd(p.value, 0)}</b><span>${pct(v.equity ? p.value / v.equity : 0, 0, false)} of the account</span></div>
        <div><b>${price(p.price)}</b><span>now · bought ${price(p.entry)}</span></div>
        <div><b>${dist == null ? '–' : pct(dist, 1, false)}</b><span>above the stop</span></div>
        <div><b class="${locked ? 'up' : 'down'}">${p.lockedPnl == null ? '–' : signUsd(p.lockedPnl, 0)}</b><span>${locked ? 'locked in if stopped' : 'if the stop is hit'}</span></div></div>
      <p class="why">${esc(p.why)}${p.exitPending ? ' <span class="badge">Selling at the next check</span>' : ''}</p></article>`;
  });
  for (const o of d.pending.filter((x) => x.kind === 'entry')) cards.push(`<article class="panel card wait"><div class="card-top">${avatar(o.coin)}<div class="grow"><h3>Buying ${esc(o.coin)}</h3><div class="sub">Order placed at the ${v.tbo ? '4-hour' : 'daily'} close; fills at the next check</div></div><div class="right"><div class="pnl">${usd(o.usd, 0)}</div></div></div>
    ${slot(o.symbol, { avg: 50, lines: [{ y: o.stop, label: 'Stop-loss', color: C.loss, dash: '5 4' }] })}<p class="why">${esc(o.why)}</p></article>`);
  // The market light: Bitcoin against its average decides whether the trader may buy at all.
  const gp = clamp(L.gap, -0.2, 0.2), at = 50 + (gp / 0.2) * 50;
  const need = L.above ? `${pct(L.gap, 1, false)} of room above the line` : `Needs ${pct(L.sma / v.btcNow - 1, 1)} to get back to the line`;
  cards.push(`<article class="panel card market ${L.on ? 'on' : 'off'}"><div class="mk-info">
      <div class="mk-head"><div class="lamp big" aria-hidden="true">${L.on ? '✓' : '‖'}</div><div><div class="label">Market light</div><h3>${L.headline}</h3></div></div>
      <p class="why">${L.body}</p>
      <div class="gauge" role="img" aria-label="${esc(L.line)}"><div class="g-need"><b>${need}</b></div>
        <div class="g-track"><i class="g-fill ${L.above ? 'up' : 'dn'}" style="left:${Math.min(50, at).toFixed(1)}%;width:${Math.abs(at - 50).toFixed(1)}%"></i><i class="g-mid"></i><i class="g-dot ${L.above ? 'up' : 'dn'}" style="left:${at.toFixed(1)}%"></i></div>
        <div class="g-labels"><span>20% below</span><span>${L.n}-day average · ${price(L.sma)}</span><span>20% above</span></div></div>
    </div><div class="mk-chart">${slot('BTCUSDT', { avg: L.n, h: 270, key: true })}</div></article>`);
  const box = $('#trades');
  box.className = `trades n${Math.min(cards.length, 4)}`;
  box.innerHTML = cards.join('');
  fillSlots(box);
  $('#trades-sub').textContent = v.positions.length ? `${plural(v.positions.length, 'open trade')} · ${usd(v.invested, 0)} invested · ${usd(d.account.cash, 0)} in cash` : 'No open trades: the whole account is in cash.';
}

// ---------- radar ----------
// ready = every condition met; armed = the coin is ready but Bitcoin is not; far = not there yet.
const kindOf = (r) => (r.checks.length && r.checks.every((k) => k.ok) ? 'ready' : r.checks.length && r.checks.filter((k) => k.key !== 'regime').every((k) => k.ok) ? 'armed' : 'far');
// In words, how far a coin is from being bought.
const howFar = (v, r) => (v.tbo ? (r.distancePct === 0 ? 'Open Long has fired' : `fast line ${pct(r.distancePct, 1, false)} below its mid-fast line`) : r.distancePct === 0 ? 'at its breakout price' : `${pct(r.distancePct, 1, false)} below its breakout`);
// A radar scope: distance from the centre is how far the coin is from its buy signal.
function scope(v, list) {
  const Z = 420, c = Z / 2, R = c - 30, on = v.d.regime.on;
  const span = v.tbo ? 0.08 : 0.25;
  const rad = (dp) => R * (dp <= 0 ? 0.2 : 0.2 + 0.8 * Math.sqrt(Math.min(dp, span) / span)); // square-root scale: more room near the buy signal
  const order = [...list].sort((a, b) => a.coin.localeCompare(b.coin));
  let h = `<defs><radialGradient id="scp"><stop offset="0" stop-color="${on ? 'rgba(93,242,138,0.2)' : 'rgba(242,198,109,0.16)'}"/><stop offset="0.6" stop-color="rgba(60,110,190,0.07)"/><stop offset="1" stop-color="rgba(60,110,190,0.02)"/></radialGradient></defs>
    <circle cx="${c}" cy="${c}" r="${R}" fill="url(#scp)" stroke="rgba(180,200,230,0.28)"/>`;
  for (const [dp, lab] of v.tbo ? [[0.005, '0.5%'], [0.02, '2%'], [0.045, '4.5% below']] : [[0.02, '2%'], [0.06, '6%'], [0.14, '14% below']]) h += `<circle cx="${c}" cy="${c}" r="${rad(dp)}" fill="none" stroke="rgba(180,200,230,0.13)"/><text class="ring" x="${c}" y="${c - rad(dp) + 13}" text-anchor="middle">${lab}</text>`;
  h += `<circle cx="${c}" cy="${c}" r="${rad(0)}" fill="${on ? 'rgba(93,242,138,0.08)' : 'rgba(242,198,109,0.07)'}" stroke="${on ? 'rgba(93,242,138,0.75)' : 'rgba(242,198,109,0.7)'}" stroke-width="1.5"/>
    <text class="core" x="${c}" y="${c - 3}" text-anchor="middle">${v.tbo ? 'Open Long' : 'Breakout'}</text><text class="core s" x="${c}" y="${c + 11}" text-anchor="middle">${on ? 'buy zone' : 'locked'}</text>
    <line x1="${c - R}" x2="${c + R}" y1="${c}" y2="${c}" stroke="rgba(180,200,230,0.07)"/><line x1="${c}" x2="${c}" y1="${c - R}" y2="${c + R}" stroke="rgba(180,200,230,0.07)"/>`;
  if (!REDUCED) {
    let w = '';
    for (let i = 0; i < 7; i++) { const a0 = (-i * 9 * Math.PI) / 180, a1 = (-(i + 1) * 9 * Math.PI) / 180; w += `<path d="M${c},${c}L${c + R * Math.cos(a0)},${c + R * Math.sin(a0)}A${R},${R} 0 0 0 ${c + R * Math.cos(a1)},${c + R * Math.sin(a1)}Z" fill="${on ? '#5df28a' : '#f2c66d'}" opacity="${(0.13 * (1 - i / 7)).toFixed(3)}"/>`; }
    h += `<g class="sweep" style="transform-origin:${c}px ${c}px">${w}<line x1="${c}" y1="${c}" x2="${c + R}" y2="${c}" stroke="${on ? '#5df28a' : '#f2c66d'}" stroke-opacity="0.55" stroke-width="1.2"/></g>`;
  }
  order.forEach((r, i) => {
    const a = -Math.PI / 2 + ((i + 0.5) / order.length) * Math.PI * 2, rr = rad(r.distancePct), x = c + rr * Math.cos(a), y = c + rr * Math.sin(a);
    const kind = kindOf(r), sel = r.symbol === S.sel, cos = Math.cos(a), sin = Math.sin(a), far = howFar(v, r);
    const tx = x + cos * 12, ty = y + sin * 12 + 4, anchor = cos > 0.35 ? 'start' : cos < -0.35 ? 'end' : 'middle';
    h += `<g class="blip ${kind} ${sel ? 'sel' : ''}" data-sym="${esc(r.symbol)}" role="button" tabindex="0" aria-label="${esc(r.coin)}: ${far}">
      <title>${esc(r.coin)} · ${far}\n${esc(r.checks.map((k) => `${k.ok ? '✓' : '✗'} ${k.label}`).join('\n'))}</title>
      <circle class="hit" cx="${x}" cy="${y}" r="16"/>${sel ? `<circle class="selring" cx="${x}" cy="${y}" r="11"/>` : ''}${kind !== 'far' ? `<circle class="ping" cx="${x}" cy="${y}" r="6"/>` : ''}
      <circle class="dot" cx="${x}" cy="${y}" r="5.5"/><text x="${tx}" y="${ty + (anchor === 'middle' ? (sin > 0 ? 9 : -5) : 0)}" text-anchor="${anchor}">${esc(r.coin)}</text></g>`;
  });
  return `<svg class="scope" viewBox="0 0 ${Z} ${Z}" role="group" aria-label="Radar: coins by how close they are to a breakout">${h}</svg>`;
}
function renderRadar(v) {
  const list = v.radar.slice(0, 10);
  if (!list.length) {
    $('#scope').innerHTML = ''; $('#scope-key').innerHTML = ''; $('#radar-detail').innerHTML = '';
    $('#radar').innerHTML = `<div class="empty"><strong>Nothing on the radar yet</strong>The list fills in after the next ${v.tbo ? '4-hour' : 'daily'} close.</div>`; return;
  }
  if (!list.some((r) => r.symbol === S.sel)) S.sel = list[0].symbol;
  $('#scope').innerHTML = scope(v, list);
  $('#radar-sub').textContent = v.tbo ? 'The closer a coin is to the centre, the closer its TBO is to an Open Long on the 4-hour chart. Tap a coin to see its 4-hour chart with the TBO on it.' : 'The closer a coin is to the centre, the closer it is to a breakout. Tap a coin to see its chart.';
  $('#scope-key').innerHTML = `<span><i class="ready"></i>All conditions met</span><span><i class="armed"></i>Ready, waiting on Bitcoin</span><span><i class="far"></i>Not there yet</span>`;
  $('#radar').innerHTML = list.map((r) => {
    const kind = kindOf(r), ready = kind === 'ready';
    const span = v.tbo ? 0.08 : 0.25, w = Math.max(4, (1 - Math.sqrt(Math.min(r.distancePct, span) / span)) * 100);
    return `<button class="row" data-sym="${esc(r.symbol)}" aria-pressed="${r.symbol === S.sel}">${avatar(r.coin)}
      <span class="nm"><b>${esc(r.coin)}</b><span class="${cls(r.change24h)}">${pct(r.change24h)}</span></span>
      <span class="px"><span class="prox ${kind}"><i style="width:${w.toFixed(0)}%"></i></span><span class="prox-l">${ready ? 'All conditions met' : howFar(v, r).replace(/^./, (c) => c.toUpperCase())}</span></span>
      <span class="dots" title="${esc(r.checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.label}`).join('\n'))}">${r.checks.map((c) => `<i class="${c.ok ? 'ok' : ''}"></i>`).join('')}</span></button>`;
  }).join('');
  const pick = (sym) => { S.sel = sym; renderRadar(view()); };
  $$('#radar .row').forEach((b) => { b.onclick = () => pick(b.dataset.sym); });
  $$('#scope .blip').forEach((b) => { b.onclick = () => pick(b.dataset.sym); b.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(b.dataset.sym); } }; });
  const r = list.find((x) => x.symbol === S.sel), box = $('#radar-detail');
  box.innerHTML = `<div class="card-top">${avatar(r.coin)}<div class="grow"><h3>${esc(r.coin)}</h3><div class="sub">${esc(r.text)}</div></div><div class="right"><div class="pnl">${price(r.price)}</div><div class="sub ${cls(r.change24h)}">${pct(r.change24h)} today</div></div></div>
    ${slot(r.symbol, { avg: 50, h: 280, key: true, lines: v.tbo ? [] : [{ y: r.levels.hi ?? r.trigger, label: 'Breakout', color: C.mint, dash: '6 4' }] })}
    <ul class="checks">${r.checks.map((c) => `<li class="${c.ok ? 'ok' : ''}"><span class="ic">${c.ok ? '✓' : '·'}</span>${esc(c.label)}</li>`).join('')}</ul>`;
  fillSlots(box);
}

// ---------- logbook, ledger, odds, rules ----------
const ICON = { buy: '▲', add: '＋', sell: '▼', stop: '✕', target: '◎', regime: '◐', info: 'i', learn: '✦' };
// Every past run as one dot, stacked by how it ended. Gold dots doubled the account.
function dotChart(ends, mult, W) {
  const B0 = 0.5, BW = 0.05, NB = 30, bins = Array(NB + 1).fill(0);
  for (const e of ends) bins[e >= 2 ? NB : clamp(Math.floor((e - B0) / BW + 1e-9), 0, NB - 1)]++;
  const gapLast = 12, cw = (W - gapLast) / (NB + 1.6), d = clamp((cw - 2) / 2, 1.6, 6), pitch = d + 1.4;
  const rows = Math.max(...bins.map((n, i) => Math.ceil(n / (i === NB ? 3 : 2)))), PT = 30, plotH = rows * pitch, H = PT + plotH + 34;
  const xOf = (i) => (i === NB ? NB * cw + gapLast : i * cw), here = mult >= 2 ? NB : clamp(Math.floor((mult - B0) / BW + 1e-9), 0, NB - 1);
  const paths = { lo: '', hi: '', gold: '' };
  let hits = '';
  bins.forEach((n, i) => {
    const per = i === NB ? 3 : 2, w = i === NB ? cw * 1.6 : cw, x0 = xOf(i) + (w - per * pitch + 1.4) / 2, key = i === NB ? 'gold' : B0 + i * BW < 0.9999 ? 'lo' : 'hi';
    for (let k = 0; k < n; k++) { const x = x0 + (k % per) * pitch + d / 2, y = PT + plotH - Math.floor(k / per) * pitch - d / 2 - 1; paths[key] += `M${(x - d / 2).toFixed(1)},${y.toFixed(1)}a${d / 2},${d / 2} 0 1,0 ${d},0a${d / 2},${d / 2} 0 1,0 ${-d},0`; }
    const lo = B0 + i * BW;
    hits += `<rect x="${xOf(i)}" y="${PT}" width="${w}" height="${plotH}" fill="transparent"><title>${plural(n, 'run')} ended ${i === NB ? 'at double or more' : `between ${pct(lo - 1, 0)} and ${pct(lo + BW - 1, 0)}`}</title></rect>`;
  });
  const ticks = (W < 430 ? [0.6, 1, 1.4, 1.8] : [0.6, 0.8, 1, 1.2, 1.4, 1.6, 1.8]).map((m) => { const x = ((m - B0) / BW) * cw; return `<line x1="${x}" x2="${x}" y1="${PT + plotH}" y2="${PT + plotH + 5}" stroke="rgba(180,200,230,0.3)"/><text x="${x}" y="${PT + plotH + 19}" text-anchor="middle" class="${m === 1 ? 'st' : ''}">${m === 1 ? 'Start' : pct(m - 1, 0)}</text>`; }).join('');
  const sx = ((1 - B0) / BW) * cw, hx = xOf(here) + (here === NB ? cw * 0.8 : cw / 2), hy = PT + plotH - Math.ceil(bins[here] / (here === NB ? 3 : 2)) * pitch - 6;
  return `<svg class="dots-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Each dot is one past 30-day run, stacked by how it ended">
    <line x1="0" x2="${W}" y1="${PT + plotH}" y2="${PT + plotH}" stroke="rgba(180,200,230,0.3)"/><line x1="${sx}" x2="${sx}" y1="${PT - 6}" y2="${PT + plotH}" stroke="rgba(180,200,230,0.22)"/>
    <path d="${paths.lo}" fill="${C.loss}"/><path d="${paths.hi}" fill="${C.acct}"/><path d="${paths.gold}" fill="${C.gold}"/>
    ${ticks}<text x="${W}" y="${PT + plotH + 19}" text-anchor="end" class="gd">2× or more</text>
    <line x1="${hx}" x2="${hx}" y1="18" y2="${hy - 8}" stroke="rgba(244,247,251,0.55)"/><path d="M${hx},${hy}l-5,-8h10z" fill="${C.ink}"/><text class="here" x="${clamp(hx, 42, W - 42)}" y="12" text-anchor="middle">This run now</text>${hits}</svg>`;
}
function renderLower(v) {
  const d = v.d, a = d.account;
  $('#feed').innerHTML = d.events.length ? d.events.map((e) => `<li class="${esc(e.type)}"><span class="ic" aria-hidden="true">${ICON[e.type] ?? '·'}</span><div><time>${when(e.t)}</time><p>${esc(plain(e.text))}</p></div></li>`).join('')
    : `<li class="none"><span class="ic" aria-hidden="true">·</span><div><time>Nothing yet</time><p>The first decision comes at the next ${v.tbo ? '4-hour' : 'daily'} close. Every buy, sell and stop will be written here in plain English.</p></div></li>`;
  $('#ledger-sub').textContent = a.trades ? `${a.wins} won · ${a.losses} lost` : '';
  $('#ledger').innerHTML = d.closed.length ? `<table class="table"><thead><tr><th>Coin</th><th>Held</th><th>Why it sold</th><th class="r">Result</th></tr></thead><tbody>${d.closed.map((t) => `<tr><td><b>${esc(t.coin)}</b></td><td class="num">${dateU(t.openedT)} → ${dateU(t.closedT)}</td><td class="muted">${esc(plain(t.exitReason))}</td><td class="r num ${cls(t.pnlUsd)}"><b>${signUsd(t.pnlUsd)}</b><br><span>${pct(t.pnlPct)}</span></td></tr>`).join('')}</tbody></table>`
    : `<div class="empty"><strong>No finished trades yet</strong>Each one lands here with the reason it was sold.</div>`;
  const nt = a.nextTier, prog = nt ? Math.min(1, a.volume30 / nt.at) : 1;
  $('#fees').innerHTML = `<div class="fee"><div class="fee-top"><span class="label">Kraken fees paid so far</span><b>${usd(a.fees)}</b></div>
    <div class="prog"><i style="width:${(prog * 100).toFixed(0)}%"></i></div>
    <p>Paying ${pct(a.feeRate, 2, false)} per order now. ${nt ? `${usd(Math.max(0, nt.at - a.volume30), 0)} more traded in 30 days drops it to ${pct(nt.rate, 2, false)}.` : ''}</p></div>`;
  const p = d.rules, t = p?.playbooks?.trend, g = v.g;
  if (p && t && !$('#rules').dataset.built) {
    $('#rules').dataset.built = '1';
    const light1 = ['Trade only in a healthy market', `Bitcoin must close above its ${p.regimeSma}-day average. If it closes below, sell everything and wait in cash.`];
    const finish = ['The finish line', `A run ends when the account reaches ${usd(g.target, 0)} or falls to ${usd(g.floor ?? 0, 0)}. It then sells everything, records the result and starts again from ${usd(g.start, 0)}.`];
    const size = ['Medium bets, several coins', `Each trade risks ${pct(p.riskPerTrade, 0, false)} of the account, with up to ${p.maxPositions} coins at once and at most ${pct(p.maxWeight, 0, false)} of the account in one coin.`];
    const rules = !AB ? [
      light1,
      ['Buy breakouts', `From the ${p.universe} most-traded coins, buy one that closes the day at a new ${t.breakout}-day high while above its own ${t.trendSma}-day average. That is trend plus breakout, the idea behind the TBO. It is not the TBO's own formula.`],
      ['Bet big, with a stop', `Each trade risks ${pct(p.riskPerTrade, 0, false)} of the account, with at most ${p.maxPositions} coins at once. One trade can use the whole account.`],
      ['Cut losers, ride winners', `The stop-loss starts ${t.atrInit}× the coin's average daily range below the buy price. It then trails ${t.atrTrail}× below the highest price and only moves up.`],
      ['One decision a day', 'Buys and sells are decided at the daily close (00:00 UTC). Stops are checked every hour.'],
      ['Kraken\'s real costs', 'Every order pays Kraken Pro\'s taker fee, starting at 0.80%, plus 0.10% slippage.'],
    ] : v.tbo ? [
      light1,
      ['Buy the TBO\'s Open Long', `On the 4-hour chart of the ${p.universe} most-traded coins, buy when the TBO fires an Open Long.`],
      ['Sell on the TBO\'s Open Short', `Sell when the TBO fires an Open Short on the same chart, or when the stop-loss is hit. The stop starts ${t.atrInit}× the coin's average 4-hour range below the buy price.`],
      size,
      ['Six decisions a day', 'Buys and sells are decided at each 4-hour close. Stops are checked every hour. Every order pays Kraken Pro\'s taker fee, starting at 0.80%, plus 0.10% slippage.'],
      finish,
    ] : [
      light1,
      ['Buy breakouts, skip the overheated', `From the ${p.universe} most-traded coins, buy one that closes the day at a new ${t.breakout}-day high while above its own ${t.trendSma}-day average. Skip coins already up more than ${pct(t.maxRun ?? 0, 0, false)} in four weeks. No TBO on this desk.`],
      ['Cut losers, lock in breakeven, ride winners', `The stop-loss starts ${t.atrInit}× the coin's average daily range below the buy price. Once the trade is ahead by that distance, the stop moves up to the buy price. After that it trails ${t.atrTrail}× below the highest price.`],
      size,
      ['One decision a day', 'Buys and sells are decided at the daily close (00:00 UTC). Stops are checked every hour. Every order pays Kraken Pro\'s taker fee, starting at 0.80%, plus 0.10% slippage.'],
      finish,
    ];
    $('#rules').innerHTML = rules.map(([h, b], i) => `<li class="panel"><span class="n">${String(i + 1).padStart(2, '0')}</span><h3>${h}</h3><p>${b}</p></li>`).join('');
  }
  const R = d.research, s = R?.sprint?.all, b = R?.btc?.all;
  if (R?.kind === 'race') {
    // The A/B desks: how often the goal came before the loss limit in the tests, and what fees do to the result.
    const o = R.odds, up = pct(R.goal.up, 0), dn = pct(-R.goal.down, 0);
    $('#odds-h').textContent = `What comes first, ${up} or ${dn}?`;
    $('#odds-sub').textContent = `The same rules on ${R.bars} charts from ${R.from.slice(0, 4)} to ${R.to.slice(0, 4)}, paying Kraken's fees. The rules were judged on 2020 to 2023; 2024 to 2026 were held back as unseen years.`;
    $('#odds').innerHTML = `<div class="odds-chart"><div class="oddsgrid two"><div class="gold"><b>${pct(o.all, 0, false)}</b><span>reached ${up} first, if the future looks like ${R.from.slice(0, 4)} to ${R.to.slice(0, 4)} (typically in about ${o.monthsAll} months)</span></div>
        <div><b>${pct(o.recent, 0, false)}</b><span>reached ${up} first, if it looks like 2022 to ${R.to.slice(0, 4)} (about ${o.monthsRecent} months)</span></div></div>
      <p>The rest of the time the account fell ${pct(R.goal.down, 0, false)} first. These come from 10,000 reshuffled versions of the test results, so they are estimates, not promises. About ${R.tradesPerYear} trades a year, each held about ${R.holdDays} days, ${pct(R.won, 0, false)} of them winners.</p></div>
      <div class="odds-side"><table class="table fees"><thead><tr><th>Cost per order</th><th class="r">2020–23</th><th class="r">Unseen years</th><th class="r">Worst drop</th></tr></thead><tbody>
        ${R.fees.map((f) => `<tr><td>${esc(f.label)}</td><td class="r num">${pct(f.dev, 0)}</td><td class="r num"><b>${pct(f.test, 0)}</b></td><td class="r num">${pct(f.worst, 0)}</td></tr>`).join('')}</tbody></table>
        <p>${R.noLight ? `Without the market light the same rules lost ${pct(-R.noLight.test, 0, false)} a year on the unseen years and fell ${pct(-R.noLight.worst, 0, false)} at the worst point. ` : ''}Past results are not a forecast: the edge was far smaller in the unseen years than before them.</p></div>`;
    return;
  }
  if (!s) { $('#odds').innerHTML = `<p class="muted">The test results for this desk are not loaded yet.</p>`; return; }
  $('#odds-h').textContent = `How ${s.n} past runs ended`;
  $('#odds-sub').textContent = `The same rules on every ${R.days}-day stretch from ${R.from.slice(0, 4)} to ${R.to.slice(0, 4)}, each starting with its first trade and paying Kraken's fees.`;
  const box = $('#odds');
  if (!box.dataset.built) { box.dataset.built = '1'; box.innerHTML = `<div class="odds-chart"><div id="dots"></div><div class="legend"><span><i class="dt" style="background:${C.loss}"></i>Ended lower</span><span><i class="dt" style="background:${C.acct}"></i>Ended higher</span><span><i class="dt" style="background:${C.gold}"></i>Doubled</span><span class="muted">One dot = one run</span></div></div><div class="odds-side" id="odds-side"></div>`; }
  $('#dots').innerHTML = dotChart(S.ends, v.equity / v.g.start, Math.max(280, $('#dots').clientWidth));
  $('#odds-side').innerHTML = `<div class="oddsgrid"><div class="gold"><b>${pct(s.p2x, 1, false)}</b><span>doubled the account</span></div><div><b>${pct(s.p15x, 1, false)}</b><span>gained 50% or more</span></div><div><b>${pct(s.p12x, 0, false)}</b><span>gained 20% or more</span></div>
      <div><b>${pct(s.pUp, 0, false)}</b><span>ended with a gain</span></div><div><b>${pct(s.pDown20, 1, false)}</b><span>lost 20% or more</span></div><div><b>${pct(s.best - 1, 0)}</b><span>best run (worst: ${pct(s.worst - 1, 0)})</span></div></div>
    <p>The typical run ended ${Math.abs(s.median - 1) < 0.005 ? 'flat' : pct(s.median - 1, 0)}, and ${pct(1 - s.pUp, 0, false)} of runs lost money. Simply holding Bitcoin over the same days ${b.p2x ? `doubled in ${pct(b.p2x, 1, false)} of them` : 'never doubled'}. Doubling in a month is a long shot. The stop-losses are there so that a bad month costs part of the account, not all of it.</p>`;
}

// ---------- scoreboard: every finished sprint ----------
function spark(r, W = 280, H = 70) {
  const pts = r.curve, t0 = pts[0][0], t1 = pts.at(-1)[0], vals = pts.map((p) => p[1]);
  const lo = Math.min(r.start, ...vals), hi = Math.max(r.start, ...vals), pad = (hi - lo) * 0.14 || 10;
  const X = (t) => 2 + ((t - t0) / Math.max(1, t1 - t0)) * (W - 10), Y = (y) => 6 + (1 - (y - lo + pad) / (hi - lo + 2 * pad)) * (H - 12);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(''), col = r.end >= r.start ? C.acct : C.loss, e = pts.at(-1);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Account value over sprint ${r.n}: from ${usd(r.start, 0)} to ${usd(r.end, 0)}">
    <line x1="0" x2="${W}" y1="${Y(r.start)}" y2="${Y(r.start)}" stroke="rgba(180,200,230,0.3)" vector-effect="non-scaling-stroke"/>
    <path d="${d}L${X(e[0]).toFixed(1)},${Y(r.start).toFixed(1)}L${X(t0).toFixed(1)},${Y(r.start).toFixed(1)}Z" fill="${col}" opacity="0.14"/>
    <path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
}
function renderScore(v) {
  const block = $('#score-block'), hist = v.d.history ?? [], noun = v.noun, lower = noun.toLowerCase(), g = v.g;
  block.hidden = DEMO; // a replay is one past month, not the live record
  if (DEMO) return;
  $('#score-h').textContent = `Finished ${lower}s`;
  $('#score-sub').textContent = v.timed ? `On day ${g.days} it sells everything, records the result here and starts again from ${usd(g.start, 0)}.` : `A run ends at ${usd(g.target, 0)} (a win) or ${usd(g.floor, 0)} (a loss). It then sells everything, records the result here and starts again from ${usd(g.start, 0)}.`;
  if (!hist.length) {
    $('#score').innerHTML = `<div class="panel pad"><div class="empty"><strong>No finished ${lower}s yet</strong>${v.timed ? `The first result lands here ${g.days} days after the first trade.` : 'The first result lands here when a run reaches its goal or its loss limit.'} Every ${lower} starts again from ${usd(g.start, 0)}, and this scoreboard will also show what the money would be worth if each ending balance had been carried into the next ${lower}.</div></div>`;
    return;
  }
  const n = hist.length, reached = hist.filter((r) => r.reached).length, avg = hist.reduce((a, r) => a + r.mult - 1, 0) / n;
  const rolled = hist.reduce((a, r) => a * r.mult, g.start), up = hist.filter((r) => r.end > r.start).length;
  $('#score').innerHTML = `<div class="score-sum">
      <div><span class="k">Finished</span><b>${plural(n, lower)}</b><span class="s">${up} ended higher, ${n - up} ended lower or flat</span></div>
      <div class="${reached ? 'gold' : ''}"><span class="k">Reached ${usd(g.target, 0)}</span><b>${reached} of ${n}</b><span class="s">${v.timed ? 'finished at or above the goal' : 'reached the goal before the loss limit'}</span></div>
      <div><span class="k">Average result</span><b class="${cls(avg)}">${pct(avg)}</b><span class="s">each ${lower} starting from ${usd(g.start, 0)}</span></div>
      <div><span class="k">Rolled forward</span><b>${usd(rolled, 0)}</b><span class="s">${usd(g.start, 0)} if every ending balance had been carried into the next ${lower}</span></div>
    </div>
    <div class="score-list">${[...hist].reverse().map((r) => `<article class="panel score-card ${r.end >= r.start ? 'win' : 'loss'}">
      <div class="score-top"><div><h3>${noun} ${r.n}</h3><div class="sub">${dateU(r.startedAt)} to ${dateY(r.endedAt)}</div></div>
        <div class="right"><div class="pnl">${usd(r.end, 0)}</div><div class="sub ${cls(r.mult - 1)}">${pct(r.mult - 1)}</div></div></div>
      ${spark(r)}
      ${r.reached ? '<span class="badge">Reached the goal</span>' : r.outcome === 'limit' ? '<span class="badge bad">Hit the loss limit</span>' : r.touched ? `<span class="badge">Touched ${usd(g.target, 0)}, then fell back</span>` : ''}
      <p class="why">${plural(r.trades, 'trade')}, ${r.wins} won · ${usd(r.fees)} in fees · Bitcoin over the same days ${pct(r.btcMult - 1)} · high ${usd(r.peak, 0)}, low ${usd(r.low, 0)}</p></article>`).join('')}</div>`;
}

// ---------- status, replay, boot ----------
function renderStatus(v) {
  const el = $('#status');
  if (DEMO) { el.innerHTML = `<span class="live-dot stale"></span><span>Replay<span class="lg"> · ${dateY(v.g.startedAt)} to ${dateY(v.g.deadline - 1)}</span></span>`; return; }
  const fresh = Date.now() - v.d.generatedAt < 100 * 60_000;
  el.innerHTML = `<span class="live-dot ${fresh ? '' : 'stale'}"></span><span><span class="lg">Bot checked </span>${ago(v.d.generatedAt)}${S.liveAt ? '<span class="lg"> · prices live</span>' : ''}</span>`;
}
// ---------- ticker tape and market mood ----------
// The tape scrolls the live price and 24-hour move of every coin the desk follows (a dot marks the ones it holds).
// The mood sums up how those coins moved today as one colour from red to green, and tints the tape and the stat
// boxes. It is a reading only: the desk trades on the market light, never on the mood.
const MOOD = { red: [236, 94, 109], flat: [180, 192, 210], green: [48, 200, 112] };
function moodOf(moves) {
  const n = moves.length;
  if (!n) return null;
  const up = moves.filter((x) => x > 0).length, sorted = [...moves].sort((a, b) => a - b);
  const mid = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2; // the typical coin: one big mover cannot swing it
  // Six parts how many coins are up, four parts how far the typical coin moved (3% or more counts as a full move).
  const score = clamp(0.6 * ((2 * up) / n - 1) + 0.4 * clamp(mid / 0.03, -1, 1), -1, 1);
  return { n, up, mid, score, word: score >= 0.65 ? 'Green' : score >= 0.3 ? 'Mostly green' : score > -0.3 ? 'Mixed' : score > -0.65 ? 'Mostly red' : 'Red' };
}
function renderTape(v) {
  const box = $('#tape');
  if (DEMO) { box.hidden = true; return; }
  const held = new Set(v.positions.map((p) => p.symbol)), day0 = Object.fromEntries(v.d.radar.map((r) => [r.symbol, r.change24h]));
  const rows = [...new Set(['BTCUSDT', ...held, ...v.d.radar.map((r) => r.symbol)])].map((sy) => ({ sy, coin: sy.replace('USDT', ''), p: px(sy), ch: S.live[sy]?.ch ?? day0[sy] ?? null, held: held.has(sy) })).filter((r) => r.p > 0);
  if (!rows.length) { box.hidden = true; return; }
  const track = $('#tape-track'), key = rows.map((r) => r.sy + (r.held ? '*' : '')).join(',');
  if (key !== S.tapeKey) {
    S.tapeKey = key; S.tapePx = {};
    const reps = Math.max(1, Math.ceil(12 / rows.length)) * 2; // enough copies to fill a wide screen, in two equal halves
    const item = (r) => `<span class="tk${r.held ? ' held' : ''}" data-sym="${esc(r.sy)}"${r.held ? ' title="The desk holds this coin"' : ''}><b>${esc(r.coin)}</b><span class="p"></span><span class="c"></span></span>`;
    track.innerHTML = Array.from({ length: reps }, (_, k) => `<span class="tape-set"${k ? ' aria-hidden="true"' : ''}>${rows.map(item).join('')}</span>`).join('');
    track.style.setProperty('--dur', `${Math.round(rows.length * (reps / 2) * 3.6)}s`);
  }
  for (const r of rows) {
    const was = S.tapePx[r.sy], dir = was && r.p !== was ? (r.p > was ? 'fu' : 'fd') : '';
    S.tapePx[r.sy] = r.p;
    for (const el of track.querySelectorAll(`[data-sym="${r.sy}"]`)) {
      const p = el.children[1], c = el.children[2];
      p.textContent = price(r.p);
      c.className = `c ${r.ch == null ? '' : r.ch > 0 ? 'up' : r.ch < 0 ? 'down' : ''}`;
      c.textContent = r.ch == null ? '' : `${r.ch > 0 ? '▲' : r.ch < 0 ? '▼' : '•'} ${pct(Math.abs(r.ch), 2, false)}`;
      if (dir && !REDUCED) { p.classList.remove('fu', 'fd'); void p.offsetWidth; p.classList.add(dir); } // a price change flashes green or red
    }
  }
  const m = moodOf(rows.map((r) => r.ch).filter((x) => x != null)), mood = $('#mood');
  if (m) {
    const to = m.score < 0 ? MOOD.red : MOOD.green, k = Math.abs(m.score);
    document.documentElement.style.setProperty('--mood-rgb', MOOD.flat.map((c, i) => Math.round(c + (to[i] - c) * k)).join(', '));
    if (!mood.firstChild) mood.innerHTML = '<span class="mood-k">Mood today</span><span class="mood-bar" aria-hidden="true"><i></i></span><b class="mood-v"></b><span class="mood-s"></span>';
    $('i', mood).style.left = `${(50 + m.score * 50).toFixed(1)}%`;
    $('.mood-v', mood).textContent = m.word;
    $('.mood-s', mood).textContent = `${m.up} of ${m.n} coins up · typical coin ${pct(m.mid, 1)}`;
    mood.title = `Market mood: how the ${m.n} coins this desk follows moved over the last 24 hours. A reading only: the desk trades on the market light, not on the mood.`;
  }
  mood.hidden = !m; box.hidden = false;
}
function render() {
  if (!S.d || !S.scene) return;
  CH.length = 0; SLOT.clear(); slotN = 0;
  const v = view();
  renderStatus(v); renderTape(v); renderHero(v); renderHud(v); renderRace(v); renderTrades(v); renderRadar(v); renderLower(v); renderScore(v);
  if (DEMO) { $('#scrub').value = S.frame; $('#replay-day').innerHTML = `<b>Day ${S.frame + 1}</b><span class="lg"> of ${S.replay.frames.length}</span> · ${dateU(S.d.generatedAt - 1)}<span class="lg">, ${new Date(S.d.generatedAt - 1).getUTCFullYear()}</span>`; $('#play').textContent = S.playing ? '❚❚' : '▶'; }
}
function play(on) {
  S.playing = on; clearInterval(S.timer);
  if (on) {
    if (S.frame >= S.replay.frames.length - 1) setFrame(0);
    S.timer = setInterval(() => { if (S.frame >= S.replay.frames.length - 1) { play(false); return; } setFrame(S.frame + 1); render(); }, 1200);
  }
  render();
}
function setupReplay() {
  $('#replay').hidden = false; document.body.classList.add('replaying');
  $('#nav-live').setAttribute('aria-selected', 'false'); $('#nav-replay').setAttribute('aria-selected', 'true');
  $('#replay-pick').innerHTML = S.top.replays.map((r) => `<button data-k="${esc(r.key)}" aria-pressed="${r.key === S.replay.key}">${esc(r.label)}</button>`).join('');
  $$('#replay-pick button').forEach((b) => { b.onclick = () => {
    play(false); params.set('demo', b.dataset.k); history.replaceState(null, '', `?${params}`);
    S.replay = S.top.replays.find((r) => r.key === b.dataset.k); S.candles = S.replay.candles; S.shownEq = null; S.sel = null; setFrame(0);
    $$('#replay-pick button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); play(true);
  }; });
  $('#scrub').max = S.replay.frames.length - 1;
  $('#scrub').oninput = (e) => { const i = +e.target.value; play(false); setFrame(i); render(); };
  $('#play').onclick = () => play(!S.playing);
}

async function boot() {
  // The desk switch in the top bar, and the tabs. Only the Sprint has replays.
  const label = { sprint: 'The Sprint', breakout: 'Breakout desk', tbo: 'TBO desk' }[DESK];
  $('#brand-name').textContent = label; document.title = `${label} · TBT Quant Desk`;
  $$('#desks a').forEach((a) => { if (a.dataset.desk === DESK) a.setAttribute('aria-current', 'page'); });
  $('#nav-live').onclick = () => { location.search = AB ? `?desk=${DESK}` : ''; };
  $('#nav-replay').onclick = () => { location.search = '?demo=best'; };
  $('#nav-replay').hidden = AB;
  try {
    if (VAULT) await unlock();
    await loadState();
  } catch (e) {
    const notStarted = e.message === 'NOT_STARTED';
    $('#status').innerHTML = `<span class="live-dot stale"></span><span>${notStarted ? 'Not started yet' : 'Could not load'}</span>`;
    $('#copy').innerHTML = `<div class="eyebrow">${label}</div><h1 class="oops">${notStarted ? 'This desk has not started yet' : 'Could not load this desk'}</h1><p class="story">${notStarted ? (AB ? 'This desk has not run yet. It starts at the bot\'s next hourly run.' : 'The Sprint desk has not run yet. Until it does, press "Replay a past month" to watch real past months play out.') : esc(e.message)}</p>`;
    $('#hero').classList.add('bare'); $('.page').hidden = true;
    return;
  }
  // ?sky=7.5 shows the scene at that Montreal hour and ?wx=clear|cloud|overcast|rain|snow|fog|storm at that weather.
  const hour = params.get('sky'), wxName = params.get('wx');
  S.scene = createScene($('#scene'), { reduced: REDUCED, hour: hour != null && hour !== '' && Number.isFinite(+hour) ? +hour : null, weather: wxName,
    onSky: (info) => { S.sky = info; const el = $('#sky-note span'); if (el) el.textContent = skyNote(); } });
  if (DEMO) { setupReplay(); play(!REDUCED); }
  render();
  document.fonts?.ready.then(render); // text measures change once Satoshi has loaded
  if (!DEMO) {
    refreshPrices();
    setInterval(refreshPrices, 15_000);
    setInterval(async () => { try { await loadState(); render(); } catch { /* keep the last data */ } }, 120_000);
  }
  addEventListener('pointermove', candleHover, { passive: true });
  addEventListener('scroll', () => { $('#tip').style.display = 'none'; }, { passive: true });
  // Phones fire resize when the address bar hides; only a width change (or a height change on the wide layout) needs a redraw.
  let rt = 0, lw = innerWidth, lh = innerHeight;
  addEventListener('resize', () => { if (innerWidth === lw && (innerHeight === lh || !matchMedia('(min-width: 1000px)').matches)) return; lw = innerWidth; lh = innerHeight; clearTimeout(rt); rt = setTimeout(render, 150); });
  // Sections rise in as they scroll into view.
  if (!REDUCED && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }, { rootMargin: '0px 0px -6% 0px' });
    $$('.block').forEach((b) => { b.classList.add('rv'); io.observe(b); });
  }
}
boot();
