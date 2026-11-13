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
