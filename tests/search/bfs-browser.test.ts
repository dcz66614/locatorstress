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
