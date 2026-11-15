// lib/analysis/explain/refutation-ar.ts
//
// Stage 5 Day 5 — Arabic rendering of RefutationLine.
// Silent (null) on insufficient evidence. Both demonstrated-state
// variants render the same template; they differ only in the evidence
// they cite, which the user does not need to distinguish.

import type { RefutationLine } from "../core/types.ts";
import { ContractViolation } from "../core/contracts.ts";

export interface LocalizedRefutation {
  readonly text: string;
  readonly confidence: "verified" | "supported";
}

export function renderRefutation(
  line: RefutationLine,
): LocalizedRefutation | null {
  if (line.state.kind === "insufficient") return null;
  if (line.moves.length < 2) {
    throw new ContractViolation(
      "refutation-renderer",
      `demonstrated refutation requires >= 2 moves, got ${line.moves.length}`,
    );
  }
  const best = line.moves[0].san;
  const reply = line.moves[1].san;
  return {
    text: `الأفضل كان ${best}. كان الخصم سيرد بـ ${reply}.`,
    confidence: "verified",
  };
}
