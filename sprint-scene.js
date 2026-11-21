// The hero scene of the desk pages: a mountain where altitude is the account value. Base camp sits at the starting
// amount and the summit at the goal; the glowing marker is the account now. Each small light on the mountain is where
// one past 30-day test run ended. The lamp on the summit is the market light (green: buying allowed, red: waiting),
// with an aurora on green-light nights. The moon fills as the days pass.
// The sky is Montreal's real sky: the sun rises, crosses and sets on Montreal time, and the cloud, rain, snow and fog
// follow Montreal's current weather (Open-Meteo, a free feed that needs no key). The weather never means anything
// about the market.
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const usd0 = (x) => `$${Math.round(x).toLocaleString('en-US')}`;
const rng = (seed) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const f1 = (x) => x.toFixed(1);
const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const rgb = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
const gray = (c) => { const y = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; return [y, y, y]; };

// ---------- the real sky ----------
export const PLACE = { name: 'Montreal', lat: 45.5019, lon: -73.5674, tz: 'America/Toronto' };
const WX_URL = `https://api.open-meteo.com/v1/forecast?latitude=${PLACE.lat}&longitude=${PLACE.lon}&current=temperature_2m,weather_code,cloud_cover,wind_speed_10m`;
const WX_KEY = 'qd-sky-1', RAD = Math.PI / 180;

/** Where the sun is over a place at a moment (almanac formulas, good to a fraction of a degree).
 *  el: degrees above the horizon. arc: 0 at sunrise, 0.5 at solar noon, 1 at sunset (outside 0..1 at night).
 *  height: 1 at solar noon, 0 at sunrise and sunset, below 0 at night. */
export function sunAt(ms, lat = PLACE.lat, lon = PLACE.lon) {
  const d = ms / 86_400_000 - 10957.5; // days since 2000-01-01 12:00 UTC
  const g = (357.529 + 0.98560028 * d) * RAD, q = 280.459 + 0.98564736 * d;
  const lam = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD, eps = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)), dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  let ha = (((18.697374558 + 24.06570982441908 * d) * 15 + lon) * RAD - ra) % (2 * Math.PI);
  if (ha > Math.PI) ha -= 2 * Math.PI; else if (ha < -Math.PI) ha += 2 * Math.PI;
  const sl = Math.sin(lat * RAD), cl = Math.cos(lat * RAD);
  const el = Math.asin(sl * Math.sin(dec) + cl * Math.cos(dec) * Math.cos(ha)) / RAD;
  const cosH0 = clamp((Math.sin(-0.833 * RAD) - sl * Math.sin(dec)) / (cl * Math.cos(dec)), -0.9999, 0.9999), H0 = Math.acos(cosH0);
  return { el, arc: (ha + H0) / (2 * H0), height: (Math.cos(ha) - cosH0) / (1 - cosH0) };
}

/** A weather report (WMO code, cloud cover %, wind km/h, temperature C) as what the scene draws, each 0 to 1. */
export function weatherOf({ code = 0, cloud = 0, wind = 0, temp = null } = {}) {
  const w = { label: 'Clear', cloud: clamp(cloud / 100, 0, 1), rain: 0, snow: 0, fog: 0, storm: 0, wind: clamp(wind / 45, 0, 1), temp };
  const set = (label, o) => Object.assign(w, { label }, o);
  const pick = (list, i) => list[clamp(Math.round(i), 0, list.length - 1)];
  if (code === 1) set('Mostly clear'); else if (code === 2) set('Partly cloudy'); else if (code === 3) set('Overcast', { cloud: Math.max(w.cloud, 0.9) });
  else if (code === 45 || code === 48) set(code === 48 ? 'Freezing fog' : 'Fog', { fog: 0.85 });
  else if (code >= 51 && code <= 55) set('Drizzle', { rain: pick([0.2, 0.3, 0.42], (code - 51) / 2) });
  else if (code === 56 || code === 57) set('Freezing drizzle', { rain: code === 56 ? 0.25 : 0.42 });
  else if (code >= 61 && code <= 65) set(pick(['Light rain', 'Rain', 'Heavy rain'], (code - 61) / 2), { rain: pick([0.45, 0.7, 1], (code - 61) / 2) });
  else if (code === 66 || code === 67) set('Freezing rain', { rain: code === 66 ? 0.5 : 0.9 });
  else if (code >= 71 && code <= 75) set(pick(['Light snow', 'Snow', 'Heavy snow'], (code - 71) / 2), { snow: pick([0.4, 0.7, 1], (code - 71) / 2) });
  else if (code === 77) set('Light snow', { snow: 0.3 });
  else if (code >= 80 && code <= 82) set(pick(['Light showers', 'Showers', 'Heavy showers'], code - 80), { rain: pick([0.5, 0.75, 1], code - 80) });
  else if (code === 85 || code === 86) set(code === 85 ? 'Snow showers' : 'Heavy snow showers', { snow: code === 85 ? 0.6 : 1 });
  else if (code >= 95) set('Thunderstorm', { rain: 0.9, storm: 1 });
  if (w.rain || w.snow) w.cloud = Math.max(w.cloud, 0.85);
  if (w.fog) w.cloud = Math.max(w.cloud, 0.6);
  return w;
}
// Fixed weathers for looking at the scene: sprint.html?wx=snow (and ?sky=7.5 for a Montreal hour of the day).
const PRESET = {
  clear: { code: 0, cloud: 4, wind: 8, temp: 18 }, cloud: { code: 2, cloud: 55, wind: 14, temp: 14 }, overcast: { code: 3, cloud: 100, wind: 12, temp: 6 },
  rain: { code: 63, cloud: 100, wind: 22, temp: 9 }, snow: { code: 73, cloud: 100, wind: 14, temp: -4 }, fog: { code: 45, cloud: 80, wind: 4, temp: 3 },
  storm: { code: 95, cloud: 100, wind: 34, temp: 21 },
};
// Sky colours from the top of the page to the horizon, and the mountain's faces from the summit down.
const P = (list) => list.map(hex);
const PAL = {
  sky: { night: P(['#02050c', '#040b19', '#091a36', '#0d274a']), day: P(['#0a3577', '#1b5fb4', '#4d99df', '#a3d2f4']), dusk: P(['#141a44', '#5a3f7c', '#dc7a6a', '#f6a55e']),
    grayNight: P(['#04060b', '#090e18', '#121b2b', '#19253a']), grayDay: P(['#46566b', '#65778d', '#8e9db0', '#b7c2ce']) },
  left: { night: P(['#e6eeff', '#b3c8ea', '#5b7db1', '#243e6a', '#10213f', '#0a1528']), day: P(['#ffffff', '#f2f7fd', '#c6d8ee', '#86a3c8', '#44648f', '#1b3152']) },
  right: { night: P(['#9fb4d8', '#6481b0', '#2a426c', '#122240', '#060d1b']), day: P(['#dbe6f5', '#a7bfdd', '#6b8bb5', '#36557f', '#132845']) },
  ridge: { night: P(['#0f2547', '#0b1b36']), day: P(['#5b8fcb', '#3d6ea8']), dusk: P(['#6a4f80', '#392e5c']) },
};
const WARM = hex('#ffc49a'), MAUVE = hex('#b98aa0'), WXF = ['cloud', 'rain', 'snow', 'fog', 'wind', 'storm'];

let V0 = 500, V1 = 2000; // the mountain's range, set from the goal in update(): $500 to $2,000 for the Sprint, $750 to $1,500 for the A/B desks
const FIELDS = ['equity', 'pace', 'floor', 'peak'];

function build(W, H, overlay) {
  const k = Math.max(0.62, Math.min(1.15, W / 1400));
  const sx = W * (overlay ? 0.68 : 0.57), yTop = H * (overlay ? 0.27 : 0.28), yBot = H * (overlay ? 0.915 : 0.9);
  const Lw = W * (overlay ? 0.48 : 0.55), Rw = W * (overlay ? 0.37 : 0.52);
  const r = rng(7), ph = [r() * 6, r() * 6, r() * 6, r() * 6];
  // Left flank: the route. Flatter ledges at every $250 (the camps), steeper pitches between them.
  const g = (t) => (t + (0.55 * Math.sin(12 * Math.PI * t)) / (12 * Math.PI)) ** 1.18;
  const N = 180, flank = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, jag = (2.3 * Math.sin(70 * t + ph[0]) + 1.4 * Math.sin(163 * t + ph[1])) * Math.min(1, t * 8) * k;
    flank.push([sx - Lw * g(t) + jag, lerp(yTop, yBot, t)]);
  }
  const M = 70, right = [];
  for (let i = 0; i <= M; i++) {
    const t = i / M, bump = Math.exp(-(((t - 0.34) / 0.075) ** 2)) * H * 0.05;
    const jag = (5 * Math.sin(40 * t + ph[2]) + 3 * Math.sin(97 * t + ph[3])) * Math.min(1, t * 6) * k;
    right.push([sx + Rw * t ** 0.86 + jag, lerp(yTop, yBot, t) - bump]);
  }
  const K = 14, spine = [];
  for (let i = 0; i <= K; i++) { const t = i / K; spine.push([sx + W * 0.07 * t + (i % 2 ? 1 : -1) * W * 0.011 * Math.min(1, t * 3) * (0.5 + r() * 0.9), lerp(yTop, yBot, t)]); }
  spine[0] = [sx, yTop];
  const Y = (v) => lerp(yBot, yTop, (clamp(v, V0, V1) - V0) / (V1 - V0));
  const tab = (arr, n) => (y) => { const f = clamp((y - yTop) / (yBot - yTop), 0, 1) * n, i = Math.min(n - 1, Math.floor(f)); return lerp(arr[i][0], arr[i + 1][0], f - i); };
  const flankX = tab(flank, N), spineX = tab(spine, K);
  const at = (v) => { const y = Y(v); return { x: flankX(y), y }; };
  // The flank between two account values, as an SVG path.
  const path = (va, vb) => {
    const ia = ((V1 - clamp(vb, V0, V1)) / (V1 - V0)) * N, ib = ((V1 - clamp(va, V0, V1)) / (V1 - V0)) * N;
    const a = at(vb), b = at(va); let d = `M${f1(a.x)},${f1(a.y)}`;
    for (let i = Math.ceil(ia + 1e-6); i <= Math.floor(ib - 1e-6); i++) d += `L${f1(flank[i][0])},${f1(flank[i][1])}`;
    return `${d}L${f1(b.x)},${f1(b.y)}`;
  };
  return { W, H, k, overlay, narrow: W < 700, sx, yTop, yBot, flank, right, spine, Y, at, path, flankX, spineX };
}

export function createScene(root, opts = {}) {
  const reduced = !!opts.reduced;
  root.innerHTML = `<canvas class="sc-sky" aria-hidden="true"></canvas>
    <svg class="sc-land" role="img" aria-label="A mountain: base camp at the starting amount, the summit at the goal, and a marker for the account now"><g class="sc-static"></g><g class="sc-moon"></g><g class="sc-dyn"></g></svg>
    <div class="sc-clouds" aria-hidden="true"><i></i><i></i><i></i></div>
    <canvas class="sc-fx" aria-hidden="true"></canvas>`;
  const skyCv = root.querySelector('.sc-sky'), fx = root.querySelector('.sc-fx'), svg = root.querySelector('.sc-land');
  const gStatic = svg.querySelector('.sc-static'), gMoon = svg.querySelector('.sc-moon'), gDyn = svg.querySelector('.sc-dyn');
  const sctx = skyCv.getContext('2d'), fctx = fx.getContext('2d');
  let geo = null, key = '', cur = null, shown = null, tw = 0, last = 0, visible = true;
  let aurora = -1, stars = [], flakes = [], drops = [], clouds = [], sprites = [], au = null, meteor = null, nextMeteor = 5, flash = 0, nextFlash = 4;
  // The sky: `sky` is the sun right now, `wx` the weather on screen (eased toward the latest report `wxT`).
  const host = root.closest('.hero') ?? root;
  const clock = opts.hour == null ? () => Date.now() : (() => { const base = atHour(opts.hour), t0 = Date.now(); return () => base + (Date.now() - t0); })();
  let sky = null, skyAt = -99, skyKey = '', tintKey = '', noteKey = '', wxKnown = false;
  const wxT = weatherOf(PRESET[opts.weather] ?? {}), wx = { ...wxT };
  if (PRESET[opts.weather]) wxKnown = true;
  const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: PLACE.tz, hour: 'numeric', minute: '2-digit' });
  const strips = [[93, 242, 138], [45, 212, 191], [139, 124, 246]].map(([r, g, b]) => {
    const c = document.createElement('canvas'); c.width = 1; c.height = 64;
    const x = c.getContext('2d'), gr = x.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, `rgba(${r},${g},${b},0)`); gr.addColorStop(0.5, `rgba(${r},${g},${b},0.22)`); gr.addColorStop(0.84, `rgba(${r},${g},${b},0.95)`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr; x.fillRect(0, 0, 1, 64); return c;
  });

  function setup(W, H, overlay) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [skyCv, fx]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0); }
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    geo = build(W, H, overlay);
    const r = rng(11);
    stars = Array.from({ length: Math.round(Math.min(260, (W * H) / 3800)) }, () => ({ x: r() * W, y: r() ** 1.5 * H * 0.74, s: 0.35 + r() * 0.95, a: 0.25 + r() * 0.75, p: r() * 6.28, f: 0.4 + r() * 1.7 }));
    flakes = Array.from({ length: Math.round(Math.min(170, W / 7)) }, (_, i) => (i % 11 === 0 ? { x: r() * W, y: r() * H, s: 2.6 + r() * 2.2, v: 34 + r() * 20, w: r() * 6.28, a: 0.1 + r() * 0.1 } : { x: r() * W, y: r() * H, s: 0.6 + r() * 1.5, v: 14 + r() * 26, w: r() * 6.28, a: 0.25 + r() * 0.55 }));
    drops = Array.from({ length: Math.round(Math.min(230, W / 5)) }, () => ({ x: r() * W, y: r() * H, l: 9 + r() * 13, v: 520 + r() * 320, a: 0.16 + r() * 0.3 }));
    // Clouds are spread so that the first few already cover the sky evenly; how many show follows the cloud cover.
    clouds = Array.from({ length: 12 }, (_, i) => ({ u: ((i * 0.618) % 1) + (r() - 0.5) * 0.08, y: 0.07 + ((i * 0.382) % 1) * 0.4, s: 0.75 + r() * 0.95, v: 0.55 + r() * 0.9, sp: i % 4 }));
    au = document.createElement('canvas'); au.width = Math.ceil(W / 6); au.height = Math.ceil((H * 0.7) / 6);
    root.style.setProperty('--sx', `${geo.sx}px`); root.style.setProperty('--sy', `${geo.yTop}px`);
  }

  function ridge(seed, base, amp) {
    const { W, H } = geo, r = rng(seed), o = [0, 1, 2].map(() => [r() * 6.28, 0.7 + r() * 0.6]);
    let d = `M-42,${H}`; // drawn wider than the scene, so the ridges can slide a little with the pointer
    for (let x = -42; x <= W + 56; x += 14) {
      const u = x / Math.max(W, 900);
      const n = 0.55 * (1 - Math.abs(Math.sin(u * 4.2 * o[0][1] + o[0][0]))) + 0.3 * (1 - Math.abs(Math.sin(u * 9.7 * o[1][1] + o[1][0]))) + 0.15 * (1 - Math.abs(Math.sin(u * 23 * o[2][1] + o[2][0])));
      d += `L${x},${f1(base - amp * n)}`;
    }
    return `${d}L${W + 56},${H}Z`;
  }

  function drawStatic(s) {
    const { W, H, k, sx, yTop, yBot, flank, right, spine, Y, at, flankX, spineX, narrow } = geo;
    const P = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${f1(p[0])},${f1(p[1])}`).join('');
    const tail = (pts) => pts.map((p) => `L${f1(p[0])},${f1(p[1])}`).join('');
    const sb = spine.at(-1)[0];
    const left = `${P([...flank].reverse())}${tail(spine.slice(1))}L${f1(sb)},${H}L${f1(flank.at(-1)[0] - W * 0.1)},${H}Z`;
    const rightFace = `M${f1(sx)},${f1(yTop)}${tail(spine.slice(1))}L${f1(sb)},${H}L${W + 90},${H}${tail([...right].reverse())}Z`;
    // Facet lines give the faces a cut-stone look.
    let strata = '';
    for (let i = 2; i < spine.length - 1; i += 2) {
      const a = spine[i], yl = Math.min(yBot, a[1] + H * 0.11), yr = Math.min(yBot, a[1] + H * 0.09);
      strata += `<path d="M${f1(a[0])},${f1(a[1])}L${f1(flankX(yl) + 2)},${f1(yl)}" stroke="rgba(255,255,255,0.055)"/>`;
      strata += `<path d="M${f1(a[0])},${f1(a[1])}L${f1(a[0] + (W + 90 - a[0]) * 0.34)},${f1(yr)}" stroke="rgba(0,0,0,0.22)"/>`;
    }
    // Altitude lines: one per $250.
    const axX = W - (narrow ? 8 : 26);
    let axis = '';
    for (const v of [0, 1, 2, 3, 4, 5, 6].map((i) => V1 - (i * (V1 - V0)) / 6)) {
      const y = Y(v), goal = v === s.target, start = v === s.start, limit = s.limit != null && Math.abs(v - s.limit) < 0.5;
      axis += `<line class="sc-axl ${goal ? 'goal' : start ? 'start' : limit ? 'limit' : ''}" x1="${f1(at(v).x)}" x2="${axX - (narrow ? 44 : goal || start || limit ? 96 : 52)}" y1="${f1(y)}" y2="${f1(y)}"/>`;
      axis += `<text class="sc-ax ${goal ? 'goal' : start ? 'start' : limit ? 'limit' : ''}" x="${axX}" y="${f1(y + 4)}" text-anchor="end">${goal && !narrow ? 'Goal · ' : start && !narrow ? 'Start · ' : limit && !narrow ? 'Limit · ' : ''}${usd0(v)}</text>`;
    }
    // Lights: where each past 30-day run ended. Runs that doubled become gold stars above the summit.
    const r = rng(99), lr = narrow ? 1.05 : 1.3, buckets = ['', '', '', '', '', ''];
    const dot = (x, y, q) => `M${f1(x - q)},${f1(y)}a${q},${q} 0 1,0 ${2 * q},0a${q},${q} 0 1,0 ${-2 * q},0`;
    let gold = '', i = 0;
    for (const e of s.ends) {
      const v = e * s.start, u = r(), j = r(); i++;
      if (v >= s.target) {
        const a = Math.PI * (1.08 + 0.84 * u), rad = (22 + 64 * j) * k;
        gold += `<circle cx="${f1(sx + Math.cos(a) * rad)}" cy="${f1(yTop - 8 * k + Math.sin(a) * rad * 0.85)}" r="${f1((1.5 + j * 1.1) * Math.max(0.8, k))}"/>`;
        continue;
      }
      const y = Y(Math.max(v, V0 + 6)) + (j - 0.5) * 3, xa = flankX(y) + 7, xb = spineX(y) - 5;
      const b = (v < s.start ? 0 : 3) + (i % 7 === 0 ? 1 : i % 7 === 3 ? 2 : 0);
      buckets[b] += dot(xb - xa > 4 ? lerp(xa, xb, u) : (xa + xb) / 2, y, lr);
    }
    const base = at(s.start), tent = { x: base.x + 30 * k, y: at(s.start - 14).y };
    const camps = [1, 2, 3].map((i) => s.start + (i * (s.target - s.start)) / 4).map((v) => { const p = at(v); return `<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="3.2" fill="#0a1528" stroke="rgba(235,242,255,0.75)" stroke-width="1.4"/>`; }).join('');
    gStatic.innerHTML = `<defs>
        <linearGradient id="scL" gradientUnits="userSpaceOnUse" x1="0" y1="${yTop}" x2="0" y2="${H}">${[0, 0.09, 0.22, 0.45, 0.76, 1].map((o, i) => `<stop offset="${o}" style="stop-color:var(--mL${i})"/>`).join('')}</linearGradient>
        <linearGradient id="scR" gradientUnits="userSpaceOnUse" x1="0" y1="${yTop}" x2="0" y2="${H}">${[0, 0.08, 0.22, 0.5, 1].map((o, i) => `<stop offset="${o}" style="stop-color:var(--mR${i})"/>`).join('')}</linearGradient>
        <linearGradient id="scMist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050b16" stop-opacity="0"/><stop offset="1" stop-color="#050b16"/></linearGradient>
        <radialGradient id="scHalo"><stop offset="0" stop-color="#fff3cf" stop-opacity="0.28"/><stop offset="1" stop-color="#fff3cf" stop-opacity="0"/></radialGradient>
        <radialGradient id="scTent"><stop offset="0" stop-color="#ffcf8a" stop-opacity="0.55"/><stop offset="1" stop-color="#ffcf8a" stop-opacity="0"/></radialGradient>
        <filter id="scGlow" x="-300%" y="-300%" width="700%" height="700%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <path class="sc-par0" d="${ridge(3, H * 0.66, H * 0.2)}" style="fill:var(--rg0)" opacity="0.75"/>
      <path class="sc-par1" d="${ridge(5, H * 0.8, H * 0.17)}" style="fill:var(--rg1)"/>
      <path d="${rightFace}" fill="url(#scR)"/><path d="${left}" fill="url(#scL)"/>
      <g fill="none" stroke-width="1">${strata}</g>
      <g shape-rendering="crispEdges">${axis}</g>
      <g class="sc-lights"><path class="lo" d="${buckets[0]}"/><path class="lo tw1" d="${buckets[1]}"/><path class="lo tw2" d="${buckets[2]}"/><path class="hi" d="${buckets[3]}"/><path class="hi tw1" d="${buckets[4]}"/><path class="hi tw2" d="${buckets[5]}"/></g>
      <path class="sc-route" d="${geo.path(V0, V1)}" fill="none" stroke-width="1.6" stroke-dasharray="0.1 6" stroke-linecap="round"/>
      ${camps}
      <circle class="sc-fire" cx="${f1(tent.x)}" cy="${f1(tent.y - 4)}" r="${f1(26 * k)}" fill="url(#scTent)"/>
      <path d="M${f1(tent.x - 9)},${f1(tent.y)}l9,-13l9,13z" fill="#ffcf8a"/><path d="M${f1(tent.x - 2.6)},${f1(tent.y)}l2.6,-6l2.6,6z" fill="#3b2a12"/>
      <g class="sc-gold" filter="url(#scGlow)">${gold}</g>
      <path class="sc-pole" d="M${f1(sx)},${f1(yTop + 1)}v${f1(-30 * k)}" stroke-width="1.6" stroke-linecap="round"/><path class="sc-flag" d="M${f1(sx)},${f1(yTop - 30 * k)}l${f1(19 * k)},${f1(6 * k)}l${f1(-19 * k)},${f1(7 * k)}z"/>
      <g class="sc-lamp"><title>The summit lamp is the market light: green when the desk may buy, red when it waits.</title><circle class="h" cx="${f1(sx)}" cy="${f1(yTop - 30 * k - 5)}" r="8"/><circle class="b" cx="${f1(sx)}" cy="${f1(yTop - 30 * k - 5)}" r="${f1(Math.max(3.2, 4 * k))}"/></g>
      <rect x="0" y="${f1(H * 0.84)}" width="${W}" height="${f1(H * 0.16 + 1)}" fill="url(#scMist)" pointer-events="none"/>`;
  }

  function drawMoon(s) {
    const g = geo, r = g.narrow ? 13 : 21, cx = g.W * (g.overlay ? 0.875 : 0.855), cy = g.H * (g.overlay ? 0.15 : g.narrow ? 0.14 : 0.2); // on phones it sits clear of the goal label
    const f = s.waiting ? 0 : s.timed === false ? (((s.dayN - 1) % 30) + 1) / 30 : clamp(s.dayN / s.days, 0, 1);
    let lit = '';
    if (f >= 0.985) lit = `<circle class="lit" cx="${cx}" cy="${cy}" r="${r}"/>`;
    else if (f > 0.01) lit = `<path class="lit" d="M${cx},${cy - r}A${r},${r} 0 0 1 ${cx},${cy + r}A${f1(r * Math.abs(1 - 2 * f))},${r} 0 0 ${f < 0.5 ? 0 : 1} ${cx},${cy - r}Z"/>`;
    gMoon.innerHTML = `<title>The moon fills as the 30 days pass.</title><circle class="halo" cx="${cx}" cy="${cy}" r="${r * (1.6 + 2.2 * f)}" fill="url(#scHalo)"/>
      <circle class="dark" cx="${cx}" cy="${cy}" r="${r}"/>${lit}
      <text class="sc-moon-l" x="${cx}" y="${cy + r + 17}" text-anchor="middle">${s.waiting ? 'Day 0' : s.done ? `Day ${s.days}` : `Day ${s.dayN}`}${s.timed === false ? '' : ` of ${s.days}`}</text>`;
  }

  function drawDyn() {
    const s = cur, g = geo, sh = shown, col = sh.equity >= s.start - 0.005 ? '#5df28a' : '#ff6b7a';
    const me = g.at(sh.equity), labels = [];
    let h = '';
    const a = Math.min(sh.equity, s.start), b = Math.min(V1, Math.max(sh.equity, s.start));
    if (b - a > 0.5) h += `<path class="sc-trail" d="${g.path(a, b)}" style="color:${col}"/>`;
    if (s.showPace) { const p = g.at(sh.pace); h += `<circle class="sc-pace" cx="${f1(p.x)}" cy="${f1(p.y)}" r="5"/>`; labels.push({ p, side: 1, k: 'Pace today', v: usd0(sh.pace) }); }
    if (s.hasFloor && sh.equity - sh.floor > 1 && sh.floor < s.target - 4) { const p = g.at(sh.floor); h += `<path class="sc-floor" d="M${f1(p.x - 6)},${f1(p.y)}l6,-6l6,6l-6,6z"/>`; labels.push({ p, side: -1, k: 'If stops are hit', v: usd0(sh.floor) }); }
    if (sh.peak > Math.max(sh.equity * 1.012, s.start + 5) && sh.peak < s.target - 4) { const p = g.at(sh.peak); h += `<path class="sc-high" d="M${f1(p.x - 7)},${f1(p.y)}h14"/>`; labels.push({ p, side: 1, k: 'Highest', v: usd0(sh.peak) }); }
    labels.push({ p: me, side: -1, k: sh.equity >= s.target ? 'Goal reached' : 'Now', v: usd0(sh.equity), me: true });
    // Place labels: beside the marker, flipped when they would run off the scene or under the headline, then spread apart.
    for (const l of labels) {
      l.w = (l.k.length + l.v.length + 1) * (l.me ? 7.6 : 6.6) + 6;
      if (l.side < 0 && (l.p.x - 20 - l.w < 6 || (s.avoid && l.p.x - 20 - l.w < s.avoid.right + 12 && l.p.y < s.avoid.bottom + 18))) l.side = 1;
      if (l.side > 0 && l.p.x + 20 + l.w > g.W - (g.narrow ? 52 : 110) && l.p.x - 20 - l.w > 6) l.side = -1;
      l.y = l.p.y + 4;
    }
    for (const side of [-1, 1]) {
      const col2 = labels.filter((l) => l.side === side).sort((p, q) => p.y - q.y);
      for (let i = 1; i < col2.length; i++) if (col2[i].y - col2[i - 1].y < 19) col2[i].y = col2[i - 1].y + 19;
    }
    for (const l of labels) {
      const x = l.p.x + l.side * 20;
      if (Math.abs(l.y - 4 - l.p.y) > 5) h += `<path d="M${f1(l.p.x + l.side * 9)},${f1(l.p.y)}L${f1(x - l.side * 3)},${f1(l.y - 4)}" stroke="rgba(235,242,255,0.4)" fill="none"/>`;
      h += `<text class="sc-lab ${l.me ? 'me' : ''}" x="${f1(x)}" y="${f1(l.y)}" text-anchor="${l.side < 0 ? 'end' : 'start'}"><tspan class="k">${l.k}</tspan> <tspan class="v">${l.v}</tspan></text>`;
    }
    h += `<circle class="sc-me-halo" cx="${f1(me.x)}" cy="${f1(me.y)}" r="13" style="color:${col}"/><circle cx="${f1(me.x)}" cy="${f1(me.y)}" r="9" fill="${col}" stroke="#07101f" stroke-width="2"/><circle cx="${f1(me.x)}" cy="${f1(me.y)}" r="4" fill="#fff"/>`;
    gDyn.innerHTML = h;
  }

  function burst() {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('class', 'sc-burst'); c.setAttribute('cx', geo.sx); c.setAttribute('cy', geo.yTop); c.setAttribute('r', 14);
    svg.appendChild(c); setTimeout(() => c.remove(), 2400);
  }

  // ---------- sky ----------
  function drawAurora(t) {
    const a = au.getContext('2d'), w = au.width, h = au.height;
    a.clearRect(0, 0, w, h); a.globalCompositeOperation = 'lighter';
    for (let j = 0; j < 3; j++) for (let x = 0; x < w; x++) {
      const u = x / w, env = geo.overlay ? clamp((u - 0.2) / 0.26, 0, 1) : 1;
      const al = (0.32 + 0.3 * Math.sin(u * 23 + t * 0.8 + j * 3.1) + 0.26 * Math.sin(u * 3.1 - t * 0.15 + j)) * env * (j === 2 ? 0.5 : 1);
      if (al <= 0.02) continue;
      const len = h * (0.5 + 0.16 * Math.sin(u * 8.3 + t * 0.4 + j * 2.3));
      const y1 = h * (0.5 + 0.13 * j + 0.1 * Math.sin(u * 5.2 + t * 0.21 + j * 1.9) + 0.045 * Math.sin(u * 13.7 - t * 0.33 + j));
      a.globalAlpha = Math.min(1, al); a.drawImage(strips[j], 0, 0, 1, 64, x, y1 - len, 1, len);
    }
    a.globalAlpha = 1; a.globalCompositeOperation = 'source-over';
  }
  // Today in Montreal at a given hour of the clock (for looking at the scene at another time of day).
  function atHour(h) {
    const now = Date.now(), p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: PLACE.tz, hourCycle: 'h23', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(now).map((x) => [x.type, +x.value]));
    return now + (h - (p.hour + p.minute / 60 + p.second / 3600)) * 3_600_000;
  }
  // One soft cloud, drawn once: a lit top over a darker underside.
  function cloudSprite(seed, top, under) {
    const c = document.createElement('canvas'); c.width = 340; c.height = 140;
    const x = c.getContext('2d'), r = rng(seed);
    const puff = (cx, cy, rad, col, al) => { const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad); g.addColorStop(0, rgb(col, al)); g.addColorStop(0.5, rgb(col, al * 0.72)); g.addColorStop(1, rgb(col, 0)); x.fillStyle = g; x.fillRect(cx - rad, cy - rad, rad * 2, rad * 2); };
    const blobs = Array.from({ length: 9 }, (_, i) => ({ cx: 58 + (i / 8) * 224 + (r() - 0.5) * 26, cy: 84 - Math.sin((i / 8) * Math.PI) * 24 * (0.55 + r() * 0.7), rad: 30 + r() * 24 }));
    for (const q of blobs) puff(q.cx, q.cy + 13, q.rad, under, 0.5);
    for (const q of blobs) puff(q.cx, q.cy, q.rad * 0.9, top, 0.6);
    return c;
  }
  // Works out where the sun is, then sets every colour that depends on the light: the sky behind the page's
  // headline (CSS variables on the hero), the mountain's faces, the far ridges and the clouds.
  function readSky(t) {
    const s = sunAt(clock());
    sky = { ...s, light: smooth(-9, 5, s.el), glow: Math.exp(-((s.el / (s.el < 0 ? 6.5 : 7)) ** 2)) };
    skyAt = t;
    applySky();
  }
  function applySky() {
    if (!sky) return;
    const L = sky.light, c = wx.cloud, G = sky.glow * (1 - 0.75 * c), q = (x, n) => Math.round(x * n);
    const k2 = `${q(L, 50)}|${q(G, 25)}|${q(c, 25)}|${q(wx.fog, 10)}|${cur?.on ? 1 : 0}`;
    if (k2 !== skyKey) {
      skyKey = k2;
      const S = PAL.sky, set = (el, name, col) => el.style.setProperty(name, rgb(col));
      S.night.forEach((n, i) => set(host, `--sky-${i}`, mix(mix(mix(n, S.day[i], L), mix(S.grayNight[i], S.grayDay[i], L), c * 0.85), S.dusk[i], G * [0.3, 0.55, 0.85, 0.95][i])));
      const dull = (col) => mix(mix(col, gray(col), c * 0.45), [0, 0, 0], c * 0.1 * L);
      PAL.left.night.forEach((n, i) => set(root, `--mL${i}`, dull(mix(mix(n, PAL.left.day[i], L), WARM, G * [0.5, 0.45, 0.3, 0.12, 0, 0][i]))));
      PAL.right.night.forEach((n, i) => set(root, `--mR${i}`, dull(mix(mix(n, PAL.right.day[i], L), MAUVE, G * [0.3, 0.26, 0.18, 0.06, 0][i]))));
      PAL.ridge.night.forEach((n, i) => set(root, `--rg${i}`, dull(mix(mix(n, PAL.ridge.day[i], L), PAL.ridge.dusk[i], G * 0.6))));
      const night = (1 - L) ** 2;
      host.style.setProperty('--day', L.toFixed(3));
      host.style.setProperty('--aur', (night * (cur?.on === false ? 0.25 : 1) * (1 - 0.6 * c)).toFixed(3));
      host.style.setProperty('--murk', (night * c).toFixed(3));
      root.style.setProperty('--cap', (smooth(0.55, 0.95, c) * 0.9 + wx.fog * 0.5).toFixed(3));
      root.style.setProperty('--cap-c', rgb(mix([196, 208, 236], [255, 255, 255], L), 0.2 + 0.2 * L));
      root.style.setProperty('--flag', `${(3 - 2.1 * wx.wind).toFixed(2)}s`); // the summit flag flutters faster when Montreal is windy
      root.classList.toggle('day', L > 0.5); host.classList.toggle('day', L > 0.5);
    }
    const k3 = `${q(L, 12)}|${q(G, 8)}|${q(c, 6)}`;
    if (k3 !== tintKey) {
      tintKey = k3;
      const top = mix(mix(mix([58, 72, 104], [255, 255, 255], L), [255, 200, 168], G * 0.65), mix([44, 54, 76], [170, 180, 194], L), smooth(0.6, 1, c) * 0.6);
      const under = mix(mix(mix([22, 32, 56], [168, 190, 220], L), [176, 112, 128], G * 0.55), mix([18, 24, 38], [104, 116, 134], L), smooth(0.6, 1, c) * 0.7);
      sprites = [21, 22, 23, 24].map((seed) => cloudSprite(seed, top, under));
    }
    note();
  }
  // Tells the page what the sky is showing, for the legend under the scene.
  function note() {
    if (!opts.onSky || !sky) return;
    const info = { place: PLACE.name, time: timeFmt.format(clock()), label: wxT.label, temp: wxT.temp, known: wxKnown, day: sky.light > 0.5 };
    const k2 = `${info.time}|${info.label}|${info.temp}|${info.known}`;
    if (k2 !== noteKey) { noteKey = k2; opts.onSky(info); }
  }
  function setWeather(report) { Object.assign(wxT, weatherOf(report)); wxKnown = true; noteKey = ''; if (reduced && cur) { Object.assign(wx, wxT); applySky(); paint(3, 0); } else note(); }
  async function loadWeather() {
    if (PRESET[opts.weather]) return;
    try {
      let hit = null;
      try { hit = JSON.parse(localStorage.getItem(WX_KEY) || 'null'); } catch { /* private mode */ }
      if (!hit || Date.now() - hit.t > 10 * 60_000) {
        const r = await fetch(WX_URL);
        if (!r.ok) return;
        const now = (await r.json()).current;
        hit = { t: Date.now(), w: { code: now.weather_code, cloud: now.cloud_cover, wind: now.wind_speed_10m, temp: now.temperature_2m } };
        try { localStorage.setItem(WX_KEY, JSON.stringify(hit)); } catch { /* private mode */ }
      }
      setWeather(hit.w);
    } catch { /* offline: the sky still follows the sun, with clear weather */ }
  }
  loadWeather();
  setInterval(() => { if (!document.hidden) loadWeather(); }, 15 * 60_000);

  // Where the sun sits in the scene: it rises on the left, is highest at solar noon and sets on the right.
  function sunXY() {
    const g = geo, hz = g.H * 0.62, top = g.H * (g.overlay ? 0.1 : 0.17);
    return { x: lerp(g.W * (g.overlay ? 0.37 : 0.04), g.W * (g.overlay ? 0.87 : 0.9), clamp(sky.arc, -0.25, 1.25)), y: hz - (hz - top) * Math.max(-0.4, sky.height) };
  }
  function drawSun(t) {
    if (sky.el < -3) return;
    const p = sunXY(), R = (geo.narrow ? 15 : 25) * clamp(geo.k, 0.8, 1.1), vis = clamp((sky.el + 3) / 4, 0, 1), veil = 1 - smooth(0.6, 1, wx.cloud); // only thick cloud hides the sun
    const col = mix([255, 252, 232], [255, 176, 96], clamp(sky.glow * 1.1, 0, 1));
    let gr = sctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R * 9);
    gr.addColorStop(0, rgb(col, 0.5 * vis * (0.35 + 0.65 * veil))); gr.addColorStop(0.25, rgb(col, 0.16 * vis * (0.35 + 0.65 * veil))); gr.addColorStop(1, rgb(col, 0));
    sctx.globalAlpha = 1; sctx.fillStyle = gr; sctx.fillRect(p.x - R * 9, p.y - R * 9, R * 18, R * 18);
    gr = sctx.createRadialGradient(p.x, p.y, R * 0.72, p.x, p.y, R * 1.1);
    gr.addColorStop(0, rgb(col, vis * (0.1 + 0.9 * veil ** 1.5))); gr.addColorStop(1, rgb(col, 0));
    sctx.fillStyle = gr; sctx.beginPath(); sctx.arc(p.x, p.y, R * 1.1, 0, 6.2832); sctx.fill();
    // Slowly turning rays while the sun is up and not behind cloud.
    const ray = vis * veil * clamp(sky.el / 6, 0, 1);
    if (ray > 0.05) {
      sctx.save(); sctx.translate(p.x, p.y); sctx.rotate(t * 0.035); sctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 12; i++) {
        sctx.rotate(Math.PI / 6);
        const len = R * (i % 2 ? 4.2 : 6.4), g2 = sctx.createLinearGradient(0, R * 1.15, 0, len);
        g2.addColorStop(0, rgb(col, 0.13 * ray)); g2.addColorStop(1, rgb(col, 0));
        sctx.fillStyle = g2; sctx.beginPath(); sctx.moveTo(-R * 0.17, R * 1.15); sctx.lineTo(R * 0.17, R * 1.15); sctx.lineTo(0, len); sctx.closePath(); sctx.fill();
      }
      sctx.restore();
    }
  }
  function drawClouds(t) {
    const { W, H, overlay } = geo, n = wx.cloud * clouds.length, sc = clamp(W / 1300, 0.55, 1.25), span = W + 520 * sc;
    for (let i = 0; i < clouds.length && i < n; i++) {
      const c = clouds[i], w = 340 * sc * c.s, x = ((((c.u * span + t * (3 + wx.wind * 16) * c.v) % span) + span) % span) - 260 * sc, y = H * c.y;
      // Clouds thin out behind the headline on the wide layout, so the text stays easy to read.
      const al = clamp(n - i, 0, 1) * (overlay ? smooth(W * 0.24, W * 0.46, x + w / 2) : 1) * 0.95;
      if (al < 0.01) continue;
      sctx.globalAlpha = al; sctx.drawImage(sprites[c.sp], x, y - 70 * sc * c.s, w, 140 * sc * c.s);
    }
    sctx.globalAlpha = 1;
  }
  function paint(t, dt) {
    const { W, H } = geo;
    if (!sky || !dt || t - skyAt > 20) readSky(t); // the sun moves a quarter of a degree a minute
    let moved = false;
    for (const f of WXF) { const d = wxT[f] - wx[f]; if (Math.abs(d) > 0.002) { wx[f] = dt ? wx[f] + d * Math.min(1, dt * 0.8) : wxT[f]; moved = true; } else wx[f] = wxT[f]; }
    if (moved) applySky();
    const day = sky.light, night = (1 - day) ** 2, open = 1 - 0.85 * wx.cloud;
    const want = (cur?.on ? 1 : 0) * night * (1 - 0.7 * wx.cloud);
    aurora = aurora < 0 || !dt ? want : aurora + (want - aurora) * Math.min(1, dt * 0.7);
    sctx.clearRect(0, 0, W, H);
    if (night * open > 0.01) {
      sctx.fillStyle = '#fff';
      for (const s of stars) { sctx.globalAlpha = s.a * (0.62 + 0.38 * Math.sin(t * s.f + s.p)) * night * open; sctx.beginPath(); sctx.arc(s.x, s.y, s.s, 0, 6.2832); sctx.fill(); }
    }
    sctx.globalAlpha = 1;
    drawSun(t);
    if (aurora > 0.01) { drawAurora(t); sctx.globalAlpha = aurora * 0.85; sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = 'high'; sctx.drawImage(au, 0, 0, W, H * 0.7); }
    if (dt && aurora > 0.6) {
      if (!meteor && t > nextMeteor) meteor = { x: W * (0.35 + Math.random() * 0.5), y: H * (0.04 + Math.random() * 0.16), life: 0 };
      if (meteor) {
        meteor.life += dt; const q = meteor.life / 0.8, x = meteor.x - q * 190, y = meteor.y + q * 82;
        const gr = sctx.createLinearGradient(x, y, x + 70, y - 30); gr.addColorStop(0, `rgba(255,255,255,${0.9 * (1 - q)})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
        sctx.globalAlpha = 1; sctx.strokeStyle = gr; sctx.lineWidth = 1.4; sctx.beginPath(); sctx.moveTo(x, y); sctx.lineTo(x + 70, y - 30); sctx.stroke();
        if (q >= 1) { meteor = null; nextMeteor = t + 9 + Math.random() * 16; }
      }
    }
    sctx.globalAlpha = 1;
    if (wx.cloud > 0.02) drawClouds(t);
    // Weather that falls in front of the mountain.
    fctx.clearRect(0, 0, W, H);
    if (wx.snow > 0.01) {
      const n = Math.ceil(flakes.length * clamp(wx.snow, 0.3, 1)), al = Math.min(1, wx.snow * 2.5) * (1 + 0.35 * day), blow = 7 + wx.wind * 46;
      fctx.fillStyle = day > 0.5 ? '#ffffff' : '#eaf1ff';
      for (let i = 0; i < n; i++) {
        const f = flakes[i];
        if (dt) { f.y += f.v * dt; f.x += (Math.sin(t * 0.7 + f.w) * 9 - blow) * dt; if (f.y > H) { f.y = -4; f.x = Math.random() * W; } if (f.x < -4) f.x = W + 3; }
        fctx.globalAlpha = Math.min(1, f.a * al); fctx.beginPath(); fctx.arc(f.x, f.y, f.s, 0, 6.2832); fctx.fill();
      }
    }
    if (wx.rain > 0.01) {
      const n = Math.ceil(drops.length * clamp(wx.rain, 0.2, 1)), al = Math.min(1, wx.rain * 2.2), lean = 0.1 + wx.wind * 0.42;
      fctx.strokeStyle = day > 0.5 ? '#e4eefc' : '#a9bbdc'; fctx.lineWidth = 1.1; fctx.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const d = drops[i];
        if (dt) { d.y += d.v * dt; d.x -= d.v * lean * dt; if (d.y > H + 20) { d.y = -20; d.x = Math.random() * (W * 1.3); } if (d.x < -20) d.x += W + 40; }
        fctx.globalAlpha = d.a * al; fctx.beginPath(); fctx.moveTo(d.x, d.y); fctx.lineTo(d.x + d.l * lean, d.y - d.l); fctx.stroke();
      }
    }
    if (wx.fog > 0.01) {
      const col = mix([70, 84, 110], [214, 222, 232], day), gr = fctx.createLinearGradient(0, H * 0.12, 0, H * 0.78);
      gr.addColorStop(0, rgb(col, 0)); gr.addColorStop(0.6, rgb(col, 0.4 * wx.fog)); gr.addColorStop(1, rgb(col, 0.16 * wx.fog));
      fctx.globalAlpha = 1; fctx.fillStyle = gr; fctx.fillRect(0, 0, W, H);
    }
    if (wx.storm > 0.5 && dt) {
      if (t > nextFlash) { flash = 1; nextFlash = t + 6 + Math.random() * 14; }
      if (flash > 0.01) { fctx.globalAlpha = flash * 0.2; fctx.fillStyle = '#eef3ff'; fctx.fillRect(0, 0, W, H); flash *= Math.exp(-dt * 9); }
    }
    fctx.globalAlpha = 1;
  }
  function tick(now) {
    requestAnimationFrame(tick);
    if (!visible || document.hidden || !geo || !cur || now - last < 32) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    paint(now / 1000, dt);
  }
  if (!reduced) {
    if ('IntersectionObserver' in window) new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe(root);
    requestAnimationFrame(tick);
    // Depth: with a mouse, the far ridges and the sky slide a few pixels against the mountain as the pointer moves.
    let par = 0;
    const lean = (x, y) => { cancelAnimationFrame(par); par = requestAnimationFrame(() => { root.style.setProperty('--px', x.toFixed(3)); root.style.setProperty('--py', y.toFixed(3)); }); };
    host.addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse') return; const r = host.getBoundingClientRect(); lean(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1); }, { passive: true });
    host.addEventListener('pointerleave', () => lean(0, 0), { passive: true });
  }

  return {
    /** state: { start, target, days, dayN, equity, pace, floor, peak, waiting, done, on, showPace, hasFloor, ends, overlay, avoid } */
    update(state) {
      const W = root.clientWidth, H = root.clientHeight;
      if (!W || !H) return;
      V1 = state.target; V0 = state.start - (state.target - state.start) / 2; // base camp sits a third of the way up
      const k2 = `${W}x${H}|${state.overlay}|${state.ends.length}|${state.start}|${state.target}|${state.limit}`;
      cur = state;
      const fresh = k2 !== key;
      if (fresh) { key = k2; setup(W, H, state.overlay); drawStatic(state); shown = null; }
      root.classList.toggle('off', !state.on);
      if (!sky) readSky(performance.now() / 1000); else applySky();
      if (fresh && !reduced) paint(performance.now() / 1000, 0); // a resized canvas is blank: draw the sky now, not at the next frame
      drawMoon(state);
      const target = Object.fromEntries(FIELDS.map((f) => [f, state[f]]));
      cancelAnimationFrame(tw);
      if (!shown || reduced || state.snap) { shown = target; drawDyn(); if (reduced) paint(3, 0); return; }
      const from = { ...shown }, t0 = performance.now();
      if (from.equity < state.target && target.equity >= state.target) setTimeout(burst, 500);
      const step = (now) => {
        const q = Math.min(1, (now - t0) / 900), e = 1 - (1 - q) ** 3;
        for (const f of FIELDS) shown[f] = lerp(from[f], target[f], e);
        drawDyn();
        if (q < 1) tw = requestAnimationFrame(step);
      };
      tw = requestAnimationFrame(step);
    },
  };
}
