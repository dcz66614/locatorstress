// FIX-R1-01 — browser API tests for custom input (P022-R1-P1-01).
//
// The real AnalysisService over Chromium, with CUSTOM (non-fixture)
// scenarios only. Fixture behaviour is covered by
// tests/api/analyze-browser.test.ts and must be untouched.
//
// Shared custom HTML (two buttons; the Save button is the target):
//   <main><form>
//     <button type="submit" class="primary">Save</button>
//     <button type="button" class="secondary">Cancel</button>
//   </form></main>
// Target descriptor: "main > form > button:nth-child(1)" (private;
// never exposed to the locator under test).
//
// Expected verdicts for locator css "button.primary" (derived from
// the frozen mutation semantics, not from the golden matrix):
//   baseline STABLE; M01 STABLE (wrap); M02 STABLE (reorder keeps the
//   class); M03 MISSING (primary -> primary-changed); M04 AMBIGUOUS
//   (decoy copies class); M05 STABLE (iframe decoy); M06 STABLE
//   (Playwright CSS pierces the open shadow root); M07 AMBIGUOUS
//   (hidden decoy still counts); M08 STABLE (text change).

import { describe, it, expect, beforeAll, afterAll } from "vitest";

import type { BaselineBrowser } from "../../src/runner/browser.js";
import { createBrowserAnalysisService } from "../../src/api/service.js";
import type { AnalysisService } from "../../src/api/service.js";
import { MAX_CUSTOM_HTML_BYTES } from "../../src/contracts/custom-scenario.js";
import { launchTestBrowser } from "../integration/s0-helpers.js";

const SEED = "P022-LOCATORSTRESS-S0-2026-11-10";

const TWO_BUTTON_HTML =
  '<main><form><button type="submit" class="primary">Save</button>' +
  '<button type="button" class="secondary">Cancel</button></form></main>';
const TWO_BUTTON_TARGET = { css: "main > form > button:nth-child(1)" };

function cssScenario(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "locatorstress.scenario/v1",
    scenario_id: "P022-CUSTOM-CSS",
    seed: SEED,
    html: TWO_BUTTON_HTML,
    locator: { kind: "css", selector: "button.primary" },
    target: TWO_BUTTON_TARGET,
    ...overrides,
  };
}

describe("browser AnalysisService with custom scenarios (FIX-R1-01)", () => {
  let browserHandle: BaselineBrowser;
  let service: AnalysisService;

  beforeAll(async () => {
    browserHandle = await launchTestBrowser();
    service = createBrowserAnalysisService(browserHandle.page);
  });

  afterAll(async () => {
    await browserHandle.close();
  });

  it("validate accepts a custom scenario with a target and rejects unsafe HTML", () => {
    expect(service.validate({ scenario: cssScenario() }).valid).toBe(true);
    const script = service.validate({
      scenario: cssScenario({ html: '<script>alert(1)</script>' }),
    });
    expect(script.valid).toBe(false);
    expect(script.errors.join(" ")).toContain("script elements are not allowed");
    const external = service.validate({
      scenario: cssScenario({ html: '<img src="https://example.com/x.png">' }),
    });
    expect(external.valid).toBe(false);
    expect(external.errors.join(" ")).toContain("external URLs are not allowed");
  });

  it("analyze CSS custom: baseline STABLE, M03 MISSING, M04/M07 AMBIGUOUS, rest STABLE", async () => {
    const analysis = await service.analyze({ scenario: cssScenario() });
    expect(analysis.source).toBe("custom");
    expect(analysis.fixtureId).toBe("P022-CUSTOM-CSS");
    expect(analysis.scenarioId).toBe("P022-CUSTOM-CSS");
    expect(analysis.baseline.verdict).toBe("STABLE");
    expect(analysis.baseline.analysisStatus).toBe("COMPLETE");
    expect(analysis.baseline.identityMatch).toBe(true);
    expect(analysis.baseline.matchCount).toBe(1);
    expect(analysis.cases).toHaveLength(8);
    const byMutation = new Map(analysis.cases.map((c) => [c.mutationId, c]));
    expect(byMutation.get("M01")?.verdict).toBe("STABLE");
    expect(byMutation.get("M02")?.verdict).toBe("STABLE");
    expect(byMutation.get("M03")?.verdict).toBe("MISSING");
    expect(byMutation.get("M03")?.matchCount).toBe(0);
    expect(byMutation.get("M04")?.verdict).toBe("AMBIGUOUS");
    expect(byMutation.get("M04")?.matchCount).toBe(2);
    expect(byMutation.get("M05")?.verdict).toBe("STABLE");
    expect(byMutation.get("M06")?.verdict).toBe("STABLE");
    expect(byMutation.get("M07")?.verdict).toBe("AMBIGUOUS");
    expect(byMutation.get("M07")?.matchCount).toBe(2);
    expect(byMutation.get("M08")?.verdict).toBe("STABLE");
    // No golden matrix exists for user input.
    for (const c of analysis.cases) {
      expect(c.controlGroup).toBe("custom");
      expect(c.expectedVerdict).toBeNull();
      expect(c.matchesGolden).toBeNull();
    }
    expect(analysis.baseline.expectedVerdict).toBeNull();
  });

  it("analyze XPath custom: M03 MISSING, M04 AMBIGUOUS", async () => {
    const analysis = await service.analyze({
      scenario: cssScenario({
        scenario_id: "P022-CUSTOM-XPATH",
        locator: { kind: "xpath", selector: "//button[@class='primary']" },
      }),
    });
    expect(analysis.baseline.verdict).toBe("STABLE");
    const byMutation = new Map(analysis.cases.map((c) => [c.mutationId, c.verdict]));
    expect(byMutation.get("M03")).toBe("MISSING");
    expect(byMutation.get("M04")).toBe("AMBIGUOUS");
    expect(byMutation.get("M01")).toBe("STABLE");
  });

  it("analyze role custom: baseline STABLE, M08 MISSING, M04 AMBIGUOUS", async () => {
    const analysis = await service.analyze({
      scenario: cssScenario({
        scenario_id: "P022-CUSTOM-ROLE",
        locator: { kind: "role", role: "button", name: "Save" },
      }),
    });
    expect(analysis.baseline.verdict).toBe("STABLE");
    const byMutation = new Map(analysis.cases.map((c) => [c.mutationId, c.verdict]));
    expect(byMutation.get("M08")).toBe("MISSING");
    expect(byMutation.get("M04")).toBe("AMBIGUOUS");
    expect(byMutation.get("M01")).toBe("STABLE");
  });

  it("analyze WRONG_TARGET: css button + index 0, M04 decoy steals nth(0)", async () => {
    const analysis = await service.analyze({
      scenario: {
        schema: "locatorstress.scenario/v1",
        scenario_id: "P022-CUSTOM-WRONG",
        seed: SEED,
        html: '<main><button class="only">Click me</button></main>',
        locator: { kind: "css", selector: "button", index: 0 },
        target: { css: "main > button.only" },
      },
    });
    expect(analysis.baseline.verdict).toBe("STABLE");
    expect(analysis.baseline.identityMatch).toBe(true);
    const m04 = analysis.cases.find((c) => c.mutationId === "M04")!;
    expect(m04.verdict).toBe("WRONG_TARGET");
    expect(m04.matchCount).toBe(1);
    expect(m04.identityMatch).toBe(false);
  });

  it("analyze MISSING baseline: locator matches nothing on the custom page", async () => {
    const analysis = await service.analyze({
      scenario: cssScenario({
        scenario_id: "P022-CUSTOM-MISSING-BASE",
        locator: { kind: "css", selector: "button.gone" },
      }),
    });
    expect(analysis.baseline.verdict).toBe("MISSING");
    expect(analysis.baseline.matchCount).toBe(0);
    expect(analysis.baseline.analysisStatus).toBe("COMPLETE");
  });

  it("analyze honours a mutationIds subset and the scenario mutation_suite", async () => {
    const subset = await service.analyze({
      scenario: cssScenario(),
      mutationIds: ["M04"],
    });
    expect(subset.cases).toHaveLength(1);
    expect(subset.cases[0]?.mutationId).toBe("M04");
    expect(subset.cases[0]?.verdict).toBe("AMBIGUOUS");

    const suite = await service.analyze({
      scenario: cssScenario({
        scenario_id: "P022-CUSTOM-SUITE",
        mutation_suite: ["M03", "M08"],
      }),
    });
    expect(suite.cases.map((c) => c.mutationId)).toEqual(["M03", "M08"]);
  });

  it("search CSS custom depth 1: FOUND [M03] MISSING (shortest witness)", async () => {
    const result = await service.search({ scenario: cssScenario(), maxDepth: 1 });
    expect(result.fixtureId).toBe("P022-CUSTOM-CSS");
    expect(result.status).toBe("FOUND");
    expect(result.witness).toEqual({ sequence: ["M03"], depth: 1, verdict: "MISSING" });
    expect(result.statesEvaluated).toBe(4); // root + M01 + M02 + M03
    expect(result.incompleteStates).toBe(0);
  });

  it("search custom honours scenario.bfs defaults and request bounds override them", async () => {
    const fromScenario = await service.search({
      scenario: cssScenario({
        scenario_id: "P022-CUSTOM-BFS",
        bfs: { max_depth: 1, max_expanded_states: 4096 },
      }),
    });
    expect(fromScenario.status).toBe("FOUND");
    expect(fromScenario.witness?.sequence).toEqual(["M03"]);

    // Scenario says depth 0 (root only, STABLE) but the request asks
    // for depth 1: the request wins and the witness is found.
    const overridden = await service.search({
      scenario: cssScenario({
        scenario_id: "P022-CUSTOM-BFS",
        bfs: { max_depth: 0, max_expanded_states: 4096 },
      }),
      maxDepth: 1,
    });
    expect(overridden.status).toBe("FOUND");
    expect(overridden.witness?.sequence).toEqual(["M03"]);
  });

  it("search type-submit custom depth 1: BOUNDED_NO_WITNESS (no single mutation breaks it)", async () => {
    const result = await service.search({
      scenario: {
        schema: "locatorstress.scenario/v1",
        scenario_id: "P022-CUSTOM-ROBUST",
        seed: SEED,
        html: '<main><button type="submit">Save</button></main>',
        locator: { kind: "css", selector: "button[type=submit]" },
        target: { css: "main > button" },
      },
      maxDepth: 1,
    });
    expect(result.status).toBe("BOUNDED_NO_WITNESS");
    expect(result.witness).toBeNull();
    expect(result.statesEvaluated).toBe(9);
    expect(result.incompleteStates).toBe(0);
  });

  it("analyze/search reject invalid custom input with 400 (fail closed, never fixture fall back)", async () => {
    await expect(
      service.analyze({ scenario: cssScenario({ schema: "other/v1" }) }),
    ).rejects.toMatchObject({ status: 400, code: "BAD_REQUEST" });
    await expect(
      service.analyze({ scenario: cssScenario({ html: "<script>x</script>" }) }),
    ).rejects.toMatchObject({ status: 400, code: "BAD_REQUEST" });
    await expect(
      service.analyze({
        scenario: cssScenario({ html: '<img src="https://example.com/x.png">' }),
      }),
    ).rejects.toMatchObject({ status: 400, code: "BAD_REQUEST" });
    await expect(
      service.analyze({
        scenario: cssScenario({ html: `<main>${"x".repeat(MAX_CUSTOM_HTML_BYTES)}</main>` }),
      }),
    ).rejects.toMatchObject({ status: 400, code: "BAD_REQUEST" });
    const { target, ...noTarget } = cssScenario();
    void target;
    await expect(service.analyze({ scenario: noTarget })).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
    });
    await expect(
      service.search({ scenario: cssScenario({ locator: { kind: "css" } }) }),
    ).rejects.toMatchObject({ status: 400, code: "BAD_REQUEST" });
  });

  it("analyze/search fail closed with 422 on ambiguous or missing targets", async () => {
    await expect(
      service.analyze({ scenario: cssScenario({ target: { css: "button" } }) }),
    ).rejects.toMatchObject({ status: 422, code: "CUSTOM_TARGET_AMBIGUOUS" });
    await expect(
      service.analyze({
        scenario: cssScenario({ target: { css: "button.nothere" } }),
      }),
    ).rejects.toMatchObject({ status: 422, code: "CUSTOM_TARGET_NOT_FOUND" });
    await expect(
      service.search({ scenario: cssScenario({ target: { css: "button" } }) }),
    ).rejects.toMatchObject({ status: 422, code: "CUSTOM_TARGET_AMBIGUOUS" });
  });

  it("analyze/search reject both fixtureId+scenario and neither with 400", async () => {
    await expect(
      service.analyze({ fixtureId: "F001", scenario: cssScenario() }),
    ).rejects.toMatchObject({ status: 400, code: "BAD_REQUEST" });
    await expect(service.analyze({})).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
    });
    await expect(
      service.search({ fixtureId: "F001", scenario: cssScenario() }),
    ).rejects.toMatchObject({ status: 400, code: "BAD_REQUEST" });
    await expect(service.search({})).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
    });
  });

  it("fixture analyze still works unchanged after the custom paths were added", async () => {
    const analysis = await service.analyze({ fixtureId: "F001" });
    expect(analysis.source).toBe("fixture");
    expect(analysis.baseline.verdict).toBe("STABLE");
    expect(analysis.cases).toHaveLength(8);
    expect(analysis.cases.every((c) => c.verdict === "STABLE")).toBe(true);
    expect(analysis.cases.every((c) => c.matchesGolden === true)).toBe(true);
  });
});
