// tests/analysis/pipeline.test.ts
// Stage 4 Day 3 — pipeline with mock engine tests.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  replayPgn,
  analyzeGame,
  localizeAll,
  type RendererFn,
} from "../../lib/analysis/pipeline.ts";
import type {
  AnalysisConfig,
  AnalysisFailure,
  AnalysisRoot,
  AnalyzedGame,
  EvidenceGraph,
  ExplanationOutput,
  PVRecord,
  SearchBudget,
  AnalysisPurpose,
  Evaluation,
} from "../../lib/analysis/core/types.ts";
import { ContractViolation } from "../../lib/analysis/core/contracts.ts";
import type { EngineLayer } from "../../lib/analysis/core/contracts.ts";
import { Chess } from "chess.js";
import { computeConfigHash } from "../../lib/analysis/core/contracts.ts";
import { FIXTURE_CONFIG } from "../fixtures/classification-golden.ts";

const CONFIG = FIXTURE_CONFIG as unknown as AnalysisConfig;
const FIXTURE_ENGINE_IDENTITY = CONFIG.engine.identity;
const FIXTURE_CONFIG_HASH = computeConfigHash(CONFIG.engine);

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
      engineIdentity: FIXTURE_ENGINE_IDENTITY,
      configHash: FIXTURE_CONFIG_HASH,
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
test("analyze_game_mock_explanations_populated_refutations_empty", async () => {
  // Stage 5 Day 2: explanations are populated (Stage 4 scope removed).
  const engine = new MockEngine();
  const result = await analyzeGame(OPERA_PGN, CONFIG, { engine });
  assert.ok(
    result.explanations.size > 0,
    `expected explanations.size > 0 (Stage 5 Day 2 scope), got ${result.explanations.size}`,
  );
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


// ═══════════════════════════════════════════════════════════
// Stage 4 blockers — fatal pre-move / cancellation / provenance
// ═══════════════════════════════════════════════════════════

class AbortableMockEngine implements EngineLayer {
  private searchCount = 0;
  private readonly fatalAt: number | null;
  private readonly abortAt: number | null;
  private readonly corruptedFenAt: number | null;

  constructor(opts: { fatalAt?: number; abortAt?: number; corruptedFenAt?: number } = {}) {
    this.fatalAt = opts.fatalAt ?? null;
    this.abortAt = opts.abortAt ?? null;
    this.corruptedFenAt = opts.corruptedFenAt ?? null;
  }

  async initialize(): Promise<void> {}
  async abort(): Promise<void> {}
  async dispose(): Promise<void> {}

  async search(fen: string, purpose: AnalysisPurpose, budget: SearchBudget): Promise<{ root: AnalysisRoot; pv: PVRecord }> {
    const idx = this.searchCount++;
    if (this.fatalAt === idx) throw new Error("Stockfish: worker disposed unexpectedly");
    if (this.abortAt === idx) {
      const e = new Error("Search aborted"); e.name = "AbortError"; throw e;
    }
    const rootFen = this.corruptedFenAt === idx
      ? "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" // fixed FEN, may not match searched
      : fen;
    const root: AnalysisRoot = {
      id: `abort-root-${idx}`, fen: rootFen, sideToMove: fen.includes(" w ") ? "w" : "b",
      purpose, engineIdentity: FIXTURE_ENGINE_IDENTITY, configHash: FIXTURE_CONFIG_HASH,
      evaluationPerspective: "white", searchBudget: budget,
    };
    const pv: PVRecord = {
      id: `abort-pv-${idx}`, rootId: root.id,
      rootEval: { type: "cp", value: 20 }, depth: 10, stability: "stable",
      moves: [{ uci: "e2e4", san: "e4", evalAfter: { type: "unknown" } }],
      createdAt: Date.now(),
    };
    return { root, pv };
  }
}

test("blocker_fatal_pre_move_search_stops_analysis", async () => {
  const engine = new AbortableMockEngine({ fatalAt: 0 }); // first search fails fatally
  const result = await analyzeGame(OPERA_PGN, CONFIG, { engine });
  assert.equal(result.status, "partial");
  assert.equal(result.moves.length, 0);
  assert.ok(result.failures.some((f) => /Fatal engine failure/i.test(f.reason)));
});

test("blocker_abort_pre_move_stops_analysis", async () => {
  const engine = new AbortableMockEngine({ abortAt: 0 });
  const result = await analyzeGame(OPERA_PGN, CONFIG, { engine });
  assert.equal(result.status, "partial");
  assert.equal(result.moves.length, 0);
  assert.ok(result.failures.some((f) => /cancelled/i.test(f.reason)));
});

test("blocker_abort_post_move_stops_analysis", async () => {
  const engine = new AbortableMockEngine({ abortAt: 1 }); // abort at first post-search
  const result = await analyzeGame(OPERA_PGN, CONFIG, { engine });
  assert.equal(result.status, "partial");
  // Pre-move search (idx 0) succeeded, post-move (idx 1) aborted → no classified moves
  assert.equal(result.moves.length, 0);
  assert.ok(result.failures.some((f) => /cancelled/i.test(f.reason)));
});

test("blocker_provenance_root_fen_mismatch_rejected", async () => {
  // corruptedFenAt=1: first post-move search (after e4). The searched FEN
  // is different from startpos, so the corrupted root (startpos FEN)
  // triggers the root.fen !== searched fen check in runSearch.
  // (corruptedFenAt=0 would be the pre-move search of startpos, which
  //  happens to have the same FEN as the corrupted override — no mismatch.)
  const engine = new AbortableMockEngine({ corruptedFenAt: 1 });
  const result = await analyzeGame(OPERA_PGN, CONFIG, { engine });
  assert.equal(result.status, "partial");
  assert.ok(result.failures.some((f) => /root\.fen/i.test(f.reason)));
});

test("blocker_signal_aborted_before_start", async () => {
  const engine = new AbortableMockEngine();
  const ac = new AbortController();
  ac.abort();
  const result = await analyzeGame(OPERA_PGN, CONFIG, { engine, signal: ac.signal });
  assert.equal(result.status, "partial");
  assert.equal(result.moves.length, 0);
  assert.ok(result.failures.some((f) => /cancelled before start/i.test(f.reason)));
});


// ═══════════════════════════════════════════════════════════
// Active cancellation — engine.abort() must be invoked
// ═══════════════════════════════════════════════════════════

/**
 * Deferred mock engine: search() returns a promise that only settles
 * when the test triggers abort() or an explicit resolve().
 * Tracks abort() call count so tests can assert it was invoked.
 */
class DeferredMockEngine implements EngineLayer {
  private pending: Array<{
    resolve: (v: { root: AnalysisRoot; pv: PVRecord }) => void;
    reject: (e: Error) => void;
    fen: string;
    purpose: AnalysisPurpose;
    budget: SearchBudget;
  }> = [];
  abortCount = 0;

  async initialize(): Promise<void> {}
  async dispose(): Promise<void> {}

  async abort(): Promise<void> {
    this.abortCount++;
    const pending = this.pending;
    this.pending = [];
    for (const p of pending) {
      const e = new Error("Search aborted");
      e.name = "AbortError";
      p.reject(e);
    }
  }

  async search(
    fen: string,
    purpose: AnalysisPurpose,
    budget: SearchBudget,
  ): Promise<{ root: AnalysisRoot; pv: PVRecord }> {
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject, fen, purpose, budget });
    });
  }

  /** Manually resolve all pending (used to prove abort did not fire). */
  resolveAll(): void {
    const pending = this.pending;
    this.pending = [];
    for (let i = 0; i < pending.length; i++) {
      const p = pending[i];
      const root: AnalysisRoot = {
        id: `deferred-root-${i}`,
        fen: p.fen,
        sideToMove: p.fen.includes(" w ") ? "w" : "b",
        purpose: p.purpose,
        engineIdentity: FIXTURE_ENGINE_IDENTITY,
        configHash: FIXTURE_CONFIG_HASH,
        evaluationPerspective: "white",
        searchBudget: p.budget,
      };
      const pv: PVRecord = {
        id: `deferred-pv-${i}`,
        rootId: root.id,
        rootEval: { type: "cp", value: 20 },
        depth: 10,
        stability: "stable",
        moves: [{ uci: "e2e4", san: "e4", evalAfter: { type: "unknown" } }],
        createdAt: Date.now(),
      };
      p.resolve({ root, pv });
    }
  }

  getPendingCount(): number {
    return this.pending.length;
  }
}

test("cancellation_during_active_pre_move_search", async () => {
  const engine = new DeferredMockEngine();
  const ac = new AbortController();

  // Start analysis — first search (pre-move for ply 1) will hang
  const promise = analyzeGame(OPERA_PGN, CONFIG, {
    engine,
    signal: ac.signal,
  });

  // Give the pipeline a tick to enter the first search
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(engine.getPendingCount(), 1, "one search should be pending");

  // Abort — must trigger engine.abort()
  ac.abort();

  const result = await promise;

  assert.equal(engine.abortCount, 1, "engine.abort() must be called");
  assert.equal(result.status, "partial");
  assert.equal(result.moves.length, 0);
  assert.equal(engine.getPendingCount(), 0, "no pending searches after abort");
  // Failure must say "cancelled", NOT be a generic recoverable search fail
  assert.ok(result.failures.some((f) => /cancelled/i.test(f.reason)));
});

test("cancellation_during_active_post_move_search", async () => {
  const engine = new DeferredMockEngine();
  const ac = new AbortController();

  const promise = analyzeGame(OPERA_PGN, CONFIG, {
    engine,
    signal: ac.signal,
  });

  // Wait for first (pre-move) search to be pending
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(engine.getPendingCount(), 1);

  // Resolve the first search so pipeline proceeds to post-move search
  engine.resolveAll();
  await new Promise((r) => setTimeout(r, 20));

  // Now the post-move search is pending
  assert.equal(engine.getPendingCount(), 1);

  // Abort — must trigger engine.abort()
  ac.abort();

  const result = await promise;

  assert.ok(engine.abortCount >= 1, "engine.abort() must be called");
  assert.equal(result.status, "partial");
  assert.equal(engine.getPendingCount(), 0);
  assert.ok(result.failures.some((f) => /cancelled/i.test(f.reason)));
});

test("cancellation_does_not_misclassify_as_recoverable_failure", async () => {
  const engine = new DeferredMockEngine();
  const ac = new AbortController();

  const promise = analyzeGame(OPERA_PGN, CONFIG, { engine, signal: ac.signal });
  await new Promise((r) => setTimeout(r, 20));
  ac.abort();
  const result = await promise;

  // None of the failures should be a generic "search failed" without
  // the "cancelled" qualifier.
  const recoverableLike = result.failures.filter(
    (f) =>
      f.stage === "search" &&
      !/cancel/i.test(f.reason) &&
      !/Fatal/i.test(f.reason),
  );
  assert.equal(
    recoverableLike.length,
    0,
    `unexpected recoverable-like failures: ${JSON.stringify(recoverableLike)}`,
  );
});


// ═══════════════════════════════════════════════════════════
// Stage 5 Day 2 — pipeline populates explanations
// ═══════════════════════════════════════════════════════════

test("analyze_game_populates_explanations_map", async () => {
  const engine = new MockEngine();
  const result = await analyzeGame(OPERA_PGN, CONFIG, { engine });
  assert.ok(
    result.explanations.size > 0,
    `expected explanations.size > 0, got ${result.explanations.size}`,
  );
  // The final move (17.Rd8#) delivers checkmate. It should have
  // MATE_DELIVERED explanation.
  const finalExp = result.explanations.get(33);
  assert.ok(finalExp, "expected explanation at ply 33 (Rd8#)");
  assert.equal(finalExp!.status, "explained");
  if (finalExp!.status === "explained") {
    assert.ok(
      finalExp!.primary.rootCause.id.startsWith("mate_delivered_"),
      `expected mate_delivered rootCause, got "${finalExp!.primary.rootCause.id}"`,
    );
  }
});

test("analyze_game_explanations_empty_when_no_facts", async () => {
  // Short game with no mate — facts should not fire.
  const shortPgn = "1.e4 e5 2.Nf3";
  const engine = new MockEngine();
  const result = await analyzeGame(shortPgn, CONFIG, { engine });
  // No mate delivered, no missed mate, engine_preferred might fire but
  // doesn't produce explanations. So explanations should be empty.
  assert.equal(result.explanations.size, 0);
});


// ═══════════════════════════════════════════════════════════
// Stage 5 Day 4 — Arabic localization in the pipeline
// ═══════════════════════════════════════════════════════════

test("pipeline_localizes_mate_delivered_at_ply_33", async () => {
  const engine = new MockEngine();
  const game = await analyzeGame(OPERA_PGN, CONFIG, { engine });

  // The Opera Game ends with 17.Rd8# (ply 33).
  const localized = game.localizedExplanations.get(33);
  assert.ok(localized, "localizedExplanations must contain ply 33");
  assert.equal(localized.templateId, "MATE_DELIVERED");
  assert.equal(localized.confidence, "verified");
  assert.ok(
    localized.text.includes("Rd8"),
    `text must mention Rd8: got "${localized.text}"`,
  );
  assert.ok(
    localized.text.startsWith("كش مات!"),
    `text must start with "كش مات!": got "${localized.text}"`,
  );

  // No explanation-stage failures should have occurred.
  const explFailures = game.failures.filter((f) => f.stage === "explanation");
  assert.equal(
    explFailures.length,
    0,
    `unexpected explanation failures: ${JSON.stringify(explFailures)}`,
  );
});

test("pipeline_localize_records_contract_violation_and_continues", () => {
  const failures: AnalysisFailure[] = [];
  const dummy: ExplanationOutput = { status: "silent", reason: "NO_CAUSE_FOUND" };
  const explanations = new Map<number, ExplanationOutput>([
    [33, dummy],
    [17, dummy],
  ]);
  const graph: EvidenceGraph = {
    nodes: new Map(),
    causalEdges: [],
    metadata: { duplicates: [], sharedRoots: [] },
    rootPositionFen: "",
    analysisComplete: true,
  };
  const game: AnalyzedGame = {
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
  };

  const stub: RendererFn = (_output, _graph, _game, ply) => {
    if (ply === 33) {
      throw new ContractViolation("renderer", "test-forced");
    }
    return {
      text: "ok",
      templateId: "MATE_DELIVERED",
      confidence: "verified",
    };
  };

  const result = localizeAll(explanations, graph, game, stub, failures);

  assert.equal(result.has(33), false, "failed ply must be absent");
  assert.equal(result.has(17), true, "other ply must succeed");
  assert.equal(failures.length, 1);
  assert.equal(failures[0].ply, 33);
  assert.equal(failures[0].stage, "explanation");
  assert.equal(failures[0].reason, "test-forced");
});

test("pipeline_localize_rethrows_non_contract_violation", () => {
  const failures: AnalysisFailure[] = [];
  const dummy: ExplanationOutput = { status: "silent", reason: "NO_CAUSE_FOUND" };
  const explanations = new Map<number, ExplanationOutput>([[33, dummy]]);
  const graph: EvidenceGraph = {
    nodes: new Map(),
    causalEdges: [],
    metadata: { duplicates: [], sharedRoots: [] },
    rootPositionFen: "",
    analysisComplete: true,
  };
  const game: AnalyzedGame = {
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
  };

  const stub: RendererFn = () => {
    throw new Error("unexpected-boom");
  };

  assert.throws(
    () => localizeAll(explanations, graph, game, stub, failures),
    /unexpected-boom/,
  );
  assert.equal(
    failures.length,
    0,
    "non-ContractViolation must propagate without being recorded",
  );
});
