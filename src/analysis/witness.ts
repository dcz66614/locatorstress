// T008 — Witness summary + AnalysisReport assembly
// (PROJECT_BOOK §5.5–§5.7, §6, §11.4; IMPLEMENTATION_PLAN T008).
//
// This module integrates the frozen pieces without modifying any of
// them: verdict (T004), stability score + control metrics (T005),
// canonical JSON + the frozen scenario/oracle/gate builders (T006),
// and the bounded BFS (T007). It only READS those modules.
//
// Two rules from the T007 independent review (P2-1 / P2-2) are enforced
// here and in the API service, not just documented:
//   - P2-1 (BOUNDED_INCOMPLETE passthrough): summarizeWitness() copies
//     the BFS status verbatim and writes a meaning that says the search
//     is incomplete. A null witness is always paired with its status,
//     and BOUNDED_INCOMPLETE is never rendered as "no witness", "no
//     failure" or "safe" anywhere in the report or API. When the frozen
//     6/4096 bounds were in force, a budgetNote records the arithmetic:
//     reaching depth 6 in the full 8-operator no-repeat tree needs
//     1+8+56+336+1680+6720 = 8801 expansions, more than the 4096 budget,
//     so BOUNDED_INCOMPLETE is the correct outcome there.
//   - P2-2 (BFS defaults only): this module never passes operatorOrder
//     or allowRepeat to runBoundedBfs; the API service likewise accepts
//     only fixtureId (+ smaller maxDepth / maxExpandedStates) and
//     rejects operatorOrder / allowRepeat in request bodies.
//
// Analysis hash basis (read before comparing hashes): the frozen S0
// builder buildAnalysisCanonical() hardcodes
// `bfs: { status: "NOT_IMPLEMENTED_S0", witness: null }`, and
// src/canonical/ is frozen, so this module does NOT reuse it. It builds
// its own analysis canonical object (schema "locatorstress.analysis/v1")
// with the same field shape for verdict counts / score / coverage /
// controls / oracle parity / analysisStatus, but with a real per-fixture
// `bfs` map. The resulting analysis_sha256 therefore differs from the
// S0 gate's frozen analysis_sha256 by design; the S0 gate hash
// (651c3fd4…) and evidence/s0/S0_GATE.json are untouched, and the report
// records that in its notes. The scenario and oracle hashes DO reuse the
// frozen builders, so they recompute identically to the S0 gate's values
// for the same 192-case input set.

import { hashCanonical } from "../canonical/canonical-json.js";
import {
  SEED,
  buildGateCanonical as buildGateCanonicalFromHashes,
  buildGateCounts as buildGateCountsFromHashes,
  buildOracleCanonical as buildOracleCanonicalFromHashes,
  buildScenarioCanonical as buildScenarioCanonicalFromHashes,
} from "../canonical/hashes.js";
import type {
  Coverage,
  GateCountsInput,
  OracleCaseInput,
  ScenarioFixtureInput,
  VerdictCounts,
} from "../canonical/hashes.js";
import type { AnalysisReport, ReportCase, WitnessSummary } from "../contracts/report.js";
import { SCHEMA_ANALYSIS_REPORT } from "../contracts/report.js";
import {
  computeControlMetrics,
  computeStabilityScores,
} from "../score/stability-score.js";
import type { ScoreCase } from "../score/stability-score.js";
import type { BfsResult, BfsWitness } from "../search/bfs.js";
import { BFS_MAX_DEPTH, BFS_MAX_EXPANDED_STATES } from "../search/bfs.js";
import type { AnalysisStatus, Verdict } from "../verdict/classify.js";

export const SCHEMA_ANALYSIS_T008 = "locatorstress.analysis/v1";

/** Expansions needed to reach depth 6 in the unpruned 8-operator tree. */
export const DEPTH6_UNPRUNED_EXPANSIONS = 8801;

export function witnessMeaning(
  status: BfsResult["status"],
  witness: BfsWitness | null,
  limits: { maxDepth: number; maxExpandedStates: number },
  queueRemaining: number,
): string {
  if (status === "FOUND" && witness !== null) {
    return (
      `Shortest failing sequence found: ${witness.sequence.join("+")} ` +
      `fails with ${witness.verdict} at depth ${witness.depth}.`
    );
  }
  if (status === "BOUNDED_NO_WITNESS") {
    return (
      `No failing sequence exists inside the searched space ` +
      `(depth <= ${limits.maxDepth}, <= ${limits.maxExpandedStates} expansions). ` +
      `This does NOT prove the locator is safe for all DOM changes.`
    );
  }
  // BOUNDED_INCOMPLETE — the wording is deliberately a negation of any
  // "no witness" reading: the search stopped early, it did not finish.
  return (
    `Search budget exhausted with ${queueRemaining} sequence(s) still ` +
    `queued; the search is INCOMPLETE — this is NOT "no witness", NOT ` +
    `"no failure" and NOT "safe".`
  );
}

export function depth6BudgetNote(
  result: BfsResult,
): string | undefined {
  if (
    result.status === "BOUNDED_INCOMPLETE" &&
    result.limits.maxDepth === BFS_MAX_DEPTH &&
    result.limits.maxExpandedStates === BFS_MAX_EXPANDED_STATES
  ) {
    return (
      `Depth-6 witness is budget-conditional: reaching depth 6 in the ` +
      `full 8-operator no-repeat tree needs ${DEPTH6_UNPRUNED_EXPANSIONS} ` +
      `expansions (1+8+56+336+1680+6720), more than the frozen ` +
      `${BFS_MAX_EXPANDED_STATES} budget, so BOUNDED_INCOMPLETE is the ` +
      `correct outcome for an unpruned depth-6 search. Real DOM trees ` +
      `may still prune enough (state dedup, non-expansion of failures) ` +
      `for depth 6 to be reachable for a given fixture; the BFS never ` +
      `claims otherwise.`
    );
  }
  return undefined;
}

/**
 * Summarise one BfsResult for the report / API. Validates the BFS
 * invariants and throws on contradiction instead of silently repairing
 * it: FOUND requires a witness, BOUNDED_* require witness null, and a
 * witness depth must equal its sequence length. The status is copied
 * verbatim — never remapped, never softened.
 */
export function summarizeWitness(result: BfsResult): WitnessSummary {
  if (result.status === "FOUND" && result.witness === null) {
    throw new Error(
      `BFS invariant violated for ${result.fixtureId}: status FOUND with null witness`,
    );
  }
  if (result.status !== "FOUND" && result.witness !== null) {
    throw new Error(
      `BFS invariant violated for ${result.fixtureId}: status ${result.status} with a non-null witness`,
    );
  }
  if (
    result.witness !== null &&
    result.witness.depth !== result.witness.sequence.length
  ) {
    throw new Error(
      `BFS invariant violated for ${result.fixtureId}: witness depth ${result.witness.depth} != sequence length ${result.witness.sequence.length}`,
    );
  }
  const summary: WitnessSummary = {
    fixtureId: result.fixtureId,
    status: result.status,
    witness:
      result.witness === null
        ? null
        : {
            sequence: [...result.witness.sequence],
            depth: result.witness.depth,
            verdict: result.witness.verdict,
          },
    meaning: witnessMeaning(
      result.status,
      result.witness,
      result.limits,
      result.queueRemaining,
    ),
    limits: { ...result.limits },
    statesEvaluated: result.statesEvaluated,
    statesExpanded: result.statesExpanded,
    statesDeduplicated: result.statesDeduplicated,
    uniqueStates: result.uniqueStates,
    incompleteStates: result.incompleteStates,
    maxDepthReached: result.maxDepthReached,
    queueRemaining: result.queueRemaining,
    perDepthEvaluated: { ...result.perDepthEvaluated },
    notes: [...result.notes],
  };
  const note = depth6BudgetNote(result);
  if (note !== undefined) {
    summary.budgetNote = note;
  }
  return summary;
}

export interface AnalysisCanonicalInput {
  verdictCounts: VerdictCounts;
  verdictCountsByKind: Record<string, VerdictCounts>;
  stabilityScore: { stable: number; completed: number; score: string };
  coverage: Coverage;
  controls: {
    stable: { pairs: number; mismatches: number };
    fragile: { pairs: number; mismatches: number };
  };
  analysisStatus: AnalysisStatus;
  oracleParity: { compared: number; matched: number; mismatched: number };
  witnesses: Record<string, WitnessSummary>;
}

/**
 * T008 analysis canonical object. Same field shape as the frozen
 * buildAnalysisCanonical() for verdict counts / score / coverage /
 * controls / oracle parity / analysisStatus, but `bfs` carries the real
 * per-fixture witness summaries (status, witness, limits, exact counts)
 * instead of the S0 NOT_IMPLEMENTED_S0 placeholder. Schema string is
 * new ("locatorstress.analysis/v1") so this hash can never be confused
 * with the frozen S0 analysis hash.
 */
export function buildAnalysisCanonicalT008(
  input: AnalysisCanonicalInput,
): Record<string, unknown> {
  const witnessEntries = Object.entries(input.witnesses)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([fixtureId, w]) => ({
      fixtureId,
      status: w.status,
      witness: w.witness,
      limits: { ...w.limits },
      statesEvaluated: w.statesEvaluated,
      statesExpanded: w.statesExpanded,
      statesDeduplicated: w.statesDeduplicated,
      uniqueStates: w.uniqueStates,
      incompleteStates: w.incompleteStates,
      maxDepthReached: w.maxDepthReached,
      queueRemaining: w.queueRemaining,
      perDepthEvaluated: { ...w.perDepthEvaluated },
      notes: [...w.notes],
    }));
  let found = 0;
  let boundedNoWitness = 0;
  let boundedIncomplete = 0;
  for (const w of Object.values(input.witnesses)) {
    if (w.status === "FOUND") found += 1;
    else if (w.status === "BOUNDED_NO_WITNESS") boundedNoWitness += 1;
    else boundedIncomplete += 1;
  }
  return {
    schema: SCHEMA_ANALYSIS_T008,
    seed: SEED,
    verdictCounts: input.verdictCounts,
    verdictCountsByKind: input.verdictCountsByKind,
    stabilityScore: {
      stable: input.stabilityScore.stable,
      completed: input.stabilityScore.completed,
      score: input.stabilityScore.score,
    },
    coverage: input.coverage,
    controls: {
      stable: {
        pairs: input.controls.stable.pairs,
        mismatches: input.controls.stable.mismatches,
      },
      fragile: {
        pairs: input.controls.fragile.pairs,
        mismatches: input.controls.fragile.mismatches,
      },
    },
    analysisStatus: input.analysisStatus,
    bfs: {
      searchedFixtures: witnessEntries.length,
      found,
      boundedNoWitness,
      boundedIncomplete,
      witnesses: witnessEntries,
    },
    oracleParity: {
      compared: input.oracleParity.compared,
      matched: input.oracleParity.matched,
      mismatched: input.oracleParity.mismatched,
    },
  };
}

export interface BuildAnalysisReportInput {
  /** Single-mutation cases, any order (sorted by fixtureId/mutationId). */
  cases: ReportCase[];
  /** Fixture inputs for the scenario hash (html included). */
  fixtures: ScenarioFixtureInput[];
  /** BFS summaries for the fixtures actually searched (may be a subset). */
  witnesses: Record<string, WitnessSummary>;
  oracleParity: { compared: number; matched: number; mismatched: number };
  baseline: { passed: number; total: number };
  externalRequests: number;
  blockedRequests: number;
  staticOfflineScanHits: number;
  gateResult: "PASS" | "FAIL";
  gateFailureType: string | null;
  notes?: string[];
  verification?: AnalysisReport["verification"];
}

function countFrameLayers(locator: {
  framePath?: string[];
}): number {
  return Array.isArray(locator.framePath) ? locator.framePath.length : 0;
}

function computeCoverage(
  cases: ReportCase[],
  fixtures: ScenarioFixtureInput[],
): Coverage {
  const coverage: Coverage = {
    cssFixtures: 0,
    xpathFixtures: 0,
    roleFixtures: 0,
    framePathFixtures: 0,
    framePathCases: 0,
    indexFixtures: 0,
    indexCases: 0,
    twoLayerFramePathFixtures: 0,
  };
  const byId = new Map(fixtures.map((f) => [f.fixtureId, f]));
  for (const f of fixtures) {
    if (f.kind === "css") coverage.cssFixtures += 1;
    if (f.kind === "xpath") coverage.xpathFixtures += 1;
    if (f.kind === "role") coverage.roleFixtures += 1;
    const layers = countFrameLayers(f.locator);
    if (layers > 0) {
      coverage.framePathFixtures += 1;
      if (layers >= 2) coverage.twoLayerFramePathFixtures += 1;
    }
    // Raw manifest index: the normalised locator preserves a set index
    // (null when unset), mirroring the S0 gate's rule.
    if (f.locator.index !== null && f.locator.index !== undefined) {
      coverage.indexFixtures += 1;
    }
  }
  for (const c of cases) {
    const f = byId.get(c.fixtureId);
    if (!f) continue;
    const layers = countFrameLayers(f.locator);
    if (layers > 0) coverage.framePathCases += 1;
    if (f.locator.index !== null && f.locator.index !== undefined) {
      coverage.indexCases += 1;
    }
  }
  return coverage;
}

function emptyVerdictCounts(): VerdictCounts {
  return { STABLE: 0, WRONG_TARGET: 0, AMBIGUOUS: 0, MISSING: 0 };
}

function assertReportCase(c: ReportCase): void {
  if (typeof c.fixtureId !== "string" || c.fixtureId.length === 0) {
    throw new Error("ReportCase requires a non-empty fixtureId");
  }
  if (
    (c.verdict === null && c.analysisStatus !== "INCOMPLETE") ||
    (c.verdict !== null && c.analysisStatus !== "COMPLETE")
  ) {
    throw new Error(
      `ReportCase ${c.fixtureId}/${c.mutationId}: verdict null ⟺ analysisStatus INCOMPLETE violated`,
    );
  }
}

/**
 * Assemble a complete AnalysisReport from analysed cases, fixture
 * inputs and BFS summaries. Pure function: every count, score and hash
 * is computed from the inputs. Throws on contradictory inputs (bad
 * verdict/status pairing, unknown witness fixture, missing control
 * group / expected verdict) instead of guessing.
 */
export function buildAnalysisReport(
  input: BuildAnalysisReportInput,
): AnalysisReport {
  for (const c of input.cases) assertReportCase(c);
  const sortedCases = [...input.cases].sort((a, b) => {
    if (a.fixtureId !== b.fixtureId) return a.fixtureId < b.fixtureId ? -1 : 1;
    return a.mutationId < b.mutationId ? -1 : a.mutationId > b.mutationId ? 1 : 0;
  });
  const seen = new Set<string>();
  for (const c of sortedCases) {
    const key = `${c.fixtureId}/${c.mutationId}`;
    if (seen.has(key)) {
      throw new Error(`duplicate case ${key}`);
    }
    seen.add(key);
  }

  const fixtureIds = new Set(input.fixtures.map((f) => f.fixtureId));
  for (const c of sortedCases) {
    if (!fixtureIds.has(c.fixtureId)) {
      throw new Error(
        `case ${c.fixtureId}/${c.mutationId} has no fixture input for the scenario hash`,
      );
    }
  }
  for (const fixtureId of Object.keys(input.witnesses)) {
    if (!fixtureIds.has(fixtureId)) {
      throw new Error(
        `witness for unknown fixture ${fixtureId} (no fixture input)`,
      );
    }
  }

  // Verdict counts (overall + by locator kind).
  const verdictCounts = emptyVerdictCounts();
  const verdictCountsByKind: Record<string, VerdictCounts> = {};
  for (const c of sortedCases) {
    if (c.verdict !== null) {
      verdictCounts[c.verdict] += 1;
      const row =
        verdictCountsByKind[c.locatorKind] ?? (verdictCountsByKind[c.locatorKind] = emptyVerdictCounts());
      row[c.verdict] += 1;
    }
  }
  // Every kind present in the input gets a row, even if all its cases
  // are incomplete (counts stay 0); kinds absent stay absent.
  const completedCases = sortedCases.filter((c) => c.verdict !== null).length;
  const analysisStatus: AnalysisStatus =
    completedCases === sortedCases.length ? "COMPLETE" : "INCOMPLETE";

  // Scores + control metrics (T005, pure recomputation from cases).
  const scoreCases: ScoreCase[] = sortedCases.map((c) => ({
    fixtureId: c.fixtureId,
    mutationId: c.mutationId as ScoreCase["mutationId"],
    locatorKind: c.locatorKind,
    controlGroup: c.controlGroup,
    verdict: c.verdict,
    analysisStatus: c.analysisStatus,
    expectedVerdict: c.expectedVerdict,
  }));
  const scores = computeStabilityScores(scoreCases);
  const controls = computeControlMetrics(scoreCases);
  const coverage = computeCoverage(sortedCases, input.fixtures);

  // Canonical objects + four hashes (frozen builders for scenario /
  // oracle / gate; T008 builder for analysis with the real BFS map).
  const scenarioCanonical = buildScenarioCanonicalFromHashes(input.fixtures);
  const oracleInputs: OracleCaseInput[] = sortedCases.map((c) => ({
    fixtureId: c.fixtureId,
    mutationId: c.mutationId,
    verdict: c.verdict as Verdict | null,
    matchCount: c.matchCount,
    identityMatch: c.identityMatch,
    executionStatus: c.executionStatus,
  }));
  const oracleCanonical = buildOracleCanonicalFromHashes(oracleInputs);
  const analysisCanonical = buildAnalysisCanonicalT008({
    verdictCounts,
    verdictCountsByKind,
    stabilityScore: {
      stable: scores.overall.stable,
      completed: scores.overall.completed,
      score: scores.overall.score ?? "0",
    },
    coverage,
    controls: {
      stable: {
        pairs: controls.stable.pairs,
        mismatches: controls.stable.mismatched,
      },
      fragile: {
        pairs: controls.fragile.pairs,
        mismatches: controls.fragile.mismatched,
      },
    },
    analysisStatus,
    oracleParity: input.oracleParity,
    witnesses: input.witnesses,
  });
  const stableFixtures = input.fixtures.filter(
    (f) => f.controlGroup === "stable",
  ).length;
  const fragileFixtures = input.fixtures.filter(
    (f) => f.controlGroup === "fragile",
  ).length;
  const gateCountsInput: GateCountsInput = {
    fixtures: input.fixtures.length,
    stableFixtures,
    fragileFixtures,
    baselinePassed: input.baseline.passed,
    casesCompleted: completedCases,
    casesTotal: sortedCases.length,
    verdictCounts,
    verdictCountsByKind,
    controls: {
      stable: {
        pairs: controls.stable.pairs,
        mismatches: controls.stable.mismatched,
      },
      fragile: {
        pairs: controls.fragile.pairs,
        mismatches: controls.fragile.mismatched,
      },
    },
    oracleParity: input.oracleParity,
    stabilityScore: {
      stable: scores.overall.stable,
      completed: scores.overall.completed,
      score: scores.overall.score ?? "0",
    },
    coverage,
    externalRequests: input.externalRequests,
    blockedRequests: input.blockedRequests,
    staticOfflineScanHits: input.staticOfflineScanHits,
  };
  const gateCounts = buildGateCountsFromHashes(gateCountsInput);
  const scenario_sha256 = hashCanonical(scenarioCanonical);
  const oracle_result_sha256 = hashCanonical(oracleCanonical);
  const analysis_sha256 = hashCanonical(analysisCanonical);
  const gateCanonical = buildGateCanonicalFromHashes({
    result: input.gateResult,
    failureType: input.gateFailureType,
    counts: gateCounts,
    hashes: { scenario_sha256, oracle_result_sha256, analysis_sha256 },
  });
  const gate_sha256 = hashCanonical(gateCanonical);

  let found = 0;
  let boundedNoWitness = 0;
  let boundedIncomplete = 0;
  for (const w of Object.values(input.witnesses)) {
    if (w.status === "FOUND") found += 1;
    else if (w.status === "BOUNDED_NO_WITNESS") boundedNoWitness += 1;
    else boundedIncomplete += 1;
  }

  const notes: string[] = [
    "analysis_sha256 here is computed over schema locatorstress.analysis/v1 with the real per-fixture BFS witness map; it differs from the frozen S0 gate analysis hash (NOT_IMPLEMENTED_S0 placeholder) by design. The S0 gate hash and evidence/s0/S0_GATE.json are untouched.",
    "scenario_sha256 and oracle_result_sha256 reuse the frozen T006 builders and recompute identically to the S0 gate for the same 192-case input set.",
    "gate_sha256 here is computed over this report's analysis object, so it differs from the frozen S0 gate_sha256; it is this report's gate hash, not the S0 gate's.",
    "BOUNDED_INCOMPLETE means the search budget ran out with sequences still queued; it is never 'no witness', never 'no failure', never 'safe'. BOUNDED_NO_WITNESS means only that no failing sequence exists inside the searched space.",
    ...(input.notes ?? []),
  ];

  return {
    schema: SCHEMA_ANALYSIS_REPORT,
    seed: SEED,
    task: "T008",
    analysisStatus,
    expectedCases: sortedCases.length,
    completedCases,
    baseline: { ...input.baseline },
    verdictCounts,
    verdictCountsByKind,
    scores,
    controls,
    coverage,
    oracleParity: { ...input.oracleParity },
    witnesses: { ...input.witnesses },
    witnessCoverage: {
      searchedFixtures: Object.keys(input.witnesses).length,
      found,
      boundedNoWitness,
      boundedIncomplete,
    },
    cases: sortedCases,
    externalRequests: input.externalRequests,
    blockedRequests: input.blockedRequests,
    staticOfflineScanHits: input.staticOfflineScanHits,
    hashes: {
      scenario_sha256,
      oracle_result_sha256,
      analysis_sha256,
      gate_sha256,
    },
    canonical: {
      scenario: scenarioCanonical,
      oracle: oracleCanonical,
      analysis: analysisCanonical,
      gate: gateCanonical,
    },
    notes,
    verification: input.verification ?? null,
  };
}

/**
 * Recompute all four hashes of a report from its embedded canonical
 * objects and compare with the recorded hashes. Returns the recomputed
 * values plus a list of mismatches (empty when the report's hashes
 * recompute). Throws when the embedded canonical objects are missing.
 */
export function recomputeReportHashes(report: AnalysisReport): {
  recomputed: {
    scenario_sha256: string;
    oracle_result_sha256: string;
    analysis_sha256: string;
    gate_sha256: string;
  };
  errors: string[];
} {
  if (
    !report.canonical ||
    typeof report.canonical !== "object" ||
    !report.canonical.scenario ||
    !report.canonical.oracle ||
    !report.canonical.analysis ||
    !report.canonical.gate
  ) {
    throw new Error("report has no embedded canonical objects to recompute from");
  }
  const recomputed = {
    scenario_sha256: hashCanonical(report.canonical.scenario),
    oracle_result_sha256: hashCanonical(report.canonical.oracle),
    analysis_sha256: hashCanonical(report.canonical.analysis),
    gate_sha256: hashCanonical(report.canonical.gate),
  };
  const errors: string[] = [];
  for (const field of [
    "scenario_sha256",
    "oracle_result_sha256",
    "analysis_sha256",
    "gate_sha256",
  ] as const) {
    if (recomputed[field] !== report.hashes[field]) {
      errors.push(
        `hashes.${field} mismatch: recorded ${report.hashes[field]}, recomputed ${recomputed[field]}`,
      );
    }
  }
  return { recomputed, errors };
}
