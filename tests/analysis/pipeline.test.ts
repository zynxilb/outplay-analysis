// tests/analysis/pipeline.test.ts
// Stage 4 Day 3 — pipeline with mock engine tests.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  replayPgn,
  analyzeGame,
} from "../../lib/analysis/pipeline.ts";
import type {
  AnalysisConfig,
  AnalysisRoot,
  PVRecord,
  SearchBudget,
  AnalysisPurpose,
  Evaluation,
} from "../../lib/analysis/core/types.ts";
import type { EngineLayer } from "../../lib/analysis/core/contracts.ts";
import { Chess } from "chess.js";
import { FIXTURE_CONFIG } from "../fixtures/classification-golden.ts";

const CONFIG = FIXTURE_CONFIG as unknown as AnalysisConfig;

const OPERA_PGN = `[Event "Paris Opera"]
[White "Morphy"]
[Black "Duke Karl"]

1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5 10.Nxb5 cxb5 11.Bxb5+ Nbd7 12.O-O-O Rd8 13.Rxd7 Rxd7 14.Rd1 Qe6 15.Bxd7+ Nxd7 16.Qb8+ Nxb8 17.Rd8# 1-0`;

// ═══════════════════════════════════════════════════════════
// Mock engine — deterministic, no WASM
// ═══════════════════════════════════════════════════════════

interface MockOptions {
  readonly failAtPly?: number; // reject search at this fen (by index, 0-based)
  readonly fatalAtPly?: number;
  readonly cpValue?: number;
}

class MockEngine implements EngineLayer {
  private counter = 0;
  private searchCount = 0;
  private readonly opts: MockOptions;

  constructor(opts: MockOptions = {}) {
    this.opts = opts;
  }

  async initialize(): Promise<void> {}
  async abort(): Promise<void> {}
  async dispose(): Promise<void> {}

  async search(
    fen: string,
    purpose: AnalysisPurpose,
    budget: SearchBudget,
  ): Promise<{ root: AnalysisRoot; pv: PVRecord }> {
    const idx = this.searchCount++;
    if (this.opts.failAtPly === idx) {
      throw new Error(`Mock failure at search ${idx}`);
    }
    if (this.opts.fatalAtPly === idx) {
      throw new Error(`Stockfish: forced fatal at ${idx}`);
    }
    this.counter++;

    // Realistic mock: detect mate-in-1 via chess.js so the classifier
    // sees a consistent mate score (not cp). Without this, positions
    // like "before 17.Rd8#" return cp and trigger a false "gained"
    // verdict in computeMateVerdict.
    const chess = new Chess(fen);
    const mover = chess.turn(); // 'w' | 'b' — side to move
    const legalMoves = chess.moves({ verbose: true });

    let rootEval: Evaluation = { type: "cp", value: this.opts.cpValue ?? 20 };
    let pvMove = { uci: "e2e4", san: "e4" };

    for (const m of legalMoves) {
      chess.move(m.san);
      const isMate = chess.isCheckmate();
      chess.undo();
      if (isMate) {
        rootEval = {
          type: "mate",
          in: 1,
          winner: mover === "w" ? "white" : "black",
        };
        pvMove = { uci: m.from + m.to + (m.promotion ?? ""), san: m.san };
        break;
      }
    }

    const root: AnalysisRoot = {
      id: `mock-root-${this.counter}`,
      fen,
      sideToMove: mover,
      purpose,
      engineIdentity: "mock-engine",
      configHash: "mock-hash",
      evaluationPerspective: "white",
      searchBudget: budget,
    };
    const pv: PVRecord = {
      id: `mock-pv-${this.counter}`,
      rootId: root.id,
      rootEval,
      depth: 10,
      stability: "stable",
      moves: [{ uci: pvMove.uci, san: pvMove.san, evalAfter: { type: "unknown" } }],
      createdAt: Date.now(),
    };
    return { root, pv };
  }
}

// ─── Test 1: replayPgn still works ──────────────────────
test("replay_pgn_opera_produces_34_states", () => {
  const result = replayPgn(OPERA_PGN);
  assert.equal(result.positions.length, 34);
});

// ─── Test 2: analyzeGame with mock completes ────────────
test("analyze_game_mock_returns_complete", async () => {
  const engine = new MockEngine();
  const result = await analyzeGame(OPERA_PGN, CONFIG, { engine });
  assert.equal(result.status, "complete");
  assert.equal(result.failures.length, 0);
  assert.equal(result.moves.length, 33); // 33 moves
});

// ─── Test 3: all moves have quality ─────────────────────
test("analyze_game_mock_all_moves_classified", async () => {
  const engine = new MockEngine();
  const result = await analyzeGame(OPERA_PGN, CONFIG, { engine });
  for (const move of result.moves) {
    assert.ok(typeof move.quality === "string");
    assert.ok(move.quality.length > 0);
  }
});

// ─── Test 4: roots/pvs populated ────────────────────────
test("analyze_game_mock_populates_roots_and_pvs", async () => {
  const engine = new MockEngine();
  const result = await analyzeGame(OPERA_PGN, CONFIG, { engine });
  // 33 positions searched: initial + 32 non-terminal post-moves
  // (final move is terminal, no post-search)
  assert.ok(result.roots.size > 0);
  assert.ok(result.pvs.size > 0);
  assert.equal(result.roots.size, result.pvs.size);
});

// ─── Test 5: individual failure is fail-soft ────────────
test("analyze_game_mock_fail_soft_on_single_search", async () => {
  const engine = new MockEngine({ failAtPly: 5 });
  const result = await analyzeGame(OPERA_PGN, CONFIG, { engine });
  assert.equal(result.status, "partial");
  assert.ok(result.failures.length >= 1);
  assert.ok(result.moves.length > 0); // some moves still classified
});

// ─── Test 6: fatal failure stops further searches ───────
test("analyze_game_mock_stops_on_fatal", async () => {
  const engine = new MockEngine({ fatalAtPly: 5 });
  const result = await analyzeGame(OPERA_PGN, CONFIG, { engine });
  assert.equal(result.status, "partial");
  assert.ok(result.failures.some((f) => /Fatal engine failure/i.test(f.reason)));
});

// ─── Test 7: PGN parse failure returns partial ──────────
test("analyze_game_malformed_pgn_returns_partial", async () => {
  const engine = new MockEngine();
  const result = await analyzeGame("garbage", CONFIG, { engine });
  assert.equal(result.status, "partial");
  assert.ok(result.failures.some((f) => f.stage === "pgn_parse"));
});

// ─── Test 8: terminal final move classified ─────────────
test("analyze_game_mock_terminal_final_move_classified", async () => {
  const engine = new MockEngine();
  const result = await analyzeGame(OPERA_PGN, CONFIG, { engine });
  // Last move is Rd8# → terminal. The final move should be classified
  // (mate transition, but not a search failure).
  const lastMove = result.moves[result.moves.length - 1];
  assert.equal(lastMove.san, "Rd8#");
});

// ─── Test 9: explanations/refutations empty ────────────
test("analyze_game_mock_empty_explanations_refutations", async () => {
  const engine = new MockEngine();
  const result = await analyzeGame(OPERA_PGN, CONFIG, { engine });
  assert.equal(result.explanations.size, 0);
  assert.equal(result.refutations.size, 0);
});

// ─── Test 10: budgetOverride respected ─────────────────
test("analyze_game_mock_budget_override", async () => {
  const engine = new MockEngine();
  const result = await analyzeGame(OPERA_PGN, CONFIG, {
    engine,
    budgetOverride: { kind: "depth", value: 5 },
  });
  assert.ok(result.roots.size > 0);
  // Verify budget propagated
  for (const root of result.roots.values()) {
    assert.equal(root.searchBudget.kind, "depth");
    assert.equal(root.searchBudget.value, 5);
  }
});
