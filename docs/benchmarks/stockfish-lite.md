# Stockfish Lite Single-Threaded — Browser Benchmark

**Engine:** `stockfish@19.0.1` (Lite, single-threaded)
**Files:** `public/engine/stockfish-19-lite-single.{js,wasm}` (28 KB + 1803 KB)
**Measured by:** `scripts/bench-stockfish.mjs` (Playwright headless Chromium)
**Search budget per position:** `go movetime 300` (300 ms cap)

## Results

_Fill in after running `npm run dev` + `node scripts/bench-stockfish.mjs`._

| Metric | Value |
|---|---|
| Cold start (worker creation + UCI handshake) | _TBD_ ms |
| First search (startpos) | _TBD_ ms |
| Warm p50 | _TBD_ ms |
| Warm p95 | _TBD_ ms |
| Warm max | _TBD_ ms |
| Opera Game (7 FENs, 300ms each) | _TBD_ ms |

## Positions tested

| Name | FEN |
|---|---|
| startpos | `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1` |
| italian-mid | `r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3` |
| kiwipete | `r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1` |
| endgame-kp | `8/8/8/8/8/4k3/4p3/4K3 w - - 0 1` |
| mate-in-2 | `r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4` |

## Interpretation

- **Cold start** = time from `new Worker(url)` until `readyok` after `uci` → `uciok` → `setoption` → `isready`
- **First search** includes initial JIT warmup of WASM code paths
- **Warm p50/p95** measure steady-state 300ms-budgeted searches
- **Opera Game** is a small proxy for "analyze a real game"; per-position budget 300ms × 7 positions ≈ expected total 2.1s + overhead

## Acceptance targets (per architect review)

| Metric | Target | Result |
|---|---|---|
| Cold start | < 3000 ms | _TBD_ |
| Warm p95 | < 500 ms (300ms budget + 200ms overhead) | _TBD_ |
| Opera Game (7 FENs) | < 5000 ms | _TBD_ |

## Limitations

- Headless Chromium in Colab ≠ real device performance
- No mobile measurement yet
- These are **desktop development targets**, not universal guarantees
- Mobile measurement deferred to Stage 8

## Reproduction

```bash
# 1. Start dev server
npm run dev

# 2. In another terminal
node scripts/bench-stockfish.mjs
```
