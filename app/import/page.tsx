"use client";

import { useCallback, useRef, useState } from "react";
import { analyzeGame } from "@/lib/analysis/pipeline";
import { StockfishAdapter } from "@/lib/analysis/engine/stockfish";
import type { AnalyzedGame } from "@/lib/analysis/core/types";
import { ANALYSIS_CONFIG } from "./config";
import { ImportView } from "@/components/analyze/ImportView";
import { AnalyzingView } from "@/components/analyze/AnalyzingView";
import { AnalysisViewPro } from "@/components/analyze/pro/AnalysisViewPro";

type Phase =
  | { kind: "import" }
  | { kind: "analyzing"; pgn: string; startedAt: number }
  | { kind: "review"; game: AnalyzedGame; pgn: string }
  | { kind: "error"; message: string };

export default function AnalyzePage() {
  const [phase, setPhase] = useState<Phase>({ kind: "import" });
  const controllerRef = useRef<AbortController | null>(null);

  const startAnalysis = useCallback(async (pgn: string) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setPhase({ kind: "analyzing", pgn, startedAt: Date.now() });

    const engine = new StockfishAdapter();
    try {
      await engine.initialize(ANALYSIS_CONFIG.engine);

      const game = await analyzeGame(pgn, ANALYSIS_CONFIG, {
        engine,
        signal: controller.signal,
      });

      // If a newer analysis replaced this one, drop the result silently.
      if (controllerRef.current !== controller) return;

      // Cancelled mid-run (pipeline returns partial rather than throwing).
      if (controller.signal.aborted) {
        setPhase({ kind: "import" });
        return;
      }

      // PGN parse failure: analyzeGame returns partial with moves: [].
      if (game.moves.length === 0) {
        const parseFail = game.failures.find((f) => f.stage === "pgn_parse");
        if (parseFail) {
          setPhase({
            kind: "error",
            message:
              "تعذّر تحليل المباراة. تأكد من صحة صيغة PGN وحاول مرة أخرى.",
          });
          return;
        }
        setPhase({
          kind: "error",
          message: "لا توجد نقلات قابلة للتحليل في هذه المباراة.",
        });
        return;
      }

      setPhase({ kind: "review", game, pgn });
    } catch (err) {
      if (controllerRef.current !== controller) return;
      if (
        err instanceof Error &&
        (err.name === "AbortError" || /abort/i.test(err.message))
      ) {
        setPhase({ kind: "import" });
      } else {
        setPhase({
          kind: "error",
          message:
            err instanceof Error
              ? `حدث خطأ أثناء التحليل: ${err.message}`
              : "حدث خطأ غير متوقع أثناء التحليل.",
        });
      }
    } finally {
      try {
        await engine.dispose();
      } catch {
        // Engine already gone — swallow.
      }
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  }, []);

  const cancelAnalysis = useCallback(() => {
    controllerRef.current?.abort();
    setPhase({ kind: "import" });
  }, []);

  const reset = useCallback(() => {
    setPhase({ kind: "import" });
  }, []);

  return (
    <main className="min-h-screen p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        {phase.kind === "import" && <ImportView onAnalyze={startAnalysis} />}

        {phase.kind === "analyzing" && (
          <AnalyzingView
            startedAt={phase.startedAt}
            onCancel={cancelAnalysis}
          />
        )}

        {phase.kind === "review" && (
          <AnalysisViewPro game={phase.game} pgn={phase.pgn} onReset={reset} />
        )}

        {phase.kind === "error" && (
          <div className="max-w-md mx-auto text-center space-y-4 pt-20">
            <h2 className="text-xl font-bold text-[#D84040]">
              حدث خطأ
            </h2>
            <p className="text-sm text-[#C5C7CC]">{phase.message}</p>
            <button
              onClick={reset}
              className="bg-[#D84040] hover:bg-[#B83535] text-white px-5 py-2 font-semibold transition-colors"
            >
              حاول مرة أخرى
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
