// lib/analysis/pipeline.ts
// Analysis pipeline orchestrator.
//
// Stage 4 Day 3: full search loop + classification + fail-soft.
//   - For each non-terminal position: adapter.search(fen, "find-best-move", budget)
//   - Reuse position N's PV as position N+1's evalBefore (no double search)
//   - Terminal positions (checkmate/stalemate/draw): rules-derived evaluation
//   - Classification via createClassificationLayer
//   - Any single-position failure recorded in failures[]; analysis continues
//   - Fatal engine failure → stop, return partial

import { Chess } from "chess.js";
import type {
  AnalysisConfig,
  AnalyzedGame,
  AnalysisFailure,
  ClassifiedMove,
  PVRecord,
  RulesSourcedEvaluation,
  SourcedEvaluation,
  TerminalEvaluation,
} from "./core/types.ts";
import {
  validateAnalysisConfig,
  expectedAfterBestMove,
  validateRulesSourcedEvaluation,
} from "./core/contracts.ts";
import type { EngineLayer } from "./core/contracts.ts";
import { StockfishAdapter } from "./engine/stockfish.ts";
import { createClassificationLayer } from "./classify/adapter.ts";

/**
 * A single replayed position in the game.
 * `ply` = 0 for the initial position, 1+ for each subsequent move.
 */
export interface ReplayPosition {
  readonly ply: number;
  readonly fen: string;
  readonly sideToMove: "w" | "b";
  /** SAN of the move that produced this position. "(start)" for ply 0. */
  readonly san: string;
  /** UCI of the move that produced this position. null for ply 0. */
  readonly playedMoveUci: string | null;
}

export interface ReplayResult {
  readonly positions: readonly ReplayPosition[];
  readonly headers: Readonly<Record<string, string>>;
}

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

  return {
    positions,
    headers: headers as Record<string, string>,
  };
}

// ═══════════════════════════════════════════════════════════
// Terminal detection
// ═══════════════════════════════════════════════════════════

interface TerminalInfo {
  readonly eval: TerminalEvaluation;
  /** FEN of the terminal position. */
  readonly fen: string;
}

/**
 * Detect if a position is terminal (game over by rules).
 * Returns null if the position is still playable.
 *
 * IMPORTANT: only checkmate, stalemate, and insufficient-material draws
 * are detectable from FEN alone. Threefold repetition and 50-move require
 * move history; those are NOT detected here (reported as insufficient_material
 * only if the material condition also holds — otherwise the position is
 * treated as non-terminal).
 */
function detectTerminal(fen: string): TerminalInfo | null {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) {
    const stm = fen.trim().split(/\s+/)[1];
    const winner = stm === "w" ? "black" : "white";
    return {
      eval: { type: "terminal", kind: "checkmate", winner },
      fen,
    };
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
// analyzeGame — full pipeline
// ═══════════════════════════════════════════════════════════

export interface AnalyzeOptions {
  /** Engine to use. Defaults to a fresh StockfishAdapter. */
  readonly engine?: EngineLayer;
  /** Override search budget. Defaults to config.budgets.initialTargetMs movetime. */
  readonly budgetOverride?: { kind: "depth" | "movetime" | "nodes"; value: number };
}

export async function analyzeGame(
  pgn: string,
  config: AnalysisConfig,
  options: AnalyzeOptions = {},
): Promise<AnalyzedGame> {
  validateAnalysisConfig(config);

  const failures: AnalysisFailure[] = [];

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

  const positions = replay.positions;
  const budget = options.budgetOverride ?? {
    kind: "movetime",
    value: config.budgets.initialTargetMs,
  };

  // Init engine (either provided or new StockfishAdapter)
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

  try {
    const roots = new Map();
    const pvs = new Map<string, PVRecord>();
    const moves: ClassifiedMove[] = [];
    const classificationLayer = createClassificationLayer();

    // Cache of pre-move searches: ply → { root, pv }.
    // Reused as the evalBefore for the NEXT ply's classification.
    // (Ply N's pre-move eval = search of ply N position, which is exactly
    //  the post-move eval of ply N-1.)
    let prevSearch: { root: import("./core/types.ts").AnalysisRoot; pv: PVRecord } | null = null;

    for (let i = 0; i < positions.length - 1; i++) {
      // Process the move FROM position i TO position i+1 (i.e., ply i+1).
      // The played move is positions[i+1].playedMoveUci.
      const fromPos = positions[i];
      const toPos = positions[i + 1];
      const plyNum = toPos.ply; // = i + 1

      const playedMoveUci = toPos.playedMoveUci;
      if (!playedMoveUci) continue; // shouldn't happen for i >= 0

      // 1. Get / search pre-move eval (evalBefore).
      //    prevSearch carries the search from the previous iteration's
      //    TO position. If null (e.g., previous move ended in terminal,
      //    or search failed), fall back to a fresh search of fromPos.
      let preSearch: { root: import("./core/types.ts").AnalysisRoot; pv: PVRecord } | null = prevSearch;

      if (!preSearch) {
        try {
          preSearch = await engine.search(fromPos.fen, "find-best-move", budget);
          roots.set(preSearch.root.id, preSearch.root);
          pvs.set(preSearch.pv.id, preSearch.pv);
        } catch (e) {
          failures.push({
            ply: plyNum,
            stage: "search",
            reason: `Pre-move search failed at ply ${plyNum} (fen=${fromPos.fen.slice(0, 30)}...): ${e instanceof Error ? e.message : String(e)}`,
          });
          prevSearch = null;
          continue;
        }
      }

      // 2. Determine post-move eval. Check terminal first.
      const terminal = detectTerminal(toPos.fen);
      let postSearch: { root: import("./core/types.ts").AnalysisRoot; pv: PVRecord } | null = null;
      let rulesSourced: RulesSourcedEvaluation | null = null;

      if (terminal) {
        // Rules-derived terminal. No engine search.
        try {
          validateRulesSourcedEvaluation({
            eval: terminal.eval,
            fen: terminal.fen,
            rulesSource: "chess.js",
          });
        } catch (e) {
          failures.push({
            ply: plyNum,
            stage: "terminal_validation",
            reason: e instanceof Error ? e.message : String(e),
          });
          prevSearch = null;
          continue;
        }
        rulesSourced = {
          eval: terminal.eval,
          fen: terminal.fen,
          rulesSource: "chess.js",
        };
      } else {
        // Normal search
        try {
          postSearch = await engine.search(toPos.fen, "find-best-move", budget);
          roots.set(postSearch.root.id, postSearch.root);
          pvs.set(postSearch.pv.id, postSearch.pv);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const isFatal = /crash|disposed|timeout|Stockfish:/i.test(msg);
          failures.push({
            ply: plyNum,
            stage: "search",
            reason: `Post-move search failed at ply ${plyNum}: ${msg}`,
          });
          if (isFatal) {
            // Fatal — stop further searches
            failures.push({
              ply: plyNum,
              stage: "search",
              reason: "Fatal engine failure; stopping analysis",
            });
            prevSearch = null;
            break;
          }
          prevSearch = null;
          continue;
        }
      }

      // 3. Compute epLoss and cpLoss from mover perspective.
      const evalBeforeCP = preSearch.pv.rootEval;
      const evalAfterAny = rulesSourced
        ? rulesSourced.eval
        : postSearch!.pv.rootEval;

      // epLoss: only meaningful when both sides are CP. For mate/terminal,
      // set epLoss = 0; mateTransitions handle the actual verdict.
      let epLoss = 0;
      let cpLoss = 0;
      if (evalBeforeCP.type === "cp" && evalAfterAny.type === "cp") {
        const moverColor = fromPos.sideToMove;
        // Convert to mover perspective (positive = worse for mover)
        const whiteBefore = evalBeforeCP.value;
        const whiteAfter = evalAfterAny.value;
        const moverBefore = moverColor === "w" ? whiteBefore : -whiteBefore;
        const moverAfter = moverColor === "w" ? whiteAfter : -whiteAfter;
        cpLoss = Math.max(0, moverBefore - moverAfter);
        // Approximate EP: Lichess formula on each, then difference
        const epBefore = 1 / (1 + Math.exp(-config.evaluation.epCoefficient * moverBefore));
        const epAfter = 1 / (1 + Math.exp(-config.evaluation.epCoefficient * moverAfter));
        epLoss = Math.max(0, epBefore - epAfter);
      }

      // 4. Build ClassificationInput
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

      // 5. Classify
      try {
        const classified = classificationLayer.classify(
          {
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
            postMoveRootId: rulesSourced
              ? "rules-terminal"
              : postSearch!.root.id,
          },
          config,
        );
        moves.push(classified);
      } catch (e) {
        failures.push({
          ply: plyNum,
          stage: "classification",
          reason: e instanceof Error ? e.message : String(e),
        });
        prevSearch = null;
        continue;
      }

      // 6. Set up prevSearch for next iteration (post-move position's search)
      //    If terminal, there's no postSearch — next iteration will search.
      prevSearch = postSearch;
    }

    const status = failures.length === 0 ? "complete" : "partial";
    return {
      pgn,
      status,
      failures,
      roots,
      pvs,
      moves,
      explanations: new Map(),
      refutations: new Map(),
      config,
    };
  } finally {
    if (ownsEngine) {
      try { await engine.dispose(); } catch {}
    }
  }
}
