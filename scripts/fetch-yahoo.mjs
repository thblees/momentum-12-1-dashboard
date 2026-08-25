// Fetches daily price data from Yahoo Finance for every ticker the dashboard
// displays and writes two static JSON files the client consumes via apiMock.ts.
// Runs in GitHub Actions once per day.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const INDICES = [
  "^NYA", "^IXIC", "^NDX", "^OEX", "^GSPC", "^MID", "IWC", "^DJI",
  "^DJT", "^DJU", "IWB", "IWM", "IWV", "^W5000", "^GDAXI", "^STOXX50E",
];
const GLOBAL_MARKETS = [
  "VEA", "AAXJ", "VXUS", "EFA", "VWO", "ILF", "IEV", "EZU", "VT", "VTI", "IOO",
];
const SECTORS = [
  "XLK", "XLV", "XLF", "XLY", "XLC", "XLI", "XLP", "XLE", "XLU", "XLB", "XLRE",
];
const ALL = Array.from(new Set([...INDICES, ...GLOBAL_MARKETS, ...SECTORS]));

// Strategie-Universum (12-1 Top-3): nur handelbare ETFs + SPY als Benchmark.
// SPY ist zugleich Benchmark und Kandidat (haelt in Megacap-Phasen den Index).
// Fuer den Backtest werden 10 Jahre Historie MIT Datum geladen.
const STRATEGY_UNIVERSE = ["SPY", ...GLOBAL_MARKETS, ...SECTORS];
const STRATEGY_BENCHMARK = "SPY";

const OUT_DIR = path.resolve("client/public/data");
mkdirSync(OUT_DIR, { recursive: true });

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

async function fetchChart(ticker, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${range}&includePrePost=false`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(closes)) throw new Error("no close array");
  return closes.filter((v) => v !== null && v !== undefined);
}

async function fetchChartDated(ticker, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${range}&includePrePost=false`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  const ts = r?.timestamp;
  const closes = r?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(ts) || !Array.isArray(closes)) throw new Error("no timestamp/close array");
  const out = new Map();
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c === null || c === undefined) continue;
    // Handelstag als YYYY-MM-DD (New Yorker Boerse; UTC-Datum reicht fuer Tagesdaten)
    const d = new Date(ts[i] * 1000).toISOString().slice(0, 10);
    out.set(d, c);
  }
  return out;
}

async function withRetry(fn, retries = 3, delayMs = 800) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < retries) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastErr;
}

async function main() {
  const now = new Date().toISOString();

  // Prices
  const prices = {};
  const failures = [];
  for (const ticker of ALL) {
    try {
      prices[ticker] = await withRetry(() => fetchChart(ticker, "2y"));
      process.stdout.write(`.`);
    } catch (err) {
      prices[ticker] = [];
      failures.push(`${ticker}: ${err.message}`);
      process.stdout.write(`!`);
    }
  }
  process.stdout.write(`\n`);

  writeFileSync(
    path.join(OUT_DIR, "prices.json"),
    JSON.stringify({ prices, fetchedAt: now })
  );

  // Strategie-Daten (5y, mit Datum, auf die Handelstage von SPY ausgerichtet)
  try {
    const tickers = Array.from(new Set([STRATEGY_BENCHMARK, ...STRATEGY_UNIVERSE]));
    const series = {};
    for (const t of tickers) {
      series[t] = await withRetry(() => fetchChartDated(t, "10y"));
      process.stdout.write(`+`);
    }
    process.stdout.write(`\n`);
    const dates = Array.from(series[STRATEGY_BENCHMARK].keys()).sort();
    const closes = {};
    for (const t of tickers) {
      const arr = [];
      let last = null;
      for (const d of dates) {
        const v = series[t].get(d);
        if (v !== undefined) last = v;
        arr.push(last);
      }
      closes[t] = arr;
    }
    writeFileSync(
      path.join(OUT_DIR, "strategy.json"),
      JSON.stringify({ dates, closes, benchmark: STRATEGY_BENCHMARK, universe: STRATEGY_UNIVERSE, fetchedAt: now })
    );
  } catch (err) {
    console.error(`strategy.json failed: ${err.message}`);
  }

  // VIX
  let vixOut;
  try {
    const closes = await withRetry(() => fetchChart("^VIX", "5d"));
    if (closes.length < 2) throw new Error("insufficient VIX data");
    const current = closes[closes.length - 1];
    const prev = closes[closes.length - 2];
    vixOut = {
      value: current,
      change: current - prev,
      changePercent: ((current - prev) / prev) * 100,
      fetchedAt: now,
      error: null,
    };
  } catch (err) {
    vixOut = {
      value: null,
      change: null,
      changePercent: null,
      fetchedAt: null,
      error: err.message ?? "VIX fetch failed",
    };
  }
  writeFileSync(path.join(OUT_DIR, "vix.json"), JSON.stringify(vixOut));

  console.log(
    `OK. ${ALL.length} tickers fetched, ${failures.length} failures.` +
      (failures.length ? `\n  ${failures.join("\n  ")}` : "")
  );
  if (failures.length === ALL.length) {
    throw new Error("All ticker fetches failed — aborting.");
  }
}

main().catch((err) => {
  console.error(`\nfetch-yahoo.mjs failed: ${err.message}`);
  process.exit(1);
});
