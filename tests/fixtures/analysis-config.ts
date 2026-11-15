// tests/fixtures/analysis-config.ts
//
// Minimal, valid AnalysisConfig for tests that only need to satisfy
// the AnalyzedGame.config type without exercising configuration logic.
// Values are internally consistent and pass validateAnalysisConfig.

import type { AnalysisConfig } from "../../lib/analysis/core/types.ts";

export const VALID_ANALYSIS_CONFIG: AnalysisConfig = {
  version: "test-v1",
  engine: { identity: "test-engine", hashMb: 16, multiPv: 1 },
  budgets: {
    initialDepth: 10,
    refinementDepth: 12,
    finalDepth: 14,
    initialTargetMs: 300,
    reSearchMs: 300,
  },
  evaluation: {
    epCoefficient: 0.00368208,
    mateOrderingValue: 100000,
    evaluationModelVersion: "ep-v1",
  },
  classification: {
    epLossThresholds: {
      Best: 0.0,
      Excellent: 0.02,
      Good: 0.05,
      Inaccuracy: 0.10,
      Mistake: 0.15,
      Blunder: 0.20,
    },
    cpLossSecondaryThreshold: 200,
    brilliantSeeThreshold: 100,
    missExpectedGainThreshold: 200,
    mateDistanceTiers: { excellent: 1, good: 2, inaccuracy: 3, mistake: 5 },
  },
  motifs: {
    enabled: [],
    precisionTargets: {
      fork: 1, pin: 1, skewer: 1, discovered: 1, removing_defender: 1,
    },
  },
  explanation: { secondaryContributionRatio: 0.3 },
};
