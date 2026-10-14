// "Market today" overview for stocks.html: indexes, sectors, big-cap movers,
// and headlines merged from free public sources. Refreshed hourly by the page.
// Index levels come from the ETFs that track them; the free tiers don't
// carry the indexes themselves.

const MARKET_INDEXES = [
  { symbol: 'SPY', label: 'S&P 500' },
  { symbol: 'QQQ', label: 'Nasdaq 100' },
  { symbol: 'DIA', label: 'Dow Jones' },
  { symbol: 'IWM', label: 'Russell 2000' },
];

const MARKET_SECTORS = [
  { symbol: 'XLK', label: 'Technology' },
  { symbol: 'XLC', label: 'Communications' },
  { symbol: 'XLY', label: 'Discretionary' },
  { symbol: 'XLP', label: 'Staples' },
  { symbol: 'XLF', label: 'Financials' },
  { symbol: 'XLV', label: 'Health Care' },
  { symbol: 'XLI', label: 'Industrials' },
  { symbol: 'XLE', label: 'Energy' },
  { symbol: 'XLB', label: 'Materials' },
  { symbol: 'XLU', label: 'Utilities' },
  { symbol: 'XLRE', label: 'Real Estate' },
];

// Free tiers have no "top movers" endpoint, so movers are ranked within these large caps.
const MARKET_WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'JPM', 'LLY'];

// Public RSS feeds that allow browser requests. Items older than 48h are dropped,
// which also filters out feeds that have quietly stopped updating.
const MARKET_FEEDS = [
  { source: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_bulletins' },
  { source: 'CNBC', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20409666' },
  { source: 'CNBC', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664' },
];
const HEADLINE_MAX_AGE_MS = 48 * 60 * 60 * 1000;

async function fetchQuote(symbol) {
  const q = await finnhub(`quote?symbol=${encodeURIComponent(symbol)}`);
  // Finnhub returns all zeros for symbols it doesn't know.
  if (!q || !q.c) return null;
  return { symbol, price: q.c, change: q.d, changePct: q.dp / 100, prevClose: q.pc };
}

// Finnhub's free tier allows 60 calls/minute (shared by every visitor using this key)
// and rejects bursts, so quotes go out a few at a time instead of all at once.
const QUOTE_BATCH_SIZE = 4;
const QUOTE_BATCH_GAP_MS = 250;

async function fetchQuotes(symbols) {
  const out = {};
  for (let i = 0; i < symbols.length; i += QUOTE_BATCH_SIZE) {
    const batch = symbols.slice(i, i + QUOTE_BATCH_SIZE);
    const settled = await Promise.allSettled(batch.map(fetchQuote));
    settled.forEach((r, n) => { out[batch[n]] = r.status === 'fulfilled' ? r.value : null; });
    if (i + QUOTE_BATCH_SIZE < symbols.length) await new Promise((r) => setTimeout(r, QUOTE_BATCH_GAP_MS));
  }
  return out;
}

// Each browser keeps the last snapshot so a reload within the hour costs no API calls.
const MARKET_CACHE_KEY = 'mlpd-market-snapshot';
let lastMarketSnapshot = null;

function readCachedMarket() {
  try {
    const raw = JSON.parse(localStorage.getItem(MARKET_CACHE_KEY));
    if (raw && raw.fetchedAt) return { ...raw, fetchedAt: new Date(raw.fetchedAt) };
  } catch { /* storage blocked or corrupt: just refetch */ }
  return null;
}

function writeCachedMarket(m) {
  try { localStorage.setItem(MARKET_CACHE_KEY, JSON.stringify({ ...m, fetchedAt: m.fetchedAt.getTime() })); } catch { /* ignore */ }
}

async function fetchRss({ source, url }) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${source} feed returned ${res.status}`);
  const xml = new DOMParser().parseFromString(await res.text(), 'text/xml');
  return [...xml.querySelectorAll('item')].map((item) => ({
    source,
    headline: item.querySelector('title')?.textContent?.trim() || '',
    url: item.querySelector('link')?.textContent?.trim() || '',
    time: Date.parse(item.querySelector('pubDate')?.textContent || '') || 0,
  }));
}

async function fetchMarketHeadlines() {
  const jobs = MARKET_FEEDS.map(fetchRss);
  jobs.push(finnhub('news?category=general').then((rows) => rows.map((n) => ({
    source: n.source || 'Finnhub',
    headline: n.headline,
    url: n.url,
    time: n.datetime * 1000,
  }))));
  const settled = await Promise.allSettled(jobs);
  const cutoff = Date.now() - HEADLINE_MAX_AGE_MS;
  const seen = new Set();
  return settled
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .filter((n) => n.headline && /^https?:\/\//.test(n.url) && n.time >= cutoff)
    .sort((a, b) => b.time - a.time)
    .filter((n) => {
      const key = n.headline.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
      return !seen.has(key) && seen.add(key);
    })
    .slice(0, 12);
}

// The shared snapshot is written hourly by the market-snapshot Edge Function
// (supabase/functions/market-snapshot). Past this age the page assumes the job
// has stopped and fetches the data itself.
const SHARED_SNAPSHOT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

async function readSharedSnapshot() {
  if (!SUPABASE_CONFIGURED) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/market_snapshots?id=eq.1&select=data,fetched_at`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) return null; // e.g. the table hasn't been created yet
  const row = (await res.json())[0];
  if (!row) return null;
  return { ...row.data, fetchedAt: new Date(row.fetched_at), shared: true };
}

// Prefers the shared hourly snapshot. Falls back to fetching in the browser
// (reusing this browser's copy if under an hour old, unless forced).
async function fetchMarketOverview({ force = false } = {}) {
  const shared = await readSharedSnapshot().catch(() => null);
  if (shared && Date.now() - shared.fetchedAt < SHARED_SNAPSHOT_MAX_AGE_MS) {
    lastMarketSnapshot = shared;
    return shared;
  }

  lastMarketSnapshot = lastMarketSnapshot || readCachedMarket();
  if (!force && lastMarketSnapshot && Date.now() - lastMarketSnapshot.fetchedAt < REFRESH_INTERVAL_MS) {
    return lastMarketSnapshot;
  }

  const allSymbols = [...MARKET_INDEXES, ...MARKET_SECTORS].map((x) => x.symbol).concat(MARKET_WATCHLIST);
  const [status, quotes, headlines] = await Promise.all([
    finnhub('stock/market-status?exchange=US').catch(() => null),
    fetchQuotes(allSymbols),
    fetchMarketHeadlines().catch(() => []),
  ]);

  // A symbol that failed this round (usually a rate limit) keeps its last good quote.
  const prev = {};
  if (lastMarketSnapshot) {
    [...lastMarketSnapshot.indexes, ...lastMarketSnapshot.sectors].forEach((x) => { prev[x.symbol] = x.quote; });
    lastMarketSnapshot.movers.forEach((q) => { prev[q.symbol] = q; });
  }
  const quoteFor = (sym) => quotes[sym] || prev[sym] || null;
  if (!allSymbols.some((sym) => quotes[sym])) throw new Error('Quote service unavailable right now');

  const m = {
    status: status || lastMarketSnapshot?.status || null,
    indexes: MARKET_INDEXES.map((i) => ({ ...i, quote: quoteFor(i.symbol) })).filter((i) => i.quote),
    sectors: MARKET_SECTORS.map((s) => ({ ...s, quote: quoteFor(s.symbol) })).filter((s) => s.quote)
      .sort((a, b) => b.quote.changePct - a.quote.changePct),
    movers: MARKET_WATCHLIST.map(quoteFor).filter(Boolean)
      .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)),
    headlines: headlines.length ? headlines : (lastMarketSnapshot?.headlines || []),
    fetchedAt: new Date(),
  };
  lastMarketSnapshot = m;
  writeCachedMarket(m);
  return m;
}

// ---------- rendering ----------

function signedPct(p) {
  if (p == null || isNaN(p)) return '—';
  return `${p >= 0 ? '+' : '−'}${Math.abs(p * 100).toFixed(2)}%`;
}

function changeClass(p) {
  return p >= 0 ? 'text-ok-600' : 'text-alert-600';
}

function marketStatusLabel(status) {
  if (!status) return { text: 'Market status unavailable', dot: 'bg-steel-300' };
  if (status.holiday) return { text: `Closed for ${status.holiday}`, dot: 'bg-steel-300' };
  if (status.isOpen) return { text: 'Market open', dot: 'bg-ok-600 pulse-dot' };
  if (status.session === 'pre-market') return { text: 'Pre-market', dot: 'bg-brand-500 pulse-dot' };
  if (status.session === 'post-market') return { text: 'After hours', dot: 'bg-brand-500 pulse-dot' };
  return { text: 'Market closed', dot: 'bg-steel-300' };
}

function relativeTime(ms) {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

function renderMarketOverview(container, m) {
  const st = marketStatusLabel(m.status);
  const next = new Date(m.fetchedAt.getTime() + REFRESH_INTERVAL_MS);
  const time = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const indexTiles = m.indexes.map((i) => `
    <button type="button" data-symbol="${i.symbol}" class="market-tile card-elevate text-left bg-white border border-steel-200 rounded-2xl shadow-elevated p-5">
      <p class="text-xs text-navy-600">${escapeHtml(i.label)} <span class="text-navy-600/60">· ${i.symbol}</span></p>
      <p class="mt-2 plate-font text-2xl font-semibold tracking-[-0.03em] text-navy-900 tabular-nums">${fmtUsd(i.quote.price)}</p>
      <p class="mt-1 text-sm font-semibold tabular-nums ${changeClass(i.quote.changePct)}">${i.quote.changePct >= 0 ? '▲' : '▼'} ${signedPct(i.quote.changePct)}</p>
    </button>`).join('');

  // Diverging bars from a shared zero line, scaled to the biggest move of the day.
  const maxAbs = Math.max(...m.sectors.map((s) => Math.abs(s.quote.changePct)), 0.001);
  const sectorRows = m.sectors.map((s) => {
    const p = s.quote.changePct;
    const w = (Math.abs(p) / maxAbs) * 50;
    const bar = p >= 0
      ? `<div class="absolute inset-y-0 left-1/2 rounded-r bg-ok-600" style="width:${w}%"></div>`
      : `<div class="absolute inset-y-0 right-1/2 rounded-l bg-alert-500" style="width:${w}%"></div>`;
    return `
      <button type="button" data-symbol="${s.symbol}" title="${escapeHtml(s.label)} (${s.symbol}): ${signedPct(p)}, ${fmtUsd(s.quote.price)}"
        class="market-row w-full grid grid-cols-[minmax(0,7.5rem)_1fr_4.5rem] items-center gap-3 rounded-lg px-2 py-1.5 text-sm">
        <span class="text-left text-navy-700 truncate">${escapeHtml(s.label)}</span>
        <span class="relative h-3">
          <span class="absolute inset-y-[-3px] left-1/2 w-px bg-steel-300"></span>
          ${bar}
        </span>
        <span class="text-right font-semibold tabular-nums text-navy-900">${signedPct(p)}</span>
      </button>`;
  }).join('');

  const moverRows = m.movers.slice(0, 6).map((q) => `
    <button type="button" data-symbol="${q.symbol}" class="market-row w-full flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm">
      <span class="plate-font font-semibold tracking-wide text-navy-900">${q.symbol}</span>
      <span class="tabular-nums text-navy-700">${fmtUsd(q.price)}</span>
      <span class="w-20 text-right font-semibold tabular-nums ${changeClass(q.changePct)}">${q.changePct >= 0 ? '▲' : '▼'} ${signedPct(q.changePct)}</span>
    </button>`).join('');

  const headlineRows = m.headlines.length ? m.headlines.map((n) => `
    <a href="${escapeHtml(n.url)}" target="_blank" rel="noopener" class="news-link block py-3 border-b border-steel-200/70 last:border-0">
      <p class="news-title font-medium text-navy-900 leading-snug">${escapeHtml(n.headline)}</p>
      <p class="mt-1 text-xs text-navy-600">${escapeHtml(n.source)} · ${relativeTime(n.time)}</p>
    </a>`).join('')
    : '<p class="mt-3 text-sm text-navy-600">No headlines from the past 48 hours could be loaded.</p>';

  container.innerHTML = `
    <div class="flex items-end justify-between flex-wrap gap-3">
      <div>
        <p class="text-brand-600 font-semibold text-sm tracking-wide uppercase">Market today</p>
        <h2 class="plate-font text-3xl font-semibold tracking-[-0.03em] text-navy-900 mt-1">How the market is moving</h2>
      </div>
      <div class="flex items-center gap-3 flex-wrap text-xs text-navy-600">
        <span class="inline-flex items-center gap-1.5 rounded-full bg-white border border-steel-200 px-3 py-1.5 font-semibold text-navy-900">
          <span class="h-1.5 w-1.5 rounded-full ${st.dot}"></span>${st.text}
        </span>
        <span>Updated ${time(m.fetchedAt)} · next update ${time(next)}</span>
      </div>
    </div>

    <div class="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4">${indexTiles}</div>

    <div class="mt-6 grid lg:grid-cols-3 gap-6">
      <div class="bg-white border border-steel-200 rounded-2xl shadow-elevated p-6">
        <div class="flex items-baseline justify-between">
          <h3 class="font-semibold text-navy-900">Sectors today</h3>
          <p class="text-xs text-navy-600">vs. yesterday's close</p>
        </div>
        <div class="mt-4 space-y-0.5">${sectorRows}</div>
      </div>
      <div class="bg-white border border-steel-200 rounded-2xl shadow-elevated p-6">
        <div class="flex items-baseline justify-between">
          <h3 class="font-semibold text-navy-900">Big movers</h3>
          <p class="text-xs text-navy-600">Largest US companies</p>
        </div>
        <div class="mt-4 divide-y divide-steel-200/70">${moverRows}</div>
        <p class="mt-3 text-xs text-navy-600 leading-[1.6]">Click any row, sector or index to run a full checkup on it.</p>
      </div>
      <div class="bg-white border border-steel-200 rounded-2xl shadow-elevated p-6">
        <h3 class="font-semibold text-navy-900">Market headlines</h3>
        <div class="mt-1 max-h-[26rem] overflow-y-auto pr-1">${headlineRows}</div>
      </div>
    </div>`;
}
