// lib/analysis/explain/refutation-builder.ts
//
// Stage 5 Day 5 — build RefutationLine for Mistake/Blunder plies.
//
// Evidence source (post-review): the real Stockfish adapter does not
// supply per-move PV evaluations (`evalAfter: unknown`). We therefore
// use only evaluations that ARE available:
//   - pv.rootEval          : eval of the pre-move position (white POV)
//   - classified.evaluation: eval after the played move (white POV)
// The |difference| is the cp loss from the mover's perspective.
//
// Only STABLE PVs are used. Unstable PVs → insufficient(unstable).
// Mate evaluations are not converted to CP; a mate-for-mover on the
// best line is reported as insufficient(search_failed) — that case is
// already covered by the MISSED_MATE explanation. A mate or terminal
// on the played side is also insufficient(search_failed).
//
// Consequence is declared via `evaluation_swing_demonstrated` with the
// CP gap. No material-loss claim is made at this stage.

import type {
  AnalyzedGame,
  ClassifiedMove,
  PVRecord,
  RefutationLine,
  LineState,
} from "../core/types.ts";

const MIN_CP_SWING = 300;

function isMistakeOrBlunder(m: ClassifiedMove): boolean {
  return m.quality === "Mistake" || m.quality === "Blunder";
}

function computeState(
  pv: PVRecord,
  played: ClassifiedMove,
): LineState {
  // Stability check first — unstable evidence cannot become verified.
  if (pv.stability !== "stable") {
    return { kind: "insufficient", reason: "unstable" };
  }

  // Rendering requires at least best move + reply.
  if (pv.moves.length < 2) {
    return { kind: "insufficient", reason: "pv_too_short" };
  }

  // Both sides of the comparison must be CP. Mate/terminal is delegated
  // to the explanation layer (MISSED_MATE etc.) — do not synthesize CP.
  if (pv.rootEval.type !== "cp") {
    return { kind: "insufficient", reason: "search_failed" };
  }
  const playedEval = played.evaluation;
  if (playedEval.type !== "cp") {
    return { kind: "insufficient", reason: "search_failed" };
  }

  const gap = Math.abs(pv.rootEval.value - playedEval.value);
  if (gap < MIN_CP_SWING) {
    return { kind: "insufficient", reason: "search_failed" };
  }

  return { kind: "evaluation_swing_demonstrated", cpGap: gap };
}

export function buildRefutations(
  game: AnalyzedGame,
  plyToPrePvId: ReadonlyMap<number, string>,
): Map<number, RefutationLine> {
  const result = new Map<number, RefutationLine>();
  for (const move of game.moves) {
    if (!isMistakeOrBlunder(move)) continue;
    const prePvId = plyToPrePvId.get(move.ply);
    if (!prePvId) continue;
    const pv = game.pvs.get(prePvId);
    if (!pv || pv.moves.length === 0) continue;
    result.set(move.ply, {
      mode: { kind: "alternative", targetMove: "missed" },
      state: computeState(pv, move),
      moves: pv.moves.slice(0, 3),
      rootId: pv.rootId,
      sourcedFromPvId: pv.id,
      sourcedFromDepth: pv.depth,
    });
  }
  return result;
}
