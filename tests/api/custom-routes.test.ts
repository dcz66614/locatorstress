// FIX-R1-01 — route-layer tests for custom scenarios: /api/analyze
// and /api/search must forward a `scenario` body to the service, and
// the P2-2 rejection of test-only BFS options still applies when a
// scenario is present. Uses a fake service (no browser); real
// behaviour is covered by tests/api/custom-input-browser.test.ts.

import { describe, it, expect } from "vitest";

import { handleApiRequest } from "../../src/api/routes.js";
import type { AnalysisService } from "../../src/api/service.js";

const SEED = "P022-LOCATORSTRESS-S0-2026-11-10";

const SCENARIO = {
  schema: "locatorstress.scenario/v1",
  scenario_id: "P022-CUSTOM-ROUTES",
  seed: SEED,
  html: '<main><button class="primary">Save</button></main>',
  locator: { kind: "css", selector: "button.primary" },
  target: { css: "main > button.primary" },
};

function fakeService(capture: {
  analyzeRequest?: unknown;
  searchRequest?: unknown;
}): AnalysisService {
  return {
    health: () => ({
      status: "ok",
      service: "locatorstress",
      version: "0.1.0",
      seed: SEED,
      bfsLimits: { maxDepth: 6, maxExpandedStates: 4096 },
      mutationOrder: ["M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08"],
    }),
    listFixtures: () => [],
    listMutations: () => [],
    validate: () => ({ valid: true, errors: [] }),
    analyze: async (request) => {
      capture.analyzeRequest = request;
      return {
        fixtureId: "P022-CUSTOM-ROUTES",
        source: "custom",
        scenarioId: "P022-CUSTOM-ROUTES",
        baseline: null,
        cases: [],
      } as never;
    },
    search: async (request) => {
      capture.searchRequest = request;
      return {
        fixtureId: "P022-CUSTOM-ROUTES",
        status: "BOUNDED_NO_WITNESS",
        witness: null,
      } as never;
    },
  };
}

describe("POST /api/analyze and /api/search forward custom scenarios", () => {
  it("analyze forwards the scenario object to the service", async () => {
    const capture: { analyzeRequest?: unknown } = {};
    const r = await handleApiRequest(fakeService(capture), "POST", "/api/analyze", {
      scenario: SCENARIO,
      mutationIds: ["M04"],
    });
    expect(r.status).toBe(200);
    expect(capture.analyzeRequest).toEqual({
      fixtureId: undefined,
      scenario: SCENARIO,
      mutationIds: ["M04"],
    });
  });

  it("search forwards the scenario plus BFS bounds to the service", async () => {
    const capture: { searchRequest?: unknown } = {};
    const r = await handleApiRequest(fakeService(capture), "POST", "/api/search", {
      scenario: SCENARIO,
      maxDepth: 1,
      maxExpandedStates: 100,
    });
    expect(r.status).toBe(200);
    expect(capture.searchRequest).toEqual({
      fixtureId: undefined,
      scenario: SCENARIO,
      maxDepth: 1,
      maxExpandedStates: 100,
    });
  });

  it("search still rejects operatorOrder/allowRepeat when a scenario is present", async () => {
    const capture: { searchRequest?: unknown } = {};
    const r = await handleApiRequest(fakeService(capture), "POST", "/api/search", {
      scenario: SCENARIO,
      operatorOrder: ["M04"],
    });
    expect(r.status).toBe(400);
    expect(capture.searchRequest).toBeUndefined();
  });

  it("analyze passes both fixtureId and scenario through (the real service rejects the combination with 400)", async () => {
    const capture: { analyzeRequest?: unknown } = {};
    const r = await handleApiRequest(fakeService(capture), "POST", "/api/analyze", {
      fixtureId: "F001",
      scenario: SCENARIO,
    });
    expect(r.status).toBe(200);
    expect(capture.analyzeRequest).toEqual({
      fixtureId: "F001",
      scenario: SCENARIO,
      mutationIds: undefined,
    });
  });
});
