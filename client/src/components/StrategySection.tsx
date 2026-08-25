/**
 * Strategie-Sektion: 12-1 Top-3 Dual Momentum
 * Zeigt aktuelles Modell-Portfolio, Vorschau auf den nächsten Stichtag,
 * Backtest-Kennzahlen und Equity-Kurve vs. SPY.
 */
import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import {
  Briefcase, ArrowUpRight, ArrowDownRight, CalendarClock, ChevronDown, Info, AlertCircle, Wallet, ShieldCheck,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import {
  runStrategy, DEFAULT_PARAMS, type StrategyFile, type StrategyParams, type Frequency, type StrategyResult,
} from "@/lib/strategy";

const NAMES: Record<string, string> = {
  VEA: "Vanguard FTSE Developed Markets", AAXJ: "iShares MSCI Asia ex Japan", VXUS: "Vanguard Total International",
  EFA: "iShares MSCI EAFE", VWO: "Vanguard FTSE Emerging Markets", ILF: "iShares Latin America 40",
  IEV: "iShares Europe", EZU: "iShares MSCI Eurozone", VT: "Vanguard Total World", VTI: "Vanguard Total US Market",
  IOO: "iShares Global 100", XLK: "Technology", XLV: "Health Care", XLF: "Financials", XLY: "Consumer Discretionary",
  XLC: "Communication Services", XLI: "Industrials", XLP: "Consumer Staples", XLE: "Energy", XLU: "Utilities",
  XLB: "Materials", XLRE: "Real Estate", SPY: "S&P 500 (SPY)",
};
const SPY_CLS = "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900";
const SECTOR_SET = new Set(["XLK", "XLV", "XLF", "XLY", "XLC", "XLI", "XLP", "XLE", "XLU", "XLB", "XLRE"]);

function dataUrl(name: string): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base}${base.endsWith("/") ? "" : "/"}data/${name}`;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
function pct(v: number, digits = 1): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}
function Pct({ v, digits = 1, className = "" }: { v: number; digits?: number; className?: string }) {
  const cls = v > 0.05 ? "text-emerald-600 dark:text-emerald-400" : v < -0.05 ? "text-red-500 dark:text-red-400" : "text-slate-500";
  return <span className={`tabular-nums font-semibold ${cls} ${className}`}>{pct(v, digits)}</span>;
}

function TickerChip({ t }: { t: string }) {
  const cls = t === "SPY" ? SPY_CLS : SECTOR_SET.has(t)
    ? "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900"
    : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900";
  return <span className={`inline-block font-mono text-xs font-bold px-2 py-0.5 rounded border ${cls}`}>{t}</span>;
}

function Toggle<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-xs font-semibold">
      {options.map(o => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`px-3 py-1.5 transition-colors ${
            value === o.v
              ? "bg-blue-600 text-white"
              : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value, sub, good }: { label: string; value: string; sub?: string; good?: boolean | null }) {
  const color = good === true ? "text-emerald-600 dark:text-emerald-400" : good === false ? "text-red-500 dark:text-red-400" : "text-slate-800 dark:text-slate-100";
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 font-semibold">{label}</div>
      <div className={`text-xl font-bold tabular-nums mt-0.5 ${color}`} style={{ fontFamily: "DM Sans, sans-serif" }}>{value}</div>
      {sub && <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">{sub}</div>}
    </div>
  );
}

export default function StrategySection() {
  const [file, setFile] = useState<StrategyFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useState<StrategyParams>(DEFAULT_PARAMS);
  const [showHistory, setShowHistory] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const { theme } = useTheme();

  useEffect(() => {
    fetch(`${dataUrl("strategy.json")}?_=${Date.now()}`)
      .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then((d: StrategyFile) => setFile(d))
      .catch(e => setError(e.message));
  }, []);

  const result: StrategyResult | null = useMemo(() => {
    if (!file) return null;
    try { return runStrategy(file, params); } catch (e) { setError((e as Error).message); return null; }
  }, [file, params]);

  const chartData = useMemo(() => {
    if (!result) return [];
    // auf ~250 Punkte ausdünnen, damit der Chart flott bleibt
    const step = Math.max(1, Math.floor(result.curve.length / 250));
    return result.curve.filter((_, i) => i % step === 0 || i === result.curve.length - 1)
      .map(c => ({ date: c.date, Strategie: +c.strategy.toFixed(2), "S&P 500": +c.benchmark.toFixed(2) }));
  }, [result]);

  const dark = theme === "dark";
  const gridColor = dark ? "#334155" : "#e2e8f0";
  const axisColor = dark ? "#94a3b8" : "#64748b";

  return (
    <section id="strategie" className="mb-10 scroll-mt-20">
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-slate-100 dark:border-slate-700">
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#f59e0b18", color: "#d97706" }}>
                <Briefcase size={22} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100" style={{ fontFamily: "DM Sans, sans-serif" }}>
                  Modell-Portfolio: 12‑1 Top‑3 Dual Momentum
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  23 handelbare ETFs (SPY, 11 global, 11 Sektoren) · Top 3 nach 12‑1‑Ranking · nur bei positivem 12M‑1 (sonst Cash) · Umschichtung am letzten Handelstag
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Toggle<Frequency>
                value={params.frequency}
                options={[{ v: "monthly", label: "Monatlich" }, { v: "quarterly", label: "Quartalsweise" }]}
                onChange={v => setParams(p => ({ ...p, frequency: v }))}
              />
              <Toggle<"on" | "off">
                value={params.absoluteFilter ? "on" : "off"}
                options={[{ v: "on", label: "Cash-Filter an" }, { v: "off", label: "Immer investiert" }]}
                onChange={v => setParams(p => ({ ...p, absoluteFilter: v === "on" }))}
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="px-6 py-6 flex items-center gap-2 text-sm text-slate-500"><AlertCircle size={16} /> Strategie-Daten nicht verfügbar ({error}).</div>
        )}
        {!error && !result && (
          <div className="px-6 py-8 animate-pulse"><div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/3 mb-3" /><div className="h-24 bg-slate-100 dark:bg-slate-700/50 rounded" /></div>
        )}

        {result && (
          <div className="px-6 py-5 space-y-6">
            {/* Aktuelles Portfolio + Vorschau */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Aktuell */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                    <Wallet size={15} className="text-amber-600" /> Aktuelles Portfolio
                  </div>
                  <span className="text-xs text-slate-500 dark:text-slate-400">Stichtag {fmtDate(result.lastRebalanceDate)}</span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      <th className="text-left px-4 py-2 font-semibold">Position</th>
                      <th className="text-right px-3 py-2 font-semibold">Gewicht</th>
                      <th className="text-right px-3 py-2 font-semibold">Einstieg</th>
                      <th className="text-right px-4 py-2 font-semibold">Seit Kauf</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.holdings.map(h => (
                      <tr key={h.ticker} className="border-t border-slate-100 dark:border-slate-700/60">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2"><TickerChip t={h.ticker} /><span className="text-slate-600 dark:text-slate-300 text-xs">{NAMES[h.ticker]}</span></div>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{h.weight.toFixed(1)}%</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-500 dark:text-slate-400 text-xs">{fmtDate(h.entryDate)}<br /><span className="text-slate-400">{h.entryPrice.toFixed(2)}</span></td>
                        <td className="px-4 py-2.5 text-right"><Pct v={h.perf} /></td>
                      </tr>
                    ))}
                    {Array.from({ length: result.cashSlots }).map((_, i) => (
                      <tr key={`cash-${i}`} className="border-t border-slate-100 dark:border-slate-700/60">
                        <td className="px-4 py-2.5"><div className="flex items-center gap-2"><span className="inline-block font-mono text-xs font-bold px-2 py-0.5 rounded border bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600">CASH</span><span className="text-slate-500 text-xs">Absolut-Filter: kein Kandidat mit positivem 12M‑1</span></div></td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{(100 / params.topN).toFixed(1)}%</td>
                        <td className="px-3 py-2.5" /><td className="px-4 py-2.5 text-right text-slate-400">–</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Vorschau */}
              <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 overflow-hidden">
                <div className="px-4 py-3 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900/60 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
                    <CalendarClock size={15} /> Nächste Umschichtung
                  </div>
                  <span className="text-xs text-amber-700 dark:text-amber-400">
                    {fmtDate(result.nextRebalanceDate)} · {result.daysToNextRebalance === 0 ? "heute" : `in ${result.daysToNextRebalance} Tagen`}
                  </span>
                </div>
                <div className="px-4 py-3">
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                    Stand {fmtDate(result.asOfDate)}: So sähe das Portfolio aus, wenn heute Stichtag wäre. Bis zum Stichtag kann sich das Ranking noch ändern.
                  </p>
                  <div className="space-y-1.5">
                    {result.previewTrades.filter(t => t.action === "buy").map(t => (
                      <div key={"b" + t.ticker} className="flex items-center gap-2 text-sm">
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-400 w-20"><ArrowUpRight size={14} /> KAUFEN</span>
                        <TickerChip t={t.ticker} /><span className="text-xs text-slate-600 dark:text-slate-300">{NAMES[t.ticker]}</span>
                      </div>
                    ))}
                    {result.previewTrades.filter(t => t.action === "sell").map(t => (
                      <div key={"s" + t.ticker} className="flex items-center gap-2 text-sm">
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600 dark:text-red-400 w-20"><ArrowDownRight size={14} /> VERKAUFEN</span>
                        <TickerChip t={t.ticker} /><span className="text-xs text-slate-600 dark:text-slate-300">{NAMES[t.ticker]}</span>
                      </div>
                    ))}
                    {result.previewTrades.filter(t => t.action === "hold").map(t => (
                      <div key={"h" + t.ticker} className="flex items-center gap-2 text-sm opacity-70">
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 w-20"><ShieldCheck size={14} /> HALTEN</span>
                        <TickerChip t={t.ticker} /><span className="text-xs text-slate-600 dark:text-slate-300">{NAMES[t.ticker]}</span>
                      </div>
                    ))}
                    {result.previewTrades.length === 0 && <div className="text-sm text-slate-500">Keine Änderung – alle Positionen bleiben.</div>}
                    {params.topN - result.previewPicks.length > 0 && (
                      <div className="text-xs text-slate-500 pt-1">{params.topN - result.previewPicks.length} Slot(s) würden in Cash gehen (kein weiterer Wert mit positivem 12M‑1).</div>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700/60">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 font-semibold mb-1.5">Ranking heute (Top 6 von {result.previewRows.length})</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                      {result.previewRows.slice(0, 6).map(r => (
                        <div key={r.ticker} className={`flex items-center gap-2 text-xs ${r.eligible ? "" : "opacity-50"}`}>
                          <span className="w-4 text-right text-slate-400 tabular-nums">{r.rank}</span>
                          <TickerChip t={r.ticker} />
                          <span className="text-slate-500 tabular-nums">{r.points} P.</span>
                          <span className="ml-auto">12M‑1 <Pct v={r.p12} /></span>
                          {!r.eligible && <span className="text-[10px] text-slate-400">gefiltert</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Backtest */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Backtest {fmtDate(result.stats.start)} – {fmtDate(result.stats.end)}
                  <span className="font-normal text-slate-500 dark:text-slate-400"> · gleichgewichtet, Schlusskurse, ohne Kosten und Steuern · Benchmark S&P 500 (SPY, Buy &amp; Hold)</span>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
                <Stat label="Gesamtrendite" value={pct(result.stats.totalReturn)} sub={`SPY ${pct(result.stats.benchmarkReturn)}`} good={result.stats.totalReturn > result.stats.benchmarkReturn} />
                <Stat label="CAGR p.a." value={pct(result.stats.cagr)} sub={`SPY ${pct(result.stats.benchmarkCagr)}`} good={result.stats.cagr > result.stats.benchmarkCagr} />
                <Stat label="Max. Drawdown" value={pct(result.stats.maxDrawdown)} sub={`SPY ${pct(result.stats.benchmarkMaxDrawdown)}`} good={result.stats.maxDrawdown > result.stats.benchmarkMaxDrawdown} />
                <Stat label="Volatilität p.a." value={`${result.stats.volatility.toFixed(1)}%`} sub={`SPY ${result.stats.benchmarkVolatility.toFixed(1)}%`} good={result.stats.volatility < result.stats.benchmarkVolatility} />
                <Stat label="Trefferquote" value={`${result.stats.hitRate.toFixed(0)}%`} sub="Perioden im Plus" />
                <Stat label="Besser als SPY" value={`${result.stats.winVsBenchmark.toFixed(0)}%`} sub="der Perioden" good={result.stats.winVsBenchmark >= 50} />
                <Stat label="Trades" value={`${result.stats.trades}`} sub={`${result.stats.rebalances} Stichtage · Cash Ø ${result.stats.cashShare.toFixed(0)}%`} />
              </div>
              <div className="h-64 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={gridColor} strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: axisColor }} tickFormatter={(d: string) => d.slice(0, 7)} minTickGap={40} stroke={gridColor} />
                    <YAxis tick={{ fontSize: 10, fill: axisColor }} domain={["auto", "auto"]} width={40} stroke={gridColor} />
                    <Tooltip
                      contentStyle={{ background: dark ? "#0f172a" : "#fff", border: `1px solid ${gridColor}`, borderRadius: 8, fontSize: 12 }}
                      labelFormatter={(d) => fmtDate(String(d))}
                      formatter={(v: number) => [v.toFixed(1), ""]}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="Strategie" stroke="#d97706" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="S&P 500" stroke={dark ? "#94a3b8" : "#64748b"} strokeWidth={1.5} dot={false} strokeDasharray="4 3" isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Historie */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <button className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-900/40" onClick={() => setShowHistory(o => !o)}>
                Umschichtungs-Historie ({result.history.length} Stichtage)
                <ChevronDown size={14} className={`ml-auto transition-transform ${showHistory ? "rotate-180" : ""}`} />
              </button>
              {showHistory && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 border-t border-slate-200 dark:border-slate-700">
                        <th className="text-left px-4 py-2 font-semibold">Stichtag</th>
                        <th className="text-left px-3 py-2 font-semibold">Portfolio</th>
                        <th className="text-left px-3 py-2 font-semibold">Änderungen</th>
                        <th className="text-right px-3 py-2 font-semibold">Periode</th>
                        <th className="text-right px-4 py-2 font-semibold">SPY</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.history.map(h => (
                        <tr key={h.date} className="border-t border-slate-100 dark:border-slate-700/60">
                          <td className="px-4 py-2 tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">{fmtDate(h.date)}</td>
                          <td className="px-3 py-2"><div className="flex gap-1 flex-wrap">{h.picks.map(t => <TickerChip key={t} t={t} />)}{h.picks.length < params.topN && <span className="text-slate-400">+ Cash</span>}</div></td>
                          <td className="px-3 py-2 text-slate-500 dark:text-slate-400">
                            {h.trades.filter(t => t.action !== "hold").map(t => (
                              <span key={t.action + t.ticker} className={`mr-2 ${t.action === "buy" ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>{t.action === "buy" ? "+" : "−"}{t.ticker}</span>
                            ))}
                          </td>
                          <td className="px-3 py-2 text-right">{h.periodReturn === null ? <span className="text-slate-400">läuft</span> : <Pct v={h.periodReturn} />}</td>
                          <td className="px-4 py-2 text-right">{h.benchmarkReturn === null ? <span className="text-slate-400">–</span> : <Pct v={h.benchmarkReturn} />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Regeln */}
            <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900 rounded-xl px-5 py-4">
              <button className="flex items-center gap-2 w-full text-left" onClick={() => setShowRules(o => !o)}>
                <Info size={15} className="text-blue-500 flex-shrink-0" />
                <span className="text-sm font-semibold text-blue-700 dark:text-blue-400">Regelwerk &amp; Einordnung</span>
                <ChevronDown size={14} className={`ml-auto text-blue-400 transition-transform ${showRules ? "rotate-180" : ""}`} />
              </button>
              {showRules && (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-blue-700 dark:text-blue-400">
                  <div>
                    <p className="font-semibold mb-1">So entsteht das Portfolio</p>
                    <p className="text-blue-600 dark:text-blue-500">Am letzten Handelstag der Periode wird das 12‑1‑Ranking über die 23 ETFs gebildet (SPY ist selbst Kandidat – in Phasen, in denen die US-Megacaps alles dominieren, hält die Strategie so einfach den Index). Die drei bestplatzierten Werte mit positivem 12M‑1 werden zu je einem Drittel gekauft. Gibt es weniger als drei, bleibt der Rest in Cash (Dual Momentum nach Antonacci). Wer schon im Depot ist und weiter unter den Top 3 steht, bleibt – so entstehen nur die nötigen Trades.</p>
                  </div>
                  <div>
                    <p className="font-semibold mb-1">Kein gespeichertes Depot</p>
                    <p className="text-blue-600 dark:text-blue-500">Das Dashboard rechnet die Strategie jeden Tag komplett aus der Kurshistorie nach. Das „aktuelle Portfolio" ist also das, was die Regeln am letzten Stichtag ergeben hätten – unabhängig davon, was du tatsächlich im Depot hast. Die Vorschau zeigt, was beim nächsten Stichtag passieren würde, wenn das Ranking bis dahin so bleibt.</p>
                  </div>
                  <div>
                    <p className="font-semibold mb-1">Backtest ehrlich lesen</p>
                    <p className="text-blue-600 dark:text-blue-500">Der Backtest startet erst nach 12 Monaten Historie und umfasst rund neun Jahre, darunter die Rücksetzer 2018, 2020 und 2022. Ab 2023 haben US-Megacaps fast alles geschlagen – Sektor- und Länderrotation hat da systematisch das Nachsehen. Der Wert des Ansatzes liegt in Bärenmärkten (Cash-Filter) und in Rotationsphasen, nicht in Bullenmärkten eines einzelnen Index. Kosten, Spreads und Steuern fehlen. Keine Anlageberatung.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
