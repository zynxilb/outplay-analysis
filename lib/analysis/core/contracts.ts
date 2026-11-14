// lib/analysis/core/contracts.ts
// Outplay Analysis — Layer Contracts + Runtime Validators
// Commit 1, Rev 11 (approved). See META.md for discipline rules.

import type {
  AnalysisRoot,
  AnalysisPurpose,
  AnalysisConfig,
  Evaluation,
  ExpectedScore,
  SourcedEvaluation,
  PVRecord,
  EvidenceGraph,
  MotifDetected,
  MotifVerified,
  MotifAttributed,
  MotifKind,
  MotifEvidence,
  ClassifiedMove,
  ClassificationInput,
  ExplanationOutput,
  PlannedExplanation,
  RefutationLine,
  LineMode,
  SearchBudget,
  QualityLevel,
  MateTransition,
  MateVerdict,
  ProofMechanical,
  ProofEngine,
  ProofConsequence,
  MechanicalRule,
} from "./types";

// ═══════════════════════════════════════════════════════════
// Layer Interfaces
// ═══════════════════════════════════════════════════════════

export interface EngineLayer {
  initialize(config: AnalysisConfig["engine"]): Promise<void>;
  search(
    fen: string,
    purpose: AnalysisPurpose,
    budget: SearchBudget,
  ): Promise<{ root: AnalysisRoot; pv: PVRecord }>;
  abort(): Promise<void>;
  dispose(): Promise<void>;
}

export interface EvaluationLayer {
  toExpectedScore(evaluation: Evaluation): ExpectedScore | null;
  toQuality(
    epLoss: number,
    cpLoss: number,
    config: AnalysisConfig["classification"],
  ): QualityLevel;
}

export interface ClassificationLayer {
  classify(input: ClassificationInput, config: AnalysisConfig): ClassifiedMove;
}

export interface MotifDetector {
  readonly kind: MotifKind;
  detect(positionFen: string): MotifDetected[];
}

export interface MotifVerifier {
  readonly kind: MotifKind;
  verify(
    candidate: MotifDetected,
    context: {
      preMoveFen: string;
      postMoveFen: string;
      rootPvs: readonly PVRecord[];
    },
  ): MotifVerified | null;
}

export interface AttributionLayer {
  buildGraph(input: {
    rootFen: string;
    verifiedMotifs: readonly MotifVerified[];
    context: { preMoveFen: string; postMoveFen: string };
  }): EvidenceGraph;
  attribute(
    motif: MotifVerified,
    graph: EvidenceGraph,
    playedMoveUci: string,
  ): MotifAttributed | null;
  pickPrimary(attributed: readonly MotifAttributed[]): MotifAttributed | null;
}

export interface ExplanationPlanner {
  plan(
    graph: EvidenceGraph,
    primaryMotif: MotifAttributed | null,
  ): ExplanationOutput;
}

export interface RefutationRenderer {
  render(input: {
    mode: LineMode;
    playedMoveUci: string;
    bestMoveUci: string | null;
    preMoveRoot: AnalysisRoot;
    postMoveRoot: AnalysisRoot;
    pvs: ReadonlyMap<string, PVRecord>;
    classificationDepth: number;
    reSearchBudgetMs: number;
  }): Promise<RefutationLine | null>;
}

export interface AnalysisPipeline {
  analyze(
    pgn: string,
    config: AnalysisConfig,
  ): Promise<import("./types").AnalyzedGame>;
}

// ═══════════════════════════════════════════════════════════
// Validation Context
// ═══════════════════════════════════════════════════════════

export interface ValidationContext {
  readonly roots: ReadonlyMap<string, AnalysisRoot>;
  readonly pvs: ReadonlyMap<string, PVRecord>;
  readonly config: AnalysisConfig;
}

// ═══════════════════════════════════════════════════════════
// Contract Violation
// ═══════════════════════════════════════════════════════════

export class ContractViolation extends Error {
  readonly contract: string;
  readonly detail: string;

  constructor(contract: string, detail: string) {
    super(`[${contract}] ${detail}`);
    this.name = "ContractViolation";
    this.contract = contract;
    this.detail = detail;
  }
}

// ═══════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════

const ALGEBRAIC_SQUARE = /^[a-h][1-8]$/;
const PIECE_ID = /^[KQRBNPkqrbnp]$/;

const ALL_MECHANICAL_RULES: readonly MechanicalRule[] = [
  "SEE_ATTACKS_TARGET",
  "SEE_TARGET_UNDEFENDED",
  "SEE_MULTIPLE_TARGETS",
  "GEOMETRY_FORK",
  "GEOMETRY_PIN",
  "GEOMETRY_SKEWER",
  "GEOMETRY_DISCOVERED",
  "GEOMETRY_DEFENDER_REMOVAL",
  "LEGAL_MOVE",
  "PIECE_CONSTRAINED",
  "PIECE_UNDEFENDED",
];

const QUALITY_RANK: Record<QualityLevel, number> = {
  Best: 0, Excellent: 1, Good: 2, Inaccuracy: 3, Mistake: 4, Blunder: 5,
};

function rank(q: QualityLevel): number {
  return QUALITY_RANK[q];
}

// ═══════════════════════════════════════════════════════════
// Config Hash
// ═══════════════════════════════════════════════════════════

export function computeConfigHash(
  engineCfg: AnalysisConfig["engine"],
): string {
  const keys = Object.keys(engineCfg).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = (engineCfg as Record<string, unknown>)[k];
    if (v === null || v === undefined)
      throw new ContractViolation("ConfigHash", `engine field "${k}" is null`);
    const t = typeof v;
    let serialized: string;
    if (t === "string") {
      serialized = JSON.stringify(v);
    } else if (t === "number") {
      if (!Number.isFinite(v))
        throw new ContractViolation("ConfigHash", `engine field "${k}" non-finite`);
      serialized = String(v);
    } else if (t === "boolean") {
      serialized = v ? "true" : "false";
    } else {
      throw new ContractViolation("ConfigHash", `engine field "${k}" unsupported type`);
    }
    parts.push(`${k.length}:${k}=${serialized.length}:${serialized}`);
  }
  return parts.join("");
}

// ═══════════════════════════════════════════════════════════
// Mate Verdict (single source of truth — used by classifier + validator)
// ═══════════════════════════════════════════════════════════

export function computeMateVerdict(
  played: Evaluation,
  best: Evaluation,
  moverColor: "w" | "b",
): MateVerdict | null {
  const mover = moverColor === "w" ? "white" : "black";
  const playMate = played.type === "mate" ? played : null;
  const bestMate = best.type === "mate" ? best : null;

  if (!playMate && !bestMate) return null;

  if (bestMate && !playMate) {
    if (bestMate.winner === mover) return { kind: "lost" };
    return { kind: "gained", reason: "escaped_mate_best_allowed" };
  }

  if (!bestMate && playMate) {
    if (playMate.winner === mover)
      return { kind: "gained", reason: "created_mate_best_missed" };
    return { kind: "lost" };
  }

  // Both mate
  const playFavorsMover = playMate!.winner === mover;
  const bestFavorsMover = bestMate!.winner === mover;

  if (playFavorsMover !== bestFavorsMover) {
    if (bestFavorsMover && !playFavorsMover) return { kind: "lost" };
    return { kind: "gained", reason: "winner_flipped_to_mover" };
  }

  if (playFavorsMover) {
    if (playMate!.in < bestMate!.in)
      return { kind: "gained", reason: "faster_than_best" };
    if (playMate!.in === bestMate!.in)
      return { kind: "preserved", distance: playMate!.in };
    return {
      kind: "delayed",
      byMoves: playMate!.in - bestMate!.in,
      direction: "for_mover",
    };
  }

  // Both against mover
  if (playMate!.in > bestMate!.in)
    return { kind: "gained", reason: "survived_longer_than_best" };
  if (playMate!.in === bestMate!.in)
    return { kind: "preserved", distance: playMate!.in };
  return {
    kind: "delayed",
    byMoves: bestMate!.in - playMate!.in,
    direction: "against_mover",
  };
}

// ═══════════════════════════════════════════════════════════
// Classification (single source of truth)
// ═══════════════════════════════════════════════════════════

/**
 * Quality from EP + CP.
 * Thresholds use strict ">=" chains: `epLoss >= t.X` means at least as bad as X.
 * `t.Best` is not consulted (Best is the "everything below Excellent" case).
 */
export function qualityFromEvaluation(
  epLoss: number,
  cpLoss: number,
  config: AnalysisConfig["classification"],
): QualityLevel {
  const t = config.epLossThresholds;

  let tier: QualityLevel;
  if (epLoss >= t.Blunder) tier = "Blunder";
  else if (epLoss >= t.Mistake) tier = "Mistake";
  else if (epLoss >= t.Inaccuracy) tier = "Inaccuracy";
  else if (epLoss >= t.Good) tier = "Good";
  else if (epLoss >= t.Excellent) tier = "Excellent";
  else tier = "Best";

  // CP secondary floor: significant material loss can't be Best/Good.
  if (cpLoss >= config.cpLossSecondaryThreshold) {
    const cpFloor: QualityLevel = "Inaccuracy";
    if (rank(tier) < rank(cpFloor)) tier = cpFloor;
  }

  return tier;
}

export function distanceTier(
  distanceLoss: number,
  config: AnalysisConfig["classification"],
): QualityLevel {
  const m = config.mateDistanceTiers;
  if (distanceLoss <= 0) return "Best";
  if (distanceLoss <= m.excellent) return "Excellent";
  if (distanceLoss <= m.good) return "Good";
  if (distanceLoss <= m.inaccuracy) return "Inaccuracy";
  if (distanceLoss <= m.mistake) return "Mistake";
  return "Blunder";
}

/**
 * Derive quality + annotations from input.
 * Uses `input.moverColor` internally — no separate param.
 * Mate transitions go through computeMateVerdict, not EP thresholds.
 */
export function deriveClassification(
  input: ClassificationInput,
  config: AnalysisConfig,
): { quality: QualityLevel; annotations: readonly import("./types").Annotation[] } {
  const verdict = computeMateVerdict(
    input.evalAfterPlayed.eval,
    input.evalAfterBest.eval,
    input.moverColor,
  );

  if (verdict === null) {
    return {
      quality: qualityFromEvaluation(input.epLoss, input.cpLoss, config.classification),
      annotations: [...input.annotations],
    };
  }

  switch (verdict.kind) {
    case "preserved":
      return { quality: "Best", annotations: [...input.annotations] };
    case "delayed":
      return {
        quality: distanceTier(verdict.byMoves, config.classification),
        annotations: [...input.annotations],
      };
    case "lost":
      return { quality: "Blunder", annotations: [...input.annotations] };
    case "gained":
      throw new ContractViolation(
        "Classification",
        `search inconsistency: ${verdict.reason} — reconcile before classifying`,
      );
    case "inconsistent":
      throw new ContractViolation("Classification", verdict.reason);
  }
}

// ═══════════════════════════════════════════════════════════
// FEN helpers
// ═══════════════════════════════════════════════════════════

function sideToMoveFromFen(fen: string): "w" | "b" {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 2)
    throw new ContractViolation("FEN", "invalid FEN (missing side-to-move)");
  const stm = parts[1];
  if (stm !== "w" && stm !== "b")
    throw new ContractViolation("FEN", `invalid side-to-move "${stm}"`);
  return stm;
}

// ═══════════════════════════════════════════════════════════
// Validators
// ═══════════════════════════════════════════════════════════

export function validateAnalysisRoot(root: AnalysisRoot): void {
  if (!root.id) throw new ContractViolation("AnalysisRoot", "id required");
  if (!root.fen) throw new ContractViolation("AnalysisRoot", "fen required");
  if (root.sideToMove !== "w" && root.sideToMove !== "b")
    throw new ContractViolation("AnalysisRoot", `invalid sideToMove "${root.sideToMove}"`);
  if (root.purpose !== "find-best-move" && root.purpose !== "find-opponent-response")
    throw new ContractViolation("AnalysisRoot", `invalid purpose "${root.purpose}"`);
  if (!root.engineIdentity)
    throw new ContractViolation("AnalysisRoot", "engineIdentity required");
  if (!root.configHash)
    throw new ContractViolation("AnalysisRoot", "configHash required");
  if (root.evaluationPerspective !== "white")
    throw new ContractViolation("AnalysisRoot", "perspective must be white");
  const b = root.searchBudget;
  if (!Number.isFinite(b.value) || b.value <= 0)
    throw new ContractViolation("AnalysisRoot", "searchBudget.value must be finite > 0");
  if (b.kind === "depth" && !Number.isInteger(b.value))
    throw new ContractViolation("AnalysisRoot", "depth budget must be integer");
  if (b.kind === "nodes" && !Number.isInteger(b.value))
    throw new ContractViolation("AnalysisRoot", "nodes budget must be integer");
}

export function validatePV(pv: PVRecord, root: AnalysisRoot): void {
  if (!pv.id) throw new ContractViolation("PVRecord", "id required");
  if (pv.rootId !== root.id)
    throw new ContractViolation("PVRecord", "rootId must match AnalysisRoot.id");
  if (!Number.isInteger(pv.depth) || pv.depth < 0)
    throw new ContractViolation("PVRecord", "depth must be non-negative integer");
  if (pv.moves.length === 0)
    throw new ContractViolation("PVRecord", "moves must be non-empty");
  if (!Number.isFinite(pv.createdAt) || pv.createdAt <= 0)
    throw new ContractViolation("PVRecord", "createdAt must be valid timestamp");
  for (const m of pv.moves) {
    if (!m.uci || !m.san)
      throw new ContractViolation("PVRecord", "every move requires uci and san");
  }
}

export function validatePvProvenance(pv: PVRecord, ctx: ValidationContext): void {
  const root = ctx.roots.get(pv.rootId);
  if (!root)
    throw new ContractViolation("PVRecord", `rootId "${pv.rootId}" not registered`);
  if (root.engineIdentity !== ctx.config.engine.identity)
    throw new ContractViolation(
      "PVRecord",
      `root engine "${root.engineIdentity}" != config "${ctx.config.engine.identity}"`,
    );
  if (root.configHash !== computeConfigHash(ctx.config.engine))
    throw new ContractViolation("PVRecord", "root configHash does not match config");
}

export function validateSourcedEvaluation(
  se: SourcedEvaluation,
  expectedRootId: string,
  ctx: ValidationContext,
): void {
  const pv = ctx.pvs.get(se.pvId);
  if (!pv)
    throw new ContractViolation("SourcedEvaluation", `pvId "${se.pvId}" not found`);
  if (se.rootId !== pv.rootId)
    throw new ContractViolation("SourcedEvaluation", "se.rootId !== pv.rootId");
  if (se.rootId !== expectedRootId)
    throw new ContractViolation(
      "SourcedEvaluation",
      `rootId "${se.rootId}" !== expected "${expectedRootId}"`,
    );
  validatePvProvenance(pv, ctx);
  if (se.depth !== pv.depth)
    throw new ContractViolation("SourcedEvaluation", "depth mismatch");
  if (se.eval.type === "mate") {
    if (se.eval.winner !== "white" && se.eval.winner !== "black")
      throw new ContractViolation("SourcedEvaluation", "mate winner invalid");
  }
}

export function validateComparisonCompatibility(
  input: ClassificationInput,
  ctx: ValidationContext,
): void {
  const beforePv = ctx.pvs.get(input.evalBefore.pvId);
  const bestPv = ctx.pvs.get(input.evalAfterBest.pvId);
  const playedPv = ctx.pvs.get(input.evalAfterPlayed.pvId);
  if (!beforePv || !bestPv || !playedPv)
    throw new ContractViolation("ComparisonCompatibility", "missing PV");

  if (input.evalBefore.pvId !== input.evalAfterBest.pvId)
    throw new ContractViolation(
      "ComparisonCompatibility",
      "evalBefore and evalAfterBest must share the same PV",
    );
  if (input.evalAfterPlayed.pvId === input.evalBefore.pvId)
    throw new ContractViolation(
      "ComparisonCompatibility",
      "evalAfterPlayed must not share PV with evalBefore",
    );

  const beforeRoot = ctx.roots.get(beforePv.rootId);
  const playedRoot = ctx.roots.get(playedPv.rootId);
  if (!beforeRoot || !playedRoot)
    throw new ContractViolation("ComparisonCompatibility", "root not registered");

  // MVP rule: exact budget match
  if (beforeRoot.searchBudget.kind !== playedRoot.searchBudget.kind)
    throw new ContractViolation(
      "ComparisonCompatibility",
      `budget kind mismatch: before=${beforeRoot.searchBudget.kind} played=${playedRoot.searchBudget.kind}`,
    );
  if (beforeRoot.searchBudget.value !== playedRoot.searchBudget.value)
    throw new ContractViolation(
      "ComparisonCompatibility",
      `budget value mismatch: before=${beforeRoot.searchBudget.value} played=${playedRoot.searchBudget.value}`,
    );

  if (beforePv.stability !== "stable" || playedPv.stability !== "stable")
    throw new ContractViolation(
      "ComparisonCompatibility",
      "compared PVs must be from stable searches",
    );

  validateSourcedEvaluation(input.evalBefore, input.preMoveRootId, ctx);
  validateSourcedEvaluation(input.evalAfterBest, input.preMoveRootId, ctx);
  validateSourcedEvaluation(input.evalAfterPlayed, input.postMoveRootId, ctx);
}

export function validateClassificationInput(input: ClassificationInput): void {
  const stm = sideToMoveFromFen(input.preMoveFen);
  if (input.moverColor !== stm)
    throw new ContractViolation(
      "ClassificationInput",
      `moverColor "${input.moverColor}" != preMoveFen side-to-move "${stm}"`,
    );
}

export function validateEvidenceGraph(
  graph: EvidenceGraph,
  ctx: ValidationContext,
): void {
  for (const [key, node] of graph.nodes.entries()) {
    if (key !== node.id)
      throw new ContractViolation("EvidenceGraph", `map key "${key}" != node.id "${node.id}"`);
    if (node.proofs.length === 0)
      throw new ContractViolation("EvidenceGraph", `node "${node.id}" has no proof`);
    for (const proof of node.proofs) {
      switch (proof.kind) {
        case "mechanical": validateProofMechanical(proof); break;
        case "engine": validateProofEngine(proof, ctx.pvs); break;
        case "consequence": validateProofConsequence(proof, ctx.pvs); break;
      }
    }
  }

  for (const d of graph.metadata.duplicates) {
    if (!graph.nodes.has(d.a) || !graph.nodes.has(d.b))
      throw new ContractViolation("EvidenceGraph", "metadata.duplicates missing node");
  }
  for (const s of graph.metadata.sharedRoots) {
    if (!graph.nodes.has(s.a) || !graph.nodes.has(s.b) || !graph.nodes.has(s.rootEvidenceId))
      throw new ContractViolation("EvidenceGraph", "metadata.sharedRoots missing node");
  }

  const edgeIds = new Set<string>();
  for (const edge of graph.causalEdges) {
    if (!edge.id) throw new ContractViolation("EvidenceGraph", "edge id required");
    if (edgeIds.has(edge.id))
      throw new ContractViolation("EvidenceGraph", `duplicate edge id "${edge.id}"`);
    edgeIds.add(edge.id);
    if (!graph.nodes.has(edge.from))
      throw new ContractViolation("EvidenceGraph", `edge.from "${edge.from}" missing`);
    if (!graph.nodes.has(edge.to))
      throw new ContractViolation("EvidenceGraph", `edge.to "${edge.to}" missing`);
    if (edge.type !== "enables" && edge.type !== "causes")
      throw new ContractViolation("EvidenceGraph", `invalid edge type "${edge.type}"`);
  }

  // Acyclicity
  const adj = new Map<string, string[]>();
  for (const id of graph.nodes.keys()) adj.set(id, []);
  for (const edge of graph.causalEdges) adj.get(edge.from)!.push(edge.to);

  const W = 0, G = 1, B = 2;
  const color = new Map<string, number>();
  for (const id of graph.nodes.keys()) color.set(id, W);

  const visit = (node: string): void => {
    color.set(node, G);
    for (const next of adj.get(node) ?? []) {
      const c = color.get(next);
      if (c === G) throw new ContractViolation("EvidenceGraph", `cycle through "${next}"`);
      if (c === W) visit(next);
    }
    color.set(node, B);
  };
  for (const id of graph.nodes.keys()) {
    if (color.get(id) === W) visit(id);
  }
}

export function hasCausalPath(
  graph: EvidenceGraph,
  from: string,
  to: string,
): boolean {
  if (from === to) return true;
  const adj = new Map<string, string[]>();
  for (const edge of graph.causalEdges) {
    if (!adj.has(edge.from)) adj.set(edge.from, []);
    adj.get(edge.from)!.push(edge.to);
  }
  const visited = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === to) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const next of adj.get(cur) ?? []) stack.push(next);
  }
  return false;
}

export function validateProofMechanical(proof: ProofMechanical): void {
  if (!ALL_MECHANICAL_RULES.includes(proof.rule))
    throw new ContractViolation("ProofMechanical", `rule "${proof.rule}" not in allowlist`);
  if (proof.squares.length === 0)
    throw new ContractViolation("ProofMechanical", "squares required");
  for (const sq of proof.squares) {
    if (!ALGEBRAIC_SQUARE.test(sq))
      throw new ContractViolation("ProofMechanical", `invalid square "${sq}"`);
  }
  for (const p of proof.pieces) {
    if (!PIECE_ID.test(p))
      throw new ContractViolation("ProofMechanical", `invalid piece id "${p}"`);
  }
}

export function validateProofEngine(
  proof: ProofEngine,
  pvs: ReadonlyMap<string, PVRecord>,
): void {
  const pv = pvs.get(proof.pvId);
  if (!pv) throw new ContractViolation("ProofEngine", `pvId "${proof.pvId}" not found`);
  if (proof.depth !== pv.depth)
    throw new ContractViolation("ProofEngine", "depth mismatch with PV");
  if (JSON.stringify(proof.evalBefore) !== JSON.stringify(pv.rootEval))
    throw new ContractViolation("ProofEngine", "evalBefore != pv.rootEval");
  const last = pv.moves[pv.moves.length - 1];
  if (JSON.stringify(proof.evalAfter) !== JSON.stringify(last.evalAfter))
    throw new ContractViolation("ProofEngine", "evalAfter != last PV evalAfter");
}

export function validateProofConsequence(
  proof: ProofConsequence,
  pvs: ReadonlyMap<string, PVRecord>,
): void {
  const pv = pvs.get(proof.pvId);
  if (!pv) throw new ContractViolation("ProofConsequence", `pvId "${proof.pvId}" not found`);
  if (!Number.isInteger(proof.demonstratedAtPly))
    throw new ContractViolation("ProofConsequence", "demonstratedAtPly must be integer");
  if (proof.demonstratedAtPly < 0 || proof.demonstratedAtPly >= pv.moves.length)
    throw new ContractViolation(
      "ProofConsequence",
      `demonstratedAtPly ${proof.demonstratedAtPly} out of range`,
    );
  if (!Number.isFinite(proof.materialLossCp) || proof.materialLossCp <= 0)
    throw new ContractViolation("ProofConsequence", "materialLossCp must be finite > 0");
}

export function validateMotifDetectorOutput(
  detectorKind: MotifKind,
  candidates: MotifDetected[],
): void {
  for (const c of candidates) {
    if (c.kind !== detectorKind)
      throw new ContractViolation(
        "MotifDetector",
        `detector "${detectorKind}" returned candidate "${c.kind}"`,
      );
  }
}

export function validateMotifVerified(
  candidate: MotifDetected,
  verified: MotifVerified,
): void {
  if (verified.kind !== candidate.kind)
    throw new ContractViolation("MotifVerified", "kind mismatch with candidate");
  if (verified.detected.id !== candidate.id)
    throw new ContractViolation("MotifVerified", "detected.id != candidate.id");
  validateProofMechanical(verified.mechanicalProof);

  const ruleForKind: Record<MotifKind, readonly MechanicalRule[]> = {
    fork: ["GEOMETRY_FORK", "SEE_MULTIPLE_TARGETS"],
    pin: ["GEOMETRY_PIN"],
    skewer: ["GEOMETRY_SKEWER"],
    discovered: ["GEOMETRY_DISCOVERED"],
    removing_defender: ["GEOMETRY_DEFENDER_REMOVAL"],
  };
  const allowed = ruleForKind[verified.kind];
  if (!allowed.includes(verified.mechanicalProof.rule))
    throw new ContractViolation(
      "MotifVerified",
      `rule "${verified.mechanicalProof.rule}" not valid for "${verified.kind}"`,
    );
}

export function validateMotifEvidence(m: MotifEvidence): void {
  switch (m.stage) {
    case "detected":
      if (!m.detected.kind)
        throw new ContractViolation("MotifEvidence", "detected.kind required");
      return;
    case "verified":
      if (m.verified.kind !== m.verified.detected.kind)
        throw new ContractViolation("MotifEvidence", "kind mismatch");
      return;
    case "attributed":
      if (m.attributed.verified.kind !== m.attributed.verified.detected.kind)
        throw new ContractViolation("MotifEvidence", "kind mismatch");
      if (m.attributed.consequences.length === 0)
        throw new ContractViolation("MotifEvidence", "attributed requires consequences");
      return;
  }
}

export function validateMotifAttributed(
  m: MotifAttributed,
  graph: EvidenceGraph,
): void {
  if (m.causalPath.length === 0)
    throw new ContractViolation("MotifAttributed", "causalPath empty");
  if (m.causalPath[0].incomingEdgeId !== null)
    throw new ContractViolation("MotifAttributed", "first step must have null incomingEdgeId");

  const edgeById = new Map(graph.causalEdges.map((e) => [e.id, e]));

  for (let i = 0; i < m.causalPath.length; i++) {
    const step = m.causalPath[i];
    if (!graph.nodes.has(step.nodeId))
      throw new ContractViolation("MotifAttributed", `node "${step.nodeId}" not in graph`);
    if (i === 0) continue;
    if (!step.incomingEdgeId)
      throw new ContractViolation("MotifAttributed", `step ${i} missing incomingEdgeId`);
    const edge = edgeById.get(step.incomingEdgeId);
    if (!edge)
      throw new ContractViolation("MotifAttributed", `edge "${step.incomingEdgeId}" missing`);
    if (edge.to !== step.nodeId)
      throw new ContractViolation("MotifAttributed", `edge.to != nodeId at step ${i}`);
    if (edge.from !== m.causalPath[i - 1].nodeId)
      throw new ContractViolation("MotifAttributed", `edge.from != prev at step ${i}`);
  }

  const pathNodeIds = new Set(m.causalPath.map((s) => s.nodeId));
  const consequenceInPath = m.consequences.some((c) => pathNodeIds.has(c.evidence.id));
  if (!consequenceInPath)
    throw new ContractViolation("MotifAttributed", "no consequence on causal path");
}

export function validatePlannedExplanation(
  plan: PlannedExplanation,
  graph: EvidenceGraph,
): void {
  if (!graph.nodes.has(plan.rootCause.id))
    throw new ContractViolation(
      "PlannedExplanation",
      `rootCause "${plan.rootCause.id}" not in graph`,
    );
  if (plan.confidence === "verified" && plan.causalChain.length === 0)
    throw new ContractViolation("PlannedExplanation", "verified plan requires causal chain");

  let cursor = plan.rootCause.id;
  for (const step of plan.causalChain) {
    if (!graph.nodes.has(step.mechanism.id))
      throw new ContractViolation("PlannedExplanation", `mechanism not in graph`);
    if (!graph.nodes.has(step.consequence.id))
      throw new ContractViolation("PlannedExplanation", `consequence not in graph`);
    if (!hasCausalPath(graph, cursor, step.mechanism.id))
      throw new ContractViolation("PlannedExplanation", `no path ${cursor}→${step.mechanism.id}`);
    if (!hasCausalPath(graph, step.mechanism.id, step.consequence.id))
      throw new ContractViolation("PlannedExplanation", `no path ${step.mechanism.id}→${step.consequence.id}`);
    cursor = step.consequence.id;
  }

  // TODO(commit-2): supporting evidence must be causally connected to root
  for (const s of plan.supportingEvidence) {
    if (!graph.nodes.has(s.id))
      throw new ContractViolation("PlannedExplanation", `supporting evidence not in graph`);
  }
}

export function validateExplanationOutput(
  output: ExplanationOutput,
  graph: EvidenceGraph,
): void {
  if (output.status === "silent") {
    if (!output.reason)
      throw new ContractViolation("ExplanationOutput", "silence requires reason");
    return;
  }
  validatePlannedExplanation(output.primary, graph);
  for (const s of output.secondary) validatePlannedExplanation(s, graph);
}

export function validateRefutationLine(
  line: RefutationLine,
  preMoveRoot: AnalysisRoot,
  postMoveRoot: AnalysisRoot,
  pvs: ReadonlyMap<string, PVRecord>,
): void {
  if (preMoveRoot.purpose !== "find-best-move")
    throw new ContractViolation("RefutationLine", `preMoveRoot.purpose != "find-best-move"`);
  if (postMoveRoot.purpose !== "find-opponent-response")
    throw new ContractViolation("RefutationLine", `postMoveRoot.purpose != "find-opponent-response"`);

  const expectedRoot = line.mode.kind === "alternative" ? preMoveRoot : postMoveRoot;
  if (line.rootId !== expectedRoot.id)
    throw new ContractViolation(
      "RefutationLine",
      `rootId "${line.rootId}" != expected "${expectedRoot.id}" for mode "${line.mode.kind}"`,
    );

  const sourcePv = pvs.get(line.sourcedFromPvId);
  if (!sourcePv)
    throw new ContractViolation("RefutationLine", "sourcedFromPvId not in pvs");
  if (sourcePv.rootId !== line.rootId)
    throw new ContractViolation("RefutationLine", "sourcePv.rootId != line.rootId");
  if (line.sourcedFromDepth !== sourcePv.depth)
    throw new ContractViolation("RefutationLine", "sourcedFromDepth != sourcePv.depth");

  if (line.moves.length > sourcePv.moves.length)
    throw new ContractViolation("RefutationLine", "line.moves longer than source PV");
  for (let i = 0; i < line.moves.length; i++) {
    if (line.moves[i].uci !== sourcePv.moves[i].uci)
      throw new ContractViolation("RefutationLine", `move[${i}] uci mismatch`);
  }

  if (line.state.kind === "consequence_demonstrated") {
    if (!Number.isFinite(line.state.lostMaterial) || line.state.lostMaterial <= 0)
      throw new ContractViolation("RefutationLine", "lostMaterial must be finite > 0");
    if (!Number.isInteger(line.state.atPly) || line.state.atPly < 0)
      throw new ContractViolation("RefutationLine", "atPly must be non-negative integer");
    if (line.state.atPly >= line.moves.length)
      throw new ContractViolation("RefutationLine", "atPly out of range");
    if (line.moves.length < 2)
      throw new ContractViolation("RefutationLine", "consequence requires >= 2 plies");
  }

  if (line.state.kind === "threat_demonstrated") {
    if (!Number.isFinite(line.state.threatenedMaterial) || line.state.threatenedMaterial <= 0)
      throw new ContractViolation("RefutationLine", "threatenedMaterial must be finite > 0");
    if (!Number.isInteger(line.state.threatPly) || line.state.threatPly < 0)
      throw new ContractViolation("RefutationLine", "threatPly must be non-negative integer");
    if (line.state.threatPly >= line.moves.length)
      throw new ContractViolation("RefutationLine", "threatPly out of range");
  }
}

export function validateExpectedScore(es: ExpectedScore): void {
  if (!Number.isFinite(es.value))
    throw new ContractViolation("ExpectedScore", "value must be finite");
  if (es.value < 0 || es.value > 1)
    throw new ContractViolation("ExpectedScore", `value must be in [0,1], got ${es.value}`);
}

export function validateMateTransition(t: MateTransition): void {
  for (const [name, ev] of [
    ["before", t.before],
    ["afterPlayed", t.afterPlayed],
    ["afterBest", t.afterBest],
  ] as const) {
    if (ev.type === "mate") {
      if (!Number.isInteger(ev.in) || ev.in < 0)
        throw new ContractViolation("MateTransition", `${name}.in must be non-negative integer`);
      if (ev.winner !== "white" && ev.winner !== "black")
        throw new ContractViolation("MateTransition", `${name}.winner invalid`);
    }
  }

  const expected = computeMateVerdict(t.afterPlayed, t.afterBest, t.moverColor);
  if (expected === null)
    throw new ContractViolation(
      "MateTransition",
      "transition constructed but neither played nor best is mate",
    );
  if (JSON.stringify(expected) !== JSON.stringify(t.verdict))
    throw new ContractViolation(
      "MateTransition",
      `verdict "${t.verdict.kind}" != computed "${expected.kind}"`,
    );
}

export function validateClassificationOutput(
  input: ClassificationInput,
  output: ClassifiedMove,
  config: AnalysisConfig,
): void {
  if (output.ply !== input.ply)
    throw new ContractViolation("ClassifiedMove", "ply mismatch");
  if (output.san !== input.san)
    throw new ContractViolation("ClassifiedMove", "san mismatch");
  if (JSON.stringify(output.evaluation) !== JSON.stringify(input.evalAfterPlayed.eval))
    throw new ContractViolation("ClassifiedMove", "evaluation != input.evalAfterPlayed.eval");

  const expected = deriveClassification(input, config);

  // Annotation exact set match
  const expSet = new Set(expected.annotations);
  const outSet = new Set(output.annotations);
  if (expSet.size !== outSet.size)
    throw new ContractViolation(
      "ClassifiedMove",
      `annotation count mismatch: expected ${expSet.size}, got ${outSet.size}`,
    );
  for (const a of expSet) {
    if (!outSet.has(a))
      throw new ContractViolation("ClassifiedMove", `missing annotation "${a}"`);
  }
  for (const a of outSet) {
    if (!expSet.has(a))
      throw new ContractViolation("ClassifiedMove", `invented annotation "${a}"`);
  }

  if (output.quality !== expected.quality)
    throw new ContractViolation(
      "ClassifiedMove",
      `quality "${output.quality}" != expected "${expected.quality}"`,
    );
}

export function validateAnalysisConfig(config: AnalysisConfig): void {
  if (!config.version)
    throw new ContractViolation("AnalysisConfig", "version required");

  const t = config.classification.epLossThresholds;
  const ordered: readonly QualityLevel[] = [
    "Best", "Excellent", "Good", "Inaccuracy", "Mistake", "Blunder",
  ];
  for (const level of ordered) {
    const v = t[level];
    if (!Number.isFinite(v) || v < 0)
      throw new ContractViolation(
        "AnalysisConfig",
        `epLossThresholds.${level} must be finite >= 0`,
      );
  }
  for (let i = 1; i < ordered.length; i++) {
    const prev = t[ordered[i - 1]];
    const curr = t[ordered[i]];
    if (curr <= prev)
      throw new ContractViolation(
        "AnalysisConfig",
        `epLossThresholds.${ordered[i]} (${curr}) must be > ${ordered[i - 1]} (${prev})`,
      );
  }

  if (!Number.isFinite(config.classification.cpLossSecondaryThreshold) ||
      config.classification.cpLossSecondaryThreshold <= 0)
    throw new ContractViolation(
      "AnalysisConfig",
      "cpLossSecondaryThreshold must be finite > 0",
    );

  const m = config.classification.mateDistanceTiers;
  if (!Number.isInteger(m.excellent) || m.excellent < 0)
    throw new ContractViolation("AnalysisConfig", "mateDistanceTiers.excellent invalid");
  if (!Number.isInteger(m.good) || m.good <= m.excellent)
    throw new ContractViolation("AnalysisConfig", "mateDistanceTiers.good invalid");
  if (!Number.isInteger(m.inaccuracy) || m.inaccuracy <= m.good)
    throw new ContractViolation("AnalysisConfig", "mateDistanceTiers.inaccuracy invalid");
  if (!Number.isInteger(m.mistake) || m.mistake <= m.inaccuracy)
    throw new ContractViolation("AnalysisConfig", "mateDistanceTiers.mistake invalid");

  if (!Number.isFinite(config.evaluation.epCoefficient) || config.evaluation.epCoefficient <= 0)
    throw new ContractViolation("AnalysisConfig", "epCoefficient must be finite > 0");

  if (!config.evaluation.evaluationModelVersion)
    throw new ContractViolation("AnalysisConfig", "evaluationModelVersion required");
}
