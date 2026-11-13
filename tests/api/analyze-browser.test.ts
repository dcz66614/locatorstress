// T008 browser API tests — the real AnalysisService over Chromium.
//
// Cross-checks /api/analyze and /api/search behaviour against the
// frozen golden matrix at depth 1 (the same ground truth T007 used):
//   - F002: baseline STABLE, M01 WRONG_TARGET (golden), search depth 1
//     FOUND [M01] WRONG_TARGET.
//   - F003: search depth 1 FOUND [M04] AMBIGUOUS.
//   - F001: all eight single mutations STABLE (golden), search depth 1
//     BOUNDED_NO_WITNESS.
//   - F001 with maxExpandedStates 2: BOUNDED_INCOMPLETE is passed
//     through verbatim (budget exhausted, queue non-empty) — the P2-1
//     path, exercised cheaply with a reduced budget that is labelled as
//     such in the test name, not presented as the frozen 4096 budget.
// Public fixture summaries never expose private Oracle fields.

import { describe, it, expect, beforeAll, afterAll } from "vitest";

import type { BaselineBrowser } from "../../src/runner/browser.js";
import { createBrowserAnalysisService } from "../../src/api/service.js";
import type { AnalysisService } from "../../src/api/service.js";
import {
  FIXTURE_IDS,
  loadAllFixtureManifests,
} from "../../src/fixtures/fixture-manifest.js";
import { launchTestBrowser, repoRoot } from "../integration/s0-helpers.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function goldenMap(): Map<string, string> {
  const parsed = JSON.parse(
    readFileSync(
      join(repoRoot(), "src/fixtures/golden/expected-verdicts.json"),
      "utf8",
    ),
  ) as {
    cases: Array<{ fixtureId: string; mutationId: string; expectedVerdict: string }>;
  };
  expect(parsed.cases.length).toBe(192);
  const map = new Map<string, string>();
  for (const c of parsed.cases) {
    map.set(`${c.fixtureId}/${c.mutationId}`, c.expectedVerdict);
  }
  return map;
}

describe("browser AnalysisService", () => {
  let browserHandle: BaselineBrowser;
  let service: AnalysisService;
  let golden: Map<string, string>;

  beforeAll(async () => {
    browserHandle = await launchTestBrowser();
    service = createBrowserAnalysisService(browserHandle.page);
    golden = goldenMap();
    expect(loadAllFixtureManifests().map((m) => m.fixtureId).sort()).toEqual(
      [...FIXTURE_IDS].sort(),
    );
  });

  afterAll(async () => {
    await browserHandle.close();
  });

  it("listFixtures returns 24 public summaries with no private Oracle fields", () => {
    const fixtures = service.listFixtures();
    expect(fixtures).toHaveLength(24);
    for (const f of fixtures) {
      expect(Object.keys(f).sort()).toEqual([
        "controlGroup",
        "family",
        "fixtureId",
        "kind",
        "locator",
      ]);
      expect(f.locator.kind).toBe(f.kind);
    }
  });

  it("listMutations returns M01–M08 in fixed order with names", () => {
    expect(service.listMutations().map((m) => m.id)).toEqual([
      "M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08",
    ]);
    expect(service.listMutations()[0]?.name).toBe("WRAP_TARGET");
    expect(service.listMutations()[7]?.name).toBe("CHANGE_TEXT");
  });

  it("validate accepts a valid LocatorSpec and a valid scenario", () => {
    expect(
      service.validate({ locator: { kind: "css", selector: "button.primary" } }),
    ).toEqual({
      valid: true,
      errors: [],
      locator: {
        kind: "css",
        selector: "button.primary",
        exact: false,
        includeHidden: false,
        framePath: [],
        index: null,
      },
    });
    const bad = service.validate({ locator: { kind: "css" } });
    expect(bad.valid).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(0);
    const scenario = service.validate({
      scenario: {
        schema: "locatorstress.scenario/v1",
        scenario_id: "P022-DEMO-CSS-001",
        seed: "P022-LOCATORSTRESS-S0-2026-11-10",
        html: "<main><button>Save</button></main>",
        locator: { kind: "css", selector: "button" },
        mutation_suite: ["M01", "M02"],
        bfs: { max_depth: 6, max_expanded_states: 4096 },
      },
    });
    expect(scenario.valid).toBe(true);
  });

  it("analyze F002: baseline STABLE and all 8 cases match golden", async () => {
    const analysis = await service.analyze({ fixtureId: "F002" });
    expect(analysis.baseline.verdict).toBe("STABLE");
    expect(analysis.baseline.analysisStatus).toBe("COMPLETE");
    expect(analysis.cases).toHaveLength(8);
    for (const c of analysis.cases) {
      expect(c.verdict).toBe(golden.get(`F002/${c.mutationId}`));
      expect(c.matchesGolden).toBe(true);
      expect(c.expectedVerdict).toBe(golden.get(`F002/${c.mutationId}`));
    }
    expect(analysis.cases.find((c) => c.mutationId === "M01")?.verdict).toBe(
      "WRONG_TARGET",
    );
  });

  it("analyze F001: all 8 single mutations STABLE per golden", async () => {
    const analysis = await service.analyze({ fixtureId: "F001" });
    expect(analysis.baseline.verdict).toBe("STABLE");
    for (const c of analysis.cases) {
      expect(c.verdict).toBe("STABLE");
      expect(c.matchesGolden).toBe(true);
    }
  });

  it("search F002 depth 1 FOUND [M01] and F003 depth 1 FOUND [M04]", async () => {
    const f002 = await service.search({ fixtureId: "F002", maxDepth: 1 });
    expect(f002.status).toBe("FOUND");
    expect(f002.witness).toEqual({ sequence: ["M01"], depth: 1, verdict: "WRONG_TARGET" });

    const f003 = await service.search({ fixtureId: "F003", maxDepth: 1 });
    expect(f003.status).toBe("FOUND");
    expect(f003.witness).toEqual({ sequence: ["M04"], depth: 1, verdict: "AMBIGUOUS" });
  });

  it("search F001 depth 1 is BOUNDED_NO_WITNESS with a null witness", async () => {
    const result = await service.search({ fixtureId: "F001", maxDepth: 1 });
    expect(result.status).toBe("BOUNDED_NO_WITNESS");
    expect(result.witness).toBeNull();
    expect(result.statesEvaluated).toBe(9);
    expect(result.incompleteStates).toBe(0);
  });

  it("search with a reduced expansion budget reports BOUNDED_INCOMPLETE verbatim (P2-1)", async () => {
    // Reduced budget (maxExpandedStates 2, NOT the frozen 4096): the
    // search must report BOUNDED_INCOMPLETE with sequences still queued.
    const result = await service.search({
      fixtureId: "F001",
      maxDepth: 6,
      maxExpandedStates: 2,
    });
    expect(result.status).toBe("BOUNDED_INCOMPLETE");
    expect(result.witness).toBeNull();
    expect(result.queueRemaining).toBeGreaterThan(0);
    expect(result.statesExpanded).toBe(2);
    expect(result.meaning).toContain("INCOMPLETE");
    expect(result.meaning).toContain('NOT "no witness"');
    expect(result.budgetNote).toBeUndefined();
  });

  it("analyze/search reject malformed fixture ids and out-of-range bounds", async () => {
    // F099 fails the fixtureId pattern, so it is a 400 (malformed id),
    // not a 404: every well-formed id F001–F024 exists, so the service
    // 404 path (manifest missing) is defensive-only.
    await expect(service.analyze({ fixtureId: "F099" })).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
    });
    await expect(service.search({ fixtureId: "F099" })).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
    });
    await expect(service.search({ fixtureId: "F001", maxDepth: 7 })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      service.search({ fixtureId: "F001", maxExpandedStates: 4097 }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
