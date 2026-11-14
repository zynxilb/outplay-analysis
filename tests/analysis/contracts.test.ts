// tests/analysis/contracts.test.ts
// Commit 2 — Runtime contract tests (batch 1 of ~4)
// Tests runtime behavior of validators. Not TypeScript types.

import { test } from "node:test";
import assert from "node:assert/strict";

import type {
  AnalysisRoot,
  ExpectedScore,
  Evaluation,
  MateTransition,
} from "../../lib/analysis/core/types.ts";

import {
  ContractViolation,
  validateAnalysisRoot,
  validateExpectedScore,
  validateMateTransition,
  computeConfigHash,
  computeMateVerdict,
} from "../../lib/analysis/core/contracts.ts";

// ─── Helpers ───────────────────────────────────────────────

const cp = (value: number): Evaluation => ({ type: "cp", value });
const mate = (inMoves: number, winner: "white" | "black"): Evaluation => ({
  type: "mate",
  in: inMoves,
  winner,
});

const makeRoot = (overrides: Partial<AnalysisRoot> = {}): AnalysisRoot => ({
  id: "root-1",
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  sideToMove: "w",
  purpose: "find-best-move",
  engineIdentity: "sf-16.1",
  configHash: "abc123",
  evaluationPerspective: "white",
  searchBudget: { kind: "depth", value: 14 },
  ...overrides,
});

const makeES = (value: number): ExpectedScore => ({
  value,
  derivedFrom: cp(0),
});

// ─── AnalysisRoot (5) ──────────────────────────────────────

test("analysis_root_valid", () => {
  assert.doesNotThrow(() => validateAnalysisRoot(makeRoot()));
});

test("analysis_root_rejects_empty_id", () => {
  assert.throws(() => validateAnalysisRoot(makeRoot({ id: "" })), ContractViolation);
});

test("analysis_root_rejects_wrong_perspective", () => {
  assert.throws(
    () => validateAnalysisRoot(makeRoot({ evaluationPerspective: "black" as never })),
    ContractViolation,
  );
});

test("analysis_root_rejects_negative_budget", () => {
  assert.throws(
    () => validateAnalysisRoot(makeRoot({ searchBudget: { kind: "depth", value: -1 } })),
    ContractViolation,
  );
});

test("analysis_root_rejects_non_integer_depth_budget", () => {
  assert.throws(
    () => validateAnalysisRoot(makeRoot({ searchBudget: { kind: "depth", value: 12.5 } })),
    ContractViolation,
  );
});

// ─── ConfigHash (5) ────────────────────────────────────────

test("config_hash_deterministic", () => {
  const cfg = { identity: "sf-16.1", hashMb: 32, multiPv: 3 };
  assert.equal(computeConfigHash(cfg), computeConfigHash(cfg));
});

test("config_hash_changes_on_identity", () => {
  const h1 = computeConfigHash({ identity: "sf-16.1", hashMb: 32, multiPv: 3 });
  const h2 = computeConfigHash({ identity: "sf-16.2", hashMb: 32, multiPv: 3 });
  assert.notEqual(h1, h2);
});

test("config_hash_changes_on_hashMb", () => {
  const h1 = computeConfigHash({ identity: "sf", hashMb: 32, multiPv: 3 });
  const h2 = computeConfigHash({ identity: "sf", hashMb: 64, multiPv: 3 });
  assert.notEqual(h1, h2);
});

test("config_hash_changes_on_multiPv", () => {
  const h1 = computeConfigHash({ identity: "sf", hashMb: 32, multiPv: 1 });
  const h2 = computeConfigHash({ identity: "sf", hashMb: 32, multiPv: 3 });
  assert.notEqual(h1, h2);
});

test("config_hash_disambiguates_delimiters", () => {
  const h1 = computeConfigHash({ identity: "a|b=1", hashMb: 0, multiPv: 1 });
  const h2 = computeConfigHash({ identity: "a", hashMb: 0, multiPv: 1 });
  assert.notEqual(h1, h2);
});

// ─── ExpectedScore (6) ─────────────────────────────────────

test("expected_score_valid_0_5", () => {
  assert.doesNotThrow(() => validateExpectedScore(makeES(0.5)));
});

test("expected_score_valid_boundary_0", () => {
  assert.doesNotThrow(() => validateExpectedScore(makeES(0)));
});

test("expected_score_valid_boundary_1", () => {
  assert.doesNotThrow(() => validateExpectedScore(makeES(1)));
});

test("expected_score_rejects_negative", () => {
  assert.throws(() => validateExpectedScore(makeES(-0.01)), ContractViolation);
});

test("expected_score_rejects_above_1", () => {
  assert.throws(() => validateExpectedScore(makeES(1.01)), ContractViolation);
});

test("expected_score_rejects_nan", () => {
  assert.throws(() => validateExpectedScore(makeES(NaN)), ContractViolation);
});

// ─── MateVerdict (5) ───────────────────────────────────────

test("mate_verdict_neither_mate_returns_null", () => {
  assert.equal(computeMateVerdict(cp(0), cp(50), "w"), null);
});

test("mate_verdict_best_mate_for_mover_played_cp_returns_lost", () => {
  assert.deepEqual(
    computeMateVerdict(cp(0), mate(3, "white"), "w"),
    { kind: "lost" },
  );
});

test("mate_verdict_played_mate_for_mover_best_cp_returns_gained", () => {
  assert.deepEqual(
    computeMateVerdict(mate(3, "white"), cp(50), "w"),
    { kind: "gained", reason: "created_mate_best_missed" },
  );
});

test("mate_verdict_both_mate_for_mover_played_slower_returns_delayed", () => {
  assert.deepEqual(
    computeMateVerdict(mate(5, "white"), mate(3, "white"), "w"),
    { kind: "delayed", byMoves: 2, direction: "for_mover" },
  );
});

test("mate_verdict_both_mate_for_mover_played_faster_returns_gained", () => {
  assert.deepEqual(
    computeMateVerdict(mate(2, "white"), mate(3, "white"), "w"),
    { kind: "gained", reason: "faster_than_best" },
  );
});

// ─── MateTransition validator (4) ──────────────────────────

const makeTransition = (
  afterPlayed: Evaluation,
  expectedAfterBest: Evaluation,
  verdict: MateTransition["verdict"],
): MateTransition => ({
  before: cp(0),
  afterPlayed,
  expectedAfterBest,
  moverColor: "w",
  verdict,
});

test("mate_transition_valid_delayed", () => {
  const t = makeTransition(
    mate(5, "white"),
    mate(3, "white"),
    { kind: "delayed", byMoves: 2, direction: "for_mover" },
  );
  assert.doesNotThrow(() => validateMateTransition(t));
});

test("mate_transition_rejects_negative_in", () => {
  const t = makeTransition(
    { type: "mate", in: -1, winner: "white" },
    mate(3, "white"),
    { kind: "delayed", byMoves: 0, direction: "for_mover" },
  );
  assert.throws(() => validateMateTransition(t), ContractViolation);
});

test("mate_transition_verdict_mismatch_rejected", () => {
  const t = makeTransition(
    mate(5, "white"),
    mate(3, "white"),
    { kind: "lost" },
  );
  assert.throws(() => validateMateTransition(t), ContractViolation);
});

test("mate_transition_neither_mate_rejected", () => {
  const t = makeTransition(
    cp(0),
    cp(50),
    { kind: "lost" },
  );
  assert.throws(() => validateMateTransition(t), ContractViolation);
});
