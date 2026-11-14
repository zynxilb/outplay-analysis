# Outplay Analysis — Project Rules

## Stack
- Next.js 16 (App Router) + React 19 + Tailwind CSS 4
- chess.js for chess rules
- Stockfish WASM (client-side, Lite single-threaded) — Stage 2
- Cairo (Arabic) + JetBrains Mono (numbers/moves)

## Build & Test
- Build: `npm run build`
- Test: `npm test` (95 tests in tests/analysis/)
- Must pass before any commit

## Frozen decisions (D1-D10)
See `lib/analysis/core/META.md`. Do not reopen without concrete correctness issue.

## Scope discipline
- One Fork, one Blunder, one Arabic explanation, one refutation line (MVP)
- No scope creep mid-commit
- No LLM in the reasoning path — ever
- No fabricated tactical explanations
- No UI redesign during pipeline work

## Do NOT touch
- `lib/analysis/core/types.ts` and `contracts.ts` unless a P0 correctness issue
- 95 tests unless adding new invariants

## Arabic style
- Use "الخصم" not "اللاعب الآخر"
- "غلطة كبيرة" for Blunder, "غلطة" for Mistake, "غير دقيقة" for Inaccuracy
- No emoji in UI
- Numbers and chess notation always LTR inline within RTL
