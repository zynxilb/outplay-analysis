// lib/analysis/explain/refutation-builder.ts
//
// Stage 5 Day 5: build RefutationLine for Mistake/Blunder plies.
//
// For each such ply N:
//   prePvId = plyToPrePvId.get(N)     (recorded by pipeline.ts)
//   pv      = game.pvs.get(prePvId)
//   best    = pv.moves[0]
//   reply   = pv.moves[1]
//   state:
//     consequence_demonstrated  iff pv has >=2 moves AND the |CP gap|
//                               between pv's last evalAfter and the
//                               played move's evaluation is >= 300.
//     insufficient(reason)      otherwise.
//
// No engine search. No synthesis. All data verified by earlier layers.

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

function evalGapCp(played: ClassifiedMove, pv: PVRecord): number | null {
  const playedEval = played.evaluation;
  if (playedEval.type === "terminal" && playedEval.kind === "checkmate") return null;
  if (playedEval.type === "mate") return null;
  const last = pv.moves[pv.moves.length - 1];
  if (!last) return null;
  const bestEval = last.evalAfter;
  if (bestEval.type === "mate") return 10000;
  if (bestEval.type !== "cp" || playedEval.type !== "cp") return null;
  return Math.abs(bestEval.value - playedEval.value);
}

function buildState(pv: PVRecord, played: ClassifiedMove): LineState {
  if (pv.moves.length < 2) {
    return { kind: "insufficient", reason: "pv_too_short" };
  }
  const gap = evalGapCp(played, pv);
  if (gap === null) {
    return { kind: "insufficient", reason: "search_failed" };
  }
  if (gap < MIN_CP_SWING) {
    return { kind: "insufficient", reason: "pv_too_short" };
  }
  // NOTE: lostMaterial carries the CP gap, not material units. The field
  // is named "lostMaterial" but the type accepts any positive finite
  // number. For Stage 5 Day 5, CP gap is the concrete measure available.
  return { kind: "consequence_demonstrated", lostMaterial: gap, atPly: 1 };
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
      state: buildState(pv, move),
      moves: pv.moves.slice(0, 3),
      rootId: pv.rootId,
      sourcedFromPvId: pv.id,
      sourcedFromDepth: pv.depth,
    });
  }
  return result;
}
