// tests/analysis/evidence-providers.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractFacts,
  type FactInput,
} from "../../lib/analysis/explain/evidence-providers.ts";

// Verified checkmate FENs
const BACK_RANK_MATE = "R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1";
const BEFORE_RD8 = "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1";
// Simple mate-in-1: white Ra8# from Ra1
const MATE_IN_1_BEFORE = "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1";
const MATE_IN_1_AFTER = "R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1";
// Non-mate position
const STARTPOS = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
// chess.js canonical FEN after e2e4 from startpos. Note: ep target is
// "-" not "e3" because no black pawn on d4/f4 can capture en passant.
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

const makeInput = (overrides: Partial<FactInput> = {}): FactInput => ({
  ply: 1,
  moverColor: "w",
  playedMoveUci: "e2e4",
  quality: "Good",
  evalAfterPlayed: { type: "cp", value: 20 },
  preMoveFen: STARTPOS,
  postMoveFen: AFTER_E4,
  preMoveRootEval: { type: "cp", value: 20 },
  preMovePvMoves: [{ uci: "e2e4", san: "e4" }],
  preMovePvStability: "stable",
  mateVerdictKind: null,
  preMovePvId: "pv-test-1",
  preMoveRootId: "root-test-1",
  preMoveDepth: 10,
  ...overrides,
});

// ─── MATE_DELIVERED ─────────────────────────────────────

test("fact_mate_delivered_fires_and_carries_fen", () => {
  const facts = extractFacts(makeInput({
    ply: 33,
    playedMoveUci: "a1a8",
    quality: "Best",
    evalAfterPlayed: { type: "terminal", kind: "checkmate", winner: "white" },
    preMoveFen: MATE_IN_1_BEFORE,
    postMoveFen: MATE_IN_1_AFTER,
    preMoveRootEval: { type: "mate", in: 1, winner: "white" },
    preMovePvMoves: [{ uci: "a1a8", san: "Ra8#" }],
  }));
  const m = facts.find((f) => f.kind === "terminal_checkmate_delivered");
  assert.ok(m);
  if (m?.kind === "terminal_checkmate_delivered") {
    assert.equal(m.winner, "white");
    assert.equal(m.checkmateSquare, "g8");
  }
});

test("fact_mate_delivered_not_fired_for_opponent_checkmate", () => {
  const facts = extractFacts(makeInput({
    playedMoveUci: "a1a8",
    evalAfterPlayed: { type: "terminal", kind: "checkmate", winner: "black" },
    preMoveFen: MATE_IN_1_BEFORE,
    postMoveFen: MATE_IN_1_AFTER,
  }));
  assert.equal(facts.filter((f) => f.kind === "terminal_checkmate_delivered").length, 0);
});

// ─── MISSED_MATE — requires mateVerdictKind === "lost" ──

test("fact_missed_mate_fires_only_when_verdict_lost", () => {
  const facts = extractFacts(makeInput({
    playedMoveUci: "a1a2",
    quality: "Blunder",
    preMoveFen: MATE_IN_1_BEFORE,
    postMoveFen: "6k1/5ppp/8/8/8/8/R7/6K1 b - - 1 1",
    preMoveRootEval: { type: "mate", in: 1, winner: "white" },
    preMovePvMoves: [{ uci: "a1a8", san: "Ra8#" }],
    mateVerdictKind: "lost",
  }));
  const m = facts.find((f) => f.kind === "missed_mate");
  assert.ok(m);
  if (m?.kind === "missed_mate") {
    assert.equal(m.mateIn, 1);
    assert.equal(m.mateDeliveringMoveSan, "Ra8#");
    assert.equal(m.pvId, "pv-test-1");
    assert.equal(m.rootId, "root-test-1");
    assert.equal(m.depth, 10);
  }
});

test("fact_missed_mate_not_fired_when_verdict_preserved", () => {
  const facts = extractFacts(makeInput({
    playedMoveUci: "a1a2",
    preMoveFen: MATE_IN_1_BEFORE,
    postMoveFen: "6k1/5ppp/8/8/8/8/R7/6K1 b - - 1 1",
    preMoveRootEval: { type: "mate", in: 1, winner: "white" },
    preMovePvMoves: [{ uci: "a1a8", san: "Ra8#" }],
    mateVerdictKind: "preserved",
  }));
  assert.equal(facts.filter((f) => f.kind === "missed_mate").length, 0);
});

test("fact_missed_mate_not_fired_when_verdict_delayed", () => {
  const facts = extractFacts(makeInput({
    playedMoveUci: "a1a2",
    preMoveFen: MATE_IN_1_BEFORE,
    postMoveFen: "6k1/5ppp/8/8/8/8/R7/6K1 b - - 1 1",
    preMoveRootEval: { type: "mate", in: 1, winner: "white" },
    preMovePvMoves: [{ uci: "a1a8", san: "Ra8#" }],
    mateVerdictKind: "delayed",
  }));
  assert.equal(facts.filter((f) => f.kind === "missed_mate").length, 0);
});

test("fact_missed_mate_not_fired_when_verdict_gained", () => {
  const facts = extractFacts(makeInput({
    playedMoveUci: "a1a2",
    preMoveFen: MATE_IN_1_BEFORE,
    postMoveFen: "6k1/5ppp/8/8/8/8/R7/6K1 b - - 1 1",
    preMoveRootEval: { type: "mate", in: 1, winner: "white" },
    preMovePvMoves: [{ uci: "a1a8", san: "Ra8#" }],
    mateVerdictKind: "gained",
  }));
  assert.equal(facts.filter((f) => f.kind === "missed_mate").length, 0);
});

test("fact_missed_mate_not_fired_when_verdict_inconsistent", () => {
  const facts = extractFacts(makeInput({
    playedMoveUci: "a1a2",
    preMoveFen: MATE_IN_1_BEFORE,
    postMoveFen: "6k1/5ppp/8/8/8/8/R7/6K1 b - - 1 1",
    preMoveRootEval: { type: "mate", in: 1, winner: "white" },
    preMovePvMoves: [{ uci: "a1a8", san: "Ra8#" }],
    mateVerdictKind: "inconsistent",
  }));
  assert.equal(facts.filter((f) => f.kind === "missed_mate").length, 0);
});

test("fact_missed_mate_not_fired_when_pv_san_mismatches", () => {
  // PV supplies SAN "Qa8#" but UCI is a1a8 which yields "Ra8#"
  const facts = extractFacts(makeInput({
    playedMoveUci: "a1a2",
    preMoveFen: MATE_IN_1_BEFORE,
    postMoveFen: "6k1/5ppp/8/8/8/8/R7/6K1 b - - 1 1",
    preMoveRootEval: { type: "mate", in: 1, winner: "white" },
    preMovePvMoves: [{ uci: "a1a8", san: "Qa8#" }], // wrong SAN
    mateVerdictKind: "lost",
  }));
  assert.equal(facts.filter((f) => f.kind === "missed_mate").length, 0);
});

test("fact_missed_mate_not_fired_when_mate_distance_mismatches", () => {
  // Reported mate in 3, but PV is only 1 move (Ra8#)
  const facts = extractFacts(makeInput({
    playedMoveUci: "a1a2",
    preMoveFen: MATE_IN_1_BEFORE,
    postMoveFen: "6k1/5ppp/8/8/8/8/R7/6K1 b - - 1 1",
    preMoveRootEval: { type: "mate", in: 3, winner: "white" },
    preMovePvMoves: [{ uci: "a1a8", san: "Ra8#" }],
    mateVerdictKind: "lost",
  }));
  assert.equal(facts.filter((f) => f.kind === "missed_mate").length, 0);
});

// ─── ENGINE_PREFERRED ───────────────────────────────────

test("fact_engine_preferred_fires_with_provenance", () => {
  const facts = extractFacts(makeInput({ quality: "Best" }));
  const m = facts.find((f) => f.kind === "engine_preferred");
  assert.ok(m);
  if (m?.kind === "engine_preferred") {
    assert.equal(m.pvId, "pv-test-1");
    assert.equal(m.rootId, "root-test-1");
    assert.equal(m.depth, 10);
  }
});

test("fact_engine_preferred_not_fired_when_unstable", () => {
  const facts = extractFacts(makeInput({ quality: "Best", preMovePvStability: "unstable" }));
  assert.equal(facts.filter((f) => f.kind === "engine_preferred").length, 0);
});

test("fact_engine_preferred_not_fired_when_quality_not_best", () => {
  const facts = extractFacts(makeInput({ quality: "Excellent" }));
  assert.equal(facts.filter((f) => f.kind === "engine_preferred").length, 0);
});

// ─── Played move connection (throws on Stage 4 invariant violation) ──

test("throws_when_played_move_does_not_produce_post_fen", () => {
  assert.throws(
    () => extractFacts(makeInput({
      playedMoveUci: "e2e4",
      preMoveFen: STARTPOS,
      postMoveFen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2", // this is after e4 e5, not after e4
    })),
    /does not produce postMoveFen/,
  );
});

test("throws_when_played_move_is_illegal", () => {
  assert.throws(
    () => extractFacts(makeInput({
      playedMoveUci: "e2e5", // illegal knight-like pawn move
      preMoveFen: STARTPOS,
      postMoveFen: AFTER_E4,
    })),
    /illegal|does not produce/i,
  );
});

// ─── Silent path ────────────────────────────────────────

test("no_facts_for_ordinary_move", () => {
  // STARTPOS has a knight on g1, so g1f3 (Nf3) IS legal from startpos.
  // postMoveFen is the canonical chess.js FEN after 1.Nf3.
  const facts = extractFacts(makeInput({
    quality: "Good",
    playedMoveUci: "g1f3",
    postMoveFen: "rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1",
  }));
  assert.equal(facts.length, 0);
});
