// tests/analysis/pipeline.test.ts
// Stage 4 Day 2 — pipeline skeleton tests (PGN parse only).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  replayPgn,
  analyzeGame,
} from "../../lib/analysis/pipeline.ts";
import type { AnalysisConfig } from "../../lib/analysis/core/types.ts";
import { FIXTURE_CONFIG } from "../fixtures/classification-golden.ts";

const CONFIG = FIXTURE_CONFIG as unknown as AnalysisConfig;

const OPERA_PGN = `[Event "Paris Opera"]
[White "Morphy"]
[Black "Duke Karl"]

1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5 10.Nxb5 cxb5 11.Bxb5+ Nbd7 12.O-O-O Rd8 13.Rxd7 Rxd7 14.Rd1 Qe6 15.Bxd7+ Nxd7 16.Qb8+ Nxb8 17.Rd8# 1-0`;

const SHORT_PGN = `1.e4 e5 2.Nf3`;

// ─── Test 1: replayPgn produces 34 states ─────────────────
test("replay_pgn_opera_produces_34_states", () => {
  const result = replayPgn(OPERA_PGN);
  assert.equal(result.positions.length, 34);
});

// ─── Test 2: initial state is correct ────────────────────
test("replay_pgn_initial_state", () => {
  const result = replayPgn(OPERA_PGN);
  const initial = result.positions[0];
  assert.equal(initial.ply, 0);
  assert.equal(initial.san, "(start)");
  assert.equal(initial.playedMoveUci, null);
  assert.equal(initial.sideToMove, "w");
  assert.ok(initial.fen.startsWith("rnbqkbnr/pppppppp"));
});

// ─── Test 3: first move correct ──────────────────────────
test("replay_pgn_first_move_is_e4", () => {
  const result = replayPgn(OPERA_PGN);
  const first = result.positions[1];
  assert.equal(first.ply, 1);
  assert.equal(first.san, "e4");
  assert.equal(first.playedMoveUci, "e2e4");
  assert.equal(first.sideToMove, "b");
});

// ─── Test 4: final move is Rd8# ─────────────────────────
test("replay_pgn_final_move_is_rd8_mate", () => {
  const result = replayPgn(OPERA_PGN);
  const last = result.positions[33];
  assert.equal(last.ply, 33);
  assert.equal(last.san, "Rd8#");
  assert.equal(last.playedMoveUci, "d1d8");
  assert.equal(last.sideToMove, "b");
});

// ─── Test 5: final FEN is terminal checkmate ─────────────
test("replay_pgn_final_fen_is_checkmate", async () => {
  const { Chess } = await import("chess.js");
  const result = replayPgn(OPERA_PGN);
  const lastFen = result.positions[33].fen;
  const c = new Chess(lastFen);
  assert.equal(c.isCheckmate(), true);
});

// ─── Test 6: headers preserved ──────────────────────────
test("replay_pgn_preserves_headers", () => {
  const result = replayPgn(OPERA_PGN);
  assert.equal(result.headers.White, "Morphy");
  assert.equal(result.headers.Black, "Duke Karl");
});

// ─── Test 7: short PGN works ────────────────────────────
test("replay_pgn_short_pgn", () => {
  const result = replayPgn(SHORT_PGN);
  assert.equal(result.positions.length, 4); // init + e4 + e5 + Nf3
  assert.equal(result.positions[3].san, "Nf3");
});

// ─── Test 8: malformed PGN throws ──────────────────────
test("replay_pgn_malformed_throws", () => {
  assert.throws(
    () => replayPgn("this is not a pgn"),
    /PGN parse failed/,
  );
});

// ─── Test 9: analyzeGame returns partial AnalyzedGame ───
test("analyze_game_returns_partial_for_opera", async () => {
  const result = await analyzeGame(OPERA_PGN, CONFIG);
  assert.equal(result.status, "partial");
  assert.equal(result.pgn, OPERA_PGN);
  assert.equal(result.moves.length, 0); // Day 2: no classification yet
  assert.equal(result.roots.size, 0);
  assert.equal(result.pvs.size, 0);
  assert.equal(result.explanations.size, 0);
  assert.equal(result.refutations.size, 0);
  assert.ok(result.failures.length >= 1);
});

// ─── Test 10: analyzeGame with malformed PGN records failure ─
test("analyze_game_malformed_pgn_fails_soft", async () => {
  const result = await analyzeGame("garbage", CONFIG);
  assert.equal(result.status, "partial");
  assert.equal(result.moves.length, 0);
  const parseFailures = result.failures.filter((f) => f.stage === "pgn_parse");
  assert.ok(parseFailures.length >= 1);
  assert.ok(parseFailures[0].reason.includes("PGN parse failed"));
});

// ─── Test 11: analyzeGame failure mentions position count ──
test("analyze_game_stub_failure_mentions_parsed_plies", async () => {
  const result = await analyzeGame(OPERA_PGN, CONFIG);
  const searchFailures = result.failures.filter((f) => f.stage === "search");
  assert.ok(searchFailures.length >= 1);
  assert.ok(searchFailures[0].reason.includes("33"));
});
