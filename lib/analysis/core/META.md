# Commit Discipline

## Severity Rules

- **P0 (contradicts frozen architecture):** stop, fix, re-review.
- **P1 in a contract that a downstream layer depends on:** fix before commit.
- **P1 in UX/performance only:** commit, fix in next commit.
- **P2 / documentation / future-proofing:** commit, defer.

## Scope Discipline

- No scope expansion in mid-commit.
- One commit = one responsibility.
- Tests must test invariants, not just happy paths.
- Never fabricate explanations when evidence is insufficient.
- Never skip No-Go rules because "we're close."

## Frozen Decisions (Do Not Reopen Without Concrete Correctness Issue)

D1. Scope: analysis-only MVP (one Fork, one Blunder, one explanation, one refutation line).
D2. Engine: progressive Stockfish, client-side WASM, single-threaded baseline.
D3. Evaluation: EP primary, CP secondary, mate-aware classification.
D4. Taxonomy: 6 quality levels + 4 independent annotations.
D5. Explanation: evidence-backed causal chain, no fabrication.
D6. Refutation: two-root PV, three line modes, threat vs consequence separated.
D7. Motifs: 5 detectors for MVP (fork, pin, skewer, discovered, removing defender).
D8. Testing: regression dataset (must pass) + validation dataset (release gate).
D9. Structure: lib/analysis/ is authoritative, old files migrate incrementally.
D10. Branch: main (analysis-only repo). outplay-ui stays deployable separately.
