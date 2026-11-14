// lib/analysis/engine/uci-parser.ts
// Parse raw UCI output from Stockfish into structured search results.
//
// Key behaviors (per architect review):
// - Multiple info lines arrive during search; keep highest-depth per multipv slot
// - Skip lines with lowerbound/upperbound (incomplete search)
// - Require both a score and a PV for a line to count
// - bestmove finalizes the search; without it, parse returns null
// - Score is from side-to-move perspective (Stockfish convention)
// - Perspective conversion happens in evaluate/perspective.ts, NOT here

export type RawScore =
  | { readonly type: "cp"; readonly value: number }
  | { readonly type: "mate"; readonly value: number };

export interface ParsedPV {
  readonly multipv: number;
  readonly depth: number;
  readonly score: RawScore;
  readonly pv: readonly string[]; // UCI moves
}

export interface ParsedSearch {
  readonly bestmove: string;
  readonly ponder?: string;
  readonly depth: number;          // highest depth of multipv 1
  readonly nodes?: number;
  readonly time?: number;
  readonly score: RawScore;        // multipv 1 score, side-to-move perspective
  readonly pv: readonly string[];  // multipv 1 PV, UCI
  readonly multipv: readonly ParsedPV[]; // all non-bound PVs, sorted by multipv
}

interface PartialPV {
  multipv: number;
  depth: number;
  score: RawScore | null;
  pv: string[];
  hasBound: boolean;
}

const NUM_RE = /^-?\d+$/;

function parseScore(tokens: string[], startIdx: number): {
  score: RawScore | null;
  hasBound: boolean;
  consumed: number;
} {
  // tokens[startIdx] should be "score"
  if (tokens[startIdx] !== "score") return { score: null, hasBound: false, consumed: 0 };
  const type = tokens[startIdx + 1];
  const rawVal = tokens[startIdx + 2];
  if (!rawVal || !NUM_RE.test(rawVal)) return { score: null, hasBound: false, consumed: 0 };
  const value = parseInt(rawVal, 10);
  if (type !== "cp" && type !== "mate") return { score: null, hasBound: false, consumed: 0 };

  let hasBound = false;
  let consumed = 3;
  const next = tokens[startIdx + 3];
  if (next === "lowerbound" || next === "upperbound") {
    hasBound = true;
    consumed = 4;
  }
  return { score: { type, value }, hasBound, consumed };
}

/**
 * Parse a complete UCI search: an array of lines (each line is a raw string)
 * ending with a bestmove line. Returns null if no valid final search.
 */
export function parseSearchOutput(lines: readonly string[]): ParsedSearch | null {
  const byMultipv = new Map<number, PartialPV>();
  let bestmove: string | undefined;
  let ponder: string | undefined;
  let lastNodes: number | undefined;
  let lastTime: number | undefined;

  for (const line of lines) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length === 0) continue;

    if (tokens[0] === "bestmove") {
      bestmove = tokens[1];
      if (tokens[2] === "ponder" && tokens[3]) ponder = tokens[3];
      continue;
    }

    if (tokens[0] !== "info") continue;

    const partial: PartialPV = {
      multipv: 1,
      depth: 0,
      score: null,
      pv: [],
      hasBound: false,
    };

    let i = 1;
    while (i < tokens.length) {
      const tok = tokens[i];
      if (tok === "depth") {
        partial.depth = parseInt(tokens[i + 1] ?? "0", 10) || 0;
        i += 2;
      } else if (tok === "nodes") {
        lastNodes = parseInt(tokens[i + 1] ?? "0", 10) || undefined;
        i += 2;
      } else if (tok === "time") {
        lastTime = parseInt(tokens[i + 1] ?? "0", 10) || undefined;
        i += 2;
      } else if (tok === "multipv") {
        partial.multipv = parseInt(tokens[i + 1] ?? "1", 10) || 1;
        i += 2;
      } else if (tok === "score") {
        const { score, hasBound, consumed } = parseScore(tokens, i);
        partial.score = score;
        if (hasBound) partial.hasBound = true;
        i += consumed > 0 ? consumed : 1;
      } else if (tok === "pv") {
        partial.pv = tokens.slice(i + 1);
        break;
      } else {
        i += 1;
      }
    }

    // Only accept complete, non-bound lines with a score and PV
    if (!partial.score || partial.pv.length === 0 || partial.hasBound) continue;

    const existing = byMultipv.get(partial.multipv);
    if (!existing || partial.depth > existing.depth) {
      byMultipv.set(partial.multipv, partial);
    }
  }

  if (!bestmove) return null;
  const primary = byMultipv.get(1);
  if (!primary || !primary.score) return null;

  const multipvSorted: ParsedPV[] = Array.from(byMultipv.values())
    .sort((a, b) => a.multipv - b.multipv)
    .map((p) => ({
      multipv: p.multipv,
      depth: p.depth,
      score: p.score!,
      pv: [...p.pv],
    }));

  return {
    bestmove,
    ponder,
    depth: primary.depth,
    nodes: lastNodes,
    time: lastTime,
    score: primary.score,
    pv: [...primary.pv],
    multipv: multipvSorted,
  };
}

/**
 * Parse a single UCI "info depth N ..." line into a partial PV.
 * Returns null if the line is malformed or has a bound.
 * Useful for streaming progress, not for final results.
 */
export function parseInfoLine(line: string): ParsedPV | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== "info") return null;

  const partial: PartialPV = { multipv: 1, depth: 0, score: null, pv: [], hasBound: false };
  let i = 1;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok === "depth") { partial.depth = parseInt(tokens[i + 1] ?? "0", 10) || 0; i += 2; }
    else if (tok === "multipv") { partial.multipv = parseInt(tokens[i + 1] ?? "1", 10) || 1; i += 2; }
    else if (tok === "score") {
      const { score, hasBound, consumed } = parseScore(tokens, i);
      partial.score = score;
      if (hasBound) partial.hasBound = true;
      i += consumed > 0 ? consumed : 1;
    }
    else if (tok === "pv") { partial.pv = tokens.slice(i + 1); break; }
    else { i += 1; }
  }

  if (!partial.score || partial.pv.length === 0 || partial.hasBound) return null;
  return { multipv: partial.multipv, depth: partial.depth, score: partial.score, pv: [...partial.pv] };
}
