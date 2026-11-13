import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { BaselineBrowser } from "../../src/runner/browser.js";
import { resolveLocator } from "../../src/runner/locator-resolver.js";
import { isSameElement } from "../../src/oracle/identity-compare.js";
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
  deriveVerdict,
  type Verdict,
} from "./s0-helpers.js";

interface CaseLog {
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

describe("S0 mutations", () => {
  let browserHandle: BaselineBrowser;
  let golden: Map<string, string>;

  beforeAll(async () => {
    browserHandle = await launchTestBrowser();
    const goldenPath = join(
      repoRoot(),
      "src/fixtures/golden/expected-verdicts.json",
    );
    const parsed = JSON.parse(readFileSync(goldenPath, "utf8")) as {
      schema: string;
      seed: string;
      cases: Array<{
        fixtureId: string;
        mutationId: string;
        expectedVerdict: string;
        reason: string;
      }>;
    };
    expect(parsed.cases.length).toBe(192);
    expect(parsed.seed).toBe(SEED);
    golden = new Map();
    for (const c of parsed.cases) {
      golden.set(`${c.fixtureId}/${c.mutationId}`, c.expectedVerdict);
    }
  });

  afterAll(async () => {
    await browserHandle.close();
  });

  it(
    "192 single-mutation cases match the hand-derived golden matrix",
    async () => {
      const page = browserHandle.page;
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

          const { result, finalHandle } = await resolveLocator(page, manifest.locator);
          let identityMatch: boolean | null = null;
          if (
            result.executionStatus === "COMPLETED" &&
            result.finalMatchCount === 1 &&
            finalHandle !== null
          ) {
            identityMatch = await isSameElement(page, finalHandle, original);
          }

          const actualVerdict = deriveVerdict(result, identityMatch);
          const key = `${manifest.fixtureId}/${mutationId}`;
          const expected = golden.get(key);

          caseLogs.push({
            fixtureId: manifest.fixtureId,
            mutationId,
            expectedVerdict: expected,
            actualVerdict,
            executionStatus: result.executionStatus,
            rawMatchCount: result.rawMatchCount,
            finalMatchCount: result.finalMatchCount,
            frameFailureKind: result.frameFailure?.kind ?? null,
            identityMatch,
            match: actualVerdict === expected,
          });
        }
      }

      // verdict counts (actual, non-null)
      const verdictCounts: Record<string, number> = {
        STABLE: 0,
        WRONG_TARGET: 0,
        AMBIGUOUS: 0,
        MISSING: 0,
      };
      for (const log of caseLogs) {
        if (log.actualVerdict !== null) {
          verdictCounts[log.actualVerdict] = (verdictCounts[log.actualVerdict] ?? 0) + 1;
        }
      }

      // coverage
      let cssFixtures = 0;
      let xpathFixtures = 0;
      let roleFixtures = 0;
      let framePathFixtures = 0;
      let indexFixtures = 0;
      let twoLayerFramePathFixtures = 0;
      for (const manifest of manifests) {
        if (manifest.locator.kind === "css") cssFixtures += 1;
        if (manifest.locator.kind === "xpath") xpathFixtures += 1;
        if (manifest.locator.kind === "role") roleFixtures += 1;
        const framePathLen = manifest.locator.framePath?.length ?? 0;
        if (framePathLen > 0) framePathFixtures += 1;
        if (manifest.locator.index !== null && manifest.locator.index !== undefined) {
          indexFixtures += 1;
        }
        if (framePathLen === 2) twoLayerFramePathFixtures += 1;
      }
      const framePathCases = framePathFixtures * MUTATION_ORDER.length;
      const indexCases = indexFixtures * MUTATION_ORDER.length;

      // verdict counts by kind (actual, non-null)
      const verdictCountsByKind: Record<string, Record<string, number>> = {
        css: { STABLE: 0, WRONG_TARGET: 0, AMBIGUOUS: 0, MISSING: 0 },
        xpath: { STABLE: 0, WRONG_TARGET: 0, AMBIGUOUS: 0, MISSING: 0 },
        role: { STABLE: 0, WRONG_TARGET: 0, AMBIGUOUS: 0, MISSING: 0 },
      };
      for (const log of caseLogs) {
        if (log.actualVerdict === null) continue;
        const m = manifestById.get(log.fixtureId);
        if (!m) continue;
        const bucket = verdictCountsByKind[m.locator.kind];
        if (bucket) {
          bucket[log.actualVerdict] = (bucket[log.actualVerdict] ?? 0) + 1;
        }
      }

      // controls
      let stableFixtureCount = 0;
      let fragileFixtureCount = 0;
      for (const manifest of manifests) {
        if (manifest.controlGroup === "stable") stableFixtureCount += 1;
        if (manifest.controlGroup === "fragile") fragileFixtureCount += 1;
      }
      const stablePairs = stableFixtureCount * MUTATION_ORDER.length;
      const fragilePairs = fragileFixtureCount * MUTATION_ORDER.length;

      const stableMismatches = caseLogs.filter((c) => {
        const m = manifestById.get(c.fixtureId);
        return m?.controlGroup === "stable" && !c.match;
      }).length;
      const fragileMismatches = caseLogs.filter((c) => {
        const m = manifestById.get(c.fixtureId);
        return m?.controlGroup === "fragile" && !c.match;
      }).length;

      const matched = caseLogs.filter((c) => c.match).length;
      const mismatched = caseLogs.length - matched;
      const externalRequests = browserHandle.externalRequestCount();

      const report = {
        schema: "locatorstress.t002-mutation-report/v1",
        seed: SEED,
        totals: {
          fixtures: manifests.length,
          cases: caseLogs.length,
          matched,
          mismatched,
        },
        verdictCounts: {
          STABLE: verdictCounts.STABLE ?? 0,
          WRONG_TARGET: verdictCounts.WRONG_TARGET ?? 0,
          AMBIGUOUS: verdictCounts.AMBIGUOUS ?? 0,
          MISSING: verdictCounts.MISSING ?? 0,
        },
        verdictCountsByKind,
        coverage: {
          cssFixtures,
          xpathFixtures,
          roleFixtures,
          framePathFixtures,
          framePathCases,
          indexFixtures,
          indexCases,
          twoLayerFramePathFixtures,
        },
        controls: {
          stable: {
            fixtures: stableFixtureCount,
            pairs: stablePairs,
            mismatches: stableMismatches,
          },
          fragile: {
            fixtures: fragileFixtureCount,
            pairs: fragilePairs,
            mismatches: fragileMismatches,
          },
        },
        externalRequests,
        cases: caseLogs,
      };

      const evidenceDir = join(repoRoot(), "evidence", "s0");
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(
        join(evidenceDir, "T002_MUTATION_REPORT.json"),
        JSON.stringify(report, null, 2) + "\n",
        "utf8",
      );

      expect(caseLogs.length).toBe(192);
      expect(caseLogs.filter((c) => !c.match)).toEqual([]);
      expect(verdictCounts.STABLE).toBeGreaterThanOrEqual(8);
      expect(verdictCounts.WRONG_TARGET).toBeGreaterThanOrEqual(8);
      expect(verdictCounts.AMBIGUOUS).toBeGreaterThanOrEqual(8);
      expect(verdictCounts.MISSING).toBeGreaterThanOrEqual(8);
      expect(stableMismatches).toBe(0);
      expect(externalRequests).toBe(0);
    },
    300000,
  );
});
