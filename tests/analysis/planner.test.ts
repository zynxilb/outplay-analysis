// tests/analysis/planner.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  planExplanations,
  createExplanationPlanner,
} from "../../lib/analysis/explain/planner.ts";
import { ContractViolation, validatePlannedExplanation } from "../../lib/analysis/core/contracts.ts";
import type {
  CausalEdge,
  EvidenceGraph,
  EvidenceNode,
} from "../../lib/analysis/core/types.ts";

// ─── Synthetic graph helpers ────────────────────────────

function node(
  id: string,
  kind: EvidenceNode["kind"],
  positionRef = "FEN",
  moveRef: string | null = null,
): EvidenceNode {
  return {
    id, kind,
    confidence: "verified",
    positionRef, moveRef,
    proofs: [{
      kind: "mechanical",
      rule: "LEGAL_MOVE",
      squares: ["e2"],
      pieces: ["P"],
    }],
  };
}

function edge(from: string, to: string, type: "enables" | "causes" = "causes"): CausalEdge {
  return {
    id: `e_${from}_${to}`,
    from, to, type,
    proof: {
      kind: "mechanical",
      rule: "LEGAL_MOVE",
      squares: ["e2"],
      pieces: ["P"],
    },
  };
}

function makeGraph(
  nodes: EvidenceNode[],
  edges: CausalEdge[],
  analysisComplete = true,
): EvidenceGraph {
  return {
    nodes: new Map(nodes.map((n) => [n.id, n])),
    causalEdges: edges,
    metadata: { duplicates: [], sharedRoots: [] },
    rootPositionFen: "FEN",
    analysisComplete,
  };
}

// ─── MATE_DELIVERED → explained ─────────────────────────

test("planner_mate_delivered_produces_explanation", () => {
  const graph = makeGraph(
    [
      node("mate_delivered_33", "state_fact"),
      node("mate_delivered_game_over_33", "consequence"),
    ],
    [edge("mate_delivered_33", "mate_delivered_game_over_33", "causes")],
  );
  const out = planExplanations(graph);
  assert.equal(out.size, 1);
  const exp = out.get(33);
  assert.ok(exp);
  assert.equal(exp!.status, "explained");
  if (exp!.status === "explained") {
    assert.equal(exp!.primary.rootCause.id, "mate_delivered_33");
    assert.equal(exp!.primary.causalChain.length, 1);
    assert.equal(exp!.primary.causalChain[0].consequence.id, "mate_delivered_game_over_33");
    assert.equal(exp!.primary.confidence, "verified");
    assert.equal(exp!.secondary.length, 0);
  }
});

// ─── MISSED_MATE → explained ────────────────────────────

test("planner_missed_mate_produces_explanation", () => {
  const graph = makeGraph(
    [
      node("missed_mate_available_16", "state_fact"),
      node("missed_mate_pv_16", "mechanism"),
      node("missed_mate_missed_16", "consequence"),
    ],
    [
      edge("missed_mate_available_16", "missed_mate_pv_16", "enables"),
      edge("missed_mate_pv_16", "missed_mate_missed_16", "causes"),
    ],
  );
  const out = planExplanations(graph);
  assert.equal(out.size, 1);
  const exp = out.get(16);
  assert.ok(exp);
  if (exp!.status === "explained") {
    assert.equal(exp!.primary.rootCause.id, "missed_mate_available_16");
    assert.equal(exp!.primary.causalChain[0].mechanism.id, "missed_mate_pv_16");
    assert.equal(exp!.primary.causalChain[0].consequence.id, "missed_mate_missed_16");
  }
});

// ─── ENGINE_PREFERRED → no explanation ──────────────────

test("planner_engine_preferred_emits_nothing", () => {
  const graph = makeGraph(
    [node("engine_preferred_5", "state_fact")],
    [],
  );
  const out = planExplanations(graph);
  assert.equal(out.size, 0, "ENGINE_PREFERRED should not produce an explanation");
});

// ─── Priority: MATE_DELIVERED > ENGINE_PREFERRED ────────

test("planner_priority_mate_over_engine", () => {
  const graph = makeGraph(
    [
      node("mate_delivered_10", "state_fact"),
      node("mate_delivered_game_over_10", "consequence"),
      node("engine_preferred_10", "state_fact"),
    ],
    [edge("mate_delivered_10", "mate_delivered_game_over_10", "causes")],
  );
  const out = planExplanations(graph);
  assert.equal(out.size, 1);
  const exp = out.get(10);
  assert.equal(exp!.status, "explained");
});

// ─── Multiple plies ─────────────────────────────────────

test("planner_multiple_plies_each_get_entry", () => {
  const graph = makeGraph(
    [
      node("mate_delivered_33", "state_fact"),
      node("mate_delivered_game_over_33", "consequence"),
      node("missed_mate_available_16", "state_fact"),
      node("missed_mate_pv_16", "mechanism"),
      node("missed_mate_missed_16", "consequence"),
    ],
    [
      edge("mate_delivered_33", "mate_delivered_game_over_33", "causes"),
      edge("missed_mate_available_16", "missed_mate_pv_16", "enables"),
      edge("missed_mate_pv_16", "missed_mate_missed_16", "causes"),
    ],
  );
  const out = planExplanations(graph);
  assert.equal(out.size, 2);
  assert.ok(out.has(16));
  assert.ok(out.has(33));
});

// ─── Missing nodes → ContractViolation ──────────────────

test("planner_throws_on_missing_mate_delivered_nodes", () => {
  const graph = makeGraph(
    [node("mate_delivered_33", "state_fact")], // no game_over
    [],
  );
  assert.throws(() => planExplanations(graph), ContractViolation);
});

test("planner_throws_on_missing_missed_mate_nodes", () => {
  const graph = makeGraph(
    [
      node("missed_mate_available_16", "state_fact"),
      // no pv, no missed
    ],
    [],
  );
  assert.throws(() => planExplanations(graph), ContractViolation);
});

// ─── ExplanationPlanner interface ───────────────────────

test("planner_interface_returns_silent_on_empty_graph", () => {
  const graph = makeGraph([], []);
  const planner = createExplanationPlanner();
  const out = planner.plan(graph, null);
  assert.equal(out.status, "silent");
  if (out.status === "silent") {
    assert.equal(out.reason, "NO_CAUSE_FOUND");
  }
});

test("planner_interface_returns_silent_analysis_incomplete", () => {
  const graph = makeGraph([], [], false);
  const planner = createExplanationPlanner();
  const out = planner.plan(graph, null);
  assert.equal(out.status, "silent");
  if (out.status === "silent") {
    assert.equal(out.reason, "ANALYSIS_INCOMPLETE");
  }
});

test("planner_interface_returns_explained_for_mate", () => {
  const graph = makeGraph(
    [
      node("mate_delivered_33", "state_fact"),
      node("mate_delivered_game_over_33", "consequence"),
    ],
    [edge("mate_delivered_33", "mate_delivered_game_over_33", "causes")],
  );
  const planner = createExplanationPlanner();
  const out = planner.plan(graph, null);
  assert.equal(out.status, "explained");
});


// ═══════════════════════════════════════════════════════════
// Blocker 4 — planner must call validatePlannedExplanation
// ═══════════════════════════════════════════════════════════

test("planner_rejects_mate_delivered_with_missing_edge", () => {
  // Complete nodes but missing causal edge — validatePlannedExplanation
  // requires hasCausalPath(rootCause → mechanism) which fails.
  const graph = makeGraph(
    [
      node("mate_delivered_33", "state_fact"),
      node("mate_delivered_game_over_33", "consequence"),
    ],
    [], // no edges
  );
  assert.throws(() => planExplanations(graph), ContractViolation);
});




// ═══════════════════════════════════════════════════════════
// Direct validatePlannedExplanation tests (supporting evidence)
// ═══════════════════════════════════════════════════════════

test("validator_accepts_connected_supporting_evidence", () => {
  // root → mid1 → mid2 → support. support connected via hasCausalPath.
  const n1 = node("n1", "state_fact");
  const n2 = node("n2", "mechanism");
  const n3 = node("n3", "consequence");
  const n4 = node("n4", "state_fact");
  const graph = makeGraph(
    [n1, n2, n3, n4],
    [
      edge("n1", "n2", "enables"),
      edge("n2", "n3", "causes"),
      edge("n3", "n4", "causes"),
    ],
  );
  const plan = {
    rootCause: n1,
    causalChain: [{ mechanism: n2, consequence: n3 }],
    supportingEvidence: [n4],
    confidence: "verified" as const,
  };
  assert.doesNotThrow(() => validatePlannedExplanation(plan, graph));
});

test("validator_rejects_disconnected_supporting_evidence", () => {
  // isolated node exists in graph but has no causal path to/from explanation
  const n1 = node("n1", "state_fact");
  const n2 = node("n2", "mechanism");
  const n3 = node("n3", "consequence");
  const n_isolated = node("isolated", "state_fact");
  const graph = makeGraph(
    [n1, n2, n3, n_isolated],
    [
      edge("n1", "n2", "enables"),
      edge("n2", "n3", "causes"),
    ],
  );
  const plan = {
    rootCause: n1,
    causalChain: [{ mechanism: n2, consequence: n3 }],
    supportingEvidence: [n_isolated],
    confidence: "verified" as const,
  };
  assert.throws(
    () => validatePlannedExplanation(plan, graph),
    /not causally connected/,
  );
});

test("validator_rejects_supporting_node_absent_from_graph", () => {
  const n1 = node("n1", "state_fact");
  const n2 = node("n2", "mechanism");
  const n3 = node("n3", "consequence");
  const ghost = node("ghost_not_in_graph", "state_fact");
  const graph = makeGraph(
    [n1, n2, n3],
    [edge("n1", "n2", "enables"), edge("n2", "n3", "causes")],
  );
  const plan = {
    rootCause: n1,
    causalChain: [{ mechanism: n2, consequence: n3 }],
    supportingEvidence: [ghost],
    confidence: "verified" as const,
  };
  assert.throws(
    () => validatePlannedExplanation(plan, graph),
    /not in graph/,
  );
});

test("validator_rejects_missing_causal_edge", () => {
  const n1 = node("n1", "state_fact");
  const n2 = node("n2", "mechanism");
  const n3 = node("n3", "consequence");
  // No edges: hasCausalPath(n1, n2) will return false
  const graph = makeGraph([n1, n2, n3], []);
  const plan = {
    rootCause: n1,
    causalChain: [{ mechanism: n2, consequence: n3 }],
    supportingEvidence: [],
    confidence: "verified" as const,
  };
  assert.throws(
    () => validatePlannedExplanation(plan, graph),
    /no path/,
  );
});
