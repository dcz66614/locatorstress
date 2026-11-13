// T008 test helpers — fake BFS results and small report inputs.
// Pure builders only; no browser, no I/O.

import { summarizeWitness } from "../src/analysis/witness.js";
import type { BuildAnalysisReportInput } from "../src/analysis/witness.js";
import type { ReportCase, WitnessSummary } from "../src/contracts/report.js";
import type { BfsResult } from "../src/search/bfs.js";
import type { ScenarioFixtureInput } from "../src/canonical/hashes.js";

export function fakeBfsResult(overrides: Partial<BfsResult> = {}): BfsResult {
  return {
    status: "BOUNDED_NO_WITNESS",
    fixtureId: "F001",
    witness: null,
    limits: { maxDepth: 6, maxExpandedStates: 4096 },
    statesEvaluated: 9,
    statesExpanded: 9,
    statesDeduplicated: 0,
    uniqueStates: 9,
    incompleteStates: 0,
    maxDepthReached: 1,
    queueRemaining: 0,
    perDepthEvaluated: { 0: 1, 1: 8 },
    evaluations: [],
    notes: [],
    ...overrides,
  };
}

export function fakeWitnessSummary(overrides: Partial<BfsResult> = {}): WitnessSummary {
  return summarizeWitness(fakeBfsResult(overrides));
}

const MUTATIONS = ["M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08"] as const;

/**
 * A two-fixture report input: F001 (css, stable — all 8 STABLE) and
 * F002 (xpath, fragile — M01 WRONG_TARGET, rest STABLE). Witnesses:
 * F001 BOUNDED_NO_WITNESS at depth 1, F002 FOUND [M01]. Gate result is
 * supplied by the caller (tests choose PASS or FAIL explicitly).
 */
export function smallReportInput(
  gateResult: "PASS" | "FAIL" = "PASS",
): BuildAnalysisReportInput {
  const fixtures: ScenarioFixtureInput[] = [
    {
      fixtureId: "F001",
      family: "form-submit",
      kind: "css",
      controlGroup: "stable",
      locator: { kind: "css", selector: "button[type='submit']" },
      html: "<main><button type=\"submit\">Save</button></main>",
    },
    {
      fixtureId: "F002",
      family: "search-box",
      kind: "xpath",
      controlGroup: "fragile",
      locator: { kind: "xpath", selector: "//input[@id='q']" },
      html: "<main><input id=\"q\" /></main>",
    },
  ];
  const cases: ReportCase[] = [];
  for (const mutationId of MUTATIONS) {
    cases.push({
      fixtureId: "F001",
      mutationId,
      locatorKind: "css",
      controlGroup: "stable",
      verdict: "STABLE",
      analysisStatus: "COMPLETE",
      executionStatus: "COMPLETED",
      matchCount: 1,
      identityMatch: true,
      expectedVerdict: "STABLE",
    });
  }
  for (const mutationId of MUTATIONS) {
    const failing = mutationId === "M01";
    cases.push({
      fixtureId: "F002",
      mutationId,
      locatorKind: "xpath",
      controlGroup: "fragile",
      verdict: failing ? "WRONG_TARGET" : "STABLE",
      analysisStatus: "COMPLETE",
      executionStatus: "COMPLETED",
      matchCount: 1,
      identityMatch: !failing,
      expectedVerdict: failing ? "WRONG_TARGET" : "STABLE",
    });
  }
  return {
    cases,
    fixtures,
    witnesses: {
      F001: fakeWitnessSummary({
        fixtureId: "F001",
        status: "BOUNDED_NO_WITNESS",
        witness: null,
        limits: { maxDepth: 1, maxExpandedStates: 4096 },
        statesEvaluated: 9,
        statesExpanded: 1,
        maxDepthReached: 1,
        queueRemaining: 0,
        perDepthEvaluated: { 0: 1, 1: 8 },
      }),
      F002: fakeWitnessSummary({
        fixtureId: "F002",
        status: "FOUND",
        witness: { sequence: ["M01"], depth: 1, verdict: "WRONG_TARGET" },
        limits: { maxDepth: 1, maxExpandedStates: 4096 },
        statesEvaluated: 2,
        statesExpanded: 1,
        maxDepthReached: 1,
        queueRemaining: 7,
        perDepthEvaluated: { 0: 1, 1: 1 },
      }),
    },
    oracleParity: { compared: 16, matched: 16, mismatched: 0 },
    baseline: { passed: 2, total: 2 },
    externalRequests: 0,
    blockedRequests: 0,
    staticOfflineScanHits: 0,
    gateResult,
    gateFailureType: gateResult === "PASS" ? null : "TEST",
  };
}
