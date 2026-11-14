// lib/analysis/explain/graph-builder.ts
//
// Stage 5 Day 2: EvidenceFact[] + AnalyzedGame → EvidenceGraph.
//
// Verifies every fact against the actual game context (roots, pvs,
// classified moves) before constructing any node. If verification
// fails, the fact is REJECTED (throws) — never turned into an
// unverified node.
//
// Node ID convention (planner relies on this):
//   mate_delivered_<ply>
//   mate_delivered_game_over_<ply>
//   missed_mate_available_<ply>
//   missed_mate_pv_<ply>
//   missed_mate_missed_<ply>
//   engine_preferred_<ply>

import { Chess } from "chess.js";
import type {
  AnalysisRoot,
  AnalyzedGame,
  CausalEdge,
  ClassifiedMove,
  EvidenceGraph,
  EvidenceNode,
  PVRecord,
  ProofEngine,
  ProofMechanical,
  AnyEvaluation,
} from "../core/types.ts";
import { ContractViolation, validateEvidenceGraph } from "../core/contracts.ts";
import { replayPgn } from "../pgn-replay.ts";
import type { EvidenceFact } from "./evidence-providers.ts";

// ─── Node ID helpers ────────────────────────────────────

function nodeId(kind: string, ply: number, sub?: string): string {
  return sub ? `${kind}_${sub}_${ply}` : `${kind}_${ply}`;
}

// ─── Provenance helpers ─────────────────────────────────

function getPvOrThrow(pvId: string, game: AnalyzedGame): PVRecord {
  const pv = game.pvs.get(pvId);
  if (!pv) {
    throw new ContractViolation(
      "EvidenceGraph",
      `PV "${pvId}" not found in game.pvs`,
    );
  }
  return pv;
}

function getRootOrThrow(rootId: string, game: AnalyzedGame): AnalysisRoot {
  const root = game.roots.get(rootId);
  if (!root) {
    throw new ContractViolation(
      "EvidenceGraph",
      `Root "${rootId}" not found in game.roots`,
    );
  }
  return root;
}

function getMoveOrThrow(ply: number, game: AnalyzedGame): ClassifiedMove {
  const move = game.moves.find((m) => m.ply === ply);
  if (!move) {
    throw new ContractViolation(
      "EvidenceGraph",
      `No ClassifiedMove at ply ${ply}`,
    );
  }
  return move;
}

/** Convert SAN to UCI by replaying from FEN. */
function evalsEqual(a: AnyEvaluation, b: AnyEvaluation): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sanToUci(fen: string, san: string): string | null {
  try {
    const c = new Chess(fen);
    const moves = c.moves({ verbose: true });
    const found = moves.find((m) => m.san === san);
    if (!found) return null;
    return found.from + found.to + (found.promotion ?? "");
  } catch {
    return null;
  }
}

/** Get the piece type (case-sensitive) at a given square from a FEN. */
function pieceAt(fen: string, square: string): string | null {
  try {
    const c = new Chess(fen);
    const board = c.board();
    const file = square.charCodeAt(0) - "a".charCodeAt(0);
    const rank = 8 - parseInt(square[1], 10);
    const cell = board[rank]?.[file];
    if (!cell) return null;
    return cell.color === "w" ? cell.type.toUpperCase() : cell.type;
  } catch {
    return null;
  }
}

/** Build a ProofEngine from the actual registered PV. */
function proofFromPv(pv: PVRecord): ProofEngine {
  const last = pv.moves[pv.moves.length - 1];
  return {
    kind: "engine",
    pvId: pv.id,
    depth: pv.depth,
    evalBefore: pv.rootEval,
    evalAfter: last?.evalAfter ?? { type: "unknown" },
  };
}

// ─── Game-binding helpers ────────────────────────────────

function getPositionsCached(
  game: AnalyzedGame,
  cache: { value: ReturnType<typeof replayPgn>["positions"] | null },
): ReturnType<typeof replayPgn>["positions"] {
  if (cache.value) return cache.value;
  if (!game.pgn) {
    throw new ContractViolation(
      "EvidenceGraph",
      "game.pgn is empty — cannot verify evidence against the actual game",
    );
  }
  try {
    cache.value = replayPgn(game.pgn).positions;
  } catch (e) {
    throw new ContractViolation(
      "EvidenceGraph",
      `PGN replay failed during evidence verification: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return cache.value;
}

function getActualFensAtPly(
  ply: number,
  game: AnalyzedGame,
  cache: { value: ReturnType<typeof replayPgn>["positions"] | null },
): { pre: string; post: string } {
  const positions = getPositionsCached(game, cache);
  if (ply < 1 || ply >= positions.length) {
    throw new ContractViolation(
      "EvidenceGraph",
      `ply ${ply} out of range [1, ${positions.length - 1}] for game replay`,
    );
  }
  return {
    pre: positions[ply - 1].fen,
    post: positions[ply].fen,
  };
}

// ─── Main builder ───────────────────────────────────────

export function buildEvidenceGraph(
  facts: readonly EvidenceFact[],
  game: AnalyzedGame,
): EvidenceGraph {
  const nodes = new Map<string, EvidenceNode>();
  const edges: CausalEdge[] = [];
  let edgeCounter = 0;
  const nextEdgeId = () => `edge-${++edgeCounter}`;
  const positionsCache: { value: ReturnType<typeof replayPgn>["positions"] | null } = { value: null };

  for (const fact of facts) {
    switch (fact.kind) {
      case "terminal_checkmate_delivered": {
        // 1. Verify terminalFen equals actual post-move FEN at fact.ply
        const actual = getActualFensAtPly(fact.ply, game, positionsCache);
        if (actual.post !== fact.terminalFen) {
          throw new ContractViolation(
            "EvidenceGraph",
            `MATE_DELIVERED terminalFen does not match actual game position at ply ${fact.ply}. ` +
              `Expected "${actual.post}", got "${fact.terminalFen}".`,
          );
        }
        // 2. Verify the position is checkmate
        const chess = new Chess(fact.terminalFen);
        if (!chess.isCheckmate()) {
          throw new ContractViolation(
            "EvidenceGraph",
            `MATE_DELIVERED terminalFen is not checkmate: ${fact.terminalFen}`,
          );
        }
        // 3. Verify winner from side-to-move (mated side is stm)
        const stm = chess.turn();
        const expectedWinner = stm === "w" ? "black" : "white";
        if (expectedWinner !== fact.winner) {
          throw new ContractViolation(
            "EvidenceGraph",
            `MATE_DELIVERED winner mismatch: FEN side-to-move ${stm} means ${expectedWinner} wins, fact says ${fact.winner}`,
          );
        }
        // 4. Verify checkmateSquare contains opponent king
        const oppPiece = fact.winner === "white" ? "k" : "K";
        if (pieceAt(fact.terminalFen, fact.checkmateSquare) !== oppPiece) {
          throw new ContractViolation(
            "EvidenceGraph",
            `MATE_DELIVERED checkmateSquare "${fact.checkmateSquare}" does not contain ${oppPiece}`,
          );
        }
        // 5. Verify the classified move at ply is terminal checkmate for winner
        const mateMove = getMoveOrThrow(fact.ply, game);
        if (
          mateMove.evaluation.type !== "terminal" ||
          mateMove.evaluation.kind !== "checkmate" ||
          mateMove.evaluation.winner !== fact.winner
        ) {
          throw new ContractViolation(
            "EvidenceGraph",
            `MATE_DELIVERED classified move at ply ${fact.ply} is not a terminal checkmate for ${fact.winner}`,
          );
        }
        const mech: ProofMechanical = {
          kind: "mechanical",
          rule: "TERMINAL_CHECKMATE",
          squares: [fact.checkmateSquare],
          pieces: [oppPiece],
        };
        const eventId = nodeId("mate_delivered", fact.ply);
        const overId = nodeId("mate_delivered", fact.ply, "game_over");

        nodes.set(eventId, {
          id: eventId,
          kind: "state_fact",
          confidence: "verified",
          positionRef: fact.terminalFen,
          moveRef: null,
          proofs: [mech],
        });
        nodes.set(overId, {
          id: overId,
          kind: "consequence",
          confidence: "verified",
          positionRef: fact.terminalFen,
          moveRef: null,
          proofs: [mech],
        });
        edges.push({
          id: nextEdgeId(),
          from: eventId,
          to: overId,
          type: "causes",
          proof: mech,
        });
        break;
      }

      case "missed_mate": {
        const pv = getPvOrThrow(fact.pvId, game);
        const root = getRootOrThrow(fact.rootId, game);

        if (pv.rootId !== fact.rootId) {
          throw new ContractViolation(
            "EvidenceGraph",
            `pv.rootId "${pv.rootId}" != fact.rootId "${fact.rootId}"`,
          );
        }
        if (pv.depth !== fact.depth) {
          throw new ContractViolation(
            "EvidenceGraph",
            `pv.depth ${pv.depth} != fact.depth ${fact.depth}`,
          );
        }
        if (root.fen !== fact.preMoveFen) {
          throw new ContractViolation(
            "EvidenceGraph",
            `root.fen does not match fact.preMoveFen`,
          );
        }
        if (pv.moves.length < fact.matingLine.length) {
          throw new ContractViolation(
            "EvidenceGraph",
            `PV has ${pv.moves.length} moves < matingLine ${fact.matingLine.length}`,
          );
        }
        for (let i = 0; i < fact.matingLine.length; i++) {
          if (pv.moves[i].uci !== fact.matingLine[i].uci) {
            throw new ContractViolation(
              "EvidenceGraph",
              `PV move[${i}] UCI "${pv.moves[i].uci}" != matingLine "${fact.matingLine[i].uci}"`,
            );
          }
          if (pv.moves[i].san !== fact.matingLine[i].san) {
            throw new ContractViolation(
              "EvidenceGraph",
              `PV move[${i}] SAN "${pv.moves[i].san}" != matingLine "${fact.matingLine[i].san}"`,
            );
          }
        }

        const move = getMoveOrThrow(fact.ply, game);
        const actualUci = sanToUci(fact.preMoveFen, move.san);
        if (actualUci !== fact.playedMoveUci) {
          throw new ContractViolation(
            "EvidenceGraph",
            `classified move SAN "${move.san}" → UCI "${actualUci}" != fact playedMoveUci "${fact.playedMoveUci}"`,
          );
        }
        if (
          JSON.stringify(move.evaluation) !==
          JSON.stringify(fact.evalAfterPlayed)
        ) {
          throw new ContractViolation(
            "EvidenceGraph",
            `classified move evaluation != fact.evalAfterPlayed`,
          );
        }
        // Blocker 2: full MateTransition cross-validation
        if (!move.mateVerdict) {
          throw new ContractViolation(
            "EvidenceGraph",
            `MISSED_MATE requires move.mateVerdict, but it is null at ply ${fact.ply}`,
          );
        }
        const mv = move.mateVerdict;
        if (mv.verdict.kind !== "lost") {
          throw new ContractViolation(
            "EvidenceGraph",
            `MISSED_MATE requires move.mateVerdict.verdict.kind === "lost", got "${mv.verdict.kind}" at ply ${fact.ply}`,
          );
        }
        if (mv.before.type !== "mate") {
          throw new ContractViolation(
            "EvidenceGraph",
            `MISSED_MATE requires mateVerdict.before to be a mate evaluation, got "${mv.before.type}"`,
          );
        }
        // cross-validate: mateVerdict.before must equal pv.rootEval
        if (!evalsEqual(mv.before, pv.rootEval)) {
          throw new ContractViolation(
            "EvidenceGraph",
            `MISSED_MATE mateVerdict.before does not match pv.rootEval`,
          );
        }
        // cross-validate: mateVerdict.afterPlayed must equal move.evaluation
        if (!evalsEqual(mv.afterPlayed, move.evaluation)) {
          throw new ContractViolation(
            "EvidenceGraph",
            `MISSED_MATE mateVerdict.afterPlayed does not match move.evaluation`,
          );
        }
        // cross-validate: mateVerdict.moverColor must equal root.sideToMove
        if (mv.moverColor !== root.sideToMove) {
          throw new ContractViolation(
            "EvidenceGraph",
            `MISSED_MATE mateVerdict.moverColor "${mv.moverColor}" != root.sideToMove "${root.sideToMove}"`,
          );
        }
        // Bind root FEN to actual game position (Blocker 2B)
        {
          const actualMissedFens = getActualFensAtPly(fact.ply, game, positionsCache);
          if (root.fen !== actualMissedFens.pre) {
            throw new ContractViolation(
              "EvidenceGraph",
              `MISSED_MATE root.fen "${root.fen}" does not match actual game position at ply ${fact.ply} "${actualMissedFens.pre}"`,
            );
          }
        }

        const availId = nodeId("missed_mate", fact.ply, "available");
        const pvId = nodeId("missed_mate", fact.ply, "pv");
        const missedId = nodeId("missed_mate", fact.ply, "missed");

        const fromSq = fact.playedMoveUci.slice(0, 2);
        const toSq = fact.playedMoveUci.slice(2, 4);
        const movedPiece = pieceAt(fact.preMoveFen, fromSq) ?? "P";
        const legalProof: ProofMechanical = {
          kind: "mechanical",
          rule: "LEGAL_MOVE",
          squares: [fromSq, toSq],
          pieces: [movedPiece],
        };

        const engProof = proofFromPv(pv);

        nodes.set(availId, {
          id: availId,
          kind: "state_fact",
          confidence: "verified",
          positionRef: fact.preMoveFen,
          moveRef: null,
          proofs: [engProof],
        });
        nodes.set(pvId, {
          id: pvId,
          kind: "mechanism",
          confidence: "verified",
          positionRef: fact.preMoveFen,
          moveRef: null,
          proofs: [engProof],
        });
        nodes.set(missedId, {
          id: missedId,
          kind: "consequence",
          confidence: "verified",
          positionRef: fact.preMoveFen,
          moveRef: fact.playedMoveUci,
          proofs: [legalProof, engProof],
        });
        edges.push({
          id: nextEdgeId(),
          from: availId,
          to: pvId,
          type: "enables",
          proof: engProof,
        });
        edges.push({
          id: nextEdgeId(),
          from: pvId,
          to: missedId,
          type: "causes",
          proof: legalProof,
        });
        break;
      }

      case "engine_preferred": {
        const pv = getPvOrThrow(fact.pvId, game);
        const root = getRootOrThrow(fact.rootId, game);

        if (pv.rootId !== fact.rootId) {
          throw new ContractViolation(
            "EvidenceGraph",
            `pv.rootId != fact.rootId`,
          );
        }
        if (pv.depth !== fact.depth) {
          throw new ContractViolation(
            "EvidenceGraph",
            `pv.depth != fact.depth`,
          );
        }
        if (pv.moves.length === 0) {
          throw new ContractViolation("EvidenceGraph", "PV has no moves");
        }
        if (pv.moves[0].uci !== fact.engineMoveUci) {
          throw new ContractViolation(
            "EvidenceGraph",
            `PV head UCI "${pv.moves[0].uci}" != fact.engineMoveUci "${fact.engineMoveUci}"`,
          );
        }
        // Blocker 3: verify playedMoveUci === engineMoveUci
        if (fact.playedMoveUci !== fact.engineMoveUci) {
          throw new ContractViolation(
            "EvidenceGraph",
            `ENGINE_PREFERRED playedMoveUci "${fact.playedMoveUci}" must equal engineMoveUci "${fact.engineMoveUci}"`,
          );
        }
        // Blocker 3: verify PV stability
        if (pv.stability !== "stable") {
          throw new ContractViolation(
            "EvidenceGraph",
            `ENGINE_PREFERRED requires stable PV, got "${pv.stability}"`,
          );
        }
        // Blocker 3: verify move quality is Best
        const move = getMoveOrThrow(fact.ply, game);
        if (move.quality !== "Best") {
          throw new ContractViolation(
            "EvidenceGraph",
            `ENGINE_PREFERRED requires move.quality === "Best", got "${move.quality}"`,
          );
        }
        // Blocker 3: verify classified SAN → UCI matches played
        const actualUci = sanToUci(root.fen, move.san);
        if (actualUci !== fact.playedMoveUci) {
          throw new ContractViolation(
            "EvidenceGraph",
            `classified move SAN "${move.san}" → UCI "${actualUci}" != fact playedMoveUci "${fact.playedMoveUci}"`,
          );
        }
        // Blocker 3: verify root.fen matches actual pre-move FEN at ply
        const actualFens = getActualFensAtPly(fact.ply, game, positionsCache);
        if (root.fen !== actualFens.pre) {
          throw new ContractViolation(
            "EvidenceGraph",
            `ENGINE_PREFERRED root.fen "${root.fen}" does not match actual game position at ply ${fact.ply} "${actualFens.pre}"`,
          );
        }

        const id = nodeId("engine_preferred", fact.ply);
        nodes.set(id, {
          id,
          kind: "state_fact",
          confidence: "verified",
          positionRef: root.fen,
          moveRef: fact.playedMoveUci,
          proofs: [proofFromPv(pv)],
        });
        break;
      }

      default: {
        const _exh: never = fact;
        throw new ContractViolation(
          "EvidenceGraph",
          `unknown fact kind: ${JSON.stringify(_exh)}`,
        );
      }
    }
  }

  // Use actual game root, not the first evidence node (which may be terminal).
  // If evidence exists, replay failure is a contract violation, not an empty root.
  let rootPositionFen = "";
  if (nodes.size > 0) {
    const positions = getPositionsCached(game, positionsCache);
    rootPositionFen = positions[0]?.fen ?? "";
  } else {
    try {
      const positions = getPositionsCached(game, positionsCache);
      rootPositionFen = positions[0]?.fen ?? "";
    } catch {
      rootPositionFen = "";
    }
  }

  const graph: EvidenceGraph = {
    nodes,
    causalEdges: edges,
    metadata: { duplicates: [], sharedRoots: [] },
    rootPositionFen,
    analysisComplete: game.status === "complete",
  };

  validateEvidenceGraph(graph, {
    roots: game.roots,
    pvs: game.pvs,
    config: game.config,
  });

  return graph;
}
