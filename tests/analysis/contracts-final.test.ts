// tests/analysis/contracts-final.test.ts
// Commit 2 — Runtime contract tests (batch 4: classification, motifs,
// explanation, refutation)

import { test } from "node:test";
import assert from "node:assert/strict";

import type {
  AnalysisConfig,
  AnalysisRoot,
  ClassifiedMove,
  ClassificationInput,
  Evaluation,
  ExplanationOutput,
  EvidenceGraph,
  EvidenceNode,
  MotifAttributed,
  MotifDetected,
  MotifVerified,
  PVRecord,
  PlannedExplanation,
  ProofMechanical,
  RefutationLine,
  SourcedEvaluation,
} from "../../lib/analysis/core/types.ts";

import {
  ContractViolation,
  deriveClassification,
  distanceTier,
  qualityFromEvaluation,
  validateClassificationInput,
  validateClassificationOutput,
  validateExplanationOutput,
  validateMotifAttributed,
  validateMotifVerified,
  validatePlannedExplanation,
  validateRefutationLine,
  computeConfigHash,
  type ValidationContext,
} from "../../lib/analysis/core/contracts.ts";

// ─── Helpers ──────────────────────────────────────────────

const cp = (value: number): Evaluation => ({ type: "cp", value });

const makeConfig = (): AnalysisConfig => ({
  version: "v1",
  engine: { identity: "sf-16.1", hashMb: 32, multiPv: 1 },
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
  motifs: { enabled: ["fork", "pin"], precisionTargets: { fork: 0.95, pin: 0.90 } },
  explanation: { secondaryContributionRatio: 0.25 },
});

const makeRoot = (
  cfg: AnalysisConfig,
  id: string,
  purpose: AnalysisRoot["purpose"],
): AnalysisRoot => ({
  id,
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  sideToMove: "w",
  purpose,
  engineIdentity: cfg.engine.identity,
  configHash: computeConfigHash(cfg.engine),
  evaluationPerspective: "white",
  searchBudget: { kind: "depth", value: 14 },
});

const makePv = (rootId: string, id: string): PVRecord => ({
  id,
  rootId,
  rootEval: cp(0),
  depth: 14,
  stability: "stable",
  moves: [
    { uci: "e2e4", san: "e4", evalAfter: cp(20) },
    { uci: "e7e5", san: "e5", evalAfter: cp(10) },
  ],
  createdAt: Date.now(),
});

const makeSetup = () => {
  const cfg = makeConfig();
  const preRoot = makeRoot(cfg, "pre-root", "find-best-move");
  const postRoot = makeRoot(cfg, "post-root", "find-opponent-response");
  const prePv = makePv(preRoot.id, "pre-pv");
  const postPv = makePv(postRoot.id, "post-pv");
  const ctx: ValidationContext = {
    config: cfg,
    roots: new Map([[preRoot.id, preRoot], [postRoot.id, postRoot]]),
    pvs: new Map([[prePv.id, prePv], [postPv.id, postPv]]),
  };
  return { cfg, preRoot, postRoot, prePv, postPv, ctx };
};

const makeClassInput = (
  s: ReturnType<typeof makeSetup>,
  epLoss: number = 0.06,
  cpLoss: number = 50,
): ClassificationInput => ({
  ply: 1,
  san: "e4",
  playedMoveUci: "e2e4",
  bestMoveUci: "d2d4",
  moverColor: "w",
  preMoveFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  postMoveFen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
  evalBefore: { eval: cp(0), pvId: s.prePv.id, rootId: s.preRoot.id, depth: 14 },
  evalAfterBest: { eval: cp(20), pvId: s.prePv.id, rootId: s.preRoot.id, depth: 14 },
  evalAfterPlayed: { eval: cp(10), pvId: s.postPv.id, rootId: s.postRoot.id, depth: 14 },
  epLoss,
  cpLoss,
  annotations: [],
  preMoveRootId: s.preRoot.id,
  postMoveRootId: s.postRoot.id,
});

// ─── qualityFromEvaluation (5) ─────────────────────────────

test("quality_best_below_excellent_threshold", () => {
  const cfg = makeConfig();
  assert.equal(qualityFromEvaluation(0, 0, cfg.classification), "Best");
});

test("quality_excellent_at_threshold", () => {
  const cfg = makeConfig();
  assert.equal(qualityFromEvaluation(0.01, 0, cfg.classification), "Excellent");
});

test("quality_blunder_at_threshold", () => {
  const cfg = makeConfig();
  assert.equal(qualityFromEvaluation(0.15, 0, cfg.classification), "Blunder");
});

test("quality_cp_floor_forces_inaccuracy", () => {
  const cfg = makeConfig();
  // EP says Best, but CP loss >= 200 forces floor at Inaccuracy
  assert.equal(qualityFromEvaluation(0, 250, cfg.classification), "Inaccuracy");
});

test("quality_cp_floor_does_not_upgrade", () => {
  const cfg = makeConfig();
  // EP says Blunder, CP floor would say Inaccuracy — but floor only raises
  assert.equal(qualityFromEvaluation(0.20, 250, cfg.classification), "Blunder");
});

// ─── distanceTier (4) ─────────────────────────────────────

test("distance_tier_zero_is_best", () => {
  assert.equal(distanceTier(0, makeConfig().classification), "Best");
});

test("distance_tier_one_is_excellent", () => {
  assert.equal(distanceTier(1, makeConfig().classification), "Excellent");
});

test("distance_tier_three_is_good", () => {
  assert.equal(distanceTier(3, makeConfig().classification), "Good");
});

test("distance_tier_above_mistake_is_blunder", () => {
  assert.equal(distanceTier(20, makeConfig().classification), "Blunder");
});

// ─── deriveClassification (3) ─────────────────────────────

test("derive_classification_ep_path", () => {
  const s = makeSetup();
  const input = makeClassInput(s, 0.06, 0);
  const out = deriveClassification(input, s.cfg);
  assert.equal(out.quality, "Inaccuracy");
});

test("derive_classification_preserves_annotations", () => {
  const s = makeSetup();
  const input = { ...makeClassInput(s), annotations: ["BRILLIANT" as const] };
  const out = deriveClassification(input, s.cfg);
  assert.ok(out.annotations.includes("BRILLIANT"));
});

test("derive_classification_mate_lost_returns_blunder", () => {
  const s = makeSetup();
  const base = makeClassInput(s);
  // Contract v2: mate is now in evalBefore. expectedAfterBestMove projects
  // mate(3) → mate(2). Played is cp(0) → lost → Blunder.
  const input: ClassificationInput = {
    ...base,
    evalBefore: { ...base.evalBefore, eval: { type: "mate", in: 3, winner: "white" } },
    evalAfterPlayed: { ...base.evalAfterPlayed, eval: cp(0) },
  };
  const out = deriveClassification(input, s.cfg);
  assert.equal(out.quality, "Blunder");
});

// ─── validateClassificationInput (2) ─────────────────────

test("class_input_valid", () => {
  const s = makeSetup();
  assert.doesNotThrow(() => validateClassificationInput(makeClassInput(s)));
});

test("class_input_rejects_mover_color_mismatch", () => {
  const s = makeSetup();
  const bad = { ...makeClassInput(s), moverColor: "b" as const };
  assert.throws(() => validateClassificationInput(bad), ContractViolation);
});

// ─── validateClassificationOutput (3) ────────────────────

const makeClassified = (s: ReturnType<typeof makeSetup>, overrides: Partial<ClassifiedMove> = {}): ClassifiedMove => {
  const input = makeClassInput(s);
  const derived = deriveClassification(input, s.cfg);
  return {
    ply: input.ply,
    san: input.san,
    quality: derived.quality,
    annotations: [...derived.annotations],
    evaluation: input.evalAfterPlayed.eval,
    expectedScore: null,
    mateVerdict: null,
    classificationVersion: "v1",
    ...overrides,
  };
};

test("class_output_valid", () => {
  const s = makeSetup();
  const input = makeClassInput(s);
  const output = makeClassified(s);
  assert.doesNotThrow(() => validateClassificationOutput(input, output, s.cfg));
});

test("class_output_rejects_wrong_quality", () => {
  const s = makeSetup();
  const input = makeClassInput(s);
  const output = makeClassified(s, { quality: "Best" });
  assert.throws(() => validateClassificationOutput(input, output, s.cfg), ContractViolation);
});

test("class_output_rejects_invented_annotation", () => {
  const s = makeSetup();
  const input = makeClassInput(s);
  const output = makeClassified(s, { annotations: ["BRILLIANT" as const] });
  assert.throws(() => validateClassificationOutput(input, output, s.cfg), ContractViolation);
});

// ─── Motif validators (4) ────────────────────────────────

const mech = (rule: ProofMechanical["rule"], sq = "e4", p = "N"): ProofMechanical => ({
  kind: "mechanical",
  rule,
  squares: [sq],
  pieces: [p],
});

const makeDetected = (): MotifDetected => ({
  id: "motif-1",
  kind: "fork",
  positionFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  geometry: {},
});

const makeVerified = (): MotifVerified => ({
  detected: makeDetected(),
  kind: "fork",
  mechanicalProof: mech("GEOMETRY_FORK"),
  engineConfirmation: null,
});

test("motif_verified_valid", () => {
  assert.doesNotThrow(() => validateMotifVerified(makeDetected(), makeVerified()));
});

test("motif_verified_rejects_kind_mismatch", () => {
  const v = makeVerified();
  const bad: MotifVerified = { ...v, kind: "pin", mechanicalProof: mech("GEOMETRY_PIN") };
  assert.throws(() => validateMotifVerified(makeDetected(), bad), ContractViolation);
});

test("motif_verified_rejects_wrong_rule_for_kind", () => {
  const v = makeVerified();
  const bad: MotifVerified = { ...v, mechanicalProof: mech("GEOMETRY_PIN") };
  assert.throws(() => validateMotifVerified(makeDetected(), bad), ContractViolation);
});

test("motif_verified_rejects_detected_id_mismatch", () => {
  const v = makeVerified();
  const bad: MotifVerified = {
    ...v,
    detected: { ...v.detected, id: "different" },
  };
  assert.throws(() => validateMotifVerified(makeDetected(), bad), ContractViolation);
});

// ─── Explanation (3) ─────────────────────────────────────

const makeNode = (id: string): EvidenceNode => ({
  id,
  kind: "state_fact",
  confidence: "verified",
  positionRef: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  moveRef: null,
  proofs: [mech("GEOMETRY_FORK")],
});

const makeGraph = (): EvidenceGraph => {
  const n1 = makeNode("n1");
  const n2 = makeNode("n2");
  return {
    nodes: new Map([[n1.id, n1], [n2.id, n2]]),
    causalEdges: [{
      id: "e1", from: "n1", to: "n2", type: "causes",
      proof: mech("LEGAL_MOVE"),
    }],
    metadata: { duplicates: [], sharedRoots: [] },
    rootPositionFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    analysisComplete: true,
  };
};

test("explanation_valid", () => {
  const g = makeGraph();
  const plan: PlannedExplanation = {
    rootCause: g.nodes.get("n1")!,
    causalChain: [{ mechanism: g.nodes.get("n1")!, consequence: g.nodes.get("n2")! }],
    supportingEvidence: [],
    confidence: "verified",
  };
  assert.doesNotThrow(() => validatePlannedExplanation(plan, g));
});

test("explanation_rejects_disconnected_nodes", () => {
  const g = makeGraph();
  const orphan: EvidenceNode = makeNode("orphan");
  const gWithOrphan: EvidenceGraph = {
    ...g,
    nodes: new Map([...g.nodes, [orphan.id, orphan]]),
  };
  const plan: PlannedExplanation = {
    rootCause: gWithOrphan.nodes.get("n1")!,
    causalChain: [{ mechanism: gWithOrphan.nodes.get("n1")!, consequence: orphan }],
    supportingEvidence: [],
    confidence: "verified",
  };
  assert.throws(() => validatePlannedExplanation(plan, gWithOrphan), ContractViolation);
});

test("explanation_output_validates_silent_reason", () => {
  const g = makeGraph();
  const bad: ExplanationOutput = { status: "silent", reason: "" as never };
  assert.throws(() => validateExplanationOutput(bad, g), ContractViolation);
});

// ─── Refutation (3) ──────────────────────────────────────

const makeRefutation = (
  s: ReturnType<typeof makeSetup>,
  overrides: Partial<RefutationLine> = {},
): RefutationLine => ({
  mode: { kind: "punishment", targetMove: "played" },
  state: { kind: "consequence_demonstrated", lostMaterial: 300, atPly: 1 },
  moves: [...s.postPv.moves],
  rootId: s.postRoot.id,
  sourcedFromPvId: s.postPv.id,
  sourcedFromDepth: s.postPv.depth,
  ...overrides,
});

test("refutation_valid", () => {
  const s = makeSetup();
  assert.doesNotThrow(() =>
    validateRefutationLine(makeRefutation(s), s.preRoot, s.postRoot, s.ctx.pvs),
  );
});

test("refutation_rejects_wrong_root_for_punishment", () => {
  const s = makeSetup();
  const bad = makeRefutation(s, { rootId: s.preRoot.id });
  assert.throws(() =>
    validateRefutationLine(bad, s.preRoot, s.postRoot, s.ctx.pvs),
    ContractViolation,
  );
});

test("refutation_rejects_consequence_without_2_plies", () => {
  const s = makeSetup();
  const singleMovePv: PVRecord = { ...s.postPv, moves: [s.postPv.moves[0]], id: "short-pv" };
  const ctx: ValidationContext = {
    ...s.ctx,
    pvs: new Map([...s.ctx.pvs, [singleMovePv.id, singleMovePv]]),
  };
  const bad = makeRefutation(s, {
    moves: [...singleMovePv.moves],
    sourcedFromPvId: singleMovePv.id,
  });
  assert.throws(() =>
    validateRefutationLine(bad, s.preRoot, s.postRoot, ctx.pvs),
    ContractViolation,
  );
});
