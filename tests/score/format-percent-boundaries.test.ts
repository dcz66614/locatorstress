// T011 — formatPercent rounding boundaries + score validation edges
// (PROJECT_BOOK §5.5; src/score/stability-score.ts).
//
// The existing tests pin common values (71.875, 87.5, 100, 0, 79.167,
// 91.667, 71.429) but never the exact-half boundary: a value whose 4th
// decimal is exactly 5 must round HALF-UP (0.0005 -> 0.001), which is
// exactly what the BigInt constant 200000n implements. A mutant that
// turns the rounding into truncation (100000n) or swaps the operands
// is only killed by these rows. Also pins: empty input rows, the
// verdict/analysisStatus contradiction throws, and empty control groups.

import { describe, it, expect } from "vitest";

import {
  computeControlMetrics,
  computeStabilityScores,
  formatPercent,
  type ScoreCase,
} from "../../src/score/stability-score.js";

describe("formatPercent — exact-half (half-up) boundaries", () => {
  it("rounds an exact half-thousandth up: 100*1/200000 = 0.0005 -> 0.001", () => {
    expect(formatPercent(1, 200000)).toBe("0.001");
  });

  it("rounds 100*3/200000 = 0.0015 -> 0.002 (half-up, not banker's)", () => {
    expect(formatPercent(3, 200000)).toBe("0.002");
  });

  it("rounds 100*1/8000 = 0.0125 -> 0.013 (half-up, not truncation 0.012)", () => {
    expect(formatPercent(1, 8000)).toBe("0.013");
  });

  it("rounds 100*1/16000 = 0.00625 -> 0.006 (4th decimal 2 < 5, rounds down)", () => {
    expect(formatPercent(1, 16000)).toBe("0.006");
  });

  it("rounds 100*3/16000 = 0.01875 -> 0.019 (4th decimal 7 > 5)", () => {
    expect(formatPercent(3, 16000)).toBe("0.019");
  });

  it("rounds 100*1/6 = 16.666.. -> 16.667", () => {
    expect(formatPercent(1, 6)).toBe("16.667");
  });

  it("rounds 100*2/3 = 66.666.. -> 66.667", () => {
    expect(formatPercent(2, 3)).toBe("66.667");
  });

  it("rounds 100*1/3 = 33.333.. -> 33.333", () => {
    expect(formatPercent(1, 3)).toBe("33.333");
  });

  it("trims trailing zeros: 100*1/8 = 12.5, 100*1/40 = 2.5, 100*1/16 = 6.25", () => {
    expect(formatPercent(1, 8)).toBe("12.5");
    expect(formatPercent(1, 40)).toBe("2.5");
    expect(formatPercent(1, 16)).toBe("6.25");
  });

  it("handles the full S0 scale: 138/192, 0/192, 192/192", () => {
    expect(formatPercent(138, 192)).toBe("71.875");
    expect(formatPercent(0, 192)).toBe("0");
    expect(formatPercent(192, 192)).toBe("100");
  });

  it("handles large counts exactly (no float drift): 999999/1000000", () => {
    expect(formatPercent(999999, 1000000)).toBe("100");
  });

  it("returns null whenever the denominator is 0, regardless of numerator", () => {
    expect(formatPercent(0, 0)).toBeNull();
    expect(formatPercent(5, 0)).toBeNull();
  });

  it("throws on non-integer or negative inputs", () => {
    expect(() => formatPercent(1.5, 2)).toThrow(/integers/);
    expect(() => formatPercent(1, 2.5)).toThrow(/integers/);
    expect(() => formatPercent(-1, 2)).toThrow(/non-negative/);
    expect(() => formatPercent(1, -2)).toThrow(/non-negative/);
  });
});

function completeCase(overrides: Partial<ScoreCase>): ScoreCase {
  return {
    fixtureId: "F001",
    mutationId: "M01",
    locatorKind: "css",
    verdict: "STABLE",
    analysisStatus: "COMPLETE",
    ...overrides,
  };
}

describe("computeStabilityScores — empty and single-case edges", () => {
  it("empty input gives all-zero rows with null scores and COMPLETE status", () => {
    const out = computeStabilityScores([]);
    expect(out.overall.expected).toBe(0);
    expect(out.overall.completed).toBe(0);
    expect(out.overall.score).toBeNull();
    expect(out.overall.coverage).toBeNull();
    expect(out.overall.analysisStatus).toBe("COMPLETE");
    for (const kind of ["css", "xpath", "role"] as const) {
      expect(out.perLocator[kind].expected).toBe(0);
      expect(out.perLocator[kind].score).toBeNull();
    }
    expect(out.perOperator).toEqual({});
  });

  it("a single incomplete case: score null, coverage 0, status INCOMPLETE", () => {
    const out = computeStabilityScores([
      completeCase({ verdict: null, analysisStatus: "INCOMPLETE" }),
    ]);
    expect(out.overall.score).toBeNull();
    expect(out.overall.coverage).toBe("0");
    expect(out.overall.analysisStatus).toBe("INCOMPLETE");
    expect(out.overall.incomplete).toBe(1);
    expect(out.overall.completed).toBe(0);
  });

  it("a single STABLE case: score 100, coverage 100", () => {
    const out = computeStabilityScores([completeCase({})]);
    expect(out.overall.score).toBe("100");
    expect(out.overall.coverage).toBe("100");
    expect(out.perOperator.M01?.score).toBe("100");
  });

  it("perOperator only contains operators present in the input, in M01-M08 order", () => {
    const out = computeStabilityScores([
      completeCase({ mutationId: "M08" }),
      completeCase({ fixtureId: "F002", mutationId: "M01" }),
    ]);
    expect(Object.keys(out.perOperator)).toEqual(["M01", "M08"]);
  });

  it("score denominator is completed, not expected: 1 stable + 1 incomplete -> 100, coverage 50", () => {
    const out = computeStabilityScores([
      completeCase({}),
      completeCase({ fixtureId: "F002", verdict: null, analysisStatus: "INCOMPLETE" }),
    ]);
    expect(out.overall.score).toBe("100");
    expect(out.overall.scoreNumerator).toBe(1);
    expect(out.overall.scoreDenominator).toBe(1);
    expect(out.overall.coverage).toBe("50");
  });

  it("verdict/analysisStatus contradictions throw instead of being counted", () => {
    expect(() =>
      computeStabilityScores([completeCase({ verdict: null, analysisStatus: "COMPLETE" })]),
    ).toThrow(/verdict is null but analysisStatus is COMPLETE/);
    expect(() =>
      computeStabilityScores([completeCase({ verdict: "STABLE", analysisStatus: "INCOMPLETE" })]),
    ).toThrow(/verdict is STABLE but analysisStatus is INCOMPLETE/);
  });

  it("unknown locatorKind / mutationId / controlGroup / verdict throw", () => {
    expect(() =>
      computeStabilityScores([completeCase({ locatorKind: "text" as never })]),
    ).toThrow(/unknown locatorKind/);
    expect(() =>
      computeStabilityScores([completeCase({ mutationId: "M09" as never })]),
    ).toThrow(/unknown mutationId/);
    expect(() =>
      computeStabilityScores([completeCase({ controlGroup: "mixed" as never })]),
    ).toThrow(/unknown controlGroup/);
    expect(() =>
      computeStabilityScores([completeCase({ verdict: "MAYBE" as never })]),
    ).toThrow(/unknown verdict/);
    expect(() => computeStabilityScores([completeCase({ fixtureId: "" })])).toThrow(
      /non-empty fixtureId/,
    );
  });

  it("counts are exact over all four verdicts in one row", () => {
    const out = computeStabilityScores([
      completeCase({ fixtureId: "F001", verdict: "STABLE" }),
      completeCase({ fixtureId: "F002", verdict: "WRONG_TARGET" }),
      completeCase({ fixtureId: "F003", verdict: "AMBIGUOUS" }),
      completeCase({ fixtureId: "F004", verdict: "MISSING" }),
      completeCase({ fixtureId: "F005", verdict: null, analysisStatus: "INCOMPLETE" }),
    ]);
    expect(out.overall.stable).toBe(1);
    expect(out.overall.wrongTarget).toBe(1);
    expect(out.overall.ambiguous).toBe(1);
    expect(out.overall.missing).toBe(1);
    expect(out.overall.incomplete).toBe(1);
    expect(out.overall.expected).toBe(5);
    expect(out.overall.completed).toBe(4);
    expect(out.overall.score).toBe("25");
    expect(out.overall.coverage).toBe("80");
  });
});

describe("computeControlMetrics — empty and planted-subset edges", () => {
  function controlCase(overrides: Partial<ScoreCase>): ScoreCase {
    return completeCase({
      controlGroup: "stable",
      expectedVerdict: "STABLE",
      ...overrides,
    });
  }

  it("empty input gives 0/0 fractions and null rates for both groups", () => {
    const out = computeControlMetrics([]);
    expect(out.stable.pairs).toBe(0);
    expect(out.stable.falseAlarmRate).toBeNull();
    expect(out.stable.falseAlarmFraction).toBe("0/0");
    expect(out.stable.plantedDetectionRate).toBeNull();
    expect(out.fragile.pairs).toBe(0);
    expect(out.fragile.detectionRate).toBeNull();
  });

  it("a group with only STABLE-expected cases has plantedExpected 0 and null planted rate", () => {
    const out = computeControlMetrics([controlCase({})]);
    expect(out.stable.plantedExpected).toBe(0);
    expect(out.stable.plantedDetected).toBe(0);
    expect(out.stable.plantedDetectionRate).toBeNull();
    expect(out.stable.plantedDetectionFraction).toBe("0/0");
  });

  it("incomplete cases count as mismatches, never as matches", () => {
    const out = computeControlMetrics([
      controlCase({}),
      controlCase({
        fixtureId: "F002",
        verdict: null,
        analysisStatus: "INCOMPLETE",
      }),
    ]);
    expect(out.stable.matched).toBe(1);
    expect(out.stable.mismatched).toBe(1);
    expect(out.stable.falseAlarmFraction).toBe("1/2");
    expect(out.stable.falseAlarmRate).toBe("50");
    expect(out.stable.analysisStatus).toBe("INCOMPLETE");
  });

  it("throws when a case lacks controlGroup or expectedVerdict", () => {
    expect(() => computeControlMetrics([completeCase({})])).toThrow(
      /Control metrics require controlGroup/,
    );
    expect(() =>
      computeControlMetrics([completeCase({ controlGroup: "stable" })]),
    ).toThrow(/Control metrics require expectedVerdict/);
  });

  it("fragile planted subset: only non-STABLE expected cases count as planted", () => {
    const out = computeControlMetrics([
      controlCase({ controlGroup: "fragile", expectedVerdict: "STABLE", verdict: "STABLE" }),
      controlCase({
        controlGroup: "fragile",
        fixtureId: "F002",
        expectedVerdict: "MISSING",
        verdict: "MISSING",
      }),
      controlCase({
        controlGroup: "fragile",
        fixtureId: "F003",
        expectedVerdict: "WRONG_TARGET",
        verdict: "STABLE",
      }),
    ]);
    expect(out.fragile.plantedExpected).toBe(2);
    expect(out.fragile.plantedDetected).toBe(1);
    expect(out.fragile.plantedDetectionRate).toBe("50");
    expect(out.fragile.detectionFraction).toBe("2/3");
    expect(out.fragile.detectionRate).toBe("66.667");
  });
});
