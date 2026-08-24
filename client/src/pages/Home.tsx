/**
 * ARCTIC DASHBOARD – 12-1 Momentum Dashboard
 * Design: Nordic Minimal Data Design
 * Sections: 1) Index Momentum, 2) Global Markets, 3) Sektor ETFs
 * Methodik: Klassisches "12-1"-Momentum – Performance über 3/6/12 Monate,
 * jeweils OHNE die letzten 4 Wochen (kurzfristige Mean-Reversion wird ausgeblendet).
 * Die letzten 4 Wochen werden nur als Info-Spalte angezeigt.
 * Colors: warm off-white bg, white cards, blue-600 accents, slate for secondary text
 * Typography: DM Sans (headlines) + Source Sans 3 (data)
 * Data: Fetched via tRPC server-side proxy (avoids CORS)
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  TrendingUp, TrendingDown, Minus, RefreshCw, BarChart2,
  Globe, PieChart, ChevronUp, ChevronDown, ChevronsUpDown,
  Clock, Info, AlertCircle, Sun, Moon, Search, X, Plus
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useTheme } from "@/contexts/ThemeContext";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MomentumEntry {
  rank: number;
  ticker: string;
  name: string;
  category: string;
  perf3m1: number;
  perf6m1: number;
  perf12m1: number;
  recent4w: number;
  points: number;
  maxPoints: number;
}

interface EtfEntry {
  rank: number;
  ticker: string;
  sector: string;
  perf3m1: number;
  perf6m1: number;
  perf12m1: number;
  recent4w: number;
  points: number;
  maxPoints: number;
}

type SortKey = "rank" | "perf3m1" | "perf6m1" | "perf12m1" | "recent4w" | "points";
type SortDir = "asc" | "desc";

// ─── Data Definitions ─────────────────────────────────────────────────────────

const INDEX_TICKERS = [
  { ticker: "^NYA", name: "NYSE Composite Index", category: "US Broad Market" },
  { ticker: "^IXIC", name: "NASDAQ Composite", category: "US Technology" },
  { ticker: "^NDX", name: "NASDAQ 100", category: "US Technology" },
  { ticker: "^OEX", name: "S&P 100", category: "US Large Cap" },
  { ticker: "^GSPC", name: "S&P 500", category: "US Large Cap" },
  { ticker: "^MID", name: "S&P 400 Mid Cap", category: "US Mid Cap" },
  { ticker: "IWC", name: "iShares Microcap ETF", category: "US Micro Cap" },
  { ticker: "^DJI", name: "Dow Jones Industrial Average", category: "US Large Cap" },
  { ticker: "^DJT", name: "Dow Jones Transportation Average", category: "US Transportation" },
  { ticker: "^DJU", name: "Dow Jones Utility Average", category: "US Utilities" },
  { ticker: "IWB", name: "iShares Russell 1000 ETF", category: "US Large Cap" },
  { ticker: "IWM", name: "iShares Russell 2000 ETF", category: "US Small Cap" },
  { ticker: "IWV", name: "iShares Russell 3000 ETF", category: "US Broad Market" },
  { ticker: "^W5000", name: "Wilshire 5000 Total Market Index", category: "US Broad Market" },
  { ticker: "^GDAXI", name: "DAX", category: "European Large Cap" },
  { ticker: "^STOXX50E", name: "Euro Stoxx 50", category: "European Large Cap" },
];

const GLOBAL_TICKERS = [
  { ticker: "VEA", name: "Vanguard FTSE Developed Markets ETF", category: "Developed Markets" },
  { ticker: "AAXJ", name: "iShares MSCI All Country Asia ex Japan ETF", category: "Asia (ex Japan)" },
  { ticker: "VXUS", name: "Vanguard Total International Stock ETF", category: "International (ex US)" },
  { ticker: "EFA", name: "iShares MSCI EAFE ETF", category: "EAFE" },
  { ticker: "VWO", name: "Vanguard FTSE Emerging Markets ETF", category: "Emerging Markets" },
  { ticker: "ILF", name: "iShares Latin America 40 ETF", category: "Latin America" },
  { ticker: "IEV", name: "iShares Europe ETF", category: "Europe" },
  { ticker: "EZU", name: "iShares MSCI Eurozone ETF", category: "Eurozone" },
  { ticker: "VT", name: "Vanguard Total World Stock ETF", category: "Total World" },
  { ticker: "VTI", name: "Vanguard Total Stock Market ETF", category: "Total US" },
  { ticker: "IOO", name: "iShares Global 100 ETF", category: "Global 100" },
];

const ETF_TICKERS = [
  { ticker: "XLK", sector: "Technology" },
  { ticker: "XLV", sector: "Health Care" },
  { ticker: "XLF", sector: "Financials" },
  { ticker: "XLY", sector: "Consumer Discretionary" },
  { ticker: "XLC", sector: "Communication Services" },
  { ticker: "XLI", sector: "Industrials" },
  { ticker: "XLP", sector: "Consumer Staples" },
  { ticker: "XLE", sector: "Energy" },
  { ticker: "XLU", sector: "Utilities" },
  { ticker: "XLB", sector: "Materials" },
  { ticker: "XLRE", sector: "Real Estate" },
];

const INDEX_TICKER_LIST = INDEX_TICKERS.map(t => t.ticker);
const GLOBAL_TICKER_LIST = GLOBAL_TICKERS.map(t => t.ticker);
const ETF_TICKER_LIST = ETF_TICKERS.map(t => t.ticker);

// ─── Utility Functions ────────────────────────────────────────────────────────

// Handelstage: 4 Wochen ≈ 20, 3 Monate ≈ 63, 6 Monate ≈ 126, 12 Monate ≈ 252
const SKIP_DAYS = 20;
const WINDOWS = { m3: 63, m6: 126, m12: 252 } as const;

/**
 * Performance vom Handelstag (heute - lookback) bis zum Handelstag (heute - skip).
 * Mit skip = 20 werden die letzten 4 Wochen ausgeklammert ("12-1"-Logik).
 */
function calcPerfSkip(prices: number[], lookback: number, skip: number): number {
  const n = prices.length;
  if (n < lookback + 1) return 0;
  const end = prices[n - 1 - skip];
  const start = prices[n - 1 - lookback];
  if (!start || start === 0 || !end) return 0;
  return ((end - start) / start) * 100;
}

/** Performance der letzten `days` Handelstage bis heute (reine Info-Spalte). */
function calcPerfRecent(prices: number[], days: number): number {
  const n = prices.length;
  if (n < days + 1) return 0;
  const recent = prices[n - 1];
  const old = prices[n - 1 - days];
  if (!old || old === 0) return 0;
  return ((recent - old) / old) * 100;
}

type PerfSet = { ticker: string; p3: number; p6: number; p12: number; r4: number };

function computePerfs(ticker: string, prices: number[]): PerfSet {
  return {
    ticker,
    p3: calcPerfSkip(prices, WINDOWS.m3, SKIP_DAYS),
    p6: calcPerfSkip(prices, WINDOWS.m6, SKIP_DAYS),
    p12: calcPerfSkip(prices, WINDOWS.m12, SKIP_DAYS),
    r4: calcPerfRecent(prices, SKIP_DAYS),
  };
}

function pairwisePoints(perfs: PerfSet[]): Record<string, number> {
  const pts: Record<string, number> = {};
  perfs.forEach(p => { pts[p.ticker] = 0; });
  // Nur die drei "-1"-Fenster fließen ins Ranking ein – die letzten 4 Wochen NICHT.
  const periods = ["p3", "p6", "p12"] as const;
  for (let i = 0; i < perfs.length; i++) {
    for (let j = i + 1; j < perfs.length; j++) {
      for (const period of periods) {
        const a = perfs[i][period];
        const b = perfs[j][period];
        if (a > b) pts[perfs[i].ticker]++;
        else if (b > a) pts[perfs[j].ticker]++;
      }
    }
  }
  return pts;
}

function buildMomentumEntries(
  tickerDefs: { ticker: string; name: string; category: string }[],
  priceData: Record<string, number[]>
): MomentumEntry[] {
  const perfs = tickerDefs.map(t => computePerfs(t.ticker, priceData[t.ticker] || []));
  const pts = pairwisePoints(perfs);
  const maxPts = (tickerDefs.length - 1) * 3;
  return tickerDefs
    .map(t => {
      const p = perfs.find(x => x.ticker === t.ticker)!;
      return {
        rank: 0,
        ticker: t.ticker,
        name: t.name,
        category: t.category,
        perf3m1: p.p3,
        perf6m1: p.p6,
        perf12m1: p.p12,
        recent4w: p.r4,
        points: pts[t.ticker] || 0,
        maxPoints: maxPts,
      };
    })
    .sort((a, b) => b.points - a.points || b.perf12m1 - a.perf12m1)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

function buildEtfEntries(
  tickerDefs: { ticker: string; sector: string }[],
  priceData: Record<string, number[]>
): EtfEntry[] {
  const perfs = tickerDefs.map(t => computePerfs(t.ticker, priceData[t.ticker] || []));
  const pts = pairwisePoints(perfs);
  const maxPts = (tickerDefs.length - 1) * 3;
  return tickerDefs
    .map(t => {
      const p = perfs.find(x => x.ticker === t.ticker)!;
      return {
        rank: 0,
        ticker: t.ticker,
        sector: t.sector,
        perf3m1: p.p3,
        perf6m1: p.p6,
        perf12m1: p.p12,
        recent4w: p.r4,
        points: pts[t.ticker] || 0,
        maxPoints: maxPts,
      };
    })
    .sort((a, b) => b.points - a.points || b.perf12m1 - a.perf12m1)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

// ─── Custom Ticker Hook ─────────────────────────────────────────────────────

interface CustomTickerEntry {
  ticker: string;
  name: string;
  isCustom: true;
}

function useCustomTickers() {
  const [customTickers, setCustomTickers] = useState<CustomTickerEntry[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addTicker = useCallback(async (raw: string) => {
    const ticker = raw.trim().toUpperCase();
    if (!ticker) return;
    if (customTickers.some(t => t.ticker === ticker)) {
      setError(`"${ticker}" ist bereits in der Liste`);
      return;
    }
    setIsLoading(true);
    setError(null);
    // Validate via a quick fetch through the server proxy
    try {
      const res = await fetch(`/api/trpc/market.getPrices?input=${encodeURIComponent(JSON.stringify({ json: { tickers: [ticker] } }))}`);
      const json = await res.json();
      const prices = json?.result?.data?.json?.prices?.[ticker];
      if (!prices || prices.length === 0) {
        setError(`"${ticker}" nicht gefunden oder keine Daten verfügbar`);
      } else {
        setCustomTickers(prev => [...prev, { ticker, name: ticker, isCustom: true }]);
        setInputValue("");
      }
    } catch {
      setError("Verbindungsfehler – bitte erneut versuchen");
    } finally {
      setIsLoading(false);
    }
  }, [customTickers]);

  const removeTicker = useCallback((ticker: string) => {
    setCustomTickers(prev => prev.filter(t => t.ticker !== ticker));
  }, []);

  return { customTickers, inputValue, setInputValue, addTicker, removeTicker, isLoading, error, setError };
}

// ─── Custom Ticker Input Component ───────────────────────────────────────────

function CustomTickerInput({
  inputValue, setInputValue, addTicker, removeTicker, customTickers, isLoading, error, setError, accentColor
}: {
  inputValue: string;
  setInputValue: (v: string) => void;
  addTicker: (ticker: string) => void;
  removeTicker: (ticker: string) => void;
  customTickers: CustomTickerEntry[];
  isLoading: boolean;
  error: string | null;
  setError: (e: string | null) => void;
  accentColor: "blue" | "emerald" | "violet";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const colors = {
    blue: {
      border: "border-blue-300 dark:border-blue-700 focus:border-blue-500",
      btn: "bg-blue-600 hover:bg-blue-700 text-white",
      badge: "bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300",
      ring: "focus:ring-blue-200 dark:focus:ring-blue-900",
    },
    emerald: {
      border: "border-emerald-300 dark:border-emerald-700 focus:border-emerald-500",
      btn: "bg-emerald-600 hover:bg-emerald-700 text-white",
      badge: "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300",
      ring: "focus:ring-emerald-200 dark:focus:ring-emerald-900",
    },
    violet: {
      border: "border-violet-300 dark:border-violet-700 focus:border-violet-500",
      btn: "bg-violet-600 hover:bg-violet-700 text-white",
      badge: "bg-violet-50 dark:bg-violet-950/50 border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300",
      ring: "focus:ring-violet-200 dark:focus:ring-violet-900",
    },
  }[accentColor];

  return (
    <div className="px-6 py-4 border-t border-border bg-muted/20">
      <div className="flex items-center gap-2 mb-2">
        <Search size={13} className="text-slate-400" />
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          Eigener Vergleich
        </span>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          – beliebigen Ticker hinzufügen (z.B. AAPL, NVDA, BTC-USD)
        </span>
      </div>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={e => { setInputValue(e.target.value.toUpperCase()); setError(null); }}
          onKeyDown={e => { if (e.key === "Enter") addTicker(inputValue); }}
          placeholder="Ticker eingeben…"
          maxLength={20}
          className={`flex-1 max-w-[200px] px-3 py-1.5 text-sm font-mono rounded-lg border bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 outline-none ring-2 ring-transparent transition-all ${colors.border} ${colors.ring}`}
        />
        <button
          onClick={() => addTicker(inputValue)}
          disabled={isLoading || !inputValue.trim()}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 ${colors.btn}`}
        >
          {isLoading ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
          Hinzufügen
        </button>
      </div>
      {error && (
        <p className="mt-1.5 text-xs text-red-500 dark:text-red-400 flex items-center gap-1">
          <AlertCircle size={11} /> {error}
        </p>
      )}
      {customTickers.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {customTickers.map(t => (
            <span
              key={t.ticker}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${colors.badge}`}
            >
              <span className="font-mono">{t.ticker}</span>
              <span className="text-slate-400 dark:text-slate-500 font-normal">Eigener Vergleich</span>
              <button
                onClick={() => removeTicker(t.ticker)}
                className="ml-0.5 hover:text-red-500 transition-colors"
                aria-label={`${t.ticker} entfernen`}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sub-Components ───────────────────────────────────────────────────────────

function PerfCell({ value, muted = false }: { value: number; muted?: boolean }) {
  const cls = value > 0.05 ? "perf-positive" : value < -0.05 ? "perf-negative" : "perf-neutral";
  const icon = value > 0.05 ? <TrendingUp size={12} /> : value < -0.05 ? <TrendingDown size={12} /> : <Minus size={12} />;
  return (
    <span
      className={`${cls} flex items-center gap-1 tabular-nums ${muted ? "opacity-65 italic" : ""}`}
      title={muted ? "Nur zur Information – fließt NICHT ins Ranking ein" : undefined}
    >
      {icon}
      {value >= 0 ? "+" : ""}{value.toFixed(2)}%
    </span>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const cls = rank === 1 ? "rank-1" : rank === 2 ? "rank-2" : rank === 3 ? "rank-3" : "rank-other";
  return <span className={`rank-badge ${cls}`}>{rank}</span>;
}

function PointsBar({ points, maxPoints }: { points: number; maxPoints: number }) {
  const pct = maxPoints > 0 ? (points / maxPoints) * 100 : 0;
  const color = pct >= 70 ? "oklch(0.52 0.15 145)" : pct >= 40 ? "oklch(0.488 0.243 264.376)" : "oklch(0.72 0.12 40)";
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="momentum-bar flex-1">
        <div className="momentum-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-base font-bold tabular-nums text-slate-700 dark:text-white w-8 text-right">{points}</span>
    </div>
  );
}

// ─── Timestamp Helper ──────────────────────────────────────────────────────

function useRelativeTime(date: Date | null) {
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (!date) { setLabel(""); return; }
    const update = () => {
      const diffMs = Date.now() - date.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) setLabel("Gerade eben");
      else if (diffMin === 1) setLabel("Vor 1 Minute");
      else if (diffMin < 60) setLabel(`Vor ${diffMin} Minuten`);
      else {
        const h = Math.floor(diffMin / 60);
        setLabel(h === 1 ? "Vor 1 Stunde" : `Vor ${h} Stunden`);
      }
    };
    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, [date]);

  return label;
}

function LastUpdatedBadge({ date }: { date: Date | null }) {
  const relative = useRelativeTime(date);
  if (!date) return null;
  const full = date.toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  return (
    <span
      title={`Vollständiger Zeitstempel: ${full}`}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 font-medium"
    >
      <Clock size={11} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
      <span className="hidden sm:inline text-slate-400 dark:text-slate-500 font-normal">
        {date.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
      </span>
      <span className="text-slate-600 dark:text-slate-300">{relative}</span>
    </span>
  );
}

// ─── Chart Link Helpers ──────────────────────────────────────────────────────

function getYahooUrl(ticker: string): string {
  return `https://finance.yahoo.com/chart/${encodeURIComponent(ticker)}`;
}

function getTradingViewUrl(ticker: string): string {
  // Verified TradingView symbols for all 38 tickers
  const tvMap: Record<string, string> = {
    // US Indices
    "^NYA":     "NYSE:NYA",       // NYSE Composite – verified
    "^IXIC":    "NASDAQ:IXIC",    // NASDAQ Composite – verified
    "^NDX":     "NASDAQ:NDX",     // NASDAQ 100 – verified
    "^OEX":     "SP:OEX",         // S&P 100 – verified
    "^GSPC":    "INDEX:SPX",      // S&P 500 – verified
    "^MID":     "SP:MID",         // S&P 400 Mid Cap – verified
    "^DJI":     "DJ:DJI",         // Dow Jones Industrial – verified
    "^DJT":     "DJ:DJT",         // Dow Jones Transportation – verified
    "^DJU":     "DJ:DJU",         // Dow Jones Utilities – verified
    "^W5000":   "FRED:WILL5000PR", // Wilshire 5000 via FRED – best available
    // European Indices
    "^GDAXI":   "INDEX:DAX",      // DAX – verified
    "^STOXX50E":"TVC:SX5E",       // Euro Stoxx 50 – verified
    // ETFs (AMEX/NYSE ARCA)
    "IWC":  "AMEX:IWC",
    "IWB":  "AMEX:IWB",
    "IWM":  "AMEX:IWM",
    "IWV":  "AMEX:IWV",
    "VEA":  "AMEX:VEA",
    "AAXJ": "NASDAQ:AAXJ",
    "VXUS": "NASDAQ:VXUS",
    "EFA":  "AMEX:EFA",
    "VWO":  "AMEX:VWO",
    "ILF":  "AMEX:ILF",
    "IEV":  "AMEX:IEV",
    "EZU":  "AMEX:EZU",
    "VT":   "AMEX:VT",
    "VTI":  "AMEX:VTI",
    "IOO":  "AMEX:IOO",
    "XLK":  "AMEX:XLK",
    "XLV":  "AMEX:XLV",
    "XLF":  "AMEX:XLF",
    "XLY":  "AMEX:XLY",
    "XLC":  "AMEX:XLC",
    "XLI":  "AMEX:XLI",
    "XLP":  "AMEX:XLP",
    "XLE":  "AMEX:XLE",
    "XLU":  "AMEX:XLU",
    "XLB":  "AMEX:XLB",
    "XLRE": "AMEX:XLRE",
  };
  const symbol = tvMap[ticker] || ticker;
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;
}

function ChartLinks({ ticker }: { ticker: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 ml-2">
      <a
        href={getYahooUrl(ticker)}
        target="_blank"
        rel="noopener noreferrer"
        title="Yahoo Finance Chart öffnen"
        className="inline-flex items-center justify-center w-7 h-7 rounded-md text-violet-400 hover:text-violet-600 hover:bg-violet-50 dark:text-violet-400 dark:hover:text-violet-300 dark:hover:bg-violet-900/40 transition-colors"
        onClick={e => e.stopPropagation()}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
        </svg>
      </a>
      <a
        href={getTradingViewUrl(ticker)}
        target="_blank"
        rel="noopener noreferrer"
        title="TradingView Chart öffnen"
        className="inline-flex items-center justify-center w-7 h-7 rounded-md text-blue-400 hover:text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:text-blue-300 dark:hover:bg-blue-900/40 transition-colors"
        onClick={e => e.stopPropagation()}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 3v18h18V3H3zm16 16H5V5h14v14zM7 15l3-4 2 3 3-5 3 6H7z"/>
        </svg>
      </a>
    </span>
  );
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown size={13} className="text-slate-300 ml-0.5" />;
  return sortDir === "asc"
    ? <ChevronUp size={13} className="text-blue-600 ml-0.5" />
    : <ChevronDown size={13} className="text-blue-600 ml-0.5" />;
}

function SectionHeader({
  icon, title, subtitle, color
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  color: string;
}) {
  return (
    <div className="flex items-start gap-4 mb-6">
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: color + "18" }}
      >
        <span style={{ color }}>{icon}</span>
      </div>
      <div>
        <h2 className="text-xl font-bold text-slate-800" style={{ fontFamily: "DM Sans, sans-serif" }}>
          {title}
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}

function LoadingTable({ rows = 8 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 bg-slate-100 rounded-lg" style={{ opacity: 1 - i * 0.08 }} />
      ))}
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-slate-400">
      <AlertCircle size={32} className="mb-3 text-amber-400" />
      <p className="text-sm font-medium text-slate-500 mb-1">Daten konnten nicht geladen werden</p>
      <p className="text-xs text-slate-400 mb-4">Möglicherweise ist Yahoo Finance vorübergehend nicht erreichbar</p>
      <button
        onClick={onRetry}
        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
      >
        <RefreshCw size={14} /> Erneut versuchen
      </button>
    </div>
  );
}

// ─── Sortable Table Hook ──────────────────────────────────────────────────────

function useSortedData<T extends { rank: number; perf3m1: number; perf6m1: number; perf12m1: number; recent4w: number; points: number }>(data: T[]) {
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sorted = useMemo(() => [...data].sort((a, b) => {
    const mul = sortDir === "asc" ? 1 : -1;
    if (sortKey === "rank") return mul * (a.rank - b.rank);
    if (sortKey === "perf3m1") return mul * (a.perf3m1 - b.perf3m1);
    if (sortKey === "perf6m1") return mul * (a.perf6m1 - b.perf6m1);
    if (sortKey === "perf12m1") return mul * (a.perf12m1 - b.perf12m1);
    if (sortKey === "recent4w") return mul * (a.recent4w - b.recent4w);
    return mul * (a.points - b.points);
  }), [data, sortKey, sortDir]);

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir(key === "rank" ? "asc" : "desc"); }
  }, [sortKey]);

  return { sorted, sortKey, sortDir, handleSort };
}
// ─── Index Momentum Section ─────────────────────────────────────────────────────

function IndexSection() {
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const custom = useCustomTickers();

  const allTickers = useMemo(() => [
    ...INDEX_TICKER_LIST,
    ...custom.customTickers.map(t => t.ticker)
  ], [custom.customTickers]);

  const { data: response, isLoading, isError, refetch } = trpc.market.getPrices.useQuery(
    { tickers: allTickers },
    { staleTime: 14 * 60 * 1000, refetchInterval: 15 * 60 * 1000, retry: 1 }
  );
  const forceRefresh = trpc.market.forceRefresh.useMutation({
    onSuccess: () => refetch(),
  });

  const priceData = response?.prices ?? null;

  useEffect(() => {
    if (response?.fetchedAt) setLastUpdate(new Date(response.fetchedAt));
  }, [response]);

  const allTickerDefs = useMemo(() => [
    ...INDEX_TICKERS,
    ...custom.customTickers.map(t => ({ ticker: t.ticker, name: t.ticker, category: "Eigener Vergleich" }))
  ], [custom.customTickers]);

  const entries = useMemo(() => {
    if (!priceData) return [];
    return buildMomentumEntries(allTickerDefs, priceData);
  }, [priceData, allTickerDefs]);

  const { sorted, sortKey, sortDir, handleSort } = useSortedData(entries);

  const handleRefresh = () => {
    forceRefresh.mutate({ tickers: allTickers });
  };

  const isRefreshing = isLoading || forceRefresh.isPending;
  const thCls = "px-3 py-3.5 text-left text-sm font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-blue-600 select-none whitespace-nowrap";

  return (
    <section id="indizes" className="mb-10">
        <div className="bg-card rounded-2xl shadow-sm border border-border overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-start justify-between">
            <SectionHeader
              icon={<BarChart2 size={22} />}
              title="Markt-Indizes"
              subtitle="16 US- und europäische Indizes · 12‑1‑Momentum (ohne letzte 4 Wochen)"
              color="#2563eb"
            />
            <div className="flex items-center gap-2 mt-1">
              <LastUpdatedBadge date={lastUpdate} />
              <button
                onClick={handleRefresh}
                disabled={isLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/50 dark:text-blue-400 rounded-lg transition-colors disabled:opacity-50"
              >
                <RefreshCw size={12} className={isRefreshing ? "animate-spin" : ""} />
                Aktualisieren
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          {isLoading || forceRefresh.isPending ? (
            <div className="p-6"><LoadingTable rows={10} /></div>
          ) : isError ? (
            <ErrorState onRetry={handleRefresh} />
          ) : (
            <table className="w-full data-table">
              <thead className="bg-muted/50">
                <tr>
                  <th className={thCls} onClick={() => handleSort("rank")}>
                    <span className="flex items-center"># <SortIcon col="rank" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                  <th className={`${thCls} min-w-[90px]`}>Ticker</th>
                  <th className={`${thCls} min-w-[200px]`}>Name</th>
                  <th className={`${thCls} hidden md:table-cell`}>Kategorie</th>
                  <th className={thCls} onClick={() => handleSort("perf3m1")} title="3 Monate, ohne die letzten 4 Wochen">
                    <span className="flex items-center">3M‑1 <SortIcon col="perf3m1" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                  <th className={thCls} onClick={() => handleSort("perf6m1")} title="6 Monate, ohne die letzten 4 Wochen">
                    <span className="flex items-center">6M‑1 <SortIcon col="perf6m1" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                  <th className={thCls} onClick={() => handleSort("perf12m1")} title="12 Monate, ohne die letzten 4 Wochen">
                    <span className="flex items-center">12M‑1 <SortIcon col="perf12m1" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                  <th className={`${thCls} opacity-60`} onClick={() => handleSort("recent4w")} title="Letzte 4 Wochen – nur Info, nicht im Ranking">
                    <span className="flex items-center">4W (Info) <SortIcon col="recent4w" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                  <th className={thCls} onClick={() => handleSort("points")}>
                    <span className="flex items-center">Punkte <SortIcon col="points" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {sorted.map((row, i) => (
                  <tr
                    key={row.ticker}
                    className="animate-fade-in-up"
                    style={{ animationDelay: `${i * 25}ms`, animationFillMode: "both" }}
                  >
                    <td className="px-3 py-4"><RankBadge rank={row.rank} /></td>
                    <td className="px-3 py-4">
                      <span className="inline-flex items-center group">
                        <span className="font-mono text-base font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded">
                          {row.ticker.replace("^", "")}
                        </span>
                        <ChartLinks ticker={row.ticker} />
                      </span>
                    </td>
                    <td className="px-3 py-4 text-base text-slate-700 dark:text-slate-200 font-medium">{row.name}</td>
                    <td className="px-3 py-4 hidden md:table-cell">
                      <span className="text-sm text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-full">
                        {row.category}
                      </span>
                    </td>
                    <td className="px-3 py-4 text-base"><PerfCell value={row.perf3m1} /></td>
                    <td className="px-3 py-4 text-base"><PerfCell value={row.perf6m1} /></td>
                    <td className="px-3 py-4 text-base"><PerfCell value={row.perf12m1} /></td>
                    <td className="px-3 py-4 text-base"><PerfCell value={row.recent4w} muted /></td>
                    <td className="px-3 py-4"><PointsBar points={row.points} maxPoints={row.maxPoints} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-3 bg-muted/40 border-t border-border">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Info size={11} />
            Max. {entries[0]?.maxPoints || 45} Punkte · Paarweiser Vergleich über 3 Zeiträume (3M‑1/6M‑1/12M‑1, jeweils ohne die letzten 4 Wochen) · 4W‑Spalte nur Info · Daten: Yahoo Finance
          </p>
        </div>
        <CustomTickerInput
          inputValue={custom.inputValue}
          setInputValue={custom.setInputValue}
          addTicker={custom.addTicker}
          removeTicker={custom.removeTicker}
          customTickers={custom.customTickers}
          isLoading={custom.isLoading}
          error={custom.error}
          setError={custom.setError}
          accentColor="blue"
        />
      </div>
    </section>
  );
}

// ─── Global Markets Section ─────────────────────────────────────────────────

function GlobalSection() {
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const custom = useCustomTickers();

  const allTickers = useMemo(() => [
    ...GLOBAL_TICKER_LIST,
    ...custom.customTickers.map(t => t.ticker)
  ], [custom.customTickers]);

  const { data: response, isLoading, isError, refetch } = trpc.market.getPrices.useQuery(
    { tickers: allTickers },
    { staleTime: 14 * 60 * 1000, refetchInterval: 15 * 60 * 1000, retry: 1 }
  );
  const forceRefresh = trpc.market.forceRefresh.useMutation({
    onSuccess: () => refetch(),
  });

  const priceData = response?.prices ?? null;

  useEffect(() => {
    if (response?.fetchedAt) setLastUpdate(new Date(response.fetchedAt));
  }, [response]);

  const allTickerDefs = useMemo(() => [
    ...GLOBAL_TICKERS,
    ...custom.customTickers.map(t => ({ ticker: t.ticker, name: t.ticker, category: "Eigener Vergleich" }))
  ], [custom.customTickers]);

  const entries = useMemo(() => {
    if (!priceData) return [];
    return buildMomentumEntries(allTickerDefs, priceData);
  }, [priceData, allTickerDefs]);

  const { sorted, sortKey, sortDir, handleSort } = useSortedData(entries);

  const thCls = "px-3 py-3.5 text-left text-sm font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-emerald-600 select-none whitespace-nowrap";

  return (
    <section id="global" className="mb-10">
        <div className="bg-card rounded-2xl shadow-sm border border-border overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-start justify-between">
            <SectionHeader
              icon={<Globe size={22} />}
              title="Globale Märkte"
              subtitle="11 internationale ETFs · 12‑1‑Momentum (ohne letzte 4 Wochen)"
              color="#059669"
            />
            <div className="flex items-center gap-2 mt-1">
              <LastUpdatedBadge date={lastUpdate} />
              <button
                onClick={() => forceRefresh.mutate({ tickers: allTickers })}
                disabled={isLoading || forceRefresh.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/50 dark:text-emerald-400 rounded-lg transition-colors disabled:opacity-50"
              >
                <RefreshCw size={12} className={(isLoading || forceRefresh.isPending) ? "animate-spin" : ""} />
                Aktualisieren
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          {(isLoading || forceRefresh.isPending) ? (
            <div className="p-6"><LoadingTable rows={8} /></div>
          ) : isError ? (
            <ErrorState onRetry={() => forceRefresh.mutate({ tickers: allTickers })} />
          ) : (
            <table className="w-full data-table">
              <thead className="bg-muted/50">
                <tr>
                  <th className={thCls} onClick={() => handleSort("rank")}>
                    <span className="flex items-center"># <SortIcon col="rank" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                  <th className={`${thCls} min-w-[80px]`}>Ticker</th>
                  <th className={`${thCls} min-w-[220px]`}>Name</th>
                  <th className={`${thCls} hidden md:table-cell`}>Region</th>
                  <th className={thCls} onClick={() => handleSort("perf3m1")} title="3 Monate, ohne die letzten 4 Wochen">
                    <span className="flex items-center">3M‑1 <SortIcon col="perf3m1" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                  <th className={thCls} onClick={() => handleSort("perf6m1")} title="6 Monate, ohne die letzten 4 Wochen">
                    <span className="flex items-center">6M‑1 <SortIcon col="perf6m1" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                  <th className={thCls} onClick={() => handleSort("perf12m1")} title="12 Monate, ohne die letzten 4 Wochen">
                    <span className="flex items-center">12M‑1 <SortIcon col="perf12m1" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                  <th className={`${thCls} opacity-60`} onClick={() => handleSort("recent4w")} title="Letzte 4 Wochen – nur Info, nicht im Ranking">
                    <span className="flex items-center">4W (Info) <SortIcon col="recent4w" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                  <th className={thCls} onClick={() => handleSort("points")}>
                    <span className="flex items-center">Punkte <SortIcon col="points" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {sorted.map((row, i) => (
                  <tr
                    key={row.ticker}
                    className="animate-fade-in-up"
                    style={{ animationDelay: `${i * 25}ms`, animationFillMode: "both" }}
                  >
                    <td className="px-3 py-4"><RankBadge rank={row.rank} /></td>
                    <td className="px-3 py-4">
                      <span className="inline-flex items-center group">
                        <span className="font-mono text-base font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded">
                          {row.ticker}
                        </span>
                        <ChartLinks ticker={row.ticker} />
                      </span>
                    </td>
                    <td className="px-3 py-4 text-base text-slate-700 dark:text-slate-200 font-medium">{row.name}</td>
                    <td className="px-3 py-4 hidden md:table-cell">
                      <span className="text-sm text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-full">
                        {row.category}
                      </span>
                    </td>
                    <td className="px-3 py-4 text-base"><PerfCell value={row.perf3m1} /></td>
                    <td className="px-3 py-4 text-base"><PerfCell value={row.perf6m1} /></td>
                    <td className="px-3 py-4 text-base"><PerfCell value={row.perf12m1} /></td>
                    <td className="px-3 py-4 text-base"><PerfCell value={row.recent4w} muted /></td>
                    <td className="px-3 py-4"><PointsBar points={row.points} maxPoints={row.maxPoints} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-3 bg-muted/40 border-t border-border">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Info size={11} />
            Max. {entries[0]?.maxPoints || 30} Punkte · Paarweiser Vergleich über 3 Zeiträume (3M‑1/6M‑1/12M‑1, jeweils ohne die letzten 4 Wochen) · 4W‑Spalte nur Info · Daten: Yahoo Finance
          </p>
        </div>
        <CustomTickerInput
          inputValue={custom.inputValue}
          setInputValue={custom.setInputValue}
          addTicker={custom.addTicker}
          removeTicker={custom.removeTicker}
          customTickers={custom.customTickers}
          isLoading={custom.isLoading}
          error={custom.error}
          setError={custom.setError}
          accentColor="emerald"
        />
      </div>
    </section>
  );
}

// ─── Sector ETF Section ───────────────────────────────────────────────────────────

const SECTOR_ICONS: Record<string, string> = {
  "Technology": "💻",
  "Health Care": "🏥",
  "Financials": "🏦",
  "Consumer Discretionary": "🛒️",
  "Communication Services": "📡",
  "Industrials": "⚙️",
  "Consumer Staples": "🛒",
  "Energy": "⚡",
  "Utilities": "💡",
  "Materials": "🔩",
  "Real Estate": "🏢",
};

function EtfSection() {
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const custom = useCustomTickers();

  const allTickers = useMemo(() => [
    ...ETF_TICKER_LIST,
    ...custom.customTickers.map(t => t.ticker)
  ], [custom.customTickers]);

  const { data: response, isLoading, isError, refetch } = trpc.market.getPrices.useQuery(
    { tickers: allTickers },
    { staleTime: 14 * 60 * 1000, refetchInterval: 15 * 60 * 1000, retry: 1 }
  );
  const forceRefresh = trpc.market.forceRefresh.useMutation({
    onSuccess: () => refetch(),
  });

  const priceData = response?.prices ?? null;

  useEffect(() => {
    if (response?.fetchedAt) setLastUpdate(new Date(response.fetchedAt));
  }, [response]);

  const allTickerDefs = useMemo(() => [
    ...ETF_TICKERS,
    ...custom.customTickers.map(t => ({ ticker: t.ticker, sector: t.ticker }))
  ], [custom.customTickers]);

  const entries = useMemo(() => {
    if (!priceData) return [];
    return buildEtfEntries(allTickerDefs, priceData);
  }, [priceData, allTickerDefs]);

  const { sorted, sortKey, sortDir, handleSort } = useSortedData(entries);

  const thCls = "px-3 py-3.5 text-left text-sm font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-violet-600 select-none whitespace-nowrap";

  return (
    <section id="sektoren" className="mb-10">
        <div className="bg-card rounded-2xl shadow-sm border border-border overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-start justify-between">
            <SectionHeader
              icon={<PieChart size={22} />}
              title="Sektor-ETFs (SPDR)"
              subtitle="11 US-Sektoren · 12‑1‑Momentum (ohne letzte 4 Wochen)"
              color="#7c3aed"
            />
            <div className="flex items-center gap-2 mt-1">
              <LastUpdatedBadge date={lastUpdate} />
              <button
                onClick={() => forceRefresh.mutate({ tickers: ETF_TICKER_LIST })}
                disabled={isLoading || forceRefresh.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 dark:bg-violet-950/40 dark:hover:bg-violet-900/50 dark:text-violet-400 rounded-lg transition-colors disabled:opacity-50"
              >
                <RefreshCw size={12} className={(isLoading || forceRefresh.isPending) ? "animate-spin" : ""} />
                Aktualisieren
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          {(isLoading || forceRefresh.isPending) ? (
            <div className="p-6"><LoadingTable rows={8} /></div>
          ) : isError ? (
            <ErrorState onRetry={() => forceRefresh.mutate({ tickers: ETF_TICKER_LIST })} />
          ) : (
            <table className="w-full data-table">
              <thead className="bg-muted/50">
                <tr>
                  <th className={thCls} onClick={() => handleSort("rank")}>
                    <span className="flex items-center"># <SortIcon col="rank" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                  <th className={`${thCls} min-w-[80px]`}>Ticker</th>
                  <th className={`${thCls} min-w-[200px]`}>Sektor</th>
                  <th className={thCls} onClick={() => handleSort("perf3m1")} title="3 Monate, ohne die letzten 4 Wochen">
                    <span className="flex items-center">3M‑1 <SortIcon col="perf3m1" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                  <th className={thCls} onClick={() => handleSort("perf6m1")} title="6 Monate, ohne die letzten 4 Wochen">
                    <span className="flex items-center">6M‑1 <SortIcon col="perf6m1" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                  <th className={thCls} onClick={() => handleSort("perf12m1")} title="12 Monate, ohne die letzten 4 Wochen">
                    <span className="flex items-center">12M‑1 <SortIcon col="perf12m1" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                  <th className={`${thCls} opacity-60`} onClick={() => handleSort("recent4w")} title="Letzte 4 Wochen – nur Info, nicht im Ranking">
                    <span className="flex items-center">4W (Info) <SortIcon col="recent4w" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                  <th className={thCls} onClick={() => handleSort("points")}>
                    <span className="flex items-center">Punkte <SortIcon col="points" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {sorted.map((row, i) => (
                  <tr
                    key={row.ticker}
                    className="animate-fade-in-up"
                    style={{ animationDelay: `${i * 25}ms`, animationFillMode: "both" }}
                  >
                    <td className="px-3 py-4"><RankBadge rank={row.rank} /></td>
                    <td className="px-3 py-4">
                      <span className="inline-flex items-center group">
                        <span className="font-mono text-base font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded">
                          {row.ticker}
                        </span>
                        <ChartLinks ticker={row.ticker} />
                      </span>
                    </td>
                    <td className="px-3 py-4">
                      <span className="text-base text-slate-700 dark:text-slate-200 font-medium flex items-center gap-2">
                        <span>{SECTOR_ICONS[row.sector] || "📊"}</span>
                        {row.sector}
                      </span>
                    </td>
                    <td className="px-3 py-4 text-base"><PerfCell value={row.perf3m1} /></td>
                    <td className="px-3 py-4 text-base"><PerfCell value={row.perf6m1} /></td>
                    <td className="px-3 py-4 text-base"><PerfCell value={row.perf12m1} /></td>
                    <td className="px-3 py-4 text-base"><PerfCell value={row.recent4w} muted /></td>
                    <td className="px-3 py-4"><PointsBar points={row.points} maxPoints={row.maxPoints} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-3 bg-muted/40 border-t border-border">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Info size={11} />
            Max. {entries[0]?.maxPoints || 30} Punkte · Paarweiser Vergleich über 3 Zeiträume (3M‑1/6M‑1/12M‑1, jeweils ohne die letzten 4 Wochen) · 4W‑Spalte nur Info · Daten: Yahoo Finance
          </p>
        </div>
        <CustomTickerInput
          inputValue={custom.inputValue}
          setInputValue={custom.setInputValue}
          addTicker={custom.addTicker}
          removeTicker={custom.removeTicker}
          customTickers={custom.customTickers}
          isLoading={custom.isLoading}
          error={custom.error}
          setError={custom.setError}
          accentColor="violet"
        />
      </div>
    </section>
  );
}

// ─── VIX Widget ──────────────────────────────────────────────────────

const VIX_LEVELS = [
  {
    max: 15,
    label: "Risk-On",
    color: "emerald",
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    border: "border-emerald-200 dark:border-emerald-800",
    badge: "bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
    hint: "\u201eRisk-On\u201c-Modus. Trends sind sehr stabil.",
  },
  {
    max: 20,
    label: "Normal",
    color: "blue",
    bg: "bg-blue-50 dark:bg-blue-950/40",
    border: "border-blue-200 dark:border-blue-800",
    badge: "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300",
    dot: "bg-blue-500",
    hint: "Normalzustand. Momentum funktioniert weiterhin gut, aber die Stopp-Loss-Abst\u00e4nde sollten etwas gro\u00dfz\u00fcgiger sein.",
  },
  {
    max: 30,
    label: "Erh\u00f6ht",
    color: "amber",
    bg: "bg-amber-50 dark:bg-amber-950/40",
    border: "border-amber-200 dark:border-amber-800",
    badge: "bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
    hint: "Erh\u00f6hte Volatilit\u00e4t. Momentum-Strategien werden unzuverl\u00e4ssiger \u2013 Positionsgr\u00f6\u00dfen reduzieren.",
  },
  {
    max: Infinity,
    label: "Extremer Stress",
    color: "red",
    bg: "bg-red-50 dark:bg-red-950/40",
    border: "border-red-200 dark:border-red-800",
    badge: "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300",
    dot: "bg-red-500",
    hint: "Extremer Markt-Stress. Momentum bricht zusammen \u2013 defensiv agieren und Cash-Quote erh\u00f6hen.",
  },
];

function getVixLevel(value: number) {
  return VIX_LEVELS.find(l => value < l.max) ?? VIX_LEVELS[VIX_LEVELS.length - 1];
}

function VixWidget() {
  const { data, isLoading, isError } = trpc.market.getVix.useQuery(
    undefined,
    { staleTime: 14 * 60 * 1000, retry: 1 }
  );

  if (isLoading) {
    return (
      <div className="mb-6 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-4 animate-pulse">
        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-32 mb-2" />
        <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-20" />
      </div>
    );
  }

  if (isError || !data || data.error || data.value === null) {
    return (
      <div className="mb-6 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-4 flex items-center gap-3">
        <AlertCircle size={16} className="text-slate-400" />
        <span className="text-sm text-slate-500 dark:text-slate-400">VIX-Daten nicht verf\u00fcgbar</span>
        <a
          href="https://finance.yahoo.com/quote/%5EVIX/"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          Yahoo Finance ↗
        </a>
      </div>
    );
  }

  const level = getVixLevel(data.value);
  const changeSign = (data.change ?? 0) >= 0 ? "+" : "";

  return (
    <div className={`mb-6 rounded-2xl border ${level.border} ${level.bg} px-5 py-4`}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
        {/* VIX Value */}
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${level.dot} flex-shrink-0`} />
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-800 dark:text-slate-100" style={{ fontFamily: "DM Sans, sans-serif" }}>
                {data.value.toFixed(2)}
              </span>
              {data.change !== null && (
                <span className={`text-sm font-medium ${
                  (data.change ?? 0) >= 0 ? "text-red-500" : "text-emerald-500"
                }`}>
                  {changeSign}{data.change!.toFixed(2)} ({changeSign}{data.changePercent!.toFixed(1)}%)
                </span>
              )}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              CBOE Volatility Index (VIX)
            </div>
          </div>
        </div>

        {/* Status Badge */}
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold ${level.badge} self-start sm:self-auto`}>
          {level.label}
        </span>

        {/* Hint Text */}
        <p className="text-sm text-slate-600 dark:text-slate-300 sm:flex-1">
          {level.hint}
        </p>

        {/* Link */}
        <a
          href="https://finance.yahoo.com/quote/%5EVIX/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 whitespace-nowrap self-start sm:self-auto flex-shrink-0"
        >
          Chart ↗
        </a>
      </div>
    </div>
  );
}

// ─── Methodology Info Box ──────────────────────────────────────────────────────
function MethodologyBox() {
  const [open, setOpen] = useState(false);
  return (
        <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900 rounded-xl px-5 py-4 mb-8">
      <button
        className="flex items-center gap-2 w-full text-left"
        onClick={() => setOpen(o => !o)}
      >
        <Info size={15} className="text-blue-500 flex-shrink-0" />
        <span className="text-sm font-semibold text-blue-700 dark:text-blue-400">Methodik: 12‑1‑Momentum – Relative Stärke ohne die letzten 4 Wochen</span>
        <ChevronDown size={14} className={`ml-auto text-blue-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-blue-700 dark:text-blue-400">
          <div>
            <p className="font-semibold mb-1">Warum die letzten 4 Wochen fehlen</p>
            <p className="text-blue-600 dark:text-blue-500">Kurzfristig neigen Kurse zur Gegenbewegung (Mean Reversion). Wer ein Asset kauft, das gerade vier starke Wochen hinter sich hat, erwischt oft den Rücksetzer. Deshalb enden alle Messfenster 20 Handelstage vor heute – das klassische „12‑1"-Momentum aus der Faktorforschung.</p>
          </div>
          <div>
            <p className="font-semibold mb-1">Drei Fenster, paarweise verglichen</p>
            <p className="text-blue-600 dark:text-blue-500">3M‑1, 6M‑1 und 12M‑1 (63/126/252 Handelstage, jeweils minus die letzten 20). Jeder Wert wird mit jedem anderen über alle drei Fenster verglichen; der stärkere bekommt einen Punkt. Bei Punktgleichheit entscheidet 12M‑1.</p>
          </div>
          <div>
            <p className="font-semibold mb-1">4W‑Spalte nur zur Kontrolle</p>
            <p className="text-blue-600 dark:text-blue-500">Die letzten vier Wochen werden ausgegraut angezeigt, fließen aber nicht ins Ranking ein. Ein hoher Rang bei zugleich stark negativer 4W‑Spalte kann ein Einstiegsfenster sein – ein hoher Rang bei extrem positiver 4W‑Spalte mahnt zur Geduld.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function NavBar() {
  const [scrolled, setScrolled] = useState(false);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler);
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-200 ${
        scrolled
          ? "bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shadow-sm border-b border-slate-200 dark:border-slate-700"
          : "bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800"
      }`}
    >
      <div className="container">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <TrendingUp size={16} className="text-white" />
            </div>
            <div>
              <span className="font-bold text-slate-800 dark:text-slate-100 text-base" style={{ fontFamily: "DM Sans, sans-serif" }}>
                meine-geldseite.de
              </span>
              <span className="font-light text-slate-400 dark:text-slate-500 text-base ml-1" style={{ fontFamily: "DM Sans, sans-serif" }}>
                Momentum-Tracker 12‑1
              </span>
            </div>
          </div>

          <nav className="hidden sm:flex items-center gap-1">
            {[
              { id: "indizes", label: "Indizes", icon: <BarChart2 size={13} />, color: "text-blue-600 bg-blue-50 hover:bg-blue-100" },
              { id: "global", label: "Globale Märkte", icon: <Globe size={13} />, color: "text-emerald-600 bg-emerald-50 hover:bg-emerald-100" },
              { id: "sektoren", label: "Sektor-ETFs", icon: <PieChart size={13} />, color: "text-violet-600 bg-violet-50 hover:bg-violet-100" },
            ].map(nav => (
              <button
                key={nav.id}
                onClick={() => scrollTo(nav.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${nav.color}`}
              >
                {nav.icon}
                {nav.label}
              </button>
            ))}
          </nav>

          {/* Dark/Light Toggle */}
          <button
            onClick={toggleTheme}
            aria-label="Hell/Dunkel wechseln"
            className="ml-2 w-9 h-9 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </div>
    </header>
  );
}

// ─── Page Hero ────────────────────────────────────────────────────────────────

function Hero() {
  const today = new Date().toLocaleDateString("de-DE", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });

  // Countdown: seconds until next 15-min auto-refresh
  const [secondsLeft, setSecondsLeft] = useState(() => {
    const now = Date.now();
    const interval = 15 * 60 * 1000;
    return Math.ceil((interval - (now % interval)) / 1000);
  });

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const interval = 15 * 60 * 1000;
      setSecondsLeft(Math.ceil((interval - (now % interval)) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const countdownText = secondsLeft >= 60
    ? `${Math.ceil(secondsLeft / 60)} Min.`
    : `${secondsLeft} Sek.`;

  return (
    <div className="py-8 mb-2">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-100 mb-1" style={{ fontFamily: "DM Sans, sans-serif" }}>
            meine-geldseite.de Momentum-Tracker 12‑1
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Relative Stärke über 12 Monate – ohne die letzten 4 Wochen · Markt-Indizes · Globale Märkte · Sektor-ETFs
          </p>
        </div>
        <div className="hidden sm:flex flex-col items-end gap-1">
          <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2 rounded-lg">
            <Clock size={12} />
            <span>{today}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-blue-500 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900 px-3 py-1.5 rounded-lg">
            <RefreshCw size={11} />
            <span>Nächste Aktualisierung in {countdownText}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        {[
          { label: "16 Markt-Indizes", color: "bg-blue-50 text-blue-600 border-blue-100" },
          { label: "11 Globale ETFs", color: "bg-emerald-50 text-emerald-600 border-emerald-100" },
          { label: "11 Sektor-ETFs", color: "bg-violet-50 text-violet-600 border-violet-100" },
        ].map(chip => (
          <span
            key={chip.label}
            className={`text-xs font-medium px-3 py-1 rounded-full border ${chip.color}`}
          >
            {chip.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <main className="container py-6">
        <Hero />
        <VixWidget />
        <MethodologyBox />
        <IndexSection />
        <GlobalSection />
        <EtfSection />

        <div className="border-t border-slate-200 dark:border-slate-700 pt-6 pb-8 mt-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-blue-600 rounded flex items-center justify-center">
                <TrendingUp size={12} className="text-white" />
              </div>
             <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">meine-geldseite.de Momentum-Tracker 12‑1</span>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Kursdaten von Yahoo Finance · Nur zu Informationszwecken · Keine Anlageberatung
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
