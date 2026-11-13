// FIX-R2-01 — live-Chromium proof for P022-R2-P1-01.
//
// Two layers, both proven against real Chromium (not string asserts):
//   1. Validation layer: /api/validate (service.validate) rejects the
//      exact GPT payloads and the unquoted external URL.
//   2. Execution layer: the payloads are fed DIRECTLY to a page
//      inside withPageJavaScriptDisabled (bypassing validation, as a
//      defence-in-depth check). While the toggle is on, no script
//      executes (window.__pwned stays undefined, the target button
//      keeps its class) while locators and sync CDP evaluate still
//      work; after the toggle, page timers fire again (restoration
//      proof) and a second page in the same context is unaffected.
//      The service's custom analyze/search/snapshot paths run inside
//      this same toggle; the general runner context stays
//      JavaScript-enabled because the T001 oracle probe needs page
//      timers and image events (a blanket javaScriptEnabled:false
//      stalls that probe forever — verified live, see REPORT.md).
//   3. Positive control: a full custom analyze/search still works
//      (CSS / XPath / role locators + DOM mutations M03/M04) and a
//      fixture analyze still works afterwards on the same page.
//
// The validation + helper tests FAIL on the pre-fix code (validation
// passes the payloads; setContent executes them) and PASS after the
// fix. See handoff/FIX-R2-01/REPORT.md for the before/after numbers.

import { describe, it, expect, beforeAll, afterAll } from "vitest";

import type { BaselineBrowser } from "../../src/runner/browser.js";
import { withPageJavaScriptDisabled } from "../../src/runner/browser.js";
import { createBrowserAnalysisService } from "../../src/api/service.js";
import type { AnalysisService } from "../../src/api/service.js";
import { launchTestBrowser } from "../integration/s0-helpers.js";

const SEED = "P022-LOCATORSTRESS-S0-2026-11-10";

const TWO_BUTTON_HTML =
  '<main><form><button type="submit" class="primary">Save</button>' +
  '<button type="button" class="secondary">Cancel</button></form></main>';
const TWO_BUTTON_TARGET = { css: "main > form > button:nth-child(1)" };

// GPT's exact R2 payloads (verbatim from ~/workspace/P022_R2_VERDICT.md).
const GPT_PROBE = "<script/>window.__pwned=1</script>";
const GPT_PAYLOAD =
  '<main>\n  <button class="primary">Save</button>\n  <script/>document.querySelector("button").classList.remove("primary")</script>\n</main>';
const GPT_UNQUOTED_URL = "<img src=https://example.invalid/a.png>";

function cssScenario(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "locatorstress.scenario/v1",
    scenario_id: "P022-CUSTOM-R2-CSS",
    seed: SEED,
    html: TWO_BUTTON_HTML,
    locator: { kind: "css", selector: "button.primary" },
    target: TWO_BUTTON_TARGET,
    ...overrides,
  };
}

describe("FIX-R2-01 live Chromium proof (P022-R2-P1-01)", () => {
  let browserHandle: BaselineBrowser;
  let service: AnalysisService;

  beforeAll(async () => {
    browserHandle = await launchTestBrowser();
    service = createBrowserAnalysisService(browserHandle.page);
  });

  afterAll(async () => {
    await browserHandle.close();
  });

  it("validation rejects the exact GPT payloads and the unquoted URL", () => {
    for (const html of [GPT_PROBE, GPT_PAYLOAD, GPT_UNQUOTED_URL]) {
      const result = service.validate({ scenario: cssScenario({ html }) });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    }
    const probe = service.validate({ scenario: cssScenario({ html: GPT_PROBE }) });
    expect(probe.errors.join(" ")).toContain("script elements are not allowed");
    const url = service.validate({
      scenario: cssScenario({ html: GPT_UNQUOTED_URL }),
    });
    expect(url.errors.join(" ")).toContain("external URLs are not allowed");
  });

  it("execution layer: <script/> probe inside the toggle does not execute", async () => {
    const page = browserHandle.page;
    await withPageJavaScriptDisabled(page, async () => {
      await page.setContent(GPT_PROBE);
      const pwned = await page.evaluate(
        () => (window as unknown as { __pwned?: unknown }).__pwned,
      );
      expect(pwned).toBeUndefined();
    });
  });

  it("execution layer: GPT full payload inside the toggle does not strip the target class", async () => {
    const page = browserHandle.page;
    await withPageJavaScriptDisabled(page, async () => {
      await page.setContent(GPT_PAYLOAD);
      expect(await page.locator("button.primary").count()).toBe(1);
      expect(
        await page.locator("button").first().evaluate((el) => el.getAttribute("class")),
      ).toBe("primary");
      const pwned = await page.evaluate(
        () => (window as unknown as { __pwned?: unknown }).__pwned,
      );
      expect(pwned).toBeUndefined();
    });
  });

  it("execution layer: SVG-embedded script and srcdoc script inside the toggle do not execute", async () => {
    const page = browserHandle.page;
    await withPageJavaScriptDisabled(page, async () => {
      await page.setContent(
        '<main><button class="primary">Save</button></main><svg><script>window.__pwned=1</script></svg>',
      );
      expect(
        await page.evaluate(
          () => (window as unknown as { __pwned?: unknown }).__pwned,
        ),
      ).toBeUndefined();
      expect(await page.locator("button.primary").count()).toBe(1);
      await page.setContent(
        '<main><button class="primary">Save</button></main><iframe srcdoc="<script>window.__pwned=1</script>"></iframe>',
      );
      expect(
        await page.evaluate(
          () => (window as unknown as { __pwned?: unknown }).__pwned,
        ),
      ).toBeUndefined();
    });
  });

  it("toggle restores page JavaScript afterwards (timer + oracle-probe shape)", async () => {
    const page = browserHandle.page;
    await withPageJavaScriptDisabled(page, async () => {
      await page.setContent("<main><button>Hi</button></main>");
    });
    // If the toggle leaked, this timer would never fire and the test
    // would time out — the same shape as the T001 oracle probe.
    const fired = await page.evaluate(
      () => new Promise((resolve) => setTimeout(() => resolve("timer-fired"), 50)),
    );
    expect(fired).toBe("timer-fired");
  });

  it("toggle is page-scoped: a second page in the same context keeps timers while the first is disabled", async () => {
    const page = browserHandle.page;
    const page2 = await browserHandle.context.newPage();
    try {
      await withPageJavaScriptDisabled(page, async () => {
        await page.setContent("<main><button>Hi</button></main>");
        const fired = await page2.evaluate(
          () => new Promise((resolve) => setTimeout(() => resolve("p2-timer"), 50)),
        );
        expect(fired).toBe("p2-timer");
      });
    } finally {
      await page2.close();
    }
  });

  it("positive control: CSS analyze still works (baseline STABLE, M03 MISSING, M04 AMBIGUOUS)", async () => {
    const analysis = await service.analyze({ scenario: cssScenario() });
    expect(analysis.baseline.verdict).toBe("STABLE");
    expect(analysis.baseline.identityMatch).toBe(true);
    expect(analysis.baseline.matchCount).toBe(1);
    const byMutation = new Map(analysis.cases.map((c) => [c.mutationId, c]));
    expect(byMutation.get("M03")?.verdict).toBe("MISSING");
    expect(byMutation.get("M04")?.verdict).toBe("AMBIGUOUS");
    expect(byMutation.get("M01")?.verdict).toBe("STABLE");
  });

  it("positive control: XPath and role locators still resolve", async () => {
    const xpath = await service.analyze({
      scenario: cssScenario({
        scenario_id: "P022-CUSTOM-R2-XPATH",
        locator: { kind: "xpath", selector: "//button[@class='primary']" },
      }),
    });
    expect(xpath.baseline.verdict).toBe("STABLE");
    expect(xpath.baseline.matchCount).toBe(1);
    const role = await service.analyze({
      scenario: cssScenario({
        scenario_id: "P022-CUSTOM-R2-ROLE",
        locator: { kind: "role", role: "button", name: "Save" },
      }),
    });
    expect(role.baseline.verdict).toBe("STABLE");
    expect(role.baseline.matchCount).toBe(1);
    expect(role.cases.find((c) => c.mutationId === "M08")?.verdict).toBe("MISSING");
  });

  it("positive control: search still finds the M03 witness at depth 1", async () => {
    const result = await service.search({ scenario: cssScenario(), maxDepth: 1 });
    expect(result.status).toBe("FOUND");
    expect(result.witness).toEqual({ sequence: ["M03"], depth: 1, verdict: "MISSING" });
  });

  it("no toggle leak: page timers fire and fixture analyze still works after custom runs", async () => {
    const page = browserHandle.page;
    const fired = await page.evaluate(
      () => new Promise((resolve) => setTimeout(() => resolve("timer-fired"), 50)),
    );
    expect(fired).toBe("timer-fired");
    const analysis = await service.analyze({ fixtureId: "F001" });
    expect(analysis.source).toBe("fixture");
    expect(analysis.baseline.verdict).toBe("STABLE");
    expect(analysis.cases).toHaveLength(8);
    expect(analysis.cases.every((c) => c.verdict === "STABLE")).toBe(true);
  });
});
