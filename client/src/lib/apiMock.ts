// Intercepts /api/trpc/* fetch calls and serves them from static JSON files
// generated daily by a GitHub Action. Replaces the Express/tRPC backend so the
// site can run as a static deploy on GitHub Pages.
//
// Falls back to a Cloudflare Worker proxy for custom tickers not found
// in the static prices.json.

type PricesFile = {
  prices: Record<string, number[]>;
  fetchedAt: string;
};

type VixFile = {
  value: number | null;
  change: number | null;
  changePercent: number | null;
  fetchedAt: string | null;
  error: string | null;
};

const YAHOO_PROXY_URL = "https://yahoo-finance-proxy.tblees.workers.dev";

let pricesPromise: Promise<PricesFile> | null = null;
let vixPromise: Promise<VixFile> | null = null;
let pricesLoadedAt = 0;
let vixLoadedAt = 0;
const CACHE_TTL_MS = 15 * 60 * 1000;

const liveTickerCache: Record<string, { closes: number[]; fetchedAt: string }> = {};

function dataUrl(name: string): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base}${base.endsWith("/") ? "" : "/"}data/${name}`;
}

function loadPrices(origFetch: typeof fetch, bypassCache = false): Promise<PricesFile> {
  if (bypassCache || (pricesPromise && Date.now() - pricesLoadedAt > CACHE_TTL_MS)) {
    pricesPromise = null;
  }
  if (!pricesPromise) {
    const url = `${dataUrl("prices.json")}?_=${Date.now()}`;
    pricesLoadedAt = Date.now();
    pricesPromise = origFetch(url)
      .then((r) => {
        if (!r.ok) throw new Error("prices.json HTTP " + r.status);
        return r.json() as Promise<PricesFile>;
      })
      .catch((err) => {
        pricesPromise = null;
        throw err;
      });
  }
  return pricesPromise;
}

function loadVix(origFetch: typeof fetch, bypassCache = false): Promise<VixFile> {
  if (bypassCache || (vixPromise && Date.now() - vixLoadedAt > CACHE_TTL_MS)) {
    vixPromise = null;
  }
  if (!vixPromise) {
    const url = `${dataUrl("vix.json")}?_=${Date.now()}`;
    vixLoadedAt = Date.now();
    vixPromise = origFetch(url)
      .then((r) => {
        if (!r.ok) throw new Error("vix.json HTTP " + r.status);
        return r.json() as Promise<VixFile>;
      })
      .catch((err) => {
        vixPromise = null;
        throw err;
      });
  }
  return vixPromise;
}

async function fetchTickerLive(
  ticker: string,
  origFetch: typeof fetch
): Promise<number[]> {
  const cached = liveTickerCache[ticker];
  if (cached) {
    const age = Date.now() - new Date(cached.fetchedAt).getTime();
    if (age < 5 * 60 * 1000) return cached.closes;
  }
  try {
    const url = YAHOO_PROXY_URL + "?ticker=" + encodeURIComponent(ticker) + "&range=2y";
    const res = await origFetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.error || !Array.isArray(data.closes)) return [];
    liveTickerCache[ticker] = {
      closes: data.closes,
      fetchedAt: data.fetchedAt || new Date().toISOString(),
    };
    return data.closes;
  } catch {
    return [];
  }
}

function jsonResponse(data: unknown): Response {
  const body = JSON.stringify({ result: { data: { json: data } } });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function handle(
  url: URL,
  init: RequestInit | undefined,
  origFetch: typeof fetch
): Promise<Response> {
  const path = url.pathname.replace(/^.*\/api\/trpc\//, "");
  const procedure = path.split(",")[0];

  let input: any = null;
  const rawInput = url.searchParams.get("input");
  if (rawInput) {
    try {
      const parsed = JSON.parse(rawInput);
      input = parsed?.json ?? parsed;
    } catch { /* ignore */ }
  } else if (init?.body && typeof init.body === "string") {
    try {
      const parsed = JSON.parse(init.body);
      input = parsed?.json ?? parsed;
    } catch { /* ignore */ }
  }

  if (procedure === "market.getPrices" || procedure === "market.forceRefresh") {
    const isForce = procedure === "market.forceRefresh";
    const tickers: string[] = Array.isArray(input?.tickers) ? input.tickers : [];
    const file = await loadPrices(origFetch, isForce);
    if (isForce) await loadVix(origFetch, true);
    const out: Record<string, number[]> = {};

    const livePromises: Promise<void>[] = [];
    for (const t of tickers) {
      if (file.prices[t] && file.prices[t].length > 0) {
        out[t] = file.prices[t];
      } else {
        livePromises.push(
          fetchTickerLive(t, origFetch).then((closes) => { out[t] = closes; })
        );
      }
    }

    if (livePromises.length > 0) {
      await Promise.all(livePromises);
    }

    const now = Date.now();
    return jsonResponse({
      prices: out,
      fromCache: !isForce,
      fetchedAt: file.fetchedAt,
      expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  if (procedure === "market.getCacheStatus") {
    const file = await loadPrices(origFetch);
    const ageMinutes = Math.max(
      0,
      Math.floor((Date.now() - new Date(file.fetchedAt).getTime()) / 60000)
    );
    return jsonResponse({
      cached: true,
      fetchedAt: file.fetchedAt,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      ageMinutes,
    });
  }

  if (procedure === "market.getVix") {
    const file = await loadVix(origFetch);
    return jsonResponse(file);
  }

  return new Response(
    JSON.stringify({ error: { message: "Unknown procedure: " + procedure } }),
    { status: 404, headers: { "Content-Type": "application/json" } }
  );
}

export function installApiMock(): void {
  const origFetch = window.fetch.bind(window);
  window.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const urlStr =
      input instanceof Request
        ? input.url
        : typeof input === "string"
          ? input
          : input.toString();
    if (urlStr.includes("/api/trpc/")) {
      try {
        const url = new URL(urlStr, window.location.origin);
        return await handle(url, init, origFetch);
      } catch (err: any) {
        return new Response(
          JSON.stringify({ error: { message: err?.message ?? "mock failed" } }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }
    return origFetch(input as any, init);
  };
}
