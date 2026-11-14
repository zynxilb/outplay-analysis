// tests/analysis/classification-colors.test.ts
// Mirrored-color tests: same chess situation from White's or Black's
// perspective must produce the same quality level.

import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveClassification } from "../../lib/analysis/core/contracts.ts";
import type {
  AnalysisConfig,
  ClassificationInput,
  Evaluation,
  SourcedEvaluation,
} from "../../lib/analysis/core/types.ts";
import { FIXTURE_CONFIG } from "../fixtures/classification-golden.ts";

const CONFIG = FIXTURE_CONFIG as unknown as AnalysisConfig;

function fakeEval(pvId: string, rootId: string, ev: Evaluation): SourcedEvaluation {
  return { eval: ev, pvId, rootId, depth: 14 };
}

/** Flip an evaluation's perspective (White ↔ Black). */
function flipEval(ev: Evaluation): Evaluation {
  if (ev.type === "cp") return { type: "cp", value: -ev.value };
  if (ev.type === "mate") {
    return {
      type: "mate",
      in: ev.in,
      winner: ev.winner === "white" ? "black" : "white",
    };
  }
  return ev;
}

function buildInput(
  epLoss: number,
  cpLoss: number,
  moverColor: "w" | "b",
): ClassificationInput {
  const whiteCP = { type: "cp" as const, value: 100 };
  return {
    ply: 1,
    san: "test",
    playedMoveUci: "e2e4",
    bestMoveUci: "d2d4",
    moverColor,
    preMoveFen: moverColor === "w"
      ? "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
      : "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
    postMoveFen: moverColor === "w"
      ? "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
      : "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2",
    evalBefore: fakeEval("pv-before", "root-pre", whiteCP),
    evalAfterPlayed: fakeEval("pv-played", "root-post", whiteCP),
    epLoss,
    cpLoss,
    annotations: [],
    preMoveRootId: "root-pre",
    postMoveRootId: "root-post",
  };
}

// Each pair: [epLoss, cpLoss, expectedQuality]
const MIRROR_PAIRS: Array<[number, number, string]> = [
  [0.00, 0, "Best"],
  [0.015, 50, "Excellent"],
  [0.04, 80, "Good"],
  [0.07, 100, "Inaccuracy"],
  [0.12, 150, "Mistake"],
  [0.20, 250, "Blunder"],
  [0.005, 250, "Inaccuracy"], // CP floor
];

for (const [epLoss, cpLoss, expected] of MIRROR_PAIRS) {
  test(`mirror: epLoss=${epLoss}, cpLoss=${cpLoss} → ${expected} for both colors`, () => {
    const white = deriveClassification(buildInput(epLoss, cpLoss, "w"), CONFIG);
    const black = deriveClassification(buildInput(epLoss, cpLoss, "b"), CONFIG);

    assert.equal(
      white.quality,
      expected,
      `White classification wrong for epLoss=${epLoss}`,
    );
    assert.equal(
      black.quality,
      expected,
      `Black classification wrong for epLoss=${epLoss}`,
    );
    assert.equal(
      white.quality,
      black.quality,
      `Color mismatch: white=${white.quality} black=${black.quality}`,
    );
  });
}

// Mate preserved (after projection): both colors → Best
test("mirror: mate preserved (projected) → Best for both colors", () => {
  const whiteInput = buildInput(0, 0, "w");
  whiteInput.evalBefore = fakeEval("pv-before", "root-pre", { type: "mate", in: 3, winner: "white" });
  whiteInput.evalAfterPlayed = fakeEval("pv-played", "root-post", { type: "mate", in: 2, winner: "white" });

  const blackInput = buildInput(0, 0, "b");
  blackInput.evalBefore = fakeEval("pv-before", "root-pre", { type: "mate", in: 3, winner: "black" });
  blackInput.evalAfterPlayed = fakeEval("pv-played", "root-post", { type: "mate", in: 2, winner: "black" });

  const white = deriveClassification(whiteInput, CONFIG);
  const black = deriveClassification(blackInput, CONFIG);

  assert.equal(white.quality, "Best");
  assert.equal(black.quality, "Best");
});

// Mate lost: both colors → Blunder
test("mirror: mate lost → Blunder for both colors", () => {
  const whiteInput = buildInput(0, 0, "w");
  whiteInput.evalBefore = fakeEval("pv-before", "root-pre", { type: "mate", in: 3, winner: "white" });
  whiteInput.evalAfterPlayed = fakeEval("pv-played", "root-post", { type: "cp", value: 0 });

  const blackInput = buildInput(0, 0, "b");
  blackInput.evalBefore = fakeEval("pv-before", "root-pre", { type: "mate", in: 3, winner: "black" });
  blackInput.evalAfterPlayed = fakeEval("pv-played", "root-post", { type: "cp", value: 0 });

  const white = deriveClassification(whiteInput, CONFIG);
  const black = deriveClassification(blackInput, CONFIG);

  assert.equal(white.quality, "Blunder");
  assert.equal(black.quality, "Blunder");
});
