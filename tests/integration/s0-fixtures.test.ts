import { describe, it, expect, beforeAll, afterAll } from "vitest";

import type { BaselineBrowser } from "../../src/runner/browser.js";
import { resolveLocator } from "../../src/runner/locator-resolver.js";
import { runBaselineOracle } from "../../src/oracle/oracle-runner.js";
import { isSameElement } from "../../src/oracle/identity-compare.js";
import {
  SEED,
  loadAllFixtureManifests,
  validateFixtureManifest,
} from "../../src/fixtures/fixture-manifest.js";
import {
  loadFixture,
  setFixtureContent,
  captureOriginalTargetForFixture,
} from "../../src/fixtures/fixture-loader.js";
import { launchTestBrowser } from "./s0-helpers.js";

const FAMILIES = [
  "form-submit",
  "search-box",
  "nav-link",
  "dialog-confirm",
  "table-row-action",
  "toolbar-menu",
  "nested-iframe",
  "open-shadow-dom",
];

describe("S0 fixtures", () => {
  let browserHandle: BaselineBrowser;

  beforeAll(async () => {
    browserHandle = await launchTestBrowser();
  });

  afterAll(async () => {
    await browserHandle.close();
  });

  it("manifests: 24 fixtures, kinds 8/8/8, controls 12/12, families 8x3", () => {
    const manifests = loadAllFixtureManifests();
    expect(manifests.length).toBe(24);

    const kindCounts: Record<string, number> = { css: 0, xpath: 0, role: 0 };
    const controlCounts: Record<string, number> = { stable: 0, fragile: 0 };
    const familyCounts: Record<string, number> = {};
    for (const family of FAMILIES) {
      familyCounts[family] = 0;
    }

    for (const manifest of manifests) {
      kindCounts[manifest.locator.kind] = (kindCounts[manifest.locator.kind] ?? 0) + 1;
      controlCounts[manifest.controlGroup] = (controlCounts[manifest.controlGroup] ?? 0) + 1;
      familyCounts[manifest.family] = (familyCounts[manifest.family] ?? 0) + 1;
    }

    expect(kindCounts.css).toBe(8);
    expect(kindCounts.xpath).toBe(8);
    expect(kindCounts.role).toBe(8);
    expect(controlCounts.stable).toBe(12);
    expect(controlCounts.fragile).toBe(12);

    for (const family of FAMILIES) {
      expect(familyCounts[family]).toBe(3);
    }

    for (const manifest of manifests) {
      expect(validateFixtureManifest(manifest)).toEqual([]);
      expect(manifest.seed).toBe(SEED);
    }
  });

  it(
    "baseline: 24/24 unique hit on the original target",
    async () => {
      const page = browserHandle.page;
      const manifests = loadAllFixtureManifests();
      let successCount = 0;

      for (const manifest of manifests) {
        const fixture = loadFixture(manifest.fixtureId);
        await setFixtureContent(page, fixture);
        const original = await captureOriginalTargetForFixture(page, manifest);
        const { result, finalHandle } = await resolveLocator(page, manifest.locator);
        expect(result.executionStatus).toBe("COMPLETED");
        expect(result.finalMatchCount).toBe(1);
        expect(finalHandle).not.toBeNull();
        const identity = await isSameElement(page, finalHandle, original);
        expect(identity).toBe(true);

        if (manifest.captureMode === "page") {
          await setFixtureContent(page, fixture);
          const oracleResult = await runBaselineOracle(
            page,
            manifest.locator,
            manifest.privateTargetPath,
          );
          expect(oracleResult.resolverResult.executionStatus).toBe("COMPLETED");
          expect(oracleResult.resolverResult.finalMatchCount).toBe(1);
          expect(oracleResult.identityMatch).toBe(true);
        }

        successCount += 1;
      }

      expect(successCount).toBe(24);
    },
    120000,
  );

  it("offline: 0 external requests", () => {
    expect(browserHandle.externalRequestCount()).toBe(0);
    expect(browserHandle.blockedRequestCount()).toBe(0);
  });
});
