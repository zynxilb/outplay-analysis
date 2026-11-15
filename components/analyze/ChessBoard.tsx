"use client";

import { useMemo } from "react";
import { Chess } from "chess.js";

const LIGHT = "#EBECD0";
const DARK = "#739552";

const PIECE_GLYPHS: Record<string, string> = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

type Cell = { square: string; type: string; color: "w" | "b" } | null;

function parseBoard(fen: string): Cell[][] {
  try {
    return new Chess(fen).board() as Cell[][];
  } catch {
    return Array.from({ length: 8 }, () => Array(8).fill(null));
  }
}

export function ChessBoard({ fen }: { fen: string }) {
  const board = useMemo(() => parseBoard(fen), [fen]);

  return (
    <div className="aspect-square w-full max-w-[560px] mx-auto border border-[#1F2229] overflow-hidden select-none">
      <div className="grid grid-cols-8 grid-rows-8 w-full h-full">
        {board.flatMap((row, rIdx) =>
          row.map((cell, cIdx) => {
            const isLight = (rIdx + cIdx) % 2 === 0;
            return (
              <div
                key={`${rIdx}-${cIdx}`}
                className="flex items-center justify-center"
                style={{ backgroundColor: isLight ? LIGHT : DARK }}
              >
                {cell && (
                  <span
                    className="leading-none"
                    style={{
                      fontSize: "clamp(20px, 6vw, 48px)",
                      color: cell.color === "w" ? "#FFFFFF" : "#1A1A1A",
                      textShadow:
                        cell.color === "w"
                          ? "0 0 1px #1A1A1A"
                          : "0 0 1px #FFFFFF",
                      fontFamily:
                        "'Segoe UI Symbol', 'Apple Symbols', 'Noto Sans Symbols 2', sans-serif",
                    }}
                  >
                    {PIECE_GLYPHS[cell.color === "w" ? cell.type.toUpperCase() : cell.type.toLowerCase()]}
                  </span>
                )}
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
