"use client";

import { useEffect, useState } from "react";
import { Chess } from "chess.js";
import { StockfishAdapter } from "@/lib/analysis/engine/stockfish";
import type { AnalysisConfig, SearchBudget } from "@/lib/analysis/core/types";

// Morphy's Opera Game, Paris 1858
const OPERA_PGN = `1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5 10.Nxb5 cxb5 11.Bxb5+ Nbd7 12.O-O-O Rd8 13.Rxd7 Rxd7 14.Rd1 Qe6 15.Bxd7+ Nxd7 16.Qb8+ Nxb8 17.Rd8#`;

const SEARCH_BUDGET: SearchBudget = { kind: "movetime", value: 300 };

const BENCH_CONFIG: AnalysisConfig = {
  version: "bench-v1",
  engine: { identity: "sf-19.0.1-lite-single", hashMb: 32, multiPv: 1 },
  budgets: {
    initialDepth: 10, refinementDepth: 14, finalDepth: 18,
    initialTargetMs: 500, reSearchMs: 300,
  },
  evaluation: {
    epCoefficient: 0.00368208,
    mateOrderingValue: 10000,
    evaluationModelVersion: "ep-v1",
  },
  classification: {
    epLossThresholds: {
      Best: 0, Excellent: 0.01, Good: 0.03, Inaccuracy: 0.05,
      Mistake: 0.10, Blunder: 0.15,
    },
    cpLossSecondaryThreshold: 200,
    brilliantSeeThreshold: 300,
    missExpectedGainThreshold: 0.10,
    mateDistanceTiers: { excellent: 1, good: 3, inaccuracy: 6, mistake: 10 },
  },
  motifs: {
    enabled: ["fork", "pin", "skewer", "discovered", "removing_defender"],
    precisionTargets: {
      fork: 0.95,
      pin: 0.90,
      skewer: 0.90,
      discovered: 0.90,
      removing_defender: 0.85,
    },
  },
  explanation: { secondaryContributionRatio: 0.25 },
};

type PositionResult = {
  ply: number;
  fen: string;
  san: string;
  elapsedMs: number;
  depth: number;
  bestmove: string;
  stability: string;
  scoreValue: string;
};

type Summary = {
  totalPositions: number;
  totalMs: number;
  avgMs: number;
  coldStartMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  minMs: number;
  errorCount: number;
};

function buildPositionsFromPgn(pgn: string): Array<{ fen: string; san: string; ply: number }> {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });

  const result: Array<{ fen: string; san: string; ply: number }> = [];
  const replay = new Chess();
  result.push({ fen: replay.fen(), san: "(start)", ply: 0 });
  for (let i = 0; i < history.length; i++) {
    replay.move(history[i].san);
    result.push({ fen: replay.fen(), san: history[i].san, ply: i + 1 });
  }
  return result;
}

function computeSummary(results: PositionResult[], coldStartMs: number): Summary {
  const times = results.map((r) => r.elapsedMs).sort((a, b) => a - b);
  const n = times.length;
  const total = times.reduce((a, b) => a + b, 0);
  return {
    totalPositions: n,
    totalMs: total,
    avgMs: n ? total / n : 0,
    coldStartMs,
    minMs: n ? times[0] : 0,
    maxMs: n ? times[n - 1] : 0,
    p50Ms: n ? times[Math.floor(n * 0.5)] : 0,
    p95Ms: n ? times[Math.min(n - 1, Math.floor(n * 0.95))] : 0,
    errorCount: 0,
  };
}

export default function EngineBenchmarkPage() {
  const [results, setResults] = useState<PositionResult[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });

  const log = (s: string) => setLogs((prev) => [...prev, s]);

  useEffect(() => {
    let cancelled = false;
    let adapter: StockfishAdapter | null = null;

    (async () => {
      try {
        setPhase("running");
        log("Building positions from Opera Game PGN...");

        const positions = buildPositionsFromPgn(OPERA_PGN);
        log(`${positions.length} board states (initial + ${positions.length - 1} plies)`);
        setProgress({ done: 0, total: positions.length });

        log("Initializing StockfishAdapter...");
        const coldStart = performance.now();
        adapter = new StockfishAdapter({
          workerUrl: "/engine/stockfish-19-lite-single.js",
          initTimeoutMs: 15000,
          searchTimeoutMs: 30000,
        });
        await adapter.initialize(BENCH_CONFIG.engine);
        const coldStartMs = performance.now() - coldStart;
        log(`Cold start: ${coldStartMs.toFixed(0)}ms`);

        if (cancelled) return;

        const collected: PositionResult[] = [];
        let errorCount = 0;

        for (let i = 0; i < positions.length; i++) {
          if (cancelled) return;
          const pos = positions[i];
          setProgress({ done: i, total: positions.length });

          try {
            const start = performance.now();
            const { root, pv } = await adapter.search(pos.fen, "find-best-move", SEARCH_BUDGET);
            const elapsed = performance.now() - start;

            let scoreValue = "unknown";
            if (pv.rootEval.type === "cp") scoreValue = `cp ${pv.rootEval.value}`;
            else if (pv.rootEval.type === "mate") scoreValue = `mate ${pv.rootEval.in} (${pv.rootEval.winner})`;

            collected.push({
              ply: pos.ply,
              fen: pos.fen,
              san: pos.san,
              elapsedMs: elapsed,
              depth: pv.depth,
              bestmove: pv.moves[0]?.san ?? "(none)",
              stability: pv.stability,
              scoreValue,
            });
            log(`[${i + 1}/${positions.length}] ply ${pos.ply} (${pos.san}): ${elapsed.toFixed(0)}ms, d${pv.depth}`);
          } catch (e) {
            errorCount++;
            log(`[${i + 1}/${positions.length}] ERROR: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        setProgress({ done: positions.length, total: positions.length });
        const sum = computeSummary(collected, coldStartMs);
        sum.errorCount = errorCount;
        setResults(collected);
        setSummary(sum);
        setPhase("done");

        // Expose for Playwright
        (window as any).__BENCHMARK_RESULTS__ = {
          summary: sum,
          results: collected,
          workerUrl: "/engine/stockfish-19-lite-single.js",
          budget: SEARCH_BUDGET,
          source: "Opera Game (Morphy 1858), 34 board states via chess.js PGN parse, StockfishAdapter",
        };
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      } finally {
        if (adapter) {
          try { await adapter.dispose(); } catch {}
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main
      className="min-h-screen p-6 bg-[#0D0E11] text-[#EEEEEE]"
      style={{ fontFamily: "var(--font-jetbrains-mono)", direction: "ltr" }}
    >
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Engine Benchmark — Opera Game</h1>
          <p className="text-sm text-[#8B8F98]">
            Phase: <span data-testid="phase">{phase}</span>
            {progress.total > 0 && (
              <span className="ml-4">
                Progress: {progress.done}/{progress.total}
              </span>
            )}
          </p>
        </div>

        {error && (
          <div className="border border-red-500 bg-red-950 p-3 text-red-300">
            <strong>Error:</strong> {error}
          </div>
        )}

        {summary && (
          <div className="border border-[#1F2229] bg-[#16171B] p-4 space-y-2">
            <h2 className="text-lg font-semibold">Summary — {summary.totalPositions} board states</h2>
            <table className="w-full text-sm">
              <tbody>
                <tr><td className="text-[#8B8F98] w-56">Cold start:</td><td>{summary.coldStartMs.toFixed(0)} ms</td></tr>
                <tr><td className="text-[#8B8F98]">Total analysis time:</td><td>{summary.totalMs.toFixed(0)} ms ({summary.totalPositions} positions)</td></tr>
                <tr><td className="text-[#8B8F98]">Average per position:</td><td>{summary.avgMs.toFixed(0)} ms</td></tr>
                <tr><td className="text-[#8B8F98]">p50 / p95 / max:</td><td>{summary.p50Ms.toFixed(0)} / {summary.p95Ms.toFixed(0)} / {summary.maxMs.toFixed(0)} ms</td></tr>
                <tr><td className="text-[#8B8F98]">Min:</td><td>{summary.minMs.toFixed(0)} ms</td></tr>
                <tr><td className="text-[#8B8F98]">Errors:</td><td>{summary.errorCount}</td></tr>
              </tbody>
            </table>
          </div>
        )}

        {results.length > 0 && (
          <div className="border border-[#1F2229] bg-[#16171B] p-4">
            <h2 className="text-lg font-semibold mb-2">Positions ({results.length})</h2>
            <table className="w-full text-xs">
              <thead className="text-[#8B8F98]">
                <tr>
                  <th className="text-left">ply</th>
                  <th className="text-left">san</th>
                  <th className="text-right">ms</th>
                  <th className="text-right">depth</th>
                  <th className="text-left">best</th>
                  <th className="text-left">score</th>
                  <th className="text-left">stability</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className="border-t border-[#1F2229]">
                    <td>{r.ply}</td>
                    <td>{r.san}</td>
                    <td className="text-right">{r.elapsedMs.toFixed(0)}</td>
                    <td className="text-right">{r.depth}</td>
                    <td>{r.bestmove}</td>
                    <td>{r.scoreValue}</td>
                    <td>{r.stability}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {logs.length > 0 && (
          <details className="border border-[#1F2229] bg-[#16171B] p-3">
            <summary className="cursor-pointer text-sm text-[#8B8F98]">Logs ({logs.length})</summary>
            <pre className="text-xs mt-2 whitespace-pre-wrap max-h-96 overflow-y-auto">
              {logs.join("\n")}
            </pre>
          </details>
        )}

        <div id="benchmark-results" data-phase={phase} style={{ display: "none" }}>
          {phase === "done" ? "READY" : "WAITING"}
        </div>
      </div>
    </main>
  );
}
