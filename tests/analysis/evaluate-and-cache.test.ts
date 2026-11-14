// tests/analysis/evaluate-and-cache.test.ts
// Stage 2 — ExpectedScore + toQuality + LRUEvalCache

import { test } from "node:test";
import assert from "node:assert/strict";

import type {
  AnalysisConfig,
  Evaluation,
  PVRecord,
} from "../../lib/analysis/core/types.ts";

import {
  toExpectedScore as directToExpectedScore,
  epLossFor,
} from "../../lib/analysis/evaluate/expected-score.ts";

import {
  toExpectedScore,
  toQuality,
  __resetConfigValidationForTests,
} from "../../lib/analysis/evaluate/index.ts";

import {
  LRUEvalCache,
  makeEvalCacheKey,
} from "../../lib/analysis/engine/eval-cache.ts";

// ─── Config fixture ───────────────────────────────────────

const makeConfig = (): AnalysisConfig => ({
  version: "v1",
  engine: { identity: "sf-19.0.1-lite-single", hashMb: 32, multiPv: 1 },
  budgets: {
    initialDepth: 10, refinementDepth: 14, finalDepth: 18,
    initialTargetMs: 500, reSearchMs: 300,
  },
  evaluation: {
    epCoefficient: 0.00368208,
    mateOrderingValue: 10000,
    evaluationModelVersion: "ep-v1",
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

const cp = (value: number): Evaluation => ({ type: "cp", value });

// ─── toExpectedScore — Lichess reference values (6) ──────

const tolerance = 0.005;

function close(actual: number, expected: number, tol = tolerance): void {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `expected ~${expected}, got ${actual} (tol ${tol})`,
  );
}

test("ep_zero_is_0_5", () => {
  const r = directToExpectedScore(cp(0));
  assert.ok(r);
  close(r.value, 0.5);
});

test("ep_plus_100_is_0_591", () => {
  const r = directToExpectedScore(cp(100));
  assert.ok(r);
  close(r.value, 0.591);
});

test("ep_plus_200_is_0_677", () => {
  const r = directToExpectedScore(cp(200));
  assert.ok(r);
  close(r.value, 0.677);
});

test("ep_plus_300_is_0_751", () => {
  const r = directToExpectedScore(cp(300));
  assert.ok(r);
  close(r.value, 0.751);
});

test("ep_minus_100_is_0_409", () => {
  const r = directToExpectedScore(cp(-100));
  assert.ok(r);
  close(r.value, 0.409);
});

test("ep_minus_300_is_0_249", () => {
  const r = directToExpectedScore(cp(-300));
  assert.ok(r);
  close(r.value, 0.249);
});

// ─── toExpectedScore — properties (4) ────────────────────

test("ep_mate_returns_null", () => {
  assert.equal(
    directToExpectedScore({ type: "mate", in: 3, winner: "white" }),
    null,
  );
});

test("ep_tablebase_returns_null", () => {
  assert.equal(
    directToExpectedScore({ type: "tablebase", result: "win" }),
    null,
  );
});

test("ep_unknown_returns_null", () => {
  assert.equal(directToExpectedScore({ type: "unknown" }), null);
});

test("ep_output_always_in_0_1", () => {
  for (const v of [-2000, -500, -100, 0, 100, 500, 2000, 100000]) {
    const r = directToExpectedScore(cp(v));
    assert.ok(r);
    assert.ok(r.value >= 0 && r.value <= 1, `out of range for cp=${v}: ${r.value}`);
  }
});

// ─── epLossFor (3) ────────────────────────────────────────

test("ep_loss_white_is_before_minus_after", () => {
  assert.ok(Math.abs(epLossFor(0.6, 0.5, "w") - 0.1) < 1e-9);
});

test("ep_loss_black_is_after_minus_before", () => {
  // Black's EP is white's EP inverted. Black loses if white's EP went up.
  // epBefore (white) = 0.5 → epAfter (white) = 0.6 means black got worse.
  // epLoss (black) = epAfter - epBefore = 0.1
  assert.ok(Math.abs(epLossFor(0.5, 0.6, "b") - 0.1) < 1e-9);
});

test("ep_loss_white_negative_when_improved", () => {
  assert.ok(epLossFor(0.4, 0.6, "w") < 0);
});

// ─── toQuality delegates (4) ─────────────────────────────

test("to_quality_delegates_best", () => {
  __resetConfigValidationForTests();
  const cfg = makeConfig();
  assert.equal(toQuality(0, 0, cfg), "Best");
});

test("to_quality_delegates_blunder", () => {
  __resetConfigValidationForTests();
  const cfg = makeConfig();
  assert.equal(toQuality(0.20, 0, cfg), "Blunder");
});

test("to_quality_cp_floor", () => {
  __resetConfigValidationForTests();
  const cfg = makeConfig();
  // EP says Best, but CP >= 200 → forced to Inaccuracy
  assert.equal(toQuality(0, 250, cfg), "Inaccuracy");
});

test("to_quality_direct_does_not_validate_config", () => {
  // Direct toQuality is a pure delegation to qualityFromEvaluation.
  // Config validation is the responsibility of createEvaluationLayer
  // (which has its own test: factory_throws_on_invalid_config).
  // The direct form intentionally trusts the caller.
  const cfg = makeConfig();
  (cfg.classification.epLossThresholds as any).Good = -0.5;
  // No throw — validation is not performed here.
  assert.doesNotThrow(() => toQuality(0, 0, cfg));
  // (The invalid config would still be rejected by createEvaluationLayer,
  // tested separately in factory_throws_on_invalid_config.)
});

// ─── LRUEvalCache (7) ────────────────────────────────────

const makePv = (id: string, rootId: string): PVRecord => ({
  id,
  rootId,
  rootEval: cp(20),
  depth: 10,
  stability: "stable",
  moves: [{ uci: "e2e4", san: "e4", evalAfter: { type: "unknown" } }],
  createdAt: Date.now(),
});

const makeKey = (fen = "FEN1", budgetKind: "depth" | "movetime" = "depth", budgetVal = 10) =>
  makeEvalCacheKey({
    fen,
    engineIdentity: "sf-19",
    configHash: "hash1",
    searchBudget: { kind: budgetKind, value: budgetVal },
    multiPv: 1,
    evaluationModelVersion: "ep-v1",
  });

test("cache_miss_returns_null", () => {
  const c = new LRUEvalCache();
  assert.equal(c.get(makeKey()), null);
  assert.deepEqual(c.getStats(), { hits: 0, misses: 1, size: 0 });
});

test("cache_set_then_get_hit", () => {
  const c = new LRUEvalCache();
  const pv = makePv("pv1", "root1");
  c.set(makeKey(), pv);
  const r = c.get(makeKey());
  assert.ok(r);
  assert.equal(r.id, "pv1");
  const stats = c.getStats();
  assert.equal(stats.hits, 1);
  assert.equal(stats.size, 1);
});

test("cache_get_with_root_rebinds", () => {
  const c = new LRUEvalCache();
  const pv = makePv("pv1", "root1");
  c.set(makeKey(), pv);
  const rebound = c.getWithRoot(makeKey(), "root2", "pv2");
  assert.ok(rebound);
  assert.equal(rebound.id, "pv2");
  assert.equal(rebound.rootId, "root2");
  // Original cache entry unchanged
  const original = c.get(makeKey());
  assert.ok(original);
  assert.equal(original.id, "pv1");
  assert.equal(original.rootId, "root1");
});

test("cache_different_budgets_are_different_keys", () => {
  const c = new LRUEvalCache();
  c.set(makeKey("FEN1", "depth", 10), makePv("pv1", "root1"));
  // Different depth → miss
  assert.equal(c.get(makeKey("FEN1", "depth", 14)), null);
  // Different kind → miss
  assert.equal(c.get(makeKey("FEN1", "movetime", 10)), null);
});

test("cache_lru_eviction", () => {
  const c = new LRUEvalCache(2);
  c.set(makeKey("FEN1"), makePv("pv1", "root1"));
  c.set(makeKey("FEN2"), makePv("pv2", "root2"));
  // Access FEN1 → moves to end
  c.get(makeKey("FEN1"));
  // Insert FEN3 → evict FEN2 (LRU)
  c.set(makeKey("FEN3"), makePv("pv3", "root3"));
  assert.ok(c.get(makeKey("FEN1")));   // still there
  assert.equal(c.get(makeKey("FEN2")), null); // evicted
  assert.ok(c.get(makeKey("FEN3")));
});

test("cache_clear_resets_everything", () => {
  const c = new LRUEvalCache();
  c.set(makeKey(), makePv("pv1", "root1"));
  c.get(makeKey());
  c.clear();
  assert.deepEqual(c.getStats(), { hits: 0, misses: 0, size: 0 });
  assert.equal(c.get(makeKey()), null);
});

test("cache_capacity_must_be_positive", () => {
  assert.throws(() => new LRUEvalCache(0), /capacity/);
  assert.throws(() => new LRUEvalCache(-1), /capacity/);
});


// ═══════════════════════════════════════════════════════════
// Stage 2.1 — createEvaluationLayer factory
// ═══════════════════════════════════════════════════════════

import { createEvaluationLayer } from "../../lib/analysis/evaluate/index.ts";
import type { EvaluationLayer } from "../../lib/analysis/core/contracts.ts";

test("factory_returns_valid_EvaluationLayer", () => {
  const cfg = makeConfig();
  const layer: EvaluationLayer = createEvaluationLayer(cfg);
  assert.ok(typeof layer.toExpectedScore === "function");
  assert.ok(typeof layer.toQuality === "function");
});

test("factory_toExpectedScore_works_without_config_arg", () => {
  const cfg = makeConfig();
  const layer = createEvaluationLayer(cfg);
  const r = layer.toExpectedScore(cp(0));
  assert.ok(r);
  close(r.value, 0.5);
});

test("factory_toExpectedScore_mate_returns_null", () => {
  const layer = createEvaluationLayer(makeConfig());
  assert.equal(layer.toExpectedScore({ type: "mate", in: 3, winner: "white" }), null);
});

test("factory_toQuality_works_without_config_arg", () => {
  const layer = createEvaluationLayer(makeConfig());
  assert.equal(layer.toQuality(0.20, 0, makeConfig().classification), "Blunder");
});

test("factory_throws_on_invalid_config", () => {
  const bad = makeConfig();
  (bad.classification.epLossThresholds as any).Good = -0.5;
  assert.throws(() => createEvaluationLayer(bad), /epLossThresholds|AnalysisConfig/);
});

test("factory_second_config_is_validated_independently", () => {
  // Old global-flag bug: after validating one config, a second invalid
  // config would silently pass. This test proves the fix.
  const good = makeConfig();
  createEvaluationLayer(good);  // first validates fine

  const bad = makeConfig();
  (bad.classification.epLossThresholds as any).Good = -0.5;
  assert.throws(() => createEvaluationLayer(bad), /epLossThresholds|AnalysisConfig/);
});

// ═══════════════════════════════════════════════════════════
// Stage 2.1 — EP threshold upper bound
// ═══════════════════════════════════════════════════════════

test("config_rejects_ep_threshold_above_1", () => {
  const bad = makeConfig();
  (bad.classification.epLossThresholds as any).Blunder = 1.5;
  assert.throws(() => createEvaluationLayer(bad), /must be <= 1|<=1/);
});

test("config_accepts_ep_threshold_exactly_1", () => {
  const edge = makeConfig();
  // Chain must still be strictly increasing; set each ≤ 1
  edge.classification.epLossThresholds = {
    Best: 0, Excellent: 0.01, Good: 0.03, Inaccuracy: 0.05,
    Mistake: 0.10, Blunder: 1.0,
  };
  assert.doesNotThrow(() => createEvaluationLayer(edge));
});
