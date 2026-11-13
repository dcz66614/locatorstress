// T006 — The four §6 hashes: scenario / oracle-result / analysis / gate
// (PROJECT_BOOK §6, §5.7, §12; IMPLEMENTATION_PLAN T006).
//
// Every constant and every input-object shape below is copied verbatim
// from the frozen S0 gate (scripts/s0-gate.ts): THRESHOLDS, NOTES, the
// seed, the BFS limits, the mutation suite, the four schema strings, and
// the exact field sets of the four canonical objects. The builders sort
// explicitly exactly where s0-gate sorted (fixtures by fixtureId; cases
// by fixtureId then mutationId); canonicalise() itself never reorders
// arrays (see canonical-json.ts header, conflict C1).
//
// Non-self-reference (§6 "不自指"): no canonical object contains its own
// hash. The gate object contains the three lower hashes but NOT
// gate_sha256; the gate report (schema locatorstress.s0-gate/v1 in
// evidence) additionally carries environment/replay/p2a, which are NOT
// part of the gate hash input.
//
// Forbidden fields (§6): builders take only explicit typed inputs — no
// wall clock, no createdAt, no UUID, no PID, no absolute path, no
// hostname/username, no CDP object id, no environment variable is ever
// read here. Environment versions belong in ENVIRONMENT_REPORT.md, never
// in a hashed object. See forbidden-scan.ts for the scanner.

import { normalizeLocatorSpec } from "../contracts/locator.js";
import type { LocatorSpecV1 } from "../contracts/locator.js";
import {
  canonicalJson,
  compareCodePoints,
  hashCanonical,
  sha256Hex,
} from "./canonical-json.js";

export const SEED = "P022-LOCATORSTRESS-S0-2026-11-10";

export const MUTATION_SUITE: readonly string[] = [
  "M01",
  "M02",
  "M03",
  "M04",
  "M05",
  "M06",
  "M07",
  "M08",
];

/** BFS limits frozen in the S0 scenario hash (§5.6 / §12.1). */
export const BFS_LIMITS = {
  max_depth: 6,
  max_expanded_states: 4096,
} as const;

/** S0 gate thresholds, verbatim from scripts/s0-gate.ts. */
export const S0_THRESHOLDS = {
  baselineRequired: 24,
  casesRequired: 192,
  plantedDetectionRequired: 96,
  stableFalseAlarmMaxNumerator: 1,
  stableFalseAlarmDenominator: 96,
  fourStateMin: 8,
  oracleParityRequired: 192,
  replayRuns: 100,
  uniqueGateHashesRequired: 1,
  externalRequestsMax: 0,
} as const;

/** S0 gate notes, verbatim from scripts/s0-gate.ts (order matters: the
 *  gate hash is computed over this array in this order). */
export const S0_GATE_NOTES: readonly string[] = [
  "M08 freeze: all T002 fixtures do NOT sync aria-label on M08 CHANGE_TEXT; this is the frozen S0 decision.",
  "Oracle parity matchCount expected values are the frozen per-case finalMatchCount values from evidence/s0/T002_MUTATION_REPORT.json, validated 192/192 against golden verdicts; verdict, identityMatch and executionStatus expectations are derived from the golden verdict itself.",
  "BFS witness: NOT_IMPLEMENTED_S0 (T007, S2); placeholder in analysis hash.",
];

export const SCHEMA_SCENARIO = "locatorstress.scenario-canonical/v1";
export const SCHEMA_ORACLE = "locatorstress.oracle-canonical/v1";
export const SCHEMA_ANALYSIS = "locatorstress.analysis-canonical/v1";
export const SCHEMA_GATE = "locatorstress.s0-gate/v1";

/** Mirrors the T004 Verdict union; kept local so canonical stays a leaf
 *  module with no runtime dependency on the verdict classifier. */
export type CanonicalVerdict =
  | "STABLE"
  | "WRONG_TARGET"
  | "AMBIGUOUS"
  | "MISSING";

export type AnalysisStatus = "COMPLETE" | "INCOMPLETE";

export interface VerdictCounts {
  STABLE: number;
  WRONG_TARGET: number;
  AMBIGUOUS: number;
  MISSING: number;
}

export interface Coverage {
  cssFixtures: number;
  xpathFixtures: number;
  roleFixtures: number;
  framePathFixtures: number;
  framePathCases: number;
  indexFixtures: number;
  indexCases: number;
  twoLayerFramePathFixtures: number;
}

export interface ScenarioFixtureInput {
  fixtureId: string;
  family: string;
  kind: string;
  controlGroup: string;
  locator: LocatorSpecV1;
  html: string;
}

export interface OracleCaseInput {
  fixtureId: string;
  mutationId: string;
  /** Null when no verdict may be claimed (execution not COMPLETED etc.). */
  verdict: CanonicalVerdict | null;
  matchCount: number;
  identityMatch: boolean | null;
  executionStatus: string;
}

export interface StabilityScoreInput {
  stable: number;
  completed: number;
  /** Exact decimal string, e.g. "71.875" — never a float (§6). */
  score: string;
}

export interface ControlsInput {
  stable: { pairs: number; mismatches: number };
  fragile: { pairs: number; mismatches: number };
}

export interface OracleParityInput {
  compared: number;
  matched: number;
  mismatched: number;
}

export interface AnalysisInput {
  verdictCounts: VerdictCounts;
  verdictCountsByKind: Record<string, VerdictCounts>;
  stabilityScore: StabilityScoreInput;
  coverage: Coverage;
  controls: ControlsInput;
  analysisStatus: AnalysisStatus;
  oracleParity: OracleParityInput;
}

export interface GateCountsInput {
  fixtures: number;
  stableFixtures: number;
  fragileFixtures: number;
  baselinePassed: number;
  casesCompleted: number;
  casesTotal: number;
  verdictCounts: VerdictCounts;
  verdictCountsByKind: Record<string, VerdictCounts>;
  controls: ControlsInput;
  oracleParity: OracleParityInput;
  stabilityScore: StabilityScoreInput;
  coverage: Coverage;
  externalRequests: number;
  blockedRequests: number;
  staticOfflineScanHits: number;
}

export interface ThreeHashes {
  scenario_sha256: string;
  oracle_result_sha256: string;
  analysis_sha256: string;
}

export interface GateInput {
  result: "PASS" | "FAIL";
  failureType: string | null;
  counts: unknown;
  hashes: ThreeHashes;
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, got ${String(value)}`);
  }
}

function assertVerdictCounts(name: string, counts: VerdictCounts): void {
  assertNonNegativeInteger(`${name}.STABLE`, counts.STABLE);
  assertNonNegativeInteger(`${name}.WRONG_TARGET`, counts.WRONG_TARGET);
  assertNonNegativeInteger(`${name}.AMBIGUOUS`, counts.AMBIGUOUS);
  assertNonNegativeInteger(`${name}.MISSING`, counts.MISSING);
}

/**
 * Scenario canonical object (§6): HTML, LocatorSpec, seed, mutation
 * suite, BFS limits. Fixtures are sorted by fixtureId (§5.7); each
 * locator is normalised with normalizeLocatorSpec exactly as s0-gate
 * did (which always emits exact/includeHidden/framePath/index).
 * Private manifest fields (privateTargetPath, captureMode, m03Token,
 * shadowHost) are NOT part of the scenario hash.
 */
export function buildScenarioCanonical(
  fixtures: readonly ScenarioFixtureInput[],
): Record<string, unknown> {
  const sorted = [...fixtures]
    .sort((a, b) => compareCodePoints(a.fixtureId, b.fixtureId))
    .map((m) => {
      if (typeof m.fixtureId !== "string" || m.fixtureId.length === 0) {
        throw new Error("scenario fixture requires a non-empty fixtureId");
      }
      if (typeof m.html !== "string") {
        throw new Error(`scenario fixture ${m.fixtureId} requires html as a string`);
      }
      return {
        fixtureId: m.fixtureId,
        family: m.family,
        kind: m.kind,
        controlGroup: m.controlGroup,
        locator: normalizeLocatorSpec(m.locator),
        html: m.html,
      };
    });
  return {
    schema: SCHEMA_SCENARIO,
    seed: SEED,
    bfs: { max_depth: BFS_LIMITS.max_depth, max_expanded_states: BFS_LIMITS.max_expanded_states },
    mutationSuite: [...MUTATION_SUITE],
    fixtures: sorted,
  };
}

/**
 * Oracle canonical object (§6): the independent Oracle's normalised
 * per-case results, sorted by fixtureId then mutationId (§5.7).
 * Field names match s0-gate exactly: verdict / matchCount (from
 * finalMatchCount) / identityMatch / executionStatus.
 */
export function buildOracleCanonical(
  cases: readonly OracleCaseInput[],
): Record<string, unknown> {
  const sorted = [...cases]
    .sort((a, b) => {
      const c = compareCodePoints(a.fixtureId, b.fixtureId);
      if (c !== 0) return c;
      return compareCodePoints(a.mutationId, b.mutationId);
    })
    .map((c) => {
      assertNonNegativeInteger("matchCount", c.matchCount);
      return {
        fixtureId: c.fixtureId,
        mutationId: c.mutationId,
        verdict: c.verdict,
        matchCount: c.matchCount,
        identityMatch: c.identityMatch,
        executionStatus: c.executionStatus,
      };
    });
  return {
    schema: SCHEMA_ORACLE,
    seed: SEED,
    cases: sorted,
  };
}

/**
 * Analysis canonical object (§6): verdict counts, score (decimal
 * string), coverage, BFS witness, analysis status. The BFS witness is
 * the frozen S0 placeholder (NOT_IMPLEMENTED_S0, T007/S2); it is a
 * fixed literal, not a live search result, so it cannot leak timing.
 */
export function buildAnalysisCanonical(
  input: AnalysisInput,
): Record<string, unknown> {
  assertVerdictCounts("verdictCounts", input.verdictCounts);
  for (const [kind, counts] of Object.entries(input.verdictCountsByKind)) {
    assertVerdictCounts(`verdictCountsByKind.${kind}`, counts);
  }
  assertNonNegativeInteger("stabilityScore.stable", input.stabilityScore.stable);
  assertNonNegativeInteger("stabilityScore.completed", input.stabilityScore.completed);
  if (typeof input.stabilityScore.score !== "string") {
    throw new Error("stabilityScore.score must be an exact decimal string, not a number");
  }
  return {
    schema: SCHEMA_ANALYSIS,
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
    bfs: { status: "NOT_IMPLEMENTED_S0", witness: null },
    oracleParity: {
      compared: input.oracleParity.compared,
      matched: input.oracleParity.matched,
      mismatched: input.oracleParity.mismatched,
    },
  };
}

/**
 * Gate counts object, mirroring scripts/s0-gate.ts buildCounts exactly,
 * including the "mismatches/pairs" falseAlarm string and the fragile
 * `detected = pairs - mismatches` field. This is the `counts` member of
 * the gate canonical object (and of the S0 gate report).
 */
export function buildGateCounts(input: GateCountsInput): Record<string, unknown> {
  return {
    fixtures: input.fixtures,
    baselinePassed: input.baselinePassed,
    casesCompleted: input.casesCompleted,
    casesTotal: input.casesTotal,
    verdictCounts: input.verdictCounts,
    verdictCountsByKind: input.verdictCountsByKind,
    stableControl: {
      fixtures: input.stableFixtures,
      pairs: input.controls.stable.pairs,
      mismatches: input.controls.stable.mismatches,
      falseAlarm: `${input.controls.stable.mismatches}/${input.controls.stable.pairs}`,
    },
    fragileControl: {
      fixtures: input.fragileFixtures,
      pairs: input.controls.fragile.pairs,
      mismatches: input.controls.fragile.mismatches,
      detected: input.controls.fragile.pairs - input.controls.fragile.mismatches,
    },
    oracleParity: {
      compared: input.oracleParity.compared,
      matched: input.oracleParity.matched,
      mismatched: input.oracleParity.mismatched,
    },
    stabilityScore: {
      stable: input.stabilityScore.stable,
      completed: input.stabilityScore.completed,
      score: input.stabilityScore.score,
    },
    coverage: input.coverage,
    externalRequests: input.externalRequests,
    blockedRequests: input.blockedRequests,
    staticOfflineScanHits: input.staticOfflineScanHits,
  };
}

/**
 * Gate canonical object (§6): the S0 gate report in canonical form,
 * containing the three lower hashes, counts, thresholds and result.
 * It deliberately does NOT contain gate_sha256 itself (no self
 * reference), and does NOT contain environment / replay / p2a — those
 * live only in the outer gate report, outside the hashed bytes.
 */
export function buildGateCanonical(input: GateInput): Record<string, unknown> {
  return {
    schema: SCHEMA_GATE,
    seed: SEED,
    result: input.result,
    failureType: input.failureType,
    thresholds: { ...S0_THRESHOLDS },
    counts: input.counts,
    hashes: input.hashes,
    notes: [...S0_GATE_NOTES],
  };
}

/** scenario_sha256: SHA-256 of the canonical scenario bytes. */
export function scenarioSha256(
  fixtures: readonly ScenarioFixtureInput[],
): string {
  return hashCanonical(buildScenarioCanonical(fixtures));
}

/** oracle_result_sha256: SHA-256 of the canonical oracle bytes. */
export function oracleResultSha256(
  cases: readonly OracleCaseInput[],
): string {
  return hashCanonical(buildOracleCanonical(cases));
}

/** analysis_sha256: SHA-256 of the canonical analysis bytes. */
export function analysisSha256(input: AnalysisInput): string {
  return hashCanonical(buildAnalysisCanonical(input));
}

/** gate_sha256: SHA-256 of the canonical gate bytes. */
export function gateSha256(input: GateInput): string {
  return hashCanonical(buildGateCanonical(input));
}

/**
 * All four hashes at once from already-built canonical objects. The
 * gate object is built from the three lower hashes (never from a gate
 * hash), so the result cannot be self-referential by construction.
 */
export function computeFourHashes(input: {
  scenario: Record<string, unknown>;
  oracle: Record<string, unknown>;
  analysis: Record<string, unknown>;
  gateResult: "PASS" | "FAIL";
  gateFailureType: string | null;
  gateCounts: unknown;
}): {
  scenario_sha256: string;
  oracle_result_sha256: string;
  analysis_sha256: string;
  gate_sha256: string;
} {
  const scenario_sha256 = hashCanonical(input.scenario);
  const oracle_result_sha256 = hashCanonical(input.oracle);
  const analysis_sha256 = hashCanonical(input.analysis);
  const gate_sha256 = hashCanonical(
    buildGateCanonical({
      result: input.gateResult,
      failureType: input.gateFailureType,
      counts: input.gateCounts,
      hashes: { scenario_sha256, oracle_result_sha256, analysis_sha256 },
    }),
  );
  return { scenario_sha256, oracle_result_sha256, analysis_sha256, gate_sha256 };
}

export { canonicalJson, sha256Hex };
