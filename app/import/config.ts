// app/import/config.ts
//
// Analysis configuration used by the UI. Kept local to the app layer
// so that lib/analysis remains the single source of runtime behavior;
// the UI only chooses WHICH config to pass.

import type { AnalysisConfig } from "@/lib/analysis/core/types";

export const OPERA_PGN = `[Event "Paris Opera"]
[White "Morphy"]
[Black "Duke Karl"]

1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5 10.Nxb5 cxb5 11.Bxb5+ Nbd7 12.O-O-O Rd8 13.Rxd7 Rxd7 14.Rd1 Qe6 15.Bxd7+ Nxd7 16.Qb8+ Nxb8 17.Rd8# 1-0`;

export const ANALYSIS_CONFIG: AnalysisConfig = {
  version: "beta-1",
  engine: { identity: "sf-19.0.1-lite-single", hashMb: 32, multiPv: 1 },
  budgets: {
    initialDepth: 16,
    refinementDepth: 16,
    finalDepth: 16,
    initialTargetMs: 1500,
    reSearchMs: 300,
  },
  evaluation: {
    epCoefficient: 0.00368208,
    mateOrderingValue: 10000,
    evaluationModelVersion: "ep-v1",
  },
  classification: {
    epLossThresholds: {
      Best: 0,
      Excellent: 0.01,
      Good: 0.03,
      Inaccuracy: 0.05,
      Mistake: 0.10,
      Blunder: 0.15,
    },
    cpLossSecondaryThreshold: 200,
    brilliantSeeThreshold: 300,
    missExpectedGainThreshold: 0.10,
    mateDistanceTiers: { excellent: 1, good: 3, inaccuracy: 6, mistake: 10 },
  },
  motifs: {
    enabled: [],
    precisionTargets: {
      fork: 0.95,
      pin: 0.90,
      skewer: 0.90,
      discovered: 0.90,
      removing_defender: 0.85,
    },
  },
  explanation: { secondaryContributionRatio: 0.25 },
};
