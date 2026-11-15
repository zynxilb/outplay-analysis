"use client";

import { useMemo } from "react";
import { Chess } from "chess.js";

export function TurnIndicator({ fen }: { fen: string }) {
  const turn = useMemo(() => {
    try {
      return new Chess(fen).turn();
    } catch {
      return "w" as const;
    }
  }, [fen]);

  const isWhite = turn === "w";

  return (
    <div className="flex justify-center">
      <div
        className="inline-flex items-center gap-2 bg-[#16171B] border border-[#1F2229] px-3 py-1.5 rounded text-sm"
        aria-live="polite"
      >
        <span className="text-[#8B8F98]">الدور:</span>
        <span className="text-[#EEEEEE] font-semibold">
          {isWhite ? "♔ أبيض" : "♚ أسود"}
        </span>
      </div>
    </div>
  );
}
