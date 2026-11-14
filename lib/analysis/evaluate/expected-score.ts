// lib/analysis/evaluate/expected-score.ts
// Lichess-derived EP model: EP(cp) = 1 / (1 + exp(-0.00368208 * cp))
// Returns 0..1. NOT a calibrated win probability.
// Mate / tablebase / unknown → null (handled separately by classification).

import type { Evaluation, ExpectedScore } from "../core/types.ts";

/** Lichess coefficient. Versioned via config; this is the reference constant. */
export const EP_COEFFICIENT = 0.00368208;

/**
 * Convert a finite CP evaluation to Expected Score (0..1).
 * Returns null for mate, tablebase, unknown.
 */
export function toExpectedScore(
  evaluation: Evaluation,
  coefficient: number = EP_COEFFICIENT,
): ExpectedScore | null {
  if (evaluation.type !== "cp") return null;

  if (!Number.isFinite(evaluation.value)) {
    throw new Error(`Invalid cp value: ${evaluation.value}`);
  }

  // Clamp extreme CPs to avoid exp() overflow / floating-point drift.
  // Lichess uses bounded but we clamp to ±2000 (well beyond practical range).
  const clamped = Math.max(-2000, Math.min(2000, evaluation.value));
  const raw = 1 / (1 + Math.exp(-coefficient * clamped));

  // Defensive: ensure [0, 1] despite floating-point
  const value = Math.max(0, Math.min(1, raw));

  return { value, derivedFrom: evaluation };
}

/**
 * EP loss from the MOVER's perspective.
 * White moves:  EP_before - EP_after
 * Black moves:  EP_after - EP_before
 *
 * Both EP values must already be White-perspective normalized.
 */
export function epLossFor(
  epBefore: number,
  epAfter: number,
  moverColor: "w" | "b",
): number {
  return moverColor === "w" ? epBefore - epAfter : epAfter - epBefore;
}
