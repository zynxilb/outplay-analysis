// lib/analysis/engine/stockfish.ts
// Stockfish WASM adapter implementing EngineLayer.
// Handles worker lifecycle, serialized searches, abort, and disposal.
//
// Per architect review:
// - ONE search at a time. Others queue.
// - Cancellation sends "stop" and waits for "bestmove".
// - Never treat an aborted search as completed.
// - PV moves get evalAfter: { type: "unknown" } unless independently searched.
// - Mate winner stays absolute (via perspective.ts).

import { Chess } from "chess.js";
import type {
  AnalysisRoot,
  PVRecord,
  PVMove,
  SearchBudget,
  AnalysisPurpose,
  AnalysisConfig,
} from "../core/types.ts";
import type { EngineLayer } from "../core/contracts.ts";
import { computeConfigHash } from "../core/contracts.ts";
import { parseSearchOutput, type ParsedSearch } from "./uci-parser.ts";
import { evaluationFromUciScore, sideToMoveFromFen } from "../evaluate/perspective.ts";

// Minimal Worker surface — allows mock injection in tests.
export interface WorkerLike {
  postMessage(data: string): void;
  terminate(): void;
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: ((ev: { message?: string }) => void) | null;
}

export type WorkerFactory = (url: string) => WorkerLike;

export interface StockfishAdapterOptions {
  readonly workerUrl?: string;
  readonly workerFactory?: WorkerFactory;
  readonly initTimeoutMs?: number;
  readonly searchTimeoutMs?: number;
  readonly idPrefix?: string;
}

type State =
  | "uninitialized"
  | "initializing"
  | "ready"
  | "searching"
  | "disposed";

interface PendingSearch {
  readonly fen: string;
  readonly purpose: AnalysisPurpose;
  readonly budget: SearchBudget;
  readonly lines: string[];
  readonly resolve: (r: { root: AnalysisRoot; pv: PVRecord }) => void;
  readonly reject: (e: Error) => void;
  readonly timer: ReturnType<typeof setTimeout> | null;
  abortRequested: boolean;
}

export class StockfishAdapter implements EngineLayer {
  private state: State = "uninitialized";
  private worker: WorkerLike | null = null;
  private engineConfig: AnalysisConfig["engine"] | null = null;
  private initResolve: (() => void) | null = null;
  private initReject: ((e: Error) => void) | null = null;
  private initTimer: ReturnType<typeof setTimeout> | null = null;
  private currentSearch: PendingSearch | null = null;
  private queue: Array<{
    readonly run: () => void;
    readonly reject: (e: Error) => void;
  }> = [];
  private idCounter = 0;
  private readonly workerUrl: string;
  private readonly workerFactory: WorkerFactory;
  private readonly initTimeoutMs: number;
  private readonly searchTimeoutMs: number;
  private readonly idPrefix: string;

  constructor(opts: StockfishAdapterOptions = {}) {
    this.workerUrl = opts.workerUrl ?? "/engine/stockfish-19-lite-single.js";
    this.workerFactory = opts.workerFactory ?? ((url) => new Worker(url) as unknown as WorkerLike);
    this.initTimeoutMs = opts.initTimeoutMs ?? 30_000;
    this.searchTimeoutMs = opts.searchTimeoutMs ?? 30_000;
    this.idPrefix = opts.idPrefix ?? "sf";
  }

  async initialize(engineConfig: AnalysisConfig["engine"]): Promise<void> {
    if (this.state !== "uninitialized") {
      throw new Error(`initialize() called in state "${this.state}"`);
    }
    this.engineConfig = engineConfig;
    this.state = "initializing";

    try {
      this.worker = this.workerFactory(this.workerUrl);
    } catch (e) {
      this.state = "disposed";
      throw new Error(`Failed to create worker: ${e instanceof Error ? e.message : String(e)}`);
    }

    this.worker.onmessage = (ev) => this.handleMessage(ev.data);
    this.worker.onerror = (ev) => this.handleFatal(ev.message ?? "worker error");

    return new Promise<void>((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;
      this.initTimer = setTimeout(() => {
        this.handleFatal(`init timeout after ${this.initTimeoutMs}ms`);
      }, this.initTimeoutMs);

      try {
        this.worker!.postMessage("uci");
      } catch (e) {
        this.handleFatal(`failed to send uci: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
  }

  private handleMessage(data: string): void {
    const trimmed = data.trim();

    if (this.state === "initializing") {
      if (trimmed === "uciok") {
        const cfg = this.engineConfig!;
        this.worker!.postMessage(`setoption name Hash value ${cfg.hashMb}`);
        this.worker!.postMessage(`setoption name MultiPV value ${cfg.multiPv}`);
        this.worker!.postMessage("isready");
      } else if (trimmed === "readyok") {
        if (this.initTimer) clearTimeout(this.initTimer);
        this.initTimer = null;
        this.state = "ready";
        const resolve = this.initResolve;
        this.initResolve = null;
        this.initReject = null;
        resolve?.();
        this.processQueue();
      }
      return;
    }

    if (this.currentSearch) {
      this.currentSearch.lines.push(data);
      if (trimmed.startsWith("bestmove")) {
        const search = this.currentSearch;
        this.currentSearch = null;
        if (search.timer) clearTimeout(search.timer);

        if (search.abortRequested) {
          search.reject(new DOMException("Search aborted", "AbortError"));
        } else {
          try {
            const result = this.buildResult(search);
            search.resolve(result);
          } catch (e) {
            search.reject(e instanceof Error ? e : new Error(String(e)));
          }
        }

        if (this.state === "searching") {
          this.state = "ready";
          this.processQueue();
        }
      }
    }
  }

  private handleFatal(msg: string): void {
    const err = new Error(`Stockfish: ${msg}`);

    if (this.initTimer) clearTimeout(this.initTimer);
    this.initTimer = null;

    const rej = this.initReject;
    this.initReject = null;
    this.initResolve = null;
    rej?.(err);

    if (this.currentSearch) {
      if (this.currentSearch.timer) clearTimeout(this.currentSearch.timer);
      this.currentSearch.reject(err);
      this.currentSearch = null;
    }

    for (const item of this.queue) {
      item.reject(err);
    }
    this.queue = [];
    this.state = "disposed";
    try { this.worker?.terminate(); } catch {}
    this.worker = null;
  }

  private processQueue(): void {
    if (this.state !== "ready" || this.currentSearch) return;
    const next = this.queue.shift();
    if (next) next.run();
  }

  async search(
    fen: string,
    purpose: AnalysisPurpose,
    budget: SearchBudget,
  ): Promise<{ root: AnalysisRoot; pv: PVRecord }> {
    if (this.state === "disposed") {
      throw new Error("Cannot search on disposed adapter");
    }
    if (this.state === "uninitialized") {
      throw new Error("Cannot search before initialize()");
    }
    return new Promise((resolve, reject) => {
      const run = () => this.runSearch(fen, purpose, budget, resolve, reject);
      if (this.state === "ready") run();
      else if (this.state === "disposed") {
        reject(new Error("Cannot search on disposed adapter"));
      } else {
        // state === "initializing" — will run when ready
        this.queue.push({ run, reject });
      }
    });
  }

  private runSearch(
    fen: string,
    purpose: AnalysisPurpose,
    budget: SearchBudget,
    resolve: (r: { root: AnalysisRoot; pv: PVRecord }) => void,
    reject: (e: Error) => void,
  ): void {
    if (!this.worker || this.state !== "ready") {
      reject(new Error(`Cannot run search in state "${this.state}"`));
      return;
    }

    this.state = "searching";
    const timer = setTimeout(() => {
      if (this.currentSearch) {
        this.handleFatal(`search timeout after ${this.searchTimeoutMs}ms`);
      }
    }, this.searchTimeoutMs);

    this.currentSearch = {
      fen,
      purpose,
      budget,
      lines: [],
      resolve,
      reject,
      timer,
      abortRequested: false,
    };

    try {
      this.worker.postMessage(`position fen ${fen}`);
      this.worker.postMessage(this.buildGoCommand(budget));
    } catch (e) {
      this.handleFatal(`failed to send search: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private buildGoCommand(budget: SearchBudget): string {
    switch (budget.kind) {
      case "depth": return `go depth ${budget.value}`;
      case "movetime": return `go movetime ${budget.value}`;
      case "nodes": return `go nodes ${budget.value}`;
    }
  }

  private buildResult(search: PendingSearch): { root: AnalysisRoot; pv: PVRecord } {
    const parsed = parseSearchOutput(search.lines);
    if (!parsed) {
      throw new Error("Failed to parse search output (no bestmove or no valid PV)");
    }

    const cfg = this.engineConfig!;
    const configHash = computeConfigHash(cfg);
    const sideToMove = sideToMoveFromFen(search.fen);
    const rootEval = evaluationFromUciScore(parsed.score, sideToMove);

    this.idCounter += 1;
    const rootId = `${this.idPrefix}-root-${this.idCounter}`;
    const pvId = `${this.idPrefix}-pv-${this.idCounter}`;

    const root: AnalysisRoot = {
      id: rootId,
      fen: search.fen,
      sideToMove,
      purpose: search.purpose,
      engineIdentity: cfg.identity,
      configHash,
      evaluationPerspective: "white",
      searchBudget: search.budget,
    };

    const moves: PVMove[] = [];
    const chess = new Chess(search.fen);
    for (const uci of parsed.pv) {
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const promotion = uci.length > 4 ? uci[4] : undefined;
      try {
        const m = chess.move({ from, to, promotion });
        if (!m) {
          throw new Error(`Illegal PV move "${uci}" at ply ${moves.length}`);
        }
        moves.push({ uci, san: m.san, evalAfter: { type: "unknown" } });
      } catch (e) {
        throw new Error(
          `Malformed PV: cannot replay "${uci}" at ply ${moves.length}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    const pv: PVRecord = {
      id: pvId,
      rootId,
      rootEval,
      depth: parsed.depth,
      stability: this.assessStability(parsed, search.lines) ? "stable" : "unstable",
      moves,
      createdAt: Date.now(),
    };

    return { root, pv };
  }

  private assessStability(parsed: ParsedSearch, lines: string[]): boolean {
    if (parsed.pv.length === 0) return false;
    if (parsed.pv[0] !== parsed.bestmove) return false;

    const pvHeadByDepth = new Map<number, string>();
    for (const line of lines) {
      if (!line.startsWith("info")) continue;
      if (line.includes(" lowerbound") || line.includes(" upperbound")) continue;
      const multipvMatch = line.match(/\bmultipv (\d+)/);
      const multipv = multipvMatch ? parseInt(multipvMatch[1], 10) : 1;
      if (multipv !== 1) continue;
      const depthMatch = line.match(/\bdepth (\d+)/);
      const pvMatch = line.match(/\bpv (\S+)/);
      if (depthMatch && pvMatch) {
        pvHeadByDepth.set(parseInt(depthMatch[1], 10), pvMatch[1]);
      }
    }
    const depths = Array.from(pvHeadByDepth.keys()).sort((a, b) => a - b);
    if (depths.length < 2) return false;
    const last = pvHeadByDepth.get(depths[depths.length - 1]);
    const prev = pvHeadByDepth.get(depths[depths.length - 2]);
    return last === prev;
  }

  async abort(): Promise<void> {
    if (this.state !== "searching" || !this.currentSearch) return;
    this.currentSearch.abortRequested = true;
    try {
      this.worker?.postMessage("stop");
    } catch {}
  }

  async dispose(): Promise<void> {
    if (this.state === "disposed") return;
    this.state = "disposed";
    if (this.initTimer) clearTimeout(this.initTimer);
    this.initTimer = null;

    try { this.worker?.postMessage("quit"); } catch {}
    try { this.worker?.terminate(); } catch {}
    this.worker = null;

    if (this.currentSearch) {
      if (this.currentSearch.timer) clearTimeout(this.currentSearch.timer);
      this.currentSearch.reject(new Error("Adapter disposed"));
      this.currentSearch = null;
    }

    const rej = this.initReject;
    this.initReject = null;
    this.initResolve = null;
    rej?.(new Error("Adapter disposed during init"));

    const disposeErr = new Error("Adapter disposed");
    for (const item of this.queue) {
      item.reject(disposeErr);
    }
    this.queue = [];
  }
}
