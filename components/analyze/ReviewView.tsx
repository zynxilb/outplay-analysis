"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AnalyzedGame } from "@/lib/analysis/core/types";
import { replayPgn } from "@/lib/analysis/pgn-replay";
import { ChessBoard } from "./ChessBoard";
import { MoveList } from "./MoveList";
import { ExplanationPanel } from "./ExplanationPanel";
import { RefutationPanel } from "./RefutationPanel";

export function ReviewView({
  game,
  pgn,
  onReset,
}: {
  game: AnalyzedGame;
  pgn: string;
  onReset: () => void;
}) {
  const positions = useMemo(() => {
    try {
      return replayPgn(pgn).positions;
    } catch {
      return [] as { ply: number; fen: string }[];
    }
  }, [pgn]);

  const maxPly = game.moves.length;
  const [selectedPly, setSelectedPly] = useState(maxPly);

  const fen =
    positions[selectedPly]?.fen ?? positions[0]?.fen ?? "8/8/8/8/8/8/8/8 w - - 0 1";

  const playedSan =
    selectedPly > 0
      ? game.moves.find((m) => m.ply === selectedPly)?.san ?? null
      : null;

  const localized =
    selectedPly > 0
      ? game.localizedExplanations.get(selectedPly)
      : undefined;

  const refutation =
    selectedPly > 0 ? game.refutations.get(selectedPly) : undefined;

  const goPrev = useCallback(
    () => setSelectedPly((p) => Math.max(0, p - 1)),
    [],
  );
  const goNext = useCallback(
    () => setSelectedPly((p) => Math.min(maxPly, p + 1)),
    [maxPly],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goPrev, goNext]);

  const failures = game.failures.length;
  const incomplete = game.status !== "complete";

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-[#EEEEEE]">
            {incomplete ? "تحليل جزئي" : "اكتمل التحليل"}
          </h1>
          <p className="text-xs text-[#8B8F98]">
            {maxPly} نقلة
            {failures > 0 ? ` · ${failures} حالة فشل` : ""}
            {game.explanations.size > 0
              ? ` · ${game.explanations.size} شرح`
              : ""}
            {game.refutations.size > 0
              ? ` · ${game.refutations.size} بديل`
              : ""}
          </p>
        </div>
        <button
          onClick={onReset}
          className="text-sm text-[#8B8F98] hover:text-[#EEEEEE] underline transition-colors"
        >
          مباراة جديدة
        </button>
      </header>

      {incomplete && (
        <div className="bg-[#E0B252]/10 border border-[#E0B252]/30 text-[#E0B252] text-sm px-3 py-2 rounded">
          بعض النقلات لم تُحلَّل. النتائج الظاهرة مبنية على ما اكتمل فقط.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4">
        <div className="space-y-3">
          <ChessBoard fen={fen} />

          <div className="flex justify-center gap-2">
            <button
              onClick={goPrev}
              disabled={selectedPly === 0}
              className="px-4 py-2 bg-[#16171B] border border-[#1F2229] text-[#EEEEEE] hover:bg-[#1F2229] disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm"
            >
              ← السابق
            </button>
            <button
              onClick={goNext}
              disabled={selectedPly === maxPly}
              className="px-4 py-2 bg-[#16171B] border border-[#1F2229] text-[#EEEEEE] hover:bg-[#1F2229] disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm"
            >
              التالي →
            </button>
          </div>

          <p className="text-center text-xs text-[#6D6D75] font-mono" dir="ltr">
            {selectedPly} / {maxPly}
          </p>
        </div>

        <aside className="space-y-3 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
          <ExplanationPanel ply={selectedPly} san={playedSan} localized={localized} />
          <RefutationPanel ply={selectedPly} refutation={refutation} />
          <MoveList
            moves={game.moves}
            selectedPly={selectedPly}
            onSelect={setSelectedPly}
          />
        </aside>
      </div>
    </div>
  );
}
