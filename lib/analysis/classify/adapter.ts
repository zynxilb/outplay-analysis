// lib/analysis/classify/adapter.ts
// ClassificationLayer implementation.
//
// Contract: classify(input, config) → ClassifiedMove.
// No config captured at construction. Config is a per-call parameter,
// matching the interface in contracts.ts.
//
// Builds the complete ClassifiedMove:
//   - quality: from deriveClassification
//   - annotations: from deriveClassification (preserved from input)
//   - evaluation: input.evalAfterPlayed.eval (may be terminal)
//   - expectedScore: from createEvaluationLayer (null for mate/terminal)
//   - mateVerdict: MateTransition | null (from computeMateVerdict)
//   - classificationVersion: config.version

import type {
  AnalysisConfig,
  ClassificationInput,
  ClassifiedMove,
  MateTransition,
} from "../core/types.ts";
import {
  computeMateVerdict,
  deriveClassification,
  expectedAfterBestMove,
  validateAnalysisConfig,
  validateClassificationInput,
} from "../core/contracts.ts";
import type { ClassificationLayer } from "../core/contracts.ts";
import { createEvaluationLayer } from "../evaluate/index.ts";
import type { Evaluation } from "../core/types.ts";

class DefaultClassificationLayer implements ClassificationLayer {
  classify(input: ClassificationInput, config: AnalysisConfig): ClassifiedMove {
    // Fail-fast on invalid input — the pipeline is responsible for having
    // already validated comparisons and provenance. We validate what we can
    // without a PV store here.
    validateAnalysisConfig(config);
    validateClassificationInput(input);

    const evalLayer = createEvaluationLayer(config);

    // deriveClassification may throw for terminal draws (unsupported) or
    // for search inconsistencies (gained mate). Let it propagate — the
    // pipeline records a failure for this ply.
    const { quality, annotations } = deriveClassification(input, config);

    const playedEval = input.evalAfterPlayed.eval;

    // toExpectedScore signature is Evaluation (not AnyEvaluation); terminal
    // evaluations return null via the `if type !== 'cp'` guard. Cast is safe.
    const expectedScore = evalLayer.toExpectedScore(playedEval as Evaluation);

    // MateTransition: only present when there is an actual mate verdict
    const expectedAfterBest = expectedAfterBestMove(
      input.evalBefore.eval,
      input.moverColor,
    );
    const verdict = computeMateVerdict(
      playedEval,
      expectedAfterBest,
      input.moverColor,
    );

    const mateVerdict: MateTransition | null = verdict === null
      ? null
      : {
          before: input.evalBefore.eval,
          afterPlayed: playedEval,
          expectedAfterBest,
          moverColor: input.moverColor,
          verdict,
        };

    return {
      ply: input.ply,
      san: input.san,
      quality,
      annotations,
      evaluation: playedEval,
      expectedScore,
      mateVerdict,
      classificationVersion: config.version,
    };
  }
}

/**
 * Factory. No captured config — config is passed to classify() per call,
 * matching ClassificationLayer's declared signature.
 */
export function createClassificationLayer(): ClassificationLayer {
  return new DefaultClassificationLayer();
}

/** Default singleton for convenience. */
export const defaultClassificationLayer: ClassificationLayer =
  new DefaultClassificationLayer();
