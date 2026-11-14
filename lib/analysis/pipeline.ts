// lib/analysis/pipeline.ts
// Analysis pipeline orchestrator.
//
// Stage 4 final: search loop + classification + fail-soft + cancellation
// + fatal detection + provenance validation.
//
// Key invariants enforced here:
//   - Fatal engine errors (crash/disposed/timeout) STOP further searches
//     in both pre-move and post-move paths.
//   - AbortSignal + AbortError from engine.abort() stop the analysis
//     and are NOT treated as ordinary recoverable failures.
//   - Every returned AnalysisRoot.fen must match the FEN that was
//     actually searched (else the root is discarded).
//   - validateComparisonCompatibility() is called before classification.
//   - Search reuse: position N's post-search = position N+1's pre-search.

import { Chess } from "chess.js";
import type {
  AnalysisConfig,
  AnalyzedGame,
  AnalysisFailure,
  AnalysisRoot,
  ClassifiedMove,
  PVRecord,
  RulesSourcedEvaluation,
  SourcedEvaluation,
  TerminalEvaluation,
  SearchBudget,
  ClassificationInput,
} from "./core/types.ts";
import {
  validateAnalysisConfig,
  validateComparisonCompatibility,
  validateRulesSourcedEvaluation,
  type EngineLayer,
  type ValidationContext,
} from "./core/contracts.ts";
import { StockfishAdapter } from "./engine/stockfish.ts";
import { createClassificationLayer } from "./classify/adapter.ts";

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface ReplayPosition {
  readonly ply: number;
  readonly fen: string;
  readonly sideToMove: "w" | "b";
  readonly san: string;
  readonly playedMoveUci: string | null;
}

export interface ReplayResult {
  readonly positions: readonly ReplayPosition[];
  readonly headers: Readonly<Record<string, string>>;
}

export interface AnalyzeOptions {
  readonly engine?: EngineLayer;
  readonly budgetOverride?: SearchBudget;
  readonly signal?: AbortSignal;
}

// ═══════════════════════════════════════════════════════════
// PGN replay
// ═══════════════════════════════════════════════════════════

export function replayPgn(pgn: string): ReplayResult {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch (e) {
    throw new Error(
      `PGN parse failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const history = chess.history({ verbose: true });
  const headers = chess.getHeaders();
  const replay = new Chess();
  const positions: ReplayPosition[] = [];

  positions.push({
    ply: 0,
    fen: replay.fen(),
    sideToMove: "w",
    san: "(start)",
    playedMoveUci: null,
  });

  for (let i = 0; i < history.length; i++) {
    const move = history[i];
    const result = replay.move(move.san);
    if (!result) {
      throw new Error(
        `PGN replay failed at ply ${i + 1}: move "${move.san}" is not legal ` +
        `from FEN ${replay.fen()}`,
      );
    }
    positions.push({
      ply: i + 1,
      fen: replay.fen(),
      sideToMove: replay.turn(),
      san: move.san,
      playedMoveUci: move.from + move.to + (move.promotion ?? ""),
    });
  }

  return { positions, headers: headers as Record<string, string> };
}

// ═══════════════════════════════════════════════════════════
// Terminal detection
// ═══════════════════════════════════════════════════════════

interface TerminalInfo {
  readonly eval: TerminalEvaluation;
  readonly fen: string;
}

function detectTerminal(fen: string): TerminalInfo | null {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) {
    const stm = fen.trim().split(/\s+/)[1];
    const winner = stm === "w" ? "black" : "white";
    return { eval: { type: "terminal", kind: "checkmate", winner }, fen };
  }
  if (chess.isStalemate()) {
    return { eval: { type: "terminal", kind: "stalemate" }, fen };
  }
  if (chess.isInsufficientMaterial()) {
    return { eval: { type: "terminal", kind: "draw" }, fen };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// Error classification
// ═══════════════════════════════════════════════════════════

function isAbortError(e: unknown): boolean {
  if (e instanceof Error && e.name === "AbortError") return true;
  // DOMException is also an Error in modern browsers
  if (typeof DOMException !== "undefined" && e instanceof DOMException) {
    return e.name === "AbortError";
  }
  return false;
}

function isFatalError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /crash|disposed|timeout|Stockfish:/i.test(msg);
}

// ═══════════════════════════════════════════════════════════
// Search helper — returns a discriminated outcome
// ═══════════════════════════════════════════════════════════

type SearchOutcome =
  | { readonly kind: "ok"; readonly root: AnalysisRoot; readonly pv: PVRecord }
  | { readonly kind: "aborted" }
  | { readonly kind: "fatal"; readonly reason: string }
  | { readonly kind: "recoverable"; readonly reason: string };

async function runSearch(
  engine: EngineLayer,
  fen: string,
  budget: SearchBudget,
  label: "pre" | "post",
  ply: number,
): Promise<SearchOutcome> {
  try {
    const { root, pv } = await engine.search(fen, "find-best-move", budget);
    // Root FEN must match the searched FEN — reject otherwise.
    if (root.fen !== fen) {
      return {
        kind: "recoverable",
        reason: `${label}-move search at ply ${ply}: root.fen "${root.fen}" != searched fen "${fen}"`,
      };
    }
    return { kind: "ok", root, pv };
  } catch (e) {
    if (isAbortError(e)) return { kind: "aborted" };
    const msg = e instanceof Error ? e.message : String(e);
    if (isFatalError(e)) return { kind: "fatal", reason: msg };
    return { kind: "recoverable", reason: msg };
  }
}

// ═══════════════════════════════════════════════════════════
// analyzeGame
// ═══════════════════════════════════════════════════════════

export async function analyzeGame(
  pgn: string,
  config: AnalysisConfig,
  options: AnalyzeOptions = {},
): Promise<AnalyzedGame> {
  validateAnalysisConfig(config);

  const failures: AnalysisFailure[] = [];
  const signal = options.signal;

  // Early abort check
  if (signal?.aborted) {
    failures.push({
      ply: 0,
      stage: "search",
      reason: "Analysis cancelled before start",
    });
    return emptyResult(pgn, config, failures);
  }

  // Parse PGN
  let replay: ReplayResult;
  try {
    replay = replayPgn(pgn);
  } catch (e) {
    failures.push({
      ply: 0,
      stage: "pgn_parse",
      reason: e instanceof Error ? e.message : String(e),
    });
    return emptyResult(pgn, config, failures);
  }

  const positions = replay.positions;
  const budget: SearchBudget = options.budgetOverride ?? {
    kind: "movetime",
    value: config.budgets.initialTargetMs,
  };

  const ownsEngine = !options.engine;
  const engine: EngineLayer = options.engine ?? new StockfishAdapter();

  try {
    await engine.initialize(config.engine);
  } catch (e) {
    failures.push({
      ply: 0,
      stage: "search",
      reason: `Engine initialize failed: ${e instanceof Error ? e.message : String(e)}`,
    });
    return emptyResult(pgn, config, failures);
  }

  try {
    const roots = new Map<string, AnalysisRoot>();
    const pvs = new Map<string, PVRecord>();
    const moves: ClassifiedMove[] = [];
    const classificationLayer = createClassificationLayer();

    let prevSearch: { root: AnalysisRoot; pv: PVRecord } | null = null;
    let stopped = false; // set by fatal/abort to break outer loop cleanly

    for (let i = 0; i < positions.length - 1; i++) {
      if (stopped) break;

      // Abort check between iterations
      if (signal?.aborted) {
        failures.push({
          ply: positions[i].ply,
          stage: "search",
          reason: `Analysis cancelled before ply ${positions[i + 1].ply}`,
        });
        stopped = true;
        break;
      }

      const fromPos = positions[i];
      const toPos = positions[i + 1];
      const plyNum = toPos.ply;
      const playedMoveUci = toPos.playedMoveUci;
      if (!playedMoveUci) continue;

      // ── PRE-MOVE search ────────────────────────────────
      let preSearch = prevSearch;
      if (!preSearch) {
        const outcome = await runSearch(engine, fromPos.fen, budget, "pre", plyNum);
        if (outcome.kind === "aborted") {
          failures.push({ ply: plyNum, stage: "search", reason: `Analysis cancelled during pre-move search` });
          stopped = true;
          break;
        }
        if (outcome.kind === "fatal") {
          failures.push({ ply: plyNum, stage: "search", reason: `Fatal engine failure during pre-move search: ${outcome.reason}` });
          failures.push({ ply: plyNum, stage: "search", reason: `Fatal engine failure; stopping analysis` });
          stopped = true;
          break;
        }
        if (outcome.kind === "recoverable") {
          failures.push({ ply: plyNum, stage: "search", reason: `Pre-move search failed: ${outcome.reason}` });
          prevSearch = null;
          continue;
        }
        preSearch = { root: outcome.root, pv: outcome.pv };
        roots.set(outcome.root.id, outcome.root);
        pvs.set(outcome.pv.id, outcome.pv);
      }

      // ── POST-MOVE: terminal or engine search ───────────
      const terminal = detectTerminal(toPos.fen);
      let postSearch: { root: AnalysisRoot; pv: PVRecord } | null = null;
      let rulesSourced: RulesSourcedEvaluation | null = null;

      if (terminal) {
        try {
          validateRulesSourcedEvaluation({
            eval: terminal.eval,
            fen: terminal.fen,
            rulesSource: "chess.js",
          });
        } catch (e) {
          failures.push({ ply: plyNum, stage: "terminal_validation", reason: e instanceof Error ? e.message : String(e) });
          prevSearch = null;
          continue;
        }
        rulesSourced = { eval: terminal.eval, fen: terminal.fen, rulesSource: "chess.js" };
      } else {
        const outcome = await runSearch(engine, toPos.fen, budget, "post", plyNum);
        if (outcome.kind === "aborted") {
          failures.push({ ply: plyNum, stage: "search", reason: `Analysis cancelled during post-move search` });
          stopped = true;
          break;
        }
        if (outcome.kind === "fatal") {
          failures.push({ ply: plyNum, stage: "search", reason: `Fatal engine failure during post-move search: ${outcome.reason}` });
          failures.push({ ply: plyNum, stage: "search", reason: `Fatal engine failure; stopping analysis` });
          stopped = true;
          break;
        }
        if (outcome.kind === "recoverable") {
          failures.push({ ply: plyNum, stage: "search", reason: `Post-move search failed: ${outcome.reason}` });
          prevSearch = null;
          continue;
        }
        postSearch = { root: outcome.root, pv: outcome.pv };
        roots.set(outcome.root.id, outcome.root);
        pvs.set(outcome.pv.id, outcome.pv);
      }

      // ── Loss computation ───────────────────────────────
      const evalBeforeCP = preSearch.pv.rootEval;
      const evalAfterAny = rulesSourced ? rulesSourced.eval : postSearch!.pv.rootEval;
      let epLoss = 0, cpLoss = 0;

      if (evalBeforeCP.type === "cp" && evalAfterAny.type === "cp") {
        const moverColor = fromPos.sideToMove;
        const moverBefore = moverColor === "w" ? evalBeforeCP.value : -evalBeforeCP.value;
        const moverAfter = moverColor === "w" ? evalAfterAny.value : -evalAfterAny.value;
        cpLoss = Math.max(0, moverBefore - moverAfter);
        const epB = 1 / (1 + Math.exp(-config.evaluation.epCoefficient * moverBefore));
        const epA = 1 / (1 + Math.exp(-config.evaluation.epCoefficient * moverAfter));
        epLoss = Math.max(0, epB - epA);
      }

      // ── Build ClassificationInput ──────────────────────
      const moverColor = fromPos.sideToMove;
      const preSourced: SourcedEvaluation = {
        eval: preSearch.pv.rootEval,
        pvId: preSearch.pv.id,
        rootId: preSearch.root.id,
        depth: preSearch.pv.depth,
      };
      const postSourced: SourcedEvaluation | RulesSourcedEvaluation = rulesSourced ?? {
        eval: postSearch!.pv.rootEval,
        pvId: postSearch!.pv.id,
        rootId: postSearch!.root.id,
        depth: postSearch!.pv.depth,
      };

      const classificationInput: ClassificationInput = {
        ply: plyNum,
        san: toPos.san,
        playedMoveUci,
        bestMoveUci: preSearch.pv.moves[0]?.uci ?? playedMoveUci,
        moverColor,
        preMoveFen: fromPos.fen,
        postMoveFen: toPos.fen,
        evalBefore: preSourced,
        evalAfterPlayed: postSourced,
        epLoss,
        cpLoss,
        annotations: [],
        preMoveRootId: preSearch.root.id,
        postMoveRootId: rulesSourced ? "rules-terminal" : postSearch!.root.id,
      };

      // ── Provenance validation (Blocker 3) ──────────────
      const vctx: ValidationContext = { roots, pvs, config };
      try {
        validateComparisonCompatibility(classificationInput, vctx);
      } catch (e) {
        failures.push({
          ply: plyNum,
          stage: "classification",
          reason: `Provenance validation failed: ${e instanceof Error ? e.message : String(e)}`,
        });
        prevSearch = null;
        continue;
      }

      // ── Classify ───────────────────────────────────────
      try {
        const classified = classificationLayer.classify(classificationInput, config);
        moves.push(classified);
      } catch (e) {
        if (isAbortError(e)) {
          failures.push({ ply: plyNum, stage: "classification", reason: `Analysis cancelled during classification` });
          stopped = true;
          break;
        }
        failures.push({ ply: plyNum, stage: "classification", reason: e instanceof Error ? e.message : String(e) });
        prevSearch = null;
        continue;
      }

      prevSearch = postSearch;
    }

    const status = failures.length === 0 ? "complete" : "partial";
    return {
      pgn, status, failures, roots, pvs, moves,
      explanations: new Map(), refutations: new Map(), config,
    };
  } finally {
    if (ownsEngine) {
      try { await engine.dispose(); } catch {}
    }
  }
}

function emptyResult(
  pgn: string,
  config: AnalysisConfig,
  failures: AnalysisFailure[],
): AnalyzedGame {
  return {
    pgn,
    status: "partial",
    failures,
    roots: new Map(),
    pvs: new Map(),
    moves: [],
    explanations: new Map(),
    refutations: new Map(),
    config,
  };
}
