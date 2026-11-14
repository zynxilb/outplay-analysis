// tests/analysis/classification.test.ts
// Table-driven tests for deriveClassification against golden fixtures.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  deriveClassification,
  ContractViolation,
} from "../../lib/analysis/core/contracts.ts";
import type {
  AnalysisConfig,
  AnyEvaluation,
  ClassificationInput,
  Evaluation,
  RulesSourcedEvaluation,
  SourcedEvaluation,
} from "../../lib/analysis/core/types.ts";
import {
  GOLDEN_CASES,
  FIXTURE_CONFIG,
  type GoldenCase,
} from "../fixtures/classification-golden.ts";

// ─── Helpers ─────────────────────────────────────────────

const CONFIG = FIXTURE_CONFIG as unknown as AnalysisConfig;

function fakeEval(pvId: string, rootId: string, ev: Evaluation): SourcedEvaluation {
  return { eval: ev, pvId, rootId, depth: 14 };
}

function fakeTerminalEval(ev: AnyEvaluation): RulesSourcedEvaluation {
  let fen: string;
  if (ev.type === "terminal") {
    switch (ev.kind) {
      case "checkmate":
        // Black to move, black king in check, no escapes. Rook on a8,
        // black king on g8, white pawns f7/g7/h7 — classic back-rank mate.
        fen = "R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1";
        break;
      case "stalemate":
        // Black king h8, white queen f7, white king g6. Black to move:
        // h8 not in check. Escapes g8/g7/h7 all attacked. Stalemate.
        fen = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1";
        break;
      case "draw":
        // Insufficient material: K vs K (no pawns, no pieces).
        fen = "8/8/8/8/8/4k3/4K3/8 w - - 0 1";
        break;
      default: {
        const _e: never = ev.kind;
        throw new Error(`unhandled terminal kind ${JSON.stringify(_e)}`);
      }
    }
  } else {
    fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  }
  return {
    eval: ev as RulesSourcedEvaluation["eval"],
    fen,
    rulesSource: "chess.js",
  };
}

function buildInput(c: GoldenCase): ClassificationInput {
  const playedIsTerminal = c.input.evalAfterPlayed.type === "terminal";
  return {
    ply: 1,
    san: "test",
    playedMoveUci: "e2e4",
    bestMoveUci: "d2d4",
    moverColor: c.input.moverColor,
    preMoveFen: c.input.moverColor === "w"
      ? "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
      : "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
    postMoveFen: c.input.moverColor === "w"
      ? "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
      : "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2",
    evalBefore: fakeEval("pv-before", "root-pre", c.input.evalBefore),
    evalAfterPlayed: playedIsTerminal
      ? fakeTerminalEval(c.input.evalAfterPlayed)
      : fakeEval("pv-played", "root-post", c.input.evalAfterPlayed as Evaluation),
    epLoss: c.input.epLoss,
    cpLoss: c.input.cpLoss,
    annotations: c.input.annotations,
    preMoveRootId: "root-pre",
    postMoveRootId: "root-post",
  };
}

// ─── One test per fixture (table-driven) ─────────────────

for (const c of GOLDEN_CASES) {
  test(`golden: ${c.id}`, () => {
    const input = buildInput(c);

    if (c.expected.kind === "throws") {
      assert.throws(
        () => deriveClassification(input, CONFIG),
        (err: unknown) => {
          if (!(err instanceof Error)) return false;
          return c.expected.match.test(err.message);
        },
        `Expected throw matching ${c.expected.match}, got none. Case: ${c.description}`,
      );
      return;
    }

    const out = deriveClassification(input, CONFIG);
    assert.equal(
      out.quality,
      c.expected.quality,
      `Quality mismatch in "${c.id}": ${c.description}`,
    );
    // Annotation preservation (order-independent set equality)
    assert.deepEqual(
      [...out.annotations].sort(),
      [...c.expected.annotations].sort(),
      `Annotations mismatch in "${c.id}"`,
    );
  });
}

// ─── Sanity: no duplicate IDs ───────────────────────────

test("golden: no duplicate fixture ids", () => {
  const seen = new Set<string>();
  for (const c of GOLDEN_CASES) {
    assert.ok(!seen.has(c.id), `Duplicate fixture id: ${c.id}`);
    seen.add(c.id);
  }
});
