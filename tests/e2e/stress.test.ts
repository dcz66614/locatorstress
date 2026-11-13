// T012 stress — behaviour under resource pressure and repetition.
//
//   1. Repeat determinism: the same fixture's 8-mutation verdict vector
//      is identical across 5 consecutive runs on one page.
//   2. Concurrency: 3 browser contexts in one browser run 3 different
//      fixtures' full 8-mutation matrices in parallel; every verdict
//      still matches golden (no cross-talk through shared state).
//   3. Large DOM: a synthetic page with 5,000 sibling nodes resolves
//      the target locator (COMPLETED, 1 match, identity true).
//   4. Deep DOM: a target nested 200 levels deep resolves.
//   5. BFS bounds: over-cap maxDepth / maxExpandedStates are RangeError;
//      maxDepth 0 with a failing root reports a depth-0 witness;
//      a stub BFS at maxDepth 2 never exceeds depth 2.
//   6. UI server under parallel load: 3 concurrent /api/analyze calls
//      return 200 with golden-matching verdicts, and 3 repeated calls
//      for one fixture return byte-identical canonical JSON.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { BaselineBrowser } from "../../src/runner/browser.js";
import { resolveLocator } from "../../src/runner/locator-resolver.js";
import { isSameElement } from "../../src/oracle/identity-compare.js";
import { runBaselineOracle } from "../../src/oracle/oracle-runner.js";
import {
  SEED,
  FIXTURE_IDS,
  loadFixtureManifest,
} from "../../src/fixtures/fixture-manifest.js";
import {
  loadFixture,
  setFixtureContent,
  captureOriginalTargetForFixture,
  mutationContextForFixture,
} from "../../src/fixtures/fixture-loader.js";
import { MUTATION_ORDER, getMutation } from "../../src/mutations/registry.js";
import { runBoundedBfs } from "../../src/search/bfs.js";
import {
  launchTestBrowser,
  repoRoot,
  deriveVerdict,
} from "../integration/s0-helpers.js";
import { startUiServer, type UiServerHandle } from "./e2e-helpers.js";

let browserHandle: BaselineBrowser;
let golden: Map<string, string>;

async function verdictVector(
  page: BaselineBrowser["page"],
  fixtureId: string,
): Promise<string[]> {
  const manifest = loadFixtureManifest(fixtureId);
  const fixture = loadFixture(fixtureId);
  const out: string[] = [];
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
    const verdict = deriveVerdict(result, identityMatch);
    const expected = golden.get(`${fixtureId}/${mutationId}`);
    expect(verdict, `${fixtureId}/${mutationId}`).toBe(expected);
    out.push(verdict!);
  }
  return out;
}

describe("T012 stress (real Chromium)", () => {
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
    expect(FIXTURE_IDS).toHaveLength(24);
  }, 120_000);

  afterAll(async () => {
    await browserHandle.close();
  });

  it("repeat determinism: F002 verdict vector identical across 5 runs", async () => {
    const vectors: string[][] = [];
    for (let i = 0; i < 5; i += 1) {
      vectors.push(await verdictVector(browserHandle.page, "F002"));
    }
    for (const v of vectors.slice(1)) {
      expect(v).toEqual(vectors[0]);
    }
    expect(vectors[0]).toEqual([
      "WRONG_TARGET",
      "WRONG_TARGET",
      "STABLE",
      "WRONG_TARGET",
      "STABLE",
      "WRONG_TARGET",
      "WRONG_TARGET",
      "STABLE",
    ]);
  }, 180_000);

  it("concurrency: 3 contexts x 3 fixtures in parallel, all verdicts match golden", async () => {
    const fixtureIds = ["F001", "F010", "F024"];
    const runs = await Promise.all(
      fixtureIds.map(async (fixtureId) => {
        const context = await browserHandle.browser.newContext();
        const page = await context.newPage();
        try {
          // Each parallel page needs the same route interception the
          // shared page has; without it an external request would not
          // be counted, so install the identical loopback-only rule.
          await page.route("**/*", async (route) => {
            const url = route.request().url();
            if (
              url.startsWith("about:") ||
              url.startsWith("data:") ||
              url.startsWith("blob:") ||
              url.startsWith("http://127.0.0.1") ||
              url.startsWith("http://localhost")
            ) {
              await route.continue();
            } else {
              await route.abort();
            }
          });
          return await verdictVector(page, fixtureId);
        } finally {
          await context.close();
        }
      }),
    );
    expect(runs).toHaveLength(3);
    for (const v of runs) expect(v).toHaveLength(8);
  }, 180_000);

  it("large DOM: 5,000 siblings, target still resolves with identity true", async () => {
    const page = browserHandle.page;
    const siblings = "<div class=\"filler\">x</div>".repeat(5000);
    await page.setContent(
      `<main>${siblings}<button id="t" class="primary">Target</button></main>`,
    );
    const t0 = Date.now();
    const r = await runBaselineOracle(
      page,
      { kind: "css", selector: "button#t" },
      "main > button:nth-child(5001)",
    );
    const durationMs = Date.now() - t0;
    expect(r.resolverResult.executionStatus).toBe("COMPLETED");
    expect(r.resolverResult.finalMatchCount).toBe(1);
    expect(r.identityMatch).toBe(true);
    expect(r.originalCaptured).toBe(true);
    // Informational bound only (generous): the point is correctness
    // under load, not a tight latency claim on this shared VM.
    expect(durationMs).toBeLessThan(30_000);
  }, 60_000);

  it("deep DOM: target nested 200 levels deep resolves", async () => {
    const page = browserHandle.page;
    let html = `<button id="deep" class="primary">Deep</button>`;
    for (let i = 0; i < 200; i += 1) html = `<div>${html}</div>`;
    await page.setContent(`<main>${html}</main>`);
    const r = await runBaselineOracle(
      page,
      { kind: "css", selector: "button#deep" },
      "main > div:nth-child(1)",
    );
    // The private path above points at the outermost div, not the
    // button, so identity is expected false here; the assertion that
    // matters is that resolution COMPLETES with exactly 1 match on a
    // 200-deep tree (no stack / traversal failure).
    expect(r.resolverResult.executionStatus).toBe("COMPLETED");
    expect(r.resolverResult.finalMatchCount).toBe(1);
    expect(r.originalCaptured).toBe(true);
  }, 60_000);

  it("BFS bounds: over-cap options are RangeError; depth-0 witness; depth cap respected", async () => {
    const stub = async (): Promise<{
      verdict: "STABLE";
      analysisStatus: "COMPLETE";
      stateKey: string;
    }> => ({ verdict: "STABLE", analysisStatus: "COMPLETE", stateKey: "s" });
    await expect(
      runBoundedBfs(stub, { fixtureId: "F001", maxDepth: 7 }),
    ).rejects.toThrow(RangeError);
    await expect(
      runBoundedBfs(stub, { fixtureId: "F001", maxExpandedStates: 4097 }),
    ).rejects.toThrow(RangeError);
    await expect(
      runBoundedBfs(stub, { fixtureId: "F001", maxExpandedStates: 0 }),
    ).rejects.toThrow(RangeError);

    // Depth-0 witness: a failing root is reported at depth 0.
    const failing = await runBoundedBfs(
      async (sequence) => ({
        verdict: sequence.length === 0 ? ("WRONG_TARGET" as const) : ("STABLE" as const),
        analysisStatus: "COMPLETE" as const,
        stateKey: sequence.join("+") || "root",
      }),
      { fixtureId: "F001", maxDepth: 0 },
    );
    expect(failing.status).toBe("FOUND");
    expect(failing.witness).toEqual({ sequence: [], depth: 0, verdict: "WRONG_TARGET" });

    // Depth cap: an all-STABLE stub at maxDepth 2 exhausts within the
    // cap and never reaches depth 3.
    let seq = 0;
    const capped = await runBoundedBfs(
      async (sequence) => ({
        verdict: "STABLE" as const,
        analysisStatus: "COMPLETE" as const,
        stateKey: `k${seq++}`,
      }),
      { fixtureId: "F001", maxDepth: 2, maxExpandedStates: 4096 },
    );
    expect(capped.status).toBe("BOUNDED_NO_WITNESS");
    expect(capped.maxDepthReached).toBeLessThanOrEqual(2);
  }, 60_000);

  it("UI server under parallel load: 3 concurrent analyzes match golden; repeats byte-identical", async () => {
    const server: UiServerHandle = await startUiServer();
    try {
      const analyze = async (fixtureId: string): Promise<string> => {
        const res = await fetch(`${server.url}/api/analyze`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fixtureId }),
        });
        expect(res.status).toBe(200);
        return await res.text();
      };
      const [f001, f002, f003] = await Promise.all([
        analyze("F001"),
        analyze("F002"),
        analyze("F003"),
      ]);
      for (const [text, id] of [
        [f001, "F001"],
        [f002, "F002"],
        [f003, "F003"],
      ] as const) {
        const body = JSON.parse(text) as {
          fixtureId: string;
          cases: Array<{ verdict: string; matchesGolden: boolean }>;
        };
        expect(body.fixtureId).toBe(id);
        expect(body.cases).toHaveLength(8);
        expect(body.cases.every((c) => c.matchesGolden === true)).toBe(true);
      }
      // Repeated identical calls return byte-identical canonical JSON.
      const repeat = await Promise.all([analyze("F002"), analyze("F002"), analyze("F002")]);
      expect(repeat[1]).toBe(repeat[0]);
      expect(repeat[2]).toBe(repeat[0]);
    } finally {
      await server.stop();
    }
  }, 180_000);
});
