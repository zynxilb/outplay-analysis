// tests/analysis/stockfish-adapter.test.ts
// Stage 2 — Stockfish adapter state machine tests (mock worker)

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  StockfishAdapter,
  type WorkerLike,
} from "../../lib/analysis/engine/stockfish.ts";

// ─── Mock worker ──────────────────────────────────────────

class MockWorker implements WorkerLike {
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: { message?: string }) => void) | null = null;
  sent: string[] = [];
  terminated = false;
  private readonly engine: MockEngine;

  constructor(engine: MockEngine) {
    this.engine = engine;
    engine.attach(this);
  }

  postMessage(data: string): void {
    this.sent.push(data);
    this.engine.receive(data, this);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: string): void {
    this.onmessage?.({ data });
  }

  error(msg: string): void {
    this.onerror?.({ message: msg });
  }
}

interface MockMode {
  kind: "normal" | "no_bestmove" | "init_fail" | "search_fail";
}

class MockEngine {
  mode: MockMode = { kind: "normal" };
  worker: MockWorker | null = null;
  pendingGo: string | null = null;

  attach(w: MockWorker): void { this.worker = w; }

  receive(data: string, w: MockWorker): void {
    if (data === "uci") {
      queueMicrotask(() => {
        if (this.mode.kind === "init_fail") {
          w.error("mock init failure");
          return;
        }
        w.emit("id name MockStockfish");
        w.emit("uciok");
      });
    } else if (data === "isready") {
      queueMicrotask(() => w.emit("readyok"));
    } else if (data.startsWith("position fen ")) {
      // store
    } else if (data.startsWith("go ")) {
      this.pendingGo = data;
      if (this.mode.kind === "no_bestmove") return;
      if (this.mode.kind === "search_fail") {
        queueMicrotask(() => w.error("mock search failure"));
        return;
      }
      queueMicrotask(() => {
        w.emit("info depth 8 seldepth 10 multipv 1 score cp 20 nodes 5000 pv e2e4 e7e5");
        w.emit("info depth 10 seldepth 12 multipv 1 score cp 30 nodes 8000 pv e2e4 e7e5 g1f3");
        w.emit("bestmove e2e4 ponder e7e5");
      });
    } else if (data === "stop") {
      // Finalize with whatever depth we have
      queueMicrotask(() => {
        if (this.worker) {
          this.worker.emit("info depth 10 seldepth 12 multipv 1 score cp 30 nodes 8000 pv e2e4 e7e5");
          this.worker.emit("bestmove e2e4");
        }
      });
    } else if (data === "quit") {
      // no-op
    }
  }
}

const makeAdapter = (engine: MockEngine, opts: { initTimeoutMs?: number; searchTimeoutMs?: number } = {}) => {
  return new StockfishAdapter({
    workerFactory: () => new MockWorker(engine),
    initTimeoutMs: opts.initTimeoutMs ?? 5000,
    searchTimeoutMs: opts.searchTimeoutMs ?? 5000,
  });
};

const engineCfg = { identity: "sf-19.0.1-lite-single", hashMb: 32, multiPv: 1 };

// ─── Tests ───────────────────────────────────────────────

test("adapter_init_happy_path", async () => {
  const engine = new MockEngine();
  const a = makeAdapter(engine);
  await a.initialize(engineCfg);
  // Worker should have received setoption + isready after uciok
  await new Promise((r) => setImmediate(r));
  assert.ok(engine.worker);
  assert.ok(engine.worker.sent.includes("uci"));
  assert.ok(engine.worker.sent.includes("isready"));
  await a.dispose();
});

test("adapter_search_happy_path", async () => {
  const engine = new MockEngine();
  const a = makeAdapter(engine);
  await a.initialize(engineCfg);
  const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const { root, pv } = await a.search(fen, "find-best-move", { kind: "depth", value: 10 });
  assert.equal(root.fen, fen);
  assert.equal(root.sideToMove, "w");
  assert.equal(root.engineIdentity, engineCfg.identity);
  assert.equal(root.purpose, "find-best-move");
  assert.deepEqual(pv.rootEval, { type: "cp", value: 30 });
  assert.equal(pv.depth, 10);
  assert.equal(pv.moves.length, 3);
  assert.equal(pv.moves[0].uci, "e2e4");
  assert.equal(pv.moves[0].san, "e4");
  assert.deepEqual(pv.moves[0].evalAfter, { type: "unknown" });
  await a.dispose();
});

test("adapter_search_rejects_without_bestmove", async () => {
  const engine = new MockEngine();
  engine.mode = { kind: "no_bestmove" };
  const a = makeAdapter(engine, { searchTimeoutMs: 200 });
  await a.initialize(engineCfg);
  await assert.rejects(
    a.search("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "find-best-move", { kind: "depth", value: 10 }),
    /timeout|bestmove|Stockfish/,
  );
  await a.dispose();
});

test("adapter_init_rejects_on_worker_error", async () => {
  const engine = new MockEngine();
  engine.mode = { kind: "init_fail" };
  const a = makeAdapter(engine);
  await assert.rejects(a.initialize(engineCfg), /mock init failure|Stockfish/);
  await a.dispose();
});

test("adapter_dispose_during_search_rejects_pending", async () => {
  const engine = new MockEngine();
  engine.mode = { kind: "no_bestmove" };
  const a = makeAdapter(engine);
  await a.initialize(engineCfg);
  const p = a.search("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "find-best-move", { kind: "depth", value: 10 });
  await a.dispose();
  await assert.rejects(p, /disposed|Stockfish/);
});

test("adapter_after_dispose_rejects_search", async () => {
  const engine = new MockEngine();
  const a = makeAdapter(engine);
  await a.initialize(engineCfg);
  await a.dispose();
  await assert.rejects(
    a.search("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "find-best-move", { kind: "depth", value: 10 }),
    /disposed/,
  );
});

test("adapter_worker_receives_correct_go_command", async () => {
  const engine = new MockEngine();
  const a = makeAdapter(engine);
  await a.initialize(engineCfg);
  await a.search(
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "find-best-move",
    { kind: "movetime", value: 300 },
  );
  assert.ok(engine.worker!.sent.some((s) => s === "go movetime 300"));
  await a.dispose();
});

test("adapter_mate_keeps_absolute_winner", async () => {
  // Engine returns mate score; adapter must use perspective conversion
  const engine = new MockEngine();
  const a = makeAdapter(engine);
  await a.initialize(engineCfg);

  // Override go handler to emit a mate line
  const origReceive = engine.receive.bind(engine);
  engine.receive = (data: string, w: MockWorker) => {
    if (data.startsWith("go ")) {
      queueMicrotask(() => {
        w.emit("info depth 10 seldepth 12 multipv 1 score mate 3 nodes 8000 pv e2e4 e7e5 g1f3");
        w.emit("bestmove e2e4");
      });
      return;
    }
    origReceive(data, w);
  };

  const { pv } = await a.search(
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "find-best-move",
    { kind: "depth", value: 10 },
  );
  assert.deepEqual(pv.rootEval, { type: "mate", in: 3, winner: "white" });
  await a.dispose();
});
