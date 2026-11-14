// lib/analysis/explain/evidence-providers.ts
//
// Stage 5 Day 1: extract evidence facts from Stage 4 output.
//
// ANSWERS THE ARCHITECT'S QUESTION:
//   "Which facts can we reliably extract from Stage 4 output without
//    introducing motif detection or refutation generation?"
//
// Three facts are extractable and verifiable:
//
// 1. MATE_DELIVERED
//    - Mover's played move ended the game in checkmate.
//    - Source: evalAfterPlayed is { type: "terminal", kind: "checkmate" }
//      AND winner === moverColor.
//    - Verified via chess.js: the post-move FEN is actually checkmate.
//    - Rule: TERMINAL_CHECKMATE
//
// 2. MISSED_MATE
//    - The pre-move position had a forced mate (mateVerdict.kind === "lost"),
//      and the engine's PV from that position actually reaches checkmate
//      when replayed.
//    - Verified via chess.js: full replay of the pre-move PV from preMoveFen
//      ends in isCheckmate().
//    - Rule: MATE_CONTINUATION_VERIFIED
//
// 3. ENGINE_PREFERRED
//    - The played move exactly matches the engine's top move in a stable
//      search, and the classification is "Best".
//    - Verified via: preMovePv.stability === "stable" AND
//      playedMoveUci === preMovePv.moves[0].uci AND quality === "Best".
//    - Rule: PLAYED_MATCHES_ENGINE_TOP
//    - NOTE: This is a FACTUAL confirmation, not a semantic claim about
//      the move's quality. The engine may have missed something deeper.
//
// Everything else → no fact extracted. Downstream planner will be silent.

import { Chess } from "chess.js";
import type {
  AnyEvaluation,
  Evaluation,
  QualityLevel,
} from "../core/types.ts";

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export type EvidenceFact =
  | {
      readonly kind: "terminal_checkmate_delivered";
      readonly ply: number;
      readonly winner: "white" | "black";
      readonly terminalFen: string;
      /** Opponent king's square (where the checkmate is delivered). */
      readonly checkmateSquare: string;
    }
  | {
      readonly kind: "missed_mate";
      readonly ply: number;
      /** Number of moves in the mating line (mate in N). */
      readonly mateIn: number;
      /** Verified PV that reaches checkmate. */
      readonly matingLine: ReadonlyArray<{ uci: string; san: string }>;
      /** Last move of matingLine — the actual mating move. */
      readonly mateDeliveringMoveSan: string;
      readonly preMoveFen: string;
    }
  | {
      readonly kind: "engine_preferred";
      readonly ply: number;
      readonly playedMoveUci: string;
      readonly engineMoveUci: string;
    };

export interface FactInput {
  readonly ply: number;
  readonly moverColor: "w" | "b";
  readonly playedMoveUci: string;
  readonly quality: QualityLevel;
  readonly evalAfterPlayed: AnyEvaluation;
  readonly preMoveFen: string;
  readonly postMoveFen: string;
  readonly preMoveRootEval: Evaluation;
  readonly preMovePvMoves: ReadonlyArray<{ uci: string; san: string }>;
  readonly preMovePvStability: "stable" | "unstable";
  readonly mateVerdictKind:
    | "preserved" | "delayed" | "lost" | "gained" | "inconsistent" | null;
}

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function findKingSquare(fen: string, color: "w" | "b"): string | null {
  try {
    const chess = new Chess(fen);
    const board = chess.board();
    for (const row of board) {
      for (const cell of row) {
        if (cell && cell.type === "k" && cell.color === color) {
          return cell.square;
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

function movesMatchMover(winner: "white" | "black", moverColor: "w" | "b"): boolean {
  return (moverColor === "w" && winner === "white")
      || (moverColor === "b" && winner === "black");
}

/**
 * Replay a PV from a starting FEN. Return true if all moves are legal
 * AND the final position is checkmate.
 */
function verifyMateContinuation(
  startFen: string,
  moves: ReadonlyArray<{ uci: string; san: string }>,
): boolean {
  if (moves.length === 0) return false;
  const chess = new Chess(startFen);
  for (const m of moves) {
    try {
      const from = m.uci.slice(0, 2);
      const to = m.uci.slice(2, 4);
      const promotion = m.uci.length > 4 ? m.uci[4] : undefined;
      const result = chess.move({ from, to, promotion });
      if (!result) return false;
    } catch {
      return false;
    }
  }
  return chess.isCheckmate();
}

// ═══════════════════════════════════════════════════════════
// Main extractor
// ═══════════════════════════════════════════════════════════

export function extractFacts(input: FactInput): EvidenceFact[] {
  const facts: EvidenceFact[] = [];

  // ── 1. MATE_DELIVERED ─────────────────────────────────
  if (
    input.evalAfterPlayed.type === "terminal" &&
    input.evalAfterPlayed.kind === "checkmate" &&
    movesMatchMover(input.evalAfterPlayed.winner, input.moverColor)
  ) {
    // Re-verify with chess.js (defense in depth — pipeline already
    // validated this via validateRulesSourcedEvaluation, but we don't
    // want to trust that blindly here).
    const chess = new Chess(input.postMoveFen);
    if (chess.isCheckmate()) {
      const oppColor = input.moverColor === "w" ? "b" : "w";
      const checkmateSquare = findKingSquare(input.postMoveFen, oppColor);
      if (checkmateSquare) {
        facts.push({
          kind: "terminal_checkmate_delivered",
          ply: input.ply,
          winner: input.evalAfterPlayed.winner,
          terminalFen: input.postMoveFen,
          checkmateSquare,
        });
      }
    }
  }

  // ── 2. MISSED_MATE ────────────────────────────────────
  // Only if mate was actually LOST (mateVerdict.kind === "lost") OR
  // pre-move eval was mate but played move didn't deliver checkmate.
  const wasMateAvailable = input.preMoveRootEval.type === "mate"
    && movesMatchMover(input.preMoveRootEval.winner, input.moverColor);
  const playedDeliveredMate =
    input.evalAfterPlayed.type === "terminal" &&
    input.evalAfterPlayed.kind === "checkmate" &&
    movesMatchMover(input.evalAfterPlayed.winner, input.moverColor);

  if (wasMateAvailable && !playedDeliveredMate && input.preMovePvMoves.length > 0) {
    // Verify the PV actually reaches checkmate
    if (verifyMateContinuation(input.preMoveFen, input.preMovePvMoves)) {
      const lastMove = input.preMovePvMoves[input.preMovePvMoves.length - 1];
      facts.push({
        kind: "missed_mate",
        ply: input.ply,
        mateIn: input.preMoveRootEval.in,
        matingLine: input.preMovePvMoves,
        mateDeliveringMoveSan: lastMove.san,
        preMoveFen: input.preMoveFen,
      });
    }
  }

  // ── 3. ENGINE_PREFERRED ───────────────────────────────
  // Factual confirmation: played move matches engine's top move
  // in a stable search, and quality is "Best".
  if (
    input.quality === "Best" &&
    input.preMovePvStability === "stable" &&
    input.preMovePvMoves.length > 0 &&
    input.playedMoveUci === input.preMovePvMoves[0].uci
  ) {
    facts.push({
      kind: "engine_preferred",
      ply: input.ply,
      playedMoveUci: input.playedMoveUci,
      engineMoveUci: input.preMovePvMoves[0].uci,
    });
  }

  // ── NO_FACT → downstream will be silent ───────────────
  // If facts is empty, the planner must return `silent`. That is the
  // honest response: we have no verified cause for this move.

  return facts;
}
