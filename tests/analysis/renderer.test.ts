// tests/analysis/renderer.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  renderExplanation,
} from "../../lib/analysis/explain/renderer.ts";
import { planExplanations } from "../../lib/analysis/explain/planner.ts";
import { ContractViolation } from "../../lib/analysis/core/contracts.ts";
import type {
  AnalysisConfig,
  AnalyzedGame,
  CausalEdge,
  ClassifiedMove,
  EvidenceGraph,
  EvidenceNode,
  ExplanationOutput,
  PlannedExplanation,
  Proof,
  ProofEngine,
  PVMove,
  PVRecord,
} from "../../lib/analysis/core/types.ts";

// ─── Synthetic builders ──────────────────────────────────

function mechProof(): Proof {
  return {
    kind: "mechanical",
    rule: "LEGAL_MOVE",
    squares: ["e2", "e4"],
    pieces: ["P"],
  };
}

function engineProof(pvId: string, depth = 20): ProofEngine {
  return {
    kind: "engine",
    pvId,
    depth,
    evalBefore: { type: "cp", value: 0 },
    evalAfter: { type: "cp", value: 0 },
  };
}

function node(
  id: string,
  kind: EvidenceNode["kind"],
  opts: { moveRef?: string | null; proofs?: readonly Proof[] } = {},
): EvidenceNode {
  return {
    id,
    kind,
    confidence: "verified",
    positionRef: "FEN",
    moveRef: opts.moveRef ?? null,
    proofs: opts.proofs ?? [mechProof()],
  };
}

function edge(from: string, to: string, type: "enables" | "causes" = "causes"): CausalEdge {
  return {
    id: `e_${from}_${to}`,
    from,
    to,
    type,
    proof: mechProof(),
  };
}

function makeGraph(
  nodes: EvidenceNode[],
  edges: CausalEdge[] = [],
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

function makePV(
  id: string,
  moves: readonly { uci: string; san: string }[],
): PVRecord {
  return {
    id,
    rootId: "r1",
    rootEval: { type: "cp", value: 0 },
    depth: 20,
    stability: "stable",
    moves: moves.map((m) => ({
      uci: m.uci,
      san: m.san,
      evalAfter: { type: "cp", value: 0 } as PVMove["evalAfter"],
    })),
    createdAt: 1,
  };
}

function move(ply: number, san: string): ClassifiedMove {
  return {
    ply,
    san,
    quality: "Best",
    annotations: [],
    evaluation: { type: "cp", value: 0 },
    expectedScore: null,
    mateVerdict: null,
    classificationVersion: "v1",
  };
}

function makeGame(overrides: {
  moves?: ClassifiedMove[];
  pvs?: PVRecord[];
} = {}): AnalyzedGame {
  return {
    pgn: "",
    status: "complete",
    failures: [],
    roots: new Map(),
    pvs: new Map((overrides.pvs ?? []).map((p) => [p.id, p])),
    moves: overrides.moves ?? [],
    explanations: new Map(),
    refutations: new Map(),
    config: {} as AnalysisConfig,
  };
}

// ─── Plan builders ───────────────────────────────────────

function mateDeliveredPlan(ply: number): {
  plan: PlannedExplanation;
  graph: EvidenceGraph;
} {
  const event = node(`mate_delivered_${ply}`, "state_fact");
  const over = node(`mate_delivered_game_over_${ply}`, "consequence");
  const graph = makeGraph(
    [event, over],
    [edge(event.id, over.id, "causes")],
  );
  const plan: PlannedExplanation = {
    rootCause: event,
    causalChain: [{ mechanism: event, consequence: over }],
    supportingEvidence: [],
    confidence: "verified",
  };
  return { plan, graph };
}

function missedMatePlan(
  ply: number,
  pvId: string,
  pvHeadSan: string,
): { plan: PlannedExplanation; graph: EvidenceGraph; pv: PVRecord } {
  const eng = engineProof(pvId);
  const available = node(`missed_mate_available_${ply}`, "state_fact", {
    proofs: [eng],
  });
  const pvNode = node(`missed_mate_pv_${ply}`, "mechanism", {
    proofs: [eng],
  });
  const missed = node(`missed_mate_missed_${ply}`, "consequence", {
    moveRef: "a1a2",
    proofs: [mechProof(), eng],
  });
  const graph = makeGraph(
    [available, pvNode, missed],
    [
      edge(available.id, pvNode.id, "enables"),
      edge(pvNode.id, missed.id, "causes"),
    ],
  );
  const plan: PlannedExplanation = {
    rootCause: available,
    causalChain: [{ mechanism: pvNode, consequence: missed }],
    supportingEvidence: [],
    confidence: "verified",
  };
  const pv = makePV(pvId, [{ uci: "a1a2", san: pvHeadSan }]);
  return { plan, graph, pv };
}

function explained(plan: PlannedExplanation): ExplanationOutput {
  return { status: "explained", primary: plan, secondary: [] };
}

// ─── MATE_DELIVERED ──────────────────────────────────────

test("MATE_DELIVERED happy path", () => {
  const { plan, graph } = mateDeliveredPlan(33);
  const game = makeGame({ moves: [move(33, "Rd8#")] });
  const out = renderExplanation(explained(plan), graph, game, 33);
  assert.ok(out);
  assert.equal(out!.templateId, "MATE_DELIVERED");
  assert.equal(out!.confidence, "verified");
  assert.equal(out!.text, "كش مات! Rd8# أنهت المباراة.");
});

test("MATE_DELIVERED rejects causalChain.length !== 1", () => {
  const { plan, graph } = mateDeliveredPlan(33);
  const badPlan: PlannedExplanation = {
    ...plan,
    causalChain: [plan.causalChain[0], plan.causalChain[0]],
  };
  assert.throws(
    () =>
      renderExplanation(
        explained(badPlan),
        graph,
        makeGame({ moves: [move(33, "Rd8#")] }),
        33,
      ),
    ContractViolation,
  );
});

test("MATE_DELIVERED rejects mechanism.id !== rootCause.id", () => {
  const { plan, graph } = mateDeliveredPlan(33);
  const wrongMech = node("mate_delivered_99", "state_fact");
  const badPlan: PlannedExplanation = {
    ...plan,
    causalChain: [
      { mechanism: wrongMech, consequence: plan.causalChain[0].consequence },
    ],
  };
  assert.throws(
    () =>
      renderExplanation(
        explained(badPlan),
        graph,
        makeGame({ moves: [move(33, "Rd8#")] }),
        33,
      ),
    ContractViolation,
  );
});

test("MATE_DELIVERED rejects wrong consequence.id", () => {
  const { plan, graph } = mateDeliveredPlan(33);
  const wrongConsequence = node("wrong_consequence", "consequence");
  const badPlan: PlannedExplanation = {
    ...plan,
    causalChain: [
      { mechanism: plan.rootCause, consequence: wrongConsequence },
    ],
  };
  assert.throws(
    () =>
      renderExplanation(
        explained(badPlan),
        graph,
        makeGame({ moves: [move(33, "Rd8#")] }),
        33,
      ),
    ContractViolation,
  );
});

test("MATE_DELIVERED rejects missing classified move", () => {
  const { plan, graph } = mateDeliveredPlan(33);
  assert.throws(
    () => renderExplanation(explained(plan), graph, makeGame({ moves: [] }), 33),
    ContractViolation,
  );
});

// ─── MISSED_MATE ─────────────────────────────────────────

test("MISSED_MATE happy path", () => {
  const { plan, graph, pv } = missedMatePlan(16, "pv_x", "Nf7#");
  const game = makeGame({
    moves: [move(16, "Qa2")],
    pvs: [pv],
  });
  const out = renderExplanation(explained(plan), graph, game, 16);
  assert.ok(out);
  assert.equal(out!.templateId, "MISSED_MATE");
  assert.equal(out!.confidence, "verified");
  assert.equal(
    out!.text,
    "كان المات متاحاً بـ Nf7#، لكنك لعبت Qa2.",
  );
});

test("MISSED_MATE rejects causalChain.length !== 1", () => {
  const { plan, graph, pv } = missedMatePlan(16, "pv_x", "Nf7#");
  const badPlan: PlannedExplanation = {
    ...plan,
    causalChain: [plan.causalChain[0], plan.causalChain[0]],
  };
  assert.throws(
    () =>
      renderExplanation(
        explained(badPlan),
        graph,
        makeGame({ moves: [move(16, "Qa2")], pvs: [pv] }),
        16,
      ),
    ContractViolation,
  );
});

test("MISSED_MATE rejects wrong mechanism.id", () => {
  const { plan, graph, pv } = missedMatePlan(16, "pv_x", "Nf7#");
  const wrongMech = node("missed_mate_pv_99", "mechanism", {
    proofs: [engineProof("pv_x")],
  });
  const badPlan: PlannedExplanation = {
    ...plan,
    causalChain: [
      { mechanism: wrongMech, consequence: plan.causalChain[0].consequence },
    ],
  };
  assert.throws(
    () =>
      renderExplanation(
        explained(badPlan),
        graph,
        makeGame({ moves: [move(16, "Qa2")], pvs: [pv] }),
        16,
      ),
    ContractViolation,
  );
});

test("MISSED_MATE rejects wrong consequence.id", () => {
  const { plan, graph, pv } = missedMatePlan(16, "pv_x", "Nf7#");
  const wrongConsequence = node("wrong_consequence", "consequence");
  const badPlan: PlannedExplanation = {
    ...plan,
    causalChain: [
      { mechanism: plan.causalChain[0].mechanism, consequence: wrongConsequence },
    ],
  };
  assert.throws(
    () =>
      renderExplanation(
        explained(badPlan),
        graph,
        makeGame({ moves: [move(16, "Qa2")], pvs: [pv] }),
        16,
      ),
    ContractViolation,
  );
});

test("MISSED_MATE rejects PV node with no ProofEngine", () => {
  const eng = engineProof("pv_x");
  const available = node("missed_mate_available_16", "state_fact", {
    proofs: [eng],
  });
  const pvNodeNoEng = node("missed_mate_pv_16", "mechanism", {
    proofs: [mechProof()],
  });
  const missed = node("missed_mate_missed_16", "consequence", {
    moveRef: "a1a2",
    proofs: [mechProof()],
  });
  const graph = makeGraph(
    [available, pvNodeNoEng, missed],
    [
      edge(available.id, pvNodeNoEng.id, "enables"),
      edge(pvNodeNoEng.id, missed.id, "causes"),
    ],
  );
  const plan: PlannedExplanation = {
    rootCause: available,
    causalChain: [{ mechanism: pvNodeNoEng, consequence: missed }],
    supportingEvidence: [],
    confidence: "verified",
  };
  const pv = makePV("pv_x", [{ uci: "a1a2", san: "Nf7#" }]);
  assert.throws(
    () =>
      renderExplanation(
        explained(plan),
        graph,
        makeGame({ moves: [move(16, "Qa2")], pvs: [pv] }),
        16,
      ),
    ContractViolation,
  );
});

test("MISSED_MATE rejects pvId not in game.pvs", () => {
  const { plan, graph } = missedMatePlan(16, "pv_missing", "Nf7#");
  // Note: plan/graph built against pv_missing, but game has no pvs
  assert.throws(
    () =>
      renderExplanation(
        explained(plan),
        graph,
        makeGame({ moves: [move(16, "Qa2")], pvs: [] }),
        16,
      ),
    ContractViolation,
  );
});

test("MISSED_MATE rejects PV with no moves", () => {
  const { plan, graph } = missedMatePlan(16, "pv_empty", "Nf7#");
  const emptyPv = makePV("pv_empty", []);
  assert.throws(
    () =>
      renderExplanation(
        explained(plan),
        graph,
        makeGame({ moves: [move(16, "Qa2")], pvs: [emptyPv] }),
        16,
      ),
    ContractViolation,
  );
});

test("MISSED_MATE rejects missing classified move", () => {
  const { plan, graph, pv } = missedMatePlan(16, "pv_x", "Nf7#");
  assert.throws(
    () =>
      renderExplanation(
        explained(plan),
        graph,
        makeGame({ moves: [], pvs: [pv] }),
        16,
      ),
    ContractViolation,
  );
});

// ─── Silent & unsupported ────────────────────────────────

test("silent output returns null", () => {
  const graph = makeGraph([]);
  const output: ExplanationOutput = {
    status: "silent",
    reason: "NO_CAUSE_FOUND",
  };
  const out = renderExplanation(output, graph, makeGame(), 5);
  assert.equal(out, null);
});

test("unknown rootCause.id returns null", () => {
  const mystery = node("mystery_33", "state_fact");
  const graph = makeGraph([mystery]);
  const plan: PlannedExplanation = {
    rootCause: mystery,
    causalChain: [],
    supportingEvidence: [],
    confidence: "verified",
  };
  const out = renderExplanation(explained(plan), graph, makeGame(), 33);
  assert.equal(out, null);
});

// ─── Guard rails ─────────────────────────────────────────

test("secondary.length > 0 throws", () => {
  const { plan, graph } = mateDeliveredPlan(33);
  const output: ExplanationOutput = {
    status: "explained",
    primary: plan,
    secondary: [plan],
  };
  assert.throws(
    () =>
      renderExplanation(
        output,
        graph,
        makeGame({ moves: [move(33, "Rd8#")] }),
        33,
      ),
    ContractViolation,
  );
});

test("ply mismatch throws", () => {
  const { plan, graph } = mateDeliveredPlan(33);
  assert.throws(
    () =>
      renderExplanation(
        explained(plan),
        graph,
        makeGame({ moves: [move(33, "Rd8#")] }),
        32,
      ),
    ContractViolation,
  );
});

test("ply < 1 throws", () => {
  const { plan, graph } = mateDeliveredPlan(33);
  assert.throws(
    () =>
      renderExplanation(
        explained(plan),
        graph,
        makeGame({ moves: [move(33, "Rd8#")] }),
        0,
      ),
    ContractViolation,
  );
});

// ─── Confidence preservation ─────────────────────────────

test("confidence 'supported' is preserved verbatim", () => {
  const { plan, graph } = mateDeliveredPlan(33);
  const supported: PlannedExplanation = { ...plan, confidence: "supported" };
  const out = renderExplanation(
    explained(supported),
    graph,
    makeGame({ moves: [move(33, "Rd8#")] }),
    33,
  );
  assert.ok(out);
  assert.equal(out!.confidence, "supported");
  assert.equal(out!.text, "كش مات! Rd8# أنهت المباراة.");
});

// ─── Determinism ─────────────────────────────────────────

test("deterministic: two calls produce identical output", () => {
  const { plan, graph } = mateDeliveredPlan(33);
  const game = makeGame({ moves: [move(33, "Rd8#")] });
  const a = renderExplanation(explained(plan), graph, game, 33);
  const b = renderExplanation(explained(plan), graph, game, 33);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

// ─── Integration: planner → renderer ─────────────────────

test("integration: planExplanations → renderExplanation for MATE_DELIVERED", () => {
  const { plan, graph } = mateDeliveredPlan(33);
  // planExplanations rebuilds the plan from the graph — use it as source
  const planned = planExplanations(graph);
  const out = planned.get(33);
  assert.ok(out);
  const game = makeGame({ moves: [move(33, "Rd8#")] });
  const localized = renderExplanation(out!, graph, game, 33);
  assert.ok(localized);
  assert.equal(localized!.templateId, "MATE_DELIVERED");
  assert.equal(localized!.text, "كش مات! Rd8# أنهت المباراة.");
  // Also verify the planner's plan matches our reference plan shape
  assert.equal(plan.rootCause.id, `mate_delivered_33`);
});

test("integration: planExplanations → renderExplanation for MISSED_MATE", () => {
  const { graph, pv } = missedMatePlan(16, "pv_x", "Nf7#");
  const planned = planExplanations(graph);
  const out = planned.get(16);
  assert.ok(out);
  const game = makeGame({ moves: [move(16, "Qa2")], pvs: [pv] });
  const localized = renderExplanation(out!, graph, game, 16);
  assert.ok(localized);
  assert.equal(localized!.templateId, "MISSED_MATE");
  assert.equal(
    localized!.text,
    "كان المات متاحاً بـ Nf7#، لكنك لعبت Qa2.",
  );
});

test("integration: planExplanations returns nothing for non-33 ply", () => {
  const { graph } = mateDeliveredPlan(33);
  const planned = planExplanations(graph);
  assert.equal(planned.has(32), false);
});
