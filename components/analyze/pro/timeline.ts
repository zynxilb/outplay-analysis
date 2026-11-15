// components/analyze/pro/timeline.ts
//
// Stage 8b: convert AnalyzedGame (certified pipeline output) into the
// ComputedPly shape used by the UI. NO fabrication:
//   - explanationAr comes ONLY from localizedExplanations (certified
//     renderer). Missing → empty string → UI shows "no explanation
//     available".
//   - refutationLine comes ONLY from refutations + renderRefutation.
//   - bestMove comes from refutations.moves[0] or from a MATE/MISSED
//     plan's ProofEngine pvId. Missing → null.
//   - evalCp comes from ClassifiedMove.evaluation (cp), or a synthetic
//     large number for mate/terminal, or 0 for unknown.

import { Chess, type Color, type Square } from "chess.js";
import type {
  AnalyzedGame,
  ClassifiedMove,
  ProofEngine,
  RefutationLine,
} from "@/lib/analysis/core/types";
import { renderRefutation } from "@/lib/analysis/explain/refutation-ar";
import { replayPgn } from "@/lib/analysis/pgn-replay";
import { qualityFromClassified, type MoveQuality } from "./quality";

export interface ComputedPly {
  plyIndex: number;
  moveNumber: number;
  color: Color;
  san: string;
  from: Square;
  to: Square;
  fen: string;
  prevFen: string;
  isCapture: boolean;
  isCheck: boolean;
  evalCp: number | null;       // null = unknown or unanalyzed
  evalLabel: string;           // "—" when evalCp is null
  quality: MoveQuality | null; // null = unanalyzed
  explanationAr: string;
  bestMove: { san: string; from: Square; to: Square } | null;
  refutationLine: Array<{
    san: string;
    from: Square;
    to: Square;
    fen: string;
    noteAr: string;
  }>;
}

function formatEval(evalCp: number | null): string {
  if (evalCp === null) return "—";
  if (evalCp >= 9000) return "+M";
  if (evalCp <= -9000) return "-M";
  const pawns = evalCp / 100;
  if (Math.abs(pawns) < 0.01) return "0.00";
  return pawns > 0 ? `+${pawns.toFixed(2)}` : pawns.toFixed(2);
}

function evalToCp(evaluation: ClassifiedMove["evaluation"]): number | null {
  if (evaluation.type === "cp") return evaluation.value;
  if (evaluation.type === "mate") {
    return evaluation.winner === "white" ? 10000 : -10000;
  }
  if (evaluation.type === "terminal") {
    if (evaluation.kind === "checkmate") {
      return evaluation.winner === "white" ? 10000 : -10000;
    }
    return null;
  }
  return null;
}


function sideToMoveFromFen(fen: string): "w" | "b" {
  const parts = fen.trim().split(/\s+/);
  return parts[1] === "b" ? "b" : "w";
}

function moveFromUci(fen: string, uci: string): { san: string; from: Square; to: Square } | null {
  try {
    const c = new Chess(fen);
    const moved = c.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.slice(4, 5) || undefined,
    });
    if (!moved) return null;
    return { san: moved.san, from: moved.from, to: moved.to };
  } catch {
    return null;
  }
}

function extractBestMove(
  ply: number,
  game: AnalyzedGame,
  preMoveFen: string,
): { san: string; from: Square; to: Square } | null {
  // Priority 1: refutations map (Mistake/Blunder with a proven alternative)
  const refutation = game.refutations.get(ply);
  if (refutation && refutation.moves.length > 0) {
    const m = refutation.moves[0];
    return { san: m.san, from: m.uci.slice(0, 2) as Square, to: m.uci.slice(2, 4) as Square };
  }

  // Priority 2: explanation plan (MATE_DELIVERED / MISSED_MATE) ProofEngine pvId
  const explanation = game.explanations.get(ply);
  if (explanation && explanation.status === "explained") {
    for (const step of explanation.primary.causalChain) {
      for (const node of [step.mechanism, step.consequence]) {
        const eng = node.proofs.find(
          (p): p is ProofEngine => p.kind === "engine",
        );
        if (eng) {
          const pv = game.pvs.get(eng.pvId);
          if (pv && pv.moves.length > 0) {
            return moveFromUci(preMoveFen, pv.moves[0].uci);
          }
        }
      }
    }
  }

  return null;
}

function extractRefutationLine(
  refutation: RefutationLine | undefined,
  preMoveFen: string,
): ComputedPly["refutationLine"] {
  if (!refutation) return [];
  if (refutation.state.kind === "insufficient") return [];

  // Only the demonstrated states produce a visible line.
  let noteText = "";
  try {
    const localized = renderRefutation(refutation);
    noteText = localized?.text ?? "";
  } catch {
    return [];
  }
  if (!noteText) return [];

  const steps: ComputedPly["refutationLine"] = [];
  try {
    const c = new Chess(preMoveFen);
    for (const mv of refutation.moves) {
      const moved = c.move({
        from: mv.uci.slice(0, 2),
        to: mv.uci.slice(2, 4),
        promotion: mv.uci.slice(4, 5) || undefined,
      });
      if (!moved) break;
      steps.push({
        san: moved.san,
        from: moved.from,
        to: moved.to,
        fen: c.fen(),
        noteAr: noteText,
      });
    }
  } catch {
    return [];
  }
  return steps;
}

export function buildTimelineFromGame(
  game: AnalyzedGame,
  pgn: string,
): ComputedPly[] {
  let positions: { ply: number; fen: string; san: string }[];
  try {
    positions = replayPgn(pgn).positions.map((p) => ({
      ply: p.ply,
      fen: p.fen,
      san: p.san,
    }));
  } catch {
    return [];
  }
  if (positions.length < 2) return [];

  const byPly = new Map<number, ClassifiedMove>();
  for (const m of game.moves) byPly.set(m.ply, m);

  const timeline: ComputedPly[] = [];
  for (let i = 1; i < positions.length; i++) {
    const pos = positions[i];
    const prev = positions[i - 1];
    const move = byPly.get(pos.ply);

    // Reconstruct basic move geometry from FEN diff via chess.js.
    let from: Square = "a1";
    let to: Square = "a1";
    let isCapture = false;
    let isCheck = false;
    try {
      const c = new Chess(prev.fen);
      const moved = c.move(pos.san);
      if (moved) {
        from = moved.from;
        to = moved.to;
        isCapture = Boolean(moved.captured);
        isCheck = c.inCheck();
      }
    } catch {
      // Position mismatch — still render the row without highlights.
    }

    if (!move) {
      // Unanalyzed ply (sparse recovery). No quality, no explanation.
      timeline.push({
        plyIndex: pos.ply,
        moveNumber: Math.floor((pos.ply + 1) / 2),
        color: sideToMoveFromFen(prev.fen),
        san: pos.san,
        from,
        to,
        fen: pos.fen,
        prevFen: prev.fen,
        isCapture,
        isCheck,
        evalCp: null,
        evalLabel: "—",
        quality: null,
        explanationAr: "",
        bestMove: null,
        refutationLine: [],
      });
      continue;
    }

    const localized = game.localizedExplanations.get(pos.ply);
    const refutation = game.refutations.get(pos.ply);

    timeline.push({
      plyIndex: pos.ply,
      moveNumber: Math.floor((pos.ply + 1) / 2),
      color: sideToMoveFromFen(prev.fen),
      san: pos.san,
      from,
      to,
      fen: pos.fen,
      prevFen: prev.fen,
      isCapture,
      isCheck,
      evalCp: evalToCp(move.evaluation),
      evalLabel: formatEval(evalToCp(move.evaluation)),
      quality: qualityFromClassified(move),
      explanationAr: localized?.text ?? "",
      bestMove: extractBestMove(pos.ply, game, prev.fen),
      refutationLine: extractRefutationLine(refutation, prev.fen),
    });
  }
  return timeline;
}
