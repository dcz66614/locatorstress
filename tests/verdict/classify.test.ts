// T004 unit tests — pure classification, no browser.
// Covers every branch of classifyVerdict: all four verdicts (positive,
// negative and boundary cases) and every no-verdict execution branch.
// Spec: PROJECT_BOOK §5.2 (resolution order) and §5.3 (four states).

import { describe, it, expect } from "vitest";

import type { ResolverResult } from "../../src/runner/execution.js";
import {
  classifyVerdict,
  type Verdict,
  type VerdictClassification,
} from "../../src/verdict/classify.js";

function completed(
  overrides: Partial<ResolverResult> = {},
): ResolverResult {
  return {
    executionStatus: "COMPLETED",
    rawMatchCount: 1,
    finalMatchCount: 1,
    frameFailure: null,
    errorMessage: null,
    ...overrides,
  };
}

interface Row {
  name: string;
  result: ResolverResult;
  identityMatch: boolean | null;
  verdict: Verdict | null;
  analysisStatus: VerdictClassification["analysisStatus"];
}

const ROWS: Row[] = [
  // --- STABLE: positive, negative, boundary -------------------------------
  {
    name: "STABLE positive: 1 final match, identity true",
    result: completed({ rawMatchCount: 1, finalMatchCount: 1 }),
    identityMatch: true,
    verdict: "STABLE",
    analysisStatus: "COMPLETE",
  },
  {
    name: "STABLE boundary: indexed locator narrows raw 3 to final 1, identity true",
    result: completed({ rawMatchCount: 3, finalMatchCount: 1 }),
    identityMatch: true,
    verdict: "STABLE",
    analysisStatus: "COMPLETE",
  },
  {
    name: "STABLE negative control: 1 final match but identity false is not STABLE",
    result: completed({ rawMatchCount: 1, finalMatchCount: 1 }),
    identityMatch: false,
    verdict: "WRONG_TARGET",
    analysisStatus: "COMPLETE",
  },
  {
    name: "STABLE negative control: 1 final match but identity unknown is not STABLE",
    result: completed({ rawMatchCount: 1, finalMatchCount: 1 }),
    identityMatch: null,
    verdict: null,
    analysisStatus: "INCOMPLETE",
  },

  // --- WRONG_TARGET: positive, negative, boundary -------------------------
  {
    name: "WRONG_TARGET positive: 1 final match, identity false",
    result: completed({ rawMatchCount: 1, finalMatchCount: 1 }),
    identityMatch: false,
    verdict: "WRONG_TARGET",
    analysisStatus: "COMPLETE",
  },
  {
    name: "WRONG_TARGET boundary: indexed locator raw 2 -> final 1, identity false",
    result: completed({ rawMatchCount: 2, finalMatchCount: 1 }),
    identityMatch: false,
    verdict: "WRONG_TARGET",
    analysisStatus: "COMPLETE",
  },
  {
    name: "WRONG_TARGET negative control: identity true with 1 match is STABLE, not WRONG_TARGET",
    result: completed({ rawMatchCount: 1, finalMatchCount: 1 }),
    identityMatch: true,
    verdict: "STABLE",
    analysisStatus: "COMPLETE",
  },
  {
    name: "WRONG_TARGET negative control: 2 final matches is AMBIGUOUS even when identity is false",
    result: completed({ rawMatchCount: 2, finalMatchCount: 2 }),
    identityMatch: false,
    verdict: "AMBIGUOUS",
    analysisStatus: "COMPLETE",
  },

  // --- AMBIGUOUS: positive, negative, boundary ----------------------------
  {
    name: "AMBIGUOUS positive: selector matches 2",
    result: completed({ rawMatchCount: 2, finalMatchCount: 2 }),
    identityMatch: null,
    verdict: "AMBIGUOUS",
    analysisStatus: "COMPLETE",
  },
  {
    name: "AMBIGUOUS boundary: selector matches 3, identity unknown is irrelevant",
    result: completed({ rawMatchCount: 3, finalMatchCount: 3 }),
    identityMatch: null,
    verdict: "AMBIGUOUS",
    analysisStatus: "COMPLETE",
  },
  {
    name: "AMBIGUOUS positive: framePath layer 0 matches 2 frames",
    result: completed({
      rawMatchCount: 0,
      finalMatchCount: 0,
      frameFailure: {
        layer: 0,
        selector: "iframe.frame-a",
        matchCount: 2,
        kind: "FRAME_AMBIGUOUS",
      },
    }),
    identityMatch: null,
    verdict: "AMBIGUOUS",
    analysisStatus: "COMPLETE",
  },
  {
    name: "AMBIGUOUS positive: framePath layer 1 matches 2 frames (nested layer)",
    result: completed({
      rawMatchCount: 0,
      finalMatchCount: 0,
      frameFailure: {
        layer: 1,
        selector: "iframe.inner",
        matchCount: 2,
        kind: "FRAME_AMBIGUOUS",
      },
    }),
    identityMatch: null,
    verdict: "AMBIGUOUS",
    analysisStatus: "COMPLETE",
  },
  {
    name: "AMBIGUOUS negative control: exactly 1 final match with identity true is STABLE, not AMBIGUOUS",
    result: completed({ rawMatchCount: 1, finalMatchCount: 1 }),
    identityMatch: true,
    verdict: "STABLE",
    analysisStatus: "COMPLETE",
  },

  // --- MISSING: positive, negative, boundary ------------------------------
  {
    name: "MISSING positive: selector matches 0",
    result: completed({ rawMatchCount: 0, finalMatchCount: 0 }),
    identityMatch: null,
    verdict: "MISSING",
    analysisStatus: "COMPLETE",
  },
  {
    name: "MISSING boundary: index out of range, raw 2 -> final 0",
    result: completed({ rawMatchCount: 2, finalMatchCount: 0 }),
    identityMatch: null,
    verdict: "MISSING",
    analysisStatus: "COMPLETE",
  },
  {
    name: "MISSING boundary: index out of range, raw 1 -> final 0",
    result: completed({ rawMatchCount: 1, finalMatchCount: 0 }),
    identityMatch: null,
    verdict: "MISSING",
    analysisStatus: "COMPLETE",
  },
  {
    name: "MISSING positive: framePath layer 0 matches 0 frames",
    result: completed({
      rawMatchCount: 0,
      finalMatchCount: 0,
      frameFailure: {
        layer: 0,
        selector: "iframe.frame-a",
        matchCount: 0,
        kind: "FRAME_MISSING",
      },
    }),
    identityMatch: null,
    verdict: "MISSING",
    analysisStatus: "COMPLETE",
  },
  {
    name: "MISSING positive: framePath layer 1 matches 0 frames (nested layer)",
    result: completed({
      rawMatchCount: 0,
      finalMatchCount: 0,
      frameFailure: {
        layer: 1,
        selector: "iframe.inner",
        matchCount: 0,
        kind: "FRAME_MISSING",
      },
    }),
    identityMatch: null,
    verdict: "MISSING",
    analysisStatus: "COMPLETE",
  },
  {
    name: "MISSING negative control: 0 matches is MISSING even when identity is true (stale input)",
    result: completed({ rawMatchCount: 0, finalMatchCount: 0 }),
    identityMatch: true,
    verdict: "MISSING",
    analysisStatus: "COMPLETE",
  },

  // --- Execution errors: verdict must stay empty (§5.3) -------------------
  {
    name: "ERROR: browser error yields no verdict",
    result: completed({
      executionStatus: "ERROR",
      rawMatchCount: 0,
      finalMatchCount: 0,
      errorMessage: "locator.count: selector is invalid",
    }),
    identityMatch: null,
    verdict: null,
    analysisStatus: "INCOMPLETE",
  },
  {
    name: "ERROR negative control: even a would-be STABLE shape (1/1, identity true) yields no verdict on ERROR",
    result: completed({
      executionStatus: "ERROR",
      rawMatchCount: 1,
      finalMatchCount: 1,
      errorMessage: "page closed",
    }),
    identityMatch: true,
    verdict: null,
    analysisStatus: "INCOMPLETE",
  },
  {
    name: "TIMEOUT: timeout yields no verdict",
    result: completed({
      executionStatus: "TIMEOUT",
      rawMatchCount: 0,
      finalMatchCount: 0,
      errorMessage: "locator.count: Timeout 30000ms exceeded",
    }),
    identityMatch: null,
    verdict: null,
    analysisStatus: "INCOMPLETE",
  },
  {
    name: "TIMEOUT negative control: would-be WRONG_TARGET shape (1/1, identity false) yields no verdict on TIMEOUT",
    result: completed({
      executionStatus: "TIMEOUT",
      rawMatchCount: 1,
      finalMatchCount: 1,
      errorMessage: "locator.count: Timeout 30000ms exceeded",
    }),
    identityMatch: false,
    verdict: null,
    analysisStatus: "INCOMPLETE",
  },
  {
    name: "INVALID_FIXTURE: invalid fixture yields no verdict",
    result: completed({
      executionStatus: "INVALID_FIXTURE",
      rawMatchCount: 0,
      finalMatchCount: 0,
      errorMessage: "ORACLE_TARGET_NOT_UNIQUE: 0",
    }),
    identityMatch: null,
    verdict: null,
    analysisStatus: "INCOMPLETE",
  },
  {
    name: "INVALID_FIXTURE negative control: would-be STABLE shape yields no verdict on INVALID_FIXTURE",
    result: completed({
      executionStatus: "INVALID_FIXTURE",
      rawMatchCount: 1,
      finalMatchCount: 1,
      errorMessage: "ORACLE_TARGET_NOT_UNIQUE: 2",
    }),
    identityMatch: true,
    verdict: null,
    analysisStatus: "INCOMPLETE",
  },

  // --- Precedence: frame failure beats selector count (§5.2 order) --------
  {
    name: "precedence: FRAME_AMBIGUOUS beats any selector count",
    result: completed({
      rawMatchCount: 0,
      finalMatchCount: 0,
      frameFailure: {
        layer: 0,
        selector: "iframe.frame-a",
        matchCount: 3,
        kind: "FRAME_AMBIGUOUS",
      },
    }),
    identityMatch: null,
    verdict: "AMBIGUOUS",
    analysisStatus: "COMPLETE",
  },
  {
    name: "precedence: FRAME_MISSING beats any selector count",
    result: completed({
      rawMatchCount: 0,
      finalMatchCount: 0,
      frameFailure: {
        layer: 0,
        selector: "iframe.frame-a",
        matchCount: 0,
        kind: "FRAME_MISSING",
      },
    }),
    identityMatch: null,
    verdict: "MISSING",
    analysisStatus: "COMPLETE",
  },
  {
    name: "precedence: execution error beats a frame failure",
    result: completed({
      executionStatus: "ERROR",
      rawMatchCount: 0,
      finalMatchCount: 0,
      frameFailure: {
        layer: 0,
        selector: "iframe.frame-a",
        matchCount: 2,
        kind: "FRAME_AMBIGUOUS",
      },
      errorMessage: "page closed",
    }),
    identityMatch: null,
    verdict: null,
    analysisStatus: "INCOMPLETE",
  },

  // --- Contradictory counts: defensive no-verdict -------------------------
  {
    name: "invalid counts: negative finalMatchCount yields no verdict",
    result: completed({ rawMatchCount: 1, finalMatchCount: -1 }),
    identityMatch: null,
    verdict: null,
    analysisStatus: "INCOMPLETE",
  },
  {
    name: "invalid counts: negative rawMatchCount yields no verdict",
    result: completed({ rawMatchCount: -1, finalMatchCount: 0 }),
    identityMatch: null,
    verdict: null,
    analysisStatus: "INCOMPLETE",
  },
  {
    name: "invalid counts: non-integer finalMatchCount yields no verdict",
    result: completed({ rawMatchCount: 2, finalMatchCount: 1.5 }),
    identityMatch: null,
    verdict: null,
    analysisStatus: "INCOMPLETE",
  },
  {
    name: "invalid counts: finalMatchCount greater than rawMatchCount yields no verdict",
    result: completed({ rawMatchCount: 1, finalMatchCount: 2 }),
    identityMatch: null,
    verdict: null,
    analysisStatus: "INCOMPLETE",
  },
];

describe("classifyVerdict (T004 unit)", () => {
  for (const row of ROWS) {
    it(row.name, () => {
      const out = classifyVerdict(row.result, row.identityMatch);
      expect(out.verdict).toBe(row.verdict);
      expect(out.analysisStatus).toBe(row.analysisStatus);
      expect(out.executionStatus).toBe(row.result.executionStatus);
      expect(typeof out.reason).toBe("string");
      expect(out.reason.length).toBeGreaterThan(0);
      // Invariant: a verdict exists if and only if analysis is COMPLETE.
      expect(out.verdict !== null).toBe(out.analysisStatus === "COMPLETE");
      // Invariant: no verdict is ever STABLE unless identity is true.
      if (out.verdict === "STABLE") {
        expect(row.identityMatch).toBe(true);
      }
    });
  }

  it("every verdict state has at least one COMPLETE case in the table", () => {
    const seen = new Set<Verdict>();
    for (const row of ROWS) {
      if (row.verdict !== null) {
        seen.add(row.verdict);
      }
    }
    expect([...seen].sort()).toEqual([
      "AMBIGUOUS",
      "MISSING",
      "STABLE",
      "WRONG_TARGET",
    ]);
  });

  it("every executionStatus has at least one INCOMPLETE (null-verdict) case", () => {
    const seen = new Set<string>();
    for (const row of ROWS) {
      if (row.verdict === null) {
        seen.add(row.result.executionStatus);
      }
    }
    expect([...seen].sort()).toEqual([
      "COMPLETED",
      "ERROR",
      "INVALID_FIXTURE",
      "TIMEOUT",
    ]);
  });
});
