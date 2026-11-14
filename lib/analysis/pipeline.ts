// lib/analysis/pipeline.ts
// Analysis pipeline orchestrator.
//
// Stage 4 Day 2: PGN parsing + position replay only.
//   - Validates PGN via chess.js
//   - Extracts positions array (initial + each ply)
//   - Returns AnalyzedGame with status="partial" and a failure marking
//     "search not yet implemented"
//
// Day 3+ will add:
//   - Stockfish search per non-terminal position
//   - reuse of position N's search as position N+1's evalBefore
//   - classification via createClassificationLayer
//   - terminal handling (rules-derived checkmate)

import { Chess } from "chess.js";
import type {
  AnalysisConfig,
  AnalyzedGame,
  AnalysisFailure,
} from "./core/types.ts";
import { validateAnalysisConfig } from "./core/contracts.ts";

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
  /** Game headers (White, Black, etc.) as raw strings. */
  readonly headers: Readonly<Record<string, string>>;
  /** Best move UCI for each position, if the PGN embedded engine annotations. */
  readonly bestMovesFromPgn: ReadonlyMap<number, string>;
}

/**
 * Parse PGN and produce the replayed position array.
 * Throws if PGN is malformed.
 */
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
  const bestMovesFromPgn = new Map<number, string>();

  // chess.js's verbose history does not expose per-move PV annotations,
  // so bestMovesFromPgn stays empty at Day 2. Reserved for future PGN
  // comment parsing (e.g., "[%eval] [%bestmove]" markers).

  // Replay from initial position. Start with a fresh Chess.
  const replay = new Chess();
  const positions: ReplayPosition[] = [];

  // Initial position (ply 0)
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
    bestMovesFromPgn,
  };
}

/**
 * Analyze a PGN. Day 2: parses + replays only. Returns partial AnalyzedGame
 * with status="partial" and a failure per non-terminal position (search
 * not yet implemented).
 *
 * Day 3+ replaces the stub with actual search + classification.
 */
export async function analyzeGame(
  pgn: string,
  config: AnalysisConfig,
): Promise<AnalyzedGame> {
  validateAnalysisConfig(config);

  const failures: AnalysisFailure[] = [];

  // Try parsing. If PGN is malformed, return a fully failed result.
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

  // Day 2: search + classification not implemented. Record a failure for
  // the whole analysis (not per position, to avoid 33 noisy entries) and
  // return the empty-but-valid AnalyzedGame shape.
  failures.push({
    ply: 0,
    stage: "search",
    reason: `Search not yet implemented. Parsed ${replay.positions.length - 1} plies (${replay.positions.length} board states). Day 3 will add Stockfish search + classification.`,
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
