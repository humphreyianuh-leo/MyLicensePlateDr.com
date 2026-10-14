// Supabase Edge Function: builds the "Market today" snapshot once an hour and
// stores it in public.market_snapshots, so every visitor reads one shared copy
// instead of each browser spending the shared Finnhub quota.
//
// Called hourly by pg_cron (see supabase/market-snapshot.sql). It is safe to call
// publicly: if the stored snapshot is under 50 minutes old it returns without
// fetching anything. Pass ?force=1 to skip that check.
//
// The snapshot shape matches what market.js renders: { status, indexes, sectors, movers, headlines }.

const FINNHUB_API_KEY = Deno.env.get('FINNHUB_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const MIN_AGE_MS = 50 * 60 * 1000;
const HEADLINE_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const QUOTE_BATCH_SIZE = 4;
const QUOTE_BATCH_GAP_MS = 300;

// Keep these lists in sync with market.js (its browser fallback uses the same ones).
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
const MARKET_WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'JPM', 'LLY'];
const MARKET_FEEDS = [
  { source: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_bulletins' },
  { source: 'CNBC', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20409666' },
  { source: 'CNBC', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664' },
];

type Quote = { symbol: string; price: number; change: number; changePct: number; prevClose: number };
type Headline = { source: string; headline: string; url: string; time: number };
type Snapshot = {
  status: unknown;
  indexes: { symbol: string; label: string; quote: Quote }[];
  sectors: { symbol: string; label: string; quote: Quote }[];
  movers: Quote[];
  headlines: Headline[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function finnhub(path: string) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`https://finnhub.io/api/v1/${path}${sep}token=${FINNHUB_API_KEY}`);
  if (!res.ok) throw new Error(`Finnhub ${path.split('?')[0]} returned ${res.status}`);
  return res.json();
}

async function fetchQuote(symbol: string): Promise<Quote | null> {
  const q = await finnhub(`quote?symbol=${encodeURIComponent(symbol)}`);
  if (!q || !q.c) return null; // Finnhub returns zeros for unknown symbols
  return { symbol, price: q.c, change: q.d, changePct: q.dp / 100, prevClose: q.pc };
}

async function fetchQuotes(symbols: string[]) {
  const out: Record<string, Quote | null> = {};
  for (let i = 0; i < symbols.length; i += QUOTE_BATCH_SIZE) {
    const batch = symbols.slice(i, i + QUOTE_BATCH_SIZE);
    const settled = await Promise.allSettled(batch.map(fetchQuote));
    settled.forEach((r, n) => { out[batch[n]] = r.status === 'fulfilled' ? r.value : null; });
    if (i + QUOTE_BATCH_SIZE < symbols.length) await sleep(QUOTE_BATCH_GAP_MS);
  }
  return out;
}

function decodeEntities(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

// Deno has no DOMParser; RSS is regular enough to read with patterns.
async function fetchRss({ source, url }: { source: string; url: string }): Promise<Headline[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${source} feed returned ${res.status}`);
  const xml = await res.text();
  const tag = (block: string, name: string) => block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? '';
  return xml.split(/<item[\s>]/).slice(1).map((block) => ({
    source,
    headline: decodeEntities(tag(block, 'title')),
    url: decodeEntities(tag(block, 'link')),
    time: Date.parse(tag(block, 'pubDate')) || 0,
  }));
}

async function fetchHeadlines(): Promise<Headline[]> {
  const jobs: Promise<Headline[]>[] = MARKET_FEEDS.map(fetchRss);
  jobs.push(finnhub('news?category=general').then((rows: any[]) => rows.map((n) => ({
    source: n.source || 'Finnhub', headline: n.headline, url: n.url, time: n.datetime * 1000,
  }))));
  const settled = await Promise.allSettled(jobs);
  const cutoff = Date.now() - HEADLINE_MAX_AGE_MS;
  const seen = new Set<string>();
  return settled
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .filter((n) => n.headline && /^https?:\/\//.test(n.url) && n.time >= cutoff)
    .sort((a, b) => b.time - a.time)
    .filter((n) => {
      const key = n.headline.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

// ---------- storage (PostgREST with the service role, which bypasses RLS) ----------

const dbHeaders = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

async function readStored(): Promise<{ data: Snapshot; fetched_at: string } | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/market_snapshots?id=eq.1&select=data,fetched_at`, { headers: dbHeaders });
  if (!res.ok) throw new Error(`Reading market_snapshots failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return rows[0] ?? null;
}

async function writeStored(data: Snapshot, fetchedAt: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/market_snapshots`, {
    method: 'POST',
    headers: { ...dbHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: 1, data, fetched_at: fetchedAt }),
  });
  if (!res.ok) throw new Error(`Saving market_snapshots failed: ${res.status} ${await res.text()}`);
}

// ---------- build ----------

async function buildSnapshot(prev: Snapshot | null): Promise<Snapshot> {
  const allSymbols = [...MARKET_INDEXES, ...MARKET_SECTORS].map((x) => x.symbol).concat(MARKET_WATCHLIST);
  const [status, quotes, headlines] = await Promise.all([
    finnhub('stock/market-status?exchange=US').catch(() => null),
    fetchQuotes(allSymbols),
    fetchHeadlines().catch(() => []),
  ]);
  if (!allSymbols.some((s) => quotes[s])) throw new Error('No quotes returned; keeping the previous snapshot');

  // A symbol that failed this round keeps its last good quote.
  const prevQuotes: Record<string, Quote> = {};
  if (prev) {
    [...prev.indexes, ...prev.sectors].forEach((x) => { prevQuotes[x.symbol] = x.quote; });
    prev.movers.forEach((q) => { prevQuotes[q.symbol] = q; });
  }
  const quoteFor = (s: string) => quotes[s] || prevQuotes[s] || null;

  return {
    status: status ?? prev?.status ?? null,
    indexes: MARKET_INDEXES.map((i) => ({ ...i, quote: quoteFor(i.symbol)! })).filter((i) => i.quote),
    sectors: MARKET_SECTORS.map((s) => ({ ...s, quote: quoteFor(s.symbol)! })).filter((s) => s.quote)
      .sort((a, b) => b.quote.changePct - a.quote.changePct),
    movers: MARKET_WATCHLIST.map(quoteFor).filter((q): q is Quote => !!q)
      .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)),
    headlines: headlines.length ? headlines : (prev?.headlines ?? []),
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  try {
    if (!FINNHUB_API_KEY) return json({ error: 'FINNHUB_API_KEY secret is not set' }, 500);
    const force = new URL(req.url).searchParams.get('force') === '1';
    const stored = await readStored();
    const age = stored ? Date.now() - Date.parse(stored.fetched_at) : Infinity;
    if (!force && age < MIN_AGE_MS) {
      return json({ skipped: true, reason: 'snapshot is fresh', fetched_at: stored!.fetched_at });
    }
    const snapshot = await buildSnapshot(stored?.data ?? null);
    const fetchedAt = new Date().toISOString();
    await writeStored(snapshot, fetchedAt);
    return json({
      ok: true,
      fetched_at: fetchedAt,
      counts: { indexes: snapshot.indexes.length, sectors: snapshot.sectors.length, movers: snapshot.movers.length, headlines: snapshot.headlines.length },
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
