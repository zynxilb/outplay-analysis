// tests/analysis/localize-ar.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  localizeExplanation,
  localizeExplanations,
} from "../../lib/analysis/explain/localize/ar.ts";
import { computeConfigHash } from "../../lib/analysis/core/contracts.ts";
import type {
  AnalysisConfig,
  AnalysisRoot,
  AnalyzedGame,
  ClassifiedMove,
  EvidenceGraph,
  EvidenceNode,
  ExplanationOutput,
  MateTransition,
  PVRecord,
} from "../../lib/analysis/core/types.ts";
import { FIXTURE_CONFIG } from "../fixtures/classification-golden.ts";

const CONFIG = FIXTURE_CONFIG as unknown as AnalysisConfig;
const CONFIG_HASH = computeConfigHash(CONFIG.engine);

// ─── Fixtures ────────────────────────────────────────────

function node(
  id: string,
  kind: EvidenceNode["kind"],
): EvidenceNode {
  return {
    id, kind,
    confidence: "verified",
    positionRef: "FEN", moveRef: null,
    proofs: [{ kind: "mechanical", rule: "LEGAL_MOVE", squares: ["e2"], pieces: ["P"] }],
  };
}

function engNode(id: string, pvId: string): EvidenceNode {
  return {
    id, kind: "mechanism",
    confidence: "verified",
    positionRef: "FEN", moveRef: null,
    proofs: [{
      kind: "engine", pvId, depth: 10,
      evalBefore: { type: "cp", value: 0 },
      evalAfter: { type: "unknown" },
    }],
  };
}

function makeGraph(nodes: EvidenceNode[]): EvidenceGraph {
  return {
    nodes: new Map(nodes.map((n) => [n.id, n])),
    causalEdges: [],
    metadata: { duplicates: [], sharedRoots: [] },
    rootPositionFen: "FEN",
    analysisComplete: true,
  };
}

function makeMateDeliveredMove(ply: number, san: string): ClassifiedMove {
  return {
    ply, san, quality: "Best", annotations: [],
    evaluation: { type: "terminal", kind: "checkmate", winner: "white" },
    expectedScore: null,
    mateVerdict: null,
    classificationVersion: "test",
  };
}

function makeMissedMateMove(
  ply: number,
  san: string,
  mateIn: number,
): ClassifiedMove {
  const mv: MateTransition = {
    before: { type: "mate", in: mateIn, winner: "white" },
    afterPlayed: { type: "cp", value: -100 },
    expectedAfterBest: { type: "terminal", kind: "checkmate", winner: "white" },
    moverColor: "w",
    verdict: { kind: "lost" },
  };
  return {
    ply, san, quality: "Blunder", annotations: [],
    evaluation: { type: "cp", value: -100 },
    expectedScore: null,
    mateVerdict: mv,
    classificationVersion: "test",
  };
}

function makeRoot(id: string, fen: string): AnalysisRoot {
  return {
    id, fen,
    sideToMove: "w",
    purpose: "find-best-move",
    engineIdentity: CONFIG.engine.identity,
    configHash: CONFIG_HASH,
    evaluationPerspective: "white",
    searchBudget: { kind: "movetime", value: 300 },
  };
}

function makeGame(overrides: Partial<AnalyzedGame> = {}): AnalyzedGame {
  return {
    pgn: "",
    status: "complete",
    failures: [],
    roots: new Map(),
    pvs: new Map(),
    moves: [],
    explanations: new Map(),
    localizedExplanations: new Map(),
    refutations: new Map(),
    config: CONFIG,
    ...overrides,
  };
}

function makeExplainedOutput(
  rootCauseId: string,
  mechanismId: string,
  consequenceId: string,
): ExplanationOutput {
  return {
    status: "explained",
    primary: {
      rootCause: node(rootCauseId, "state_fact"),
      causalChain: [{
        mechanism: node(mechanismId, "mechanism"),
        consequence: node(consequenceId, "consequence"),
      }],
      supportingEvidence: [],
      confidence: "verified",
    },
    secondary: [],
  };
}

// ═══════════════════════════════════════════════════════════
// MATE_DELIVERED
// ═══════════════════════════════════════════════════════════

test("localize_mate_delivered_success", () => {
  const output = makeExplainedOutput("mate_delivered_33", "mate_delivered_33", "mate_delivered_game_over_33");
  const graph = makeGraph([
    node("mate_delivered_33", "state_fact"),
    node("mate_delivered_game_over_33", "consequence"),
  ]);
  const game = makeGame({
    moves: [makeMateDeliveredMove(33, "Rd8#")],
  });

  const result = localizeExplanation(output, graph, game);
  assert.ok(result);
  assert.equal(result.templateId, "MATE_DELIVERED");
  assert.equal(result.headline, "كش مات!");
  assert.equal(result.detail, "Rd8# أنهت المباراة.");
  assert.equal(result.ply, 33);
});

test("localize_mate_delivered_silent_output_returns_null", () => {
  const output: ExplanationOutput = { status: "silent", reason: "NO_CAUSE_FOUND" };
  const graph = makeGraph([]);
  const game = makeGame();
  assert.equal(localizeExplanation(output, graph, game), null);
});

test("localize_mate_delivered_missing_move_returns_null", () => {
  const output = makeExplainedOutput("mate_delivered_33", "mate_delivered_33", "mate_delivered_game_over_33");
  const graph = makeGraph([node("mate_delivered_33", "state_fact")]);
  const game = makeGame({ moves: [] });
  assert.equal(localizeExplanation(output, graph, game), null);
});

test("localize_mate_delivered_non_terminal_eval_returns_null", () => {
  // Move classified as mate_delivered but evaluation is not terminal checkmate
  const badMove: ClassifiedMove = {
    ...makeMateDeliveredMove(33, "Rd8#"),
    evaluation: { type: "cp", value: 20 },
  };
  const output = makeExplainedOutput("mate_delivered_33", "mate_delivered_33", "mate_delivered_game_over_33");
  const graph = makeGraph([node("mate_delivered_33", "state_fact")]);
  const game = makeGame({ moves: [badMove] });
  assert.equal(localizeExplanation(output, graph, game), null);
});

// ═══════════════════════════════════════════════════════════
// MISSED_MATE
// ═══════════════════════════════════════════════════════════

test("localize_missed_mate_success", () => {
  const pv: PVRecord = {
    id: "pv-1", rootId: "root-1",
    rootEval: { type: "mate", in: 2, winner: "white" },
    depth: 10, stability: "stable",
    moves: [
      { uci: "a1a8", san: "Ra8#", evalAfter: { type: "terminal", kind: "checkmate", winner: "white" } },
    ],
    createdAt: Date.now(),
  };
  const output = makeExplainedOutput("missed_mate_available_1", "missed_mate_pv_1", "missed_mate_missed_1");
  const graph = makeGraph([
    node("missed_mate_available_1", "state_fact"),
    engNode("missed_mate_pv_1", "pv-1"),
    node("missed_mate_missed_1", "consequence"),
  ]);
  const game = makeGame({
    pvs: new Map([["pv-1", pv]]),
    moves: [makeMissedMateMove(1, "Ra2", 2)],
  });

  const result = localizeExplanation(output, graph, game);
  assert.ok(result);
  assert.equal(result.templateId, "MISSED_MATE");
  assert.equal(result.headline, "فوّتت مات!");
  assert.ok(result.detail.includes("مات في 2"));
  assert.ok(result.detail.includes("Ra8#"));
  assert.ok(result.detail.includes("Ra2"));
  assert.equal(result.ply, 1);
});

test("localize_missed_mate_missing_pv_returns_null", () => {
  const output = makeExplainedOutput("missed_mate_available_1", "missed_mate_pv_1", "missed_mate_missed_1");
  const graph = makeGraph([
    node("missed_mate_available_1", "state_fact"),
    engNode("missed_mate_pv_1", "pv-1"),
    node("missed_mate_missed_1", "consequence"),
  ]);
  const game = makeGame({
    pvs: new Map(), // empty — missing pv
    moves: [makeMissedMateMove(1, "Ra2", 2)],
  });
  assert.equal(localizeExplanation(output, graph, game), null);
});

test("localize_missed_mate_missing_mate_verdict_returns_null", () => {
  const pv: PVRecord = {
    id: "pv-1", rootId: "root-1",
    rootEval: { type: "mate", in: 2, winner: "white" },
    depth: 10, stability: "stable",
    moves: [{ uci: "a1a8", san: "Ra8#", evalAfter: { type: "unknown" } }],
    createdAt: Date.now(),
  };
  const output = makeExplainedOutput("missed_mate_available_1", "missed_mate_pv_1", "missed_mate_missed_1");
  const graph = makeGraph([
    node("missed_mate_available_1", "state_fact"),
    engNode("missed_mate_pv_1", "pv-1"),
    node("missed_mate_missed_1", "consequence"),
  ]);
  // Move with null mateVerdict
  const badMove: ClassifiedMove = {
    ...makeMissedMateMove(1, "Ra2", 2),
    mateVerdict: null,
  };
  const game = makeGame({
    pvs: new Map([["pv-1", pv]]),
    moves: [badMove],
  });
  assert.equal(localizeExplanation(output, graph, game), null);
});

// ═══════════════════════════════════════════════════════════
// Unknown template
// ═══════════════════════════════════════════════════════════

test("localize_unknown_template_returns_null", () => {
  // Unknown rootCause ID prefix — silent, no fabrication
  const output = makeExplainedOutput("future_fact_1", "future_mech_1", "future_conseq_1");
  const graph = makeGraph([
    node("future_fact_1", "state_fact"),
    node("future_mech_1", "mechanism"),
    node("future_conseq_1", "consequence"),
  ]);
  const game = makeGame();
  assert.equal(localizeExplanation(output, graph, game), null);
});

// ═══════════════════════════════════════════════════════════
// Determinism + batch
// ═══════════════════════════════════════════════════════════

test("localize_mate_delivered_deterministic", () => {
  const output = makeExplainedOutput("mate_delivered_33", "mate_delivered_33", "mate_delivered_game_over_33");
  const graph = makeGraph([node("mate_delivered_33", "state_fact")]);
  const game = makeGame({ moves: [makeMateDeliveredMove(33, "Rd8#")] });

  const r1 = localizeExplanation(output, graph, game);
  const r2 = localizeExplanation(output, graph, game);
  assert.deepEqual(r1, r2);
});

test("localize_explanations_batch_skips_nulls", () => {
  const outputOk = makeExplainedOutput("mate_delivered_33", "mate_delivered_33", "mate_delivered_game_over_33");
  const outputBad = makeExplainedOutput("unknown_5", "unknown_5", "unknown_5");
  const explanations = new Map([
    [33, outputOk],
    [5, outputBad],
  ]);
  const graph = makeGraph([node("mate_delivered_33", "state_fact")]);
  const game = makeGame({ moves: [makeMateDeliveredMove(33, "Rd8#")] });

  const result = localizeExplanations(explanations, graph, game);
  assert.equal(result.size, 1);
  assert.ok(result.has(33));
  assert.ok(!result.has(5));
});
