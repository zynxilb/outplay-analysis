// lib/analysis/engine/stockfish-lichess.ts
//
// StockfishLichessAdapter — implements EngineLayer by delegating to
// Lichess Cloud Evaluation API. Free, no auth, depth 30-50. Positions
// not in Lichess's cloud throw "not-in-lichess-cloud"; caller decides
// whether to fall back to WASM.

import { Chess } from "chess.js";
import type {
  AnalysisConfig,
  AnalysisPurpose,
  AnalysisRoot,
  Evaluation,
  PVRecord,
  PVMove,
  SearchBudget,
} from "../core/types.ts";
import type { EngineLayer } from "../core/contracts.ts";
import { computeConfigHash } from "../core/contracts.ts";

interface LichessCloudEval {
  fen: string;
  knodes: number;
  depth: number;
  pvs: Array<{ moves: string; cp?: number; mate?: number }>;
}

export class StockfishLichessAdapter implements EngineLayer {
  private ready = false;
  private aborted = false;
  private cfg: AnalysisConfig["engine"] | null = null;

  async initialize(cfg: AnalysisConfig["engine"]): Promise<void> {
    this.cfg = cfg;
    this.ready = true;
  }

  async search(
    fen: string,
    purpose: AnalysisPurpose,
    budget: SearchBudget,
  ): Promise<{ root: AnalysisRoot; pv: PVRecord }> {
    if (!this.ready || !this.cfg) throw new Error("StockfishLichess: not initialized");
    if (this.aborted) {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }

    const url =
      "https://lichess.org/api/cloud-eval" +
      `?fen=${encodeURIComponent(fen)}&multiPv=1&variant=standard`;

    let res: Response;
    try {
      res = await fetch(url, {
        signal: this.aborted ? AbortSignal.abort() : undefined,
      });
    } catch (e) {
      throw new Error(`Lichess network: ${String((e as Error).message ?? e)}`);
    }

    if (res.status === 404) throw new Error("position-not-in-lichess-cloud (recoverable)");
    if (!res.ok) throw new Error(`Lichess HTTP ${res.status}`);

    const data = (await res.json()) as LichessCloudEval;
    if (!data.pvs || data.pvs.length === 0) throw new Error("Lichess empty pvs");

    const pv0 = data.pvs[0];
    const uciMoves = pv0.moves.split(" ").filter(Boolean);
    if (uciMoves.length === 0) throw new Error("Lichess empty pv moves");

    const rootEval = this.evalToEvaluation(pv0);

    const moves: PVMove[] = [];
    try {
      const c = new Chess(fen);
      for (let i = 0; i < uciMoves.length; i++) {
        const uci = uciMoves[i];
        const made = c.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci.slice(4, 5) || undefined,
        });
        if (!made) break;
        moves.push({
          uci,
          san: made.san,
          evalAfter: i === uciMoves.length - 1 ? rootEval : { type: "unknown" },
        });
      }
    } catch {
      throw new Error("Lichess PV not replayable");
    }
    if (moves.length === 0) throw new Error("Lichess PV replay produced no moves");

    const root: AnalysisRoot = {
      id: `lichess-${this.hashFen(fen)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fen,
      sideToMove: fen.split(" ")[1] === "b" ? "b" : "w",
      purpose,
      engineIdentity: this.cfg.identity,
      configHash: computeConfigHash(this.cfg),
      evaluationPerspective: "white",
      searchBudget: budget,
    };

    const pv: PVRecord = {
      id: `${root.id}-pv`,
      rootId: root.id,
      rootEval,
      depth: Number.isInteger(data.depth) && data.depth >= 0 ? data.depth : 0,
      stability: "stable",
      moves,
      createdAt: Date.now(),
    };

    return { root, pv };
  }

  async abort(): Promise<void> {
    this.aborted = true;
  }

  async dispose(): Promise<void> {
    this.ready = false;
  }

  private evalToEvaluation(pv0: { cp?: number; mate?: number }): Evaluation {
    if (pv0.mate !== undefined && pv0.mate !== null) {
      return {
        type: "mate",
        in: Math.abs(pv0.mate),
        winner: pv0.mate > 0 ? "white" : "black",
      };
    }
    if (pv0.cp !== undefined && pv0.cp !== null) {
      return { type: "cp", value: pv0.cp };
    }
    return { type: "unknown" };
  }

  private hashFen(fen: string): string {
    let h = 0;
    for (let i = 0; i < fen.length; i++) h = ((h << 5) - h + fen.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
  }
}
