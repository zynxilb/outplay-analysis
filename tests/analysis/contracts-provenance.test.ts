// tests/analysis/contracts-provenance.test.ts
// Commit 2 — Runtime contract tests (batch 3: PV provenance + comparison)

import { test } from "node:test";
import assert from "node:assert/strict";

import type {
  AnalysisConfig,
  AnalysisRoot,
  ClassificationInput,
  Evaluation,
  PVRecord,
  SourcedEvaluation,
} from "../../lib/analysis/core/types.ts";

import {
  ContractViolation,
  validateAnalysisConfig,
  validateComparisonCompatibility,
  validatePV,
  validatePvProvenance,
  validateSourcedEvaluation,
  computeConfigHash,
  type ValidationContext,
} from "../../lib/analysis/core/contracts.ts";

// ─── Helpers ──────────────────────────────────────────────

const cp = (value: number): Evaluation => ({ type: "cp", value });

const makeConfig = (overrides: Partial<AnalysisConfig["engine"]> = {}): AnalysisConfig => ({
  version: "v1",
  engine: { identity: "sf-16.1", hashMb: 32, multiPv: 1, ...overrides },
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

const makeRoot = (
  cfg: AnalysisConfig,
  overrides: Partial<AnalysisRoot> = {},
): AnalysisRoot => ({
  id: "root-1",
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  sideToMove: "w",
  purpose: "find-best-move",
  engineIdentity: cfg.engine.identity,
  configHash: computeConfigHash(cfg.engine),
  evaluationPerspective: "white",
  searchBudget: { kind: "depth", value: 14 },
  ...overrides,
});

const makePv = (root: AnalysisRoot, overrides: Partial<PVRecord> = {}): PVRecord => ({
  id: "pv-1",
  rootId: root.id,
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

const makeCtx = (): {
  cfg: AnalysisConfig;
  preRoot: AnalysisRoot;
  postRoot: AnalysisRoot;
  prePv: PVRecord;
  postPv: PVRecord;
  ctx: ValidationContext;
} => {
  const cfg = makeConfig();
  const preRoot = makeRoot(cfg, {
    id: "pre-root",
    purpose: "find-best-move",
  });
  const postRoot = makeRoot(cfg, {
    id: "post-root",
    purpose: "find-opponent-response",
  });
  const prePv = makePv(preRoot, { id: "pre-pv" });
  const postPv = makePv(postRoot, { id: "post-pv" });
  const ctx: ValidationContext = {
    config: cfg,
    roots: new Map([
      [preRoot.id, preRoot],
      [postRoot.id, postRoot],
    ]),
    pvs: new Map([
      [prePv.id, prePv],
      [postPv.id, postPv],
    ]),
  };
  return { cfg, preRoot, postRoot, prePv, postPv, ctx };
};

// ─── validatePV (4) ───────────────────────────────────────

test("pv_valid", () => {
  const { preRoot, prePv } = makeCtx();
  assert.doesNotThrow(() => validatePV(prePv, preRoot));
});

test("pv_rejects_root_id_mismatch", () => {
  const { preRoot, prePv } = makeCtx();
  const wrong: PVRecord = { ...prePv, rootId: "different-root" };
  assert.throws(() => validatePV(wrong, preRoot), ContractViolation);
});

test("pv_rejects_empty_moves", () => {
  const { preRoot, prePv } = makeCtx();
  const empty: PVRecord = { ...prePv, moves: [] };
  assert.throws(() => validatePV(empty, preRoot), ContractViolation);
});

test("pv_rejects_negative_depth", () => {
  const { preRoot, prePv } = makeCtx();
  const bad: PVRecord = { ...prePv, depth: -1 };
  assert.throws(() => validatePV(bad, preRoot), ContractViolation);
});

// ─── validatePvProvenance (3) ─────────────────────────────

test("pv_provenance_valid", () => {
  const { prePv, ctx } = makeCtx();
  assert.doesNotThrow(() => validatePvProvenance(prePv, ctx));
});

test("pv_provenance_rejects_unregistered_root", () => {
  const { prePv, ctx } = makeCtx();
  const orphan: PVRecord = { ...prePv, rootId: "ghost" };
  assert.throws(() => validatePvProvenance(orphan, ctx), ContractViolation);
});

test("pv_provenance_rejects_engine_mismatch", () => {
  const { preRoot, prePv, ctx } = makeCtx();
  const wrongRoot: AnalysisRoot = { ...preRoot, engineIdentity: "sf-OLD" };
  const ctx2: ValidationContext = {
    ...ctx,
    roots: new Map([...ctx.roots, [wrongRoot.id, wrongRoot]]),
  };
  assert.throws(() => validatePvProvenance(prePv, ctx2), ContractViolation);
});

// ─── validateSourcedEvaluation (5) ────────────────────────

test("sourced_eval_valid", () => {
  const { prePv, preRoot, ctx } = makeCtx();
  const se: SourcedEvaluation = {
    eval: cp(0),
    pvId: prePv.id,
    rootId: preRoot.id,
    depth: prePv.depth,
  };
  assert.doesNotThrow(() => validateSourcedEvaluation(se, preRoot.id, ctx));
});

test("sourced_eval_rejects_missing_pv", () => {
  const { preRoot, ctx } = makeCtx();
  const se: SourcedEvaluation = {
    eval: cp(0),
    pvId: "ghost-pv",
    rootId: preRoot.id,
    depth: 14,
  };
  assert.throws(() => validateSourcedEvaluation(se, preRoot.id, ctx), ContractViolation);
});

test("sourced_eval_rejects_root_mismatch_with_pv", () => {
  const { prePv, postRoot, ctx } = makeCtx();
  const se: SourcedEvaluation = {
    eval: cp(0),
    pvId: prePv.id,
    rootId: postRoot.id,   // pv belongs to preRoot, but se says postRoot
    depth: 14,
  };
  assert.throws(() => validateSourcedEvaluation(se, postRoot.id, ctx), ContractViolation);
});

test("sourced_eval_rejects_wrong_expected_root", () => {
  const { prePv, preRoot, postRoot, ctx } = makeCtx();
  const se: SourcedEvaluation = {
    eval: cp(0),
    pvId: prePv.id,
    rootId: preRoot.id,
    depth: 14,
  };
  // Say we expected postRoot, but se.rootId is preRoot → mismatch
  assert.throws(() => validateSourcedEvaluation(se, postRoot.id, ctx), ContractViolation);
});

test("sourced_eval_rejects_depth_mismatch", () => {
  const { prePv, preRoot, ctx } = makeCtx();
  const se: SourcedEvaluation = {
    eval: cp(0),
    pvId: prePv.id,
    rootId: preRoot.id,
    depth: prePv.depth + 5,   // wrong
  };
  assert.throws(() => validateSourcedEvaluation(se, preRoot.id, ctx), ContractViolation);
});

// ─── validateComparisonCompatibility (4) ──────────────────

const makeClassificationInput = (
  ctx: ReturnType<typeof makeCtx>,
): ClassificationInput => ({
  ply: 1,
  san: "e4",
  playedMoveUci: "e2e4",
  bestMoveUci: "d2d4",
  moverColor: "w",
  preMoveFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  postMoveFen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
  evalBefore: {
    eval: cp(0),
    pvId: ctx.prePv.id,
    rootId: ctx.preRoot.id,
    depth: ctx.prePv.depth,
  },
  evalAfterBest: {
    eval: cp(20),
    pvId: ctx.prePv.id,
    rootId: ctx.preRoot.id,
    depth: ctx.prePv.depth,
  },
  evalAfterPlayed: {
    eval: cp(10),
    pvId: ctx.postPv.id,
    rootId: ctx.postRoot.id,
    depth: ctx.postPv.depth,
  },
  epLoss: 0.02,
  cpLoss: 10,
  annotations: [],
  preMoveRootId: ctx.preRoot.id,
  postMoveRootId: ctx.postRoot.id,
});

test("comparison_compat_valid", () => {
  const m = makeCtx();
  const input = makeClassificationInput(m);
  assert.doesNotThrow(() => validateComparisonCompatibility(input, m.ctx));
});

test("comparison_rejects_same_pv_for_before_and_played", () => {
  const m = makeCtx();
  const input = makeClassificationInput(m);
  const bad: ClassificationInput = {
    ...input,
    evalAfterPlayed: { ...input.evalAfterPlayed, pvId: input.evalBefore.pvId },
  };
  assert.throws(() => validateComparisonCompatibility(bad, m.ctx), ContractViolation);
});

test("comparison_rejects_played_sharing_pv_with_before", () => {
  // Contract v2: evalAfterBest is removed. The remaining PV-sharing rule is:
  // evalAfterPlayed must NOT share PV with evalBefore (different roots).
  const m = makeCtx();
  const input = makeClassificationInput(m);
  const bad: ClassificationInput = {
    ...input,
    evalAfterPlayed: { ...input.evalAfterPlayed, pvId: input.evalBefore.pvId },
  };
  assert.throws(() => validateComparisonCompatibility(bad, m.ctx), ContractViolation);
});

test("comparison_rejects_budget_value_mismatch", () => {
  const m = makeCtx();
  const input = makeClassificationInput(m);
  const postRootDeeper: AnalysisRoot = {
    ...m.postRoot,
    searchBudget: { kind: "depth", value: 16 },
  };
  const ctx2: ValidationContext = {
    ...m.ctx,
    roots: new Map([...m.ctx.roots, [postRootDeeper.id, postRootDeeper]]),
  };
  assert.throws(() => validateComparisonCompatibility(input, ctx2), ContractViolation);
});

// ─── validateAnalysisConfig (4) ───────────────────────────

test("config_valid", () => {
  assert.doesNotThrow(() => validateAnalysisConfig(makeConfig()));
});

test("config_rejects_unordered_thresholds", () => {
  const bad = makeConfig();
  (bad.classification.epLossThresholds as any).Good = -0.01;
  assert.throws(() => validateAnalysisConfig(bad), ContractViolation);
});

test("config_rejects_negative_cp_secondary", () => {
  const bad = makeConfig();
  (bad.classification as any).cpLossSecondaryThreshold = -50;
  assert.throws(() => validateAnalysisConfig(bad), ContractViolation);
});

test("config_rejects_missing_version", () => {
  const bad = makeConfig();
  (bad as any).version = "";
  assert.throws(() => validateAnalysisConfig(bad), ContractViolation);
});
