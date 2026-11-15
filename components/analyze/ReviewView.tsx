"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Chess } from "chess.js";
import type { AnalyzedGame } from "@/lib/analysis/core/types";
import { replayPgn } from "@/lib/analysis/pgn-replay";
import { ChessBoard } from "./ChessBoard";
import { MoveList } from "./MoveList";
import { ExplanationPanel } from "./ExplanationPanel";
import { RefutationPanel } from "./RefutationPanel";
import { TurnIndicator } from "./TurnIndicator";
import { QualityBreakdown } from "./QualityBreakdown";

type ViewMode = "played" | "alternative";

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
  const [viewMode, setViewMode] = useState<ViewMode>("played");
  const [altPly, setAltPly] = useState(0);

  // Reset alternative view whenever the selected played move changes.
  useEffect(() => {
    setViewMode("played");
    setAltPly(0);
  }, [selectedPly]);

  const playedFen =
    positions[selectedPly]?.fen ??
    positions[0]?.fen ??
    "8/8/8/8/8/8/8/8 w - - 0 1";

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

  // FENs for the alternative line, starting from the pre-move position.
  // altFens[i] = position after applying refutation.moves[0..i].
  const altFens = useMemo(() => {
    if (!refutation || selectedPly === 0) return [];
    const startFen = positions[selectedPly - 1]?.fen;
    if (!startFen) return [];
    const fens: string[] = [];
    try {
      const chess = new Chess(startFen);
      for (const mv of refutation.moves) {
        const played = chess.move({
          from: mv.uci.slice(0, 2),
          to: mv.uci.slice(2, 4),
          promotion: mv.uci.slice(4, 5) || undefined,
        });
        if (!played) break;
        fens.push(chess.fen());
      }
    } catch {
      return [];
    }
    return fens;
  }, [refutation, selectedPly, positions]);

  const showAlt = viewMode === "alternative" && altFens.length > 0;
  const boardFen = showAlt ? altFens[altPly] : playedFen;

  const goPrev = useCallback(() => {
    if (showAlt) {
      setAltPly((p) => Math.max(0, p - 1));
    } else {
      setSelectedPly((p) => Math.max(0, p - 1));
    }
  }, [showAlt]);

  const goNext = useCallback(() => {
    if (showAlt) {
      setAltPly((p) => Math.min(altFens.length - 1, p + 1));
    } else {
      setSelectedPly((p) => Math.min(maxPly, p + 1));
    }
  }, [showAlt, altFens.length, maxPly]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goPrev, goNext]);

  const exitAlt = useCallback(() => {
    setViewMode("played");
    setAltPly(0);
  }, []);

  const enterAlt = useCallback(() => {
    if (altFens.length > 0) {
      setViewMode("alternative");
      setAltPly(0);
    }
  }, [altFens.length]);

  const failures = game.failures.length;
  const incomplete = game.status !== "complete";

  const prevDisabled = showAlt ? altPly === 0 : selectedPly === 0;
  const nextDisabled = showAlt
    ? altPly === altFens.length - 1
    : selectedPly === maxPly;

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

      <QualityBreakdown moves={game.moves} />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4">
        <div className="space-y-3">
          {showAlt && (
            <div className="bg-[#7FB069]/10 border border-[#7FB069]/30 text-[#7FB069] text-sm px-3 py-2 rounded flex items-center justify-between flex-wrap gap-2">
              <span>أنت تشاهد الخط البديل — ليس المباراة الأصلية.</span>
              <button
                onClick={exitAlt}
                className="underline text-xs hover:text-[#EEEEEE] transition-colors"
              >
                عودة للمباراة
              </button>
            </div>
          )}

          <ChessBoard fen={boardFen} />
          <TurnIndicator fen={boardFen} />

          <div className="flex justify-center gap-2">
            <button
              onClick={goPrev}
              disabled={prevDisabled}
              className="px-4 py-2 bg-[#16171B] border border-[#1F2229] text-[#EEEEEE] hover:bg-[#1F2229] disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm"
            >
              ← السابق
            </button>
            <button
              onClick={goNext}
              disabled={nextDisabled}
              className="px-4 py-2 bg-[#16171B] border border-[#1F2229] text-[#EEEEEE] hover:bg-[#1F2229] disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm"
            >
              التالي →
            </button>
          </div>

          <p
            className="text-center text-xs text-[#6D6D75] font-mono"
            dir="ltr"
          >
            {showAlt
              ? `alt ${altPly + 1}/${altFens.length}`
              : `${selectedPly} / ${maxPly}`}
          </p>
        </div>

        <aside className="space-y-3 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
          <ExplanationPanel
            ply={selectedPly}
            san={playedSan}
            localized={localized}
          />
          <RefutationPanel
            ply={selectedPly}
            refutation={refutation}
            onViewAlternative={enterAlt}
            canViewAlternative={altFens.length > 0}
          />
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
