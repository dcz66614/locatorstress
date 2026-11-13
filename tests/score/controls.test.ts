// T005 controls test — LIVE recomputation, no hardcoded control results.
//
// Re-runs the frozen 192 single-mutation cases in real Playwright +
// Chromium, classifies each with production classifyVerdict (T004), feeds
// the per-case results into the T005 score module, and checks the
// control-group metrics against the frozen S0 gate values read from
// evidence/s0/S0_GATE.json (not literals typed from memory). The stable
// false-alarm rate (0/96) and fragile detection rate (96/96) are counted
// from the 192 live cases in this test; a module that hardcoded them
// would fail the independent tallies below. Writes
// evidence/s1/T005_SCORE_REPORT.json (recomputable fields only: no
// wall-clock time, no absolute paths, no PIDs).
// Spec: PROJECT_BOOK §5.5 / §5.3 / §12.2; IMPLEMENTATION_PLAN T005.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { BaselineBrowser } from "../../src/runner/browser.js";
import { resolveLocator } from "../../src/runner/locator-resolver.js";
import { isSameElement } from "../../src/oracle/identity-compare.js";
import { classifyVerdict } from "../../src/verdict/classify.js";
import {
  SEED,
  FIXTURE_IDS,
  loadAllFixtureManifests,
} from "../../src/fixtures/fixture-manifest.js";
import {
  loadFixture,
  setFixtureContent,
  captureOriginalTargetForFixture,
  mutationContextForFixture,
} from "../../src/fixtures/fixture-loader.js";
import { MUTATION_ORDER, getMutation } from "../../src/mutations/registry.js";
import {
  computeStabilityScores,
  computeControlMetrics,
  type ScoreCase,
  type Verdict,
} from "../../src/score/stability-score.js";
import {
  launchTestBrowser,
  repoRoot,
} from "../integration/s0-helpers.js";

const S0_GATE_SHA256 =
  "651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52";
const S0_BASE_COMMIT = "ebe5ef4";
const T004_BASE_COMMIT = "5f0df94";

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

interface GoldenCase {
  fixtureId: string;
  mutationId: string;
  expectedVerdict: string;
  reason: string;
}

interface T002Case {
  fixtureId: string;
  mutationId: string;
  expectedVerdict: string | undefined;
  actualVerdict: Verdict | null;
  executionStatus: string;
  rawMatchCount: number;
  finalMatchCount: number;
  frameFailureKind: string | null;
  identityMatch: boolean | null;
  match: boolean;
}

interface CaseLog {
  fixtureId: string;
  mutationId: string;
  locatorKind: string;
  controlGroup: string;
  expectedVerdict: string | undefined;
  actualVerdict: Verdict | null;
  executionStatus: string;
  analysisStatus: string;
  reason: string;
  rawMatchCount: number;
  finalMatchCount: number;
  frameFailureKind: string | null;
  identityMatch: boolean | null;
  matchGolden: boolean;
  matchT002: boolean;
}

describe("T005 controls (live 192-case recomputation)", () => {
  let browserHandle: BaselineBrowser;

  beforeAll(async () => {
    browserHandle = await launchTestBrowser();
  });

  afterAll(async () => {
    await browserHandle.close();
  });

  it(
    "192 live cases: score module recomputes overall/per-locator/per-operator scores and both control metrics",
    async () => {
      const page = browserHandle.page;

      const goldenPath = join(
        repoRoot(),
        "src/fixtures/golden/expected-verdicts.json",
      );
      const goldenRaw = readFileSync(goldenPath, "utf8");
      const goldenParsed = JSON.parse(goldenRaw) as {
        schema: string;
        seed: string;
        cases: GoldenCase[];
      };
      expect(goldenParsed.cases.length).toBe(192);
      expect(goldenParsed.seed).toBe(SEED);
      const golden = new Map<string, string>();
      for (const c of goldenParsed.cases) {
        golden.set(`${c.fixtureId}/${c.mutationId}`, c.expectedVerdict);
      }

      const t002Path = join(
        repoRoot(),
        "evidence/s0/T002_MUTATION_REPORT.json",
      );
      const t002Raw = readFileSync(t002Path, "utf8");
      const t002Parsed = JSON.parse(t002Raw) as {
        schema: string;
        seed: string;
        totals: { matched: number; mismatched: number };
        cases: T002Case[];
      };
      expect(t002Parsed.cases.length).toBe(192);
      expect(t002Parsed.seed).toBe(SEED);
      const t002ByKey = new Map<string, T002Case>();
      for (const c of t002Parsed.cases) {
        t002ByKey.set(`${c.fixtureId}/${c.mutationId}`, c);
      }

      const t004Path = join(
        repoRoot(),
        "evidence/s1/T004_VERDICT_REPORT.json",
      );
      const t004Raw = readFileSync(t004Path, "utf8");

      // Frozen S0 gate control values, read from the file (test oracle).
      const s0GatePath = join(repoRoot(), "evidence", "s0", "S0_GATE.json");
      const s0GateRaw = readFileSync(s0GatePath, "utf8");
      const s0Gate = JSON.parse(s0GateRaw) as {
        hashes: { gate_sha256: string };
        counts: {
          stableControl: { fixtures: number; pairs: number; mismatches: number; falseAlarm: string };
          fragileControl: { fixtures: number; pairs: number; mismatches: number; detected: number };
          stabilityScore: { completed: number; stable: number; score: string };
        };
      };
      expect(s0Gate.hashes.gate_sha256).toBe(S0_GATE_SHA256);
      expect(s0Gate.counts.stableControl.pairs).toBe(96);
      expect(s0Gate.counts.fragileControl.pairs).toBe(96);

      const manifests = loadAllFixtureManifests();
      const manifestById = new Map(manifests.map((m) => [m.fixtureId, m]));
      const caseLogs: CaseLog[] = [];
      const scoreCases: ScoreCase[] = [];

      for (const fixtureId of FIXTURE_IDS) {
        const manifest = manifestById.get(fixtureId);
        if (!manifest) {
          throw new Error(`missing manifest for fixture ${fixtureId}`);
        }
        const fixture = loadFixture(manifest.fixtureId);

        for (const mutationId of MUTATION_ORDER) {
          await setFixtureContent(page, fixture);
          const original = await captureOriginalTargetForFixture(page, manifest);
          const mutation = getMutation(mutationId);
          await mutation.apply(page, original, mutationContextForFixture(manifest));

          const { result, finalHandle } = await resolveLocator(
            page,
            manifest.locator,
          );
          let identityMatch: boolean | null = null;
          if (
            result.executionStatus === "COMPLETED" &&
            result.finalMatchCount === 1 &&
            finalHandle !== null
          ) {
            identityMatch = await isSameElement(page, finalHandle, original);
          }

          const classification = classifyVerdict(result, identityMatch);
          const key = `${manifest.fixtureId}/${mutationId}`;
          const expected = golden.get(key);
          const t002 = t002ByKey.get(key);
          if (!t002) {
            throw new Error(`missing T002 case for ${key}`);
          }
          const matchT002 =
            classification.verdict === t002.actualVerdict &&
            result.executionStatus === t002.executionStatus &&
            result.rawMatchCount === t002.rawMatchCount &&
            result.finalMatchCount === t002.finalMatchCount &&
            (result.frameFailure?.kind ?? null) === t002.frameFailureKind &&
            identityMatch === t002.identityMatch;

          caseLogs.push({
            fixtureId: manifest.fixtureId,
            mutationId,
            locatorKind: manifest.locator.kind,
            controlGroup: manifest.controlGroup,
            expectedVerdict: expected,
            actualVerdict: classification.verdict,
            executionStatus: result.executionStatus,
            analysisStatus: classification.analysisStatus,
            reason: classification.reason,
            rawMatchCount: result.rawMatchCount,
            finalMatchCount: result.finalMatchCount,
            frameFailureKind: result.frameFailure?.kind ?? null,
            identityMatch,
            matchGolden: classification.verdict === expected,
            matchT002,
          });
          scoreCases.push({
            fixtureId: manifest.fixtureId,
            mutationId: mutationId as ScoreCase["mutationId"],
            locatorKind: manifest.locator.kind as ScoreCase["locatorKind"],
            controlGroup: manifest.controlGroup,
            verdict: classification.verdict,
            analysisStatus: classification.analysisStatus,
            expectedVerdict: expected as ScoreCase["expectedVerdict"],
          });
        }
      }

      // The score module counts everything from the 192 live cases above.
      const scores = computeStabilityScores(scoreCases);
      const controls = computeControlMetrics(scoreCases);

      const mismatchesGolden = caseLogs.filter((c) => !c.matchGolden);
      const mismatchesT002 = caseLogs.filter((c) => !c.matchT002);

      // --- Incomplete worked example (synthetic, computed by the module) --
      // 8 expected cases: 5 STABLE, 1 WRONG_TARGET, 1 MISSING, 1 INCOMPLETE.
      // The incomplete case must not enter the score denominator (7, not 8)
      // and must lower coverage (7/8) and force analysisStatus INCOMPLETE.
      const incompleteExample = computeStabilityScores([
        { fixtureId: "X001", mutationId: "M01", locatorKind: "css", verdict: "STABLE", analysisStatus: "COMPLETE" },
        { fixtureId: "X002", mutationId: "M01", locatorKind: "css", verdict: "STABLE", analysisStatus: "COMPLETE" },
        { fixtureId: "X003", mutationId: "M01", locatorKind: "css", verdict: "STABLE", analysisStatus: "COMPLETE" },
        { fixtureId: "X004", mutationId: "M01", locatorKind: "css", verdict: "STABLE", analysisStatus: "COMPLETE" },
        { fixtureId: "X005", mutationId: "M01", locatorKind: "css", verdict: "STABLE", analysisStatus: "COMPLETE" },
        { fixtureId: "X006", mutationId: "M01", locatorKind: "css", verdict: "WRONG_TARGET", analysisStatus: "COMPLETE" },
        { fixtureId: "X007", mutationId: "M01", locatorKind: "css", verdict: "MISSING", analysisStatus: "COMPLETE" },
        { fixtureId: "X008", mutationId: "M01", locatorKind: "css", verdict: null, analysisStatus: "INCOMPLETE" },
      ]).overall;

      const report = {
        schema: "locatorstress.t005-score-report/v1",
        seed: SEED,
        s0BaseCommit: S0_BASE_COMMIT,
        t004BaseCommit: T004_BASE_COMMIT,
        s0GateSha256: S0_GATE_SHA256,
        goldenSha256: sha256Hex(goldenRaw),
        t002ReportSha256: sha256Hex(t002Raw),
        t004ReportSha256: sha256Hex(t004Raw),
        s0GateJsonSha256: sha256Hex(s0GateRaw),
        formula:
          "stability_score = 100 × stable_case_count / completed_mutation_case_count",
        definitions: {
          completed:
            "Cases with a verdict (analysisStatus COMPLETE). Only these enter the score denominator.",
          incomplete:
            "Cases with verdict null (analysisStatus INCOMPLETE). Never counted as STABLE, never in the score denominator; they lower coverage (completed/expected) and force analysisStatus INCOMPLETE.",
          coverage: "100 × completed / expected, shown alongside every score so a high score cannot hide low coverage.",
          scoreMeaning:
            "The score is a proportion over the synthetic mutation set, NOT a production failure probability.",
          stableFalseAlarm:
            "Stable control: mismatches / pairs, where a mismatch is a case whose actual verdict differs from the golden expected verdict (PROJECT_BOOK §12.2). An incomplete case counts as a mismatch.",
          fragileDetection:
            "Fragile control: matched / pairs, where matched means the actual verdict equals the golden expected verdict (S0 gate definition: detected = pairs − mismatches). This is agreement with golden, NOT a count of planted failures; the planted-failure subset (expected verdict != STABLE) is reported separately as plantedDetected / plantedExpected.",
        },
        totals: {
          cases: caseLogs.length,
          completed: scores.overall.completed,
          incomplete: scores.overall.incomplete,
          expected: scores.overall.expected,
          matchedGolden: caseLogs.length - mismatchesGolden.length,
          mismatchedGolden: mismatchesGolden.length,
          matchedT002: caseLogs.length - mismatchesT002.length,
          mismatchedT002: mismatchesT002.length,
          externalRequests: browserHandle.externalRequestCount(),
        },
        overall: scores.overall,
        perLocator: scores.perLocator,
        perOperator: scores.perOperator,
        controls,
        workedExample: {
          overall: "100 × 138 / 192 = 71.875",
          overallNumerator: scores.overall.scoreNumerator,
          overallDenominator: scores.overall.scoreDenominator,
          overallScore: scores.overall.score,
          perLocator: {
            css: "100 × 46 / 64 = 71.875",
            xpath: "100 × 42 / 64 = 65.625",
            role: "100 × 50 / 64 = 78.125",
          },
          perOperator: {
            M01: "100 × 21 / 24 = 87.5",
            M02: "100 × 19 / 24 = 79.167",
            M03: "100 × 22 / 24 = 91.667",
            M04: "100 × 9 / 24 = 37.5",
            M05: "100 × 21 / 24 = 87.5",
            M06: "100 × 12 / 24 = 50",
            M07: "100 × 16 / 24 = 66.667",
            M08: "100 × 18 / 24 = 75",
          },
        },
        incompleteWorkedExample: {
          description:
            "Synthetic 8-case set computed by the score module: 5 STABLE, 1 WRONG_TARGET, 1 MISSING, 1 INCOMPLETE.",
          row: incompleteExample,
          wrongDenominatorCheck:
            "If the incomplete case wrongly entered the denominator, the score would be 100 × 5 / 8 = 62.5; the module gives 100 × 5 / 7 = 71.429.",
        },
        mismatchesGolden: mismatchesGolden.map((c) => ({
          fixtureId: c.fixtureId,
          mutationId: c.mutationId,
          expectedVerdict: c.expectedVerdict,
          actualVerdict: c.actualVerdict,
        })),
        mismatchesT002: mismatchesT002.map((c) => ({
          fixtureId: c.fixtureId,
          mutationId: c.mutationId,
          expectedVerdict: c.expectedVerdict,
          actualVerdict: c.actualVerdict,
        })),
        limitations: [
          "All 192 frozen cases are COMPLETE, so the live run contains no genuine incomplete case; incomplete handling is evidenced by the synthetic worked example above plus the live ERROR probe in this test file (invalid CSS yields verdict null / INCOMPLETE and is excluded from the score denominator).",
          "Fragile detectionRate follows the S0 gate definition (agreement with golden, 96/96); the planted-failure subset is 45/45 and is reported separately under plantedDetectionFraction.",
          "Scores are proportions over the synthetic 24×8 mutation set, not production failure probabilities.",
        ],
        cases: caseLogs,
      };

      const evidenceDir = join(repoRoot(), "evidence", "s1");
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(
        join(evidenceDir, "T005_SCORE_REPORT.json"),
        JSON.stringify(report, null, 2) + "\n",
        "utf8",
      );

      // --- Assertions: module output vs independent tallies + S0 gate -----
      expect(caseLogs.length).toBe(192);
      expect(mismatchesGolden).toEqual([]);
      expect(mismatchesT002).toEqual([]);
      expect(browserHandle.externalRequestCount()).toBe(0);

      // Overall: 138 STABLE of 192 completed = 71.875 (S0_GATE.json agrees).
      expect(scores.overall.stable).toBe(138);
      expect(scores.overall.completed).toBe(192);
      expect(scores.overall.score).toBe("71.875");
      expect(scores.overall.score).toBe(s0Gate.counts.stabilityScore.score);
      expect(scores.overall.stable).toBe(s0Gate.counts.stabilityScore.stable);
      expect(scores.overall.completed).toBe(s0Gate.counts.stabilityScore.completed);
      expect(scores.overall.wrongTarget).toBe(22);
      expect(scores.overall.ambiguous).toBe(17);
      expect(scores.overall.missing).toBe(15);
      expect(scores.overall.coverage).toBe("100");
      expect(scores.overall.analysisStatus).toBe("COMPLETE");

      // Per-locator (each 64 completed): css 46, xpath 42, role 50.
      expect(scores.perLocator.css.stable).toBe(46);
      expect(scores.perLocator.css.score).toBe("71.875");
      expect(scores.perLocator.xpath.stable).toBe(42);
      expect(scores.perLocator.xpath.score).toBe("65.625");
      expect(scores.perLocator.role.stable).toBe(50);
      expect(scores.perLocator.role.score).toBe("78.125");

      // Per-operator stable counts, each out of 24 completed cases.
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

      // Control metrics, counted from the 192 live cases in this test,
      // cross-checked against the frozen S0 gate values.
      expect(controls.stable.fixtures).toBe(12);
      expect(controls.stable.pairs).toBe(96);
      expect(controls.stable.mismatched).toBe(0);
      expect(controls.stable.falseAlarmFraction).toBe("0/96");
      expect(controls.stable.falseAlarmRate).toBe("0");
      expect(controls.stable.falseAlarmFraction).toBe(
        s0Gate.counts.stableControl.falseAlarm,
      );
      expect(controls.stable.mismatched).toBe(
        s0Gate.counts.stableControl.mismatches,
      );
      expect(controls.fragile.fixtures).toBe(12);
      expect(controls.fragile.pairs).toBe(96);
      expect(controls.fragile.matched).toBe(96);
      expect(controls.fragile.detected).toBe(96);
      expect(controls.fragile.detectionFraction).toBe("96/96");
      expect(controls.fragile.detectionRate).toBe("100");
      expect(controls.fragile.detected).toBe(
        s0Gate.counts.fragileControl.detected,
      );
      expect(controls.fragile.mismatched).toBe(
        s0Gate.counts.fragileControl.mismatches,
      );
      // Planted-failure subset (expected != STABLE): stable 9, fragile 45.
      expect(controls.stable.plantedExpected).toBe(9);
      expect(controls.stable.plantedDetected).toBe(9);
      expect(controls.fragile.plantedExpected).toBe(45);
      expect(controls.fragile.plantedDetected).toBe(45);
      expect(controls.fragile.plantedDetectionFraction).toBe("45/45");

      // Incomplete worked example: denominator 7 (not 8), coverage 7/8.
      expect(incompleteExample.score).toBe("71.429");
      expect(incompleteExample.scoreDenominator).toBe(7);
      expect(incompleteExample.coverage).toBe("87.5");
      expect(incompleteExample.analysisStatus).toBe("INCOMPLETE");
    },
    300000,
  );

  it("live ERROR branch: a genuine INCOMPLETE case is excluded from the score denominator", async () => {
    const page = browserHandle.page;
    const manifests = loadAllFixtureManifests();
    const manifest = manifests[0]!;
    const fixture = loadFixture(manifest.fixtureId);
    await setFixtureContent(page, fixture);

    // Syntactically invalid CSS -> resolver ERROR -> no verdict.
    const badCss = await resolveLocator(page, {
      kind: "css",
      selector: "button:not(",
    });
    expect(badCss.result.executionStatus).toBe("ERROR");
    const c = classifyVerdict(badCss.result, null);
    expect(c.verdict).toBeNull();
    expect(c.analysisStatus).toBe("INCOMPLETE");

    // Feed the genuine incomplete case to the score module together with
    // one completed STABLE case: denominator must be 1, not 2.
    const scores = computeStabilityScores([
      {
        fixtureId: manifest.fixtureId,
        mutationId: "M01",
        locatorKind: manifest.locator.kind as ScoreCase["locatorKind"],
        verdict: c.verdict,
        analysisStatus: c.analysisStatus,
      },
      {
        fixtureId: "F002",
        mutationId: "M01",
        locatorKind: "xpath",
        verdict: "STABLE",
        analysisStatus: "COMPLETE",
      },
    ]);
    expect(scores.overall.expected).toBe(2);
    expect(scores.overall.completed).toBe(1);
    expect(scores.overall.incomplete).toBe(1);
    expect(scores.overall.stable).toBe(1);
    expect(scores.overall.score).toBe("100"); // 1/1, not 1/2 = 50
    expect(scores.overall.coverage).toBe("50"); // 1/2 — coverage drops
    expect(scores.overall.analysisStatus).toBe("INCOMPLETE");
  });
});
