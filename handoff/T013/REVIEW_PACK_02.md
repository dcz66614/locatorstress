# REVIEW_PACK_02 — Canonical JSON、四个 Hash、稳定性分数与四态分类

审查 commit：`a78d765`。本包为审查时原文逐字拼接（机械拼接，内容未经改写），每个文件附行数、字节数与 SHA-256；审查结论见 `INDEPENDENT_REVIEW.md`。

## src/canonical/canonical-json.ts

- 行数：127；字节数：5868；SHA-256：`8e1d72f31c59c3fc28ffdf08c2d55b86fab57b783defa2e44e2fd047b4914b06`

```ts
// T006 — Canonical JSON (PROJECT_BOOK §6; IMPLEMENTATION_PLAN T006).
//
// This is the production canonicaliser. It reproduces, byte for byte, the
// canonicalisation that the frozen S0 gate already performed in
// scripts/s0-gate.ts (canonicalize / canonicalJson / sha256Hex) and
// scripts/repeat-hash.ts (serialize), so that the four frozen S0 hashes
// recompute exactly. DO NOT "improve" the serialisation shape here: any
// change to key order, string normalisation, number rendering or array
// handling changes every downstream hash.
//
// Frozen behaviour reproduced exactly:
//   - UTF-8 bytes of the JSON text are hashed (sha256Hex updates "utf8").
//   - Strings (values AND object keys) are Unicode NFC normalised.
//   - Object keys are sorted by Unicode code point (NOT by UTF-16 code
//     unit, which is what JS default sort does; astral-plane keys sort
//     after the whole BMP, not among the surrogates).
//   - Arrays keep their order. §6 says "数组稳定排序" but the frozen
//     implementation does NOT sort arrays inside canonicalise(): ordering
//     is imposed explicitly by the builders in hashes.ts (fixtures by
//     fixtureId, cases by fixtureId/mutationId, §5.7 fixed order).
//     Sorting arrays generically here would CHANGE the frozen gate hash
//     (the gate NOTES array is not in sorted order), so arrays are
//     preserved. See T006_HASH_REPORT.json conflict C1 (P1, coordinator
//     to adjudicate); on this point the module follows the frozen
//     implementation, per the T006 brief (reproduce frozen hash first).
//   - Numbers are rendered by JSON.stringify, exactly as s0-gate does.
//     §6 says numbers should be integers or explicit decimal strings;
//     that rule is enforced by the builders' types (counts are validated
//     integers, scores are decimal strings), not by rejecting floats
//     here, because s0-gate accepts any finite number. See conflict C2.
//   - No trailing newline: canonicalJson returns the bare JSON text.
//     Evidence files append a single LF when writing; the LF is not
//     part of the hashed bytes.
//
// Deliberate strictness where the two frozen scripts disagree (no frozen
// input ever triggers these paths, so no frozen hash is affected):
//   - Non-finite numbers (NaN/Infinity): s0-gate silently coerces them
//     to null via JSON.stringify; repeat-hash throws. This module throws
//     (repeat-hash side). See conflict C3.
//   - undefined / function / symbol / bigint values: s0-gate passes them
//     through and lets JSON.stringify drop or null them; repeat-hash
//     throws. This module throws (repeat-hash side). See conflict C4.
//   - Object keys that collide after NFC normalisation: s0-gate dedupes
//     (last in sorted order wins, because it builds a plain object);
//     repeat-hash emits duplicate keys. This module follows s0-gate.
//     See conflict C5.
//   - A Date or other class instance is treated as a plain object via
//     Object.keys, exactly as both frozen scripts do (a Date hashes as
//     "{}"). Callers must pass plain JSON values; canonical inputs are
//     never Dates, PIDs, or live objects.

import { createHash } from "node:crypto";

/** Compare two strings by Unicode code point (not UTF-16 code unit). */
export function compareCodePoints(a: string, b: string): number {
  const aa = Array.from(a);
  const bb = Array.from(b);
  const n = Math.min(aa.length, bb.length);
  for (let i = 0; i < n; i++) {
    const ca = aa[i].codePointAt(0)!;
    const cb = bb[i].codePointAt(0)!;
    if (ca !== cb) return ca < cb ? -1 : 1;
  }
  return aa.length - bb.length;
}

/**
 * Canonicalise a plain JSON value: NFC-normalise strings and keys, sort
 * object keys by code point, preserve array order. Throws on values that
 * are not JSON values (non-finite numbers, undefined, functions, symbols,
 * bigints) instead of silently dropping or nulling them.
 */
export function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "string") return value.normalize("NFC");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("non-finite number in canonical JSON");
    }
    return value;
  }
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => canonicalize(v));
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort(compareCodePoints);
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      out[k.normalize("NFC")] = canonicalize(obj[k]);
    }
    return out;
  }
  throw new Error(`unsupported value in canonical JSON: ${typeof value}`);
}

/**
 * Canonical JSON text: JSON.stringify of the canonicalised value, no
 * spaces, no trailing newline, LF only (there are no line breaks at all
 * in the output; a file writer may append one LF, which is not hashed).
 */
export function canonicalJson(value: unknown): string {
  const text = JSON.stringify(canonicalize(value));
  if (text === undefined) {
    throw new Error("canonical JSON is undefined for this input");
  }
  return text;
}

/** UTF-8 bytes of the canonical JSON text (exactly the hashed bytes). */
export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}

/** Lowercase hex SHA-256 of a UTF-8 string. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Lowercase hex SHA-256 of raw bytes. */
export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** SHA-256 of the canonical JSON bytes of a value (the §6 hash). */
export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
```

## src/canonical/hashes.ts

- 行数：437；字节数：14556；SHA-256：`bf567d61077d66661f714788dd146b9471f736f9c2b0cbf9f3f507e4ba23f17b`

```ts
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
```

## src/canonical/forbidden-scan.ts

- 行数：220；字节数：6849；SHA-256：`bba33d771c40a290690b9650868174b316153245a4c784bdc8d713d7f1f36f49`

```ts
// T006 — Forbidden-field scan for canonical bytes (PROJECT_BOOK §6).
//
// Canonical results must not contain: wall-clock time, createdAt,
// random UUIDs, PIDs, machine absolute paths, usernames, hostnames, CDP
// temporary object IDs, environment variable values, or real personal
// data. This scanner checks the actual canonical bytes against an
// explicit, listed rule set; every rule is a real test on the bytes, and
// the rule list itself is asserted non-empty by the tests (no silent
// "scan" that checks nothing).
//
// Deliberate limits (see T006_HASH_REPORT.json limitations):
//   - Environment variable VALUES cannot be scanned without knowing
//     them. They are excluded structurally instead: no builder in
//     src/canonical/ reads process.env, and the literal values that
//     would leak (repo root, $HOME, tmpdir, hostname) are scanned.
//   - The username is only matched in a path/identifier context
//     ("/root/", "root@", '"root":' ...), never as a bare substring:
//     the frozen fixtures legitimately contain the word "root" inside
//     "shadowrootmode" (F022–F024), and a bare-substring rule would
//     false-positive on frozen data. The current user ("root") is
//     therefore only flagged when it appears as a path component or
//     identifier, which is how a leaked username would actually look.
//   - The fixed seed contains the date "2026-11-10" (no time). The
//     wall-clock rule requires a time component, so the seed does not
//     trip it; a date alone is not a wall clock.
//   - A generic "any absolute Unix path" rule is NOT included: fixture
//     HTML legitimately contains "/" (tags, XPath, URLs in selectors),
//     so such a rule would false-positive. Absolute paths are covered
//     by the exact literals that could leak (repoRoot, homeDir, tmpDir)
//     plus the Windows drive-letter rule.

import { hostname, tmpdir, userInfo } from "node:os";

export interface ForbiddenScanContext {
  /** Repo root, e.g. /home/hatch/workspace/p022-locatorstress. */
  repoRoot: string;
  /** $HOME, e.g. /home/hatch. */
  homeDir: string;
  /** os.tmpdir(), defaults to the live value. */
  tmpDir: string;
  /** os.hostname(), defaults to the live value. */
  hostname: string;
  /** os.userInfo().username, defaults to the live value. */
  username: string;
}

export function defaultForbiddenScanContext(
  repoRoot: string,
  homeDir: string,
): ForbiddenScanContext {
  let username = "";
  try {
    username = userInfo().username;
  } catch {
    username = "";
  }
  return {
    repoRoot,
    homeDir,
    tmpDir: tmpdir(),
    hostname: hostname(),
    username,
  };
}

export interface ForbiddenScanRule {
  id: string;
  description: string;
  /** All matching excerpts (each truncated to 40 chars). */
  find: (text: string) => string[];
}

export interface ForbiddenScanHit {
  ruleId: string;
  count: number;
  /** First match excerpt (truncated), or null when there is no hit. */
  sample: string | null;
}

export interface ForbiddenScanResult {
  /** Rule ids that were run, in order. */
  rulesRun: string[];
  hits: ForbiddenScanHit[];
  totalHits: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function regexRule(
  id: string,
  description: string,
  pattern: RegExp,
): ForbiddenScanRule {
  return {
    id,
    description,
    find: (text: string) => {
      const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
      const out: string[] = [];
      for (const m of text.matchAll(re)) {
        out.push(m[0].slice(0, 40));
        if (out.length >= 5) break;
      }
      return out;
    },
  };
}

function literalRule(
  id: string,
  description: string,
  literals: string[],
): ForbiddenScanRule {
  const needles = literals.filter((s) => s.length > 0);
  return {
    id,
    description,
    find: (text: string) => {
      const out: string[] = [];
      for (const n of needles) {
        if (text.includes(n)) out.push(n.slice(0, 40));
      }
      return out;
    },
  };
}

/** The full rule set. Every id below is listed in the T006 report. */
export function buildForbiddenScanRules(
  ctx: ForbiddenScanContext,
): ForbiddenScanRule[] {
  const rules: ForbiddenScanRule[] = [
    regexRule(
      "created-at",
      "Literal createdAt / created_at keys (wall-clock metadata)",
      /createdAt|created_at/,
    ),
    regexRule(
      "wall-clock-iso",
      "ISO-8601 timestamp with a time component (YYYY-MM-DDTHH:MM...); a bare date such as the fixed seed does not match",
      /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?/,
    ),
    regexRule(
      "epoch-millis",
      "13-digit millisecond epoch timestamp starting 16/17",
      /\b1[67]\d{11}\b/,
    ),
    regexRule(
      "uuid",
      "UUID (8-4-4-4-12 hex, either case)",
      /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/,
    ),
    regexRule(
      "cdp-object-id",
      "CDP temporary object id keys (objectId / remoteObjectId)",
      /objectId\s*["':=]|remoteObjectId/,
    ),
    regexRule(
      "cdp-dotted-id",
      "CDP-style dotted numeric id (≥6 digits . digits . digits)",
      /\b\d{6,}\.\d+\.\d+\b/,
    ),
    regexRule(
      "pid",
      "Process id (JSON \"pid\": key, pid:/pid=, processId, process.pid)",
      /"pid"\s*:\s*\d+|\bpid\s*[:=]\s*\d+|\bprocessId\b|process\.pid/i,
    ),
    regexRule(
      "windows-absolute-path",
      "Windows absolute path (drive letter + backslash)",
      /[A-Za-z]:\\[\w.-]+/,
    ),
    literalRule(
      "absolute-path-literal",
      "Machine absolute path literals: repo root, $HOME, tmpdir",
      [ctx.repoRoot, ctx.homeDir, ctx.tmpDir],
    ),
    literalRule(
      "hostname-literal",
      "Machine hostname literal",
      [ctx.hostname],
    ),
  ];
  if (ctx.username.length > 0) {
    rules.push(
      regexRule(
        "username-in-path",
        "Username as a path component or identifier (not a bare substring; fixture HTML contains 'shadowrootmode')",
        new RegExp(
          `(^|[/\\\\@"':=])${escapeRegExp(ctx.username)}([/\\\\@"':]|$)`,
        ),
      ),
    );
  }
  return rules;
}

/** Scan canonical JSON text (or any text) against every rule. */
export function scanForbiddenFields(
  text: string,
  ctx: ForbiddenScanContext,
): ForbiddenScanResult {
  const rules = buildForbiddenScanRules(ctx);
  const hits: ForbiddenScanHit[] = [];
  let totalHits = 0;
  for (const rule of rules) {
    const matches = rule.find(text);
    if (matches.length > 0) {
      totalHits += matches.length;
      hits.push({
        ruleId: rule.id,
        count: matches.length,
        sample: matches[0] ?? null,
      });
    }
  }
  return { rulesRun: rules.map((r) => r.id), hits, totalHits };
}
```

## src/canonical/index.ts

- 行数：57；字节数：1133；SHA-256：`83b849ee9e11c827ced176c14a8166cb9074078060da805ee8d603e5632db3e0`

```ts
// T006 — Canonical JSON + four SHA-256 hashes (PROJECT_BOOK §6).
export {
  compareCodePoints,
  canonicalize,
  canonicalJson,
  canonicalBytes,
  sha256Hex,
  sha256Bytes,
  hashCanonical,
} from "./canonical-json.js";
export {
  SEED,
  MUTATION_SUITE,
  BFS_LIMITS,
  S0_THRESHOLDS,
  S0_GATE_NOTES,
  SCHEMA_SCENARIO,
  SCHEMA_ORACLE,
  SCHEMA_ANALYSIS,
  SCHEMA_GATE,
  buildScenarioCanonical,
  buildOracleCanonical,
  buildAnalysisCanonical,
  buildGateCounts,
  buildGateCanonical,
  scenarioSha256,
  oracleResultSha256,
  analysisSha256,
  gateSha256,
  computeFourHashes,
} from "./hashes.js";
export type {
  CanonicalVerdict,
  AnalysisStatus,
  VerdictCounts,
  Coverage,
  ScenarioFixtureInput,
  OracleCaseInput,
  StabilityScoreInput,
  ControlsInput,
  OracleParityInput,
  AnalysisInput,
  GateCountsInput,
  ThreeHashes,
  GateInput,
} from "./hashes.js";
export {
  defaultForbiddenScanContext,
  buildForbiddenScanRules,
  scanForbiddenFields,
} from "./forbidden-scan.js";
export type {
  ForbiddenScanContext,
  ForbiddenScanRule,
  ForbiddenScanHit,
  ForbiddenScanResult,
} from "./forbidden-scan.js";
```

## src/canonical/node-shims.d.ts

- 行数：20；字节数：816；SHA-256：`aa06b9e9ac71c1e7f1580ec7ad46481fe95611b19d8e130edcaf8c04f4bac8ee`

```ts
// Minimal ambient declarations for the Node.js built-ins used by the
// canonical module only. The project has no @types/node dependency (by
// design: no new dependencies), and src/node-builtins.d.ts is shared
// infrastructure that this task must not modify — so the canonical
// module carries its own declarations, covering exactly the API surface
// it uses. Kept in src/canonical/ so the module stays self-contained.
declare module "node:crypto" {
  interface Hash {
    update(data: string, encoding: string): Hash;
    update(data: Uint8Array): Hash;
    digest(encoding: "hex"): string;
  }
  export function createHash(algorithm: string): Hash;
}

declare module "node:os" {
  export function hostname(): string;
  export function tmpdir(): string;
  export function userInfo(): { username: string };
}
```

## src/score/stability-score.ts

- 行数：480；字节数：16448；SHA-256：`de82b8a342a40dc76e561f14d34421f22d94be661c90d5b1f0d7f3a39f9670b2`

```ts
// T005 — Stability score and control-group metrics
// (PROJECT_BOOK §5.5 stability score, §5.3 four states;
// IMPLEMENTATION_PLAN T005).
//
// Formula, verbatim from §5.5:
//   stability_score = 100 × stable_case_count / completed_mutation_case_count
//
// Rules enforced here (all recomputable from the per-case input):
//   - The denominator counts ONLY completed cases, i.e. cases with a
//     verdict (analysisStatus COMPLETE). Incomplete cases (verdict null,
//     analysisStatus INCOMPLETE) never count as STABLE and never enter
//     the denominator.
//   - Incomplete cases DO lower coverage: coverage = completed / expected.
//   - A group with any incomplete case has analysisStatus INCOMPLETE.
//   - WRONG_TARGET / AMBIGUOUS / MISSING are counted separately.
//   - The score is a proportion over the synthetic mutation set, NOT a
//     production failure probability; every row therefore also shows
//     completed / expected so a high score cannot hide low coverage.
//   - Scores are reported as exact integer numerator/denominator pairs
//     plus a decimal string. The decimal string is 100 × numerator /
//     denominator rounded half-up to 3 decimal places, computed with
//     exact BigInt arithmetic (no binary floating point anywhere in the
//     rounding path). When the denominator is 0 the score is null.
//   - Nothing in this module is hardcoded to the 192-case S0 set: every
//     number is counted from the cases passed in. The known S0 totals
//     (overall 138/192, css 46/64, xpath 42/64, role 50/64) are test
//     oracles only; they do not appear in this file.
//
// Control-group metrics (S0 frozen definitions, scripts/s0-gate.ts
// stage "controls" and evidence/s0/S0_GATE.json):
//   - A case "matches" when its actual verdict equals the golden
//     expected verdict. An incomplete case (verdict null) never matches.
//   - Stable group false-alarm rate = mismatches / pairs, where
//     mismatches = pairs − matched (PROJECT_BOOK §12.2).
//   - Fragile group detection rate = matched / pairs, i.e. the S0 gate's
//     `detected = pairs − mismatches`. This is agreement with golden,
//     NOT a count of planted failures: a fragile fixture may legitimately
//     expect STABLE for some mutations. The planted-failure subset
//     (expected verdict != STABLE) is therefore ALSO reported separately
//     as plantedDetected / plantedExpected, so the two readings cannot
//     be confused.
//   - computeControlMetrics requires every case to carry both a
//     controlGroup and an expectedVerdict; anything missing throws
//     instead of silently guessing.

import type { AnalysisStatus, Verdict } from "../verdict/classify.js";

export type LocatorKind = "css" | "xpath" | "role";
export type ControlGroup = "stable" | "fragile";
export type MutationId =
  | "M01"
  | "M02"
  | "M03"
  | "M04"
  | "M05"
  | "M06"
  | "M07"
  | "M08";

export const LOCATOR_KINDS: readonly LocatorKind[] = ["css", "xpath", "role"];
export const MUTATION_IDS: readonly MutationId[] = [
  "M01",
  "M02",
  "M03",
  "M04",
  "M05",
  "M06",
  "M07",
  "M08",
];

/**
 * One scored mutation case. This is the score module's only input shape:
 * the verdict (or null) and analysisStatus come from classifyVerdict
 * (T004); locatorKind / controlGroup come from the fixture manifest;
 * expectedVerdict comes from the frozen golden matrix and is only needed
 * for control-group metrics.
 */
export interface ScoreCase {
  fixtureId: string;
  mutationId: MutationId;
  locatorKind: LocatorKind;
  /** Control group of the fixture; required for control metrics. */
  controlGroup?: ControlGroup;
  /** Four-state verdict, or null when the case is incomplete. */
  verdict: Verdict | null;
  /** COMPLETE iff a verdict was produced; INCOMPLETE otherwise. */
  analysisStatus: AnalysisStatus;
  /** Golden expected verdict; required for control metrics. */
  expectedVerdict?: Verdict;
}

/** One recomputable score row (overall, per-locator, or per-operator). */
export interface ScoreRow {
  key: string;
  /** Cases with verdict STABLE. Also the score numerator. */
  stable: number;
  wrongTarget: number;
  ambiguous: number;
  missing: number;
  /** Cases with no verdict (verdict null, analysisStatus INCOMPLETE). */
  incomplete: number;
  /** Completed cases (have a verdict). Also the score denominator. */
  completed: number;
  /** All cases in the group, completed + incomplete. */
  expected: number;
  /** Score numerator: stable_case_count. */
  scoreNumerator: number;
  /** Score denominator: completed_mutation_case_count. */
  scoreDenominator: number;
  /**
   * stability_score as a decimal string (100 × stable / completed,
   * half-up to 3 decimal places, trailing zeros trimmed), or null when
   * completed is 0. Exact recomputation must use scoreNumerator /
   * scoreDenominator, never this string.
   */
  score: string | null;
  /** Coverage numerator: completed. */
  coverageNumerator: number;
  /** Coverage denominator: expected. */
  coverageDenominator: number;
  /**
   * Coverage as a percent string (100 × completed / expected, half-up
   * to 3 decimal places), or null when expected is 0.
   */
  coverage: string | null;
  /** COMPLETE iff incomplete is 0, else INCOMPLETE. */
  analysisStatus: AnalysisStatus;
}

export interface StabilityScores {
  overall: ScoreRow;
  perLocator: Record<LocatorKind, ScoreRow>;
  /** Only operators present in the input, in M01–M08 order. */
  perOperator: Partial<Record<MutationId, ScoreRow>>;
}

/** One control group's recomputable metrics. */
export interface ControlGroupMetrics {
  group: ControlGroup;
  /** Distinct fixtures contributing cases to this group. */
  fixtures: number;
  /** Expected pairs (denominator for both rates). */
  pairs: number;
  completed: number;
  incomplete: number;
  /** Cases whose actual verdict equals the golden expected verdict. */
  matched: number;
  /** pairs − matched (includes incomplete cases, which never match). */
  mismatched: number;
  /** Stable group: false alarms (= mismatched). */
  falseAlarms: number;
  /** 100 × mismatched / pairs, 3-dp string; null when pairs is 0. */
  falseAlarmRate: string | null;
  /** "mismatched/pairs", e.g. "0/96". */
  falseAlarmFraction: string;
  /** Fragile group: detected (= matched). */
  detected: number;
  /** 100 × matched / pairs, 3-dp string; null when pairs is 0. */
  detectionRate: string | null;
  /** "matched/pairs", e.g. "96/96". */
  detectionFraction: string;
  /** Cases whose golden expected verdict is not STABLE. */
  plantedExpected: number;
  /** Of those, cases whose actual verdict equals the golden verdict. */
  plantedDetected: number;
  /** 100 × plantedDetected / plantedExpected, 3-dp string; null when 0. */
  plantedDetectionRate: string | null;
  /** "plantedDetected/plantedExpected", e.g. "45/45". */
  plantedDetectionFraction: string;
  /** COMPLETE iff incomplete is 0, else INCOMPLETE. */
  analysisStatus: AnalysisStatus;
}

export interface ControlMetrics {
  stable: ControlGroupMetrics;
  fragile: ControlGroupMetrics;
}

const VERDICTS: readonly Verdict[] = [
  "STABLE",
  "WRONG_TARGET",
  "AMBIGUOUS",
  "MISSING",
];

function isLocatorKind(value: string): value is LocatorKind {
  return (LOCATOR_KINDS as readonly string[]).includes(value);
}

function isMutationId(value: string): value is MutationId {
  return (MUTATION_IDS as readonly string[]).includes(value);
}

function isControlGroup(value: string): value is ControlGroup {
  return value === "stable" || value === "fragile";
}

function isVerdict(value: unknown): value is Verdict {
  return (
    typeof value === "string" &&
    (VERDICTS as readonly string[]).includes(value)
  );
}

/**
 * Format 100 × numerator / denominator as a decimal string, rounded
 * half-up to 3 decimal places with trailing zeros trimmed ("71.875",
 * "87.5", "100"). Exact BigInt arithmetic: no floating point is used.
 * Returns null when denominator is 0.
 */
export function formatPercent(numerator: number, denominator: number): string | null {
  if (denominator === 0) {
    return null;
  }
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator)) {
    throw new Error(
      `formatPercent requires integers: numerator=${String(numerator)}, denominator=${String(denominator)}`,
    );
  }
  if (numerator < 0 || denominator < 0) {
    throw new Error(
      `formatPercent requires non-negative integers: numerator=${String(numerator)}, denominator=${String(denominator)}`,
    );
  }
  // scaled = round_half_up(100 * numerator / denominator * 1000)
  //        = floor((2 * 100000 * numerator + denominator) / (2 * denominator))
  const scaled =
    (200000n * BigInt(numerator) + BigInt(denominator)) /
    (2n * BigInt(denominator));
  const whole = scaled / 1000n;
  const frac = scaled % 1000n;
  if (frac === 0n) {
    return whole.toString();
  }
  const fracText = frac.toString().padStart(3, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fracText}`;
}

function validateScoreCase(c: ScoreCase): void {
  if (typeof c.fixtureId !== "string" || c.fixtureId.length === 0) {
    throw new Error(`ScoreCase requires a non-empty fixtureId`);
  }
  if (!isMutationId(c.mutationId)) {
    throw new Error(
      `ScoreCase ${c.fixtureId}: unknown mutationId ${String(c.mutationId)} (expected M01–M08)`,
    );
  }
  if (!isLocatorKind(c.locatorKind)) {
    throw new Error(
      `ScoreCase ${c.fixtureId}: unknown locatorKind ${String(c.locatorKind)} (expected css/xpath/role)`,
    );
  }
  if (c.controlGroup !== undefined && !isControlGroup(c.controlGroup)) {
    throw new Error(
      `ScoreCase ${c.fixtureId}: unknown controlGroup ${String(c.controlGroup)} (expected stable/fragile)`,
    );
  }
  if (c.expectedVerdict !== undefined && !isVerdict(c.expectedVerdict)) {
    throw new Error(
      `ScoreCase ${c.fixtureId}: unknown expectedVerdict ${String(c.expectedVerdict)}`,
    );
  }
  // The T004 invariant: verdict null ⟺ analysisStatus INCOMPLETE.
  // A case claiming both a verdict and INCOMPLETE (or no verdict and
  // COMPLETE) is contradictory input, not a scorable case: refuse it
  // rather than silently counting it as STABLE or dropping it.
  if (c.verdict === null && c.analysisStatus !== "INCOMPLETE") {
    throw new Error(
      `ScoreCase ${c.fixtureId}/${c.mutationId}: verdict is null but analysisStatus is ${c.analysisStatus} (expected INCOMPLETE)`,
    );
  }
  if (c.verdict !== null && c.analysisStatus !== "COMPLETE") {
    throw new Error(
      `ScoreCase ${c.fixtureId}/${c.mutationId}: verdict is ${c.verdict} but analysisStatus is ${c.analysisStatus} (expected COMPLETE)`,
    );
  }
  if (c.verdict !== null && !isVerdict(c.verdict)) {
    throw new Error(
      `ScoreCase ${c.fixtureId}/${c.mutationId}: unknown verdict ${String(c.verdict)}`,
    );
  }
}

function emptyRow(key: string): ScoreRow {
  return {
    key,
    stable: 0,
    wrongTarget: 0,
    ambiguous: 0,
    missing: 0,
    incomplete: 0,
    completed: 0,
    expected: 0,
    scoreNumerator: 0,
    scoreDenominator: 0,
    score: null,
    coverageNumerator: 0,
    coverageDenominator: 0,
    coverage: null,
    analysisStatus: "COMPLETE",
  };
}

function accumulate(row: ScoreRow, c: ScoreCase): void {
  row.expected += 1;
  if (c.verdict === null) {
    // Incomplete: never counted as STABLE, never enters the score
    // denominator; it only lowers coverage (completed < expected).
    row.incomplete += 1;
    return;
  }
  row.completed += 1;
  switch (c.verdict) {
    case "STABLE":
      row.stable += 1;
      break;
    case "WRONG_TARGET":
      row.wrongTarget += 1;
      break;
    case "AMBIGUOUS":
      row.ambiguous += 1;
      break;
    case "MISSING":
      row.missing += 1;
      break;
  }
}

function finalize(row: ScoreRow): ScoreRow {
  row.scoreNumerator = row.stable;
  row.scoreDenominator = row.completed;
  row.score = formatPercent(row.stable, row.completed);
  row.coverageNumerator = row.completed;
  row.coverageDenominator = row.expected;
  row.coverage = formatPercent(row.completed, row.expected);
  row.analysisStatus = row.incomplete === 0 ? "COMPLETE" : "INCOMPLETE";
  return row;
}

/**
 * Compute overall, per-locator and per-operator stability scores from a
 * case list. Pure function: every number is counted from `cases`.
 * Each input entry is one case; no deduplication is performed.
 */
export function computeStabilityScores(cases: readonly ScoreCase[]): StabilityScores {
  for (const c of cases) {
    validateScoreCase(c);
  }
  const overall = emptyRow("overall");
  const perLocator: Record<LocatorKind, ScoreRow> = {
    css: emptyRow("css"),
    xpath: emptyRow("xpath"),
    role: emptyRow("role"),
  };
  const perOperator = new Map<MutationId, ScoreRow>();
  for (const c of cases) {
    accumulate(overall, c);
    accumulate(perLocator[c.locatorKind], c);
    let opRow = perOperator.get(c.mutationId);
    if (!opRow) {
      opRow = emptyRow(c.mutationId);
      perOperator.set(c.mutationId, opRow);
    }
    accumulate(opRow, c);
  }
  finalize(overall);
  for (const kind of LOCATOR_KINDS) {
    finalize(perLocator[kind]);
  }
  const perOperatorOut: Partial<Record<MutationId, ScoreRow>> = {};
  for (const id of MUTATION_IDS) {
    const row = perOperator.get(id);
    if (row) {
      perOperatorOut[id] = finalize(row);
    }
  }
  return { overall, perLocator, perOperator: perOperatorOut };
}

function emptyControlGroup(group: ControlGroup): ControlGroupMetrics {
  return {
    group,
    fixtures: 0,
    pairs: 0,
    completed: 0,
    incomplete: 0,
    matched: 0,
    mismatched: 0,
    falseAlarms: 0,
    falseAlarmRate: null,
    falseAlarmFraction: "0/0",
    detected: 0,
    detectionRate: null,
    detectionFraction: "0/0",
    plantedExpected: 0,
    plantedDetected: 0,
    plantedDetectionRate: null,
    plantedDetectionFraction: "0/0",
    analysisStatus: "COMPLETE",
  };
}

function computeOneControlGroup(
  group: ControlGroup,
  cases: readonly ScoreCase[],
): ControlGroupMetrics {
  const out = emptyControlGroup(group);
  const fixtureIds = new Set<string>();
  for (const c of cases) {
    if (c.controlGroup !== group) {
      continue;
    }
    if (c.expectedVerdict === undefined) {
      throw new Error(
        `Control metrics require expectedVerdict: missing on ${c.fixtureId}/${c.mutationId}`,
      );
    }
    fixtureIds.add(c.fixtureId);
    out.pairs += 1;
    if (c.verdict === null) {
      out.incomplete += 1;
      // A case with no verdict cannot match golden: it counts as a
      // mismatch (pairs − matched) and lowers coverage, never as a hit.
    } else {
      out.completed += 1;
      if (c.verdict === c.expectedVerdict) {
        out.matched += 1;
      }
    }
    if (c.expectedVerdict !== "STABLE") {
      out.plantedExpected += 1;
      if (c.verdict === c.expectedVerdict) {
        out.plantedDetected += 1;
      }
    }
  }
  out.fixtures = fixtureIds.size;
  out.mismatched = out.pairs - out.matched;
  out.falseAlarms = out.mismatched;
  out.falseAlarmRate = formatPercent(out.mismatched, out.pairs);
  out.falseAlarmFraction = `${out.mismatched}/${out.pairs}`;
  out.detected = out.matched;
  out.detectionRate = formatPercent(out.matched, out.pairs);
  out.detectionFraction = `${out.matched}/${out.pairs}`;
  out.plantedDetectionRate = formatPercent(
    out.plantedDetected,
    out.plantedExpected,
  );
  out.plantedDetectionFraction = `${out.plantedDetected}/${out.plantedExpected}`;
  out.analysisStatus = out.incomplete === 0 ? "COMPLETE" : "INCOMPLETE";
  return out;
}

/**
 * Compute both control-group metrics from a case list. Every case must
 * carry controlGroup and expectedVerdict; otherwise this throws.
 * Pure function: every number is counted from `cases`.
 */
export function computeControlMetrics(
  cases: readonly ScoreCase[],
): ControlMetrics {
  for (const c of cases) {
    validateScoreCase(c);
    if (c.controlGroup === undefined) {
      throw new Error(
        `Control metrics require controlGroup: missing on ${c.fixtureId}/${c.mutationId}`,
      );
    }
    if (c.expectedVerdict === undefined) {
      throw new Error(
        `Control metrics require expectedVerdict: missing on ${c.fixtureId}/${c.mutationId}`,
      );
    }
  }
  return {
    stable: computeOneControlGroup("stable", cases),
    fragile: computeOneControlGroup("fragile", cases),
  };
}
```

## src/verdict/classify.ts

- 行数：165；字节数：5709；SHA-256：`d591f24b1efb8072aa7dfb97d4458ff481a7decbfeeebfc653c368e4402b1850`

```ts
// T004 — Four-state verdict classification (PROJECT_BOOK §5.2 / §5.3).
//
// This is the single production classifier. It is a pure function over the
// frozen S0 resolver result plus the Oracle identity boolean; it performs no
// browser I/O, reads no fixture, and never consults the golden matrix.
//
// Resolution order (§5.2), applied exactly in this sequence:
//   1. executionStatus — anything other than COMPLETED yields no verdict.
//   2. count sanity — negative / non-integer counts, or final > raw, are
//      contradictory resolver output and yield no verdict.
//   3. frameFailure — a framePath layer that matched 0 frames is MISSING,
//      a layer that matched >1 frames is AMBIGUOUS.
//   4. finalMatchCount — 0 is MISSING, >1 is AMBIGUOUS.
//   5. identity — with exactly 1 final match, identityMatch true is
//      STABLE, false is WRONG_TARGET, null (identity unknown) is no verdict.
//
// A null verdict always pairs with analysisStatus "INCOMPLETE": the case
// must not be counted as STABLE (or as any other verdict) downstream.

import type {
  ExecutionStatus,
  ResolverResult,
} from "../runner/execution.js";

export type Verdict = "STABLE" | "WRONG_TARGET" | "AMBIGUOUS" | "MISSING";

export type AnalysisStatus = "COMPLETE" | "INCOMPLETE";

export interface VerdictClassification {
  /** The four-state verdict, or null when no verdict may be claimed. */
  verdict: Verdict | null;
  /** Echo of the resolver execution status (§5.3: independent of verdict). */
  executionStatus: ExecutionStatus;
  /** COMPLETE only when a verdict was produced; otherwise INCOMPLETE. */
  analysisStatus: AnalysisStatus;
  /** Deterministic, human-readable reason naming the deciding rule. */
  reason: string;
}

function incomplete(
  executionStatus: ExecutionStatus,
  reason: string,
): VerdictClassification {
  return {
    verdict: null,
    executionStatus,
    analysisStatus: "INCOMPLETE",
    reason,
  };
}

function complete(
  executionStatus: ExecutionStatus,
  verdict: Verdict,
  reason: string,
): VerdictClassification {
  return {
    verdict,
    executionStatus,
    analysisStatus: "COMPLETE",
    reason,
  };
}

function isValidCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/**
 * Classify one resolved locator run.
 *
 * @param result — frozen S0 ResolverResult from resolveLocator (§5.2 steps
 *   1–6: spec validation, framePath layer counts, locator execution, raw
 *   match count, optional .nth(index), final match count).
 * @param identityMatch — Oracle identity boolean: true when the single final
 *   match is the same DOM object as the original target, false when it is a
 *   different object, null when identity was not / could not be determined
 *   (e.g. no single final match, or the identity probe itself errored).
 */
export function classifyVerdict(
  result: ResolverResult,
  identityMatch: boolean | null,
): VerdictClassification {
  const executionStatus = result.executionStatus;

  // Step 7 (§5.2): browser errors / timeouts / invalid fixtures use an
  // independent execution status and must never be disguised as a verdict.
  if (executionStatus !== "COMPLETED") {
    return incomplete(
      executionStatus,
      `executionStatus is ${executionStatus}; no verdict may be claimed`,
    );
  }

  // Defensive guard: the frozen resolver only ever emits non-negative
  // integer counts with finalMatchCount <= rawMatchCount (an index narrows
  // raw matches to 0 or 1 final match; without an index final == raw,
  // except a null handle which is reported as 0). Anything else is
  // contradictory input, not a fifth verdict.
  if (
    !isValidCount(result.rawMatchCount) ||
    !isValidCount(result.finalMatchCount) ||
    result.finalMatchCount > result.rawMatchCount
  ) {
    return incomplete(
      executionStatus,
      `invalid match counts: rawMatchCount=${String(result.rawMatchCount)}, finalMatchCount=${String(result.finalMatchCount)}`,
    );
  }

  // Frame scope (§5.2 step 2, §5.3): decided before the selector count,
  // because the selector never ran inside a resolved frame scope.
  if (result.frameFailure !== null) {
    if (result.frameFailure.kind === "FRAME_AMBIGUOUS") {
      return complete(
        executionStatus,
        "AMBIGUOUS",
        `framePath layer ${result.frameFailure.layer} selector ${result.frameFailure.selector} matched ${result.frameFailure.matchCount} frames`,
      );
    }
    return complete(
      executionStatus,
      "MISSING",
      `framePath layer ${result.frameFailure.layer} selector ${result.frameFailure.selector} matched 0 frames`,
    );
  }

  // Final match count (§5.3).
  if (result.finalMatchCount === 0) {
    return complete(
      executionStatus,
      "MISSING",
      `final match count is 0 (raw match count ${result.rawMatchCount})`,
    );
  }
  if (result.finalMatchCount > 1) {
    return complete(
      executionStatus,
      "AMBIGUOUS",
      `final match count is ${result.finalMatchCount}`,
    );
  }

  // Exactly one final match: only the Oracle identity decides
  // STABLE vs WRONG_TARGET (§5.3, §14: WRONG_TARGET must never be
  // misread as STABLE).
  if (identityMatch === true) {
    return complete(
      executionStatus,
      "STABLE",
      "final match count is 1 and the match is the original target",
    );
  }
  if (identityMatch === false) {
    return complete(
      executionStatus,
      "WRONG_TARGET",
      "final match count is 1 but the match is not the original target",
    );
  }
  return incomplete(
    executionStatus,
    "final match count is 1 but target identity is unknown; STABLE and WRONG_TARGET cannot be distinguished",
  );
}
```
