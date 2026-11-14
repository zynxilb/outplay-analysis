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
} from "../core/types.ts";
import { ContractViolation, validateEvidenceGraph } from "../core/contracts.ts";
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

// ─── Main builder ───────────────────────────────────────

export function buildEvidenceGraph(
  facts: readonly EvidenceFact[],
  game: AnalyzedGame,
): EvidenceGraph {
  const nodes = new Map<string, EvidenceNode>();
  const edges: CausalEdge[] = [];
  let edgeCounter = 0;
  const nextEdgeId = () => `edge-${++edgeCounter}`;

  for (const fact of facts) {
    switch (fact.kind) {
      case "terminal_checkmate_delivered": {
        const chess = new Chess(fact.terminalFen);
        if (!chess.isCheckmate()) {
          throw new ContractViolation(
            "EvidenceGraph",
            `MATE_DELIVERED terminalFen is not checkmate: ${fact.terminalFen}`,
          );
        }
        const oppPiece = fact.winner === "white" ? "k" : "K";
        if (pieceAt(fact.terminalFen, fact.checkmateSquare) !== oppPiece) {
          throw new ContractViolation(
            "EvidenceGraph",
            `MATE_DELIVERED checkmateSquare "${fact.checkmateSquare}" does not contain ${oppPiece}`,
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
          proofs: [legalProof],
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
        const move = getMoveOrThrow(fact.ply, game);
        const actualUci = sanToUci(root.fen, move.san);
        if (actualUci !== fact.playedMoveUci) {
          throw new ContractViolation(
            "EvidenceGraph",
            `classified move SAN "${move.san}" → UCI "${actualUci}" != fact playedMoveUci "${fact.playedMoveUci}"`,
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

  const firstNode = nodes.values().next().value as EvidenceNode | undefined;
  const graph: EvidenceGraph = {
    nodes,
    causalEdges: edges,
    metadata: { duplicates: [], sharedRoots: [] },
    rootPositionFen: firstNode?.positionRef ?? "",
    analysisComplete: game.status === "complete",
  };

  validateEvidenceGraph(graph, {
    roots: game.roots,
    pvs: game.pvs,
    config: game.config,
  });

  return graph;
}
