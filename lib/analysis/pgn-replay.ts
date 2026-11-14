// lib/analysis/pgn-replay.ts
// Extracted from pipeline.ts to allow graph-builder to verify
// evidence against the actual game without a circular import.

import { Chess } from "chess.js";

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
  const startFen =
    headers.FEN ??
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const replay = new Chess(startFen);
  const positions: ReplayPosition[] = [];

  positions.push({
    ply: 0,
    fen: replay.fen(),
    sideToMove: replay.turn(),
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
