# Outplay Analysis

Arabic-first chess analysis engine. Evidence-based, no AI fabrication.

## What this is

The analysis core of Outplay: a deterministic, evidence-driven chess analyzer
that explains moves in Arabic using verified chess facts and Stockfish
evaluations.

**No LLM in the reasoning path.** Every Arabic explanation is backed by:
- A verified `Evidence` object
- A `CausalEdge` connecting cause to consequence
- An engine PV or mechanical proof

When evidence is insufficient, the system says **"التحليل غير كافٍ"** — it does
not fabricate.

## Status: Stage 2.1 complete

| Stage | Description | Status |
|-------|-------------|--------|
| 1 | Dependency audit + contract tests | ✅ Complete |
| 2 | Stockfish adapter + evaluation | ✅ Complete |
| 2.1 | Engine + evaluation hardening | ✅ Complete |
| 3 | Classifier | 🔜 Next |
| 4 | Pipeline (PGN → classification) | Planned |
| 5 | Arabic explanation | Planned |
| 6 | Fork detection | Planned |
| 7 | Attribution + refutation | Planned |
| 8 | Regression + mobile | Planned |

## Run tests

```bash
npm test
```

Expected: `# tests 160`, `# pass 160`, `# fail 0`.

## Benchmark

```bash
npm run dev
# in another terminal:
node scripts/bench-stockfish.mjs
```

Runs the Opera Game (34 board states, 33 searched + 1 terminal skipped)
through a real browser Worker via `StockfishAdapter`. Measured results
live in `docs/benchmarks/stockfish-lite.md`.

## Architecture

```
lib/analysis/core/
├── types.ts         Type definitions (frozen after 11 review rounds)
├── contracts.ts     Layer interfaces + 30+ runtime validators
└── META.md          Commit discipline rules + frozen decisions D1-D10

tests/analysis/
├── contracts.test.ts
├── contracts-graph.test.ts
├── contracts-provenance.test.ts
└── contracts-final.test.ts
```

## Architectural principles

1. **EP (Expected Score) primary, CP secondary.** Lichess-aligned coefficient `0.00368208`.
2. **Mate is never an extreme CP.** Separate evaluation type.
3. **No LLM reasoning.** Deterministic classification.
4. **Evidence or silence.** No fabricated tactical explanations.
5. **Two-root PV store.** Pre-move and post-move are separate contexts.

## Scope (MVP)

One Fork, one Blunder, one Arabic explanation, one refutation line.

## Not in this repo

- Auth, databases (belongs to a separate app)
- Community features, coach system, tournaments

## License

To be determined before public release. Stockfish.js is GPL-3.0; license
obligations must be documented before distributing the engine.
