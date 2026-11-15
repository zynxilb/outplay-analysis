// tests/analysis/refutation-builder.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildRefutations } from "../../lib/analysis/explain/refutation-builder.ts";
import { renderRefutation } from "../../lib/analysis/explain/refutation-ar.ts";
import type {
  AnalyzedGame, ClassifiedMove, PVRecord, RefutationLine,
} from "../../lib/analysis/core/types.ts";
import { VALID_ANALYSIS_CONFIG } from "../fixtures/analysis-config.ts";

function move(
  ply: number,
  san: string,
  quality: ClassifiedMove["quality"],
  evalCp: number,
): ClassifiedMove {
  return {
    ply, san, quality, annotations: [],
    evaluation: { type: "cp", value: evalCp },
    expectedScore: null, mateVerdict: null, classificationVersion: "test",
  };
}

function makePv(
  id: string,
  rootId: string,
  bestSan: string,
  replySan: string,
  rootEvalCp: number,
  stability: "stable" | "unstable" = "stable",
): PVRecord {
  return {
    id, rootId,
    rootEval: { type: "cp", value: rootEvalCp },
    depth: 10, stability,
    moves: [
      { uci: "e2e4", san: bestSan, evalAfter: { type: "unknown" } },
      { uci: "e7e5", san: replySan, evalAfter: { type: "unknown" } },
    ],
    createdAt: 1,
  };
}

function makeGame(moves: ClassifiedMove[], pvs: PVRecord[]): AnalyzedGame {
  return {
    pgn: "", status: "complete", failures: [],
    roots: new Map(), pvs: new Map(pvs.map(p => [p.id, p])),
    moves, explanations: new Map(),
    localizedExplanations: new Map(), refutations: new Map(),
    config: VALID_ANALYSIS_CONFIG,
  };
}

// ── State computation ────────────────────────────────────

test("refutation_builder_produces_evaluation_swing_for_blunder", () => {
  // pv.rootEval = 200; played.evaluation = -300 ⇒ gap 500 ≥ 300.
  const pvs = [makePv("pv1", "r1", "Nf3", "e5", 200)];
  const g = makeGame([move(1, "d4", "Blunder", -300)], pvs);
  const out = buildRefutations(g, new Map([[1, "pv1"]]));
  assert.equal(out.size, 1);
  const line = out.get(1)!;
  assert.equal(line.mode.kind, "alternative");
  assert.equal(line.state.kind, "evaluation_swing_demonstrated");
  if (line.state.kind === "evaluation_swing_demonstrated") {
    assert.equal(line.state.cpGap, 500);
  }
  assert.equal(line.moves[0].san, "Nf3");
  assert.equal(line.moves[1].san, "e5");
  assert.equal(line.sourcedFromPvId, "pv1");
});

test("refutation_builder_skips_best_moves", () => {
  const pvs = [makePv("pv1", "r1", "Nf3", "e5", 200)];
  const g = makeGame([move(1, "Nf3", "Best", 20)], pvs);
  assert.equal(buildRefutations(g, new Map([[1, "pv1"]])).size, 0);
});

test("refutation_builder_returns_insufficient_for_short_pv", () => {
  const pv: PVRecord = {
    id: "pv1", rootId: "r1", rootEval: { type: "cp", value: 200 },
    depth: 10, stability: "stable",
    moves: [{ uci: "e2e4", san: "e4", evalAfter: { type: "unknown" } }],
    createdAt: 1,
  };
  const g = makeGame([move(1, "d4", "Blunder", -300)], [pv]);
  const out = buildRefutations(g, new Map([[1, "pv1"]]));
  assert.equal(out.size, 1);
  assert.equal(out.get(1)!.state.kind, "insufficient");
  if (out.get(1)!.state.kind === "insufficient") {
    assert.equal(out.get(1)!.state.reason, "pv_too_short");
  }
});

test("refutation_builder_skips_without_pre_pv_mapping", () => {
  const pvs = [makePv("pv1", "r1", "Nf3", "e5", 200)];
  const g = makeGame([move(1, "d4", "Blunder", -300)], pvs);
  assert.equal(buildRefutations(g, new Map()).size, 0);
});

test("refutation_builder_rejects_unstable_pv", () => {
  const pvs = [makePv("pv1", "r1", "Nf3", "e5", 200, "unstable")];
  const g = makeGame([move(1, "d4", "Blunder", -300)], pvs);
  const out = buildRefutations(g, new Map([[1, "pv1"]]));
  assert.equal(out.size, 1);
  assert.equal(out.get(1)!.state.kind, "insufficient");
  if (out.get(1)!.state.kind === "insufficient") {
    assert.equal(out.get(1)!.state.reason, "unstable");
  }
});

test("refutation_builder_rejects_mate_root_eval", () => {
  const pv: PVRecord = {
    id: "pv1", rootId: "r1",
    rootEval: { type: "mate", in: 2, winner: "white" },
    depth: 10, stability: "stable",
    moves: [
      { uci: "e2e4", san: "Nf3", evalAfter: { type: "unknown" } },
      { uci: "e7e5", san: "e5", evalAfter: { type: "unknown" } },
    ],
    createdAt: 1,
  };
  const g = makeGame([move(1, "d4", "Blunder", -300)], [pv]);
  const out = buildRefutations(g, new Map([[1, "pv1"]]));
  assert.equal(out.get(1)!.state.kind, "insufficient");
  if (out.get(1)!.state.kind === "insufficient") {
    assert.equal(out.get(1)!.state.reason, "search_failed");
  }
});

test("refutation_builder_rejects_terminal_played_evaluation", () => {
  const pvs = [makePv("pv1", "r1", "Nf3", "e5", 200)];
  const m: ClassifiedMove = {
    ...move(1, "d4", "Blunder", -300),
    evaluation: { type: "terminal", kind: "checkmate", winner: "black" },
  };
  const g = makeGame([m], pvs);
  const out = buildRefutations(g, new Map([[1, "pv1"]]));
  assert.equal(out.get(1)!.state.kind, "insufficient");
  if (out.get(1)!.state.kind === "insufficient") {
    assert.equal(out.get(1)!.state.reason, "search_failed");
  }
});

test("refutation_builder_rejects_below_threshold_gap", () => {
  // |pv.rootEval - played| = |100 - (-50)| = 150 < 300.
  const pvs = [makePv("pv1", "r1", "Nf3", "e5", 100)];
  const g = makeGame([move(1, "d4", "Blunder", -50)], pvs);
  const out = buildRefutations(g, new Map([[1, "pv1"]]));
  assert.equal(out.get(1)!.state.kind, "insufficient");
});

// ── Arabic renderer ──────────────────────────────────────

test("refutation_ar_renders_evaluation_swing_sentence", () => {
  const line: RefutationLine = {
    mode: { kind: "alternative", targetMove: "missed" },
    state: { kind: "evaluation_swing_demonstrated", cpGap: 500 },
    moves: [
      { uci: "g1f3", san: "Nf3", evalAfter: { type: "unknown" } },
      { uci: "e7e5", san: "e5", evalAfter: { type: "unknown" } },
    ],
    rootId: "r1", sourcedFromPvId: "pv1", sourcedFromDepth: 10,
  };
  const out = renderRefutation(line);
  assert.ok(out);
  assert.equal(out!.text, "الأفضل كان Nf3. كان الخصم سيرد بـ e5.");
  assert.equal(out!.confidence, "verified");
});

test("refutation_ar_silent_on_insufficient", () => {
  const line: RefutationLine = {
    mode: { kind: "alternative", targetMove: "missed" },
    state: { kind: "insufficient", reason: "pv_too_short" },
    moves: [], rootId: "r1", sourcedFromPvId: "pv1", sourcedFromDepth: 10,
  };
  assert.equal(renderRefutation(line), null);
});
