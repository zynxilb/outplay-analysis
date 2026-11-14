// lib/analysis/evaluate/perspective.ts
// Convert raw UCI scores (side-to-move perspective) to canonical
// White-perspective Evaluations.
//
// Per architect review Finding 5:
// - CP: flip sign if Black to move (UCI reports from mover's view)
// - Mate: derive absolute winner. Never flip winner after the fact.
// - Mate distance stored in MOVES (not plies), matching AnalysisConfig.

import type { Evaluation } from "../core/types";
import type { RawScore } from "../engine/uci-parser";

/**
 * Convert a raw UCI score to a canonical White-perspective Evaluation.
 *
 * @param score   Raw UCI score (side-to-move perspective, from Stockfish)
 * @param sideToMove  'w' or 'b' — the side that delivered this score
 */
export function evaluationFromUciScore(
  score: RawScore,
  sideToMove: "w" | "b",
): Evaluation {
  if (score.type === "cp") {
    // UCI cp is from side-to-move perspective. Flip if Black to move.
    const whiteValue = sideToMove === "w" ? score.value : -score.value;
    return { type: "cp", value: whiteValue };
  }

  // Mate: value > 0 means side-to-move is mating.
  // value < 0 means side-to-move is being mated.
  // Store absolute winner — never relative.
  if (score.value > 0) {
    return {
      type: "mate",
      in: score.value,
      winner: sideToMove === "w" ? "white" : "black",
    };
  }
  return {
    type: "mate",
    in: -score.value,
    winner: sideToMove === "w" ? "black" : "white",
  };
}

/**
 * Side-to-move from a FEN string.
 * Throws if FEN is malformed.
 */
export function sideToMoveFromFen(fen: string): "w" | "b" {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 2) {
    throw new Error(`Invalid FEN (missing side-to-move): ${fen}`);
  }
  const stm = parts[1];
  if (stm !== "w" && stm !== "b") {
    throw new Error(`Invalid FEN side-to-move "${stm}"`);
  }
  return stm;
}
