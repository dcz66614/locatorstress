// FIX-R1-01 — unit tests for the custom-scenario contract
// (contracts/custom-scenario.ts). Pure validation: no browser, no
// server. Run-time behaviour (400/422, verdicts, BFS) is covered by
// tests/api/custom-input-browser.test.ts and tests/e2e/custom-input.test.ts.

import { describe, it, expect } from "vitest";

import {
  MAX_CUSTOM_HTML_BYTES,
  normalizeCustomScenario,
  validateCustomHtmlSafety,
  validateCustomScenarioForRun,
  validateCustomScenarioShape,
  validateCustomTarget,
} from "../../src/contracts/custom-scenario.js";

const SEED = "P022-LOCATORSTRESS-S0-2026-11-10";

function baseScenario(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "locatorstress.scenario/v1",
    scenario_id: "P022-CUSTOM-001",
    seed: SEED,
    html: '<main><button class="primary">Save</button></main>',
    locator: { kind: "css", selector: "button.primary" },
    target: { css: "main > button.primary" },
    ...overrides,
  };
}

describe("validateCustomTarget", () => {
  it("accepts a plain css target", () => {
    expect(validateCustomTarget({ css: "main > button" })).toEqual([]);
  });

  it("accepts framePath and shadowHost targets", () => {
    expect(validateCustomTarget({ css: "button", framePath: ["iframe.a"] })).toEqual([]);
    expect(validateCustomTarget({ css: "button", shadowHost: "div.host" })).toEqual([]);
  });

  it("rejects missing/empty css, bad framePath, and framePath+shadowHost together", () => {
    expect(validateCustomTarget({})).toContain(
      "scenario.target.css must be a non-empty string",
    );
    expect(validateCustomTarget({ css: "" })).toContain(
      "scenario.target.css must be a non-empty string",
    );
    expect(validateCustomTarget({ css: "button", framePath: ["a", "b", "c"] })).toContain(
      "scenario.target.framePath must be an array of 0–2 non-empty strings",
    );
    expect(
      validateCustomTarget({ css: "button", framePath: ["iframe"], shadowHost: "div" }),
    ).toContain(
      "scenario.target: framePath and shadowHost are mutually exclusive (the target lives in one scope)",
    );
    expect(validateCustomTarget({ css: "button", bogus: 1 })).toContain(
      "scenario.target: unknown key: bogus",
    );
    expect(validateCustomTarget("button")).toEqual([
      "scenario.target must be a plain object",
    ]);
  });
});

describe("validateCustomHtmlSafety", () => {
  it("accepts plain synthetic HTML", () => {
    expect(
      validateCustomHtmlSafety('<main><button class="primary">Save</button></main>'),
    ).toEqual([]);
  });

  it("rejects scripts, external URLs, event handlers and javascript: URIs (fail closed)", () => {
    expect(validateCustomHtmlSafety('<script>alert(1)</script>')).toContain(
      "script elements are not allowed in custom HTML",
    );
    expect(validateCustomHtmlSafety('<SCRIPT src="x.js"></SCRIPT>')).toContain(
      "script elements are not allowed in custom HTML",
    );
    expect(validateCustomHtmlSafety('<img src="https://example.com/x.png">')).toContain(
      "external URLs are not allowed in custom HTML (synthetic HTML only)",
    );
    expect(validateCustomHtmlSafety('<img src="//example.com/x.png">')).toContain(
      "external URLs are not allowed in custom HTML (synthetic HTML only)",
    );
    expect(validateCustomHtmlSafety('<a href="https://example.com">x</a>')).toContain(
      "external URLs are not allowed in custom HTML (synthetic HTML only)",
    );
    expect(validateCustomHtmlSafety('<button onclick="go()">x</button>')).toContain(
      "inline event-handler attributes are not allowed in custom HTML",
    );
    expect(validateCustomHtmlSafety('<img src="x" onerror="go()">')).toContain(
      "inline event-handler attributes are not allowed in custom HTML",
    );
    expect(validateCustomHtmlSafety('<a href="javascript:go()">x</a>')).toContain(
      "javascript: URIs are not allowed in custom HTML",
    );
    expect(validateCustomHtmlSafety('<link rel="stylesheet" href="a.css">')).toContain(
      "link elements are not allowed in custom HTML",
    );
    expect(validateCustomHtmlSafety('<iframe src="https://example.com"></iframe>')).toContain(
      "iframe src= is not allowed in custom HTML (use srcdoc only)",
    );
    expect(
      validateCustomHtmlSafety('<iframe srcdoc="<button>Decoy</button>"></iframe>'),
    ).toEqual([]);
  });

  it("rejects oversized HTML", () => {
    const big = `<main>${"x".repeat(MAX_CUSTOM_HTML_BYTES)}</main>`;
    expect(validateCustomHtmlSafety(big)).toContain(
      `scenario.html exceeds ${MAX_CUSTOM_HTML_BYTES} bytes (synthetic HTML only)`,
    );
  });
});

describe("validateCustomScenarioShape / ForRun", () => {
  it("accepts a complete scenario with target", () => {
    expect(validateCustomScenarioShape(baseScenario())).toEqual([]);
    expect(validateCustomScenarioForRun(baseScenario())).toEqual([]);
  });

  it("shape check passes without a target (frozen /api/validate behaviour), run check requires it", () => {
    const { target, ...noTarget } = baseScenario();
    void target;
    expect(validateCustomScenarioShape(noTarget)).toEqual([]);
    expect(validateCustomScenarioForRun(noTarget)).toContain(
      "scenario.target is required for analyze/search: the Oracle needs a private target descriptor (css selector) to resolve the original target; without it the run cannot start",
    );
  });

  it("rejects wrong schema/seed, missing locator, bad mutation suite and bad bfs", () => {
    expect(
      validateCustomScenarioShape(baseScenario({ schema: "other/v1" })),
    ).toContain('scenario.schema must be "locatorstress.scenario/v1"');
    expect(validateCustomScenarioShape(baseScenario({ seed: "wrong" }))).toContain(
      `scenario.seed must be "${SEED}"`,
    );
    const { locator, ...noLocator } = baseScenario();
    void locator;
    expect(validateCustomScenarioShape(noLocator)).toContain("scenario.locator is required");
    expect(
      validateCustomScenarioShape(baseScenario({ mutation_suite: ["M01", "M99"] })),
    ).toContain("scenario.mutation_suite must be an array of M01–M08");
    expect(
      validateCustomScenarioShape(baseScenario({ bfs: { max_depth: 7 } })),
    ).toContain("scenario.bfs.max_depth must be an integer in 0..6");
    expect(
      validateCustomScenarioShape(baseScenario({ bfs: { max_expanded_states: 0 } })),
    ).toContain("scenario.bfs.max_expanded_states must be an integer in 1..4096");
  });

  it("shape check rejects unsafe HTML and a malformed target when present", () => {
    expect(
      validateCustomScenarioShape(baseScenario({ html: "<script>x</script>" })),
    ).toContain("script elements are not allowed in custom HTML");
    expect(
      validateCustomScenarioShape(baseScenario({ target: { css: "" } })),
    ).toContain("scenario.target.css must be a non-empty string");
  });

  it("rejects a non-object scenario", () => {
    expect(validateCustomScenarioShape("nope")).toEqual([
      "scenario must be a plain object",
    ]);
    expect(validateCustomScenarioForRun(null)).toEqual([
      "scenario must be a plain object",
    ]);
  });
});

describe("normalizeCustomScenario", () => {
  it("applies spec defaults (full suite, BFS 6/4096, scenario_id custom)", () => {
    const { scenario_id, mutation_suite, bfs, ...rest } = baseScenario();
    void scenario_id;
    void mutation_suite;
    void bfs;
    const normalized = normalizeCustomScenario(rest);
    expect(normalized.scenario_id).toBe("custom");
    expect(normalized.mutation_suite).toEqual([
      "M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08",
    ]);
    expect(normalized.bfs).toEqual({ max_depth: 6, max_expanded_states: 4096 });
  });

  it("keeps the locator exactly as supplied (no normalisation keys)", () => {
    // The frozen resolver validator rejects exact/includeHidden on
    // css/xpath specs, so a normalised locator would fail every
    // evaluation — the run path must keep the raw validated locator.
    const normalized = normalizeCustomScenario(baseScenario());
    expect(normalized.locator).toEqual({ kind: "css", selector: "button.primary" });
    expect("exact" in normalized.locator).toBe(false);
  });

  it("throws on an invalid scenario", () => {
    expect(() => normalizeCustomScenario(baseScenario({ schema: "x" }))).toThrow(
      /Invalid custom scenario/,
    );
    expect(() => normalizeCustomScenario(baseScenario({ target: undefined }))).toThrow(
      /scenario\.target is required/,
    );
  });
});
