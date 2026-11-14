// lib/analysis/explain/evidence-providers.ts
//
// Stage 5 Day 1 (corrected): extract evidence facts from Stage 4 output.
//
// Facts carry PV/root/depth provenance so Day 2's graph-builder can
// construct ProofEngine for engine-derived facts (not MechanicalRule).
//
// MISSED_MATE requires mateVerdictKind === "lost" — preserved, delayed,
// gained, inconsistent are NOT missed_mate.

import { Chess } from "chess.js";
import type { AnyEvaluation, Evaluation, QualityLevel } from "../core/types.ts";

export type EvidenceFact =
  | {
      readonly kind: "terminal_checkmate_delivered";
      readonly ply: number;
      readonly winner: "white" | "black";
      readonly terminalFen: string;
      readonly checkmateSquare: string;
    }
  | {
      readonly kind: "missed_mate";
      readonly ply: number;
      readonly mateIn: number;
      readonly matingLine: ReadonlyArray<{ uci: string; san: string }>;
      readonly mateDeliveringMoveSan: string;
      readonly preMoveFen: string;
      // Provenance — required for ProofEngine at graph-build time
      readonly pvId: string;
      readonly rootId: string;
      readonly depth: number;
    }
  | {
      readonly kind: "engine_preferred";
      readonly ply: number;
      readonly playedMoveUci: string;
      readonly engineMoveUci: string;
      // Provenance
      readonly pvId: string;
      readonly rootId: string;
      readonly depth: number;
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
  // Provenance fields (Stage 5 Day 1 correction)
  readonly preMovePvId: string;
  readonly preMoveRootId: string;
  readonly preMoveDepth: number;
}

function findKingSquare(fen: string, color: "w" | "b"): string | null {
  try {
    const chess = new Chess(fen);
    for (const row of chess.board()) {
      for (const cell of row) {
        if (cell && cell.type === "k" && cell.color === color) return cell.square;
      }
    }
  } catch { return null; }
  return null;
}

function movesMatchMover(winner: "white" | "black", moverColor: "w" | "b"): boolean {
  return (moverColor === "w" && winner === "white")
      || (moverColor === "b" && winner === "black");
}

/**
 * Verify the played move connects preMoveFen → postMoveFen.
 * Throws on mismatch — this is a Stage 4 pipeline invariant violation.
 * Callers must not use fact extraction results if positions do not connect.
 */
function verifyPlayedMoveConnects(
  preMoveFen: string,
  playedMoveUci: string,
  postMoveFen: string,
): void {
  const chess = new Chess(preMoveFen);
  const from = playedMoveUci.slice(0, 2);
  const to = playedMoveUci.slice(2, 4);
  const promotion = playedMoveUci.length > 4 ? playedMoveUci[4] : undefined;
  let result;
  try {
    result = chess.move({ from, to, promotion });
  } catch (e) {
    throw new Error(
      `Played move "${playedMoveUci}" is illegal from preMoveFen: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!result) {
    throw new Error(`Played move "${playedMoveUci}" is illegal from preMoveFen`);
  }
  // Compare canonical FEN (position + turn + castling + ep; ignore clocks)
  const expected = postMoveFen.trim().split(/\s+/).slice(0, 4).join(" ");
  const actual = chess.fen().split(/\s+/).slice(0, 4).join(" ");
  if (expected !== actual) {
    throw new Error(
      `Played move "${playedMoveUci}" does not produce postMoveFen. ` +
      `Expected "${expected}", got "${actual}".`,
    );
  }
}

/**
 * Verify a PV reaches checkmate. Returns the mate distance (mover's moves)
 * plus the final SAN, or null if verification fails.
 *
 * Verifies:
 * 1. Every UCI is legal.
 * 2. Every replayed SAN matches the supplied SAN.
 * 3. The final position is checkmate.
 * Returns actual mate-in-N computed from line length.
 */
function verifyMateContinuation(
  startFen: string,
  moves: ReadonlyArray<{ uci: string; san: string }>,
): { actualMateIn: number; lastSan: string } | null {
  if (moves.length === 0) return null;
  const chess = new Chess(startFen);
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const from = m.uci.slice(0, 2);
    const to = m.uci.slice(2, 4);
    const promotion = m.uci.length > 4 ? m.uci[4] : undefined;
    let result;
    try {
      result = chess.move({ from, to, promotion });
    } catch { return null; }
    if (!result) return null;
    if (result.san !== m.san) return null;
  }
  if (!chess.isCheckmate()) return null;
  const actualMateIn = Math.ceil(moves.length / 2);
  return { actualMateIn, lastSan: moves[moves.length - 1].san };
}

export function extractFacts(input: FactInput): EvidenceFact[] {
  // Invariant: played move must connect preMoveFen → postMoveFen.
  // Throws if Stage 4 supplied inconsistent data.
  verifyPlayedMoveConnects(input.preMoveFen, input.playedMoveUci, input.postMoveFen);

  const facts: EvidenceFact[] = [];

  // ── 1. MATE_DELIVERED ──
  if (
    input.evalAfterPlayed.type === "terminal" &&
    input.evalAfterPlayed.kind === "checkmate" &&
    movesMatchMover(input.evalAfterPlayed.winner, input.moverColor)
  ) {
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

  // ── 2. MISSED_MATE — requires mateVerdictKind === "lost" ──
  const wasMateAvailable =
    input.preMoveRootEval.type === "mate" &&
    movesMatchMover(input.preMoveRootEval.winner, input.moverColor);
  const playedDeliveredMate =
    input.evalAfterPlayed.type === "terminal" &&
    input.evalAfterPlayed.kind === "checkmate" &&
    movesMatchMover(input.evalAfterPlayed.winner, input.moverColor);

  if (
    wasMateAvailable &&
    !playedDeliveredMate &&
    input.mateVerdictKind === "lost" &&
    input.preMovePvMoves.length > 0
  ) {
    const verified = verifyMateContinuation(input.preMoveFen, input.preMovePvMoves);
    // Also verify the reported mate distance matches the verified line.
    if (verified && verified.actualMateIn === input.preMoveRootEval.in) {
      facts.push({
        kind: "missed_mate",
        ply: input.ply,
        mateIn: input.preMoveRootEval.in,
        matingLine: input.preMovePvMoves,
        mateDeliveringMoveSan: verified.lastSan,
        preMoveFen: input.preMoveFen,
        pvId: input.preMovePvId,
        rootId: input.preMoveRootId,
        depth: input.preMoveDepth,
      });
    }
  }

  // ── 3. ENGINE_PREFERRED ──
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
      pvId: input.preMovePvId,
      rootId: input.preMoveRootId,
      depth: input.preMoveDepth,
    });
  }

  return facts;
}
