"use client";

import { useEffect, useState } from "react";

const OPERA_GAME_PGNS = [
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
  "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2",
  "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2",
  "rnbqkbnr/ppp2ppp/3p4/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3",
  "rnbqkbnr/ppp2ppp/3p4/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq d3 0 3",
  "rnbqkbnr/ppp2ppp/3p4/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq d3 0 3",
];

type BenchResult = {
  name: string;
  fen: string;
  status: "pending" | "ok" | "error";
  elapsedMs?: number;
  depth?: number;
  nodes?: number;
  bestmove?: string;
  pvLen?: number;
  error?: string;
};

type Stats = {
  coldStartMs: number | null;
  firstSearchMs: number | null;
  warmSearchMs: number[];
  p50: number | null;
  p95: number | null;
  max: number | null;
};

const STRESS_POSITIONS = [
  {
    name: "startpos",
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  },
  {
    name: "italian-mid",
    fen: "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3",
  },
  {
    name: "kiwipete",
    fen: "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
  },
  {
    name: "endgame-kp",
    fen: "8/8/8/8/8/4k3/4p3/4K3 w - - 0 1",
  },
  {
    name: "mate-in-2",
    fen: "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
  },
];

export default function EngineBenchmarkPage() {
  const [results, setResults] = useState<BenchResult[]>([]);
  const [stats, setStats] = useState<Stats>({
    coldStartMs: null,
    firstSearchMs: null,
    warmSearchMs: [],
    p50: null,
    p95: null,
    max: null,
  });
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [overallError, setOverallError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const log = (s: string) => setLogs((prev) => [...prev, s]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setPhase("running");
        log("Starting benchmark");

        const workerUrl = "/engine/stockfish-19-lite-single.js";

        // ── Cold start ──
        const coldStartTime = performance.now();
        const worker = new Worker(workerUrl);
        log("Worker created");

        const initPromise = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("init timeout")), 15000);
          let uciOk = false;
          worker.onmessage = (ev) => {
            const data = (ev.data as string).trim();
            if (data === "uciok" && !uciOk) {
              uciOk = true;
              worker.postMessage("setoption name Hash value 32");
              worker.postMessage("setoption name MultiPV value 1");
              worker.postMessage("isready");
            } else if (data === "readyok") {
              clearTimeout(timeout);
              resolve();
            }
          };
          worker.onerror = (ev) => {
            clearTimeout(timeout);
            reject(new Error("worker error: " + (ev.message ?? "unknown")));
          };
          worker.postMessage("uci");
        });

        await initPromise;
        const coldStartMs = performance.now() - coldStartTime;
        log(`Cold start: ${coldStartMs.toFixed(0)}ms`);
        if (cancelled) return;

        // ── Search runner ──
        const runSearch = async (fen: string, name: string): Promise<BenchResult> => {
          const start = performance.now();
          return new Promise<BenchResult>((resolve) => {
            const timeout = setTimeout(() => {
              worker.postMessage("stop");
              resolve({ name, fen, status: "error", error: "search timeout" });
            }, 20000);

            let bestmove: string | null = null;
            let finalDepth = 0;
            let finalNodes = 0;
            let pvLen = 0;

            const onMsg = (ev: MessageEvent) => {
              const data = (ev.data as string).trim();
              if (data.startsWith("info") && data.includes(" pv ")) {
                const depthM = data.match(/\bdepth (\d+)/);
                if (depthM) finalDepth = parseInt(depthM[1], 10);
                const nodesM = data.match(/\bnodes (\d+)/);
                if (nodesM) finalNodes = parseInt(nodesM[1], 10);
                const pvM = data.match(/\bpv (.+)$/);
                if (pvM) pvLen = pvM[1].split(/\s+/).length;
              } else if (data.startsWith("bestmove")) {
                bestmove = data.split(/\s+/)[1] ?? null;
              }
            };

            const checkDone = () => {
              if (bestmove) {
                clearTimeout(timeout);
                worker.removeEventListener("message", onMsg);
                const elapsed = performance.now() - start;
                resolve({
                  name, fen, status: "ok",
                  elapsedMs: elapsed,
                  depth: finalDepth,
                  nodes: finalNodes,
                  bestmove: bestmove ?? undefined,
                  pvLen,
                });
              } else {
                setTimeout(checkDone, 50);
              }
            };

            worker.addEventListener("message", onMsg);
            worker.postMessage(`position fen ${fen}`);
            worker.postMessage("go movetime 300");
            checkDone();
          });
        };

        // ── First search (startpos) ──
        const first = await runSearch(STRESS_POSITIONS[0].fen, "first:" + STRESS_POSITIONS[0].name);
        log(`First search: ${first.elapsedMs?.toFixed(0)}ms`);
        if (cancelled) { worker.terminate(); return; }

        // ── Warm searches ──
        const warmResults: BenchResult[] = [first];
        const warmTimes: number[] = [];
        for (const pos of STRESS_POSITIONS.slice(1)) {
          const r = await runSearch(pos.fen, pos.name);
          warmResults.push(r);
          if (r.status === "ok" && r.elapsedMs) warmTimes.push(r.elapsedMs);
          log(`${pos.name}: ${r.elapsedMs?.toFixed(0)}ms d${r.depth}`);
          if (cancelled) { worker.terminate(); return; }
        }

        // ── Opera Game full analysis ──
        log("Opera Game analysis...");
        const operaTimes: number[] = [];
        const operaResults: BenchResult[] = [];
        for (let i = 0; i < OPERA_GAME_PGNS.length; i++) {
          const r = await runSearch(OPERA_GAME_PGNS[i], `opera-${i}`);
          operaResults.push(r);
          if (r.status === "ok" && r.elapsedMs) operaTimes.push(r.elapsedMs);
          if (cancelled) { worker.terminate(); return; }
        }

        // ── Stats ──
        const sorted = [...warmTimes].sort((a, b) => a - b);
        const p50 = sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : null;
        const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : null;
        const max = sorted.length ? sorted[sorted.length - 1] : null;

        const finalStats: Stats = {
          coldStartMs,
          firstSearchMs: first.elapsedMs ?? null,
          warmSearchMs: warmTimes,
          p50, p95, max,
        };

        setStats(finalStats);
        setResults([...warmResults, ...operaResults]);
        setPhase("done");
        log("Done");

        // Expose for Playwright
        (window as any).__BENCHMARK_RESULTS__ = {
          stats: finalStats,
          results: [...warmResults, ...operaResults],
          operaTotalMs: operaTimes.reduce((a, b) => a + b, 0),
          operaAvgMs: operaTimes.length ? operaTimes.reduce((a, b) => a + b, 0) / operaTimes.length : null,
          workerUrl,
        };

        worker.terminate();
      } catch (e) {
        if (cancelled) return;
        setOverallError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen p-6 bg-[#0D0E11] text-[#EEEEEE]" style={{ fontFamily: "var(--font-jetbrains-mono)", direction: "ltr" }}>
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Engine Benchmark</h1>
          <p className="text-sm text-[#8B8F98]">Phase: <span data-testid="phase">{phase}</span></p>
        </div>

        {overallError && (
          <div className="border border-red-500 bg-red-950 p-3 text-red-300">
            <strong>Error:</strong> {overallError}
          </div>
        )}

        {stats.coldStartMs !== null && (
          <div className="border border-[#1F2229] bg-[#16171B] p-4 space-y-2">
            <h2 className="text-lg font-semibold">Summary</h2>
            <table className="w-full text-sm">
              <tbody>
                <tr><td className="text-[#8B8F98] w-48">Cold start:</td><td>{stats.coldStartMs.toFixed(0)} ms</td></tr>
                <tr><td className="text-[#8B8F98]">First search:</td><td>{stats.firstSearchMs?.toFixed(0)} ms</td></tr>
                <tr><td className="text-[#8B8F98]">Warm p50:</td><td>{stats.p50?.toFixed(0)} ms</td></tr>
                <tr><td className="text-[#8B8F98]">Warm p95:</td><td>{stats.p95?.toFixed(0)} ms</td></tr>
                <tr><td className="text-[#8B8F98]">Warm max:</td><td>{stats.max?.toFixed(0)} ms</td></tr>
              </tbody>
            </table>
          </div>
        )}

        {results.length > 0 && (
          <div className="border border-[#1F2229] bg-[#16171B] p-4">
            <h2 className="text-lg font-semibold mb-2">Searches ({results.length})</h2>
            <table className="w-full text-xs">
              <thead className="text-[#8B8F98]">
                <tr>
                  <th className="text-left">name</th>
                  <th className="text-right">ms</th>
                  <th className="text-right">depth</th>
                  <th className="text-right">nodes</th>
                  <th className="text-left">best</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className="border-t border-[#1F2229]">
                    <td>{r.name}</td>
                    <td className="text-right">{r.elapsedMs?.toFixed(0) ?? "-"}</td>
                    <td className="text-right">{r.depth ?? "-"}</td>
                    <td className="text-right">{r.nodes ?? "-"}</td>
                    <td>{r.bestmove ?? r.error ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {logs.length > 0 && (
          <details className="border border-[#1F2229] bg-[#16171B] p-3">
            <summary className="cursor-pointer text-sm text-[#8B8F98]">Logs ({logs.length})</summary>
            <pre className="text-xs mt-2 whitespace-pre-wrap">{logs.join("\n")}</pre>
          </details>
        )}

        <div id="benchmark-results" data-phase={phase} style={{ display: "none" }}>
          {phase === "done" ? "READY" : "WAITING"}
        </div>
      </div>
    </main>
  );
}
