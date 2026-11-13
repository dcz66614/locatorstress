# REVIEW_PACK_09 — 测试（上）：集成、Oracle、Verdict、Score、Canonical、契约、属性、变异、搜索、分析

审查 commit：`a78d765`。本包为审查时原文逐字拼接（机械拼接，内容未经改写），每个文件附行数、字节数与 SHA-256；审查结论见 `INDEPENDENT_REVIEW.md`。

## tests/integration/s0-helpers.ts

- 行数：56；字节数：1551；SHA-256：`ebc0bd63f7895ae34963f069bac00f06bd275f3f088c168123fb6f673bc17eac`

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  launchBaselineBrowser,
  type BaselineBrowser,
} from "../../src/runner/browser.js";
import type { ResolverResult } from "../../src/runner/execution.js";

export function resolveChromiumExecutable(): string {
  const candidate = join(
    process.env.HOME ?? "",
    ".cache/ms-playwright/chromium-1254/chrome-linux64/chrome",
  );
  if (!existsSync(candidate)) {
    throw new Error(`chromium-1254 not found at ${candidate}; no fallback is allowed`);
  }
  return candidate;
}

export async function launchTestBrowser(): Promise<BaselineBrowser> {
  return launchBaselineBrowser({ executablePath: resolveChromiumExecutable() });
}

export type Verdict = "STABLE" | "WRONG_TARGET" | "AMBIGUOUS" | "MISSING";

export function deriveVerdict(
  result: ResolverResult,
  identityMatch: boolean | null,
): Verdict | null {
  if (result.executionStatus !== "COMPLETED") {
    return null;
  }
  if (result.frameFailure !== null) {
    return result.frameFailure.kind === "FRAME_AMBIGUOUS" ? "AMBIGUOUS" : "MISSING";
  }
  if (result.finalMatchCount === 0) {
    return "MISSING";
  }
  if (result.finalMatchCount > 1) {
    return "AMBIGUOUS";
  }
  if (result.finalMatchCount === 1) {
    return identityMatch === true
      ? "STABLE"
      : identityMatch === false
        ? "WRONG_TARGET"
        : null;
  }
  return null;
}

export function repoRoot(): string {
  return fileURLToPath(new URL("../..", import.meta.url));
}
```

## tests/integration/s0-fixtures.test.ts

- 行数：116；字节数：3759；SHA-256：`77b97514270dacf780851ea02c5cb865debdbf9ce0a050a4436e64e83f2f9b79`

```ts
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
```

## tests/integration/s0-mutations.test.ts

- 行数：256；字节数：8718；SHA-256：`cd26fcc2585ff442ffac1891dd215cd913889d0c4c0f5aacbcdd035d079c6703`

```ts
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
```

## tests/integration/oracle-parity-independent.test.ts

- 行数：265；字节数：10331；SHA-256：`716599070b45ef4fa338a4f2d35202d0c979eb791ba38bcaf656ddd4f49e0eb6`

```ts
// T011 — Independent Oracle parity over all 192 golden cases.
//
// Three-way, field-by-field comparison on every fixture x mutation:
//   (a) production classifyVerdict (src/verdict/classify.ts),
//   (b) an INDEPENDENT re-implementation written in this file directly
//       from PROJECT_BOOK §5.2/§5.3 (it does NOT import classifyVerdict
//       and shares no code with it),
//   (c) the frozen golden expected verdicts (src/fixtures/golden/).
//
// Any disagreement on any field (verdict, executionStatus, raw/final
// counts, frame-failure kind/layer) is a FAIL — there is no ignore
// list. Per-case evidence is written to
// evidence/s4/T011_ORACLE_PARITY.json (write retried against the VM's
// intermittent EPERM fault; the test fails loudly if the evidence
// cannot be written, so a green run always has its evidence file).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { BaselineBrowser } from "../../src/runner/browser.js";
import { resolveLocator } from "../../src/runner/locator-resolver.js";
import { isSameElement } from "../../src/oracle/identity-compare.js";
import { classifyVerdict, type Verdict } from "../../src/verdict/classify.js";
import type { ResolverResult } from "../../src/runner/execution.js";
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
import { launchTestBrowser, repoRoot } from "./s0-helpers.js";

/**
 * Independent verdict derivation, written from PROJECT_BOOK §5.2
 * (resolution order) and §5.3 (four states) — no shared code with
 * src/verdict/classify.ts:
 *   1. executionStatus !== COMPLETED -> no verdict.
 *   2. frameFailure: FRAME_AMBIGUOUS -> AMBIGUOUS, FRAME_MISSING -> MISSING.
 *   3. finalMatchCount 0 -> MISSING; >1 -> AMBIGUOUS.
 *   4. exactly 1: identity true -> STABLE, false -> WRONG_TARGET,
 *      null -> no verdict.
 * (The production classifier additionally rejects contradictory counts
 * as no-verdict; this derivation treats final > raw the same way, so
 * the two agree on every input the resolver can emit.)
 */
export function deriveVerdictIndependent(
  result: ResolverResult,
  identityMatch: boolean | null,
): Verdict | null {
  if (result.executionStatus !== "COMPLETED") {
    return null;
  }
  if (
    !Number.isInteger(result.rawMatchCount) ||
    !Number.isInteger(result.finalMatchCount) ||
    result.rawMatchCount < 0 ||
    result.finalMatchCount < 0 ||
    result.finalMatchCount > result.rawMatchCount
  ) {
    return null;
  }
  if (result.frameFailure !== null) {
    return result.frameFailure.kind === "FRAME_AMBIGUOUS" ? "AMBIGUOUS" : "MISSING";
  }
  if (result.finalMatchCount === 0) {
    return "MISSING";
  }
  if (result.finalMatchCount > 1) {
    return "AMBIGUOUS";
  }
  if (identityMatch === true) return "STABLE";
  if (identityMatch === false) return "WRONG_TARGET";
  return null;
}

interface ParityCase {
  fixtureId: string;
  mutationId: string;
  expectedVerdict: string;
  productionVerdict: Verdict | null;
  independentVerdict: Verdict | null;
  executionStatus: string;
  rawMatchCount: number;
  finalMatchCount: number;
  frameFailureKind: string | null;
  frameFailureLayer: number | null;
  identityMatch: boolean | null;
  productionMatchesGolden: boolean;
  independentMatchesGolden: boolean;
  productionMatchesIndependent: boolean;
}

function writeFileVerified(path: string, text: string): void {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      writeFileSync(path, text, "utf-8");
      const size = statSync(path).size;
      if (size === text.length) {
        return;
      }
      lastError = new Error(`wrote ${size} bytes, expected ${text.length} (attempt ${attempt})`);
    } catch (err) {
      lastError = err;
    }
    // EPERM jitter: wait out the fault window, then retry.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
  }
  throw new Error(
    `could not write parity evidence to ${path} after 8 attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

describe("T011 independent Oracle parity (192 cases, three-way)", () => {
  let browserHandle: BaselineBrowser;
  let golden: Map<string, string>;

  beforeAll(async () => {
    browserHandle = await launchTestBrowser();
    const parsed = JSON.parse(
      readFileSync(join(repoRoot(), "src/fixtures/golden/expected-verdicts.json"), "utf8"),
    ) as {
      seed: string;
      cases: Array<{ fixtureId: string; mutationId: string; expectedVerdict: string }>;
    };
    expect(parsed.cases.length).toBe(192);
    expect(parsed.seed).toBe(SEED);
    golden = new Map(parsed.cases.map((c) => [`${c.fixtureId}/${c.mutationId}`, c.expectedVerdict]));
  });

  afterAll(async () => {
    await browserHandle.close();
  });

  it(
    "production verdict == independent verdict == golden on all 192 cases, field by field",
    async () => {
      const page = browserHandle.page;
      const manifests = loadAllFixtureManifests();
      const manifestById = new Map(manifests.map((m) => [m.fixtureId, m]));
      const cases: ParityCase[] = [];

      for (const fixtureId of FIXTURE_IDS) {
        const manifest = manifestById.get(fixtureId);
        if (!manifest) throw new Error(`missing manifest for fixture ${fixtureId}`);
        const fixture = loadFixture(manifest.fixtureId);

        for (const mutationId of MUTATION_ORDER) {
          await setFixtureContent(page, fixture);
          const original = await captureOriginalTargetForFixture(page, manifest);
          await getMutation(mutationId).apply(page, original, mutationContextForFixture(manifest));

          const { result, finalHandle } = await resolveLocator(page, manifest.locator);
          let identityMatch: boolean | null = null;
          if (
            result.executionStatus === "COMPLETED" &&
            result.finalMatchCount === 1 &&
            finalHandle !== null
          ) {
            identityMatch = await isSameElement(page, finalHandle, original);
          }

          const production = classifyVerdict(result, identityMatch);
          const independent = deriveVerdictIndependent(result, identityMatch);
          const expected = golden.get(`${manifest.fixtureId}/${mutationId}`);

          cases.push({
            fixtureId: manifest.fixtureId,
            mutationId,
            expectedVerdict: expected ?? "<missing golden>",
            productionVerdict: production.verdict,
            independentVerdict: independent,
            executionStatus: result.executionStatus,
            rawMatchCount: result.rawMatchCount,
            finalMatchCount: result.finalMatchCount,
            frameFailureKind: result.frameFailure?.kind ?? null,
            frameFailureLayer: result.frameFailure?.layer ?? null,
            identityMatch,
            productionMatchesGolden: production.verdict === expected,
            independentMatchesGolden: independent === expected,
            productionMatchesIndependent: production.verdict === independent,
          });
        }
      }

      const compared = cases.length;
      const productionMatched = cases.filter((c) => c.productionMatchesGolden).length;
      const independentMatched = cases.filter((c) => c.independentMatchesGolden).length;
      const mutualMatched = cases.filter((c) => c.productionMatchesIndependent).length;
      const mismatches = cases.filter(
        (c) => !c.productionMatchesGolden || !c.independentMatchesGolden || !c.productionMatchesIndependent,
      );

      const report = {
        schema: "locatorstress.t011-oracle-parity/v1",
        seed: SEED,
        totals: {
          compared,
          productionMatchedGolden: productionMatched,
          independentMatchedGolden: independentMatched,
          productionMatchesIndependent: mutualMatched,
          mismatches: mismatches.length,
        },
        verdictCounts: {
          STABLE: cases.filter((c) => c.productionVerdict === "STABLE").length,
          WRONG_TARGET: cases.filter((c) => c.productionVerdict === "WRONG_TARGET").length,
          AMBIGUOUS: cases.filter((c) => c.productionVerdict === "AMBIGUOUS").length,
          MISSING: cases.filter((c) => c.productionVerdict === "MISSING").length,
          null: cases.filter((c) => c.productionVerdict === null).length,
        },
        mismatches,
        cases,
      };

      writeFileVerified(
        join(repoRoot(), "evidence", "s4", "T011_ORACLE_PARITY.json"),
        JSON.stringify(report, null, 2) + "\n",
      );

      // The parity bar: 192/192 on all three comparisons, zero mismatch.
      expect(compared).toBe(192);
      expect(mismatches).toEqual([]);
      expect(productionMatched).toBe(192);
      expect(independentMatched).toBe(192);
      expect(mutualMatched).toBe(192);
    },
    300000,
  );

  it("the independent derivation agrees with production on the full counts grid (no browser)", () => {
    const grid: Array<[number, number, boolean | null, string | null]> = [];
    for (const raw of [0, 1, 2, 3]) {
      for (const final of [0, 1, 2, 3]) {
        for (const identity of [true, false, null] as const) {
          for (const frame of [null, "FRAME_MISSING", "FRAME_AMBIGUOUS"] as const) {
            grid.push([raw, final, identity, frame]);
          }
        }
      }
    }
    for (const [raw, final, identity, frame] of grid) {
      const result: ResolverResult = {
        executionStatus: "COMPLETED",
        rawMatchCount: raw,
        finalMatchCount: final,
        frameFailure:
          frame === null
            ? null
            : { layer: 0, selector: "iframe.a", matchCount: frame === "FRAME_MISSING" ? 0 : 2, kind: frame },
        errorMessage: null,
      };
      expect(
        deriveVerdictIndependent(result, identity),
        `raw=${raw} final=${final} identity=${String(identity)} frame=${frame}`,
      ).toBe(classifyVerdict(result, identity).verdict);
    }
  });
});
```

## tests/integration/p2a-detach-regression.test.ts

- 行数：146；字节数：6046；SHA-256：`b00db7283fa20e8219ab3ea403f622f7de71b109641f81dd813f93025f1c52a0`

```ts
// P2-A regression — detach the frame holding the resolved target AFTER capture and
// BEFORE identity comparison, and verify runBaselineOracle returns executionStatus
// ERROR via its isSameElement catch branch. The original target is captured in the
// MAIN frame (string private path), while the spec resolves inside the iframe;
// detaching the iframe destroys the resolved handle's execution context, so the
// compare evaluate throws ("Frame has been detached" / "Cannot find context").
//
// Deterministic interleaving (a blind Node-side delay sweep cannot hit the
// ~1-round-trip window between resolveLocator's elementHandle and the compare
// evaluate: 26 blind attempts all returned COMPLETED): each attempt blocks the
// page main thread for 200 ms with a busy-loop evaluate. CDP commands sent while
// blocked queue in arrival order, so a second evaluate that waits `delay` ms in
// the page and then removes the iframe is anchored to the end of the blocker,
// i.e. to the start of the oracle's post-block round trips. Sweeping `delay`
// across the oracle's post-block duration lands the removal between
// elementHandle and the compare evaluate. Delays that land between the locator
// count and elementHandle instead make elementHandle wait out its 30 s
// timeout; those attempts are abandoned after 4 s on a fresh context so the
// pending wait dies with the context instead of stalling the suite.
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import type { BaselineBrowser } from "../../src/runner/browser.js";
import type { LocatorSpecV1 } from "../../src/contracts/locator.js";
import { runBaselineOracle } from "../../src/oracle/oracle-runner.js";
import { launchTestBrowser } from "./s0-helpers.js";

const HTML =
  `<main><button class="primary">Main target</button><iframe srcdoc="<button class='primary'>InFrame</button>"></iframe></main>`;

const SPEC: LocatorSpecV1 = {
  kind: "css",
  selector: "button.primary",
  framePath: ["iframe"],
};

const PRIVATE_PATH = "main > button:nth-child(1)";

// Delays (ms) for the in-page removal timer, swept across the oracle's
// post-block duration. ERROR was observed at 42-56 ms and 70 ms in probing;
// the band shifts a few ms per run with CDP round-trip jitter, so sweep in
// 2 ms steps and retry up to 5 passes. T012 widened the window from
// 38-80 ms to 30-120 ms after the test flaked once in four full runs
// (485/486): a narrow window misses the ~1-round-trip gap between
// elementHandle and the compare evaluate when CDP latency drifts.
// The sweep still stops at the first ERROR, so the common case costs
// no extra time; only a miss pays for the wider window.
const DELAYS_MS = [
  30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60, 62, 64,
  66, 68, 70, 72, 74, 76, 78, 80, 82, 84, 86, 88, 90, 92, 94, 96, 98, 100,
  102, 104, 106, 108, 110, 112, 114, 116, 118, 120,
];
const ATTEMPT_GUARD_MS = 4000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("P2-A detach regression", () => {
  let browserHandle: BaselineBrowser;

  beforeAll(async () => {
    browserHandle = await launchTestBrowser();
  });

  afterAll(async () => {
    await browserHandle.close();
  });

  it(
    "baseline sanity: iframe target resolves, identity is false",
    async () => {
      const page = browserHandle.page;
      await page.setContent(HTML);
      const r = await runBaselineOracle(page, SPEC, PRIVATE_PATH);
      expect(r.resolverResult.executionStatus).toBe("COMPLETED");
      expect(r.resolverResult.finalMatchCount).toBe(1);
      expect(r.identityMatch).toBe(false);
      expect(r.originalCaptured).toBe(true);
    },
    60000,
  );

  it(
    "detaching the target frame mid-oracle yields executionStatus ERROR",
    async () => {
      const attempts: string[] = [];
      let errorSeen = false;
      let errorDetail = "";

      for (let pass = 0; pass < 5 && !errorSeen; pass += 1) {
        for (const delayMs of DELAYS_MS) {
          const context = await browserHandle.browser.newContext();
          const page = await context.newPage();
          try {
            await page.setContent(HTML);
            const blocker = page.evaluate(() => {
              const end = Date.now() + 200;
              while (Date.now() < end) {
                // Busy-wait anchor only; see the file header comment.
              }
            });
            const oraclePromise = runBaselineOracle(page, SPEC, PRIVATE_PATH);
            await page.evaluate(async (d: number) => {
              await new Promise((resolve) => {
                setTimeout(resolve, d);
              });
              document.querySelector("iframe")?.remove();
            }, delayMs);
            await blocker;
            const outcome = await Promise.race([
              oraclePromise,
              sleep(ATTEMPT_GUARD_MS).then(() => "GUARD_TIMEOUT" as const),
            ]);
            if (outcome === "GUARD_TIMEOUT") {
              attempts.push(`${delayMs}ms:ABANDONED_AFTER_${ATTEMPT_GUARD_MS}ms`);
              continue;
            }
            attempts.push(
              `${delayMs}ms:${outcome.resolverResult.executionStatus}` +
                `/final=${outcome.resolverResult.finalMatchCount}` +
                `/identity=${String(outcome.identityMatch)}`,
            );
            if (outcome.resolverResult.executionStatus === "ERROR") {
              expect(outcome.resolverResult.finalMatchCount).toBe(1);
              expect(outcome.identityMatch).toBeNull();
              expect(outcome.originalCaptured).toBe(true);
              errorDetail = outcome.resolverResult.errorMessage ?? "";
              errorSeen = true;
              break;
            }
          } finally {
            await context.close();
          }
        }
      }

      expect(
        errorSeen,
        `no ERROR observed (compare-branch error: ${errorDetail}); attempts=${attempts.join(",")}`,
      ).toBe(true);
    },
    180000,
  );
});
```

## tests/oracle/oracle-capture.test.ts

- 行数：268；字节数：11898；SHA-256：`f01a57128f047d5ec226a060c944595f398daa89bcd8533977d2c2ca68370ef6`

```ts
// T011 — Oracle capture + identity comparison boundaries
// (PROJECT_BOOK §5.1; src/oracle/target-capture.ts,
// src/oracle/identity-compare.ts, src/oracle/oracle-runner.ts).
//
// captureOriginalTarget and probeHandleWrapperIdentity previously had
// no direct tests (only indirect coverage through fixtures). These
// tests pin: uniqueness errors (0 / 2 matches), frame-scoped capture,
// the null-handle rule in isSameElement, the wrapper-vs-node identity
// distinction, and the runBaselineOracle happy/invalid paths.

import { describe, it, expect, beforeAll, afterAll } from "vitest";

import type { BaselineBrowser } from "../../src/runner/browser.js";
import {
  captureOriginalTarget,
  captureOriginalTargetFromLocator,
} from "../../src/oracle/target-capture.js";
import { isSameElement, probeHandleWrapperIdentity } from "../../src/oracle/identity-compare.js";
import { runBaselineOracle } from "../../src/oracle/oracle-runner.js";
import { resolveLocator } from "../../src/runner/locator-resolver.js";
import { launchTestBrowser } from "../integration/s0-helpers.js";

describe("captureOriginalTarget", () => {
  let browserHandle: BaselineBrowser;

  beforeAll(async () => {
    browserHandle = await launchTestBrowser();
  });

  afterAll(async () => {
    await browserHandle.close();
  });

  it("captures the unique target handle", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button class="primary">Save</button></main>`);
    const handle = await captureOriginalTarget(page, "button.primary");
    expect(handle).not.toBeNull();
    expect(await handle.evaluate((el: Element) => el.textContent)).toBe("Save");
  });

  it("throws ORACLE_TARGET_NOT_UNIQUE: 0 when nothing matches", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button class="primary">Save</button></main>`);
    await expect(captureOriginalTarget(page, "button.gone")).rejects.toThrow(
      "ORACLE_TARGET_NOT_UNIQUE: 0",
    );
  });

  it("throws ORACLE_TARGET_NOT_UNIQUE: 2 when the path is ambiguous", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button>One</button><button>Two</button></main>`);
    await expect(captureOriginalTarget(page, "button")).rejects.toThrow(
      "ORACLE_TARGET_NOT_UNIQUE: 2",
    );
  });

  it("throws ORACLE_TARGET_NOT_UNIQUE: 3 for three matches", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button>1</button><button>2</button><button>3</button></main>`);
    await expect(captureOriginalTarget(page, "button")).rejects.toThrow(
      "ORACLE_TARGET_NOT_UNIQUE: 3",
    );
  });

  it("captures inside a shadow host via a scoped locator", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><div id="host"></div></main>`);
    await page.evaluate(() => {
      const host = document.querySelector("#host") as HTMLElement;
      const root = host.attachShadow({ mode: "open" });
      root.innerHTML = `<button class="in-shadow">Shadow</button>`;
    });
    const handle = await captureOriginalTargetFromLocator(
      page,
      page.locator("#host").locator("button.in-shadow"),
    );
    expect(await handle.evaluate((el: Element) => el.textContent)).toBe("Shadow");
  });

  it("captures inside an iframe via a frame locator", async () => {
    const page = browserHandle.page;
    await page.setContent(
      `<main><iframe class="f" srcdoc="<button class='in'>InFrame</button>"></iframe></main>`,
    );
    const handle = await captureOriginalTargetFromLocator(
      page,
      page.frameLocator("iframe.f").locator("button.in"),
    );
    expect(await handle.evaluate((el: Element) => el.textContent)).toBe("InFrame");
  });
});

describe("isSameElement — node identity, not wrapper identity", () => {
  let browserHandle: BaselineBrowser;

  beforeAll(async () => {
    browserHandle = await launchTestBrowser();
  });

  afterAll(async () => {
    await browserHandle.close();
  });

  it("two handles of the same node are the same element", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button class="primary">Save</button></main>`);
    const h1 = await page.locator("button.primary").elementHandle();
    const h2 = await page.locator("button.primary").elementHandle();
    expect(await isSameElement(page, h1, h2)).toBe(true);
  });

  it("handles of two different nodes are not the same element", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button>One</button><button>Two</button></main>`);
    const h1 = await page.locator("button >> nth=0").elementHandle();
    const h2 = await page.locator("button >> nth=1").elementHandle();
    expect(await isSameElement(page, h1, h2)).toBe(false);
  });

  it("a null actual handle is never the same element", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button>One</button></main>`);
    const h = await page.locator("button").elementHandle();
    expect(await isSameElement(page, null, h)).toBe(false);
  });

  it("a null original handle is never the same element", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button>One</button></main>`);
    const h = await page.locator("button").elementHandle();
    expect(await isSameElement(page, h, null)).toBe(false);
  });

  it("both null is false, not true", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main></main>`);
    expect(await isSameElement(page, null, null)).toBe(false);
  });

  it("a node moved by M01 is still the same element (identity survives wrapping)", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button class="primary">Save</button></main>`);
    const before = await page.locator("button.primary").elementHandle();
    await page.evaluate(() => {
      const el = document.querySelector("button.primary")!;
      const wrap = document.createElement("div");
      wrap.className = "wrap";
      el.parentNode!.insertBefore(wrap, el);
      wrap.appendChild(el);
    });
    const after = await page.locator("button.primary").elementHandle();
    expect(await isSameElement(page, before, after)).toBe(true);
  });

  it("probeHandleWrapperIdentity: same node, different JS wrappers", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button class="primary">Save</button></main>`);
    const probe = await probeHandleWrapperIdentity(page, page.locator("button.primary"));
    // Two elementHandle() calls return different JS wrapper objects
    // for the same DOM node: nodeIdentity true, wrapperIdentity false.
    expect(probe).toEqual({ nodeIdentity: true, wrapperIdentity: false });
  });

  it("probeHandleWrapperIdentity throws on a non-matching locator (it requires a match)", async () => {
    // The function calls locator.elementHandle() twice. Verified
    // empirically against Playwright 1.65: elementHandle() THROWS on
    // timeout and never returns null for a non-matching selector, so
    // the null branch (h1 === null || h2 === null) in
    // probeHandleWrapperIdentity is unreachable through the public
    // API — defensive code, not a defect, recorded as an uncovered
    // item in the T011 report. The observable contract is that the
    // function requires a matching locator and throws otherwise.
    const page = browserHandle.page;
    await page.setContent(`<main></main>`);
    page.setDefaultTimeout(100);
    try {
      await expect(
        probeHandleWrapperIdentity(page, page.locator("button.gone")),
      ).rejects.toThrow(/Timeout 100ms exceeded/);
    } finally {
      page.setDefaultTimeout(30_000);
    }
  });
});

describe("runBaselineOracle", () => {
  let browserHandle: BaselineBrowser;

  beforeAll(async () => {
    browserHandle = await launchTestBrowser();
  });

  afterAll(async () => {
    await browserHandle.close();
  });

  it("happy path: unique baseline, identity true, originalCaptured true", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button class="primary">Save</button></main>`);
    const out = await runBaselineOracle(page, { kind: "css", selector: "button.primary" }, "button.primary");
    expect(out.originalCaptured).toBe(true);
    expect(out.resolverResult.executionStatus).toBe("COMPLETED");
    expect(out.resolverResult.finalMatchCount).toBe(1);
    expect(out.identityMatch).toBe(true);
  });

  it("a WRONG_TARGET baseline: locator matches a different unique node, identity false", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button class="a">A</button><button class="b">B</button></main>`);
    const out = await runBaselineOracle(page, { kind: "css", selector: "button.b" }, "button.a");
    expect(out.originalCaptured).toBe(true);
    expect(out.resolverResult.finalMatchCount).toBe(1);
    expect(out.identityMatch).toBe(false);
  });

  it("an unmatchable private target path is INVALID_FIXTURE with originalCaptured false", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button class="primary">Save</button></main>`);
    const out = await runBaselineOracle(page, { kind: "css", selector: "button.primary" }, "button.gone");
    expect(out.originalCaptured).toBe(false);
    expect(out.resolverResult.executionStatus).toBe("INVALID_FIXTURE");
    expect(out.identityMatch).toBeNull();
  });

  it("an ambiguous private target path is INVALID_FIXTURE", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button>One</button><button>Two</button></main>`);
    const out = await runBaselineOracle(page, { kind: "css", selector: "button >> nth=0" }, "button");
    expect(out.originalCaptured).toBe(false);
    expect(out.resolverResult.executionStatus).toBe("INVALID_FIXTURE");
    expect(out.resolverResult.errorMessage).toMatch(/ORACLE_TARGET_NOT_UNIQUE: 2/);
  });

  it("a locator that matches nothing still captures the original (identity null, not an error)", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button class="primary">Save</button></main>`);
    const out = await runBaselineOracle(page, { kind: "css", selector: "button.gone" }, "button.primary");
    expect(out.originalCaptured).toBe(true);
    expect(out.resolverResult.executionStatus).toBe("COMPLETED");
    expect(out.resolverResult.finalMatchCount).toBe(0);
    expect(out.identityMatch).toBeNull();
  });

  it("agrees with the manual resolveLocator + isSameElement path on a mutated page", async () => {
    const page = browserHandle.page;
    await page.setContent(
      `<main><button class="primary">Save</button><button class="secondary">Cancel</button></main>`,
    );
    // Apply M04 by hand: insert a decoy before the target, then resolve with index 0.
    await page.evaluate(() => {
      const el = document.querySelector("button.primary")!;
      const decoy = document.createElement("button");
      decoy.className = "primary";
      decoy.textContent = "Save";
      el.parentNode!.insertBefore(decoy, el);
    });
    const spec = { kind: "css", selector: "button.primary", index: 0 } as const;
    const viaRunner = await runBaselineOracle(page, spec, "button.primary >> nth=1");
    const { result, finalHandle } = await resolveLocator(page, spec);
    const original = await captureOriginalTarget(page, "button.primary >> nth=1");
    const manualIdentity = await isSameElement(page, finalHandle, original);
    expect(result.executionStatus).toBe(viaRunner.resolverResult.executionStatus);
    expect(result.finalMatchCount).toBe(viaRunner.resolverResult.finalMatchCount);
    expect(manualIdentity).toBe(viaRunner.identityMatch);
    expect(viaRunner.identityMatch).toBe(false);
  });
});
```

## tests/verdict/classify.test.ts

- 行数：418；字节数：12266；SHA-256：`a22d378fa1cc01149b475313b22fd8ea82568d83fc1160d1b388d9b3049923f6`

```ts
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
```

## tests/verdict/classify-boundaries.test.ts

- 行数：212；字节数：8193；SHA-256：`f160e9e9278f007c534d63c5d30d7bb843da82e5d7911a34d2350b1ecf95075e`

```ts
// T011 — classifyVerdict extra boundaries (PROJECT_BOOK §5.2/§5.3).
//
// The T004 table already covers the four verdicts, all execution
// statuses, frame precedence and contradictory counts. These rows pin
// the remaining edges a mutation could flip without tripping that
// table: frame failure when the selector DID match, identity values
// that must be ignored once an earlier rule has decided, NaN /
// Infinity counts, and large-count boundaries.

import { describe, it, expect } from "vitest";

import type { ResolverResult } from "../../src/runner/execution.js";
import { classifyVerdict } from "../../src/verdict/classify.js";

function completed(overrides: Partial<ResolverResult> = {}): ResolverResult {
  return {
    executionStatus: "COMPLETED",
    rawMatchCount: 1,
    finalMatchCount: 1,
    frameFailure: null,
    errorMessage: null,
    ...overrides,
  };
}

describe("classifyVerdict — frame failure beats a matching selector", () => {
  it("FRAME_AMBIGUOUS wins even when raw/final counts are 1/1 with identity true", () => {
    const out = classifyVerdict(
      completed({
        frameFailure: { layer: 0, selector: "iframe.a", matchCount: 2, kind: "FRAME_AMBIGUOUS" },
      }),
      true,
    );
    expect(out.verdict).toBe("AMBIGUOUS");
    expect(out.analysisStatus).toBe("COMPLETE");
  });

  it("FRAME_MISSING wins even when raw/final counts are 1/1 with identity true", () => {
    const out = classifyVerdict(
      completed({
        frameFailure: { layer: 1, selector: "iframe.inner", matchCount: 0, kind: "FRAME_MISSING" },
      }),
      true,
    );
    expect(out.verdict).toBe("MISSING");
    expect(out.analysisStatus).toBe("COMPLETE");
  });

  it("frameFailure kind decides, not the matchCount number: kind MISSING with count 2 is still MISSING", () => {
    // A contradictory resolver payload: kind is authoritative per §5.2.
    const out = classifyVerdict(
      completed({
        rawMatchCount: 0,
        finalMatchCount: 0,
        frameFailure: { layer: 0, selector: "iframe.a", matchCount: 2, kind: "FRAME_MISSING" },
      }),
      null,
    );
    expect(out.verdict).toBe("MISSING");
  });
});

describe("classifyVerdict — identity is only consulted at exactly 1 final match", () => {
  it("identity true with 0 final matches is MISSING, not STABLE", () => {
    expect(classifyVerdict(completed({ rawMatchCount: 0, finalMatchCount: 0 }), true).verdict).toBe(
      "MISSING",
    );
  });

  it("identity true with 2 final matches is AMBIGUOUS, not STABLE", () => {
    expect(classifyVerdict(completed({ rawMatchCount: 2, finalMatchCount: 2 }), true).verdict).toBe(
      "AMBIGUOUS",
    );
  });

  it("identity false with 0 final matches is MISSING, not WRONG_TARGET", () => {
    expect(classifyVerdict(completed({ rawMatchCount: 0, finalMatchCount: 0 }), false).verdict).toBe(
      "MISSING",
    );
  });

  it("identity null with 2 final matches is AMBIGUOUS (identity is irrelevant there)", () => {
    expect(classifyVerdict(completed({ rawMatchCount: 5, finalMatchCount: 5 }), null).verdict).toBe(
      "AMBIGUOUS",
    );
  });

  it("large counts: raw 1000 / final 1000 is AMBIGUOUS", () => {
    expect(
      classifyVerdict(completed({ rawMatchCount: 1000, finalMatchCount: 1000 }), null).verdict,
    ).toBe("AMBIGUOUS");
  });

  it("large counts: raw 1000 narrowed to final 1 with identity true is STABLE", () => {
    expect(
      classifyVerdict(completed({ rawMatchCount: 1000, finalMatchCount: 1 }), true).verdict,
    ).toBe("STABLE");
  });

  it("boundary raw == final == 1 with identity null is INCOMPLETE, never a guess", () => {
    const out = classifyVerdict(completed({ rawMatchCount: 1, finalMatchCount: 1 }), null);
    expect(out.verdict).toBeNull();
    expect(out.analysisStatus).toBe("INCOMPLETE");
    expect(out.reason).toMatch(/identity is unknown/);
  });
});

describe("classifyVerdict — non-finite and contradictory counts", () => {
  it("NaN rawMatchCount yields no verdict", () => {
    const out = classifyVerdict(completed({ rawMatchCount: NaN, finalMatchCount: 0 }), null);
    expect(out.verdict).toBeNull();
    expect(out.analysisStatus).toBe("INCOMPLETE");
  });

  it("NaN finalMatchCount yields no verdict", () => {
    const out = classifyVerdict(completed({ rawMatchCount: 1, finalMatchCount: NaN }), null);
    expect(out.verdict).toBeNull();
  });

  it("Infinity rawMatchCount yields no verdict", () => {
    const out = classifyVerdict(completed({ rawMatchCount: Infinity, finalMatchCount: 1 }), true);
    expect(out.verdict).toBeNull();
  });

  it("negative raw with negative final yields no verdict", () => {
    expect(classifyVerdict(completed({ rawMatchCount: -2, finalMatchCount: -1 }), null).verdict).toBeNull();
  });

  it("final == raw == 0 with a frame failure still follows the frame rule", () => {
    const out = classifyVerdict(
      completed({
        rawMatchCount: 0,
        finalMatchCount: 0,
        frameFailure: { layer: 0, selector: "iframe.a", matchCount: 3, kind: "FRAME_AMBIGUOUS" },
      }),
      null,
    );
    expect(out.verdict).toBe("AMBIGUOUS");
  });
});

describe("classifyVerdict — negative counts with a decisive identity (kills the >= 0 mutant)", () => {
  // T011 mutation finding: dropping the `value >= 0` check from
  // isValidCount survived the suite (M-CL-06) because every
  // negative-count row used identity null, and with identity null a
  // negative final count still falls through to INCOMPLETE. These
  // rows pin the guard with a decisive identity: without the >= 0
  // check, raw 1 / final -1 / identity true would be misread STABLE.
  it("raw 1, final -1, identity true is no verdict (not STABLE)", () => {
    const out = classifyVerdict(completed({ rawMatchCount: 1, finalMatchCount: -1 }), true);
    expect(out.verdict).toBeNull();
    expect(out.analysisStatus).toBe("INCOMPLETE");
  });

  it("raw 1, final -1, identity false is no verdict (not WRONG_TARGET)", () => {
    const out = classifyVerdict(completed({ rawMatchCount: 1, finalMatchCount: -1 }), false);
    expect(out.verdict).toBeNull();
    expect(out.analysisStatus).toBe("INCOMPLETE");
  });

  it("raw 0, final -1, identity true is no verdict", () => {
    const out = classifyVerdict(completed({ rawMatchCount: 0, finalMatchCount: -1 }), true);
    expect(out.verdict).toBeNull();
    expect(out.analysisStatus).toBe("INCOMPLETE");
  });

  it("raw -1, final -1, identity true is no verdict (both counts negative)", () => {
    const out = classifyVerdict(completed({ rawMatchCount: -1, finalMatchCount: -1 }), true);
    expect(out.verdict).toBeNull();
    expect(out.analysisStatus).toBe("INCOMPLETE");
  });

  it("raw -1, final -2, identity false is no verdict", () => {
    const out = classifyVerdict(completed({ rawMatchCount: -1, finalMatchCount: -2 }), false);
    expect(out.verdict).toBeNull();
    expect(out.analysisStatus).toBe("INCOMPLETE");
  });
});

describe("classifyVerdict — reason strings name the deciding rule", () => {
  it("STABLE reason names identity", () => {
    expect(classifyVerdict(completed(), true).reason).toMatch(/original target/);
  });

  it("WRONG_TARGET reason names the mismatch", () => {
    expect(classifyVerdict(completed(), false).reason).toMatch(/not the original target/);
  });

  it("MISSING reason names the count", () => {
    expect(classifyVerdict(completed({ rawMatchCount: 0, finalMatchCount: 0 }), null).reason).toMatch(
      /final match count is 0/,
    );
  });

  it("AMBIGUOUS reason names the count", () => {
    expect(classifyVerdict(completed({ rawMatchCount: 3, finalMatchCount: 3 }), null).reason).toMatch(
      /final match count is 3/,
    );
  });

  it("ERROR reason names the execution status", () => {
    expect(
      classifyVerdict(completed({ executionStatus: "ERROR", errorMessage: "boom" }), true).reason,
    ).toMatch(/executionStatus is ERROR/);
  });

  it("invalid-count reason echoes both counts", () => {
    const out = classifyVerdict(completed({ rawMatchCount: 1, finalMatchCount: 2 }), null);
    expect(out.reason).toMatch(/rawMatchCount=1/);
    expect(out.reason).toMatch(/finalMatchCount=2/);
  });
});
```

## tests/verdict/verdict-golden.test.ts

- 行数：348；字节数：13106；SHA-256：`4dfc94327268c97335da79df819f2f2406365a75085d98dc96c90dcdb1dc9d58`

```ts
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
```

## tests/score/stability-score.test.ts

- 行数：435；字节数：18177；SHA-256：`160e6f238420772a9b8b27ce2d9745be76efd5db6f0d42c52dcec4acee9db1d3`

```ts
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
```

## tests/score/controls.test.ts

- 行数：488；字节数：20781；SHA-256：`a1bfcc78c566613a2de09356aac42916f236cc0aa0bd51a486c8ed3177ef1d4b`

```ts
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
```

## tests/score/format-percent-boundaries.test.ts

- 行数：267；字节数：10152；SHA-256：`97d7182d6af7bef38dcbd0d5061f3a0b5f80b5bc36e21e68a0c73fd1544da6f2`

```ts
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
```

## tests/canonical/canonical-json.test.ts

- 行数：154；字节数：6660；SHA-256：`d61da1d016bdec29dd16a7fcc19e6658b44fb08277dfbe5353c311c965ab7d36`

```ts
// T006 unit tests — canonical JSON core (PROJECT_BOOK §6).
// Pure functions, no browser, no fixture reads. The frozen-hash
// reproduction itself lives in hash-contract.test.ts; these tests pin
// the canonicalisation rules (NFC, code-point key order, array order,
// number rendering, strict rejection) that the frozen hashes depend on.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";

import {
  compareCodePoints,
  canonicalize,
  canonicalJson,
  canonicalBytes,
  sha256Hex,
  hashCanonical,
} from "../../src/canonical/canonical-json.js";

describe("compareCodePoints", () => {
  it("sorts ASCII by code point", () => {
    expect(["b", "A", "a", "Z"].sort(compareCodePoints)).toEqual([
      "A",
      "Z",
      "a",
      "b",
    ]);
  });
  it("sorts astral-plane keys AFTER the whole BMP (unlike JS default sort, which orders by UTF-16 code unit)", () => {
    // U+E000 (57344) < U+10000 (65536) by code point, so E000 comes first.
    expect(["\u{10000}", "\uE000"].sort(compareCodePoints)).toEqual([
      "\uE000",
      "\u{10000}",
    ]);
    // JS default sort would give the opposite order here.
    expect(["\u{10000}", "\uE000"].sort()).toEqual([
      "\u{10000}",
      "\uE000",
    ]);
  });
  it("orders by length when one string is a prefix of the other", () => {
    expect(compareCodePoints("ab", "abc")).toBeLessThan(0);
    expect(compareCodePoints("abc", "ab")).toBeGreaterThan(0);
    expect(compareCodePoints("abc", "abc")).toBe(0);
  });
});

describe("canonicalJson — NFC and key order", () => {
  it("NFC-normalises string values: e + combining acute becomes é", () => {
    expect(canonicalJson({ s: "e\u0301" })).toBe('{"s":"é"}');
  });
  it("NFC-normalises object keys", () => {
    expect(canonicalJson({ "e\u0301": 1 })).toBe('{"é":1}');
  });
  it("sorts keys by code point regardless of insertion order", () => {
    expect(canonicalJson({ b: 1, A: 2, a: 3 })).toBe('{"A":2,"a":3,"b":1}');
    expect(canonicalJson({ z: { d: 1, c: 2 }, a: 0 })).toBe(
      '{"a":0,"z":{"c":2,"d":1}}',
    );
  });
  it("is independent of input key order, nested too", () => {
    const one = canonicalJson({ b: { y: 1, x: 2 }, a: [3, 2, 1] });
    const two = canonicalJson({ a: [3, 2, 1], b: { x: 2, y: 1 } });
    expect(one).toBe(two);
  });
  it("preserves array order (frozen behaviour: builders sort explicitly; canonicalise does NOT sort arrays)", () => {
    expect(canonicalJson({ a: [3, 1, 2] })).toBe('{"a":[3,1,2]}');
    expect(canonicalJson(["M08", "M01"])).toBe('["M08","M01"]');
  });
  it("produces compact JSON with no trailing newline and no CR", () => {
    const text = canonicalJson({ a: 1, b: "x\ny" });
    expect(text.endsWith("\n")).toBe(false);
    expect(text.includes("\r")).toBe(false);
    expect(text).toBe('{"a":1,"b":"x\\ny"}');
  });
  it("is deterministic: same input twice gives identical bytes", () => {
    const value = { s: "café", n: 192, arr: [{ k: "v" }, null, true] };
    expect(canonicalJson(value)).toBe(canonicalJson(value));
    expect(canonicalBytes(value)).toEqual(canonicalBytes(value));
  });
  it("canonicalBytes are the UTF-8 bytes of the canonical text", () => {
    const text = canonicalJson({ s: "é" });
    expect(new TextDecoder().decode(canonicalBytes({ s: "é" }))).toBe(text);
    expect(canonicalBytes({ s: "é" }).length).toBe(
      Buffer.byteLength(text, "utf8"),
    );
    expect(canonicalBytes({ s: "é" }).length).toBeGreaterThan(text.length); // multibyte é
  });
});

describe("canonicalJson — numbers (§6: integers or decimal strings)", () => {
  it("renders integers plainly", () => {
    expect(canonicalJson({ n: 192 })).toBe('{"n":192}');
    expect(canonicalJson({ n: 0 })).toBe('{"n":0}');
    expect(canonicalJson({ n: -7 })).toBe('{"n":-7}');
  });
  it("renders finite floats exactly as JSON.stringify does (frozen s0-gate behaviour; builders must pass scores as strings instead)", () => {
    expect(canonicalJson({ n: 1.5 })).toBe('{"n":1.5}');
    expect(canonicalJson({ n: 71.875 })).toBe('{"n":71.875}');
  });
  it("keeps scores as strings — the frozen analysis hash uses \"71.875\", not 71.875", () => {
    expect(canonicalJson({ score: "71.875" })).toBe('{"score":"71.875"}');
    expect(canonicalJson({ score: "71.875" })).not.toBe('{"score":71.875}');
  });
  it("rejects non-finite numbers instead of silently nulling them (repeat-hash side of the frozen disagreement)", () => {
    expect(() => canonicalJson({ n: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalJson({ n: Number.POSITIVE_INFINITY })).toThrow(
      /non-finite/,
    );
    expect(() => canonicalJson([Number.NEGATIVE_INFINITY])).toThrow(
      /non-finite/,
    );
  });
});

describe("canonicalJson — strict rejection of non-JSON values", () => {
  it("rejects undefined, functions, symbols and bigints anywhere", () => {
    expect(() => canonicalJson(undefined)).toThrow(/unsupported/);
    expect(() => canonicalJson({ a: undefined })).toThrow(/unsupported/);
    expect(() => canonicalJson([undefined])).toThrow(/unsupported/);
    expect(() => canonicalJson({ f: () => 1 })).toThrow(/unsupported/);
    expect(() => canonicalJson(Symbol("x"))).toThrow(/unsupported/);
    expect(() => canonicalJson(10n)).toThrow(/unsupported/);
  });
  it("passes null, booleans and empty containers through", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson({})).toBe("{}");
    expect(canonicalJson([])).toBe("[]");
    expect(canonicalJson({ a: null, b: [null] })).toBe('{"a":null,"b":[null]}');
  });
});

describe("sha256Hex / hashCanonical — independent oracle via node:crypto", () => {
  it("sha256Hex matches node:crypto on a known vector", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
  it("hashCanonical equals an independent sha256 over the canonical bytes", () => {
    const value = { b: "e\u0301", a: [3, 1, 2], z: { y: 1 } };
    const bytes = Buffer.from(canonicalJson(value), "utf8");
    const expected = createHash("sha256").update(bytes).digest("hex");
    expect(hashCanonical(value)).toBe(expected);
    expect(hashCanonical(value)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("canonicalize does not mutate its input", () => {
    const value = { b: 1, a: { d: 2, c: 3 } };
    const before = JSON.stringify(value);
    canonicalJson(value);
    expect(JSON.stringify(value)).toBe(before);
  });
});
```

## tests/canonical/canonical-boundaries.test.ts

- 行数：168；字节数：6732；SHA-256：`534f6e122938b4517df344f1bfef373e9de9e51f4678daf6d2ec3ed3c0b03580`

```ts
// T011 — canonical JSON extra boundaries (PROJECT_BOOK §6).
//
// The T006 tests pin ASCII/astral key order, NFC values, array order,
// number rendering and strict rejection. These rows pin the remaining
// edges: NFC key collision (two keys that normalise to one), deep
// nesting, empty containers, hash vectors, and canonicalize purity
// (input is never mutated, including nested objects).

import { describe, it, expect } from "vitest";

import {
  canonicalJson,
  canonicalize,
  compareCodePoints,
  hashCanonical,
  sha256Hex,
} from "../../src/canonical/canonical-json.js";

describe("canonicalize — NFC key collisions and nesting", () => {
  it("keys that collide after NFC dedupe to one key (last in code-point order wins)", () => {
    // "e" + combining acute (U+0301) and precomposed "é" (U+00E9) are
    // the same key after NFC. Sorted order puts "e\u0301" first, "é"
    // second, so the precomposed value wins — matching the frozen
    // s0-gate behaviour. Keys are built with explicit escapes so the
    // source file encoding cannot silently normalise them.
    const decomposed = "é";
    const precomposed = "é";
    expect(decomposed).not.toBe(precomposed);
    expect(decomposed.normalize("NFC")).toBe(precomposed);
    const input: Record<string, number> = {};
    input[decomposed] = 1;
    input[precomposed] = 2;
    const out = canonicalize(input) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(["é"]);
    expect(out["é"]).toBe(2);
  });

  it("NFC-normalises keys at every depth", () => {
    const input: Record<string, unknown> = { outer: {} };
    (input["outer"] as Record<string, unknown>)["é"] = "café";
    const out = canonicalJson(input);
    expect(out).toBe('{"outer":{"é":"café"}}');
  });

  it("handles deep nesting without reordering arrays", () => {
    const value = { b: [{ z: 1, a: [3, 2, 1] }, { y: null }], a: {} };
    expect(canonicalJson(value)).toBe('{"a":{},"b":[{"a":[3,2,1],"z":1},{"y":null}]}');
  });

  it("empty object and empty array round-trip", () => {
    expect(canonicalJson({})).toBe("{}");
    expect(canonicalJson([])).toBe("[]");
    expect(canonicalJson({ a: {}, b: [] })).toBe('{"a":{},"b":[]}');
  });

  it("empty-string keys sort first", () => {
    expect(canonicalJson({ b: 1, "": 2, a: 3 })).toBe('{"":2,"a":3,"b":1}');
  });

  it("integer-like keys come out in numeric order (JS plain-object semantics, frozen behaviour)", () => {
    // compareCodePoints would order "1" < "10" < "2", but canonicalize
    // builds a plain JS object and JS engines always enumerate
    // integer-index keys first in ascending numeric order, before any
    // string key — so the output is "1","2","10" regardless of the
    // sorted insertion order. This is the frozen s0-gate behaviour
    // (same plain-object construction); no frozen canonical input
    // uses integer-like keys, so no frozen hash is affected. Pinned
    // here so a future "fix" that changes the output is caught.
    expect(canonicalJson({ "10": 1, "2": 2, "1": 3 })).toBe('{"1":3,"2":2,"10":1}');
    expect(canonicalJson({ "10": 1, "2": 2, a: 0 })).toBe('{"2":2,"10":1,"a":0}');
  });

  it("does not mutate its input, including nested objects and arrays", () => {
    const input = { b: [{ z: 1 }], a: "é" };
    const snapshot = JSON.stringify(input);
    canonicalize(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect((input as { a: string }).a).toBe("é");
  });

  it("canonicalJson is idempotent: canonicalising the parsed output is a fixed point", () => {
    const value = { z: [{ b: "é" }], a: [3, 1] };
    const once = canonicalJson(value);
    const twice = canonicalJson(JSON.parse(once) as unknown);
    expect(twice).toBe(once);
  });
});

describe("compareCodePoints — ordering edges", () => {
  it("empty string sorts before any non-empty string", () => {
    expect(compareCodePoints("", "a")).toBeLessThan(0);
    expect(compareCodePoints("a", "")).toBeGreaterThan(0);
    expect(compareCodePoints("", "")).toBe(0);
  });

  it("equal strings compare 0", () => {
    expect(compareCodePoints("M01", "M01")).toBe(0);
  });

  it("orders M01..M08 lexicographically (the BFS tie-break order)", () => {
    const ids = ["M08", "M02", "M10", "M01"];
    expect([...ids].sort(compareCodePoints)).toEqual(["M01", "M02", "M08", "M10"]);
  });

  it("astral-plane characters sort after the whole BMP", () => {
    expect(compareCodePoints("\u{10FFFF}", "\uFFFF")).toBeGreaterThan(0);
    expect(compareCodePoints("𐀀", "￿")).toBeGreaterThan(0);
  });
});

describe("sha256Hex / hashCanonical — vectors and determinism", () => {
  it("sha256Hex of the empty string is the known vector", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("sha256Hex of 'abc' is the known vector", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashCanonical is 64 lowercase hex chars", () => {
    expect(hashCanonical({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashCanonical differs when any field differs (avalanche spot check)", () => {
    const a = hashCanonical({ fixtureId: "F001", verdict: "STABLE" });
    const b = hashCanonical({ fixtureId: "F001", verdict: "MISSING" });
    const c = hashCanonical({ fixtureId: "F002", verdict: "STABLE" });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it("hashCanonical is stable across runs (same input, same bytes)", () => {
    const value = { seed: "P022-LOCATORSTRESS-S0-2026-11-10", n: 192 };
    expect(hashCanonical(value)).toBe(hashCanonical(value));
  });

  it("hashCanonical of a nested value equals sha256Hex of its canonical text", () => {
    const value = { b: [1, { a: "é" }], a: null };
    expect(hashCanonical(value)).toBe(sha256Hex(canonicalJson(value)));
  });
});

describe("canonicalize — strict rejection edges", () => {
  it("rejects -0? no: -0 is a finite number and renders as 0 (JSON.stringify behaviour)", () => {
    expect(canonicalJson(-0)).toBe("0");
  });

  it("rejects undefined nested inside an array", () => {
    expect(() => canonicalize([1, undefined])).toThrow(/unsupported value/);
  });

  it("rejects a function nested inside an object", () => {
    expect(() => canonicalize({ f: () => 1 })).toThrow(/unsupported value/);
  });

  it("rejects NaN nested inside an object", () => {
    expect(() => canonicalize({ n: NaN })).toThrow(/non-finite number/);
  });

  it("rejects Infinity at the top level", () => {
    expect(() => canonicalize(Infinity)).toThrow(/non-finite number/);
  });
});
```

## tests/canonical/forbidden-scan.test.ts

- 行数：119；字节数：4710；SHA-256：`1cfbbfd0092dca25fca831d687abaef553adbfadf4e9d4d504581a19e3e3e20c`

```ts
// T006 unit tests — forbidden-field scan (PROJECT_BOOK §6).
// The scanner is tested against planted forbidden values (each rule must
// fire on its own target) and against clean canonical bytes (0 hits),
// including the two known near-misses in the frozen data: the word
// "root" inside fixture HTML "shadowrootmode", and the bare date in the
// fixed seed (neither is a leak).
import { describe, it, expect } from "vitest";

import {
  buildScenarioCanonical,
  canonicalJson,
} from "../../src/canonical/index.js";
import {
  buildForbiddenScanRules,
  defaultForbiddenScanContext,
  scanForbiddenFields,
} from "../../src/canonical/forbidden-scan.js";
import { repoRoot } from "../integration/s0-helpers.js";

function ctx() {
  return defaultForbiddenScanContext(repoRoot(), process.env.HOME ?? "");
}

describe("forbidden scan — rule set", () => {
  it("runs a non-empty rule set covering every §6 forbidden category", () => {
    const rules = buildForbiddenScanRules(ctx());
    const ids = rules.map((r) => r.id);
    expect(ids.length).toBeGreaterThanOrEqual(10);
    for (const required of [
      "created-at",
      "wall-clock-iso",
      "epoch-millis",
      "uuid",
      "cdp-object-id",
      "cdp-dotted-id",
      "pid",
      "windows-absolute-path",
      "absolute-path-literal",
      "hostname-literal",
      "username-in-path",
    ]) {
      expect(ids).toContain(required);
    }
    // Every rule carries a human-readable description (listed in the report).
    for (const rule of rules) {
      expect(rule.description.length).toBeGreaterThan(0);
    }
  });
});

describe("forbidden scan — planted values trip their own rule", () => {
  it.each([
    ['{"createdAt":"2026-11-10T19:00:00Z"}', "created-at"],
    ['{"ts":"2026-11-10T19:00:00.123Z"}', "wall-clock-iso"],
    ['{"ts":"2026-11-10 19:00:00"}', "wall-clock-iso"],
    ['{"t":1794000000000}', "epoch-millis"],
    ['{"id":"123e4567-e89b-12d3-a456-426614174000"}', "uuid"],
    ['{"handle":{"objectId":"123456789.1.2"}}', "cdp-object-id"],
    ['{"ref":"123456789.1.2"}', "cdp-dotted-id"],
    ['{"pid":1234}', "pid"],
    ['{"processId":99}', "pid"],
    ['{"path":"C:\\Users\\sam\\file.txt"}', "windows-absolute-path"],
  ])("planted %s trips rule %s", (text, ruleId) => {
    const result = scanForbiddenFields(text, ctx());
    expect(result.totalHits).toBeGreaterThan(0);
    expect(result.hits.map((h) => h.ruleId)).toContain(ruleId);
  });

  it("planted repo-root / HOME / tmpdir / hostname literals trip absolute-path-literal or hostname-literal", () => {
    const c = ctx();
    const byPath = scanForbiddenFields(`{"path":"${c.repoRoot}/x.json"}`, c);
    expect(byPath.hits.map((h) => h.ruleId)).toContain("absolute-path-literal");
    const byHome = scanForbiddenFields(`{"path":"${c.homeDir}/x"}`, c);
    expect(byHome.hits.map((h) => h.ruleId)).toContain("absolute-path-literal");
    const byHost = scanForbiddenFields(`{"host":"${c.hostname}"}`, c);
    expect(byHost.hits.map((h) => h.ruleId)).toContain("hostname-literal");
    const byUser = scanForbiddenFields(`{"path":"/home/${c.username}/x"}`, c);
    expect(byUser.hits.map((h) => h.ruleId)).toContain("username-in-path");
  });
});

describe("forbidden scan — clean bytes and known near-misses", () => {
  it("clean canonical bytes scan 0 hits", () => {
    const text = canonicalJson({
      schema: "locatorstress.scenario-canonical/v1",
      seed: "P022-LOCATORSTRESS-S0-2026-11-10",
      fixtures: [],
    });
    const result = scanForbiddenFields(text, ctx());
    expect(result.totalHits).toBe(0);
    expect(result.hits).toEqual([]);
  });
  it("the bare seed date alone is not a wall clock", () => {
    const result = scanForbiddenFields("P022-LOCATORSTRESS-S0-2026-11-10", ctx());
    expect(result.totalHits).toBe(0);
  });
  it("fixture HTML containing 'shadowrootmode' does NOT trip the username rule (username here is 'root')", () => {
    const c = ctx();
    expect(c.username).toBe("root");
    const text = '<template shadowrootmode="open"><button>Submit</button></template>';
    const result = scanForbiddenFields(text, c);
    expect(result.hits.map((h) => h.ruleId)).not.toContain("username-in-path");
    expect(result.totalHits).toBe(0);
  });
  it("a small built scenario object scans 0 hits end to end", () => {
    const obj = buildScenarioCanonical([
      {
        fixtureId: "F001",
        family: "form-submit",
        kind: "css",
        controlGroup: "stable",
        locator: { kind: "css", selector: "button" },
        html: "<button>Submit</button>",
      },
    ]);
    const result = scanForbiddenFields(canonicalJson(obj), ctx());
    expect(result.totalHits).toBe(0);
  });
});
```

## tests/canonical/hash-contract.test.ts

- 行数：642；字节数：22423；SHA-256：`1d84f16e79aa0ab089d904d2e6735ad086c2124a5990247b2dedf716b221dcac`

```ts
// T006 hash-contract tests — frozen S0 hash reproduction (PROJECT_BOOK §6).
//
// These tests rebuild the four canonical objects INDEPENDENTLY from the
// frozen evidence (not from the module's own outputs, and not from the
// live browser): manifests + HTML files for the scenario, the frozen
// T002 report + golden matrix for the oracle/analysis tallies, and the
// frozen S0_GATE.json for counts/thresholds/notes and for the expected
// hash values themselves. The module under test only supplies the
// builders and the hash functions. Every tally below is a plain loop
// written in this file; the expected hashes are read from
// evidence/s0/S0_GATE.json at run time (they are NOT hardcoded in this
// file, and the module never sees them — it cannot "pass by comparing
// against itself").
//
// Additional evidence in this file:
//   - byte comparison against the frozen S0 script's own exported
//     canonicalJson (scripts/s0-gate.ts, imported read-only);
//   - byte comparison against a small independent canonicaliser written
//     in this file from the §6 text (differential check);
//   - determinism (same input twice -> identical bytes) and an
//     independent node:crypto SHA-256 oracle;
//   - self-reference checks (no canonical input contains its own hash);
//   - forbidden-field scans of all four canonical byte strings (0 hits).
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SEED,
  MUTATION_SUITE,
  S0_THRESHOLDS,
  S0_GATE_NOTES,
  buildScenarioCanonical,
  buildOracleCanonical,
  buildAnalysisCanonical,
  buildGateCounts,
  buildGateCanonical,
  scenarioSha256,
  oracleResultSha256,
  analysisSha256,
  gateSha256,
  canonicalJson,
  sha256Hex,
  type AnalysisInput,
  type Coverage,
  type GateCountsInput,
  type OracleCaseInput,
  type ScenarioFixtureInput,
  type VerdictCounts,
} from "../../src/canonical/index.js";
import {
  defaultForbiddenScanContext,
  scanForbiddenFields,
} from "../../src/canonical/forbidden-scan.js";
import { normalizeLocatorSpec } from "../../src/contracts/locator.js";
import { loadAllFixtureManifests } from "../../src/fixtures/fixture-manifest.js";
import { repoRoot } from "../integration/s0-helpers.js";

const ROOT = repoRoot();

interface T002Case {
  fixtureId: string;
  mutationId: string;
  expectedVerdict: string;
  actualVerdict: string;
  executionStatus: string;
  rawMatchCount: number;
  finalMatchCount: number;
  frameFailureKind: string | null;
  identityMatch: boolean | null;
  match: boolean;
}

interface GoldenCase {
  fixtureId: string;
  mutationId: string;
  expectedVerdict: string;
  reason: string;
}

interface S0GateJson {
  schema: string;
  seed: string;
  result: string;
  failureType: string | null;
  thresholds: Record<string, unknown>;
  counts: Record<string, unknown>;
  hashes: {
    scenario_sha256: string;
    oracle_result_sha256: string;
    analysis_sha256: string;
    gate_sha256: string;
  };
  notes: string[];
}

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf8")) as T;
}

/** s0-gate formatScore, re-implemented here from the §5.5 definition
 *  (100 x stable / completed, 3 dp, trailing zeros trimmed). */
function formatScore(stable: number, completed: number): string {
  if (completed === 0) return "0";
  const raw = (stable * 100) / completed;
  let s = raw.toFixed(3);
  if (s.includes(".")) {
    s = s.replace(/0+$/, "");
    if (s.endsWith(".")) s = s.slice(0, -1);
  }
  return s;
}

/**
 * Independent canonicaliser, written in this test file from the §6
 * text (NFC, code-point key sort, array order preserved, JSON number
 * rendering). Used only as a differential cross-check against the
 * module's canonicalJson — it shares no code with src/canonical/.
 */
function independentCanonicalJson(value: unknown): string {
  const sortKeys = (a: string, b: string): number => {
    const aa = Array.from(a);
    const bb = Array.from(b);
    const n = Math.min(aa.length, bb.length);
    for (let i = 0; i < n; i++) {
      const ca = aa[i].codePointAt(0)!;
      const cb = bb[i].codePointAt(0)!;
      if (ca !== cb) return ca < cb ? -1 : 1;
    }
    return aa.length - bb.length;
  };
  const canon = (v: unknown): unknown => {
    if (v === null) return null;
    if (typeof v === "string") return v.normalize("NFC");
    if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new Error("non-finite");
      return v;
    }
    if (typeof v === "boolean") return v;
    if (Array.isArray(v)) return v.map(canon);
    if (typeof v === "object") {
      const obj = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(obj).sort(sortKeys)) {
        out[k.normalize("NFC")] = canon(obj[k]);
      }
      return out;
    }
    throw new Error("unsupported");
  };
  return JSON.stringify(canon(value));
}

/** Rebuild every input from frozen evidence, using plain loops only. */
function rebuild() {
  const gate = readJson<S0GateJson>("evidence/s0/S0_GATE.json");
  const t002 = readJson<{ seed: string; cases: T002Case[] }>(
    "evidence/s0/T002_MUTATION_REPORT.json",
  );
  const golden = readJson<{ seed: string; cases: GoldenCase[] }>(
    "src/fixtures/golden/expected-verdicts.json",
  );
  const manifests = loadAllFixtureManifests();

  // Preconditions on the frozen evidence itself.
  expect(gate.seed).toBe(SEED);
  expect(t002.seed).toBe(SEED);
  expect(golden.seed).toBe(SEED);
  expect(t002.cases.length).toBe(192);
  expect(golden.cases.length).toBe(192);
  for (const c of t002.cases) {
    expect(c.match).toBe(true);
    expect(c.actualVerdict).toBe(c.expectedVerdict);
  }

  const manifestById = new Map(manifests.map((m) => [m.fixtureId, m]));
  const goldenByKey = new Map(
    golden.cases.map((g) => [`${g.fixtureId}/${g.mutationId}`, g]),
  );

  // --- Scenario inputs: manifests + HTML files (same files s0-gate read).
  const scenarioFixtures: ScenarioFixtureInput[] = manifests.map((m) => ({
    fixtureId: m.fixtureId,
    family: m.family,
    kind: m.kind,
    controlGroup: m.controlGroup,
    locator: m.locator,
    html: readFileSync(
      join(ROOT, "src/fixtures/pages", `${m.fixtureId}.html`),
      "utf8",
    ),
  }));

  // --- Oracle cases: frozen T002 per-case results.
  const oracleCases: OracleCaseInput[] = t002.cases.map((c) => ({
    fixtureId: c.fixtureId,
    mutationId: c.mutationId,
    verdict: c.actualVerdict as OracleCaseInput["verdict"],
    matchCount: c.finalMatchCount,
    identityMatch: c.identityMatch,
    executionStatus: c.executionStatus,
  }));

  // --- Independent tallies for the analysis object.
  const emptyCounts = (): VerdictCounts => ({
    STABLE: 0,
    WRONG_TARGET: 0,
    AMBIGUOUS: 0,
    MISSING: 0,
  });
  const verdictCounts = emptyCounts();
  const verdictCountsByKind: Record<string, VerdictCounts> = {
    css: emptyCounts(),
    xpath: emptyCounts(),
    role: emptyCounts(),
  };
  let completed = 0;
  for (const c of t002.cases) {
    const verdict = c.actualVerdict as keyof VerdictCounts;
    verdictCounts[verdict] += 1;
    const kind = manifestById.get(c.fixtureId)!.kind;
    verdictCountsByKind[kind]![verdict] += 1;
    if (c.executionStatus === "COMPLETED") completed += 1;
  }
  const stableCount = verdictCounts.STABLE;
  const score = formatScore(stableCount, completed);

  const coverage: Coverage = {
    cssFixtures: 0,
    xpathFixtures: 0,
    roleFixtures: 0,
    framePathFixtures: 0,
    framePathCases: 0,
    indexFixtures: 0,
    indexCases: 0,
    twoLayerFramePathFixtures: 0,
  };
  for (const m of manifests) {
    if (m.kind === "css") coverage.cssFixtures += 1;
    if (m.kind === "xpath") coverage.xpathFixtures += 1;
    if (m.kind === "role") coverage.roleFixtures += 1;
    const layers = normalizeLocatorSpec(m.locator).framePath!.length;
    if (layers > 0) coverage.framePathFixtures += 1;
    if (layers >= 2) coverage.twoLayerFramePathFixtures += 1;
    if (m.locator.index !== null && m.locator.index !== undefined) {
      coverage.indexFixtures += 1;
    }
  }
  for (const c of t002.cases) {
    const m = manifestById.get(c.fixtureId)!;
    const layers = normalizeLocatorSpec(m.locator).framePath!.length;
    if (layers > 0) coverage.framePathCases += 1;
    if (m.locator.index !== null && m.locator.index !== undefined) {
      coverage.indexCases += 1;
    }
  }

  const controls = {
    stable: { pairs: 0, mismatches: 0 },
    fragile: { pairs: 0, mismatches: 0 },
  };
  let parityMatched = 0;
  let parityMismatched = 0;
  for (const c of t002.cases) {
    const m = manifestById.get(c.fixtureId)!;
    const g = goldenByKey.get(`${c.fixtureId}/${c.mutationId}`)!;
    const bucket = m.controlGroup === "stable" ? controls.stable : controls.fragile;
    bucket.pairs += 1;
    if (c.actualVerdict !== g.expectedVerdict) bucket.mismatches += 1;
    const expectedIdentity =
      g.expectedVerdict === "STABLE"
        ? true
        : g.expectedVerdict === "WRONG_TARGET"
          ? false
          : null;
    const parityOk =
      c.actualVerdict === g.expectedVerdict &&
      c.finalMatchCount === c.finalMatchCount &&
      c.identityMatch === expectedIdentity &&
      c.executionStatus === "COMPLETED";
    if (parityOk) parityMatched += 1;
    else parityMismatched += 1;
  }

  const analysisInput: AnalysisInput = {
    verdictCounts,
    verdictCountsByKind,
    stabilityScore: { stable: stableCount, completed, score },
    coverage,
    controls,
    analysisStatus: completed === 192 ? "COMPLETE" : "INCOMPLETE",
    oracleParity: {
      compared: 192,
      matched: parityMatched,
      mismatched: parityMismatched,
    },
  };

  const countsInput: GateCountsInput = {
    fixtures: manifests.length,
    stableFixtures: manifests.filter((m) => m.controlGroup === "stable").length,
    fragileFixtures: manifests.filter((m) => m.controlGroup === "fragile").length,
    baselinePassed: 24,
    casesCompleted: completed,
    casesTotal: 192,
    verdictCounts,
    verdictCountsByKind,
    controls,
    oracleParity: analysisInput.oracleParity,
    stabilityScore: analysisInput.stabilityScore,
    coverage,
    externalRequests: 0,
    blockedRequests: 0,
    staticOfflineScanHits: 0,
  };

  return {
    gate,
    t002,
    scenarioFixtures,
    oracleCases,
    analysisInput,
    countsInput,
    verdictCounts,
    verdictCountsByKind,
    coverage,
    controls,
    score,
    completed,
  };
}

describe("frozen S0 hash reproduction", () => {
  it("rebuilt tallies match the frozen S0_GATE.json counts exactly", () => {
    const r = rebuild();
    const frozen = r.gate.counts as Record<string, unknown>;
    expect(r.verdictCounts).toEqual(
      (frozen["verdictCounts"] as unknown) as VerdictCounts,
    );
    expect(r.verdictCountsByKind).toEqual(frozen["verdictCountsByKind"]);
    expect(r.coverage).toEqual(frozen["coverage"]);
    expect(r.score).toBe(
      (frozen["stabilityScore"] as { score: string }).score,
    );
    expect(r.score).toBe("71.875");
    expect(r.completed).toBe(192);
    expect(r.controls.stable).toEqual({ pairs: 96, mismatches: 0 });
    expect(r.controls.fragile).toEqual({ pairs: 96, mismatches: 0 });
    // The module's buildGateCounts must reproduce the frozen counts object.
    const builtCounts = buildGateCounts(r.countsInput);
    expect(canonicalJson(builtCounts)).toBe(canonicalJson(frozen));
    // Module constants must match the frozen thresholds and notes.
    expect(canonicalJson(S0_THRESHOLDS)).toBe(canonicalJson(r.gate.thresholds));
    expect(canonicalJson(S0_GATE_NOTES)).toBe(canonicalJson(r.gate.notes));
    expect(MUTATION_SUITE).toEqual([
      "M01",
      "M02",
      "M03",
      "M04",
      "M05",
      "M06",
      "M07",
      "M08",
    ]);
  });

  it("scenario_sha256 recomputes to the frozen value, character for character", () => {
    const r = rebuild();
    expect(r.scenarioFixtures.length).toBe(24);
    const recomputed = scenarioSha256(r.scenarioFixtures);
    expect(recomputed).toBe(r.gate.hashes.scenario_sha256);
    expect(recomputed).toBe(
      "1ffb5f85561c6dd9f10fc15773097691c5c07fe20c6e9a001e231a41b61c9f22",
    );
  });

  it("oracle_result_sha256 recomputes to the frozen value, character for character", () => {
    const r = rebuild();
    expect(r.oracleCases.length).toBe(192);
    const recomputed = oracleResultSha256(r.oracleCases);
    expect(recomputed).toBe(r.gate.hashes.oracle_result_sha256);
    expect(recomputed).toBe(
      "3502d81fa730605dd85548e39af6b7272015c026e65f91a2dae132c3e345a988",
    );
  });

  it("analysis_sha256 recomputes to the frozen value, character for character", () => {
    const r = rebuild();
    const recomputed = analysisSha256(r.analysisInput);
    expect(recomputed).toBe(r.gate.hashes.analysis_sha256);
    expect(recomputed).toBe(
      "4410d5c85cf5fe8ee858c4e01822cdbc1515c39afa7ba40d833aceb00a9576a4",
    );
  });

  it("gate_sha256 recomputes to the frozen value, character for character", () => {
    const r = rebuild();
    const counts = buildGateCounts(r.countsInput);
    const recomputed = gateSha256({
      result: "PASS",
      failureType: null,
      counts,
      hashes: {
        scenario_sha256: scenarioSha256(r.scenarioFixtures),
        oracle_result_sha256: oracleResultSha256(r.oracleCases),
        analysis_sha256: analysisSha256(r.analysisInput),
      },
    });
    expect(recomputed).toBe(r.gate.hashes.gate_sha256);
    expect(recomputed).toBe(
      "651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52",
    );
  });
});

describe("canonical bytes — determinism, independence, S0-script comparison", () => {
  it("same input twice gives identical canonical bytes (all four objects)", () => {
    const r = rebuild();
    const scenario = buildScenarioCanonical(r.scenarioFixtures);
    const oracle = buildOracleCanonical(r.oracleCases);
    const analysis = buildAnalysisCanonical(r.analysisInput);
    const gateObj = buildGateCanonical({
      result: "PASS",
      failureType: null,
      counts: buildGateCounts(r.countsInput),
      hashes: {
        scenario_sha256: scenarioSha256(r.scenarioFixtures),
        oracle_result_sha256: oracleResultSha256(r.oracleCases),
        analysis_sha256: analysisSha256(r.analysisInput),
      },
    });
    for (const obj of [scenario, oracle, analysis, gateObj]) {
      expect(canonicalJson(obj)).toBe(canonicalJson(obj));
    }
    // Independent SHA-256 oracle (node:crypto, straight over the bytes).
    for (const obj of [scenario, oracle, analysis, gateObj]) {
      const bytes = Buffer.from(canonicalJson(obj), "utf8");
      const expected = createHash("sha256").update(bytes).digest("hex");
      expect(sha256Hex(canonicalJson(obj))).toBe(expected);
    }
  });

  it("module canonical bytes are byte-identical to the frozen S0 script's canonicalJson", async () => {
    const r = rebuild();
    const s0 = (await import(
      "../../scripts/s0-gate.ts"
    )) as unknown as { canonicalJson: (v: unknown) => string };
    const scenario = buildScenarioCanonical(r.scenarioFixtures);
    const oracle = buildOracleCanonical(r.oracleCases);
    const analysis = buildAnalysisCanonical(r.analysisInput);
    const gateObj = buildGateCanonical({
      result: "PASS",
      failureType: null,
      counts: buildGateCounts(r.countsInput),
      hashes: {
        scenario_sha256: scenarioSha256(r.scenarioFixtures),
        oracle_result_sha256: oracleResultSha256(r.oracleCases),
        analysis_sha256: analysisSha256(r.analysisInput),
      },
    });
    for (const obj of [scenario, oracle, analysis, gateObj]) {
      expect(canonicalJson(obj)).toBe(s0.canonicalJson(obj));
    }
    // Crafted NFC / astral-plane sample: the two implementations must
    // agree byte for byte here too, not only on the frozen inputs.
    const sample = {
      "e\u0301": "cafe\u0301",
      a: ["\u{10000}", "\uE000"],
      z: { b: 1, A: 2 },
    };
    expect(canonicalJson(sample)).toBe(s0.canonicalJson(sample));
  });

  it("module canonical bytes match an independent §6 serialiser on all four objects and a crafted sample", () => {
    const r = rebuild();
    const scenario = buildScenarioCanonical(r.scenarioFixtures);
    const oracle = buildOracleCanonical(r.oracleCases);
    const analysis = buildAnalysisCanonical(r.analysisInput);
    const gateObj = buildGateCanonical({
      result: "PASS",
      failureType: null,
      counts: buildGateCounts(r.countsInput),
      hashes: {
        scenario_sha256: scenarioSha256(r.scenarioFixtures),
        oracle_result_sha256: oracleResultSha256(r.oracleCases),
        analysis_sha256: analysisSha256(r.analysisInput),
      },
    });
    for (const obj of [scenario, oracle, analysis, gateObj]) {
      expect(canonicalJson(obj)).toBe(independentCanonicalJson(obj));
    }
    const sample = {
      "e\u0301": "cafe\u0301",
      a: ["\u{10000}", "\uE000"],
      z: { b: 1, A: 2 },
    };
    expect(canonicalJson(sample)).toBe(independentCanonicalJson(sample));
  });
});

describe("no self-reference", () => {
  it("no canonical input contains its own hash string", () => {
    const r = rebuild();
    const scenario = buildScenarioCanonical(r.scenarioFixtures);
    const oracle = buildOracleCanonical(r.oracleCases);
    const analysis = buildAnalysisCanonical(r.analysisInput);
    const scenarioHash = scenarioSha256(r.scenarioFixtures);
    const oracleHash = oracleResultSha256(r.oracleCases);
    const analysisHash = analysisSha256(r.analysisInput);
    expect(canonicalJson(scenario)).not.toContain(scenarioHash);
    expect(canonicalJson(oracle)).not.toContain(oracleHash);
    expect(canonicalJson(analysis)).not.toContain(analysisHash);
    const gateObj = buildGateCanonical({
      result: "PASS",
      failureType: null,
      counts: buildGateCounts(r.countsInput),
      hashes: {
        scenario_sha256: scenarioHash,
        oracle_result_sha256: oracleHash,
        analysis_sha256: analysisHash,
      },
    });
    const gateHash = gateSha256({
      result: "PASS",
      failureType: null,
      counts: buildGateCounts(r.countsInput),
      hashes: {
        scenario_sha256: scenarioHash,
        oracle_result_sha256: oracleHash,
        analysis_sha256: analysisHash,
      },
    });
    expect(canonicalJson(gateObj)).not.toContain(gateHash);
    // The gate object must not even name its own hash field.
    expect(canonicalJson(gateObj)).not.toContain("gate_sha256");
    // ...but it must contain the three lower hashes (they are its inputs).
    expect(canonicalJson(gateObj)).toContain(scenarioHash);
    expect(canonicalJson(gateObj)).toContain(oracleHash);
    expect(canonicalJson(gateObj)).toContain(analysisHash);
  });
});

describe("forbidden-field scan of all four canonical byte strings", () => {
  it("0 hits on every canonical output", () => {
    const r = rebuild();
    const ctx = defaultForbiddenScanContext(ROOT, process.env.HOME ?? "");
    const scenario = buildScenarioCanonical(r.scenarioFixtures);
    const oracle = buildOracleCanonical(r.oracleCases);
    const analysis = buildAnalysisCanonical(r.analysisInput);
    const gateObj = buildGateCanonical({
      result: "PASS",
      failureType: null,
      counts: buildGateCounts(r.countsInput),
      hashes: {
        scenario_sha256: scenarioSha256(r.scenarioFixtures),
        oracle_result_sha256: oracleResultSha256(r.oracleCases),
        analysis_sha256: analysisSha256(r.analysisInput),
      },
    });
    const texts = [
      canonicalJson(scenario),
      canonicalJson(oracle),
      canonicalJson(analysis),
      canonicalJson(gateObj),
    ];
    expect(texts.every((t) => t.length > 0)).toBe(true);
    for (const text of texts) {
      const result = scanForbiddenFields(text, ctx);
      expect(result.rulesRun.length).toBeGreaterThanOrEqual(10);
      expect(result.totalHits).toBe(0);
      expect(result.hits).toEqual([]);
    }
    // The concatenated bytes (what a report bundle would hold) also scan clean.
    const joined = scanForbiddenFields(texts.join("\n"), ctx);
    expect(joined.totalHits).toBe(0);
  });
});

describe("T006 evidence summary (values for T006_HASH_REPORT.json)", () => {
  it("logs canonical byte lengths, the sample hash, and scan totals", () => {
    const r = rebuild();
    const scenario = buildScenarioCanonical(r.scenarioFixtures);
    const oracle = buildOracleCanonical(r.oracleCases);
    const analysis = buildAnalysisCanonical(r.analysisInput);
    const counts = buildGateCounts(r.countsInput);
    const hashes = {
      scenario_sha256: scenarioSha256(r.scenarioFixtures),
      oracle_result_sha256: oracleResultSha256(r.oracleCases),
      analysis_sha256: analysisSha256(r.analysisInput),
    };
    const gateObj = buildGateCanonical({
      result: "PASS",
      failureType: null,
      counts,
      hashes,
    });
    const gateHash = gateSha256({
      result: "PASS",
      failureType: null,
      counts,
      hashes,
    });
    const texts = {
      scenario: canonicalJson(scenario),
      oracle: canonicalJson(oracle),
      analysis: canonicalJson(analysis),
      gate: canonicalJson(gateObj),
    };
    const sample = { "e\u0301": "cafe\u0301", a: ["\u{10000}", "\uE000"], z: { b: 1, A: 2 } };
    const sampleCanonical = canonicalJson(sample);
    const ctx = defaultForbiddenScanContext(ROOT, process.env.HOME ?? "");
    const scans = Object.fromEntries(
      Object.entries(texts).map(([k, t]) => [
        k,
        scanForbiddenFields(t, ctx).totalHits,
      ]),
    );
    console.log(
      "T006_EVIDENCE " +
        JSON.stringify({
          byteLengths: Object.fromEntries(
            Object.entries(texts).map(([k, t]) => [
              k,
              Buffer.byteLength(t, "utf8"),
            ]),
          ),
          canonicalSha256: {
            scenario: sha256Hex(texts.scenario),
            oracle: sha256Hex(texts.oracle),
            analysis: sha256Hex(texts.analysis),
            gate: gateHash,
          },
          sampleCanonical,
          sampleSha256: sha256Hex(sampleCanonical),
          forbiddenScanHits: scans,
          rulesRun: scanForbiddenFields(texts.scenario, ctx).rulesRun,
        }),
    );
    expect(gateHash).toBe(r.gate.hashes.gate_sha256);
  });
});
```

## tests/contracts/locator-spec.test.ts

- 行数：266；字节数：9350；SHA-256：`815c590802230c9b54f7f97321d82fc675bfc9c611e23dfb9f1ac51315f60317`

```ts
// T011 — LocatorSpec validation boundaries (PROJECT_BOOK §3.3, §11.1).
//
// No dedicated unit test file existed for validateLocatorSpec /
// parseLocatorSpec / normalizeLocatorSpec: they were only exercised
// indirectly through API routes and golden fixtures. This file pins
// every validation rule with positive, negative and boundary cases,
// including the exact error strings the API surfaces.

import { describe, it, expect } from "vitest";

import {
  normalizeLocatorSpec,
  parseLocatorSpec,
  validateLocatorSpec,
} from "../../src/contracts/locator.js";

describe("validateLocatorSpec — valid specs", () => {
  it("accepts a minimal css spec", () => {
    expect(validateLocatorSpec({ kind: "css", selector: "button.primary" })).toEqual([]);
  });

  it("accepts a minimal xpath spec", () => {
    expect(validateLocatorSpec({ kind: "xpath", selector: "//button[1]" })).toEqual([]);
  });

  it("accepts a minimal role spec with no name", () => {
    expect(validateLocatorSpec({ kind: "role", role: "button" })).toEqual([]);
  });

  it("accepts a full role spec: name + exact + includeHidden + framePath + index", () => {
    expect(
      validateLocatorSpec({
        kind: "role",
        role: "button",
        name: "Save",
        exact: true,
        includeHidden: false,
        framePath: ["iframe.a", "iframe.b"],
        index: 0,
      }),
    ).toEqual([]);
  });

  it("accepts index 0 (boundary: first element) and a large index", () => {
    expect(validateLocatorSpec({ kind: "css", selector: "a", index: 0 })).toEqual([]);
    expect(validateLocatorSpec({ kind: "css", selector: "a", index: 999 })).toEqual([]);
  });

  it("accepts explicit null / undefined index", () => {
    expect(validateLocatorSpec({ kind: "css", selector: "a", index: null })).toEqual([]);
    expect(validateLocatorSpec({ kind: "css", selector: "a", index: undefined })).toEqual([]);
  });

  it("accepts an empty framePath (boundary: 0 layers)", () => {
    expect(validateLocatorSpec({ kind: "css", selector: "a", framePath: [] })).toEqual([]);
  });

  it("accepts a 2-layer framePath (boundary: maximum depth)", () => {
    expect(
      validateLocatorSpec({ kind: "css", selector: "a", framePath: ["iframe.a", "iframe.b"] }),
    ).toEqual([]);
  });
});

describe("validateLocatorSpec — kind and selector", () => {
  it("rejects a missing kind", () => {
    expect(validateLocatorSpec({ selector: "a" })).toContain(
      'kind must be one of "css", "xpath", "role"',
    );
  });

  it("rejects an unknown kind", () => {
    expect(validateLocatorSpec({ kind: "text", selector: "Save" })).toContain(
      'kind must be one of "css", "xpath", "role"',
    );
  });

  it("rejects a non-string kind", () => {
    expect(validateLocatorSpec({ kind: 42, selector: "a" }).length).toBeGreaterThan(0);
  });

  it("rejects an empty css selector", () => {
    expect(validateLocatorSpec({ kind: "css", selector: "" })).toContain(
      'selector must be a non-empty string when kind is "css"',
    );
  });

  it("rejects a missing css selector", () => {
    expect(validateLocatorSpec({ kind: "css" })).toContain(
      'selector must be a non-empty string when kind is "css"',
    );
  });

  it("rejects an empty xpath selector", () => {
    expect(validateLocatorSpec({ kind: "xpath", selector: "" })).toContain(
      'selector must be a non-empty string when kind is "xpath"',
    );
  });

  it("rejects a missing role name", () => {
    expect(validateLocatorSpec({ kind: "role" })).toContain(
      'role must be a non-empty string when kind is "role"',
    );
  });

  it("rejects an empty role name", () => {
    expect(validateLocatorSpec({ kind: "role", role: "" })).toContain(
      'role must be a non-empty string when kind is "role"',
    );
  });

  it("rejects a selector key on a role spec", () => {
    expect(validateLocatorSpec({ kind: "role", role: "button", selector: "button" })).toContain(
      '"selector" is not allowed when kind is "role"',
    );
  });

  it("rejects role/name/exact keys on a css spec", () => {
    const errors = validateLocatorSpec({ kind: "css", selector: "a", role: "button" });
    expect(errors).toContain('"role" is not allowed when kind is "css"');
    expect(validateLocatorSpec({ kind: "css", selector: "a", name: "Save" })).toContain(
      '"name" is not allowed when kind is "css"',
    );
    expect(validateLocatorSpec({ kind: "css", selector: "a", exact: true })).toContain(
      '"exact" is not allowed when kind is "css"',
    );
  });

  it("rejects an unknown key", () => {
    expect(validateLocatorSpec({ kind: "css", selector: "a", filter: "x" })).toContain(
      "unknown key: filter",
    );
  });

  it("rejects non-object specs", () => {
    expect(validateLocatorSpec(null)).toEqual(["spec must be a plain object"]);
    expect(validateLocatorSpec("css")).toEqual(["spec must be a plain object"]);
    expect(validateLocatorSpec(42)).toEqual(["spec must be a plain object"]);
    expect(validateLocatorSpec(["css"])).toEqual(["spec must be a plain object"]);
    expect(validateLocatorSpec(undefined)).toEqual(["spec must be a plain object"]);
  });
});

describe("validateLocatorSpec — framePath and index boundaries", () => {
  it("rejects a 3-layer framePath (boundary: one over the maximum)", () => {
    expect(
      validateLocatorSpec({
        kind: "css",
        selector: "a",
        framePath: ["iframe.a", "iframe.b", "iframe.c"],
      }),
    ).toContain("framePath must contain at most 2 entries");
  });

  it("rejects a non-array framePath", () => {
    expect(validateLocatorSpec({ kind: "css", selector: "a", framePath: "iframe.a" })).toContain(
      "framePath must be an array of 0-2 non-empty strings",
    );
  });

  it("rejects an empty framePath entry", () => {
    expect(validateLocatorSpec({ kind: "css", selector: "a", framePath: [""] })).toContain(
      "framePath[0] must be a non-empty string",
    );
    expect(
      validateLocatorSpec({ kind: "css", selector: "a", framePath: ["iframe.a", ""] }),
    ).toContain("framePath[1] must be a non-empty string");
  });

  it("rejects a non-string framePath entry", () => {
    expect(validateLocatorSpec({ kind: "css", selector: "a", framePath: [7] })).toContain(
      "framePath[0] must be a non-empty string",
    );
  });

  it("rejects a negative index (boundary: -1)", () => {
    expect(validateLocatorSpec({ kind: "css", selector: "a", index: -1 })).toContain(
      "index must be null/undefined or a non-negative integer",
    );
  });

  it("rejects a fractional index (boundary: 1.5)", () => {
    expect(validateLocatorSpec({ kind: "css", selector: "a", index: 1.5 })).toContain(
      "index must be null/undefined or a non-negative integer",
    );
  });

  it("rejects a string index", () => {
    expect(validateLocatorSpec({ kind: "css", selector: "a", index: "0" })).toContain(
      "index must be null/undefined or a non-negative integer",
    );
  });

  it("rejects an empty role name when present", () => {
    expect(validateLocatorSpec({ kind: "role", role: "button", name: "" })).toContain(
      "name must be a non-empty string if present",
    );
  });

  it("rejects a non-string role name when present", () => {
    expect(validateLocatorSpec({ kind: "role", role: "button", name: 3 })).toContain(
      "name must be a non-empty string if present",
    );
  });

  it("rejects a non-boolean exact / includeHidden", () => {
    expect(validateLocatorSpec({ kind: "role", role: "button", exact: "yes" })).toContain(
      "exact must be a boolean if present",
    );
    expect(validateLocatorSpec({ kind: "role", role: "button", includeHidden: 1 })).toContain(
      "includeHidden must be a boolean if present",
    );
  });
});

describe("parseLocatorSpec / normalizeLocatorSpec", () => {
  it("parse returns the spec unchanged when valid", () => {
    const spec = { kind: "css", selector: "a" };
    expect(parseLocatorSpec(spec)).toEqual(spec);
  });

  it("parse throws with the joined errors when invalid", () => {
    expect(() => parseLocatorSpec({ kind: "css" })).toThrow(/Invalid LocatorSpecV1/);
    expect(() => parseLocatorSpec({ kind: "css" })).toThrow(/selector must be a non-empty string/);
  });

  it("normalize fills defaults: exact/includeHidden false, framePath [], index null", () => {
    expect(normalizeLocatorSpec({ kind: "css", selector: "a" })).toEqual({
      kind: "css",
      selector: "a",
      exact: false,
      includeHidden: false,
      framePath: [],
      index: null,
    });
  });

  it("normalize keeps explicit values and drops nothing it was given", () => {
    expect(
      normalizeLocatorSpec({
        kind: "role",
        role: "button",
        name: "Save",
        exact: true,
        includeHidden: true,
        framePath: ["iframe.a"],
        index: 2,
      }),
    ).toEqual({
      kind: "role",
      role: "button",
      name: "Save",
      exact: true,
      includeHidden: true,
      framePath: ["iframe.a"],
      index: 2,
    });
  });

  it("normalize copies framePath (mutating the copy does not mutate the input)", () => {
    const input = { kind: "css" as const, selector: "a", framePath: ["iframe.a"] };
    const out = normalizeLocatorSpec(input);
    out.framePath!.push("iframe.b");
    expect(input.framePath).toEqual(["iframe.a"]);
  });
});
```

## tests/property/property.test.ts

- 行数：246；字节数：11018；SHA-256：`a67b8d78e48a8df1a9c2a4d4283f4103389aa7913fb5a68ddd5d9e3690967c4e`

```ts
// T011 — property tests (deterministic, seeded; no Math.random, no
// wall clock). Each property is checked over a fixed pseudo-random
// input set generated by a small LCG with a frozen seed, so the same
// run always exercises the same cases.
//
// Properties:
//   P1 canonicalisation is a fixed point and key-order independent.
//   P2 score rows always satisfy the counting invariants.
//   P3 BFS is deterministic: same evaluator + options -> identical result.
//   P4 verdict classification is total over the (counts x identity) grid.
//   P5 the frozen golden matrix is complete and well-formed (24x8).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson, hashCanonical } from "../../src/canonical/canonical-json.js";
import {
  computeControlMetrics,
  computeStabilityScores,
  type ScoreCase,
} from "../../src/score/stability-score.js";
import { classifyVerdict } from "../../src/verdict/classify.js";
import type { ResolverResult } from "../../src/runner/execution.js";
import { runBoundedBfs, type BfsEvaluator } from "../../src/search/bfs.js";
import { FIXTURE_IDS, SEED } from "../../src/fixtures/fixture-manifest.js";
import { MUTATION_ORDER } from "../../src/mutations/registry.js";

/** Tiny deterministic PRNG (LCG, Numerical Recipes constants). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const VERDICTS = ["STABLE", "WRONG_TARGET", "AMBIGUOUS", "MISSING"] as const;
const KINDS = ["css", "xpath", "role"] as const;

describe("P1 — canonicalisation is a fixed point and key-order independent", () => {
  it("canonicalJson(parse(canonicalJson(v))) === canonicalJson(v) for 200 seeded values", () => {
    const rand = lcg(0x9e3779b9);
    const words = ["a", "M01", "é", "𐀀", "x", "10", "2", ""];
    for (let i = 0; i < 200; i += 1) {
      const obj: Record<string, unknown> = {};
      const n = 1 + Math.floor(rand() * 4);
      for (let k = 0; k < n; k += 1) {
        const key = words[Math.floor(rand() * words.length)]! + String(Math.floor(rand() * 3));
        obj[key] = rand() < 0.5 ? Math.floor(rand() * 100) : words[Math.floor(rand() * words.length)];
      }
      const once = canonicalJson(obj);
      // Rebuild with shuffled key order.
      const entries = Object.entries(obj);
      for (let j = entries.length - 1; j > 0; j -= 1) {
        const m = Math.floor(rand() * (j + 1));
        [entries[j], entries[m]] = [entries[m]!, entries[j]!];
      }
      const shuffled = canonicalJson(Object.fromEntries(entries));
      expect(shuffled).toBe(once);
      expect(canonicalJson(JSON.parse(once) as unknown)).toBe(once);
      expect(hashCanonical(obj)).toBe(hashCanonical(JSON.parse(once) as unknown));
    }
  });
});

describe("P2 — score rows always satisfy the counting invariants", () => {
  it("stable+wrong+ambiguous+missing+incomplete == expected; completed == expected-incomplete; score == 100*stable/completed", () => {
    const rand = lcg(20261110);
    for (let trial = 0; trial < 100; trial += 1) {
      const cases: ScoreCase[] = [];
      const n = Math.floor(rand() * 24);
      for (let i = 0; i < n; i += 1) {
        const incomplete = rand() < 0.2;
        cases.push({
          fixtureId: `F${String(1 + Math.floor(rand() * 24)).padStart(3, "0")}`,
          mutationId: MUTATION_ORDER[Math.floor(rand() * 8)]!,
          locatorKind: KINDS[Math.floor(rand() * 3)]!,
          controlGroup: rand() < 0.5 ? "stable" : "fragile",
          expectedVerdict: VERDICTS[Math.floor(rand() * 4)]!,
          verdict: incomplete ? null : VERDICTS[Math.floor(rand() * 4)]!,
          analysisStatus: incomplete ? "INCOMPLETE" : "COMPLETE",
        });
      }
      const out = computeStabilityScores(cases);
      const r = out.overall;
      expect(r.stable + r.wrongTarget + r.ambiguous + r.missing + r.incomplete).toBe(r.expected);
      expect(r.completed).toBe(r.expected - r.incomplete);
      expect(r.scoreNumerator).toBe(r.stable);
      expect(r.scoreDenominator).toBe(r.completed);
      expect(r.coverageNumerator).toBe(r.completed);
      expect(r.coverageDenominator).toBe(r.expected);
      expect(r.analysisStatus).toBe(r.incomplete === 0 ? "COMPLETE" : "INCOMPLETE");
      // Per-locator rows sum to the overall row.
      let sumExpected = 0;
      let sumCompleted = 0;
      for (const kind of KINDS) {
        sumExpected += out.perLocator[kind].expected;
        sumCompleted += out.perLocator[kind].completed;
      }
      expect(sumExpected).toBe(r.expected);
      expect(sumCompleted).toBe(r.completed);
      // Control metrics agree with the same case list.
      const controls = computeControlMetrics(cases);
      const stableCases = cases.filter((c) => c.controlGroup === "stable");
      expect(controls.stable.pairs).toBe(stableCases.length);
      expect(controls.stable.matched + controls.stable.mismatched).toBe(stableCases.length);
      expect(controls.stable.mismatched).toBe(
        stableCases.filter((c) => c.verdict !== c.expectedVerdict).length,
      );
    }
  });
});

describe("P3 — BFS is deterministic", () => {
  it("same evaluator + options run twice gives byte-identical results", async () => {
    const failingAt: Record<string, "MISSING" | "STABLE"> = { "M02": "MISSING" };
    const evaluator: BfsEvaluator = async (sequence) => {
      const key = sequence.join("+");
      const verdict = failingAt[key] ?? "STABLE";
      return { verdict, analysisStatus: "COMPLETE", stateKey: `k:${key}` };
    };
    const options = { fixtureId: "F001", maxDepth: 3, maxExpandedStates: 100 };
    const a = await runBoundedBfs(evaluator, options);
    const b = await runBoundedBfs(evaluator, options);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.status).toBe("FOUND");
    expect(a.witness).toEqual({ sequence: ["M02"], depth: 1, verdict: "MISSING" });
  });

  it("BFS never returns a witness longer than maxDepth, over 50 seeded evaluators", async () => {
    const rand = lcg(0x51d15ea);
    for (let trial = 0; trial < 50; trial += 1) {
      const failDepth = 1 + Math.floor(rand() * 6);
      const evaluator: BfsEvaluator = async (sequence) => {
        const verdict = sequence.length === failDepth ? "WRONG_TARGET" : "STABLE";
        return { verdict, analysisStatus: "COMPLETE", stateKey: `k:${sequence.join("+")}` };
      };
      const out = await runBoundedBfs(evaluator, { fixtureId: "F001", maxDepth: 4, maxExpandedStates: 200 });
      if (out.status === "FOUND") {
        expect(out.witness!.depth).toBeLessThanOrEqual(4);
        expect(out.witness!.sequence.length).toBe(out.witness!.depth);
      }
    }
  });
});

describe("P4 — verdict classification is total over the counts x identity grid", () => {
  it("every (raw, final, frameFailure, identity, status) combination yields a verdict or a justified null", () => {
    const counts: Array<[number, number]> = [];
    for (const raw of [0, 1, 2, 3]) {
      for (const final of [0, 1, 2, 3]) {
        counts.push([raw, final]);
      }
    }
    const identities: Array<boolean | null> = [true, false, null];
    for (const [raw, final] of counts) {
      for (const identity of identities) {
        for (const frame of [null, "missing", "ambiguous"] as const) {
          const result: ResolverResult = {
            executionStatus: "COMPLETED",
            rawMatchCount: raw,
            finalMatchCount: final,
            frameFailure:
              frame === null
                ? null
                : {
                    layer: 0,
                    selector: "iframe.a",
                    matchCount: frame === "missing" ? 0 : 2,
                    kind: frame === "missing" ? "FRAME_MISSING" : "FRAME_AMBIGUOUS",
                  },
            errorMessage: null,
          };
          const out = classifyVerdict(result, identity);
          // Totality: verdict null ⟺ INCOMPLETE; verdict non-null ⟺ COMPLETE.
          expect(out.verdict !== null).toBe(out.analysisStatus === "COMPLETE");
          expect(out.executionStatus).toBe("COMPLETED");
          expect(out.reason.length).toBeGreaterThan(0);
          // Soundness: STABLE requires exactly 1 final match + identity true + no frame failure.
          if (out.verdict === "STABLE") {
            expect(final).toBe(1);
            expect(identity).toBe(true);
            expect(frame).toBeNull();
          }
          // Soundness: a contradictory count can never produce a verdict.
          if (final > raw) {
            expect(out.verdict).toBeNull();
          }
          // Soundness: with valid counts (final <= raw), a frame failure
          // always decides (never falls through to identity). With
          // contradictory counts the count-sanity rule (§5.2 step 2)
          // fires first and yields null — before the frame rule.
          if (final <= raw) {
            if (frame === "ambiguous") {
              expect(out.verdict).toBe("AMBIGUOUS");
            }
            if (frame === "missing") {
              expect(out.verdict).toBe("MISSING");
            }
          }
        }
      }
    }
  });
});

describe("P5 — the frozen golden matrix is complete and well-formed", () => {
  it("192 cases: 24 fixtures x 8 mutations, unique keys, seed matches, every verdict a known four-state value", () => {
    const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
    const parsed = JSON.parse(
      readFileSync(join(repoRoot, "src/fixtures/golden/expected-verdicts.json"), "utf8"),
    ) as {
      seed: string;
      cases: Array<{ fixtureId: string; mutationId: string; expectedVerdict: string; reason: string }>;
    };
    expect(parsed.seed).toBe(SEED);
    expect(parsed.cases.length).toBe(192);
    const keys = new Set<string>();
    for (const c of parsed.cases) {
      const key = `${c.fixtureId}/${c.mutationId}`;
      expect(keys.has(key)).toBe(false);
      keys.add(key);
      expect(FIXTURE_IDS).toContain(c.fixtureId);
      expect(MUTATION_ORDER).toContain(c.mutationId as (typeof MUTATION_ORDER)[number]);
      expect(VERDICTS).toContain(c.expectedVerdict as (typeof VERDICTS)[number]);
      expect(typeof c.reason).toBe("string");
      expect(c.reason.length).toBeGreaterThan(0);
    }
    // Every fixture has all 8 mutations; every mutation has all 24 fixtures.
    for (const fid of FIXTURE_IDS) {
      for (const mid of MUTATION_ORDER) {
        expect(keys.has(`${fid}/${mid}`)).toBe(true);
      }
    }
    // Four-state coverage: each state has at least 8 golden cases (§12.2).
    const counts = new Map<string, number>();
    for (const c of parsed.cases) {
      counts.set(c.expectedVerdict, (counts.get(c.expectedVerdict) ?? 0) + 1);
    }
    for (const v of VERDICTS) {
      expect(counts.get(v) ?? 0).toBeGreaterThanOrEqual(8);
    }
  });
});
```

## tests/mutations/mutation-operators.test.ts

- 行数：281；字节数：12696；SHA-256：`4a248d04453e5d9268134432ac74e84df2c7276be84cf5a1d78f29c8943543b2`

```ts
// T011 — M01–M08 operator unit tests on minimal synthetic pages
// (PROJECT_BOOK §4; src/mutations/M01–M08).
//
// Previously the operators were only exercised through the 192-case
// integration run. These tests pin each operator's DOM effect in
// isolation, plus the two cross-cutting invariants:
//   - the Oracle target node keeps its identity (same DOM object);
//   - applying the same operator to two fresh pages gives identical DOM.
//
// Each test uses a fresh page so operators never interfere.

import { describe, it, expect, beforeAll, afterAll } from "vitest";

import type { BaselineBrowser } from "../../src/runner/browser.js";
import { isSameElement } from "../../src/oracle/identity-compare.js";
import { MUTATION_ORDER, getMutation } from "../../src/mutations/registry.js";
import type { MutationContext } from "../../src/mutations/types.js";
import { launchTestBrowser } from "../integration/s0-helpers.js";

const PAGE_HTML = `<main>
  <button class="primary" aria-label="Save">Save</button>
  <button class="secondary">Cancel</button>
  <a href="/x" class="nav">Home</a>
</main>`;

function ctx(overrides: Partial<MutationContext> = {}): MutationContext {
  return {
    fixtureId: "T011-OPERATORS",
    seed: "P022-LOCATORSTRESS-S0-2026-11-10",
    m03Token: "primary",
    framePath: [],
    newText: "Changed Text",
    ...overrides,
  };
}

describe("mutation registry", () => {
  it("exposes M01–M08 in fixed order with matching ids and names", () => {
    expect(MUTATION_ORDER).toEqual(["M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08"]);
    const names: Record<string, string> = {
      M01: "WRAP_TARGET",
      M02: "REORDER_SIBLINGS",
      M03: "CHANGE_CLASS",
      M04: "INSERT_SAME_NAME",
      M05: "NESTED_IFRAME",
      M06: "MOVE_TO_OPEN_SHADOW_ROOT",
      M07: "INSERT_HIDDEN_DUPLICATE",
      M08: "CHANGE_TEXT",
    };
    for (const id of MUTATION_ORDER) {
      const def = getMutation(id);
      expect(def.id).toBe(id);
      expect(def.name).toBe(names[id]);
      expect(typeof def.apply).toBe("function");
    }
  });
});

describe("M01–M08 operators (real Chromium)", () => {
  let browserHandle: BaselineBrowser;

  beforeAll(async () => {
    browserHandle = await launchTestBrowser();
  });

  afterAll(async () => {
    await browserHandle.close();
  });

  async function freshPageWithTarget() {
    const page = browserHandle.page;
    await page.setContent(PAGE_HTML);
    const target = await page.locator("button.primary").elementHandle();
    if (target === null) throw new Error("target handle is null");
    return { page, target };
  }

  it("M01 wraps the target in a div.wrap; target identity is preserved", async () => {
    const { page, target } = await freshPageWithTarget();
    await getMutation("M01").apply(page, target, ctx());
    const parentClass = await page.evaluate(() => {
      const t = document.querySelector("button.primary")!;
      return (t.parentElement as HTMLElement).className;
    });
    expect(parentClass).toBe("wrap");
    expect(await page.locator("div.wrap > button.primary").count()).toBe(1);
    expect(await isSameElement(page, target, await page.locator("button.primary").elementHandle())).toBe(true);
  });

  it("M02 swaps the target with its next sibling (target moves after Cancel)", async () => {
    const { page, target } = await freshPageWithTarget();
    await getMutation("M02").apply(page, target, ctx());
    const order = await page.evaluate(() =>
      [...document.querySelectorAll("main > *")].map((el) => el.textContent),
    );
    expect(order).toEqual(["Cancel", "Save", "Home"]);
    expect(await isSameElement(page, target, await page.locator("button.primary").elementHandle())).toBe(true);
  });

  it("M02 on the last element swaps with the previous sibling instead", async () => {
    const page = browserHandle.page;
    await page.setContent(PAGE_HTML);
    const target = await page.locator("a.nav").elementHandle();
    if (target === null) throw new Error("target handle is null");
    await getMutation("M02").apply(page, target, ctx());
    const order = await page.evaluate(() =>
      [...document.querySelectorAll("main > *")].map((el) => el.textContent),
    );
    expect(order).toEqual(["Save", "Home", "Cancel"]);
  });

  it("M02 on a lone child is a no-op (no siblings to swap with)", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button class="only">Only</button></main>`);
    const target = await page.locator("button.only").elementHandle();
    if (target === null) throw new Error("target handle is null");
    const before = await page.evaluate(() => document.querySelector("main")!.innerHTML);
    await getMutation("M02").apply(page, target, ctx());
    const after = await page.evaluate(() => document.querySelector("main")!.innerHTML);
    expect(after).toBe(before);
  });

  it("M03 replaces the token class with token-changed; other classes untouched", async () => {
    const { page, target } = await freshPageWithTarget();
    await getMutation("M03").apply(page, target, ctx());
    expect(await page.locator("button.primary-changed").count()).toBe(1);
    expect(await page.locator("button.primary").count()).toBe(0);
    expect(await page.locator("button.secondary").count()).toBe(1);
  });

  it("M03 is a no-op when the token is not on the target", async () => {
    const { page, target } = await freshPageWithTarget();
    const before = await page.evaluate(() => document.querySelector("main")!.innerHTML);
    await getMutation("M03").apply(page, target, ctx({ m03Token: "absent-token" }));
    const after = await page.evaluate(() => document.querySelector("main")!.innerHTML);
    expect(after).toBe(before);
  });

  it("M04 inserts a decoy before the target with same tag/class/text/aria-label, as a different node", async () => {
    const { page, target } = await freshPageWithTarget();
    await getMutation("M04").apply(page, target, ctx());
    expect(await page.locator("button.primary").count()).toBe(2);
    const check = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button.primary")];
      const [decoy, original] = buttons as [HTMLElement, HTMLElement];
      return {
        firstText: decoy.textContent,
        firstAria: decoy.getAttribute("aria-label"),
        decoyBeforeTarget: (decoy.compareDocumentPosition(original) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      };
    });
    expect(check.firstText).toBe("Save");
    expect(check.firstAria).toBe("Save");
    expect(check.decoyBeforeTarget).toBe(true);
    // The decoy is a different DOM object from the Oracle target.
    const decoyHandle = await page.locator("button.primary").first().elementHandle();
    expect(await isSameElement(page, decoyHandle, target)).toBe(false);
  });

  it("M05 appends a srcdoc-only iframe to body when framePath is empty", async () => {
    const { page, target } = await freshPageWithTarget();
    await getMutation("M05").apply(page, target, ctx());
    const frames = await page.evaluate(() => {
      const iframes = [...document.querySelectorAll("iframe")];
      return iframes.map((f) => ({ srcdoc: f.srcdoc, src: f.getAttribute("src") }));
    });
    expect(frames).toHaveLength(1);
    expect(frames[0]!.srcdoc).toContain("Decoy");
    expect(frames[0]!.src).toBeNull();
    expect(await page.locator("button.primary").count()).toBe(1);
  });

  it("M05 with a framePath appends a decoy iframe beside the framed iframe, copying its class", async () => {
    const page = browserHandle.page;
    await page.setContent(
      `<main><iframe class="frame-a" srcdoc="<button class='primary'>Save</button>"></iframe></main>`,
    );
    // The button lives inside the srcdoc iframe, so it must be
    // reached through a frameLocator; page.locator only searches the
    // main frame and elementHandle() would auto-wait past the test
    // timeout on a non-matching selector.
    const target = await page
      .frameLocator("iframe.frame-a")
      .locator("button.primary")
      .elementHandle();
    if (target === null) throw new Error("target handle is null");
    await getMutation("M05").apply(page, target, ctx({ framePath: ["iframe.frame-a"] }));
    const info = await page.evaluate(() => {
      const iframes = [...document.querySelectorAll("main > iframe")];
      return {
        count: iframes.length,
        classes: iframes.map((f) => f.className),
        srcdocs: iframes.map((f) => f.srcdoc),
      };
    });
    expect(info.count).toBe(2);
    expect(info.classes).toEqual(["frame-a", "frame-a"]);
    expect(info.srcdocs[1]).toContain("Decoy");
  });

  it("M06 moves the target into an open shadow root; light DOM no longer contains it, identity preserved", async () => {
    const { page, target } = await freshPageWithTarget();
    await getMutation("M06").apply(page, target, ctx());
    // The light DOM no longer contains the button. (Playwright's CSS
    // engine pierces open shadow roots, so page.locator still finds
    // it — the correct observable is document.querySelector, not the
    // locator count.)
    const inLightDom = await page.evaluate(() => document.querySelector("button.primary") !== null);
    expect(inLightDom).toBe(false);
    const inShadow = await page.evaluate(() => {
      const host = document.querySelector("div.m06-shadow-host") as HTMLElement | null;
      if (!host || !host.shadowRoot) return false;
      return host.shadowRoot.querySelector("button.primary") !== null;
    });
    expect(inShadow).toBe(true);
    const shadowHandle = await page.evaluateHandle(() => {
      const host = document.querySelector("div.m06-shadow-host") as HTMLElement;
      return host.shadowRoot!.querySelector("button.primary") as Element;
    });
    const shadowEl = shadowHandle.asElement();
    expect(shadowEl).not.toBeNull();
    expect(await isSameElement(page, shadowEl, target)).toBe(true);
  });

  it("M07 inserts a hidden duplicate (display:none + aria-hidden) before the target", async () => {
    const { page, target } = await freshPageWithTarget();
    await getMutation("M07").apply(page, target, ctx());
    expect(await page.locator("button.primary").count()).toBe(2);
    const hidden = await page.evaluate(() => {
      const first = document.querySelectorAll("button.primary")[0] as HTMLElement;
      return {
        display: first.style.display,
        ariaHidden: first.getAttribute("aria-hidden"),
        visible: first.offsetParent !== null,
      };
    });
    expect(hidden.display).toBe("none");
    expect(hidden.ariaHidden).toBe("true");
    expect(hidden.visible).toBe(false);
    const decoyHandle = await page.locator("button.primary").first().elementHandle();
    expect(await isSameElement(page, decoyHandle, target)).toBe(false);
  });

  it("M08 replaces the target text with ctx.newText and leaves attributes untouched", async () => {
    const { page, target } = await freshPageWithTarget();
    await getMutation("M08").apply(page, target, ctx());
    const info = await page.evaluate(() => {
      const b = document.querySelector("button.primary") as HTMLElement;
      return { text: b.textContent, cls: b.className, aria: b.getAttribute("aria-label") };
    });
    expect(info).toEqual({ text: "Changed Text", cls: "primary", aria: "Save" });
  });

  it("M08 with an empty newText clears the text", async () => {
    const { page, target } = await freshPageWithTarget();
    await getMutation("M08").apply(page, target, ctx({ newText: "" }));
    expect(await page.evaluate(() => document.querySelector("button.primary")!.textContent)).toBe("");
  });

  it("determinism: each operator applied to two fresh pages gives identical DOM", async () => {
    const page = browserHandle.page;
    for (const id of MUTATION_ORDER) {
      const doms: string[] = [];
      for (let run = 0; run < 2; run += 1) {
        await page.setContent(PAGE_HTML);
        const target = await page.locator("button.primary").elementHandle();
        if (target === null) throw new Error("target handle is null");
        await getMutation(id).apply(page, target, ctx());
        doms.push(await page.evaluate(() => document.querySelector("main")!.outerHTML));
      }
      expect(doms[0], `operator ${id} must be deterministic`).toBe(doms[1]);
    }
  });

  it("M01 applied twice nests twice (wrap is not idempotent by design)", async () => {
    const { page, target } = await freshPageWithTarget();
    await getMutation("M01").apply(page, target, ctx());
    await getMutation("M01").apply(page, target, ctx());
    expect(await page.locator("div.wrap > div.wrap > button.primary").count()).toBe(1);
  });
});
```

## tests/search/bfs.test.ts

- 行数：382；字节数：14373；SHA-256：`9a8390db823de9ce6a6e819af62b6ba61f8a8c98cb695bcce75077aa038314e0`

```ts
// T007 unit tests — pure BFS, no browser.
//
// The evaluator here is a fake driven by an explicit verdict map keyed
// by sequence ("M01+M04"), plus an explicit state-key function, so every
// BFS property (shortest-first, tie-break, dedup, bounds, INCOMPLETE)
// is tested without Playwright. Browser behaviour is covered by
// bfs-browser.test.ts; determinism across repeated runs by
// bfs-determinism.test.ts.
//
// Spec: PROJECT_BOOK §5.6 (bounded BFS) and §5.7 (fixed order /
// tie-break); IMPLEMENTATION_PLAN T007.

import { describe, it, expect } from "vitest";

import type { MutationId } from "../../src/mutations/types.js";
import type { Verdict } from "../../src/verdict/classify.js";
import {
  runBoundedBfs,
  BFS_MAX_DEPTH,
  BFS_MAX_EXPANDED_STATES,
  type BfsEvaluator,
} from "../../src/search/bfs.js";
import {
  planStateKey,
  compareSequences,
  sequenceKey,
} from "../../src/search/state-key.js";
import { hashCanonical } from "../../src/canonical/canonical-json.js";

const FIXTURE = "F-TEST";

/** Fake evaluator: verdicts from a map; state key = plan hash unless overridden. */
function mapEvaluator(
  verdicts: Record<string, Verdict | null>,
  stateKeyFor?: (sequence: readonly MutationId[]) => string,
): { evaluator: BfsEvaluator; calls: string[] } {
  const calls: string[] = [];
  const evaluator: BfsEvaluator = async (sequence) => {
    calls.push(sequenceKey(sequence));
    const key = sequenceKey(sequence);
    // NB: `key in verdicts`, not `??`: an explicit null verdict means
    // INCOMPLETE and must survive (?? would coerce it to STABLE).
    const verdict = key in verdicts ? verdicts[key] : "STABLE";
    return {
      verdict,
      analysisStatus: verdict === null ? "INCOMPLETE" : "COMPLETE",
      stateKey: stateKeyFor
        ? stateKeyFor(sequence)
        : planStateKey(FIXTURE, sequence),
    };
  };
  return { evaluator, calls };
}

describe("state keys", () => {
  it("planStateKey is deterministic and order-sensitive", () => {
    expect(planStateKey(FIXTURE, ["M01", "M03"])).toBe(
      planStateKey(FIXTURE, ["M01", "M03"]),
    );
    expect(planStateKey(FIXTURE, ["M01", "M03"])).not.toBe(
      planStateKey(FIXTURE, ["M03", "M01"]),
    );
    expect(planStateKey(FIXTURE, ["M01"])).not.toBe(
      planStateKey("F-OTHER", ["M01"]),
    );
    expect(planStateKey(FIXTURE, [])).not.toBe(
      planStateKey(FIXTURE, ["M01"]),
    );
  });

  it("planStateKey equals the canonical hash of the documented object", () => {
    expect(planStateKey(FIXTURE, ["M02", "M04"])).toBe(
      hashCanonical({
        schema: "locatorstress.bfs-plan-state-key/v1",
        seed: "P022-LOCATORSTRESS-S0-2026-11-10",
        fixtureId: FIXTURE,
        plan: ["M02", "M04"],
      }),
    );
  });

  it("compareSequences orders lexicographically by mutation id", () => {
    expect(compareSequences(["M01", "M02"], ["M01", "M03"])).toBeLessThan(0);
    expect(compareSequences(["M02"], ["M01", "M08"])).toBeGreaterThan(0);
    expect(compareSequences(["M01"], ["M01"])).toBe(0);
    expect(compareSequences(["M01"], ["M01", "M02"])).toBeLessThan(0);
  });
});

describe("runBoundedBfs — shortest witness", () => {
  it("returns the depth-1 witness when a single mutation fails", async () => {
    const { evaluator } = mapEvaluator({ M04: "WRONG_TARGET" });
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 1,
    });
    expect(result.status).toBe("FOUND");
    expect(result.witness).toEqual({
      sequence: ["M04"],
      depth: 1,
      verdict: "WRONG_TARGET",
    });
    // Root + M01..M04 evaluated; M05..M08 never reached.
    expect(result.statesEvaluated).toBe(5);
    expect(result.statesExpanded).toBe(1);
    expect(result.maxDepthReached).toBe(1);
  });

  it("returns the shortest witness, not the first failing sequence in operator order", async () => {
    // Depth-1 all STABLE; the only depth-2 failure is M03+M07.
    // A depth-3 failure also exists but must not win over depth 2.
    const { evaluator } = mapEvaluator({
      "M03+M07": "AMBIGUOUS",
      "M01+M02+M03": "MISSING",
    });
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 3,
    });
    expect(result.status).toBe("FOUND");
    expect(result.witness?.sequence).toEqual(["M03", "M07"]);
    expect(result.witness?.depth).toBe(2);
  });

  it("finds witnesses at depths 3, 4 and 5", async () => {
    for (const depth of [3, 4, 5]) {
      const ops: MutationId[] = ["M01", "M02", "M03", "M04", "M05", "M06"];
      const seq = ops.slice(0, depth);
      const { evaluator } = mapEvaluator({ [sequenceKey(seq)]: "MISSING" });
      const result = await runBoundedBfs(evaluator, {
        fixtureId: FIXTURE,
        maxDepth: 6,
      });
      expect(result.status).toBe("FOUND");
      expect(result.witness?.sequence).toEqual(seq);
      expect(result.witness?.depth).toBe(depth);
    }
  });

  it("finds a depth-6 witness when the operator set is small enough for the budget", async () => {
    // With 6 operators the depth-5 frontier is 720 nodes, so reaching
    // depth 6 costs ~1,237 expansions — inside the 4096 budget.
    const ops: MutationId[] = ["M01", "M02", "M03", "M04", "M05", "M06"];
    const { evaluator } = mapEvaluator({ "M01+M02+M03+M04+M05+M06": "MISSING" });
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 6,
      operatorOrder: ops,
    });
    expect(result.status).toBe("FOUND");
    expect(result.witness?.sequence).toEqual(ops);
    expect(result.witness?.depth).toBe(6);
  });

  it("honestly reports BOUNDED_INCOMPLETE for a depth-6 witness in the full 8-operator space", async () => {
    // Reaching depth 6 in the full no-repeat space requires expanding
    // every node of depth 0..5 (1+8+56+336+1680+6720 = 8,801 states)
    // before the first depth-6 node is dequeued — more than the frozen
    // 4096 budget. The search must say so, not pretend depth 6 was
    // covered. (Dedup / INCOMPLETE pruning in a real DOM tree can
    // shrink the frontier; the pure tree cannot.)
    const { evaluator } = mapEvaluator({
      "M01+M02+M03+M04+M05+M06": "MISSING",
    });
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 6,
    });
    expect(result.status).toBe("BOUNDED_INCOMPLETE");
    expect(result.statesExpanded).toBe(4096);
    expect(result.queueRemaining).toBeGreaterThan(0);
    expect(result.witness).toBeNull();
  });

  it("reports a depth-0 witness when the baseline itself fails", async () => {
    const { evaluator } = mapEvaluator({ "": "MISSING" });
    const result = await runBoundedBfs(evaluator, { fixtureId: FIXTURE });
    expect(result.status).toBe("FOUND");
    expect(result.witness).toEqual({ sequence: [], depth: 0, verdict: "MISSING" });
    expect(result.statesEvaluated).toBe(1);
    expect(result.statesExpanded).toBe(0);
  });
});

describe("runBoundedBfs — tie-break", () => {
  it("among same-depth witnesses picks the lexicographically smallest sequence", async () => {
    const { evaluator } = mapEvaluator({
      "M02+M01": "WRONG_TARGET",
      "M01+M02": "WRONG_TARGET",
      "M01+M03": "AMBIGUOUS",
    });
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 2,
    });
    expect(result.witness?.sequence).toEqual(["M01", "M02"]);
  });

  it("among depth-1 witnesses picks the smallest failing operator", async () => {
    const { evaluator } = mapEvaluator({
      M02: "MISSING",
      M04: "WRONG_TARGET",
      M07: "AMBIGUOUS",
    });
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 1,
    });
    expect(result.witness?.sequence).toEqual(["M02"]);
    expect(result.witness?.verdict).toBe("MISSING");
  });
});

describe("runBoundedBfs — no witness and bounds", () => {
  it("reports BOUNDED_NO_WITNESS when the queue empties within the bounds", async () => {
    const { evaluator } = mapEvaluator({});
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 2,
    });
    expect(result.status).toBe("BOUNDED_NO_WITNESS");
    expect(result.witness).toBeNull();
    expect(result.queueRemaining).toBe(0);
    // Root + 8 depth-1 + 56 depth-2 = 65 evaluations; 1 + 8 expansions.
    expect(result.statesEvaluated).toBe(65);
    expect(result.statesExpanded).toBe(9);
    expect(result.uniqueStates).toBe(65);
    expect(result.statesDeduplicated).toBe(0);
  });

  it("reports BOUNDED_NO_WITNESS when the failure is deeper than maxDepth", async () => {
    const { evaluator } = mapEvaluator({ "M01+M02+M03": "MISSING" });
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 2,
    });
    expect(result.status).toBe("BOUNDED_NO_WITNESS");
    expect(result.maxDepthReached).toBe(2);
  });

  it("reports BOUNDED_INCOMPLETE, never NO_WITNESS, when the state budget runs out", async () => {
    const { evaluator } = mapEvaluator({});
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 6,
      maxExpandedStates: 3,
    });
    expect(result.status).toBe("BOUNDED_INCOMPLETE");
    expect(result.witness).toBeNull();
    expect(result.statesExpanded).toBe(3);
    expect(result.queueRemaining).toBeGreaterThan(0);
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it("still finds a witness even when the budget would have run out later", async () => {
    const { evaluator } = mapEvaluator({ M01: "MISSING" });
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 6,
      maxExpandedStates: 1,
    });
    expect(result.status).toBe("FOUND");
    expect(result.witness?.sequence).toEqual(["M01"]);
  });
});

describe("runBoundedBfs — dedup and no-repeat", () => {
  it("prunes a duplicate state and never expands it", async () => {
    // [M02] and [M03] converge on the same DOM state key ("shared-dom-key").
    // The first visit ([M02]) is kept and expanded; the second ([M03])
    // is pruned as a duplicate and its children are never evaluated.
    // The witness [M02, M04] is reachable through the kept path.
    const { evaluator, calls } = mapEvaluator(
      { "M02+M04": "WRONG_TARGET" },
      (sequence) => {
        if (sequenceKey(sequence) === "M03") return "shared-dom-key";
        if (sequenceKey(sequence) === "M02") return "shared-dom-key";
        return planStateKey(FIXTURE, sequence);
      },
    );
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 2,
    });
    expect(result.status).toBe("FOUND");
    expect(result.witness?.sequence).toEqual(["M02", "M04"]);
    expect(result.statesDeduplicated).toBe(1);
    // No child of the duplicate [M03] was ever evaluated.
    expect(calls.filter((c) => c.startsWith("M03+"))).toEqual([]);
    // But children of the kept [M02] were evaluated.
    expect(calls).toContain("M02+M04");
  });

  it("never repeats an operator within one sequence", async () => {
    const { evaluator, calls } = mapEvaluator({});
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 6,
      maxExpandedStates: 4096,
    });
    expect(result.status).toBe("BOUNDED_INCOMPLETE");
    for (const call of calls) {
      const ops = call === "" ? [] : call.split("+");
      expect(new Set(ops).size).toBe(ops.length);
    }
    // Full no-repeat space to depth 6 is 28,961 sequences; the 4096
    // expansion budget stops the search first.
    expect(result.statesExpanded).toBe(4096);
  });

  it("allowRepeat explores repeated operators (test hook only)", async () => {
    const { evaluator, calls } = mapEvaluator({ "M01+M01": "MISSING" });
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 2,
      allowRepeat: true,
    });
    expect(result.status).toBe("FOUND");
    expect(result.witness?.sequence).toEqual(["M01", "M01"]);
    expect(calls).toContain("M01+M01");
  });
});

describe("runBoundedBfs — INCOMPLETE is never a witness", () => {
  it("skips an incomplete node, does not expand it, and keeps searching", async () => {
    const { evaluator, calls } = mapEvaluator({
      M01: null,
      M02: "AMBIGUOUS",
    });
    const result = await runBoundedBfs(evaluator, {
      fixtureId: FIXTURE,
      maxDepth: 2,
    });
    expect(result.status).toBe("FOUND");
    expect(result.witness?.sequence).toEqual(["M02"]);
    expect(result.incompleteStates).toBe(1);
    expect(calls.filter((c) => c.startsWith("M01+"))).toEqual([]);
  });

  it("an incomplete root is BOUNDED_INCOMPLETE, never BOUNDED_NO_WITNESS", async () => {
    const { evaluator } = mapEvaluator({ "": null });
    const result = await runBoundedBfs(evaluator, { fixtureId: FIXTURE });
    expect(result.status).toBe("BOUNDED_INCOMPLETE");
    expect(result.witness).toBeNull();
    expect(result.incompleteStates).toBe(1);
    expect(result.statesEvaluated).toBe(1);
  });
});

describe("runBoundedBfs — option validation and defaults", () => {
  it("defaults to the frozen limits (depth 6, 4096 states)", async () => {
    const { evaluator } = mapEvaluator({});
    const result = await runBoundedBfs(evaluator, { fixtureId: FIXTURE });
    expect(result.limits).toEqual({ maxDepth: 6, maxExpandedStates: 4096 });
    expect(BFS_MAX_DEPTH).toBe(6);
    expect(BFS_MAX_EXPANDED_STATES).toBe(4096);
  });

  it("rejects maxDepth above the frozen cap", async () => {
    const { evaluator } = mapEvaluator({});
    await expect(
      runBoundedBfs(evaluator, { fixtureId: FIXTURE, maxDepth: 7 }),
    ).rejects.toThrow(RangeError);
  });

  it("rejects maxExpandedStates above the frozen cap and below 1", async () => {
    const { evaluator } = mapEvaluator({});
    await expect(
      runBoundedBfs(evaluator, { fixtureId: FIXTURE, maxExpandedStates: 4097 }),
    ).rejects.toThrow(RangeError);
    await expect(
      runBoundedBfs(evaluator, { fixtureId: FIXTURE, maxExpandedStates: 0 }),
    ).rejects.toThrow(RangeError);
  });

  it("rejects an empty operator order", async () => {
    const { evaluator } = mapEvaluator({});
    await expect(
      runBoundedBfs(evaluator, { fixtureId: FIXTURE, operatorOrder: [] }),
    ).rejects.toThrow(/must not be empty/);
  });
});
```

## tests/search/bfs-determinism.test.ts

- 行数：149；字节数：5729；SHA-256：`62ff6417199b4171d6d6f8861f80221a46976e0c2030a6698c13e227aee4836d`

```ts
// T007 determinism tests — the BFS must return byte-identical results
// across repeated runs with the same evaluator and options.
//
// The evaluator here is a deterministic pseudo-random function of the
// sequence (fixed-seed LCG over the plan hash), so the test exercises a
// non-trivial search tree — witnesses at several depths, duplicates via
// a colliding state key — rather than a hand-picked map. Three fresh
// runs must produce deeply equal result objects, and the canonical JSON
// of each result must hash identically.
//
// Spec: PROJECT_BOOK §5.6 / §5.7 (fixed order, tie-break, no
// randomness); IMPLEMENTATION_PLAN T007 (test:bfs:determinism).

import { describe, it, expect } from "vitest";

import type { MutationId } from "../../src/mutations/types.js";
import type { Verdict } from "../../src/verdict/classify.js";
import {
  runBoundedBfs,
  type BfsEvaluator,
  type BfsResult,
} from "../../src/search/bfs.js";
import {
  planStateKey,
  sequenceKey,
} from "../../src/search/state-key.js";
import { canonicalJson, hashCanonical } from "../../src/canonical/canonical-json.js";

const FIXTURE = "F-DET";

/** Deterministic 32-bit hash of a string (FNV-1a). No Math.random. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Deterministic evaluator: verdict from the FNV-1a hash of the plan key.
 *   - hash % 23 === 0 and depth >= 1 -> WRONG_TARGET (sparse failures)
 *   - hash % 31 === 0 -> INCOMPLETE (null verdict, never a witness)
 *   - otherwise STABLE
 * State key: the plan hash, except sequences ending in M08 collapse
 * onto the key of the same sequence without M08 (a deterministic
 * duplicate), exercising dedup on every run.
 */
function deterministicEvaluator(): BfsEvaluator {
  return async (sequence) => {
    const key = sequenceKey(sequence);
    const h = fnv1a(key);
    let verdict: Verdict | null = "STABLE";
    if (sequence.length >= 1 && h % 23 === 0) verdict = "WRONG_TARGET";
    else if (h % 31 === 0) verdict = null;
    const stateKey =
      sequence.length > 0 && sequence[sequence.length - 1] === "M08"
        ? planStateKey(FIXTURE, sequence.slice(0, -1))
        : planStateKey(FIXTURE, sequence);
    return {
      verdict,
      analysisStatus: verdict === null ? "INCOMPLETE" : "COMPLETE",
      stateKey,
    };
  };
}

async function runOnce(options: {
  maxDepth: number;
  maxExpandedStates?: number;
}): Promise<BfsResult> {
  return runBoundedBfs(deterministicEvaluator(), {
    fixtureId: FIXTURE,
    ...options,
  });
}

describe("BFS determinism", () => {
  it("three runs of a depth-3 search return deeply equal results", async () => {
    const runs = await Promise.all([
      runOnce({ maxDepth: 3 }),
      runOnce({ maxDepth: 3 }),
      runOnce({ maxDepth: 3 }),
    ]);
    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);
    expect(canonicalJson(runs[0])).toBe(canonicalJson(runs[1]));
    expect(hashCanonical(runs[0])).toBe(hashCanonical(runs[1]));
  });

  it("three runs of a budget-limited depth-6 search return deeply equal results", async () => {
    // All-STABLE evaluator: the budget is the only thing that can stop
    // the search, so the outcome is BOUNDED_INCOMPLETE on every run.
    const stable: BfsEvaluator = async (sequence) => ({
      verdict: "STABLE",
      analysisStatus: "COMPLETE",
      stateKey: planStateKey(FIXTURE, sequence),
    });
    const runs = await Promise.all([
      runBoundedBfs(stable, { fixtureId: FIXTURE, maxDepth: 6, maxExpandedStates: 64 }),
      runBoundedBfs(stable, { fixtureId: FIXTURE, maxDepth: 6, maxExpandedStates: 64 }),
      runBoundedBfs(stable, { fixtureId: FIXTURE, maxDepth: 6, maxExpandedStates: 64 }),
    ]);
    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);
    expect(runs[0].status).toBe("BOUNDED_INCOMPLETE");
    expect(runs[0].statesExpanded).toBe(64);
    expect(runs[0].queueRemaining).toBeGreaterThan(0);
  });

  it("the deterministic evaluator exercises a witness and dedup with fixed counts", async () => {
    // Exact outcome of the fixed-seed evaluator at depth 3, measured
    // 2026-11-10 (FNV-1a over the plan key; M08-collapsing state keys).
    // Locked here so any future change to BFS order, dedup or the
    // failure predicate shows up as a test failure, not silent drift.
    // (INCOMPLETE handling itself is covered in bfs.test.ts; this
    // evaluator happens to produce 0 incomplete states before the
    // depth-2 witness stops the search.)
    const result = await runOnce({ maxDepth: 3 });
    expect(result.status).toBe("FOUND");
    expect(result.witness).toEqual({
      sequence: ["M02", "M05"],
      depth: 2,
      verdict: "WRONG_TARGET",
    });
    expect(result.statesEvaluated).toBe(20);
    expect(result.statesExpanded).toBe(17);
    expect(result.statesDeduplicated).toBe(2);
    expect(result.uniqueStates).toBe(18);
    expect(result.incompleteStates).toBe(0);
    expect(result.maxDepthReached).toBe(2);
  });

  it("evaluation order within a depth is lexicographic on every run", async () => {
    const result = await runOnce({ maxDepth: 2 });
    const byDepth = new Map<number, MutationId[][]>();
    for (const ev of result.evaluations) {
      const list = byDepth.get(ev.depth) ?? [];
      list.push(ev.sequence);
      byDepth.set(ev.depth, list);
    }
    for (const [depth, sequences] of byDepth) {
      const keys = sequences.map((s) => sequenceKey(s));
      const sorted = [...keys].sort();
      expect(keys, `depth ${depth} not in lexicographic order`).toEqual(sorted);
    }
  });
});
```

## tests/search/bfs-browser.test.ts

- 行数：236；字节数：8901；SHA-256：`1426aa3453c2ef964a98d66f278b2718ea71cc1334f182d94451d0188b8906b2`

```ts
// T007 browser tests — BFS over real Playwright fixtures.
//
// Cross-checks the BFS against the frozen golden matrix at depth 1
// (where the expected verdict of every single mutation is known):
//   - F002: smallest failing single mutation is M01 (WRONG_TARGET).
//   - F003: only failing single mutation is M04 (AMBIGUOUS).
//   - F001: all eight single mutations are STABLE -> BOUNDED_NO_WITNESS.
// A depth-2 run on F001 additionally checks witness parity: if a
// witness is found, replaying its sequence from a fresh page must
// reproduce the same verdict through the production classifier.
//
// Writes evidence/s2/T007_BFS_BROWSER_SPOTCHECK.json (same precedent
// as the S0 mutation test writing T002_MUTATION_REPORT.json).
//
// Spec: PROJECT_BOOK §5.6 / §5.7; IMPLEMENTATION_PLAN T007.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { BaselineBrowser } from "../../src/runner/browser.js";
import { resolveLocator } from "../../src/runner/locator-resolver.js";
import { isSameElement } from "../../src/oracle/identity-compare.js";
import { classifyVerdict, type Verdict } from "../../src/verdict/classify.js";
import {
  SEED,
  FIXTURE_IDS,
  loadAllFixtureManifests,
  type FixtureManifest,
} from "../../src/fixtures/fixture-manifest.js";
import {
  loadFixture,
  setFixtureContent,
  captureOriginalTargetForFixture,
  mutationContextForFixture,
} from "../../src/fixtures/fixture-loader.js";
import { getMutation } from "../../src/mutations/registry.js";
import type { MutationId } from "../../src/mutations/types.js";
import { runBoundedBfs, type BfsResult } from "../../src/search/bfs.js";
import { createBrowserEvaluator } from "../../src/search/browser-evaluator.js";
import { launchTestBrowser, repoRoot } from "../integration/s0-helpers.js";

function goldenMap(): Map<string, string> {
  const parsed = JSON.parse(
    readFileSync(
      join(repoRoot(), "src/fixtures/golden/expected-verdicts.json"),
      "utf8",
    ),
  ) as {
    schema: string;
    seed: string;
    cases: Array<{ fixtureId: string; mutationId: string; expectedVerdict: string }>;
  };
  expect(parsed.cases.length).toBe(192);
  expect(parsed.seed).toBe(SEED);
  const map = new Map<string, string>();
  for (const c of parsed.cases) {
    map.set(`${c.fixtureId}/${c.mutationId}`, c.expectedVerdict);
  }
  return map;
}

/** Independently replay a sequence from a fresh page; return the verdict. */
async function replayVerdict(
  page: BaselineBrowser["page"],
  manifest: FixtureManifest,
  sequence: readonly MutationId[],
): Promise<Verdict | null> {
  const fixture = loadFixture(manifest.fixtureId);
  const ctx = mutationContextForFixture(manifest);
  await setFixtureContent(page, fixture);
  const original = await captureOriginalTargetForFixture(page, manifest);
  for (const mutationId of sequence) {
    await getMutation(mutationId).apply(page, original, ctx);
  }
  const { result, finalHandle } = await resolveLocator(page, manifest.locator);
  let identityMatch: boolean | null = null;
  if (
    result.executionStatus === "COMPLETED" &&
    result.finalMatchCount === 1 &&
    finalHandle !== null
  ) {
    identityMatch = await isSameElement(page, finalHandle, original);
  }
  return classifyVerdict(result, identityMatch).verdict;
}

function summarize(result: BfsResult): Record<string, unknown> {
  return {
    status: result.status,
    witness: result.witness,
    limits: result.limits,
    statesEvaluated: result.statesEvaluated,
    statesExpanded: result.statesExpanded,
    statesDeduplicated: result.statesDeduplicated,
    uniqueStates: result.uniqueStates,
    incompleteStates: result.incompleteStates,
    maxDepthReached: result.maxDepthReached,
    queueRemaining: result.queueRemaining,
    notes: result.notes,
  };
}

describe("T007 BFS on real fixtures", () => {
  let browserHandle: BaselineBrowser;
  let golden: Map<string, string>;
  let manifests: Map<string, FixtureManifest>;

  beforeAll(async () => {
    browserHandle = await launchTestBrowser();
    golden = goldenMap();
    manifests = new Map(
      loadAllFixtureManifests().map((m) => [m.fixtureId, m]),
    );
    expect([...manifests.keys()].sort()).toEqual([...FIXTURE_IDS].sort());
  });

  afterAll(async () => {
    await browserHandle.close();
  });

  it(
    "depth-1 witnesses match the golden matrix (F002, F003) and F001 has none",
    async () => {
      const page = browserHandle.page;
      const spotcheck: Record<string, unknown> = {
        schema: "locatorstress.t007-bfs-browser-spotcheck/v1",
        seed: SEED,
        goldenCases: 192,
        runs: [] as Array<Record<string, unknown>>,
      };
      const runs = spotcheck.runs as Array<Record<string, unknown>>;

      for (const fixtureId of ["F002", "F003", "F001"]) {
        const manifest = manifests.get(fixtureId);
        if (!manifest) throw new Error(`missing manifest for ${fixtureId}`);
        const evaluator = createBrowserEvaluator(page, manifest);
        const result = await runBoundedBfs(evaluator, {
          fixtureId,
          maxDepth: 1,
        });
        const entry: Record<string, unknown> = {
          fixtureId,
          maxDepth: 1,
          ...summarize(result),
        };

        if (fixtureId === "F002") {
          expect(result.status).toBe("FOUND");
          expect(result.witness?.sequence).toEqual(["M01"]);
          expect(result.witness?.verdict).toBe(
            golden.get("F002/M01") as Verdict,
          );
          expect(result.witness?.verdict).toBe("WRONG_TARGET");
          // Witness parity: independent replay reproduces the verdict.
          const replayed = await replayVerdict(page, manifest, ["M01"]);
          expect(replayed).toBe(result.witness?.verdict);
          entry.replayVerdict = replayed;
          entry.replayMatchesWitness = replayed === result.witness?.verdict;
        }
        if (fixtureId === "F003") {
          expect(result.status).toBe("FOUND");
          expect(result.witness?.sequence).toEqual(["M04"]);
          expect(result.witness?.verdict).toBe(
            golden.get("F003/M04") as Verdict,
          );
          expect(result.witness?.verdict).toBe("AMBIGUOUS");
          const replayed = await replayVerdict(page, manifest, ["M04"]);
          expect(replayed).toBe(result.witness?.verdict);
          entry.replayVerdict = replayed;
          entry.replayMatchesWitness = replayed === result.witness?.verdict;
        }
        if (fixtureId === "F001") {
          expect(result.status).toBe("BOUNDED_NO_WITNESS");
          expect(result.witness).toBeNull();
          // Root + 8 single mutations, all STABLE per golden.
          expect(result.statesEvaluated).toBe(9);
          expect(result.incompleteStates).toBe(0);
          for (const mid of ["M01","M02","M03","M04","M05","M06","M07","M08"]) {
            expect(golden.get(`F001/${mid}`)).toBe("STABLE");
          }
        }
        runs.push(entry);
      }

      // Depth-2 run on F001: outcome is not golden-known, so assert
      // structure + witness parity instead of a specific verdict.
      const f001 = manifests.get("F001");
      if (!f001) throw new Error("missing manifest for F001");
      const evaluator2 = createBrowserEvaluator(page, f001);
      const depth2 = await runBoundedBfs(evaluator2, {
        fixtureId: "F001",
        maxDepth: 2,
      });
      const entry2: Record<string, unknown> = {
        fixtureId: "F001",
        maxDepth: 2,
        ...summarize(depth2),
      };
      expect(["FOUND", "BOUNDED_NO_WITNESS", "BOUNDED_INCOMPLETE"]).toContain(
        depth2.status,
      );
      if (depth2.status === "FOUND" && depth2.witness) {
        expect(depth2.witness.depth).toBeLessThanOrEqual(2);
        expect(depth2.witness.verdict).not.toBe("STABLE");
        const replayed = await replayVerdict(
          page,
          f001,
          depth2.witness.sequence,
        );
        expect(replayed).toBe(depth2.witness.verdict);
        entry2.replayVerdict = replayed;
        entry2.replayMatchesWitness =
          replayed === depth2.witness.verdict;
      }
      if (depth2.status === "BOUNDED_NO_WITNESS") {
        // Full depth-2 no-repeat space: 1 + 8 + 56 evaluations.
        expect(depth2.statesEvaluated).toBe(65);
        expect(depth2.queueRemaining).toBe(0);
      }
      runs.push(entry2);

      entry2.externalRequests = browserHandle.externalRequestCount();
      expect(browserHandle.externalRequestCount()).toBe(0);

      const evidenceDir = join(repoRoot(), "evidence", "s2");
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(
        join(evidenceDir, "T007_BFS_BROWSER_SPOTCHECK.json"),
        JSON.stringify(spotcheck, null, 2) + "\n",
        "utf8",
      );
    },
    300000,
  );
});
```

## tests/search/state-key-boundaries.test.ts

- 行数：135；字节数：4800；SHA-256：`1c2d153acc7da8dc6ed1808fc448d0380d6aab44d360c96a0365c97fbc66f76e`

```ts
// T011 — BFS state-key boundaries (PROJECT_BOOK §5.6/§5.7).
//
// The T007 tests pin planStateKey determinism/order-sensitivity and
// compareSequences. These rows pin the rest: domStateKey convergence
// (same DOM, different plan -> same key), sequenceKey, isFailureVerdict
// for every input including null, compareSequences prefix/empty cases,
// and the schema strings that keep the two key kinds distinct.

import { describe, it, expect } from "vitest";

import {
  SCHEMA_BFS_DOM_STATE_KEY,
  SCHEMA_BFS_PLAN_STATE_KEY,
  compareSequences,
  domStateKey,
  isFailureVerdict,
  planStateKey,
  sequenceKey,
} from "../../src/search/state-key.js";

describe("sequenceKey", () => {
  it("root is the empty string", () => {
    expect(sequenceKey([])).toBe("");
  });

  it("joins with +", () => {
    expect(sequenceKey(["M01"])).toBe("M01");
    expect(sequenceKey(["M01", "M04", "M08"])).toBe("M01+M04+M08");
  });

  it("is order-sensitive as a string", () => {
    expect(sequenceKey(["M01", "M03"])).not.toBe(sequenceKey(["M03", "M01"]));
  });
});

describe("planStateKey — order and fixture sensitivity", () => {
  it("same plan twice gives the same key", () => {
    expect(planStateKey("F001", ["M01", "M02"])).toBe(planStateKey("F001", ["M01", "M02"]));
  });

  it("different order gives a different key (plan hash is order-sensitive)", () => {
    expect(planStateKey("F001", ["M01", "M03"])).not.toBe(planStateKey("F001", ["M03", "M01"]));
  });

  it("different fixture gives a different key for the same plan", () => {
    expect(planStateKey("F001", ["M01"])).not.toBe(planStateKey("F002", ["M01"]));
  });

  it("root plan key differs from any non-empty plan key", () => {
    expect(planStateKey("F001", [])).not.toBe(planStateKey("F001", ["M01"]));
  });

  it("keys are 64 lowercase hex chars", () => {
    expect(planStateKey("F001", ["M01"])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("plan and DOM key schemas are distinct strings", () => {
    expect(SCHEMA_BFS_PLAN_STATE_KEY).not.toBe(SCHEMA_BFS_DOM_STATE_KEY);
    expect(SCHEMA_BFS_PLAN_STATE_KEY).toContain("bfs-plan-state-key");
    expect(SCHEMA_BFS_DOM_STATE_KEY).toContain("bfs-dom-state-key");
  });
});

describe("domStateKey — convergence on identical DOM", () => {
  const html = "<main><button class=\"primary\">Save</button></main>";

  it("same DOM twice gives the same key", () => {
    expect(domStateKey("F001", html)).toBe(domStateKey("F001", html));
  });

  it("different DOM gives a different key", () => {
    expect(domStateKey("F001", html)).not.toBe(
      domStateKey("F001", "<main><button>Other</button></main>"),
    );
  });

  it("same DOM in a different fixture gives a different key", () => {
    expect(domStateKey("F001", html)).not.toBe(domStateKey("F002", html));
  });

  it("whitespace differences are significant (no normalisation of the DOM string)", () => {
    expect(domStateKey("F001", "<a> x </a>")).not.toBe(domStateKey("F001", "<a>x</a>"));
  });

  it("a plan key never equals a DOM key for the same fixture", () => {
    expect(planStateKey("F001", ["M01"])).not.toBe(domStateKey("F001", html));
  });
});

describe("compareSequences — tie-break ordering", () => {
  it("empty sequences compare equal", () => {
    expect(compareSequences([], [])).toBe(0);
  });

  it("a prefix is smaller than the longer sequence", () => {
    expect(compareSequences(["M01"], ["M01", "M02"])).toBeLessThan(0);
    expect(compareSequences(["M01", "M02"], ["M01"])).toBeGreaterThan(0);
  });

  it("orders by first differing operator", () => {
    expect(compareSequences(["M02"], ["M03"])).toBeLessThan(0);
    expect(compareSequences(["M08"], ["M01"])).toBeGreaterThan(0);
  });

  it("orders by the second element when the first is equal", () => {
    expect(compareSequences(["M01", "M02"], ["M01", "M03"])).toBeLessThan(0);
  });

  it("is consistent with Array.sort for a shuffled operator list", () => {
    const seqs: Array<Array<"M01" | "M02" | "M03" | "M04" | "M05" | "M06" | "M07" | "M08">> = [
      ["M02"],
      ["M01", "M03"],
      [],
      ["M01"],
      ["M01", "M02"],
    ];
    expect([...seqs].sort(compareSequences)).toEqual([[], ["M01"], ["M01", "M02"], ["M01", "M03"], ["M02"]]);
  });
});

describe("isFailureVerdict — the BFS failure predicate", () => {
  it("STABLE is not a failure", () => {
    expect(isFailureVerdict("STABLE")).toBe(false);
  });

  it("WRONG_TARGET, AMBIGUOUS and MISSING are failures", () => {
    expect(isFailureVerdict("WRONG_TARGET")).toBe(true);
    expect(isFailureVerdict("AMBIGUOUS")).toBe(true);
    expect(isFailureVerdict("MISSING")).toBe(true);
  });

  it("null (no verdict claimed) is NOT a failure — an INCOMPLETE node is never a witness", () => {
    expect(isFailureVerdict(null)).toBe(false);
  });
});
```

## tests/analysis/witness.test.ts

- 行数：250；字节数：9955；SHA-256：`7363d953e86b82bab7fa97a11236fc1bad47a7d1c727e437b6647689b12adbcc`

```ts
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
```

## tests/analysis/witness-boundaries.test.ts

- 行数：163；字节数：5825；SHA-256：`36996d0f4b3ea7952e5c8dea2e3939d1d9172f047ba76c7eeb059a3970f8e026`

```ts
// T011 — witness meaning / budget-note boundaries (T008, PROJECT_BOOK §5.6).
//
// The T008 witness tests cover the three statuses and the depth-6 note
// at frozen bounds. These rows pin the exact wording contracts a
// mutation could soften: FOUND must name sequence + verdict + depth,
// BOUNDED_NO_WITNESS must disclaim safety, BOUNDED_INCOMPLETE must
// never read as "no witness", and the budget note must appear only at
// exactly 6/4096.

import { describe, it, expect } from "vitest";

import {
  DEPTH6_UNPRUNED_EXPANSIONS,
  depth6BudgetNote,
  summarizeWitness,
  witnessMeaning,
} from "../../src/analysis/witness.js";
import { fakeBfsResult } from "../t008-helpers.js";

describe("witnessMeaning — exact wording contracts", () => {
  it("FOUND names the sequence, the verdict and the depth", () => {
    const text = witnessMeaning(
      "FOUND",
      { sequence: ["M01", "M04"], depth: 2, verdict: "AMBIGUOUS" },
      { maxDepth: 6, maxExpandedStates: 4096 },
      0,
    );
    expect(text).toContain("M01+M04");
    expect(text).toContain("AMBIGUOUS");
    expect(text).toContain("depth 2");
  });

  it("FOUND at depth 0 names the baseline failure", () => {
    const text = witnessMeaning(
      "FOUND",
      { sequence: [], depth: 0, verdict: "MISSING" },
      { maxDepth: 6, maxExpandedStates: 4096 },
      0,
    );
    expect(text).toContain("MISSING");
    expect(text).toContain("depth 0");
  });

  it("BOUNDED_NO_WITNESS names the limits and disclaims safety", () => {
    const text = witnessMeaning(
      "BOUNDED_NO_WITNESS",
      null,
      { maxDepth: 3, maxExpandedStates: 100 },
      0,
    );
    expect(text).toContain("depth <= 3");
    expect(text).toContain("<= 100 expansions");
    expect(text).toContain("does NOT prove the locator is safe");
  });

  it("BOUNDED_INCOMPLETE names the queue remainder and negates every soft reading", () => {
    const text = witnessMeaning("BOUNDED_INCOMPLETE", null, { maxDepth: 6, maxExpandedStates: 4096 }, 42);
    expect(text).toContain("42 sequence(s) still queued");
    expect(text).toContain("INCOMPLETE");
    expect(text).toContain('NOT "no witness"');
    expect(text).toContain('NOT "no failure"');
    expect(text).toContain('NOT "safe"');
  });

  it("DEPTH6_UNPRUNED_EXPANSIONS is the documented 8801 (1+8+56+336+1680+6720)", () => {
    expect(DEPTH6_UNPRUNED_EXPANSIONS).toBe(8801);
    expect(1 + 8 + 56 + 336 + 1680 + 6720).toBe(8801);
  });
});

describe("depth6BudgetNote — appears only at exactly the frozen bounds", () => {
  function incompleteAt(limits: { maxDepth: number; maxExpandedStates: number }) {
    return fakeBfsResult({ status: "BOUNDED_INCOMPLETE", limits, queueRemaining: 3 });
  }

  it("appears at 6/4096 and quotes the 8801-expansion arithmetic", () => {
    const note = depth6BudgetNote(incompleteAt({ maxDepth: 6, maxExpandedStates: 4096 }));
    expect(note).toContain("8801");
    expect(note).toContain("1+8+56+336+1680+6720");
    expect(note).toContain("4096");
  });

  it("does not appear at reduced depth (5/4096)", () => {
    expect(depth6BudgetNote(incompleteAt({ maxDepth: 5, maxExpandedStates: 4096 }))).toBeUndefined();
  });

  it("does not appear at reduced budget (6/100)", () => {
    expect(depth6BudgetNote(incompleteAt({ maxDepth: 6, maxExpandedStates: 100 }))).toBeUndefined();
  });

  it("does not appear for BOUNDED_NO_WITNESS even at frozen bounds", () => {
    const r = fakeBfsResult({ status: "BOUNDED_NO_WITNESS" });
    expect(depth6BudgetNote(r)).toBeUndefined();
  });

  it("does not appear for FOUND even at frozen bounds", () => {
    const r = fakeBfsResult({
      status: "FOUND",
      witness: { sequence: ["M01"], depth: 1, verdict: "MISSING" },
    });
    expect(depth6BudgetNote(r)).toBeUndefined();
  });
});

describe("summarizeWitness — copies counts verbatim, never softens status", () => {
  it("copies limits and counts verbatim into the summary", () => {
    const s = summarizeWitness(
      fakeBfsResult({
        status: "BOUNDED_NO_WITNESS",
        limits: { maxDepth: 2, maxExpandedStates: 50 },
        statesEvaluated: 11,
        statesExpanded: 3,
        statesDeduplicated: 2,
        uniqueStates: 9,
        incompleteStates: 1,
        maxDepthReached: 2,
        queueRemaining: 0,
        perDepthEvaluated: { 0: 1, 1: 8, 2: 2 },
      }),
    );
    expect(s.limits).toEqual({ maxDepth: 2, maxExpandedStates: 50 });
    expect(s.statesEvaluated).toBe(11);
    expect(s.statesExpanded).toBe(3);
    expect(s.statesDeduplicated).toBe(2);
    expect(s.uniqueStates).toBe(9);
    expect(s.incompleteStates).toBe(1);
    expect(s.maxDepthReached).toBe(2);
    expect(s.perDepthEvaluated).toEqual({ 0: 1, 1: 8, 2: 2 });
  });

  it("a FOUND summary with a depth-6 witness at frozen bounds carries no budget note", () => {
    // A witness was found, so the budget never ran out: no note.
    const s = summarizeWitness(
      fakeBfsResult({
        status: "FOUND",
        witness: { sequence: ["M01", "M02", "M03", "M04", "M05", "M06"], depth: 6, verdict: "MISSING" },
      }),
    );
    expect(s.budgetNote).toBeUndefined();
  });

  it("throws when a FOUND witness depth disagrees with its sequence length", () => {
    expect(() =>
      summarizeWitness(
        fakeBfsResult({
          status: "FOUND",
          witness: { sequence: ["M01"], depth: 2, verdict: "MISSING" },
        }),
      ),
    ).toThrow(/depth 2 != sequence length 1/);
  });

  it("summarizeWitness does not mutate its input result", () => {
    const input = fakeBfsResult({
      status: "FOUND",
      witness: { sequence: ["M01"], depth: 1, verdict: "WRONG_TARGET" },
      notes: ["n1"],
    });
    const before = JSON.stringify(input);
    summarizeWitness(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
```
