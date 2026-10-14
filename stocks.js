// Stock lookup + option-selling projections for stocks.html.
// Projections are statistical: they assume prices move like a random walk
// with the stock's own recent (historical) volatility and no drift. Real
// option premiums are priced off implied volatility, which is usually higher.

const FINNHUB_CONFIGURED = !FINNHUB_API_KEY.includes('YOUR_');
const RISK_FREE_RATE = 0.04;
const HORIZON_WEEKS = [1, 2, 3, 4];

// z-scores for the strike/target picks.
const Z_SHORT_STRIKE = 0.84; // ~20% chance of finishing in the money (~0.20 delta)
const Z_SELL_TARGET = 0.674; // ~25% chance of closing above, ~50% chance of touching

// ---------- data fetching ----------

async function fetchJson(url, source) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${source} returned ${res.status}`);
  return res.json();
}

async function fetchPriceHistory(symbol) {
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=260&apikey=${TWELVE_DATA_API_KEY}`;
  // Twelve Data puts a readable reason in the body even on 4xx, so don't use fetchJson.
  const res = await fetch(url);
  const data = await res.json().catch(() => ({ message: `Twelve Data returned ${res.status}` }));
  if (data.status !== 'ok') {
    throw new Error(data.message || `No price history found for ${symbol}`);
  }
  // Twelve Data returns newest first.
  const bars = data.values.map((v) => ({
    date: v.datetime,
    open: +v.open, high: +v.high, low: +v.low, close: +v.close, volume: +v.volume,
  })).reverse();
  return { meta: data.meta, bars };
}

function finnhub(path) {
  const sep = path.includes('?') ? '&' : '?';
  return fetchJson(`https://finnhub.io/api/v1/${path}${sep}token=${FINNHUB_API_KEY}`, 'Finnhub');
}

function isoDate(d) { return d.toISOString().slice(0, 10); }

// ---------- symbol search (ticker or company name) ----------

const SEARCHABLE_TYPES = new Set(['Common Stock', 'ETP', 'ADR', 'ETF', 'Depositary Receipt', 'REIT']);
const searchCache = new Map();

async function finnhubSearch(q) {
  const data = await finnhub(`search?q=${encodeURIComponent(q)}&exchange=US`);
  return (data.result || [])
    .filter((r) => SEARCHABLE_TYPES.has(r.type))
    .map((r) => ({ symbol: r.symbol, name: r.description, type: r.type === 'ETP' ? 'ETF' : r.type }));
}

// Keyless fallback. Lists every global exchange, so keep US listings only.
async function twelveDataSearch(q) {
  const data = await fetchJson(`https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(q)}&outputsize=30`, 'Twelve Data');
  return (data.data || [])
    .filter((r) => r.country === 'United States' && SEARCHABLE_TYPES.has(r.instrument_type))
    .map((r) => ({ symbol: r.symbol, name: r.instrument_name, type: r.instrument_type }));
}

// Exact ticker first, then names starting with the query, then the provider's order.
function rankMatches(q, matches) {
  const upper = q.toUpperCase();
  const lower = q.toLowerCase().replace(/[^a-z0-9]/g, '');
  const score = (m) => {
    if (m.symbol.toUpperCase() === upper) return 0;
    if (m.name.toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '').startsWith(lower)) return 1;
    return 2;
  };
  const seen = new Set();
  return matches
    .map((m, i) => ({ m, i, s: score(m) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map(({ m }) => m)
    .filter((m) => !seen.has(m.symbol) && seen.add(m.symbol));
}

async function searchSymbols(query) {
  const q = query.trim();
  if (!q) return [];
  const key = q.toLowerCase();
  if (searchCache.has(key)) return searchCache.get(key);

  // Finnhub misses "coca cola" but finds "coca-cola", so try a hyphenated variant too.
  const attempts = [];
  if (FINNHUB_CONFIGURED) {
    attempts.push(() => finnhubSearch(q));
    if (/\s/.test(q)) attempts.push(() => finnhubSearch(q.replace(/\s+/g, '-')));
  }
  attempts.push(() => twelveDataSearch(q));

  let results = [];
  for (const attempt of attempts) {
    try {
      results = await attempt();
    } catch {
      results = [];
    }
    if (results.length) break;
  }
  results = rankMatches(q, results).slice(0, 8);
  searchCache.set(key, results);
  return results;
}

// Turns whatever the user typed into one ticker: an exact ticker match wins,
// otherwise the best company-name match. Falls back to treating it as a ticker.
async function resolveSymbol(query) {
  const q = query.trim();
  const looksLikeTicker = /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/.test(q);
  const matches = await searchSymbols(q);
  if (matches.length) return matches[0];
  if (looksLikeTicker) return { symbol: q.toUpperCase(), name: null };
  return null;
}

// Everything Finnhub offers on the free tier. Each piece fails independently
// so one missing endpoint doesn't blank the whole page.
async function fetchCompanyData(symbol) {
  if (!FINNHUB_CONFIGURED) return null;
  const s = encodeURIComponent(symbol);
  const today = new Date();
  const weekAgo = new Date(today - 7 * 864e5);
  const in45 = new Date(+today + 45 * 864e5);
  const ninetyDaysAgo = new Date(today - 90 * 864e5);
  const [profile, metrics, recs, news, earnings, surprises, insiders, peers, filings] = await Promise.allSettled([
    finnhub(`stock/profile2?symbol=${s}`),
    finnhub(`stock/metric?symbol=${s}&metric=all`),
    finnhub(`stock/recommendation?symbol=${s}`),
    finnhub(`company-news?symbol=${s}&from=${isoDate(weekAgo)}&to=${isoDate(today)}`),
    finnhub(`calendar/earnings?symbol=${s}&from=${isoDate(today)}&to=${isoDate(in45)}`),
    finnhub(`stock/earnings?symbol=${s}`),
    finnhub(`stock/insider-transactions?symbol=${s}&from=${isoDate(ninetyDaysAgo)}`),
    finnhub(`stock/peers?symbol=${s}`),
    finnhub(`stock/filings?symbol=${s}`),
  ]);
  const val = (r) => (r.status === 'fulfilled' ? r.value : null);
  return {
    profile: val(profile),
    metrics: val(metrics)?.metric || null,
    recommendation: val(recs)?.[0] || null,
    news: (val(news) || []).slice(0, 8),
    nextEarnings: val(earnings)?.earningsCalendar?.sort((a, b) => a.date.localeCompare(b.date))[0] || null,
    earningsHistory: (val(surprises) || []).slice(0, 4),
    insiders: summarizeInsiders(val(insiders)?.data || []),
    peers: (val(peers) || []).filter((p) => p !== symbol).slice(0, 8),
    filings: (val(filings) || []).filter((f) => KEY_FILING_FORMS.has(f.form)).slice(0, 6),
  };
}

// Only open-market buys (P) and sells (S) say anything about insider conviction;
// grants, option exercises and tax withholding are routine.
function summarizeInsiders(rows) {
  const trades = rows.filter((r) => (r.transactionCode === 'P' || r.transactionCode === 'S') && !r.isDerivative);
  const sum = (code, f) => trades.filter((t) => t.transactionCode === code).reduce((a, t) => a + f(t), 0);
  return {
    buys: trades.filter((t) => t.transactionCode === 'P').length,
    sells: trades.filter((t) => t.transactionCode === 'S').length,
    boughtValue: sum('P', (t) => Math.abs(t.change) * (t.transactionPrice || 0)),
    soldValue: sum('S', (t) => Math.abs(t.change) * (t.transactionPrice || 0)),
    recent: trades.slice(0, 5),
  };
}

const KEY_FILING_FORMS = new Set(['10-K', '10-Q', '8-K', '20-F', '6-K', '40-F', 'S-1', 'S-3', 'DEF 14A', 'SC 13D', 'SC 13G', '424B5']);
const FILING_LABELS = {
  '10-K': 'Annual report', '10-Q': 'Quarterly report', '8-K': 'Major event', '20-F': 'Annual report (foreign)',
  '6-K': 'Foreign issuer report', '40-F': 'Annual report (Canada)', 'S-1': 'New share registration',
  'S-3': 'Share registration', 'DEF 14A': 'Proxy statement', 'SC 13D': 'Activist stake (5%+)',
  'SC 13G': 'Passive stake (5%+)', '424B5': 'Share offering',
};

// ---------- math ----------

function normCdf(x) {
  // Abramowitz-Stegun approximation, accurate to ~1e-7.
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

function blackScholes(type, S, K, T, sigma, r = RISK_FREE_RATE) {
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  if (type === 'call') {
    return { price: S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2), delta: normCdf(d1) };
  }
  return { price: K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1), delta: normCdf(d1) - 1 };
}

function annualizedVol(closes, days) {
  const slice = closes.slice(-(days + 1));
  const rets = slice.slice(1).map((c, i) => Math.log(c / slice[i]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance * 252);
}

function sma(closes, n) {
  if (closes.length < n) return null;
  return closes.slice(-n).reduce((a, b) => a + b, 0) / n;
}

function rsi(closes, n = 14) {
  if (closes.length <= n) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch > 0) gain += ch; else loss -= ch;
  }
  gain /= n; loss /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(ch, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-ch, 0)) / n;
  }
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}

// Approximate listed strike spacing so suggestions land on real-looking strikes.
function strikeIncrement(price) {
  if (price < 25) return 0.5;
  if (price < 100) return 1;
  if (price < 250) return 2.5;
  return 5;
}

function analyze(bars, companyData) {
  const closes = bars.map((b) => b.close);
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const S = last.close;
  const hv20 = annualizedVol(closes, 20);
  const hv60 = annualizedVol(closes, Math.min(60, closes.length - 1));
  // Sellers get paid for risk, so size the move with the more volatile of the two windows.
  const sigma = Math.max(hv20, hv60);
  const inc = strikeIncrement(S);
  const earningsDate = companyData?.nextEarnings?.date || null;

  const horizons = HORIZON_WEEKS.map((weeks) => {
    const days = weeks * 7;
    const T = days / 365;
    const s = sigma * Math.sqrt(T);
    const expiry = new Date(last.date + 'T00:00:00');
    expiry.setDate(expiry.getDate() + days);
    const expiryIso = isoDate(expiry);

    const putK = Math.floor((S * Math.exp(-Z_SHORT_STRIKE * s)) / inc) * inc;
    const callK = Math.ceil((S * Math.exp(Z_SHORT_STRIKE * s)) / inc) * inc;
    const put = blackScholes('put', S, putK, T, sigma);
    const call = blackScholes('call', S, callK, T, sigma);

    return {
      weeks,
      expiry: expiryIso,
      low: S * Math.exp(-s),
      high: S * Math.exp(s),
      sellTarget: S * Math.exp(Z_SELL_TARGET * s),
      put: {
        strike: putK,
        premium: put.price,
        delta: put.delta,
        probOtm: 1 - normCdf(Math.log(putK / S) / s),
        annualizedReturn: (put.price / putK) * (365 / days),
      },
      call: {
        strike: callK,
        premium: call.price,
        delta: call.delta,
        probOtm: normCdf(Math.log(callK / S) / s),
        annualizedReturn: (call.price / S) * (365 / days),
      },
      earningsBeforeExpiry: !!earningsDate && earningsDate <= expiryIso,
    };
  });

  const last20 = bars.slice(-20);
  const yearBars = bars.slice(-252);
  return {
    price: S,
    change: S - prev.close,
    changePct: (S - prev.close) / prev.close,
    asOf: last.date,
    hv20, hv60, sigma,
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    rsi14: rsi(closes),
    support: Math.min(...last20.map((b) => b.low)),
    resistance: Math.max(...last20.map((b) => b.high)),
    yearLow: Math.min(...yearBars.map((b) => b.low)),
    yearHigh: Math.max(...yearBars.map((b) => b.high)),
    avgVolume: last20.reduce((a, b) => a + b.volume, 0) / last20.length,
    earningsDate,
    horizons,
  };
}

// ---------- formatting ----------

const fmtUsd = (n, digits = 2) => (n == null || isNaN(n) ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`);
const fmtPct = (n, digits = 1) => (n == null || isNaN(n) ? '—' : `${(n * 100).toFixed(digits)}%`);
const fmtNum = (n, digits = 2) => (n == null || isNaN(n) ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: digits }));

function fmtBig(n) {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

function fmtDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---------- price chart (inline SVG) ----------

function renderPriceChart(container, bars, a) {
  const hist = bars.slice(-126); // ~6 months
  const W = 760, H = 300, padL = 8, padR = 64, padT = 16, padB = 28;
  const futureDays = 20; // ~4 weeks of trading days
  const n = hist.length + futureDays;
  const last4w = a.horizons[a.horizons.length - 1];

  const lo = Math.min(...hist.map((b) => b.close), last4w.low) * 0.98;
  const hi = Math.max(...hist.map((b) => b.close), last4w.high) * 1.02;
  const x = (i) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

  const linePath = hist.map((b, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(b.close).toFixed(1)}`).join('');
  const lastI = hist.length - 1;
  const areaPath = `${linePath}L${x(lastI).toFixed(1)},${H - padB}L${x(0).toFixed(1)},${H - padB}Z`;

  // Projection cone: 1-SD band widening with sqrt(time).
  const coneTop = [], coneBot = [];
  for (let d = 0; d <= futureDays; d++) {
    // Match the 4-week horizon's calendar-day basis so the cone ends on its labels.
    const s = a.sigma * Math.sqrt(((d / futureDays) * 28) / 365);
    coneTop.push(`${x(lastI + d).toFixed(1)},${y(a.price * Math.exp(s)).toFixed(1)}`);
    coneBot.unshift(`${x(lastI + d).toFixed(1)},${y(a.price * Math.exp(-s)).toFixed(1)}`);
  }
  const conePath = `M${coneTop.join('L')}L${coneBot.join('L')}Z`;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => lo + t * (hi - lo));
  const grid = ticks.map((v) => `
    <line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" stroke="#dde3ef" stroke-width="1" />
    <text x="${W - padR + 8}" y="${y(v) + 4}" font-size="11" fill="#274c9c">${fmtUsd(v, v >= 100 ? 0 : 2)}</text>`).join('');

  const monthLabels = [];
  let lastMonth = null;
  hist.forEach((b, i) => {
    const m = b.date.slice(0, 7);
    if (m !== lastMonth && i > 4) {
      monthLabels.push(`<text x="${x(i)}" y="${H - 8}" font-size="11" fill="#274c9c" text-anchor="middle">${new Date(b.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' })}</text>`);
    }
    lastMonth = m;
  });

  container.innerHTML = `
    <div class="relative">
      <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto block" role="img" aria-label="Closing price, last 6 months, with a 4-week projected range">
        <defs>
          <linearGradient id="px-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#2450dd" stop-opacity="0.18" />
            <stop offset="100%" stop-color="#2450dd" stop-opacity="0" />
          </linearGradient>
        </defs>
        ${grid}
        ${monthLabels.join('')}
        <path d="${areaPath}" fill="url(#px-fill)" />
        <path d="${conePath}" fill="#5c82f7" fill-opacity="0.16" stroke="#5c82f7" stroke-opacity="0.5" stroke-width="1" stroke-dasharray="4 3" />
        <line x1="${x(lastI)}" x2="${x(n - 1)}" y1="${y(a.price)}" y2="${y(a.price)}" stroke="#2450dd" stroke-width="1.5" stroke-dasharray="2 4" />
        <path d="${linePath}" fill="none" stroke="#2450dd" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        <circle cx="${x(lastI)}" cy="${y(a.price)}" r="4.5" fill="#2450dd" stroke="#fff" stroke-width="2" />
        <text x="${x(n - 1) - 4}" y="${y(last4w.high) - 6}" font-size="11" fill="#1c3a7a" text-anchor="end">4-wk high ${fmtUsd(last4w.high)}</text>
        <text x="${x(n - 1) - 4}" y="${y(last4w.low) + 15}" font-size="11" fill="#1c3a7a" text-anchor="end">4-wk low ${fmtUsd(last4w.low)}</text>
        <g data-role="cursor" style="display:none">
          <line data-role="cursor-line" y1="${padT}" y2="${H - padB}" stroke="#0a1836" stroke-opacity="0.35" stroke-width="1" />
          <circle data-role="cursor-dot" r="4.5" fill="#2450dd" stroke="#fff" stroke-width="2" />
        </g>
        <rect data-role="hit" x="${padL}" y="${padT}" width="${x(lastI) - padL}" height="${H - padT - padB}" fill="transparent" />
      </svg>
      <div data-role="tip" class="pointer-events-none absolute top-2 hidden rounded-lg bg-navy-900 text-white text-xs px-3 py-2 shadow-floating whitespace-nowrap"></div>
    </div>`;

  const svg = container.querySelector('svg');
  const hit = container.querySelector('[data-role="hit"]');
  const cursor = container.querySelector('[data-role="cursor"]');
  const cLine = container.querySelector('[data-role="cursor-line"]');
  const cDot = container.querySelector('[data-role="cursor-dot"]');
  const tip = container.querySelector('[data-role="tip"]');

  function show(evt) {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const local = pt.matrixTransform(svg.getScreenCTM().inverse());
    const i = Math.max(0, Math.min(lastI, Math.round(((local.x - padL) / (W - padL - padR)) * (n - 1))));
    const b = hist[i];
    cursor.style.display = '';
    cLine.setAttribute('x1', x(i)); cLine.setAttribute('x2', x(i));
    cDot.setAttribute('cx', x(i)); cDot.setAttribute('cy', y(b.close));
    tip.innerHTML = `<span class="text-steel-300">${fmtDate(b.date)}</span><br><span class="font-semibold">${fmtUsd(b.close)}</span> close`;
    tip.classList.remove('hidden');
    const leftPct = (x(i) / W) * 100;
    tip.style.left = leftPct > 60 ? '' : `calc(${leftPct}% + 12px)`;
    tip.style.right = leftPct > 60 ? `calc(${100 - leftPct}% + 12px)` : '';
  }
  function hide() { cursor.style.display = 'none'; tip.classList.add('hidden'); }
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerleave', hide);
}
