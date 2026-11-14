// tests/analysis/classify-adapter.test.ts
// ClassificationLayer adapter tests.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createClassificationLayer,
} from "../../lib/analysis/classify/adapter.ts";
import {
  ContractViolation,
} from "../../lib/analysis/core/contracts.ts";
import type {
  AnalysisConfig,
  ClassificationInput,
  Evaluation,
  RulesSourcedEvaluation,
  SourcedEvaluation,
} from "../../lib/analysis/core/types.ts";
import { FIXTURE_CONFIG } from "../fixtures/classification-golden.ts";

const CONFIG = FIXTURE_CONFIG as unknown as AnalysisConfig;

function srcEval(pvId: string, rootId: string, ev: Evaluation): SourcedEvaluation {
  return { eval: ev, pvId, rootId, depth: 14 };
}

function rseTerminal(ev: RulesSourcedEvaluation["eval"], fen: string): RulesSourcedEvaluation {
  return { eval: ev, fen, rulesSource: "chess.js" };
}

function makeInput(overrides: Partial<ClassificationInput> = {}): ClassificationInput {
  const cp = (v: number): Evaluation => ({ type: "cp", value: v });
  const base: ClassificationInput = {
    ply: 1,
    san: "e4",
    playedMoveUci: "e2e4",
    bestMoveUci: "d2d4",
    moverColor: "w",
    preMoveFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    postMoveFen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
    evalBefore: srcEval("pv-pre", "root-pre", cp(20)),
    evalAfterPlayed: srcEval("pv-post", "root-post", cp(10)),
    epLoss: 0.015,
    cpLoss: 10,
    annotations: [],
    preMoveRootId: "root-pre",
    postMoveRootId: "root-post",
  };
  return { ...base, ...overrides };
}

// ─── Test 1: Basic CP case ───────────────────────────────
test("adapter_returns_complete_classified_move", () => {
  const layer = createClassificationLayer();
  const out = layer.classify(makeInput(), CONFIG);
  assert.equal(out.ply, 1);
  assert.equal(out.san, "e4");
  assert.equal(out.quality, "Excellent");
  assert.deepEqual(out.annotations, []);
  assert.deepEqual(out.evaluation, { type: "cp", value: 10 });
  assert.ok(out.expectedScore !== null);
  assert.ok(out.expectedScore.value > 0.5);
  assert.equal(out.mateVerdict, null);
  assert.equal(out.classificationVersion, CONFIG.version);
});

// ─── Test 2: Annotation preservation ─────────────────────
test("adapter_preserves_annotations", () => {
  const layer = createClassificationLayer();
  const out = layer.classify(
    makeInput({ annotations: ["MISS", "BRILLIANT"] }),
    CONFIG,
  );
  assert.deepEqual([...out.annotations].sort(), ["BRILLIANT", "MISS"]);
});

// ─── Test 3: Mate transition populated ───────────────────
test("adapter_populates_mate_transition_for_preserved_mate", () => {
  const layer = createClassificationLayer();
  const input = makeInput({
    evalBefore: srcEval("pv-pre", "root-pre", { type: "mate", in: 3, winner: "white" }),
    evalAfterPlayed: srcEval("pv-post", "root-post", { type: "mate", in: 2, winner: "white" }),
  });
  const out = layer.classify(input, CONFIG);
  assert.ok(out.mateVerdict);
  assert.equal(out.mateVerdict.verdict.kind, "preserved");
  assert.deepEqual(out.mateVerdict.before, { type: "mate", in: 3, winner: "white" });
  assert.deepEqual(out.mateVerdict.afterPlayed, { type: "mate", in: 2, winner: "white" });
  assert.deepEqual(out.mateVerdict.expectedAfterBest, { type: "mate", in: 2, winner: "white" });
  assert.equal(out.expectedScore, null);
});

// ─── Test 4: Terminal checkmate move accepted ────────────
const CHECKMATE_WHITE_FEN = "R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1";

test("adapter_accepts_terminal_checkmate", () => {
  const layer = createClassificationLayer();
  const input = makeInput({
    evalBefore: srcEval("pv-pre", "root-pre", { type: "mate", in: 1, winner: "white" }),
    evalAfterPlayed: rseTerminal(
      { type: "terminal", kind: "checkmate", winner: "white" },
      CHECKMATE_WHITE_FEN,
    ),
    postMoveFen: CHECKMATE_WHITE_FEN,
  });
  const out = layer.classify(input, CONFIG);
  assert.equal(out.quality, "Best");
  assert.deepEqual(out.evaluation, { type: "terminal", kind: "checkmate", winner: "white" });
  assert.equal(out.expectedScore, null); // terminal → null
  assert.ok(out.mateVerdict);
});

// ─── Test 5: Terminal evaluation null expectedScore ──────
test("adapter_terminal_null_expected_score", () => {
  const layer = createClassificationLayer();
  const input = makeInput({
    evalBefore: srcEval("pv-pre", "root-pre", { type: "mate", in: 1, winner: "white" }),
    evalAfterPlayed: rseTerminal(
      { type: "terminal", kind: "checkmate", winner: "white" },
      CHECKMATE_WHITE_FEN,
    ),
    postMoveFen: CHECKMATE_WHITE_FEN,
  });
  const out = layer.classify(input, CONFIG);
  assert.equal(out.expectedScore, null);
});

// ─── Test 6: Search inconsistency propagates ─────────────
test("adapter_propagates_gained_mate_inconsistency", () => {
  const layer = createClassificationLayer();
  const input = makeInput({
    // evalBefore is CP (no mate); played is mate → gained (search inconsistency)
    evalBefore: srcEval("pv-pre", "root-pre", { type: "cp", value: 20 }),
    evalAfterPlayed: srcEval("pv-post", "root-post", { type: "mate", in: 3, winner: "white" }),
  });
  assert.throws(
    () => layer.classify(input, CONFIG),
    ContractViolation,
  );
});

// ─── Test 7: Terminal draw unsupported ───────────────────
test("adapter_rejects_terminal_draw_as_unsupported", () => {
  const layer = createClassificationLayer();
  const drawFen = "8/8/8/8/4k3/8/4K3/8 w - - 0 1";
  const input = makeInput({
    evalAfterPlayed: rseTerminal({ type: "terminal", kind: "draw" }, drawFen),
    postMoveFen: drawFen,
  });
  assert.throws(
    () => layer.classify(input, CONFIG),
    /terminal draw unsupported/,
  );
});
