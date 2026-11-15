// tests/analysis/graph-builder.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";

import { buildEvidenceGraph } from "../../lib/analysis/explain/graph-builder.ts";
import { ContractViolation, computeConfigHash } from "../../lib/analysis/core/contracts.ts";
import type {
  AnalysisConfig,
  AnalysisRoot,
  AnalyzedGame,
  ClassifiedMove,
  MateTransition,
  PVRecord,
} from "../../lib/analysis/core/types.ts";
import type { EvidenceFact } from "../../lib/analysis/explain/evidence-providers.ts";
import { FIXTURE_CONFIG } from "../fixtures/classification-golden.ts";

const CONFIG = FIXTURE_CONFIG as unknown as AnalysisConfig;
const CONFIG_HASH = computeConfigHash(CONFIG.engine);

// ═══════════════════════════════════════════════════════════
// Fixture PGNs and FENs (verified via chess.js)
// ═══════════════════════════════════════════════════════════

const STARTPOS = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Fool's mate: 1. f3 e5 2. g4 Qh4#
const FOOLS_MATE_PGN = "1. f3 e5 2. g4 Qh4# 0-1";
// Missed-mate setup: white to move has Ra8#, but plays Ra2. After that
// black plays Kf8; game continues with Ra8+ (check, not mate).
// Root FEN = MATE_IN_1_PRE. Ply 1 = Ra2 (missed mate).
const MISSED_MATE_SETUP_PGN = `[SetUp "1"]
[FEN "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1"]

1. Ra2 Kf8 2. Ra8+`;

// Mate-in-1 pre-move: white to move, Ra8# delivers mate
const MATE_IN_1_PRE = "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1";
// After Ra2 (not Ra8#): legal but forfeits mate
const MATE_IN_1_POST_RA2 = "6k1/5ppp/8/8/8/8/R7/6K1 b - - 1 1";

// ═══════════════════════════════════════════════════════════
// Builders
// ═══════════════════════════════════════════════════════════

function fenAfter(fen: string, moves: string[]): string {
  const c = new Chess(fen);
  for (const m of moves) c.move(m);
  return c.fen();
}

function makeRoot(id: string, fen: string): AnalysisRoot {
  return {
    id,
    fen,
    sideToMove: new Chess(fen).turn(),
    purpose: "find-best-move",
    engineIdentity: CONFIG.engine.identity,
    configHash: CONFIG_HASH,
    evaluationPerspective: "white",
    searchBudget: { kind: "movetime", value: 300 },
  };
}

function makePv(
  id: string,
  rootId: string,
  rootEval: PVRecord["rootEval"],
  moves: PVRecord["moves"],
  stability: "stable" | "unstable" = "stable",
): PVRecord {
  return {
    id, rootId, rootEval, depth: 10, stability,
    moves, createdAt: Date.now(),
  };
}

function makeMove(
  ply: number,
  san: string,
  evaluation: ClassifiedMove["evaluation"],
  quality: ClassifiedMove["quality"] = "Blunder",
  mateVerdict: MateTransition | null = null,
): ClassifiedMove {
  return {
    ply, san, quality, annotations: [],
    evaluation, expectedScore: null, mateVerdict,
    classificationVersion: "test",
  };
}

function makeGame(overrides: Partial<AnalyzedGame> = {}): AnalyzedGame {
  return {
    pgn: "",
    status: "complete",
    failures: [],
    roots: new Map(),
    pvs: new Map(),
    moves: [],
    explanations: new Map(),
    localizedExplanations: new Map(),
    refutations: new Map(),
    config: CONFIG,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════
// MATE_DELIVERED — Blockers 1 verification
// ═══════════════════════════════════════════════════════════

test("graph_mate_delivered_verified_against_game", () => {
  // Fool's mate: final position after 2...Qh4# is checkmate. Black wins.
  const finalFen = fenAfter(STARTPOS, ["f3", "e5", "g4", "Qh4#"]);

  const fact: EvidenceFact = {
    kind: "terminal_checkmate_delivered",
    ply: 4,
    winner: "black",
    terminalFen: finalFen,
    checkmateSquare: "e1", // white king's square (mated)
  };
  const game = makeGame({
    pgn: FOOLS_MATE_PGN,
    moves: [
      makeMove(4, "Qh4#", { type: "terminal", kind: "checkmate", winner: "black" }, "Best"),
    ],
  });

  const graph = buildEvidenceGraph([fact], game);
  assert.ok(graph.nodes.has("mate_delivered_4"));
  assert.ok(graph.nodes.has("mate_delivered_game_over_4"));
  // rootPositionFen should be STARTPOS (actual game root), not terminal
  assert.equal(graph.rootPositionFen, STARTPOS);
});

test("graph_mate_delivered_rejects_unrelated_terminal_fen", () => {
  const fact: EvidenceFact = {
    kind: "terminal_checkmate_delivered",
    ply: 4,
    winner: "black",
    // Wrong FEN: another back-rank mate, unrelated to Fool's mate
    terminalFen: "R5k1/5ppp/8/8/8/8/8/6K1 b - - 1 1",
    checkmateSquare: "g8",
  };
  const game = makeGame({
    pgn: FOOLS_MATE_PGN,
    moves: [makeMove(4, "Qh4#", { type: "terminal", kind: "checkmate", winner: "black" }, "Best")],
  });
  assert.throws(() => buildEvidenceGraph([fact], game), /does not match actual game position/);
});

test("graph_mate_delivered_rejects_wrong_winner", () => {
  const finalFen = fenAfter(STARTPOS, ["f3", "e5", "g4", "Qh4#"]);
  const fact: EvidenceFact = {
    kind: "terminal_checkmate_delivered",
    ply: 4,
    winner: "white", // WRONG — black delivered mate
    terminalFen: finalFen,
    checkmateSquare: "e1",
  };
  const game = makeGame({
    pgn: FOOLS_MATE_PGN,
    moves: [makeMove(4, "Qh4#", { type: "terminal", kind: "checkmate", winner: "black" }, "Best")],
  });
  assert.throws(() => buildEvidenceGraph([fact], game), /winner mismatch/);
});

test("graph_mate_delivered_rejects_non_checkmate_fen", () => {
  // Use a normal game, ply 1 = e4 (not checkmate)
  const PGN = "1. e4 e5";
  const postE4 = fenAfter(STARTPOS, ["e4"]);
  const fact: EvidenceFact = {
    kind: "terminal_checkmate_delivered",
    ply: 1,
    winner: "white",
    terminalFen: postE4,
    checkmateSquare: "e8",
  };
  const game = makeGame({
    pgn: PGN,
    moves: [makeMove(1, "e4", { type: "cp", value: 20 }, "Best")],
  });
  assert.throws(() => buildEvidenceGraph([fact], game), /is not checkmate/);
});

// ═══════════════════════════════════════════════════════════
// MISSED_MATE — Blocker 2 verification
// ═══════════════════════════════════════════════════════════

function makeMissedMateSetup(
  mateVerdictKind: "lost" | "preserved" | "delayed" | "gained" | "inconsistent" | null,
) {
  const root = makeRoot("root-1", MATE_IN_1_PRE);
  const pv = makePv("pv-1", "root-1", { type: "mate", in: 1, winner: "white" }, [
    { uci: "a1a8", san: "Ra8#", evalAfter: { type: "terminal", kind: "checkmate", winner: "white" } },
  ]);
  const playedEval = { type: "cp" as const, value: -100 };
  const mateVerdict: MateTransition | null = mateVerdictKind === null
    ? null
    : {
        before: { type: "mate", in: 1, winner: "white" },
        afterPlayed: playedEval,
        expectedAfterBest: { type: "terminal", kind: "checkmate", winner: "white" },
        moverColor: "w",
        verdict: mateVerdictKind === "lost"
          ? { kind: "lost" }
          : mateVerdictKind === "preserved"
          ? { kind: "preserved", distance: 1 }
          : mateVerdictKind === "delayed"
          ? { kind: "delayed", byMoves: 2, direction: "for_mover" }
          : mateVerdictKind === "gained"
          ? { kind: "gained", reason: "created_mate_best_missed" }
          : { kind: "inconsistent", reason: "test" },
      };

  const move = makeMove(1, "Ra2", playedEval, "Blunder", mateVerdict);
  const game = makeGame({
    pgn: MISSED_MATE_SETUP_PGN,
    roots: new Map([["root-1", root]]),
    pvs: new Map([["pv-1", pv]]),
    moves: [move],
  });

  const fact: EvidenceFact = {
    kind: "missed_mate",
    ply: 1, mateIn: 1,
    matingLine: [{ uci: "a1a8", san: "Ra8#" }],
    mateDeliveringMoveSan: "Ra8#",
    preMoveFen: MATE_IN_1_PRE,
    playedMoveUci: "a1a2", evalAfterPlayed: playedEval,
    pvId: "pv-1", rootId: "root-1", depth: 10,
  };

  return { fact, game };
}

test("graph_missed_mate_verified_when_verdict_lost", () => {
  const { fact, game } = makeMissedMateSetup("lost");
  const graph = buildEvidenceGraph([fact], game);
  assert.ok(graph.nodes.has("missed_mate_available_1"));
  assert.ok(graph.nodes.has("missed_mate_missed_1"));
  // missed_mate_missed should have both LEGAL_MOVE + engine proofs
  const missed = graph.nodes.get("missed_mate_missed_1");
  assert.equal(missed!.proofs.length, 2);
});

test("graph_missed_mate_rejects_forged_expectedAfterBest", () => {
  // Build setup with lost verdict, then corrupt expectedAfterBest so it
  // does not match expectedAfterBestMove(before, moverColor).
  const { fact, game } = makeMissedMateSetup("lost");
  // Corrupt: change expectedAfterBest to a cp(0) (not the projection of mate in 1)
  const move = game.moves[0] as ClassifiedMove;
  const corrupted: MateTransition = {
    ...move.mateVerdict!,
    expectedAfterBest: { type: "cp", value: 0 },
  };
  const corruptedMove: ClassifiedMove = { ...move, mateVerdict: corrupted };
  const corruptedGame = { ...game, moves: [corruptedMove] };

  assert.throws(
    () => buildEvidenceGraph([fact], corruptedGame),
    /expectedAfterBest does not match expectedAfterBestMove/,
  );
});

test("graph_missed_mate_rejects_forged_verdict", () => {
  // Setup with lost verdict, then replace verdict with a non-lost kind.
  // computeMateVerdict(afterPlayed=cp, expectedAfterBest=terminal, mover=white)
  // yields "lost" — so forging verdict to "preserved" must be rejected.
  const { fact, game } = makeMissedMateSetup("lost");
  const move = game.moves[0] as ClassifiedMove;
  const corrupted: MateTransition = {
    ...move.mateVerdict!,
    verdict: { kind: "preserved", distance: 1 },
  };
  const corruptedMove: ClassifiedMove = { ...move, mateVerdict: corrupted };
  const corruptedGame = { ...game, moves: [corruptedMove] };

  assert.throws(
    () => buildEvidenceGraph([fact], corruptedGame),
    /verdict mismatch/,
  );
});

test("graph_missed_mate_rejects_verdict_preserved", () => {
  // Recorded verdict says "preserved" but recompute from evaluations says
  // "lost" — caught by verdict mismatch check, not by an early label check.
  const { fact, game } = makeMissedMateSetup("preserved");
  assert.throws(() => buildEvidenceGraph([fact], game), /verdict mismatch/);
});

test("graph_missed_mate_rejects_verdict_delayed", () => {
  // Same: recorded "delayed" vs recomputed "lost" → verdict mismatch.
  const { fact, game } = makeMissedMateSetup("delayed");
  assert.throws(() => buildEvidenceGraph([fact], game), /verdict mismatch/);
});

test("graph_missed_mate_rejects_null_mate_verdict", () => {
  const { fact, game } = makeMissedMateSetup(null);
  assert.throws(() => buildEvidenceGraph([fact], game), /requires move\.mateVerdict/);
});

// ═══════════════════════════════════════════════════════════
// ENGINE_PREFERRED — Blocker 3 verification
// ═══════════════════════════════════════════════════════════

function makeEnginePreferredSetup(overrides: Partial<{
  playedMoveUci: string;
  engineMoveUci: string;
  quality: ClassifiedMove["quality"];
  pvStability: "stable" | "unstable";
  rootFen: string;
}> = {}) {
  const pgn = "1. e4 e5";
  const rootFen = overrides.rootFen ?? STARTPOS;
  const root = makeRoot("root-1", rootFen);
  const pv = makePv("pv-1", "root-1", { type: "cp", value: 20 }, [
    { uci: "e2e4", san: "e4", evalAfter: { type: "unknown" } },
  ], overrides.pvStability ?? "stable");
  const move = makeMove(1, "e4", { type: "cp", value: 20 }, overrides.quality ?? "Best");

  const game = makeGame({
    pgn,
    roots: new Map([["root-1", root]]),
    pvs: new Map([["pv-1", pv]]),
    moves: [move],
  });

  const fact: EvidenceFact = {
    kind: "engine_preferred",
    ply: 1,
    playedMoveUci: overrides.playedMoveUci ?? "e2e4",
    engineMoveUci: overrides.engineMoveUci ?? "e2e4",
    pvId: "pv-1", rootId: "root-1", depth: 10,
  };

  return { fact, game };
}

test("graph_engine_preferred_verified", () => {
  const { fact, game } = makeEnginePreferredSetup();
  const graph = buildEvidenceGraph([fact], game);
  assert.ok(graph.nodes.has("engine_preferred_1"));
});

test("graph_engine_preferred_rejects_played_differs_from_engine", () => {
  const { fact, game } = makeEnginePreferredSetup({
    playedMoveUci: "d2d4", // differs from engine "e2e4"
    engineMoveUci: "e2e4",
  });
  assert.throws(() => buildEvidenceGraph([fact], game), /playedMoveUci.*must equal engineMoveUci/);
});

test("graph_engine_preferred_rejects_quality_not_best", () => {
  const { fact, game } = makeEnginePreferredSetup({ quality: "Excellent" });
  assert.throws(() => buildEvidenceGraph([fact], game), /requires move\.quality === "Best"/);
});

test("graph_engine_preferred_rejects_unstable_pv", () => {
  const { fact, game } = makeEnginePreferredSetup({ pvStability: "unstable" });
  assert.throws(() => buildEvidenceGraph([fact], game), /requires stable PV/);
});
