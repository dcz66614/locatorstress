// T004 golden integration — production classifyVerdict over the frozen S0
// 192 single-mutation cases (real Playwright + Chromium), compared against
// BOTH the frozen golden matrix and the S0 T002 mutation report (which was
// derived by the independent S0 test helper, not by this classifier).
// Also probes the live ERROR / INVALID_FIXTURE branches end to end.
// Writes evidence/s1/T004_VERDICT_REPORT.json (recomputable fields only:
// no wall-clock time, no absolute paths, no PIDs).
// Spec: PROJECT_BOOK §5.2 / §5.3 / §5.4; IMPLEMENTATION_PLAN T004.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { BaselineBrowser } from "../../src/runner/browser.js";
import { resolveLocator } from "../../src/runner/locator-resolver.js";
import { isSameElement } from "../../src/oracle/identity-compare.js";
import { runBaselineOracle } from "../../src/oracle/oracle-runner.js";
import { classifyVerdict } from "../../src/verdict/classify.js";
import type { LocatorSpecV1 } from "../../src/contracts/locator.js";
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
  launchTestBrowser,
  repoRoot,
  type Verdict,
} from "../integration/s0-helpers.js";

const S0_GATE_SHA256 =
  "651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52";
const S0_BASE_COMMIT = "ebe5ef4";

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

describe("T004 verdict golden (production classifyVerdict, 192 cases)", () => {
  let browserHandle: BaselineBrowser;

  beforeAll(async () => {
    browserHandle = await launchTestBrowser();
  });

  afterAll(async () => {
    await browserHandle.close();
  });

  it(
    "192 cases: classifyVerdict matches golden 192/192 and T002 report 192/192",
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
      expect(t002Parsed.totals.matched).toBe(192);
      expect(t002Parsed.totals.mismatched).toBe(0);
      const t002ByKey = new Map<string, T002Case>();
      for (const c of t002Parsed.cases) {
        t002ByKey.set(`${c.fixtureId}/${c.mutationId}`, c);
      }

      const manifests = loadAllFixtureManifests();
      const manifestById = new Map(manifests.map((m) => [m.fixtureId, m]));
      const caseLogs: CaseLog[] = [];

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
        }
      }

      const verdictCounts: Record<string, number> = {
        STABLE: 0,
        WRONG_TARGET: 0,
        AMBIGUOUS: 0,
        MISSING: 0,
      };
      const verdictCountsByKind: Record<string, Record<string, number>> = {
        css: { STABLE: 0, WRONG_TARGET: 0, AMBIGUOUS: 0, MISSING: 0 },
        xpath: { STABLE: 0, WRONG_TARGET: 0, AMBIGUOUS: 0, MISSING: 0 },
        role: { STABLE: 0, WRONG_TARGET: 0, AMBIGUOUS: 0, MISSING: 0 },
      };
      for (const log of caseLogs) {
        if (log.actualVerdict !== null) {
          verdictCounts[log.actualVerdict] =
            (verdictCounts[log.actualVerdict] ?? 0) + 1;
          const m = manifestById.get(log.fixtureId);
          if (m) {
            const bucket = verdictCountsByKind[m.locator.kind];
            if (bucket) {
              bucket[log.actualVerdict] =
                (bucket[log.actualVerdict] ?? 0) + 1;
            }
          }
        }
      }

      const mismatchesGolden = caseLogs.filter((c) => !c.matchGolden);
      const mismatchesT002 = caseLogs.filter((c) => !c.matchT002);
      const matchedGolden = caseLogs.length - mismatchesGolden.length;
      const matchedT002 = caseLogs.length - mismatchesT002.length;

      const report = {
        schema: "locatorstress.t004-verdict-report/v1",
        seed: SEED,
        s0BaseCommit: S0_BASE_COMMIT,
        s0GateSha256: S0_GATE_SHA256,
        goldenSha256: sha256Hex(goldenRaw),
        t002ReportSha256: sha256Hex(t002Raw),
        totals: {
          cases: caseLogs.length,
          matchedGolden,
          mismatchedGolden: mismatchesGolden.length,
          comparedT002: caseLogs.length,
          matchedT002,
          mismatchedT002: mismatchesT002.length,
          externalRequests: browserHandle.externalRequestCount(),
        },
        verdictCounts: {
          STABLE: verdictCounts.STABLE ?? 0,
          WRONG_TARGET: verdictCounts.WRONG_TARGET ?? 0,
          AMBIGUOUS: verdictCounts.AMBIGUOUS ?? 0,
          MISSING: verdictCounts.MISSING ?? 0,
        },
        verdictCountsByKind,
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
        executionErrorBranches: {
          liveProbedInThisFile: ["ERROR", "INVALID_FIXTURE"],
          unitOnlySyntheticResolverResult: ["TIMEOUT"],
          note: "All 192 golden cases are COMPLETED; error branches are covered by live probes below (ERROR, INVALID_FIXTURE) and by synthetic ResolverResult unit cases in tests/verdict/classify.test.ts (ERROR, TIMEOUT, INVALID_FIXTURE). A live TIMEOUT was not forced: triggering a real Playwright timeout deterministically would require an artificial slow locator and would be flaky, not evidence.",
        },
        limitations: [
          "TIMEOUT branch verified only with a synthetic TIMEOUT ResolverResult in unit tests, not by a live browser timeout.",
          "classifyVerdict trusts the frozen resolver's counts; contradictory counts (negative, non-integer, final > raw) yield INCOMPLETE rather than a verdict.",
        ],
        cases: caseLogs,
      };

      const evidenceDir = join(repoRoot(), "evidence", "s1");
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(
        join(evidenceDir, "T004_VERDICT_REPORT.json"),
        JSON.stringify(report, null, 2) + "\n",
        "utf8",
      );

      expect(caseLogs.length).toBe(192);
      expect(mismatchesGolden).toEqual([]);
      expect(mismatchesT002).toEqual([]);
      expect(verdictCounts.STABLE).toBeGreaterThanOrEqual(8);
      expect(verdictCounts.WRONG_TARGET).toBeGreaterThanOrEqual(8);
      expect(verdictCounts.AMBIGUOUS).toBeGreaterThanOrEqual(8);
      expect(verdictCounts.MISSING).toBeGreaterThanOrEqual(8);
      expect(browserHandle.externalRequestCount()).toBe(0);
      for (const log of caseLogs) {
        expect(log.analysisStatus).toBe("COMPLETE");
      }
    },
    300000,
  );

  it("live ERROR branch: invalid LocatorSpec and invalid CSS selector yield null verdict", async () => {
    const page = browserHandle.page;
    const manifests = loadAllFixtureManifests();
    const manifest = manifests[0]!;
    const fixture = loadFixture(manifest.fixtureId);
    await setFixtureContent(page, fixture);

    // Validation path: unknown kind -> resolver returns ERROR.
    const badKind = await resolveLocator(page, {
      kind: "bogus",
      selector: "button",
    } as unknown as LocatorSpecV1);
    expect(badKind.result.executionStatus).toBe("ERROR");
    const c1 = classifyVerdict(badKind.result, null);
    expect(c1.verdict).toBeNull();
    expect(c1.analysisStatus).toBe("INCOMPLETE");

    // Browser-error path: syntactically invalid CSS -> locator.count() throws.
    const badCss = await resolveLocator(page, {
      kind: "css",
      selector: "button:not(",
    });
    expect(badCss.result.executionStatus).toBe("ERROR");
    const c2 = classifyVerdict(badCss.result, null);
    expect(c2.verdict).toBeNull();
    expect(c2.analysisStatus).toBe("INCOMPLETE");
    expect(c2.verdict).not.toBe("STABLE");
  });

  it("live INVALID_FIXTURE branch: unresolvable Oracle target yields null verdict", async () => {
    const page = browserHandle.page;
    const manifests = loadAllFixtureManifests();
    const manifest = manifests[0]!;
    const fixture = loadFixture(manifest.fixtureId);
    await setFixtureContent(page, fixture);

    const oracle = await runBaselineOracle(
      page,
      manifest.locator,
      "body >> text=NoSuchTargetAnywhere",
    );
    expect(oracle.resolverResult.executionStatus).toBe("INVALID_FIXTURE");
    expect(oracle.identityMatch).toBeNull();
    const c = classifyVerdict(oracle.resolverResult, oracle.identityMatch);
    expect(c.verdict).toBeNull();
    expect(c.analysisStatus).toBe("INCOMPLETE");
    expect(c.verdict).not.toBe("STABLE");
  });
});
