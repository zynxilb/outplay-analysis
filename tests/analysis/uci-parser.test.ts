// tests/analysis/uci-parser.test.ts
// Stage 2 — UCI parser + perspective conversion tests

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseSearchOutput,
  parseInfoLine,
} from "../../lib/analysis/engine/uci-parser.ts";

import {
  evaluationFromUciScore,
  sideToMoveFromFen,
} from "../../lib/analysis/evaluate/perspective.ts";

// ─── parseSearchOutput (7) ────────────────────────────────

test("parse_search_single_pv", () => {
  const lines = [
    "info depth 10 seldepth 12 multipv 1 score cp 25 nodes 12345 pv e2e4 e7e5 g1f3",
    "bestmove e2e4",
  ];
  const r = parseSearchOutput(lines);
  assert.ok(r);
  assert.equal(r.bestmove, "e2e4");
  assert.equal(r.depth, 10);
  assert.equal(r.nodes, 12345);
  assert.deepEqual(r.score, { type: "cp", value: 25 });
  assert.deepEqual(r.pv, ["e2e4", "e7e5", "g1f3"]);
});

test("parse_search_picks_highest_depth_per_multipv", () => {
  const lines = [
    "info depth 5 multipv 1 score cp 10 pv e2e4",
    "info depth 10 multipv 1 score cp 25 pv e2e4 e7e5",
    "info depth 8 multipv 1 score cp 15 pv d2d4",  // lower depth, ignore
    "bestmove e2e4",
  ];
  const r = parseSearchOutput(lines);
  assert.ok(r);
  assert.equal(r.depth, 10);
  assert.deepEqual(r.score, { type: "cp", value: 25 });
  assert.deepEqual(r.pv, ["e2e4", "e7e5"]);
});

test("parse_search_skips_lowerbound", () => {
  const lines = [
    "info depth 10 multipv 1 score cp 25 lowerbound pv e2e4",
    "info depth 9 multipv 1 score cp 20 pv d2d4",
    "bestmove d2d4",
  ];
  const r = parseSearchOutput(lines);
  assert.ok(r);
  // Lowerbound line should be skipped; only the depth-9 non-bound line counts
  assert.equal(r.depth, 9);
  assert.deepEqual(r.score, { type: "cp", value: 20 });
});

test("parse_search_skips_upperbound", () => {
  const lines = [
    "info depth 10 multipv 1 score mate 3 upperbound pv e2e4",
    "info depth 8 multipv 1 score cp 50 pv g1f3",
    "bestmove g1f3",
  ];
  const r = parseSearchOutput(lines);
  assert.ok(r);
  assert.equal(r.depth, 8);
  assert.deepEqual(r.score, { type: "cp", value: 50 });
});

test("parse_search_returns_null_without_bestmove", () => {
  const lines = [
    "info depth 10 multipv 1 score cp 25 pv e2e4",
  ];
  assert.equal(parseSearchOutput(lines), null);
});

test("parse_search_returns_null_without_valid_pv", () => {
  const lines = [
    "info depth 10 multipv 1 score cp 25",  // no pv
    "bestmove e2e4",
  ];
  assert.equal(parseSearchOutput(lines), null);
});

test("parse_search_multipv_ordering", () => {
  const lines = [
    "info depth 10 multipv 1 score cp 30 pv e2e4",
    "info depth 10 multipv 2 score cp 25 pv d2d4",
    "info depth 10 multipv 3 score cp 20 pv g1f3",
    "bestmove e2e4",
  ];
  const r = parseSearchOutput(lines);
  assert.ok(r);
  assert.equal(r.multipv.length, 3);
  assert.equal(r.multipv[0].multipv, 1);
  assert.equal(r.multipv[1].multipv, 2);
  assert.equal(r.multipv[2].multipv, 3);
});

// ─── parseInfoLine (2) ────────────────────────────────────

test("parse_info_line_valid", () => {
  const pv = parseInfoLine("info depth 10 multipv 1 score cp 25 pv e2e4 e7e5");
  assert.ok(pv);
  assert.equal(pv.depth, 10);
  assert.deepEqual(pv.score, { type: "cp", value: 25 });
  assert.deepEqual(pv.pv, ["e2e4", "e7e5"]);
});

test("parse_info_line_returns_null_for_bound", () => {
  const pv = parseInfoLine("info depth 10 score cp 25 lowerbound pv e2e4");
  assert.equal(pv, null);
});

// ─── evaluationFromUciScore (5) ───────────────────────────

test("eval_cp_white_to_move_preserves_sign", () => {
  assert.deepEqual(
    evaluationFromUciScore({ type: "cp", value: 25 }, "w"),
    { type: "cp", value: 25 },
  );
});

test("eval_cp_black_to_move_flips_sign", () => {
  assert.deepEqual(
    evaluationFromUciScore({ type: "cp", value: 25 }, "b"),
    { type: "cp", value: -25 },
  );
});

test("eval_mate_white_mating", () => {
  assert.deepEqual(
    evaluationFromUciScore({ type: "mate", value: 3 }, "w"),
    { type: "mate", in: 3, winner: "white" },
  );
});

test("eval_mate_black_mating", () => {
  assert.deepEqual(
    evaluationFromUciScore({ type: "mate", value: 3 }, "b"),
    { type: "mate", in: 3, winner: "black" },
  );
});

test("eval_mate_negative_means_side_to_move_is_mated", () => {
  assert.deepEqual(
    evaluationFromUciScore({ type: "mate", value: -3 }, "w"),
    { type: "mate", in: 3, winner: "black" },
  );
});

// ─── sideToMoveFromFen (2) ────────────────────────────────

test("side_to_move_white", () => {
  assert.equal(
    sideToMoveFromFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"),
    "w",
  );
});

test("side_to_move_black", () => {
  assert.equal(
    sideToMoveFromFen("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"),
    "b",
  );
});
