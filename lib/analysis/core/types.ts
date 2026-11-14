// lib/analysis/core/types.ts
// Outplay Analysis — Shared Types (Commit 1, Rev 11 + Lichess additions)
// Frozen after 11 review rounds. See META.md for discipline rules.

export type EvaluationPerspective = "white";

// ─── Engine ───────────────────────────────────────────

export type SearchBudget =
  | { readonly kind: "depth"; readonly value: number }
  | { readonly kind: "movetime"; readonly value: number }
  | { readonly kind: "nodes"; readonly value: number };

export type AnalysisPurpose = "find-best-move" | "find-opponent-response";

export interface AnalysisRoot {
  readonly id: string;
  readonly fen: string;
  readonly sideToMove: "w" | "b";
  readonly purpose: AnalysisPurpose;
  readonly engineIdentity: string;
  readonly configHash: string;
  readonly evaluationPerspective: EvaluationPerspective;
  readonly searchBudget: SearchBudget;
}

// ─── Evaluation ───────────────────────────────────────

/**
 * Canonical evaluation. Mate carries explicit winner.
 * Stored from White's perspective.
 */
export type Evaluation =
  | { readonly type: "cp"; readonly value: number }
  | { readonly type: "mate"; readonly in: number; readonly winner: "white" | "black" }
  | { readonly type: "tablebase"; readonly result: "win" | "draw" | "loss" }
  | { readonly type: "unknown" };

/**
 * Rules-derived terminal evaluation. Distinct from engine-reported mate.
 * - checkmate: game is over, winner wins immediately (not "mate in N")
 * - stalemate / draw: game is drawn, no classification rule exists yet
 *   at Stage 4 (produces partial result + failure downstream).
 */
export type TerminalEvaluation =
  | {
      readonly type: "terminal";
      readonly kind: "checkmate";
      readonly winner: "white" | "black";
    }
  | { readonly type: "terminal"; readonly kind: "stalemate" }
  | { readonly type: "terminal"; readonly kind: "draw" };

/** Any evaluation that can enter classification (engine OR rules-derived). */
export type AnyEvaluation = Evaluation | TerminalEvaluation;

export interface SourcedEvaluation {
  readonly eval: Evaluation;
  readonly pvId: string;
  readonly rootId: string;
  readonly depth: number;
}

/**
 * Rules-derived evaluation (terminal states). No engine search was performed,
 * so this must NOT pretend to have a PV, root, or depth.
 * Verification: FEN must match; terminal state re-verified via chess.js.
 */
export interface RulesSourcedEvaluation {
  readonly eval: TerminalEvaluation;
  readonly fen: string;
  readonly rulesSource: "chess.js";
}

/**
 * Expected Score: Lichess-derived normalized Win%.
 * Range 0..1.
 *
 * NOT a calibrated win/draw/loss probability.
 * Model: EP(cp) = 1 / (1 + exp(-0.00368208 * cp))
 *
 * This is the same mathematical model as Lichess's WinPercent/100,
 * validated against the open-source lila repository.
 */
export interface ExpectedScore {
  readonly value: number; // 0..1
  readonly derivedFrom: Evaluation;
}

export type PracticalAdvantage =
  | "winning" | "advantage" | "equal" | "disadvantage" | "losing" | null;

// ─── PV ───────────────────────────────────────────────

export interface PVMove {
  readonly uci: string;
  readonly san: string;
  readonly evalAfter: Evaluation;
}

export interface PVRecord {
  readonly id: string;
  readonly rootId: string;
  readonly rootEval: Evaluation;
  readonly depth: number;
  readonly stability: "stable" | "unstable";
  readonly moves: readonly PVMove[];
  readonly createdAt: number;
}

// ─── Proof ────────────────────────────────────────────

export type MechanicalRule =
  | "SEE_ATTACKS_TARGET"
  | "SEE_TARGET_UNDEFENDED"
  | "SEE_MULTIPLE_TARGETS"
  | "GEOMETRY_FORK"
  | "GEOMETRY_PIN"
  | "GEOMETRY_SKEWER"
  | "GEOMETRY_DISCOVERED"
  | "GEOMETRY_DEFENDER_REMOVAL"
  | "LEGAL_MOVE"
  | "PIECE_CONSTRAINED"
  | "PIECE_UNDEFENDED";

export interface ProofMechanical {
  readonly kind: "mechanical";
  readonly rule: MechanicalRule;
  readonly squares: readonly string[];
  readonly pieces: readonly string[];
}

export interface ProofEngine {
  readonly kind: "engine";
  readonly pvId: string;
  readonly depth: number;
  readonly evalBefore: Evaluation;
  readonly evalAfter: Evaluation;
}

export interface ProofConsequence {
  readonly kind: "consequence";
  readonly pvId: string;
  readonly demonstratedAtPly: number; // 0-indexed into pv.moves
  readonly materialLossCp: number;    // positive
}

export type Proof = ProofMechanical | ProofEngine | ProofConsequence;

// ─── Evidence ─────────────────────────────────────────

export type EvidenceKind = "state_fact" | "mechanism" | "consequence" | "attribution";
export type Confidence = "verified" | "supported" | "speculative";

export interface EvidenceNode {
  readonly id: string;
  readonly kind: EvidenceKind;
  readonly confidence: Confidence;
  readonly positionRef: string;
  readonly moveRef: string | null;
  readonly proofs: readonly Proof[];
}

export type CausalEdgeType = "enables" | "causes";

export interface CausalEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly type: CausalEdgeType;
  readonly proof: Proof;
}

export interface GraphMetadata {
  readonly duplicates: readonly {
    readonly a: string;
    readonly b: string;
    readonly reason: string;
  }[];
  readonly sharedRoots: readonly {
    readonly a: string;
    readonly b: string;
    readonly rootEvidenceId: string;
  }[];
}

export interface EvidenceGraph {
  readonly nodes: ReadonlyMap<string, EvidenceNode>;
  readonly causalEdges: readonly CausalEdge[];
  readonly metadata: GraphMetadata;
  readonly rootPositionFen: string;
  readonly analysisComplete: boolean;
}

// ─── Classification ───────────────────────────────────

export type QualityLevel =
  | "Best" | "Excellent" | "Good" | "Inaccuracy" | "Mistake" | "Blunder";

export type Annotation = "BRILLIANT" | "GREAT" | "BOOK" | "MISS";

export const ANNOTATION_SPOTLIGHT_PRIORITY: readonly Annotation[] = [
  "BRILLIANT",
  "MISS",
  "GREAT",
  "BOOK",
] as const;

// ─── Mate verdict ─────────────────────────────────────

export type MateVerdict =
  | { readonly kind: "preserved"; readonly distance: number }
  | {
      readonly kind: "delayed";
      readonly byMoves: number;
      readonly direction: "for_mover" | "against_mover";
    }
  | { readonly kind: "lost" }
  | { readonly kind: "gained"; readonly reason: GainedReason }
  | { readonly kind: "inconsistent"; readonly reason: string };

export type GainedReason =
  | "escaped_mate_best_allowed"
  | "created_mate_best_missed"
  | "winner_flipped_to_mover"
  | "faster_than_best"
  | "survived_longer_than_best";

export interface MateTransition {
  readonly before: Evaluation;
  readonly afterPlayed: AnyEvaluation;
  readonly expectedAfterBest: AnyEvaluation; // projected to post-move boundary
  readonly moverColor: "w" | "b";
  readonly verdict: MateVerdict; // never null inside
}

export interface ClassifiedMove {
  readonly ply: number;
  readonly san: string;
  readonly quality: QualityLevel;
  readonly annotations: readonly Annotation[];
  /** Engine OR rules-derived terminal. Terminal checkmate ends the game. */
  readonly evaluation: AnyEvaluation;
  readonly expectedScore: ExpectedScore | null;
  readonly mateVerdict: MateTransition | null;
  readonly classificationVersion: string;
}

// ─── Classification input ─────────────────────────────

export interface ClassificationInput {
  readonly ply: number;
  readonly san: string;
  readonly playedMoveUci: string;
  readonly bestMoveUci: string;
  readonly moverColor: "w" | "b";
  readonly preMoveFen: string;
  readonly postMoveFen: string;
  /**
   * Engine evaluation of the pre-move position. The "best-line value
   * at the post-move boundary" is derived via expectedAfterBestMove();
   * it is not a separate input.
   */
  readonly evalBefore: SourcedEvaluation;
  /**
   * Engine evaluation of the post-played position, OR a rules-derived
   * terminal evaluation (checkmate/stalemate/draw).
   */
  readonly evalAfterPlayed: SourcedEvaluation | RulesSourcedEvaluation;
  readonly epLoss: number; // 0..1 from mover perspective
  readonly cpLoss: number;
  readonly annotations: readonly Annotation[];
  readonly preMoveRootId: string;
  readonly postMoveRootId: string;
}

// ─── Motifs ───────────────────────────────────────────

export type MotifKind =
  | "fork" | "pin" | "skewer" | "discovered" | "removing_defender";

export type MotifRelationship = "created" | "exploited";

export interface MotifDetected {
  readonly id: string;
  readonly kind: MotifKind;
  readonly positionFen: string;
  readonly geometry: Readonly<Record<string, unknown>>;
}

export interface MotifVerified {
  readonly detected: MotifDetected;
  readonly kind: MotifKind;
  readonly mechanicalProof: ProofMechanical;
  readonly engineConfirmation: ProofEngine | null;
}

export type ConsequenceKind = "material_loss" | "positional_gain" | "mate_threat";

export interface MotifConsequence {
  readonly kind: ConsequenceKind;
  readonly description: string;
  readonly evidence: EvidenceNode;
  readonly engineConfirmed: boolean;
}

export interface CausalPathStep {
  readonly nodeId: string;
  readonly incomingEdgeId: string | null;
}

export interface MotifAttributed {
  readonly verified: MotifVerified;
  readonly relationship: MotifRelationship;
  readonly consequences: readonly MotifConsequence[];
  readonly causalPath: readonly CausalPathStep[];
}

export type MotifEvidence =
  | { readonly stage: "detected"; readonly detected: MotifDetected }
  | { readonly stage: "verified"; readonly verified: MotifVerified }
  | { readonly stage: "attributed"; readonly attributed: MotifAttributed };

// ─── Explanation ──────────────────────────────────────

export type ExplanationSilenceReason =
  | "NO_CAUSE_FOUND"
  | "ANALYSIS_INCOMPLETE"
  | "SPECULATIVE_ONLY";

export interface CausalChainStep {
  readonly mechanism: EvidenceNode;
  readonly consequence: EvidenceNode;
}

export interface PlannedExplanation {
  readonly rootCause: EvidenceNode;
  readonly causalChain: readonly CausalChainStep[];
  readonly supportingEvidence: readonly EvidenceNode[];
  readonly confidence: "verified" | "supported";
}

export type ExplanationOutput =
  | {
      readonly status: "explained";
      readonly primary: PlannedExplanation;
      readonly secondary: readonly PlannedExplanation[];
    }
  | {
      readonly status: "silent";
      readonly reason: ExplanationSilenceReason;
    };

// ─── Refutation ───────────────────────────────────────

export type LineMode =
  | { readonly kind: "punishment"; readonly targetMove: "played" }
  | { readonly kind: "best_response"; readonly targetMove: "played" }
  | { readonly kind: "alternative"; readonly targetMove: "missed" };

export type LineState =
  | {
      readonly kind: "consequence_demonstrated";
      readonly lostMaterial: number;
      readonly atPly: number;
    }
  | {
      readonly kind: "threat_demonstrated";
      readonly threatenedMaterial: number;
      readonly threatPly: number;
    }
  | {
      readonly kind: "insufficient";
      readonly reason: "pv_too_short" | "unstable" | "search_failed";
    };

export interface RefutationLine {
  readonly mode: LineMode;
  readonly state: LineState;
  readonly moves: readonly PVMove[];
  readonly rootId: string;
  readonly sourcedFromPvId: string;
  readonly sourcedFromDepth: number;
}

// ─── Eval Cache (contract defined Stage 1, impl Stage 2) ───

export interface EvalCacheKey {
  readonly fen: string;
  readonly engineIdentity: string;
  readonly configHash: string;
  readonly searchBudget: SearchBudget;
  readonly multiPv: number;
  readonly evaluationModelVersion: string;
}

export interface EvalCache {
  get(key: EvalCacheKey): PVRecord | null;
  set(key: EvalCacheKey, pv: PVRecord): void;
  invalidate(key: EvalCacheKey): void;
  clear(): void;
  getStats(): { readonly hits: number; readonly misses: number; readonly size: number };
}

// ─── Pipeline output ──────────────────────────────────

// ─── Pipeline output ──────────────────────────────────

export type AnalysisStage =
  | "pgn_parse"
  | "search"
  | "classification"
  | "terminal_validation";

export interface AnalysisFailure {
  /** Ply where the failure occurred. 0 for game-level (e.g., PGN parse). */
  readonly ply: number;
  readonly stage: AnalysisStage;
  readonly reason: string;
}

export type AnalysisStatus = "complete" | "partial";

export interface AnalyzedGame {
  readonly pgn: string;
  /** "complete" = all moves classified. "partial" = some failed. */
  readonly status: AnalysisStatus;
  readonly failures: readonly AnalysisFailure[];
  readonly roots: ReadonlyMap<string, AnalysisRoot>;
  readonly pvs: ReadonlyMap<string, PVRecord>;
  readonly moves: readonly ClassifiedMove[];
  readonly explanations: ReadonlyMap<number, ExplanationOutput>;
  readonly refutations: ReadonlyMap<number, RefutationLine>;
  readonly config: AnalysisConfig;
}

// ─── Configuration ────────────────────────────────────

export interface AnalysisConfig {
  readonly version: string;

  readonly engine: {
    readonly identity: string;
    readonly hashMb: number;
    readonly multiPv: number;
  };

  readonly budgets: {
    readonly initialDepth: number;
    readonly refinementDepth: number;
    readonly finalDepth: number;
    readonly initialTargetMs: number;
    readonly reSearchMs: number;
  };

  readonly evaluation: {
    /**
     * Lichess-derived coefficient: 0.00368208.
     * EP(cp) = 1 / (1 + exp(-coefficient * cp))
     */
    readonly epCoefficient: number;
    /** Internal ordering only. NEVER enters EP conversion. */
    readonly mateOrderingValue: number;
    /** Versioned identifier for the EP model, for reproducibility. */
    readonly evaluationModelVersion: string;
  };

  readonly classification: {
    /**
     * EP-loss thresholds from mover perspective. Range 0..1.
     * Lichess-equivalent starting references:
     *   Inaccuracy: 0.05, Mistake: 0.10, Blunder: 0.15
     * These are NOT validated for Outplay yet.
     */
    readonly epLossThresholds: Readonly<Record<QualityLevel, number>>;
    readonly cpLossSecondaryThreshold: number;
    readonly brilliantSeeThreshold: number;
    readonly missExpectedGainThreshold: number;
    readonly mateDistanceTiers: {
      readonly excellent: number;
      readonly good: number;
      readonly inaccuracy: number;
      readonly mistake: number;
    };
  };

  readonly motifs: {
    readonly enabled: readonly MotifKind[];
    readonly precisionTargets: Readonly<Record<MotifKind, number>>;
  };

  readonly explanation: {
    readonly secondaryContributionRatio: number;
  };
}
