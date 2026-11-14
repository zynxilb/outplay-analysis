// lib/analysis/evaluate/index.ts
// EvaluationLayer implementation:
// - toExpectedScore: delegates to expected-score.ts
// - toQuality: delegates to qualityFromEvaluation (from contracts.ts)
//
// Single source of truth: this file NEVER reimplements thresholds.

import type {
  Evaluation,
  ExpectedScore,
  QualityLevel,
  AnalysisConfig,
} from "../core/types.ts";
import {
  qualityFromEvaluation,
  validateAnalysisConfig,
} from "../core/contracts.ts";
import { toExpectedScore as toExpectedScoreImpl } from "./expected-score.ts";

/**
 * Convert Evaluation → ExpectedScore | null.
 * Uses config.evaluation.epCoefficient and validates config first time.
 */
let configValidated = false;
function ensureConfigValid(config: AnalysisConfig): void {
  if (!configValidated) {
    validateAnalysisConfig(config);
    configValidated = true;
  }
}

export function toExpectedScore(
  evaluation: Evaluation,
  config: AnalysisConfig,
): ExpectedScore | null {
  ensureConfigValid(config);
  return toExpectedScoreImpl(evaluation, config.evaluation.epCoefficient);
}

/**
 * Convert (epLoss, cpLoss) → QualityLevel.
 * Thin delegation to qualityFromEvaluation — no duplicate logic.
 * Caller is responsible for computing epLoss from mover perspective.
 */
export function toQuality(
  epLoss: number,
  cpLoss: number,
  config: AnalysisConfig,
): QualityLevel {
  ensureConfigValid(config);
  return qualityFromEvaluation(epLoss, cpLoss, config.classification);
}

/**
 * Test-only: reset the config validation memo so tests can validate
 * multiple configs in the same process.
 */
export function __resetConfigValidationForTests(): void {
  configValidated = false;
}
