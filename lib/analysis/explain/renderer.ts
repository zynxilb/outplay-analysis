// lib/analysis/explain/renderer.ts
//
// Stage 5 Day 3: ExplanationOutput + EvidenceGraph + AnalyzedGame + ply
//   → Arabic LocalizedExplanation | null.
//
// Does NOT modify the explanation. Copies confidence verbatim.
// Silent (null) on unsupported evidence. Throws ContractViolation on
// malformed plans (a planner bug, not a user state).
//
// SAN source (verified against cfeee26):
//   - Played move: game.moves.find(m => m.ply === ply).san
//   - PV head (MISSED_MATE): game.pvs.get(engineProof.pvId).moves[0].san,
//     where engineProof is the ProofEngine attached to the
//     missed_mate_pv_<ply> node (that node's moveRef is null).
//
// Node ID conventions (from graph-builder.ts):
//   mate_delivered_<ply>
//   mate_delivered_game_over_<ply>
//   missed_mate_available_<ply>
//   missed_mate_pv_<ply>
//   missed_mate_missed_<ply>

import { ContractViolation } from "../core/contracts.ts";
import type {
  AnalyzedGame,
  EvidenceGraph,
  EvidenceNode,
  ExplanationOutput,
  PlannedExplanation,
  ProofEngine,
} from "../core/types.ts";

// ─── Public types ────────────────────────────────────────

export type TemplateId = "MATE_DELIVERED" | "MISSED_MATE";

export interface LocalizedExplanation {
  readonly text: string;
  readonly templateId: TemplateId;
  readonly confidence: "verified" | "supported";
}

// ─── Helpers ─────────────────────────────────────────────

function plyFromRootCauseId(id: string): number | null {
  const m1 = id.match(/^mate_delivered_(\d+)$/);
  if (m1) return parseInt(m1[1], 10);
  const m2 = id.match(/^missed_mate_available_(\d+)$/);
  if (m2) return parseInt(m2[1], 10);
  return null;
}

function selectTemplate(id: string): TemplateId | null {
  if (/^mate_delivered_\d+$/.test(id)) return "MATE_DELIVERED";
  if (/^missed_mate_available_\d+$/.test(id)) return "MISSED_MATE";
  return null;
}

function getPlayedSan(game: AnalyzedGame, ply: number): string {
  const move = game.moves.find((m) => m.ply === ply);
  if (!move) {
    throw new ContractViolation(
      "renderer",
      `no classified move at ply ${ply}`,
    );
  }
  return move.san;
}

function getPvHeadSan(pvNode: EvidenceNode, game: AnalyzedGame): string {
  const engineProof = pvNode.proofs.find(
    (p): p is ProofEngine => p.kind === "engine",
  );
  if (!engineProof) {
    throw new ContractViolation(
      "renderer",
      `PV node ${pvNode.id} has no ProofEngine`,
    );
  }
  const pv = game.pvs.get(engineProof.pvId);
  if (!pv) {
    throw new ContractViolation(
      "renderer",
      `PV ${engineProof.pvId} not in game.pvs`,
    );
  }
  if (pv.moves.length === 0) {
    throw new ContractViolation(
      "renderer",
      `PV ${engineProof.pvId} has no moves`,
    );
  }
  return pv.moves[0].san;
}

// ─── Template renderers ──────────────────────────────────

function renderMateDelivered(
  plan: PlannedExplanation,
  game: AnalyzedGame,
  ply: number,
): string {
  if (plan.causalChain.length !== 1) {
    throw new ContractViolation(
      "renderer",
      `MATE_DELIVERED requires causalChain.length === 1, got ${plan.causalChain.length}`,
    );
  }
  const step = plan.causalChain[0];
  if (step.mechanism.id !== plan.rootCause.id) {
    throw new ContractViolation(
      "renderer",
      `MATE_DELIVERED mechanism.id "${step.mechanism.id}" != rootCause.id "${plan.rootCause.id}"`,
    );
  }
  if (step.mechanism.id !== `mate_delivered_${ply}`) {
    throw new ContractViolation(
      "renderer",
      `MATE_DELIVERED mechanism.id "${step.mechanism.id}" != "mate_delivered_${ply}"`,
    );
  }
  if (step.consequence.id !== `mate_delivered_game_over_${ply}`) {
    throw new ContractViolation(
      "renderer",
      `MATE_DELIVERED consequence.id "${step.consequence.id}" != "mate_delivered_game_over_${ply}"`,
    );
  }
  const san = getPlayedSan(game, ply);
  return `كش مات! ${san} أنهت المباراة.`;
}

function renderMissedMate(
  plan: PlannedExplanation,
  game: AnalyzedGame,
  ply: number,
): string {
  if (plan.causalChain.length !== 1) {
    throw new ContractViolation(
      "renderer",
      `MISSED_MATE requires causalChain.length === 1, got ${plan.causalChain.length}`,
    );
  }
  const step = plan.causalChain[0];
  if (step.mechanism.id !== `missed_mate_pv_${ply}`) {
    throw new ContractViolation(
      "renderer",
      `MISSED_MATE mechanism.id "${step.mechanism.id}" != "missed_mate_pv_${ply}"`,
    );
  }
  if (step.consequence.id !== `missed_mate_missed_${ply}`) {
    throw new ContractViolation(
      "renderer",
      `MISSED_MATE consequence.id "${step.consequence.id}" != "missed_mate_missed_${ply}"`,
    );
  }
  const pvSan = getPvHeadSan(step.mechanism, game);
  const playedSan = getPlayedSan(game, ply);
  return `كان المات متاحاً بـ ${pvSan}، لكنك لعبت ${playedSan}.`;
}

const TEMPLATES: Record<
  TemplateId,
  (plan: PlannedExplanation, game: AnalyzedGame, ply: number) => string
> = {
  MATE_DELIVERED: renderMateDelivered,
  MISSED_MATE: renderMissedMate,
};

// ─── Public API ──────────────────────────────────────────

export function renderExplanation(
  output: ExplanationOutput,
  graph: EvidenceGraph,
  game: AnalyzedGame,
  ply: number,
): LocalizedExplanation | null {
  void graph; // reserved for future cross-checks; unused in Day 3

  if (!Number.isInteger(ply) || ply < 1) {
    throw new ContractViolation(
      "renderer",
      `ply must be a positive integer, got ${ply}`,
    );
  }

  if (output.status === "silent") {
    return null;
  }

  if (output.secondary.length > 0) {
    throw new ContractViolation(
      "renderer",
      `Day 3 supports one explanation per ply; got ${output.secondary.length} secondary`,
    );
  }

  const plan = output.primary;
  const inferredPly = plyFromRootCauseId(plan.rootCause.id);
  if (inferredPly === null) {
    return null;
  }
  if (inferredPly !== ply) {
    throw new ContractViolation(
      "renderer",
      `ply mismatch: rootCause "${plan.rootCause.id}" implies ${inferredPly}, caller passed ${ply}`,
    );
  }

  const templateId = selectTemplate(plan.rootCause.id);
  if (templateId === null) {
    return null;
  }

  const text = TEMPLATES[templateId](plan, game, ply);
  return {
    text,
    templateId,
    confidence: plan.confidence,
  };
}
