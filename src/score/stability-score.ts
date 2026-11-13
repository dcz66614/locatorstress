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
