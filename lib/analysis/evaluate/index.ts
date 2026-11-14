// lib/analysis/evaluate/index.ts
// EvaluationLayer implementation.
//
// Two ways to use:
//   1. Factory: createEvaluationLayer(config) → EvaluationLayer
//      - Validates config once at construction
//      - Matches the contract interface exactly
//      - Required for pipeline integration
//   2. Direct functions with explicit config (for tests/one-off use)

import type {
  Evaluation,
  ExpectedScore,
  QualityLevel,
  AnalysisConfig,
  QualityLevel as QL,
} from "../core/types.ts";
import {
  qualityFromEvaluation,
  validateAnalysisConfig,
} from "../core/contracts.ts";
import type { EvaluationLayer } from "../core/contracts.ts";
import { toExpectedScore as toExpectedScoreImpl } from "./expected-score.ts";

// ═══════════════════════════════════════════════════════════
// Factory — matches EvaluationLayer interface
// ═══════════════════════════════════════════════════════════

export function createEvaluationLayer(config: AnalysisConfig): EvaluationLayer {
  // Validate once at construction. Any subsequent use trusts this config.
  validateAnalysisConfig(config);
  const epCoefficient = config.evaluation.epCoefficient;

  return {
    toExpectedScore(evaluation: Evaluation): ExpectedScore | null {
      return toExpectedScoreImpl(evaluation, epCoefficient);
    },

    toQuality(
      epLoss: number,
      cpLoss: number,
      classification: AnalysisConfig["classification"],
    ): QualityLevel {
      return qualityFromEvaluation(epLoss, cpLoss, classification);
    },
  };
}

// ═══════════════════════════════════════════════════════════
// Direct functions — for tests and ad-hoc calls
// ═══════════════════════════════════════════════════════════
// These do NOT memoize validation. Each caller provides a config.
// Pipeline code should prefer createEvaluationLayer().

export function toExpectedScore(
  evaluation: Evaluation,
  config: AnalysisConfig,
): ExpectedScore | null {
  return toExpectedScoreImpl(evaluation, config.evaluation.epCoefficient);
}

export function toQuality(
  epLoss: number,
  cpLoss: number,
  config: AnalysisConfig,
): QualityLevel {
  return qualityFromEvaluation(epLoss, cpLoss, config.classification);
}

/**
 * @deprecated — the old config-validation memo is gone.
 * Kept as a no-op for existing test imports.
 */
export function __resetConfigValidationForTests(): void {
  // no-op
}
