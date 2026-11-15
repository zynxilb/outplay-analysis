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

// Consistent SAN → UCI mapping so fixtures don't mix a "Nf3" SAN with
// an "e2e4" UCI (which describes a different move). Values are real
// standard chess UCI for those SANs.
const SAN_TO_UCI: Record<string, string> = {
  "Nf3": "g1f3",
  "Nc3": "b1c3",
  "e4": "e2e4",
  "d4": "d2d4",
  "e5": "e7e5",
  "d5": "d7d5",
  "Ra2": "a1a2",
};

function uciFor(san: string): string {
  const u = SAN_TO_UCI[san];
  if (!u) throw new Error(`test fixture: no UCI mapping for SAN "${san}"`);
  return u;
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
      { uci: uciFor(bestSan), san: bestSan, evalAfter: { type: "unknown" } },
      { uci: uciFor(replySan), san: replySan, evalAfter: { type: "unknown" } },
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
      { uci: "g1f3", san: "Nf3", evalAfter: { type: "unknown" } },
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
  if (out.get(1)!.state.kind === "insufficient") {
    assert.equal(out.get(1)!.state.reason, "evaluation_swing_below_threshold");
  }
});

test("refutation_builder_refuses_when_best_equals_played", () => {
  // If the pre-move PV's head IS the move that was played, we cannot
  // claim the player missed their own move. Builder must yield
  // insufficient(search_failed) rather than emit a lying refutation.
  const pvs = [makePv("pv1", "r1", "d4", "d5", 200)];
  const g = makeGame([move(1, "d4", "Blunder", -300)], pvs);
  const out = buildRefutations(g, new Map([[1, "pv1"]]));
  assert.equal(out.size, 1);
  assert.equal(out.get(1)!.state.kind, "insufficient");
  if (out.get(1)!.state.kind === "insufficient") {
    assert.equal(out.get(1)!.state.reason, "search_failed");
  }
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

test("refutation_ar_renders_consequence_demonstrated_sentence", () => {
  // Legacy variant — must still render with the SAME visible template.
  // This preserves the pre-Day-5 wording contract.
  const line: RefutationLine = {
    mode: { kind: "alternative", targetMove: "missed" },
    state: { kind: "consequence_demonstrated", lostMaterial: 300, atPly: 1 },
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
