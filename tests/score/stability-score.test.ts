// T005 unit tests — pure score computation, no browser.
// Covers the §5.5 formula, denominator/coverage rules, the incomplete
// rule (verdict null never counts as STABLE, never enters the score
// denominator, lowers coverage, forces analysisStatus INCOMPLETE), the
// per-locator / per-operator breakdowns, and an independent recomputation
// of the frozen 192 cases from evidence/s1/T004_VERDICT_REPORT.json
// (per-case data tallied by plain loops in this test, not by the module).
// Spec: PROJECT_BOOK §5.5 / §5.3; IMPLEMENTATION_PLAN T005.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  computeStabilityScores,
  computeControlMetrics,
  formatPercent,
  type ScoreCase,
  type ScoreRow,
} from "../../src/score/stability-score.js";
import { repoRoot } from "../integration/s0-helpers.js";

function sc(
  overrides: Partial<ScoreCase> & { fixtureId: string },
): ScoreCase {
  return {
    mutationId: "M01",
    locatorKind: "css",
    verdict: "STABLE",
    analysisStatus: "COMPLETE",
    ...overrides,
  };
}

describe("formatPercent (exact decimal, half-up to 3 dp)", () => {
  it("renders the known overall value exactly: 100 × 138 / 192 = 71.875", () => {
    expect(formatPercent(138, 192)).toBe("71.875");
  });
  it("trims trailing zeros: 21/24 = 87.5, 24/24 = 100", () => {
    expect(formatPercent(21, 24)).toBe("87.5");
    expect(formatPercent(24, 24)).toBe("100");
    expect(formatPercent(0, 96)).toBe("0");
  });
  it("rounds half-up to 3 dp: 19/24 = 79.167, 22/24 = 91.667, 5/7 = 71.429", () => {
    expect(formatPercent(19, 24)).toBe("79.167");
    expect(formatPercent(22, 24)).toBe("91.667");
    expect(formatPercent(5, 7)).toBe("71.429");
  });
  it("returns null on a zero denominator, never NaN or Infinity", () => {
    expect(formatPercent(0, 0)).toBeNull();
    expect(formatPercent(5, 0)).toBeNull();
  });
  it("rejects non-integer / negative inputs", () => {
    expect(() => formatPercent(1.5, 2)).toThrow();
    expect(() => formatPercent(-1, 2)).toThrow();
  });
});

describe("computeStabilityScores — formula and denominator", () => {
  it("overall: score = 100 × stable / completed, with separate verdict counts", () => {
    const cases: ScoreCase[] = [
      sc({ fixtureId: "F001", verdict: "STABLE" }),
      sc({ fixtureId: "F002", verdict: "STABLE" }),
      sc({ fixtureId: "F003", verdict: "WRONG_TARGET" }),
      sc({ fixtureId: "F004", verdict: "AMBIGUOUS" }),
      sc({ fixtureId: "F005", verdict: "MISSING" }),
    ];
    const { overall } = computeStabilityScores(cases);
    expect(overall.stable).toBe(2);
    expect(overall.wrongTarget).toBe(1);
    expect(overall.ambiguous).toBe(1);
    expect(overall.missing).toBe(1);
    expect(overall.incomplete).toBe(0);
    expect(overall.completed).toBe(5);
    expect(overall.expected).toBe(5);
    expect(overall.scoreNumerator).toBe(2);
    expect(overall.scoreDenominator).toBe(5);
    expect(overall.score).toBe("40");
    expect(overall.coverageNumerator).toBe(5);
    expect(overall.coverageDenominator).toBe(5);
    expect(overall.coverage).toBe("100");
    expect(overall.analysisStatus).toBe("COMPLETE");
  });

  it("empty input: score and coverage are null, not 0 or NaN", () => {
    const { overall, perLocator, perOperator } = computeStabilityScores([]);
    expect(overall.score).toBeNull();
    expect(overall.coverage).toBeNull();
    expect(overall.scoreNumerator).toBe(0);
    expect(overall.scoreDenominator).toBe(0);
    expect(overall.analysisStatus).toBe("COMPLETE");
    expect(perLocator.css.expected).toBe(0);
    expect(perOperator).toEqual({});
  });

  it("all-incomplete group: score null, coverage 0, INCOMPLETE", () => {
    const cases: ScoreCase[] = [
      sc({ fixtureId: "F001", verdict: null, analysisStatus: "INCOMPLETE" }),
      sc({ fixtureId: "F002", verdict: null, analysisStatus: "INCOMPLETE" }),
    ];
    const { overall } = computeStabilityScores(cases);
    expect(overall.score).toBeNull();
    expect(overall.coverage).toBe("0");
    expect(overall.completed).toBe(0);
    expect(overall.expected).toBe(2);
    expect(overall.incomplete).toBe(2);
    expect(overall.analysisStatus).toBe("INCOMPLETE");
  });

  it("splits per-locator and per-operator rows; absent kinds stay at 0", () => {
    const cases: ScoreCase[] = [
      sc({ fixtureId: "F001", mutationId: "M01", locatorKind: "css", verdict: "STABLE" }),
      sc({ fixtureId: "F002", mutationId: "M01", locatorKind: "xpath", verdict: "MISSING" }),
      sc({ fixtureId: "F003", mutationId: "M02", locatorKind: "css", verdict: "STABLE" }),
      sc({ fixtureId: "F004", mutationId: "M02", locatorKind: "role", verdict: "WRONG_TARGET" }),
    ];
    const { overall, perLocator, perOperator } = computeStabilityScores(cases);
    expect(overall.score).toBe("50"); // 2/4
    expect(perLocator.css.score).toBe("100"); // 2/2
    expect(perLocator.xpath.score).toBe("0"); // 0/1
    expect(perLocator.role.score).toBe("0"); // 0/1
    expect(perLocator.role.wrongTarget).toBe(1);
    expect(perOperator.M01?.score).toBe("50"); // 1/2
    expect(perOperator.M02?.score).toBe("50"); // 1/2
    expect(perOperator.M03).toBeUndefined(); // absent operator: no row
  });
});

describe("computeStabilityScores — incomplete cases", () => {
  it("INCOMPLETE is not STABLE, not in the denominator, lowers coverage, forces INCOMPLETE", () => {
    // Worked example (also embedded in T005_SCORE_REPORT.json):
    // 8 expected cases: 5 STABLE, 1 WRONG_TARGET, 1 MISSING, 1 INCOMPLETE.
    const cases: ScoreCase[] = [
      sc({ fixtureId: "F001", verdict: "STABLE" }),
      sc({ fixtureId: "F002", verdict: "STABLE" }),
      sc({ fixtureId: "F003", verdict: "STABLE" }),
      sc({ fixtureId: "F004", verdict: "STABLE" }),
      sc({ fixtureId: "F005", verdict: "STABLE" }),
      sc({ fixtureId: "F006", verdict: "WRONG_TARGET" }),
      sc({ fixtureId: "F007", verdict: "MISSING" }),
      sc({ fixtureId: "F008", verdict: null, analysisStatus: "INCOMPLETE" }),
    ];
    const { overall } = computeStabilityScores(cases);
    expect(overall.stable).toBe(5);
    expect(overall.incomplete).toBe(1);
    expect(overall.completed).toBe(7); // denominator excludes the incomplete case
    expect(overall.expected).toBe(8);
    expect(overall.scoreNumerator).toBe(5);
    expect(overall.scoreDenominator).toBe(7);
    expect(overall.score).toBe("71.429"); // 100 × 5 / 7, NOT 100 × 5 / 8
    expect(overall.coverage).toBe("87.5"); // 7/8 — coverage drops
    expect(overall.analysisStatus).toBe("INCOMPLETE");
    // The naive wrong denominator (8) would give 62.5; assert it is not that.
    expect(overall.score).not.toBe("62.5");
  });

  it("an incomplete case in one locator poisons only that locator's status, not the others", () => {
    const cases: ScoreCase[] = [
      sc({ fixtureId: "F001", locatorKind: "css", verdict: "STABLE" }),
      sc({ fixtureId: "F002", locatorKind: "xpath", verdict: null, analysisStatus: "INCOMPLETE" }),
    ];
    const { overall, perLocator } = computeStabilityScores(cases);
    expect(overall.analysisStatus).toBe("INCOMPLETE");
    expect(overall.score).toBe("100"); // 1/1 completed
    expect(overall.coverage).toBe("50"); // 1/2
    expect(perLocator.css.analysisStatus).toBe("COMPLETE");
    expect(perLocator.xpath.analysisStatus).toBe("INCOMPLETE");
    expect(perLocator.xpath.score).toBeNull();
    expect(perLocator.role.analysisStatus).toBe("COMPLETE");
  });

  it("rejects contradictory input instead of guessing: verdict + INCOMPLETE, or null + COMPLETE", () => {
    expect(() =>
      computeStabilityScores([
        sc({ fixtureId: "F001", verdict: "STABLE", analysisStatus: "INCOMPLETE" }),
      ]),
    ).toThrow(/INCOMPLETE/);
    expect(() =>
      computeStabilityScores([
        sc({ fixtureId: "F001", verdict: null, analysisStatus: "COMPLETE" }),
      ]),
    ).toThrow(/COMPLETE/);
  });

  it("rejects unknown mutationId / locatorKind instead of silently grouping them", () => {
    expect(() =>
      computeStabilityScores([
        sc({ fixtureId: "F001", mutationId: "M09" as never }),
      ]),
    ).toThrow(/M09/);
    expect(() =>
      computeStabilityScores([
        sc({ fixtureId: "F001", locatorKind: "playwright" as never }),
      ]),
    ).toThrow(/playwright/);
  });
});

describe("computeControlMetrics — unit level", () => {
  it("stable false alarms and fragile detection are counted from cases, incl. incomplete as mismatch", () => {
    const cases: ScoreCase[] = [
      // Stable group: 3 pairs, 1 mismatch (actual != golden), 1 incomplete.
      sc({ fixtureId: "F001", controlGroup: "stable", verdict: "STABLE", expectedVerdict: "STABLE" }),
      sc({ fixtureId: "F001", mutationId: "M02", controlGroup: "stable", verdict: "MISSING", expectedVerdict: "STABLE" }),
      sc({ fixtureId: "F002", controlGroup: "stable", verdict: null, analysisStatus: "INCOMPLETE", expectedVerdict: "STABLE" }),
      // Fragile group: 2 pairs, both match golden (1 planted non-STABLE detected).
      sc({ fixtureId: "F003", controlGroup: "fragile", verdict: "STABLE", expectedVerdict: "STABLE" }),
      sc({ fixtureId: "F003", mutationId: "M02", controlGroup: "fragile", verdict: "WRONG_TARGET", expectedVerdict: "WRONG_TARGET" }),
    ];
    const { stable, fragile } = computeControlMetrics(cases);
    expect(stable.fixtures).toBe(2);
    expect(stable.pairs).toBe(3);
    expect(stable.matched).toBe(1);
    expect(stable.mismatched).toBe(2); // wrong verdict + incomplete
    expect(stable.falseAlarms).toBe(2);
    expect(stable.falseAlarmFraction).toBe("2/3");
    expect(stable.falseAlarmRate).toBe("66.667");
    expect(stable.incomplete).toBe(1);
    expect(stable.analysisStatus).toBe("INCOMPLETE");
    expect(fragile.pairs).toBe(2);
    expect(fragile.matched).toBe(2);
    expect(fragile.detected).toBe(2);
    expect(fragile.detectionFraction).toBe("2/2");
    expect(fragile.detectionRate).toBe("100");
    expect(fragile.plantedExpected).toBe(1);
    expect(fragile.plantedDetected).toBe(1);
    expect(fragile.plantedDetectionFraction).toBe("1/1");
    expect(fragile.analysisStatus).toBe("COMPLETE");
  });

  it("throws when controlGroup or expectedVerdict is missing — never guesses", () => {
    expect(() =>
      computeControlMetrics([sc({ fixtureId: "F001", verdict: "STABLE" })]),
    ).toThrow(/controlGroup/);
    expect(() =>
      computeControlMetrics([
        sc({ fixtureId: "F001", controlGroup: "stable", verdict: "STABLE" }),
      ]),
    ).toThrow(/expectedVerdict/);
  });
});

// --- Frozen 192-case recomputation (file-based, no browser) -------------
// The per-case data comes from evidence/s1/T004_VERDICT_REPORT.json
// (live Playwright + classifyVerdict, 192 cases). This test tallies the
// same cases a second time with plain loops — independent of the module —
// and checks the module's rows against that tally and against the known
// S0 expectations from the task statement (overall 138/192, css 46/64,
// xpath 42/64, role 50/64). The literals are the test oracle; the module
// itself contains no 192-case constants.

interface T004Case {
  fixtureId: string;
  mutationId: string;
  expectedVerdict: string;
  actualVerdict: string | null;
  analysisStatus: string;
}

interface T004Report {
  cases: T004Case[];
}

function tally(
  rows: { verdict: string | null; key: string }[],
): Record<string, number> {
  const t: Record<string, number> = {
    STABLE: 0,
    WRONG_TARGET: 0,
    AMBIGUOUS: 0,
    MISSING: 0,
    incomplete: 0,
    completed: 0,
    expected: 0,
  };
  for (const r of rows) {
    t.expected = (t.expected ?? 0) + 1;
    if (r.verdict === null) {
      t.incomplete = (t.incomplete ?? 0) + 1;
    } else {
      t.completed = (t.completed ?? 0) + 1;
      t[r.verdict] = (t[r.verdict] ?? 0) + 1;
    }
  }
  return t;
}

function expectRowMatchesTally(row: ScoreRow, t: Record<string, number>): void {
  expect(row.stable).toBe(t.STABLE);
  expect(row.wrongTarget).toBe(t.WRONG_TARGET);
  expect(row.ambiguous).toBe(t.AMBIGUOUS);
  expect(row.missing).toBe(t.MISSING);
  expect(row.incomplete).toBe(t.incomplete);
  expect(row.completed).toBe(t.completed);
  expect(row.expected).toBe(t.expected);
  expect(row.scoreNumerator).toBe(t.STABLE);
  expect(row.scoreDenominator).toBe(t.completed);
  expect(row.coverageNumerator).toBe(t.completed);
  expect(row.coverageDenominator).toBe(t.expected);
}

describe("frozen 192 cases recomputed from T004 report (no browser)", () => {
  it("overall / per-locator / per-operator scores match an independent tally and the known S0 values", () => {
    const report = JSON.parse(
      readFileSync(
        join(repoRoot(), "evidence", "s1", "T004_VERDICT_REPORT.json"),
        "utf8",
      ),
    ) as T004Report;
    expect(report.cases.length).toBe(192);

    const manifests = JSON.parse(
      readFileSync(
        join(repoRoot(), "src", "fixtures", "golden", "expected-verdicts.json"),
        "utf8",
      ),
    ) as { cases: { fixtureId: string }[] };
    expect(manifests.cases.length).toBe(192);

    // kind + controlGroup come from the frozen oracle manifests.
    const kindByFixture = new Map<string, string>();
    const groupByFixture = new Map<string, string>();
    for (const fixtureId of new Set(report.cases.map((c) => c.fixtureId))) {
      const m = JSON.parse(
        readFileSync(
          join(repoRoot(), "src", "fixtures", "oracle-manifests", `${fixtureId}.json`),
          "utf8",
        ),
      ) as { kind: string; controlGroup: string };
      kindByFixture.set(fixtureId, m.kind);
      groupByFixture.set(fixtureId, m.controlGroup);
    }

    const cases: ScoreCase[] = report.cases.map((c) => ({
      fixtureId: c.fixtureId,
      mutationId: c.mutationId as ScoreCase["mutationId"],
      locatorKind: kindByFixture.get(c.fixtureId) as ScoreCase["locatorKind"],
      controlGroup: groupByFixture.get(c.fixtureId) as ScoreCase["controlGroup"],
      verdict: c.actualVerdict as ScoreCase["verdict"],
      analysisStatus: c.analysisStatus as ScoreCase["analysisStatus"],
      expectedVerdict: c.expectedVerdict as ScoreCase["expectedVerdict"],
    }));

    const scores = computeStabilityScores(cases);

    // Independent tally with plain loops (not the module under test).
    const byKind = new Map<string, { verdict: string | null; key: string }[]>();
    const byOp = new Map<string, { verdict: string | null; key: string }[]>();
    const all: { verdict: string | null; key: string }[] = [];
    for (const c of cases) {
      const row = { verdict: c.verdict, key: c.fixtureId };
      all.push(row);
      const k = byKind.get(c.locatorKind) ?? [];
      k.push(row);
      byKind.set(c.locatorKind, k);
      const o = byOp.get(c.mutationId) ?? [];
      o.push(row);
      byOp.set(c.mutationId, o);
    }
    expectRowMatchesTally(scores.overall, tally(all));
    for (const kind of ["css", "xpath", "role"] as const) {
      expectRowMatchesTally(
        scores.perLocator[kind],
        tally(byKind.get(kind) ?? []),
      );
    }
    for (const op of ["M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08"] as const) {
      expectRowMatchesTally(
        scores.perOperator[op]!,
        tally(byOp.get(op) ?? []),
      );
    }

    // Known S0 expectations (task statement): overall 138/192 = 71.875.
    expect(scores.overall.stable).toBe(138);
    expect(scores.overall.completed).toBe(192);
    expect(scores.overall.expected).toBe(192);
    expect(scores.overall.score).toBe("71.875");
    expect(scores.overall.coverage).toBe("100");
    expect(scores.overall.analysisStatus).toBe("COMPLETE");
    expect(scores.perLocator.css.stable).toBe(46);
    expect(scores.perLocator.css.score).toBe("71.875"); // 46/64
    expect(scores.perLocator.xpath.stable).toBe(42);
    expect(scores.perLocator.xpath.score).toBe("65.625"); // 42/64
    expect(scores.perLocator.role.stable).toBe(50);
    expect(scores.perLocator.role.score).toBe("78.125"); // 50/64
    // Per-operator stable counts (each out of 24 completed cases).
    const opStable: Record<string, number> = {
      M01: 21,
      M02: 19,
      M03: 22,
      M04: 9,
      M05: 21,
      M06: 12,
      M07: 16,
      M08: 18,
    };
    for (const [op, stable] of Object.entries(opStable)) {
      const row = scores.perOperator[op as keyof typeof scores.perOperator]!;
      expect(row.stable).toBe(stable);
      expect(row.completed).toBe(24);
      expect(row.coverage).toBe("100");
    }
    expect(scores.perOperator.M01?.score).toBe("87.5");
    expect(scores.perOperator.M02?.score).toBe("79.167");
    expect(scores.perOperator.M03?.score).toBe("91.667");
    expect(scores.perOperator.M04?.score).toBe("37.5");
    expect(scores.perOperator.M05?.score).toBe("87.5");
    expect(scores.perOperator.M06?.score).toBe("50");
    expect(scores.perOperator.M07?.score).toBe("66.667");
    expect(scores.perOperator.M08?.score).toBe("75");

    // Control metrics from the same 192 per-case rows (not from constants).
    const controls = computeControlMetrics(cases);
    expect(controls.stable.fixtures).toBe(12);
    expect(controls.stable.pairs).toBe(96);
    expect(controls.stable.mismatched).toBe(0);
    expect(controls.stable.falseAlarmFraction).toBe("0/96");
    expect(controls.stable.falseAlarmRate).toBe("0");
    expect(controls.fragile.fixtures).toBe(12);
    expect(controls.fragile.pairs).toBe(96);
    expect(controls.fragile.matched).toBe(96);
    expect(controls.fragile.detected).toBe(96);
    expect(controls.fragile.detectionFraction).toBe("96/96");
    expect(controls.fragile.detectionRate).toBe("100");
    // Planted-failure subset (expected != STABLE), reported separately:
    // stable 9 expected non-STABLE, fragile 45 expected non-STABLE,
    // all detected as golden predicts.
    expect(controls.stable.plantedExpected).toBe(9);
    expect(controls.stable.plantedDetected).toBe(9);
    expect(controls.fragile.plantedExpected).toBe(45);
    expect(controls.fragile.plantedDetected).toBe(45);
    expect(controls.fragile.plantedDetectionFraction).toBe("45/45");
  });
});
