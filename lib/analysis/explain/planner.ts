// lib/analysis/explain/planner.ts
//
// Stage 5 Day 2: EvidenceGraph → ExplanationOutput.
//
// Selects and organizes evidence; never invents.
//
// Fact priority per ply (architect-mandated):
//   MATE_DELIVERED > MISSED_MATE > ENGINE_PREFERRED
//
// ENGINE_PREFERRED is a positive fact, not a causal explanation.
// Per architect: "do not force it into a causal explanation merely to
// increase the explained-move count". It remains a verified state_fact
// in the graph but produces NO ExplanationOutput entry.
//
// Output: only plies with MATE_DELIVERED or MISSED_MATE facts appear
// in the returned map, with status "explained". All other plies are
// absent — caller treats absence as "no explanation available for this
// move" (silent by default).

import type {
  EvidenceGraph,
  EvidenceNode,
  ExplanationOutput,
  MotifAttributed,
  PlannedExplanation,
} from "../core/types.ts";
import { ContractViolation, validatePlannedExplanation } from "../core/contracts.ts";
import type { ExplanationPlanner } from "../core/contracts.ts";

// ─── Node ID parsing ────────────────────────────────────
// Relies on graph-builder's ID convention.
// If graph-builder's IDs change, this parser must be updated.

function extractPly(id: string): number | null {
  const m = id.match(/_(\d+)$/);
  if (!m) return null;
  return parseInt(m[1], 10);
}

function groupByPly(graph: EvidenceGraph): Map<number, EvidenceNode[]> {
  const byPly = new Map<number, EvidenceNode[]>();
  for (const node of graph.nodes.values()) {
    const ply = extractPly(node.id);
    if (ply === null) continue;
    if (!byPly.has(ply)) byPly.set(ply, []);
    byPly.get(ply)!.push(node);
  }
  return byPly;
}

// ─── Explanation builders ───────────────────────────────

function buildMateDelivered(graph: EvidenceGraph, ply: number): PlannedExplanation {
  const event = graph.nodes.get(`mate_delivered_${ply}`);
  const over = graph.nodes.get(`mate_delivered_game_over_${ply}`);
  if (!event || !over) {
    throw new ContractViolation(
      "ExplanationPlanner",
      `mate_delivered ply ${ply} missing event or game_over node`,
    );
  }
  return {
    rootCause: event,
    causalChain: [{ mechanism: event, consequence: over }],
    supportingEvidence: [],
    confidence: "verified",
  };
}

function buildMissedMate(graph: EvidenceGraph, ply: number): PlannedExplanation {
  const available = graph.nodes.get(`missed_mate_available_${ply}`);
  const pv = graph.nodes.get(`missed_mate_pv_${ply}`);
  const missed = graph.nodes.get(`missed_mate_missed_${ply}`);
  if (!available || !pv || !missed) {
    throw new ContractViolation(
      "ExplanationPlanner",
      `missed_mate ply ${ply} missing required nodes`,
    );
  }
  return {
    rootCause: available,
    causalChain: [{ mechanism: pv, consequence: missed }],
    supportingEvidence: [],
    confidence: "verified",
  };
}

// ─── Public API ─────────────────────────────────────────

/**
 * Produce one ExplanationOutput per ply that has an explainable fact.
 *
 * Plies not in the returned map: no explanation available.
 * The caller should NOT assume silence — it may mean:
 *   - The move has no verified fact (silent by policy)
 *   - The move has only ENGINE_PREFERRED (positive confirmation, not
 *     a causal explanation — architect-mandated exclusion)
 *   - Analysis was incomplete for that ply
 *
 * A distinct "silent with reason" output for these cases is a Day 3+
 * concern; Day 2 focuses on producing high-quality explanations for
 * the plies that clearly have them.
 */
export function planExplanations(
  graph: EvidenceGraph,
  _primaryMotif: MotifAttributed | null = null,
): Map<number, ExplanationOutput> {
  const result = new Map<number, ExplanationOutput>();
  const byPly = groupByPly(graph);

  for (const [ply, nodes] of byPly) {
    const hasMateDelivered = nodes.some((n) => n.id.startsWith("mate_delivered_"));
    const hasMissedMate = nodes.some((n) => n.id.startsWith("missed_mate_"));

    // Priority: MATE_DELIVERED > MISSED_MATE > ENGINE_PREFERRED.
    // In practice MATE_DELIVERED and MISSED_MATE are mutually exclusive
    // at the same ply (one says you delivered, other says you missed).
    let primary: PlannedExplanation | null = null;
    if (hasMateDelivered) {
      primary = buildMateDelivered(graph, ply);
    } else if (hasMissedMate) {
      primary = buildMissedMate(graph, ply);
    }
    if (primary) {
      // Blocker 4: validate before returning. Throws ContractViolation if
      // the plan has missing nodes, disconnected causal chain, or
      // disconnected supporting evidence.
      validatePlannedExplanation(primary, graph);
      result.set(ply, { status: "explained", primary, secondary: [] });
    }
    // ENGINE_PREFERRED-only plies: no entry (positive fact, not a cause).
  }

  return result;
}

/**
 * ExplanationPlanner implementation for the contract.
 *
 * The contract's plan() returns a single ExplanationOutput. For a
 * per-ply map, use planExplanations(). plan() returns the explanation
 * for the highest-priority ply in the graph, or silent if none.
 */
export function createExplanationPlanner(): ExplanationPlanner {
  return {
    plan(graph: EvidenceGraph, motif: MotifAttributed | null): ExplanationOutput {
      const all = planExplanations(graph, motif);
      if (all.size === 0) {
        return {
          status: "silent",
          reason: graph.analysisComplete ? "NO_CAUSE_FOUND" : "ANALYSIS_INCOMPLETE",
        };
      }
      // Return the first explained output (any is fine — callers
      // wanting per-ply use planExplanations).
      return all.values().next().value!;
    },
  };
}
