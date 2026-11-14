// tests/analysis/contracts-graph.test.ts
// Commit 2 — Runtime contract tests (batch 2: evidence graph + proofs)

import { test } from "node:test";
import assert from "node:assert/strict";

import type {
  AnalysisConfig,
  AnalysisRoot,
  Evaluation,
  EvidenceGraph,
  EvidenceNode,
  CausalEdge,
  PVRecord,
  ProofMechanical,
  ProofEngine,
  ProofConsequence,
} from "../../lib/analysis/core/types.ts";

import {
  ContractViolation,
  validateEvidenceGraph,
  validateProofMechanical,
  validateProofEngine,
  validateProofConsequence,
  hasCausalPath,
  computeConfigHash,
  type ValidationContext,
} from "../../lib/analysis/core/contracts.ts";

// ─── Helpers ──────────────────────────────────────────────

const cp = (value: number): Evaluation => ({ type: "cp", value });

const makeCfg = (overrides: Partial<AnalysisConfig["engine"]> = {}): AnalysisConfig["engine"] => ({
  identity: "sf-16.1",
  hashMb: 32,
  multiPv: 1,
  ...overrides,
});

const makeConfig = (): AnalysisConfig => ({
  version: "v1",
  engine: makeCfg(),
  budgets: {
    initialDepth: 10, refinementDepth: 14, finalDepth: 18,
    initialTargetMs: 500, reSearchMs: 300,
  },
  evaluation: {
    epCoefficient: 0.00368208,
    mateOrderingValue: 10000,
    evaluationModelVersion: "v1",
  },
  classification: {
    epLossThresholds: {
      Best: 0, Excellent: 0.01, Good: 0.03, Inaccuracy: 0.05,
      Mistake: 0.10, Blunder: 0.15,
    },
    cpLossSecondaryThreshold: 200,
    brilliantSeeThreshold: 300,
    missExpectedGainThreshold: 0.10,
    mateDistanceTiers: { excellent: 1, good: 3, inaccuracy: 6, mistake: 10 },
  },
  motifs: { enabled: ["fork"], precisionTargets: { fork: 0.95 } },
  explanation: { secondaryContributionRatio: 0.25 },
});

const makeRoot = (overrides: Partial<AnalysisRoot> = {}): AnalysisRoot => ({
  id: "root-1",
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  sideToMove: "w",
  purpose: "find-best-move",
  engineIdentity: "sf-16.1",
  configHash: computeConfigHash(makeCfg()),
  evaluationPerspective: "white",
  searchBudget: { kind: "depth", value: 14 },
  ...overrides,
});

const makePv = (overrides: Partial<PVRecord> = {}): PVRecord => ({
  id: "pv-1",
  rootId: "root-1",
  rootEval: cp(0),
  depth: 14,
  stability: "stable",
  moves: [
    { uci: "e2e4", san: "e4", evalAfter: cp(20) },
    { uci: "e7e5", san: "e5", evalAfter: cp(10) },
  ],
  createdAt: Date.now(),
  ...overrides,
});

const makeCtx = (): ValidationContext => {
  const config = makeConfig();
  const root = makeRoot();
  const pv = makePv();
  return {
    roots: new Map([[root.id, root]]),
    pvs: new Map([[pv.id, pv]]),
    config,
  };
};

const mech = (rule: ProofMechanical["rule"], sq = "e4", p = "N"): ProofMechanical => ({
  kind: "mechanical",
  rule,
  squares: [sq],
  pieces: [p],
});

const makeNode = (id: string, proofs: EvidenceNode["proofs"] = [mech("GEOMETRY_FORK")]): EvidenceNode => ({
  id,
  kind: "state_fact",
  confidence: "verified",
  positionRef: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  moveRef: null,
  proofs,
});

const makeEdge = (id: string, from: string, to: string, type: "enables" | "causes" = "causes"): CausalEdge => ({
  id,
  from,
  to,
  type,
  proof: mech("LEGAL_MOVE"),
});

const makeGraph = (
  nodes: EvidenceNode[] = [makeNode("n1"), makeNode("n2")],
  edges: CausalEdge[] = [makeEdge("e1", "n1", "n2")],
): EvidenceGraph => ({
  nodes: new Map(nodes.map((n) => [n.id, n])),
  causalEdges: edges,
  metadata: { duplicates: [], sharedRoots: [] },
  rootPositionFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  analysisComplete: true,
});

// ─── ProofMechanical (5) ──────────────────────────────────

test("proof_mechanical_valid", () => {
  assert.doesNotThrow(() => validateProofMechanical(mech("GEOMETRY_FORK")));
});

test("proof_mechanical_rejects_empty_squares", () => {
  assert.throws(
    () => validateProofMechanical({ ...mech("GEOMETRY_FORK"), squares: [] }),
    ContractViolation,
  );
});

test("proof_mechanical_rejects_invalid_square", () => {
  assert.throws(
    () => validateProofMechanical({ ...mech("GEOMETRY_FORK"), squares: ["z9"] }),
    ContractViolation,
  );
});

test("proof_mechanical_rejects_invalid_piece", () => {
  assert.throws(
    () => validateProofMechanical({ ...mech("GEOMETRY_FORK"), pieces: ["X"] }),
    ContractViolation,
  );
});

test("proof_mechanical_rejects_rule_not_in_allowlist", () => {
  assert.throws(
    () => validateProofMechanical({
      ...mech("GEOMETRY_FORK"),
      rule: "MADE_UP_RULE" as never,
    }),
    ContractViolation,
  );
});

// ─── ProofEngine (3) ──────────────────────────────────────

test("proof_engine_valid", () => {
  const pv = makePv();
  const proof: ProofEngine = {
    kind: "engine",
    pvId: pv.id,
    depth: pv.depth,
    evalBefore: pv.rootEval,
    evalAfter: pv.moves[pv.moves.length - 1].evalAfter,
  };
  assert.doesNotThrow(() =>
    validateProofEngine(proof, new Map([[pv.id, pv]])),
  );
});

test("proof_engine_rejects_missing_pv", () => {
  const proof: ProofEngine = {
    kind: "engine",
    pvId: "ghost",
    depth: 14,
    evalBefore: cp(0),
    evalAfter: cp(10),
  };
  assert.throws(
    () => validateProofEngine(proof, new Map()),
    ContractViolation,
  );
});

test("proof_engine_rejects_eval_mismatch", () => {
  const pv = makePv();
  const proof: ProofEngine = {
    kind: "engine",
    pvId: pv.id,
    depth: pv.depth,
    evalBefore: cp(999),  // wrong
    evalAfter: pv.moves[pv.moves.length - 1].evalAfter,
  };
  assert.throws(
    () => validateProofEngine(proof, new Map([[pv.id, pv]])),
    ContractViolation,
  );
});

// ─── ProofConsequence (4) ─────────────────────────────────

test("proof_consequence_valid", () => {
  const pv = makePv();
  const proof: ProofConsequence = {
    kind: "consequence",
    pvId: pv.id,
    demonstratedAtPly: 1,
    materialLossCp: 300,
  };
  assert.doesNotThrow(() =>
    validateProofConsequence(proof, new Map([[pv.id, pv]])),
  );
});

test("proof_consequence_rejects_out_of_range_ply", () => {
  const pv = makePv();
  const proof: ProofConsequence = {
    kind: "consequence",
    pvId: pv.id,
    demonstratedAtPly: 5,  // pv has only 2 moves
    materialLossCp: 300,
  };
  assert.throws(
    () => validateProofConsequence(proof, new Map([[pv.id, pv]])),
    ContractViolation,
  );
});

test("proof_consequence_rejects_zero_material_loss", () => {
  const pv = makePv();
  const proof: ProofConsequence = {
    kind: "consequence",
    pvId: pv.id,
    demonstratedAtPly: 0,
    materialLossCp: 0,
  };
  assert.throws(
    () => validateProofConsequence(proof, new Map([[pv.id, pv]])),
    ContractViolation,
  );
});

test("proof_consequence_rejects_negative_material_loss", () => {
  const pv = makePv();
  const proof: ProofConsequence = {
    kind: "consequence",
    pvId: pv.id,
    demonstratedAtPly: 0,
    materialLossCp: -100,
  };
  assert.throws(
    () => validateProofConsequence(proof, new Map([[pv.id, pv]])),
    ContractViolation,
  );
});

// ─── EvidenceGraph structural (5) ─────────────────────────

test("graph_valid_simple_chain", () => {
  assert.doesNotThrow(() => validateEvidenceGraph(makeGraph(), makeCtx()));
});

test("graph_rejects_map_key_mismatch", () => {
  const node = makeNode("n1");
  const graph = makeGraph([node], []);
  // Manually put wrong key
  const wrongGraph: EvidenceGraph = {
    ...graph,
    nodes: new Map([["wrong-key", node]]),
  };
  assert.throws(() => validateEvidenceGraph(wrongGraph, makeCtx()), ContractViolation);
});

test("graph_rejects_edge_to_missing_node", () => {
  const graph = makeGraph(
    [makeNode("n1")],
    [makeEdge("e1", "n1", "ghost")],
  );
  assert.throws(() => validateEvidenceGraph(graph, makeCtx()), ContractViolation);
});

test("graph_rejects_duplicate_edge_id", () => {
  const graph = makeGraph(
    [makeNode("n1"), makeNode("n2"), makeNode("n3")],
    [makeEdge("e1", "n1", "n2"), makeEdge("e1", "n2", "n3")],
  );
  assert.throws(() => validateEvidenceGraph(graph, makeCtx()), ContractViolation);
});

test("graph_rejects_node_without_proofs", () => {
  const graph = makeGraph([makeNode("n1", [])], []);
  assert.throws(() => validateEvidenceGraph(graph, makeCtx()), ContractViolation);
});

// ─── Cycles (3) ───────────────────────────────────────────

test("graph_rejects_self_loop", () => {
  const graph = makeGraph(
    [makeNode("n1")],
    [makeEdge("e1", "n1", "n1")],
  );
  assert.throws(() => validateEvidenceGraph(graph, makeCtx()), ContractViolation);
});

test("graph_rejects_two_node_cycle", () => {
  const graph = makeGraph(
    [makeNode("n1"), makeNode("n2")],
    [makeEdge("e1", "n1", "n2"), makeEdge("e2", "n2", "n1")],
  );
  assert.throws(() => validateEvidenceGraph(graph, makeCtx()), ContractViolation);
});

test("graph_accepts_dag", () => {
  const graph = makeGraph(
    [makeNode("n1"), makeNode("n2"), makeNode("n3")],
    [makeEdge("e1", "n1", "n2"), makeEdge("e2", "n2", "n3")],
  );
  assert.doesNotThrow(() => validateEvidenceGraph(graph, makeCtx()));
});

// ─── hasCausalPath (3) ────────────────────────────────────

test("has_path_direct", () => {
  const graph = makeGraph(
    [makeNode("n1"), makeNode("n2")],
    [makeEdge("e1", "n1", "n2")],
  );
  assert.equal(hasCausalPath(graph, "n1", "n2"), true);
});

test("has_path_transitive", () => {
  const graph = makeGraph(
    [makeNode("n1"), makeNode("n2"), makeNode("n3")],
    [makeEdge("e1", "n1", "n2"), makeEdge("e2", "n2", "n3")],
  );
  assert.equal(hasCausalPath(graph, "n1", "n3"), true);
});

test("has_path_no_reverse", () => {
  const graph = makeGraph(
    [makeNode("n1"), makeNode("n2")],
    [makeEdge("e1", "n1", "n2")],
  );
  assert.equal(hasCausalPath(graph, "n2", "n1"), false);
});
