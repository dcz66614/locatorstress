// T008 witness tests — pure unit tests (no browser).
//
// Covers the T007-review P2-1 rule: BOUNDED_INCOMPLETE is passed through
// verbatim as "budget exhausted, search incomplete", never as "no
// witness" / "no failure" / "safe"; a null witness is always paired
// with its status; and the depth-6 / 4096 budget note appears only when
// the frozen bounds were in force. Also covers report assembly: counts,
// scores, coverage and all four hashes recompute from the report.

import { describe, it, expect } from "vitest";

import {
  DEPTH6_UNPRUNED_EXPANSIONS,
  buildAnalysisReport,
  recomputeReportHashes,
  summarizeWitness,
} from "../../src/analysis/witness.js";
import { validateReportStructure } from "../../src/contracts/report.js";
import { fakeBfsResult, fakeWitnessSummary, smallReportInput } from "../t008-helpers.js";

describe("summarizeWitness", () => {
  it("FOUND keeps the witness and states the failing sequence", () => {
    const s = summarizeWitness(
      fakeBfsResult({
        fixtureId: "F002",
        status: "FOUND",
        witness: { sequence: ["M01"], depth: 1, verdict: "WRONG_TARGET" },
        statesEvaluated: 2,
        queueRemaining: 7,
      }),
    );
    expect(s.status).toBe("FOUND");
    expect(s.witness).toEqual({ sequence: ["M01"], depth: 1, verdict: "WRONG_TARGET" });
    expect(s.meaning).toContain("M01");
    expect(s.meaning).toContain("WRONG_TARGET");
    expect(s.budgetNote).toBeUndefined();
  });

  it("BOUNDED_NO_WITNESS pairs a null witness with its status and disclaims safety", () => {
    const s = summarizeWitness(fakeBfsResult({ status: "BOUNDED_NO_WITNESS" }));
    expect(s.status).toBe("BOUNDED_NO_WITNESS");
    expect(s.witness).toBeNull();
    expect(s.meaning).toContain("inside the searched space");
    expect(s.meaning).toContain("does NOT prove the locator is safe");
    expect(s.budgetNote).toBeUndefined();
  });

  it("BOUNDED_INCOMPLETE is passed through as incomplete, never as no witness", () => {
    const s = summarizeWitness(
      fakeBfsResult({
        status: "BOUNDED_INCOMPLETE",
        statesExpanded: 4096,
        queueRemaining: 1234,
        notes: ["expansion budget exhausted (4096 states) with 1234 sequence(s) still queued; search is bounded incomplete"],
      }),
    );
    expect(s.status).toBe("BOUNDED_INCOMPLETE");
    expect(s.witness).toBeNull();
    expect(s.queueRemaining).toBe(1234);
    expect(s.meaning).toContain("INCOMPLETE");
    expect(s.meaning).toContain("still queued");
    // The meaning negates "no witness" / "safe" — it must never assert them.
    expect(s.meaning).not.toMatch(/no failing sequence/i);
    expect(s.meaning).not.toMatch(/locator is safe/i);
    expect(s.meaning).toContain('NOT "no witness"');
  });

  it("depth-6 budget note appears only at the frozen 6/4096 bounds", () => {
    const atFrozenBounds = summarizeWitness(
      fakeBfsResult({ status: "BOUNDED_INCOMPLETE", queueRemaining: 5 }),
    );
    expect(atFrozenBounds.budgetNote).toContain(String(DEPTH6_UNPRUNED_EXPANSIONS));
    expect(atFrozenBounds.budgetNote).toContain("8801");
    expect(atFrozenBounds.budgetNote).toContain("4096");

    const reducedBounds = summarizeWitness(
      fakeBfsResult({
        status: "BOUNDED_INCOMPLETE",
        limits: { maxDepth: 6, maxExpandedStates: 8 },
        queueRemaining: 5,
      }),
    );
    expect(reducedBounds.budgetNote).toBeUndefined();

    const noWitness = summarizeWitness(fakeBfsResult());
    expect(noWitness.budgetNote).toBeUndefined();
  });

  it("throws on contradictory BFS results instead of repairing them", () => {
    expect(() =>
      summarizeWitness(fakeBfsResult({ status: "FOUND", witness: null })),
    ).toThrow(/FOUND with null witness/);
    expect(() =>
      summarizeWitness(
        fakeBfsResult({
          status: "BOUNDED_NO_WITNESS",
          witness: { sequence: ["M01"], depth: 1, verdict: "MISSING" },
        }),
      ),
    ).toThrow(/with a non-null witness/);
    expect(() =>
      summarizeWitness(
        fakeBfsResult({
          status: "FOUND",
          witness: { sequence: ["M01", "M02"], depth: 1, verdict: "MISSING" },
        }),
      ),
    ).toThrow(/depth .* != sequence length/);
  });

  it("copies counts verbatim and never includes the evaluation trace", () => {
    const s = fakeWitnessSummary({
      statesEvaluated: 65,
      statesDeduplicated: 21,
      uniqueStates: 44,
      perDepthEvaluated: { 0: 1, 1: 8, 2: 56 },
    });
    expect(s.statesEvaluated).toBe(65);
    expect(s.statesDeduplicated).toBe(21);
    expect(s.uniqueStates).toBe(44);
    expect(s.perDepthEvaluated).toEqual({ 0: 1, 1: 8, 2: 56 });
    expect("evaluations" in s).toBe(false);
  });
});

describe("buildAnalysisReport", () => {
  it("assembles counts, scores, coverage and hashes from the inputs", () => {
    const report = buildAnalysisReport(smallReportInput());
    expect(report.schema).toBe("locatorstress.analysis-report/v1");
    expect(report.seed).toBe("P022-LOCATORSTRESS-S0-2026-11-10");
    expect(report.analysisStatus).toBe("COMPLETE");
    expect(report.expectedCases).toBe(16);
    expect(report.completedCases).toBe(16);
    expect(report.verdictCounts).toEqual({
      STABLE: 15,
      WRONG_TARGET: 1,
      AMBIGUOUS: 0,
      MISSING: 0,
    });
    expect(report.verdictCountsByKind["css"]).toEqual({
      STABLE: 8,
      WRONG_TARGET: 0,
      AMBIGUOUS: 0,
      MISSING: 0,
    });
    expect(report.verdictCountsByKind["xpath"]).toEqual({
      STABLE: 7,
      WRONG_TARGET: 1,
      AMBIGUOUS: 0,
      MISSING: 0,
    });
    // 15/16 = 93.75
    expect(report.scores.overall.scoreNumerator).toBe(15);
    expect(report.scores.overall.scoreDenominator).toBe(16);
    expect(report.scores.overall.score).toBe("93.75");
    expect(report.scores.overall.coverage).toBe("100");
    expect(report.coverage.cssFixtures).toBe(1);
    expect(report.coverage.xpathFixtures).toBe(1);
    expect(report.controls.stable.pairs).toBe(8);
    expect(report.controls.stable.mismatched).toBe(0);
    expect(report.controls.fragile.pairs).toBe(8);
    expect(report.controls.fragile.mismatched).toBe(0);
    expect(report.witnessCoverage).toEqual({
      searchedFixtures: 2,
      found: 1,
      boundedNoWitness: 1,
      boundedIncomplete: 0,
    });
    expect(report.witnesses["F002"].witness).toEqual({
      sequence: ["M01"],
      depth: 1,
      verdict: "WRONG_TARGET",
    });
    expect(report.witnesses["F001"].witness).toBeNull();
    expect(report.witnesses["F001"].status).toBe("BOUNDED_NO_WITNESS");
    expect(validateReportStructure(report)).toEqual([]);
    // All four hashes recompute from the embedded canonical objects.
    const { errors } = recomputeReportHashes(report);
    expect(errors).toEqual([]);
  });

  it("is deterministic: same input gives identical hashes", () => {
    const a = buildAnalysisReport(smallReportInput());
    const b = buildAnalysisReport(smallReportInput());
    expect(a.hashes).toEqual(b.hashes);
    expect(a.canonical).toEqual(b.canonical);
  });

  it("marks INCOMPLETE when a case has no verdict and excludes it from the score", () => {
    const input = smallReportInput();
    const target = input.cases.find((c) => c.fixtureId === "F002" && c.mutationId === "M01");
    if (!target) throw new Error("test setup: F002/M01 missing");
    target.verdict = null;
    target.analysisStatus = "INCOMPLETE";
    target.identityMatch = null;
    target.matchCount = 0;
    const report = buildAnalysisReport(input);
    expect(report.analysisStatus).toBe("INCOMPLETE");
    expect(report.completedCases).toBe(15);
    expect(report.verdictCounts.WRONG_TARGET).toBe(0);
    expect(report.scores.overall.scoreNumerator).toBe(15);
    expect(report.scores.overall.scoreDenominator).toBe(15);
    expect(report.scores.overall.score).toBe("100");
    expect(report.scores.overall.coverage).toBe("93.75");
    expect(validateReportStructure(report)).toEqual([]);
    expect(recomputeReportHashes(report).errors).toEqual([]);
  });

  it("records the T008 hash basis in its notes", () => {
    const report = buildAnalysisReport(smallReportInput());
    const joined = report.notes.join("\n");
    expect(joined).toContain("locatorstress.analysis/v1");
    expect(joined).toContain("NOT_IMPLEMENTED_S0");
    expect(joined).toContain("BOUNDED_INCOMPLETE");
  });

  it("throws on duplicate cases, unknown witness fixtures and bad pairings", () => {
    const dup = smallReportInput();
    dup.cases.push({ ...dup.cases[0] });
    expect(() => buildAnalysisReport(dup)).toThrow(/duplicate case/);

    const unknownWitness = smallReportInput();
    unknownWitness.witnesses["F099"] = fakeWitnessSummary({ fixtureId: "F099" });
    expect(() => buildAnalysisReport(unknownWitness)).toThrow(/unknown fixture F099/);

    const badPairing = smallReportInput();
    const target = badPairing.cases[0];
    if (!target) throw new Error("test setup");
    target.verdict = null;
    target.analysisStatus = "COMPLETE";
    expect(() => buildAnalysisReport(badPairing)).toThrow(/INCOMPLETE violated/);
  });

  it("structure validation catches a tampered verdict count", () => {
    const report = buildAnalysisReport(smallReportInput());
    const tampered = JSON.parse(JSON.stringify(report)) as typeof report;
    tampered.verdictCounts.STABLE = 14;
    const errors = validateReportStructure(tampered);
    expect(errors.some((e) => e.includes("verdictCounts.STABLE"))).toBe(true);
  });

  it("structure validation catches a FOUND status with a null witness", () => {
    const report = buildAnalysisReport(smallReportInput());
    const tampered = JSON.parse(JSON.stringify(report)) as typeof report;
    tampered.witnesses["F002"].status = "FOUND";
    tampered.witnesses["F002"].witness = null;
    const errors = validateReportStructure(tampered);
    expect(errors.some((e) => e.includes("FOUND requires a non-null witness"))).toBe(true);
  });
});
