# Stockfish Lite Single-Threaded — Opera Game Benchmark

**Engine:** `stockfish@19.0.1` (Lite, single-threaded)
**Files:** `public/engine/stockfish-19-lite-single.{js,wasm}` (28 KB + 1803 KB)
**Harness:** `app/dev/engine-benchmark/page.tsx` (uses `StockfishAdapter`)
**Runner:** `scripts/bench-stockfish.mjs` (Playwright headless Chromium)
**Search budget:** `go movetime 300`

## Source PGN

Morphy's Opera Game, Paris 1858:
```
1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7
8.Nc3 c6 9.Bg5 b5 10.Nxb5 cxb5 11.Bxb5+ Nbd7 12.O-O-O Rd8 13.Rxd7 Rxd7
14.Rd1 Qe6 15.Bxd7+ Nxd7 16.Qb8+ Nxb8 17.Rd8#
```

**Board states:** 34 (initial position + 33 plies, generated via `chess.js.loadPgn`)

## Results

_Filled by `npm run bench` against headless Chromium on Colab._

| Metric | Value |
|---|---|
| Cold start (worker + init) | _TBD_ ms |
| Total analysis time (34 states) | _TBD_ ms |
| Average per position | _TBD_ ms |
| p50 | _TBD_ ms |
| p95 | _TBD_ ms |
| Max | _TBD_ ms |
| Min | _TBD_ ms |
| Errors | _TBD_ |

## Acceptance targets (architect review)

| Metric | Target | Result |
|---|---|---|
| Cold start | < 3000 ms | _TBD_ |
| Warm p95 | < 500 ms (300ms budget + 200ms overhead) | _TBD_ |
| Total 34 states | < 12000 ms | _TBD_ |

## Limitations

- Headless Chromium in Colab ≠ real device performance
- No mobile measurement yet
- **Desktop development targets**, not universal guarantees
- Mobile deferred to Stage 8
- Full-game 34 positions run sequentially through one StockfishAdapter instance
  (cache not used here; cache benefits evaluated in Stage 4)

## How it runs

1. Browser creates `StockfishAdapter` with `workerUrl: "/engine/stockfish-19-lite-single.js"`
2. Adapter initializes worker → `uci` → `uciok` → `setoption Hash=32, MultiPV=1` → `isready` → `readyok`
3. Adapter iterates 34 positions sequentially via `adapter.search(fen, "find-best-move", { kind: "movetime", value: 300 })`
4. Playwright waits for `#benchmark-results[data-phase=done]`, reads `window.__BENCHMARK_RESULTS__`

## Reproduction

```bash
npm run dev
# In another terminal:
node scripts/bench-stockfish.mjs
```
