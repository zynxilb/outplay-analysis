// tests/fixtures/classification-golden.ts
// 20 golden scenarios for deriveClassification.
// Each scenario exercises a specific branch of the classification logic.
// Fixtures are pure data — no PV context needed because deriveClassification
// only consumes (epLoss, cpLoss, eval states, moverColor, annotations).

import type {
  Annotation,
  Evaluation,
  QualityLevel,
} from "../../lib/analysis/core/types.ts";

const cp = (value: number): Evaluation => ({ type: "cp", value });
const mate = (inMoves: number, winner: "white" | "black"): Evaluation => ({
  type: "mate",
  in: inMoves,
  winner,
});

export type GoldenCase = {
  readonly id: string;
  readonly description: string;
  readonly input: {
    readonly epLoss: number;
    readonly cpLoss: number;
    readonly annotations: readonly Annotation[];
    readonly evalBefore: Evaluation;
    readonly evalAfterPlayed: Evaluation;
    readonly evalAfterBest: Evaluation;
    readonly moverColor: "w" | "b";
  };
  readonly expected:
    | {
        readonly kind: "quality";
        readonly quality: QualityLevel;
        readonly annotations: readonly Annotation[];
      }
    | {
        readonly kind: "throws";
        readonly match: RegExp;
      };
};

// Config used by all fixtures (matches AnalysisConfig defaults)
export const FIXTURE_CONFIG = {
  version: "test-v1",
  engine: { identity: "test-engine", hashMb: 32, multiPv: 1 },
  budgets: {
    initialDepth: 10, refinementDepth: 14, finalDepth: 18,
    initialTargetMs: 500, reSearchMs: 300,
  },
  evaluation: {
    epCoefficient: 0.00368208,
    mateOrderingValue: 10000,
    evaluationModelVersion: "ep-v1",
  },
  classification: {
    epLossThresholds: {
      Best: 0, Excellent: 0.01, Good: 0.03,
      Inaccuracy: 0.05, Mistake: 0.10, Blunder: 0.15,
    },
    cpLossSecondaryThreshold: 200,
    brilliantSeeThreshold: 300,
    missExpectedGainThreshold: 0.10,
    mateDistanceTiers: { excellent: 1, good: 3, inaccuracy: 6, mistake: 10 },
  },
  motifs: {
    enabled: ["fork", "pin", "skewer", "discovered", "removing_defender"] as const,
    precisionTargets: { fork: 0.95, pin: 0.90, skewer: 0.90, discovered: 0.90, removing_defender: 0.85 },
  },
  explanation: { secondaryContributionRatio: 0.25 },
} as const;

export const GOLDEN_CASES = [
  // ─── Quality levels (6) ────────────────────────────────
  {
    id: "best_zero_loss",
    description: "Zero EP loss, zero CP loss → Best",
    input: { epLoss: 0, cpLoss: 0, annotations: [], evalBefore: cp(0), evalAfterPlayed: cp(0), evalAfterBest: cp(0), moverColor: "w" },
    expected: { kind: "quality", quality: "Best", annotations: [] },
  },
  {
    id: "excellent_low",
    description: "EP loss 0.015 → Excellent",
    input: { epLoss: 0.015, cpLoss: 50, annotations: [], evalBefore: cp(20), evalAfterPlayed: cp(10), evalAfterBest: cp(20), moverColor: "w" },
    expected: { kind: "quality", quality: "Excellent", annotations: [] },
  },
  {
    id: "good_mid",
    description: "EP loss 0.04 → Good",
    input: { epLoss: 0.04, cpLoss: 80, annotations: [], evalBefore: cp(30), evalAfterPlayed: cp(10), evalAfterBest: cp(30), moverColor: "w" },
    expected: { kind: "quality", quality: "Good", annotations: [] },
  },
  {
    id: "inaccuracy_mid",
    description: "EP loss 0.07 → Inaccuracy",
    input: { epLoss: 0.07, cpLoss: 100, annotations: [], evalBefore: cp(40), evalAfterPlayed: cp(0), evalAfterBest: cp(40), moverColor: "w" },
    expected: { kind: "quality", quality: "Inaccuracy", annotations: [] },
  },
  {
    id: "mistake_mid",
    description: "EP loss 0.12 → Mistake",
    input: { epLoss: 0.12, cpLoss: 150, annotations: [], evalBefore: cp(50), evalAfterPlayed: cp(-50), evalAfterBest: cp(50), moverColor: "w" },
    expected: { kind: "quality", quality: "Mistake", annotations: [] },
  },
  {
    id: "blunder_mid",
    description: "EP loss 0.20 → Blunder",
    input: { epLoss: 0.20, cpLoss: 250, annotations: [], evalBefore: cp(60), evalAfterPlayed: cp(-150), evalAfterBest: cp(60), moverColor: "w" },
    expected: { kind: "quality", quality: "Blunder", annotations: [] },
  },

  // ─── Boundary cases (3) ────────────────────────────────
  {
    id: "excellent_at_boundary",
    description: "EP loss exactly 0.01 → Excellent (>= threshold)",
    input: { epLoss: 0.01, cpLoss: 30, annotations: [], evalBefore: cp(10), evalAfterPlayed: cp(5), evalAfterBest: cp(10), moverColor: "w" },
    expected: { kind: "quality", quality: "Excellent", annotations: [] },
  },
  {
    id: "inaccuracy_just_below_mistake",
    description: "EP loss 0.099 (below 0.10 Mistake threshold) → Inaccuracy",
    input: { epLoss: 0.099, cpLoss: 150, annotations: [], evalBefore: cp(40), evalAfterPlayed: cp(-40), evalAfterBest: cp(40), moverColor: "w" },
    expected: { kind: "quality", quality: "Inaccuracy", annotations: [] },
  },
  {
    id: "blunder_at_boundary",
    description: "EP loss exactly 0.15 → Blunder (>= threshold)",
    input: { epLoss: 0.15, cpLoss: 200, annotations: [], evalBefore: cp(50), evalAfterPlayed: cp(-100), evalAfterBest: cp(50), moverColor: "w" },
    expected: { kind: "quality", quality: "Blunder", annotations: [] },
  },

  // ─── CP floor (2) ──────────────────────────────────────
  {
    id: "cp_floor_forces_inaccuracy",
    description: "EP says Best, CP≥200 → floor lifts to Inaccuracy",
    input: { epLoss: 0.005, cpLoss: 250, annotations: [], evalBefore: cp(10), evalAfterPlayed: cp(5), evalAfterBest: cp(10), moverColor: "w" },
    expected: { kind: "quality", quality: "Inaccuracy", annotations: [] },
  },
  {
    id: "cp_floor_does_not_downgrade",
    description: "EP says Blunder, CP≥200 → stays Blunder (floor is minimum)",
    input: { epLoss: 0.20, cpLoss: 250, annotations: [], evalBefore: cp(60), evalAfterPlayed: cp(-150), evalAfterBest: cp(60), moverColor: "w" },
    expected: { kind: "quality", quality: "Blunder", annotations: [] },
  },

  // ─── Mate transitions (3 valid + 1 gain-throws) ────────
  {
    id: "mate_lost",
    description: "Best has mate for us, played doesn't → Blunder",
    input: { epLoss: 0, cpLoss: 0, annotations: [], evalBefore: cp(0), evalAfterPlayed: cp(0), evalAfterBest: mate(3, "white"), moverColor: "w" },
    expected: { kind: "quality", quality: "Blunder", annotations: [] },
  },
  {
    id: "mate_preserved_same_distance",
    description: "Both mate for us in 3 → Best",
    input: { epLoss: 0, cpLoss: 0, annotations: [], evalBefore: mate(3, "white"), evalAfterPlayed: mate(3, "white"), evalAfterBest: mate(3, "white"), moverColor: "w" },
    expected: { kind: "quality", quality: "Best", annotations: [] },
  },
  {
    id: "mate_delayed",
    description: "Played mates in 5, best mates in 3 → Good (delay=2, within tier)",
    input: { epLoss: 0, cpLoss: 0, annotations: [], evalBefore: mate(3, "white"), evalAfterPlayed: mate(5, "white"), evalAfterBest: mate(3, "white"), moverColor: "w" },
    expected: { kind: "quality", quality: "Good", annotations: [] },
  },
  {
    id: "mate_gained_throws",
    description: "Played creates mate, best doesn't → search inconsistency, throws",
    input: { epLoss: 0, cpLoss: 0, annotations: [], evalBefore: cp(0), evalAfterPlayed: mate(3, "white"), evalAfterBest: cp(0), moverColor: "w" },
    expected: { kind: "throws", match: /search inconsistency|created_mate_best_missed/ },
  },

  // ─── Edge cases (2) ────────────────────────────────────
  {
    id: "negative_ep_improvement",
    description: "Negative EP loss (improvement) → Best",
    input: { epLoss: -0.05, cpLoss: 0, annotations: [], evalBefore: cp(10), evalAfterPlayed: cp(30), evalAfterBest: cp(10), moverColor: "w" },
    expected: { kind: "quality", quality: "Best", annotations: [] },
  },
  {
    id: "ep_zero_exact",
    description: "EP loss exactly 0 → Best",
    input: { epLoss: 0, cpLoss: 0, annotations: [], evalBefore: cp(0), evalAfterPlayed: cp(0), evalAfterBest: cp(0), moverColor: "w" },
    expected: { kind: "quality", quality: "Best", annotations: [] },
  },

  // ─── NaN / Infinity guards (2) ─────────────────────────
  {
    id: "nan_ep_throws",
    description: "epLoss = NaN → throws (not silently Best)",
    input: { epLoss: NaN, cpLoss: 0, annotations: [], evalBefore: cp(0), evalAfterPlayed: cp(0), evalAfterBest: cp(0), moverColor: "w" },
    expected: { kind: "throws", match: /epLoss must be finite|Classification/ },
  },
  {
    id: "infinity_cp_throws",
    description: "cpLoss = Infinity → throws",
    input: { epLoss: 0, cpLoss: Infinity, annotations: [], evalBefore: cp(0), evalAfterPlayed: cp(0), evalAfterBest: cp(0), moverColor: "w" },
    expected: { kind: "throws", match: /cpLoss must be finite|Classification/ },
  },

  // ─── Annotations (2) ───────────────────────────────────
  {
    id: "miss_annotation_with_best_quality",
    description: "MISS annotation on a Best move → Best + MISS preserved",
    input: { epLoss: 0, cpLoss: 0, annotations: ["MISS"], evalBefore: cp(0), evalAfterPlayed: cp(0), evalAfterBest: cp(0), moverColor: "w" },
    expected: { kind: "quality", quality: "Best", annotations: ["MISS"] },
  },
  {
    id: "brilliant_annotation_preserved",
    description: "BRILLIANT annotation → preserved regardless of quality",
    input: { epLoss: 0.005, cpLoss: 50, annotations: ["BRILLIANT"], evalBefore: cp(30), evalAfterPlayed: cp(25), evalAfterBest: cp(30), moverColor: "w" },
    expected: { kind: "quality", quality: "Best", annotations: ["BRILLIANT"] },
  },
] satisfies readonly GoldenCase[];
