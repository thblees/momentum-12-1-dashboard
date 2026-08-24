import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";

// ─── Cache ────────────────────────────────────────────────────────────────────
// All Yahoo Finance data is cached server-side for 15 minutes.
// This means no matter how many users open the dashboard simultaneously,
// Yahoo Finance is only called ONCE every 15 minutes per ticker group.

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface CacheEntry {
  data: Record<string, number[]>;
  fetchedAt: Date;
  expiresAt: Date;
}

const priceCache = new Map<string, CacheEntry>();

function getCacheKey(tickers: string[]): string {
  return [...tickers].sort().join(",");
}

function getCachedEntry(key: string): CacheEntry | null {
  const entry = priceCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt.getTime()) {
    priceCache.delete(key);
    return null;
  }
  return entry;
}

function setCacheEntry(
  key: string,
  data: Record<string, number[]>
): CacheEntry {
  const now = new Date();
  const entry: CacheEntry = {
    data,
    fetchedAt: now,
    expiresAt: new Date(now.getTime() + CACHE_TTL_MS),
  };
  priceCache.set(key, entry);
  return entry;
}

// ─── Yahoo Finance Fetch ──────────────────────────────────────────────────────

async function fetchYahooChart(ticker: string): Promise<number[]> {
  const encoded = encodeURIComponent(ticker);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1d&range=2y&includePrePost=false`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/json",
    },
  });
  if (!res.ok)
    throw new Error(`Yahoo Finance returned ${res.status} for ${ticker}`);
  const json = (await res.json()) as any;
  const closes =
    json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
  if (!closes || closes.length === 0) return [];
  return closes.filter(
    (v: number | null) => v !== null && v !== undefined
  ) as number[];
}

async function fetchAllTickers(
  tickers: string[]
): Promise<Record<string, number[]>> {
  const results: Record<string, number[]> = {};
  await Promise.all(
    tickers.map(async (ticker) => {
      try {
        results[ticker] = await fetchYahooChart(ticker);
      } catch {
        results[ticker] = [];
      }
    })
  );
  return results;
}

// ─── VIX Cache ───────────────────────────────────────────────────────────────

interface VixCacheEntry {
  value: number;
  change: number;
  changePercent: number;
  fetchedAt: Date;
  expiresAt: Date;
}

let vixCache: VixCacheEntry | null = null;

async function fetchVix(): Promise<{
  value: number;
  change: number;
  changePercent: number;
}> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=5d&includePrePost=false`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Yahoo Finance VIX returned ${res.status}`);
  const json = (await res.json()) as any;
  const closes: number[] =
    json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  const filtered = closes.filter(
    (v: number | null) => v !== null && v !== undefined
  ) as number[];
  if (filtered.length < 2) throw new Error("Not enough VIX data");
  const current = filtered[filtered.length - 1];
  const prev = filtered[filtered.length - 2];
  const change = current - prev;
  const changePercent = (change / prev) * 100;
  return { value: current, change, changePercent };
}

async function getVixCached(): Promise<VixCacheEntry> {
  if (vixCache && Date.now() < vixCache.expiresAt.getTime()) {
    return vixCache;
  }
  const data = await fetchVix();
  const now = new Date();
  vixCache = {
    ...data,
    fetchedAt: now,
    expiresAt: new Date(now.getTime() + CACHE_TTL_MS),
  };
  return vixCache;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const appRouter = router({
  market: router({
    getPrices: publicProcedure
      .input(z.object({ tickers: z.array(z.string()).max(50) }))
      .query(async ({ input }) => {
        const key = getCacheKey(input.tickers);
        const cached = getCachedEntry(key);

        if (cached) {
          console.log(
            `[Cache HIT] ${input.tickers.length} tickers, expires at ${cached.expiresAt.toLocaleTimeString("de-DE")}`
          );
          return {
            prices: cached.data,
            fromCache: true,
            fetchedAt: cached.fetchedAt,
            expiresAt: cached.expiresAt,
          };
        }

        console.log(
          `[Cache MISS] Fetching ${input.tickers.length} tickers from Yahoo Finance...`
        );
        const data = await fetchAllTickers(input.tickers);
        const entry = setCacheEntry(key, data);
        console.log(
          `[Cache SET] ${input.tickers.length} tickers cached until ${entry.expiresAt.toLocaleTimeString("de-DE")}`
        );

        return {
          prices: data,
          fromCache: false,
          fetchedAt: entry.fetchedAt,
          expiresAt: entry.expiresAt,
        };
      }),

    getCacheStatus: publicProcedure
      .input(z.object({ tickers: z.array(z.string()).max(50) }))
      .query(({ input }) => {
        const key = getCacheKey(input.tickers);
        const cached = getCachedEntry(key);
        if (!cached) {
          return {
            cached: false,
            fetchedAt: null,
            expiresAt: null,
            ageMinutes: null,
          };
        }
        const ageMs = Date.now() - cached.fetchedAt.getTime();
        return {
          cached: true,
          fetchedAt: cached.fetchedAt,
          expiresAt: cached.expiresAt,
          ageMinutes: Math.floor(ageMs / 60000),
        };
      }),

    forceRefresh: publicProcedure
      .input(z.object({ tickers: z.array(z.string()).max(50) }))
      .mutation(async ({ input }) => {
        const key = getCacheKey(input.tickers);
        priceCache.delete(key);
        console.log(
          `[Cache CLEAR] Manual refresh for ${input.tickers.length} tickers`
        );
        const data = await fetchAllTickers(input.tickers);
        const entry = setCacheEntry(key, data);
        return {
          prices: data,
          fetchedAt: entry.fetchedAt,
          expiresAt: entry.expiresAt,
        };
      }),

    getVix: publicProcedure.query(async () => {
      try {
        const entry = await getVixCached();
        return {
          value: entry.value,
          change: entry.change,
          changePercent: entry.changePercent,
          fetchedAt: entry.fetchedAt,
          error: null,
        };
      } catch (err: any) {
        return {
          value: null,
          change: null,
          changePercent: null,
          fetchedAt: null,
          error: err?.message ?? "VIX nicht verfügbar",
        };
      }
    }),
  }),
});

export type AppRouter = typeof appRouter;
