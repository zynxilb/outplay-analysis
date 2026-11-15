// lib/analysis/explain/localize/ar.ts
//
// Stage 5 Day 3: Arabic localization for validated explanations.
//
// Contract:
//   - Input: ExplanationOutput (from planner) + EvidenceGraph + AnalyzedGame.
//   - Output: LocalizedExplanation | null.
//   - null means: silent (nothing to localize) or unsupported template.
//   - Never fabricate. Every headline/detail string is derived from
//     verified records already present in game / graph.
//   - Deterministic: same input → same output.

import type {
  AnalyzedGame,
  ClassifiedMove,
  EvidenceGraph,
  EvidenceNode,
  ExplanationOutput,
  LocalizedExplanation,
} from "../../core/types.ts";
import { ContractViolation } from "../../core/contracts.ts";

// ─── Template catalog (closed) ──────────────────────────

const TEMPLATES = {
  MATE_DELIVERED: {
    headline: "كش مات!",
    detail: (san: string) => `${san} أنهت المباراة.`,
  },
  MISSED_MATE: {
    headline: "فوّتت مات!",
    detail: (mateIn: number, bestSan: string, playedSan: string) =>
      `كان في مات في ${mateIn}. ${bestSan} كانت هتنهي المباراة، لكنك لعبت ${playedSan}.`,
  },
} as const;

// ─── Helpers ────────────────────────────────────────────

function getPlyFromNode(node: EvidenceNode): number | null {
  const m = node.id.match(/_(\d+)$/);
  if (!m) return null;
  return parseInt(m[1], 10);
}

function findMove(game: AnalyzedGame, ply: number): ClassifiedMove | null {
  return game.moves.find((m) => m.ply === ply) ?? null;
}

function findEnginePvInNode(
  node: EvidenceNode,
  game: AnalyzedGame,
): { san: string; mateIn: number | null } | null {
  const engProof = node.proofs.find((p) => p.kind === "engine");
  if (!engProof || engProof.kind !== "engine") return null;
  const pv = game.pvs.get(engProof.pvId);
  if (!pv) return null;
  const first = pv.moves[0];
  if (!first) return null;
  const mateIn =
    pv.rootEval.type === "mate" ? pv.rootEval.in : null;
  return { san: first.san, mateIn };
}

// ─── Per-template localizers ────────────────────────────

function localizeMateDelivered(
  output: ExplanationOutput & { status: "explained" },
  game: AnalyzedGame,
): LocalizedExplanation | null {
  const ply = getPlyFromNode(output.primary.rootCause);
  if (ply === null) return null;
  const move = findMove(game, ply);
  if (!move) return null;
  // Defensive: SAN must be checkmate (verified data, but sanity check)
  if (!move.san.endsWith("#")) return null;
  // Defensive: evaluation must be terminal checkmate
  if (
    move.evaluation.type !== "terminal" ||
    move.evaluation.kind !== "checkmate"
  ) {
    return null;
  }
  return {
    templateId: "MATE_DELIVERED",
    headline: TEMPLATES.MATE_DELIVERED.headline,
    detail: TEMPLATES.MATE_DELIVERED.detail(move.san),
    ply,
  };
}

function localizeMissedMate(
  output: ExplanationOutput & { status: "explained" },
  graph: EvidenceGraph,
  game: AnalyzedGame,
): LocalizedExplanation | null {
  const ply = getPlyFromNode(output.primary.rootCause);
  if (ply === null) return null;
  const move = findMove(game, ply);
  if (!move) return null;
  // MateTransition must exist and have a mate `before` (verified by graph-builder)
  if (!move.mateVerdict) return null;
  if (move.mateVerdict.before.type !== "mate") return null;
  const mateIn = move.mateVerdict.before.in;
  if (mateIn < 1) return null;

  // Best move SAN from the registered pre-move PV (via the pv node)
  const pvNode = graph.nodes.get(`missed_mate_pv_${ply}`);
  if (!pvNode) return null;
  const pvInfo = findEnginePvInNode(pvNode, game);
  if (!pvInfo) return null;

  return {
    templateId: "MISSED_MATE",
    headline: TEMPLATES.MISSED_MATE.headline,
    detail: TEMPLATES.MISSED_MATE.detail(mateIn, pvInfo.san, move.san),
    ply,
  };
}

// ─── Public API ─────────────────────────────────────────

/**
 * Localize a single explanation to Arabic.
 * Returns null for:
 *   - silent output (nothing to localize)
 *   - unknown template (root cause ID prefix not recognized)
 *   - missing required data (verified at graph-build time, but rechecked
 *     here defensively)
 */
export function localizeExplanation(
  output: ExplanationOutput,
  graph: EvidenceGraph,
  game: AnalyzedGame,
): LocalizedExplanation | null {
  if (output.status === "silent") return null;
  const rootId = output.primary.rootCause.id;

  if (rootId.startsWith("mate_delivered_")) {
    return localizeMateDelivered(output, game);
  }
  if (rootId.startsWith("missed_mate_available_")) {
    return localizeMissedMate(output, graph, game);
  }
  // Unknown template — silent (never invent)
  return null;
}

/**
 * Localize every explanation in a game. Returns a per-ply map.
 * Skips plies that localize to null (silent).
 */
export function localizeExplanations(
  explanations: ReadonlyMap<number, ExplanationOutput>,
  graph: EvidenceGraph,
  game: AnalyzedGame,
): Map<number, LocalizedExplanation> {
  const result = new Map<number, LocalizedExplanation>();
  for (const [ply, output] of explanations) {
    const localized = localizeExplanation(output, graph, game);
    if (localized) result.set(ply, localized);
  }
  return result;
}
