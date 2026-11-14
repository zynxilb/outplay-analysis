"use client";

import { useEffect, useState } from "react";
import { analyzeGame } from "@/lib/analysis/pipeline";
import type { AnalysisConfig } from "@/lib/analysis/core/types";

const OPERA_PGN = `[Event "Paris Opera"]
[White "Morphy"]
[Black "Duke Karl"]

1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5 10.Nxb5 cxb5 11.Bxb5+ Nbd7 12.O-O-O Rd8 13.Rxd7 Rxd7 14.Rd1 Qe6 15.Bxd7+ Nxd7 16.Qb8+ Nxb8 17.Rd8# 1-0`;

const CONFIG: AnalysisConfig = {
  version: "stage4-day4",
  engine: { identity: "sf-19.0.1-lite-single", hashMb: 32, multiPv: 1 },
  budgets: {
    initialDepth: 10, refinementDepth: 14, finalDepth: 18,
    initialTargetMs: 300, reSearchMs: 300,
  },
  evaluation: {
    epCoefficient: 0.00368208,
    mateOrderingValue: 10000,
    evaluationModelVersion: "ep-v1",
  },
  classification: {
    epLossThresholds: {
      Best: 0, Excellent: 0.01, Good: 0.03,
      Inaccuracy: 0.05, Mistake: 0.10, Blunder: 0.15,
    },
    cpLossSecondaryThreshold: 200,
    brilliantSeeThreshold: 300,
    missExpectedGainThreshold: 0.10,
    mateDistanceTiers: { excellent: 1, good: 3, inaccuracy: 6, mistake: 10 },
  },
  motifs: {
    enabled: ["fork", "pin", "skewer", "discovered", "removing_defender"],
    precisionTargets: { fork: 0.95, pin: 0.90, skewer: 0.90, discovered: 0.90, removing_defender: 0.85 },
  },
  explanation: { secondaryContributionRatio: 0.25 },
};

export default function PipelineTestPage() {
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const log = (s: string) => setLogs((prev) => [...prev, s]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setPhase("running");
        log(`Budget: movetime ${CONFIG.budgets.initialTargetMs}ms`);

        const t0 = performance.now();
        const result = await analyzeGame(OPERA_PGN, CONFIG);
        const t1 = performance.now();
        const totalMs = t1 - t0;
        if (cancelled) return;

        const lastMove = result.moves[result.moves.length - 1];
        const summary = {
          status: result.status,
          moveCount: result.moves.length,
          firstMoveSan: result.moves[0]?.san ?? null,
          firstMoveQuality: result.moves[0]?.quality ?? null,
          lastMoveSan: lastMove?.san ?? null,
          lastMoveQuality: lastMove?.quality ?? null,
          failuresCount: result.failures.length,
          failures: result.failures.slice(0, 5),
          rootsCount: result.roots.size,
          pvsCount: result.pvs.size,
          explanationsCount: result.explanations.size,
          refutationsCount: result.refutations.size,
          totalMs,
          config: {
            engineIdentity: CONFIG.engine.identity,
            budgetMs: CONFIG.budgets.initialTargetMs,
          },
        };

        (window as any).__PIPELINE_RESULT__ = summary;
        log(`Done in ${totalMs.toFixed(0)}ms — status=${result.status}, moves=${result.moves.length}`);
        setPhase("done");
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        (window as any).__PIPELINE_RESULT__ = { error: msg };
        setPhase("error");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="min-h-screen p-6 bg-[#0D0E11] text-[#EEEEEE]" style={{ fontFamily: "monospace", direction: "ltr" }}>
      <div className="max-w-4xl mx-auto space-y-4">
        <h1 className="text-2xl font-bold">Pipeline Integration Test</h1>
        <p>Phase: <span data-testid="phase">{phase}</span></p>
        {error && <div className="p-3 border border-red-500 text-red-300">ERROR: {error}</div>}
        {logs.length > 0 && (
          <details open className="border border-[#1F2229] p-3">
            <summary>Logs ({logs.length})</summary>
            <pre className="text-xs mt-2 whitespace-pre-wrap">{logs.join("\n")}</pre>
          </details>
        )}
        <div id="pipeline-result" data-phase={phase} style={{ display: "none" }}>
          {phase === "done" ? "READY" : phase === "error" ? "ERROR" : "WAITING"}
        </div>
      </div>
    </main>
  );
}
