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
  PVRecord,
} from "../../lib/analysis/core/types.ts";
import type { EvidenceFact } from "../../lib/analysis/explain/evidence-providers.ts";
import { FIXTURE_CONFIG } from "../fixtures/classification-golden.ts";

const CONFIG = FIXTURE_CONFIG as unknown as AnalysisConfig;
const CONFIG_HASH = computeConfigHash(CONFIG.engine);

// ─── Fixture helpers ────────────────────────────────────

function fenAfter(fen: string, moves: string[]): string {
  const c = new Chess(fen);
  for (const m of moves) c.move(m);
  return c.fen();
}

const STARTPOS = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const MATE_IN_1_FEN = "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1";
// Verified: Ra8# from MATE_IN_1_FEN → back-rank checkmate
const MATE_IN_1_AFTER = fenAfter(MATE_IN_1_FEN, ["Ra8#"]);

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
): PVRecord {
  return {
    id, rootId, rootEval, depth: 10, stability: "stable",
    moves, createdAt: Date.now(),
  };
}

function makeMove(
  ply: number,
  san: string,
  evaluation: ClassifiedMove["evaluation"],
  quality: ClassifiedMove["quality"] = "Blunder",
): ClassifiedMove {
  return {
    ply, san, quality, annotations: [],
    evaluation, expectedScore: null, mateVerdict: null,
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
    refutations: new Map(),
    config: CONFIG,
    ...overrides,
  };
}

// ─── MATE_DELIVERED ─────────────────────────────────────

test("graph_mate_delivered_creates_event_and_game_over", () => {
  const fact: EvidenceFact = {
    kind: "terminal_checkmate_delivered",
    ply: 1,
    winner: "white",
    terminalFen: MATE_IN_1_AFTER,
    checkmateSquare: "g8",
  };
  const game = makeGame();
  const graph = buildEvidenceGraph([fact], game);

  assert.equal(graph.nodes.size, 2);
  assert.ok(graph.nodes.has("mate_delivered_1"));
  assert.ok(graph.nodes.has("mate_delivered_game_over_1"));
  assert.equal(graph.causalEdges.length, 1);
  assert.equal(graph.causalEdges[0].type, "causes");
});

test("graph_mate_delivered_rejects_non_checkmate_fen", () => {
  const fact: EvidenceFact = {
    kind: "terminal_checkmate_delivered",
    ply: 1,
    winner: "white",
    terminalFen: STARTPOS, // not checkmate
    checkmateSquare: "g8",
  };
  assert.throws(() => buildEvidenceGraph([fact], makeGame()), ContractViolation);
});

// ─── MISSED_MATE ────────────────────────────────────────

test("graph_missed_mate_creates_chain", () => {
  const root = makeRoot("root-1", MATE_IN_1_FEN);
  const pv = makePv("pv-1", "root-1", { type: "mate", in: 1, winner: "white" }, [
    { uci: "a1a8", san: "Ra8#", evalAfter: { type: "terminal", kind: "checkmate", winner: "white" } },
  ]);
  const playedEval = { type: "cp" as const, value: -100 };
  const move = makeMove(1, "Ra2", playedEval);

  const fact: EvidenceFact = {
    kind: "missed_mate",
    ply: 1,
    mateIn: 1,
    matingLine: [{ uci: "a1a8", san: "Ra8#" }],
    mateDeliveringMoveSan: "Ra8#",
    preMoveFen: MATE_IN_1_FEN,
    playedMoveUci: "a1a2",
    evalAfterPlayed: playedEval,
    pvId: "pv-1",
    rootId: "root-1",
    depth: 10,
  };

  const game = makeGame({
    roots: new Map([["root-1", root]]),
    pvs: new Map([["pv-1", pv]]),
    moves: [move],
  });

  const graph = buildEvidenceGraph([fact], game);

  assert.equal(graph.nodes.size, 3);
  assert.ok(graph.nodes.has("missed_mate_available_1"));
  assert.ok(graph.nodes.has("missed_mate_pv_1"));
  assert.ok(graph.nodes.has("missed_mate_missed_1"));
  assert.equal(graph.causalEdges.length, 2);
});

test("graph_missed_mate_rejects_missing_pv", () => {
  const root = makeRoot("root-1", MATE_IN_1_FEN);
  const playedEval = { type: "cp" as const, value: -100 };
  const fact: EvidenceFact = {
    kind: "missed_mate",
    ply: 1, mateIn: 1,
    matingLine: [{ uci: "a1a8", san: "Ra8#" }],
    mateDeliveringMoveSan: "Ra8#",
    preMoveFen: MATE_IN_1_FEN,
    playedMoveUci: "a1a2", evalAfterPlayed: playedEval,
    pvId: "ghost-pv", // does not exist
    rootId: "root-1", depth: 10,
  };
  const game = makeGame({
    roots: new Map([["root-1", root]]),
    pvs: new Map(), // empty
    moves: [makeMove(1, "Ra2", playedEval)],
  });
  assert.throws(() => buildEvidenceGraph([fact], game), /not found in game\.pvs/);
});

test("graph_missed_mate_rejects_depth_mismatch", () => {
  const root = makeRoot("root-1", MATE_IN_1_FEN);
  const pv = makePv("pv-1", "root-1", { type: "mate", in: 1, winner: "white" }, [
    { uci: "a1a8", san: "Ra8#", evalAfter: { type: "unknown" } },
  ]);
  pv.depth = 14;
  const playedEval = { type: "cp" as const, value: -100 };
  const fact: EvidenceFact = {
    kind: "missed_mate",
    ply: 1, mateIn: 1,
    matingLine: [{ uci: "a1a8", san: "Ra8#" }],
    mateDeliveringMoveSan: "Ra8#",
    preMoveFen: MATE_IN_1_FEN,
    playedMoveUci: "a1a2", evalAfterPlayed: playedEval,
    pvId: "pv-1", rootId: "root-1", depth: 10, // mismatch: PV depth=14
  };
  const game = makeGame({
    roots: new Map([["root-1", root]]),
    pvs: new Map([["pv-1", pv]]),
    moves: [makeMove(1, "Ra2", playedEval)],
  });
  assert.throws(() => buildEvidenceGraph([fact], game), /pv\.depth 14 != fact\.depth 10/);
});

test("graph_missed_mate_rejects_move_evaluation_mismatch", () => {
  const root = makeRoot("root-1", MATE_IN_1_FEN);
  const pv = makePv("pv-1", "root-1", { type: "mate", in: 1, winner: "white" }, [
    { uci: "a1a8", san: "Ra8#", evalAfter: { type: "unknown" } },
  ]);
  const fact: EvidenceFact = {
    kind: "missed_mate",
    ply: 1, mateIn: 1,
    matingLine: [{ uci: "a1a8", san: "Ra8#" }],
    mateDeliveringMoveSan: "Ra8#",
    preMoveFen: MATE_IN_1_FEN,
    playedMoveUci: "a1a2",
    evalAfterPlayed: { type: "cp", value: -100 },
    pvId: "pv-1", rootId: "root-1", depth: 10,
  };
  const game = makeGame({
    roots: new Map([["root-1", root]]),
    pvs: new Map([["pv-1", pv]]),
    // Classified move says cp(0), fact says cp(-100)
    moves: [makeMove(1, "Ra2", { type: "cp", value: 0 })],
  });
  assert.throws(() => buildEvidenceGraph([fact], game), /evaluation/);
});

// ─── ENGINE_PREFERRED ───────────────────────────────────

test("graph_engine_preferred_creates_single_node", () => {
  const root = makeRoot("root-1", STARTPOS);
  const pv = makePv("pv-1", "root-1", { type: "cp", value: 20 }, [
    { uci: "e2e4", san: "e4", evalAfter: { type: "unknown" } },
  ]);
  const fact: EvidenceFact = {
    kind: "engine_preferred",
    ply: 1,
    playedMoveUci: "e2e4",
    engineMoveUci: "e2e4",
    pvId: "pv-1", rootId: "root-1", depth: 10,
  };
  const game = makeGame({
    roots: new Map([["root-1", root]]),
    pvs: new Map([["pv-1", pv]]),
    moves: [makeMove(1, "e4", { type: "cp", value: 20 }, "Best")],
  });
  const graph = buildEvidenceGraph([fact], game);
  assert.equal(graph.nodes.size, 1);
  assert.ok(graph.nodes.has("engine_preferred_1"));
  assert.equal(graph.causalEdges.length, 0);
});

test("graph_engine_preferred_rejects_pv_head_mismatch", () => {
  const root = makeRoot("root-1", STARTPOS);
  const pv = makePv("pv-1", "root-1", { type: "cp", value: 20 }, [
    { uci: "d2d4", san: "d4", evalAfter: { type: "unknown" } },
  ]);
  const fact: EvidenceFact = {
    kind: "engine_preferred",
    ply: 1,
    playedMoveUci: "e2e4",
    engineMoveUci: "e2e4",
    pvId: "pv-1", rootId: "root-1", depth: 10,
  };
  const game = makeGame({
    roots: new Map([["root-1", root]]),
    pvs: new Map([["pv-1", pv]]),
    moves: [makeMove(1, "e4", { type: "cp", value: 20 }, "Best")],
  });
  assert.throws(() => buildEvidenceGraph([fact], game), /PV head UCI/);
});
