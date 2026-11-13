// T008 — AnalysisReport schema (PROJECT_BOOK §11.4; IMPLEMENTATION_PLAN T008).
//
// This file defines the report shape only. It builds nothing and hashes
// nothing: the assembly lives in src/analysis/witness.ts, hash
// recomputation in the same module, and JSON export/validation in
// src/export/json-export.ts.
//
// The report integrates verdict (T004), stability score + coverage
// (T005), canonical hashes (T006, frozen builders) and the bounded-BFS
// witness (T007). It is the first report to carry a REAL BFS witness:
// the S0 gate's analysis object still carries the frozen placeholder
// `bfs: { status: "NOT_IMPLEMENTED_S0", witness: null }` and MUST NOT be
// edited (evidence/s0/ and src/canonical/ are frozen). The T008 analysis
// object therefore uses its own schema string
// ("locatorstress.analysis/v1", see src/analysis/witness.ts) and its own
// per-fixture `bfs` map; its analysis_sha256 is a different hash from
// the S0 gate's frozen analysis_sha256 by design, and the S0 gate hash
// (651c3fd4…) is untouched. The report says so in its `notes`.
//
// Witness-status rule (T007 review P2-1, mandatory): a null witness is
// NEVER reported as "no witness" / "safe". The report carries the BFS
// `status` next to every null witness, and the two null-witness statuses
// mean different things:
//   - BOUNDED_NO_WITNESS: no failing sequence inside the searched space.
//     It does NOT prove the locator safe for all DOM changes.
//   - BOUNDED_INCOMPLETE: the expansion budget ran out with sequences
//     still queued. The search is incomplete; nothing may be claimed
//     about sequences beyond the budget. In the full 8-operator no-repeat
//     tree a depth-6 witness needs 8801 expansions, more than the frozen
//     4096 budget, so BOUNDED_INCOMPLETE is the CORRECT outcome there,
//     never a failure to report and never a "no witness".

import type { BfsStatus, BfsWitness } from "../search/bfs.js";
import type { AnalysisStatus, Verdict } from "../verdict/classify.js";
import type {
  ControlMetrics,
  StabilityScores,
} from "../score/stability-score.js";
import type {
  Coverage,
  VerdictCounts,
} from "../canonical/hashes.js";

export type { AnalysisStatus, Verdict, BfsStatus, BfsWitness };
export type { Coverage, VerdictCounts, ControlMetrics, StabilityScores };

export const SCHEMA_ANALYSIS_REPORT = "locatorstress.analysis-report/v1";

/** One analysed single-mutation case (baseline is reported separately). */
export interface ReportCase {
  fixtureId: string;
  mutationId: string;
  locatorKind: "css" | "xpath" | "role";
  controlGroup: "stable" | "fragile";
  verdict: Verdict | null;
  analysisStatus: AnalysisStatus;
  executionStatus: string;
  matchCount: number;
  identityMatch: boolean | null;
  expectedVerdict: Verdict;
}

/**
 * One fixture's BFS outcome, as it appears in the report and in API
 * responses. The full BfsResult evaluation trace is intentionally NOT
 * embedded here (it can hold up to 4096 records); it stays in memory
 * for the caller that ran the search. `status` is always present, so a
 * null `witness` is unambiguous: BOUNDED_NO_WITNESS vs
 * BOUNDED_INCOMPLETE.
 */
export interface WitnessSummary {
  fixtureId: string;
  status: BfsStatus;
  witness: BfsWitness | null;
  /** Plain-language meaning of this status (see module header). */
  meaning: string;
  /**
   * Present only when status is BOUNDED_INCOMPLETE and the frozen
   * 6/4096 bounds were in force: explains the 8801-expansion depth-6
   * budget tension. Absent otherwise.
   */
  budgetNote?: string;
  limits: { maxDepth: number; maxExpandedStates: number };
  statesEvaluated: number;
  statesExpanded: number;
  statesDeduplicated: number;
  uniqueStates: number;
  incompleteStates: number;
  maxDepthReached: number;
  queueRemaining: number;
  perDepthEvaluated: Record<number, number>;
  notes: string[];
}

export interface ReportHashes {
  scenario_sha256: string;
  oracle_result_sha256: string;
  analysis_sha256: string;
  gate_sha256: string;
}

/**
 * The four canonical objects the hashes are computed over, embedded so
 * every hash in this report recomputes from the report alone
 * (hashCanonical(canonical.scenario) === hashes.scenario_sha256, and
 * likewise for oracle / analysis / gate; the gate object contains the
 * three lower hashes, never gate_sha256 itself).
 */
export interface ReportCanonicalObjects {
  scenario: Record<string, unknown>;
  oracle: Record<string, unknown>;
  analysis: Record<string, unknown>;
  gate: Record<string, unknown>;
}

export interface WitnessCoverage {
  searchedFixtures: number;
  found: number;
  boundedNoWitness: number;
  boundedIncomplete: number;
}

export interface OracleParitySummary {
  compared: number;
  matched: number;
  mismatched: number;
}

export interface BaselineSummary {
  passed: number;
  total: number;
}

export interface ApiSmokeSummary {
  host: string;
  port: number;
  address: string;
  healthOk: boolean;
  fixturesListed: number;
  searchFixtureId: string;
  searchStatus: BfsStatus;
}

export interface ReportVerification {
  s0GateJsonSha256Before: string;
  s0GateJsonSha256After: string;
  s0GateJsonUnchanged: boolean;
  reportRevalidated: boolean;
  apiSmoke: ApiSmokeSummary | null;
}

export interface AnalysisReport {
  schema: typeof SCHEMA_ANALYSIS_REPORT;
  seed: string;
  task: "T008";
  analysisStatus: AnalysisStatus;
  expectedCases: number;
  completedCases: number;
  baseline: BaselineSummary;
  verdictCounts: VerdictCounts;
  verdictCountsByKind: Record<string, VerdictCounts>;
  scores: StabilityScores;
  controls: ControlMetrics;
  coverage: Coverage;
  oracleParity: OracleParitySummary;
  witnesses: Record<string, WitnessSummary>;
  witnessCoverage: WitnessCoverage;
  cases: ReportCase[];
  externalRequests: number;
  blockedRequests: number;
  staticOfflineScanHits: number;
  hashes: ReportHashes;
  canonical: ReportCanonicalObjects;
  notes: string[];
  verification: ReportVerification | null;
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

const VERDICTS: readonly string[] = [
  "STABLE",
  "WRONG_TARGET",
  "AMBIGUOUS",
  "MISSING",
];

const BFS_STATUSES: readonly string[] = [
  "FOUND",
  "BOUNDED_NO_WITNESS",
  "BOUNDED_INCOMPLETE",
];

/**
 * Structural validation of an AnalysisReport. Checks shapes, count
 * consistency, score numerator/denominator consistency, and the
 * witness-status rules (FOUND ⟺ witness non-null; BOUNDED_* ⟹ witness
 * null; witness depth equals sequence length and is within the frozen
 * depth cap). It does NOT recompute hashes — that is
 * recomputeReportHashes() in src/analysis/witness.ts (and the export
 * validator, which calls it), because hash recomputation needs the
 * canonical builders. Returns a list of error strings; empty means
 * structurally valid.
 */
export function validateReportStructure(report: unknown): string[] {
  const errors: string[] = [];
  if (!isPlainObject(report)) {
    return ["report is not a plain object"];
  }
  if (report["schema"] !== SCHEMA_ANALYSIS_REPORT) {
    errors.push(
      `schema must be "${SCHEMA_ANALYSIS_REPORT}", got ${JSON.stringify(report["schema"])}`,
    );
  }
  if (report["seed"] !== "P022-LOCATORSTRESS-S0-2026-11-10") {
    errors.push(`seed must be "P022-LOCATORSTRESS-S0-2026-11-10"`);
  }
  if (report["task"] !== "T008") {
    errors.push(`task must be "T008"`);
  }
  if (
    report["analysisStatus"] !== "COMPLETE" &&
    report["analysisStatus"] !== "INCOMPLETE"
  ) {
    errors.push(`analysisStatus must be "COMPLETE" or "INCOMPLETE"`);
  }

  const cases = report["cases"];
  if (!Array.isArray(cases)) {
    errors.push("cases must be an array");
    return errors;
  }
  if (report["expectedCases"] !== cases.length) {
    errors.push(
      `expectedCases (${String(report["expectedCases"])}) must equal cases.length (${cases.length})`,
    );
  }
  let completed = 0;
  const counts: Record<string, number> = {
    STABLE: 0,
    WRONG_TARGET: 0,
    AMBIGUOUS: 0,
    MISSING: 0,
  };
  for (let i = 0; i < cases.length; i += 1) {
    const c = cases[i] as Record<string, unknown>;
    if (!isPlainObject(c)) {
      errors.push(`cases[${i}] is not a plain object`);
      continue;
    }
    if (c["verdict"] !== null && typeof c["verdict"] === "string" && VERDICTS.includes(c["verdict"])) {
      counts[c["verdict"]] += 1;
      completed += 1;
      if (c["analysisStatus"] !== "COMPLETE") {
        errors.push(
          `cases[${i}] (${String(c["fixtureId"])}/${String(c["mutationId"])}): verdict ${String(c["verdict"])} requires analysisStatus COMPLETE`,
        );
      }
    } else if (c["verdict"] === null) {
      if (c["analysisStatus"] !== "INCOMPLETE") {
        errors.push(
          `cases[${i}] (${String(c["fixtureId"])}/${String(c["mutationId"])}): null verdict requires analysisStatus INCOMPLETE`,
        );
      }
    } else {
      errors.push(`cases[${i}]: unknown verdict ${JSON.stringify(c["verdict"])}`);
    }
    if (!isNonNegativeInteger(c["matchCount"])) {
      errors.push(`cases[${i}]: matchCount must be a non-negative integer`);
    }
    if (
      c["identityMatch"] !== null &&
      c["identityMatch"] !== true &&
      c["identityMatch"] !== false
    ) {
      errors.push(`cases[${i}]: identityMatch must be boolean or null`);
    }
    if (
      typeof c["expectedVerdict"] !== "string" ||
      !VERDICTS.includes(c["expectedVerdict"])
    ) {
      errors.push(`cases[${i}]: expectedVerdict must be a four-state verdict`);
    }
  }
  if (report["completedCases"] !== completed) {
    errors.push(
      `completedCases (${String(report["completedCases"])}) must equal cases with a verdict (${completed})`,
    );
  }
  const vc = report["verdictCounts"];
  if (!isPlainObject(vc)) {
    errors.push("verdictCounts must be an object");
  } else {
    for (const v of VERDICTS) {
      if (vc[v] !== counts[v]) {
        errors.push(
          `verdictCounts.${v} (${String(vc[v])}) must equal counted ${v} cases (${counts[v]})`,
        );
      }
    }
  }

  const scores = report["scores"];
  if (!isPlainObject(scores) || !isPlainObject(scores["overall"])) {
    errors.push("scores.overall must be an object");
  } else {
    const overall = scores["overall"] as Record<string, unknown>;
    if (overall["expected"] !== cases.length) {
      errors.push(
        `scores.overall.expected (${String(overall["expected"])}) must equal cases.length (${cases.length})`,
      );
    }
    if (overall["completed"] !== completed) {
      errors.push(
        `scores.overall.completed (${String(overall["completed"])}) must equal completed cases (${completed})`,
      );
    }
    if (overall["scoreNumerator"] !== counts["STABLE"]) {
      errors.push(
        `scores.overall.scoreNumerator must equal STABLE count (${counts["STABLE"]})`,
      );
    }
    if (overall["scoreDenominator"] !== completed) {
      errors.push(
        `scores.overall.scoreDenominator must equal completed cases (${completed})`,
      );
    }
  }

  // Witness-status rules (T007 P2-1): status always present next to a
  // null witness; FOUND ⟺ witness non-null.
  const witnesses = report["witnesses"];
  if (!isPlainObject(witnesses)) {
    errors.push("witnesses must be an object");
  } else {
    let found = 0;
    let noWitness = 0;
    let incomplete = 0;
    for (const [fixtureId, w] of Object.entries(witnesses)) {
      if (!isPlainObject(w)) {
        errors.push(`witnesses.${fixtureId} is not a plain object`);
        continue;
      }
      const status = w["status"];
      if (typeof status !== "string" || !BFS_STATUSES.includes(status)) {
        errors.push(`witnesses.${fixtureId}: status must be a BfsStatus`);
        continue;
      }
      if (w["fixtureId"] !== fixtureId) {
        errors.push(
          `witnesses.${fixtureId}: fixtureId field must equal its key`,
        );
      }
      if (typeof w["meaning"] !== "string" || w["meaning"].length === 0) {
        errors.push(`witnesses.${fixtureId}: meaning must be a non-empty string`);
      }
      if (status === "FOUND") {
        found += 1;
        const witness = w["witness"];
        if (!isPlainObject(witness)) {
          errors.push(
            `witnesses.${fixtureId}: status FOUND requires a non-null witness`,
          );
        } else {
          const seq = witness["sequence"];
          if (!Array.isArray(seq)) {
            errors.push(`witnesses.${fixtureId}: witness.sequence must be an array`);
          } else if (seq.length === 0 && witness["depth"] !== 0) {
            // An empty sequence is legal only as a depth-0 witness:
            // the baseline itself fails with no mutation applied
            // (see runBoundedBfs). Any other empty sequence is a
            // structure error — depth must equal sequence length.
            errors.push(`witnesses.${fixtureId}: witness.sequence must be a non-empty array`);
          } else if (witness["depth"] !== seq.length) {
            errors.push(
              `witnesses.${fixtureId}: witness.depth (${String(witness["depth"])}) must equal sequence length (${seq.length})`,
            );
          }
          if (
            typeof witness["depth"] !== "number" ||
            witness["depth"] > 6
          ) {
            errors.push(`witnesses.${fixtureId}: witness.depth must be within 0..6`);
          }
          if (
            typeof witness["verdict"] !== "string" ||
            !VERDICTS.includes(witness["verdict"]) ||
            witness["verdict"] === "STABLE"
          ) {
            errors.push(
              `witnesses.${fixtureId}: witness.verdict must be a failing four-state verdict`,
            );
          }
        }
      } else {
        if (status === "BOUNDED_NO_WITNESS") noWitness += 1;
        if (status === "BOUNDED_INCOMPLETE") incomplete += 1;
        if (w["witness"] !== null) {
          errors.push(
            `witnesses.${fixtureId}: status ${status} requires witness null`,
          );
        }
        // The status field itself is the guard: BOUNDED_INCOMPLETE is
        // never presented as a no-witness outcome. (The meaning text
        // for BOUNDED_INCOMPLETE explicitly negates "no witness", so no
        // substring check is applied here — it would false-positive on
        // the negation.)

      }
      if (!isPlainObject(w["limits"])) {
        errors.push(`witnesses.${fixtureId}: limits must be an object`);
      }
    }
    const wc = report["witnessCoverage"];
    if (!isPlainObject(wc)) {
      errors.push("witnessCoverage must be an object");
    } else {
      if (wc["searchedFixtures"] !== Object.keys(witnesses).length) {
        errors.push("witnessCoverage.searchedFixtures must equal witnesses size");
      }
      if (wc["found"] !== found) {
        errors.push(`witnessCoverage.found must equal FOUND count (${found})`);
      }
      if (wc["boundedNoWitness"] !== noWitness) {
        errors.push(
          `witnessCoverage.boundedNoWitness must equal BOUNDED_NO_WITNESS count (${noWitness})`,
        );
      }
      if (wc["boundedIncomplete"] !== incomplete) {
        errors.push(
          `witnessCoverage.boundedIncomplete must equal BOUNDED_INCOMPLETE count (${incomplete})`,
        );
      }
    }
  }

  const hashes = report["hashes"];
  if (!isPlainObject(hashes)) {
    errors.push("hashes must be an object");
  } else {
    for (const field of [
      "scenario_sha256",
      "oracle_result_sha256",
      "analysis_sha256",
      "gate_sha256",
    ]) {
      if (typeof hashes[field] !== "string" || !HASH_PATTERN.test(hashes[field])) {
        errors.push(`hashes.${field} must be a 64-char lowercase hex SHA-256`);
      }
    }
  }
  const canonical = report["canonical"];
  if (!isPlainObject(canonical)) {
    errors.push("canonical must be an object");
  } else {
    for (const field of ["scenario", "oracle", "analysis", "gate"]) {
      if (!isPlainObject(canonical[field])) {
        errors.push(`canonical.${field} must be an object`);
      }
    }
  }
  if (!isNonNegativeInteger(report["externalRequests"])) {
    errors.push("externalRequests must be a non-negative integer");
  }
  if (!isNonNegativeInteger(report["blockedRequests"])) {
    errors.push("blockedRequests must be a non-negative integer");
  }
  if (!isNonNegativeInteger(report["staticOfflineScanHits"])) {
    errors.push("staticOfflineScanHits must be a non-negative integer");
  }
  if (!Array.isArray(report["notes"])) {
    errors.push("notes must be an array");
  }
  return errors;
}
