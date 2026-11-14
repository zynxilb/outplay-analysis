// tests/analysis/evidence-providers.test.ts
// Stage 5 Day 1 — evidence extractors.
// Answer the architect's question: what facts are verifiable from
// Stage 4 output only?

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractFacts,
  type FactInput,
} from "../../lib/analysis/explain/evidence-providers.ts";

// ─── Test fixtures ────────────────────────────────────────

// Opera Game final position: after 17.Rd8#, black is checkmated.
// FEN is verified checkmate (existing Stage 4 tests confirm this).
// (OPERA_FINAL_FEN removed — was not actually checkmate)
// (OPERA_BEFORE_RD8_FEN removed — was not actually checkmate)

// Simple mate-in-1 position: white to move, Ra8# delivers mate.
const MATE_IN_1_FEN = "7k/6pp/8/8/8/8/8/R6K w - - 0 1";

const makeInput = (overrides: Partial<FactInput> = {}): FactInput => ({
  ply: 1,
  moverColor: "w",
  playedMoveUci: "e2e4",
  quality: "Good",
  evalAfterPlayed: { type: "cp", value: 20 },
  preMoveFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  postMoveFen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
  preMoveRootEval: { type: "cp", value: 20 },
  preMovePvMoves: [{ uci: "e2e4", san: "e4" }],
  preMovePvStability: "stable",
  mateVerdictKind: null,
  ...overrides,
});

// ─── MATE_DELIVERED ──────────────────────────────────────

test("fact_mate_delivered_when_mover_checkmates", () => {
  // Verified back-rank checkmate: black king g8, white rook a8, black
  // pawns f7/g7/h7 block escape. chess.js confirms isCheckmate() = true.
  // (The Opera Game final FEN at ply 17 is `1n1Rk3/...` which is NOT
  // checkmate in isolation; d8 is undefended, king can capture.
  // Using a known-verified checkmate FEN avoids relying on
  // position-specific reasoning.)
  const CHECKMATE_FEN = "R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1";
  const facts = extractFacts(makeInput({
    ply: 33,
    moverColor: "w",
    playedMoveUci: "a1a8",
    quality: "Best",
    evalAfterPlayed: { type: "terminal", kind: "checkmate", winner: "white" },
    preMoveFen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1",
    postMoveFen: CHECKMATE_FEN,
    preMoveRootEval: { type: "mate", in: 1, winner: "white" },
    preMovePvMoves: [{ uci: "a1a8", san: "Ra8#" }],
  }));
  const m = facts.find((f) => f.kind === "terminal_checkmate_delivered");
  assert.ok(m, "expected terminal_checkmate_delivered fact");
  if (m && m.kind === "terminal_checkmate_delivered") {
    assert.equal(m.winner, "white");
    assert.equal(m.terminalFen, CHECKMATE_FEN);
    assert.equal(m.checkmateSquare, "g8");
  }
});

test("fact_mate_delivered_not_fired_for_opponent_checkmate", () => {
  // evalAfterPlayed is terminal checkmate but winner is opponent
  const facts = extractFacts(makeInput({
    moverColor: "w",
    evalAfterPlayed: { type: "terminal", kind: "checkmate", winner: "black" },
  }));
  assert.equal(
    facts.filter((f) => f.kind === "terminal_checkmate_delivered").length,
    0,
  );
});

test("fact_mate_delivered_not_fired_when_not_terminal_kind", () => {
  // evalAfterPlayed is mate (engine-typed) but not terminal (rules-typed)
  const facts = extractFacts(makeInput({
    moverColor: "w",
    evalAfterPlayed: { type: "mate", in: 0, winner: "white" },
  }));
  assert.equal(
    facts.filter((f) => f.kind === "terminal_checkmate_delivered").length,
    0,
  );
});

// ─── MISSED_MATE ─────────────────────────────────────────

test("fact_missed_mate_when_mate_was_lost_and_pv_verifies", () => {
  // Pre-move position: mate in 1 via Ra8#. Played Kh2 (silly).
  const facts = extractFacts(makeInput({
    moverColor: "w",
    playedMoveUci: "h1h2",
    quality: "Blunder",
    evalAfterPlayed: { type: "cp", value: -100 },
    preMoveFen: MATE_IN_1_FEN,
    postMoveFen: "7k/6pp/8/8/8/8/7K/8 w - - 1 1",
    preMoveRootEval: { type: "mate", in: 1, winner: "white" },
    preMovePvMoves: [{ uci: "a1a8", san: "Ra8#" }],
    mateVerdictKind: "lost",
  }));
  const m = facts.find((f) => f.kind === "missed_mate");
  assert.ok(m, "expected missed_mate fact");
  if (m && m.kind === "missed_mate") {
    assert.equal(m.mateIn, 1);
    assert.equal(m.mateDeliveringMoveSan, "Ra8#");
    assert.equal(m.preMoveFen, MATE_IN_1_FEN);
    assert.equal(m.matingLine.length, 1);
  }
});

test("fact_missed_mate_not_fired_when_pv_does_not_reach_checkmate", () => {
  // preMoveRootEval says mate, but PV doesn't actually checkmate
  const facts = extractFacts(makeInput({
    moverColor: "w",
    preMoveFen: MATE_IN_1_FEN,
    preMoveRootEval: { type: "mate", in: 3, winner: "white" },
    preMovePvMoves: [{ uci: "a1a2", san: "Ra2" }], // NOT a mating move
    mateVerdictKind: "lost",
  }));
  assert.equal(facts.filter((f) => f.kind === "missed_mate").length, 0);
});

test("fact_missed_mate_not_fired_when_played_already_delivered_mate", () => {
  // Pre-move PV had mate, but played move also delivers checkmate.
  // MATE_DELIVERED may fire, MISSED_MATE must not.
  const facts = extractFacts(makeInput({
    moverColor: "w",
    quality: "Best",
    evalAfterPlayed: { type: "terminal", kind: "checkmate", winner: "white" },
    preMoveFen: MATE_IN_1_FEN,
    postMoveFen: "R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1",
    preMoveRootEval: { type: "mate", in: 1, winner: "white" },
    preMovePvMoves: [{ uci: "a1a8", san: "Ra8#" }],
  }));
  assert.equal(facts.filter((f) => f.kind === "missed_mate").length, 0);
});

// ─── ENGINE_PREFERRED ────────────────────────────────────

test("fact_engine_preferred_when_played_matches_and_stable", () => {
  const facts = extractFacts(makeInput({
    quality: "Best",
    playedMoveUci: "e2e4",
    preMovePvMoves: [{ uci: "e2e4", san: "e4" }],
    preMovePvStability: "stable",
  }));
  const m = facts.find((f) => f.kind === "engine_preferred");
  assert.ok(m, "expected engine_preferred fact");
  if (m && m.kind === "engine_preferred") {
    assert.equal(m.playedMoveUci, "e2e4");
    assert.equal(m.engineMoveUci, "e2e4");
  }
});

test("fact_engine_preferred_not_fired_when_search_unstable", () => {
  const facts = extractFacts(makeInput({
    quality: "Best",
    playedMoveUci: "e2e4",
    preMovePvMoves: [{ uci: "e2e4", san: "e4" }],
    preMovePvStability: "unstable",
  }));
  assert.equal(facts.filter((f) => f.kind === "engine_preferred").length, 0);
});

test("fact_engine_preferred_not_fired_when_quality_not_best", () => {
  const facts = extractFacts(makeInput({
    quality: "Excellent",
    playedMoveUci: "e2e4",
    preMovePvMoves: [{ uci: "e2e4", san: "e4" }],
  }));
  assert.equal(facts.filter((f) => f.kind === "engine_preferred").length, 0);
});

test("fact_engine_preferred_not_fired_when_played_differs_from_pv_head", () => {
  const facts = extractFacts(makeInput({
    quality: "Best",
    playedMoveUci: "d2d4",
    preMovePvMoves: [{ uci: "e2e4", san: "e4" }],
  }));
  assert.equal(facts.filter((f) => f.kind === "engine_preferred").length, 0);
});

// ─── NO FACTS → SILENT ──────────────────────────────────

test("fact_none_for_ordinary_move_with_no_supported_cause", () => {
  const facts = extractFacts(makeInput({
    quality: "Good",
    playedMoveUci: "g1f3",
    preMoveRootEval: { type: "cp", value: 30 },
    preMovePvMoves: [{ uci: "e2e4", san: "e4" }],
    preMovePvStability: "stable",
  }));
  assert.equal(facts.length, 0, "expected no facts for ordinary move");
});
