/**
 * 12-1-Momentum-Strategie (Top-N, Dual Momentum)
 *
 * Regeln:
 *  - Universum: handelbare ETFs (SPY + 11 globale + 11 SPDR-Sektoren).
 *  - Ranking wie im Dashboard: paarweiser Punktevergleich über 3M-1 / 6M-1 / 12M-1
 *    (63/126/252 Handelstage, jeweils ohne die letzten 20), Tie-Break 12M-1.
 *  - Absolut-Momentum-Filter (Antonacci): nur Werte mit 12M-1 > 0 werden gekauft,
 *    freie Slots bleiben in Cash.
 *  - Umschichtung am letzten Handelstag jedes Monats bzw. Quartals (Schlusskurs).
 *  - Gleichgewichtung, keine Kosten/Steuern im Backtest.
 *
 * Alles wird deterministisch aus der Kurshistorie berechnet – es muss nirgends
 * ein Portfolio gespeichert werden.
 */

export type StrategyFile = {
  dates: string[];               // YYYY-MM-DD, aufsteigend
  closes: Record<string, (number | null)[]>;
  benchmark: string;
  universe: string[];
  fetchedAt: string;
};

export type Frequency = "monthly" | "quarterly";

export type StrategyParams = {
  topN: number;
  frequency: Frequency;
  absoluteFilter: boolean;
};

export const DEFAULT_PARAMS: StrategyParams = { topN: 3, frequency: "monthly", absoluteFilter: true };

const SKIP = 20;
const WINDOWS = { m3: 63, m6: 126, m12: 252 } as const;
const MIN_BARS = WINDOWS.m12 + 1;

export type RankRow = {
  ticker: string;
  rank: number;
  points: number;
  maxPoints: number;
  p3: number;
  p6: number;
  p12: number;
  r4: number;
  eligible: boolean;   // besteht den Absolut-Filter
};

function perfSkip(p: (number | null)[], end: number, lookback: number, skip: number): number {
  const a = p[end - lookback];
  const b = p[end - skip];
  if (!a || !b) return 0;
  return ((b - a) / a) * 100;
}
function perfRecent(p: (number | null)[], end: number, days: number): number {
  const a = p[end - days];
  const b = p[end];
  if (!a || !b) return 0;
  return ((b - a) / a) * 100;
}

/** Ranking des Universums zum Schlusskurs von Index `end`. */
export function rankAt(file: StrategyFile, end: number, absoluteFilter: boolean): RankRow[] {
  // Werte ohne volle 12-Monats-Historie (z. B. XLC vor 2018) werden ausgelassen
  const u = file.universe.filter(t => file.closes[t][end - WINDOWS.m12] != null && file.closes[t][end] != null);
  const perfs = u.map(t => {
    const p = file.closes[t];
    return {
      ticker: t,
      p3: perfSkip(p, end, WINDOWS.m3, SKIP),
      p6: perfSkip(p, end, WINDOWS.m6, SKIP),
      p12: perfSkip(p, end, WINDOWS.m12, SKIP),
      r4: perfRecent(p, end, SKIP),
    };
  });
  const pts: Record<string, number> = {};
  perfs.forEach(x => { pts[x.ticker] = 0; });
  for (let i = 0; i < perfs.length; i++) {
    for (let j = i + 1; j < perfs.length; j++) {
      for (const k of ["p3", "p6", "p12"] as const) {
        if (perfs[i][k] > perfs[j][k]) pts[perfs[i].ticker]++;
        else if (perfs[j][k] > perfs[i][k]) pts[perfs[j].ticker]++;
      }
    }
  }
  const maxPoints = (u.length - 1) * 3;
  return perfs
    .map(x => ({ ...x, points: pts[x.ticker], maxPoints, rank: 0, eligible: !absoluteFilter || x.p12 > 0 }))
    .sort((a, b) => b.points - a.points || b.p12 - a.p12)
    .map((x, i) => ({ ...x, rank: i + 1 }));
}

/** Auswahl: die ersten topN Werte des Rankings, die den Filter bestehen. */
export function selectAt(file: StrategyFile, end: number, params: StrategyParams): { rows: RankRow[]; picks: string[] } {
  const rows = rankAt(file, end, params.absoluteFilter);
  const picks = rows.filter(r => r.eligible).slice(0, params.topN).map(r => r.ticker);
  return { rows, picks };
}

function periodKey(date: string, f: Frequency): string {
  const y = date.slice(0, 4);
  const m = parseInt(date.slice(5, 7), 10);
  return f === "monthly" ? `${y}-${m}` : `${y}-Q${Math.ceil(m / 3)}`;
}

/** Indizes aller Umschichtungstage = letzter Handelstag jeder Periode (ohne die laufende). */
export function rebalanceIndices(dates: string[], f: Frequency): number[] {
  const out: number[] = [];
  for (let i = 0; i < dates.length - 1; i++) {
    if (periodKey(dates[i], f) !== periodKey(dates[i + 1], f)) out.push(i);
  }
  return out;
}

export type Holding = {
  ticker: string;
  entryIndex: number;
  entryDate: string;
  entryPrice: number;
  lastPrice: number;
  perf: number;        // seit Einstieg, %
  weight: number;
};

export type Trade = { action: "buy" | "sell" | "hold"; ticker: string };

export type BacktestPoint = { date: string; strategy: number; benchmark: number; cashSlots: number };

export type BacktestStats = {
  start: string;
  end: string;
  totalReturn: number;
  benchmarkReturn: number;
  cagr: number;
  benchmarkCagr: number;
  maxDrawdown: number;
  benchmarkMaxDrawdown: number;
  volatility: number;
  benchmarkVolatility: number;
  rebalances: number;
  trades: number;
  hitRate: number;       // Anteil Perioden mit positiver Strategie-Rendite
  winVsBenchmark: number;// Anteil Perioden, in denen Strategie den Benchmark schlägt
  cashShare: number;     // durchschnittlicher Cash-Anteil
};

export type StrategyResult = {
  params: StrategyParams;
  asOfIndex: number;
  asOfDate: string;
  lastRebalanceIndex: number;
  lastRebalanceDate: string;
  nextRebalanceDate: string;      // geschätzt: letzter Kalendertag der laufenden Periode
  daysToNextRebalance: number;
  holdings: Holding[];
  cashSlots: number;
  // Vorschau: Was würde heute passieren?
  previewRows: RankRow[];
  previewPicks: string[];
  previewTrades: Trade[];
  curve: BacktestPoint[];
  stats: BacktestStats;
  history: { date: string; picks: string[]; trades: Trade[]; periodReturn: number | null; benchmarkReturn: number | null }[];
};

function diffTrades(prev: string[], next: string[]): Trade[] {
  const out: Trade[] = [];
  for (const t of next) out.push({ action: prev.includes(t) ? "hold" : "buy", ticker: t });
  for (const t of prev) if (!next.includes(t)) out.push({ action: "sell", ticker: t });
  return out;
}

function maxDrawdown(values: number[]): number {
  let peak = -Infinity, mdd = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    const dd = (v - peak) / peak;
    if (dd < mdd) mdd = dd;
  }
  return mdd * 100;
}

function annualizedVol(values: number[]): number {
  const rets: number[] = [];
  for (let i = 1; i < values.length; i++) rets.push(values[i] / values[i - 1] - 1);
  if (rets.length < 2) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v) * Math.sqrt(252) * 100;
}

function endOfPeriod(date: string, f: Frequency): Date {
  const y = parseInt(date.slice(0, 4), 10);
  const m = parseInt(date.slice(5, 7), 10); // 1-12
  const lastMonth = f === "monthly" ? m : Math.ceil(m / 3) * 3;
  return new Date(Date.UTC(y, lastMonth, 0)); // Tag 0 des Folgemonats = letzter Tag
}

export function runStrategy(file: StrategyFile, params: StrategyParams): StrategyResult {
  const { dates, closes, benchmark } = file;
  const n = dates.length;
  const asOf = n - 1;
  const rebs = rebalanceIndices(dates, params.frequency).filter(i => i >= MIN_BARS - 1);
  if (rebs.length === 0) throw new Error("Zu wenig Historie für die Strategie.");

  // ── Backtest ──────────────────────────────────────────────────────────────
  const start = rebs[0];
  const curve: BacktestPoint[] = [];
  const history: StrategyResult["history"] = [];
  let equity = 100;
  const bench0 = closes[benchmark][start]!;
  let picks: string[] = [];
  let entry: Record<string, number> = {};
  let trades = 0;
  let cashSlotDays = 0;
  let periodStartEquity = equity;
  let periodStartBench = bench0;
  let prevRebIdx = start;

  const rebSet = new Set(rebs);
  for (let i = start; i <= asOf; i++) {
    if (i > start) {
      // Tagesrendite des Portfolios (gleichgewichtet, Cash = 0 %)
      let r = 0;
      for (const t of picks) {
        const a = closes[t][i - 1], b = closes[t][i];
        if (a && b) r += (b / a - 1) / params.topN;
      }
      equity *= 1 + r;
    }
    cashSlotDays += params.topN - picks.length;
    curve.push({
      date: dates[i],
      strategy: equity,
      benchmark: (closes[benchmark][i]! / bench0) * 100,
      cashSlots: params.topN - picks.length,
    });

    if (rebSet.has(i)) {
      // Periodenergebnis abschließen (außer beim allerersten Stichtag)
      if (i > start) {
        history[history.length - 1].periodReturn = (equity / periodStartEquity - 1) * 100;
        history[history.length - 1].benchmarkReturn = (closes[benchmark][i]! / periodStartBench - 1) * 100;
      }
      const sel = selectAt(file, i, params);
      const tr = diffTrades(picks, sel.picks);
      trades += tr.filter(t => t.action !== "hold").length;
      const newEntry: Record<string, number> = {};
      for (const t of sel.picks) newEntry[t] = entry[t] ?? i;
      // Bei Neukauf: Einstieg heute
      for (const t of sel.picks) if (!picks.includes(t)) newEntry[t] = i;
      picks = sel.picks;
      entry = newEntry;
      prevRebIdx = i;
      periodStartEquity = equity;
      periodStartBench = closes[benchmark][i]!;
      history.push({ date: dates[i], picks: [...picks], trades: tr, periodReturn: null, benchmarkReturn: null });
    }
  }

  // ── Kennzahlen ────────────────────────────────────────────────────────────
  const stratVals = curve.map(c => c.strategy);
  const benchVals = curve.map(c => c.benchmark);
  const years = Math.max((new Date(dates[asOf]).getTime() - new Date(dates[start]).getTime()) / (365.25 * 864e5), 1 / 12);
  const closed = history.filter(h => h.periodReturn !== null);
  const stats: BacktestStats = {
    start: dates[start],
    end: dates[asOf],
    totalReturn: equity - 100,
    benchmarkReturn: benchVals[benchVals.length - 1] - 100,
    cagr: (Math.pow(equity / 100, 1 / years) - 1) * 100,
    benchmarkCagr: (Math.pow(benchVals[benchVals.length - 1] / 100, 1 / years) - 1) * 100,
    maxDrawdown: maxDrawdown(stratVals),
    benchmarkMaxDrawdown: maxDrawdown(benchVals),
    volatility: annualizedVol(stratVals),
    benchmarkVolatility: annualizedVol(benchVals),
    rebalances: rebs.length,
    trades,
    hitRate: closed.length ? (closed.filter(h => (h.periodReturn ?? 0) > 0).length / closed.length) * 100 : 0,
    winVsBenchmark: closed.length ? (closed.filter(h => (h.periodReturn ?? 0) > (h.benchmarkReturn ?? 0)).length / closed.length) * 100 : 0,
    cashShare: (cashSlotDays / (curve.length * params.topN)) * 100,
  };

  // ── Aktuelles Portfolio ───────────────────────────────────────────────────
  const holdings: Holding[] = picks.map(t => {
    const ei = entry[t];
    const ep = closes[t][ei]!;
    const lp = closes[t][asOf]!;
    return { ticker: t, entryIndex: ei, entryDate: dates[ei], entryPrice: ep, lastPrice: lp, perf: (lp / ep - 1) * 100, weight: 100 / params.topN };
  });

  // ── Vorschau auf den nächsten Stichtag ────────────────────────────────────
  const preview = selectAt(file, asOf, params);
  const previewTrades = diffTrades(picks, preview.picks);
  const nextEnd = endOfPeriod(dates[asOf], params.frequency);
  const today = new Date(dates[asOf] + "T00:00:00Z");
  const daysToNext = Math.max(0, Math.round((nextEnd.getTime() - today.getTime()) / 864e5));

  return {
    params,
    asOfIndex: asOf,
    asOfDate: dates[asOf],
    lastRebalanceIndex: prevRebIdx,
    lastRebalanceDate: dates[prevRebIdx],
    nextRebalanceDate: nextEnd.toISOString().slice(0, 10),
    daysToNextRebalance: daysToNext,
    holdings,
    cashSlots: params.topN - picks.length,
    previewRows: preview.rows,
    previewPicks: preview.picks,
    previewTrades,
    curve,
    stats,
    history: history.slice().reverse(),
  };
}
