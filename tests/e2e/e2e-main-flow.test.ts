// T012 E2E — real Chromium walks the whole UI main flow and the result
// is checked field-by-field against the frozen backend JSON.
//
// Flow (PROJECT_BOOK §7.1): Fixture Lab select -> Locator edit
// validate/preview -> Mutation Lab DOM diff -> Verdict Matrix analyze ->
// BFS Witness -> Report export (download JSON). The downloaded JSON's
// verdicts/witness are compared with direct /api/analyze and /api/search
// responses, so the UI cannot silently diverge from the backend. A
// keyboard-only run then repeats the whole main flow with Tab /
// ArrowRight / Enter only. Chromium tracing is on for the whole file;
// on any test failure the trace is saved under
// evidence/s4/traces/ (see the report for the location).

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Browser, BrowserContext, Page } from "playwright";

import { repoRoot } from "../integration/s0-helpers.js";
import {
  SEED,
  S0_GATE_SHA256,
  T008_GATE_SHA256,
  isExternalUrl,
  startUiServer,
  launchChromium,
  expectText,
  expectCount,
  expectVisible,
  tabTo,
  type UiServerHandle,
} from "./e2e-helpers.js";

const TRACE_DIR = join(repoRoot(), "evidence", "s4", "traces");

let server: UiServerHandle;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let requestedUrls: string[] = [];
let tracingOn = false;

interface ApiCase {
  fixtureId: string;
  mutationId: string | null;
  verdict: string | null;
  analysisStatus: string;
  executionStatus: string;
  matchCount: number;
  identityMatch: boolean | null;
  expectedVerdict: string | null;
  matchesGolden: boolean | null;
}

interface ApiAnalysis {
  fixtureId: string;
  baseline: ApiCase;
  cases: ApiCase[];
}

async function fetchAnalysis(fixtureId: string): Promise<ApiAnalysis> {
  const res = await fetch(`${server.url}/api/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fixtureId }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as ApiAnalysis;
}

async function fetchSearch(fixtureId: string, maxDepth: number): Promise<{
  status: string;
  witness: { sequence: string[]; depth: number; verdict: string } | null;
}> {
  const res = await fetch(`${server.url}/api/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fixtureId, maxDepth }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    status: string;
    witness: { sequence: string[]; depth: number; verdict: string } | null;
  };
}

afterEach(async (ctx) => {
  if (ctx.task.result?.state !== "fail" || !tracingOn) return;
  try {
    mkdirSync(TRACE_DIR, { recursive: true });
    const name = ctx.task.name.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 80);
    await context.tracing.stop({
      path: join(TRACE_DIR, `e2e-main-flow-${name}.zip`),
    });
    tracingOn = false;
  } catch {
    // Tracing is best-effort evidence; a trace failure must not mask
    // the test failure itself.
  }
});

describe("T012 E2E main flow (real Chromium)", () => {
  beforeAll(async () => {
    server = await startUiServer();
    browser = await launchChromium();
    context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await context.newPage();
    page.on("request", (req) => requestedUrls.push(req.url()));
    await context.tracing.start({ screenshots: true, snapshots: true });
    tracingOn = true;
    expect(browser.version()).toBe("158.0.8127.18");
  }, 120_000);

  afterAll(async () => {
    if (tracingOn) {
      await context.tracing.stop().catch(() => undefined);
    }
    await page?.context().close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await server?.stop();
  });

  it("full flow F002: select -> validate/preview -> diff -> matrix -> witness -> report", async () => {
    await page.goto(server.url, { waitUntil: "networkidle" });
    await expectText(page, "#health-status", "API ok", 10_000);
    await expectText(page, "#seed-text", SEED);
    await expectCount(page, "#fixture-rows tr", 24);

    // Fixture Lab: select F002 (xpath, fragile).
    await page.locator('#fixture-rows tr[data-fixture-id="F002"]').click();
    await expectText(page, "#selected-fixture", "F002");
    await expectText(page, "#selected-fixture", "xpath");

    // Locator edit: frozen locator validates and previews 1 match.
    await page.locator('[data-view="locator"]').click();
    await expectText(page, "#loc-fixture-note", "F002");
    await expect
      .poll(() => page.locator("#loc-selector").inputValue(), { timeout: 10_000 })
      .toBe("/html/body/main/form/button[1]");
    await page.locator("#loc-validate").click();
    await expectText(page, "#loc-validate-result", "校验通过", 10_000);
    await page.locator("#loc-preview").click();
    await expectText(page, "#loc-preview-result", "匹配 1 个元素", 10_000);
    await expectText(page, "#loc-preview-result", "是否命中同一元素：是");

    // Mutation Lab: M01 shows a real DOM diff (wrap div appears).
    await page.locator('[data-view="mutations"]').click();
    await page.locator('.mutation-list button[data-mutation="M01"]').click();
    await expect.poll(() => page.locator("#diff-view tr.diff-add").count(), { timeout: 30_000 }).toBeGreaterThan(0);
    await expectText(page, "#diff-view", 'class="wrap"');

    // Verdict Matrix: backend verdicts, M01 WRONG_TARGET.
    await page.locator('[data-view="matrix"]').click();
    await page.locator("#run-analysis").click();
    await expectText(page, '.matrix-cell[data-mutation="M01"] .cell-verdict', "WRONG_TARGET", 60_000);
    await expectText(page, '.matrix-cell[data-mutation="baseline"] .cell-verdict', "STABLE");
    await page.locator('.matrix-cell[data-mutation="M01"]').click();
    await expectText(page, "#case-detail", "不是原目标", 30_000);

    // BFS Witness: depth 1 finds [M01].
    await page.locator('[data-view="witness"]').click();
    await page.locator("#bfs-depth").fill("1");
    await page.locator("#run-bfs").click();
    await expectText(page, "#witness-summary", "FOUND", 60_000);
    await expectText(page, "#witness-summary", "M01");
    await expectText(page, "#witness-summary", "WRONG_TARGET");
    await expectCount(page, "#witness-steps table", 1, 30_000);

    // Report: server score 37.5 (3/8 stable) + backend hashes.
    await page.locator('[data-view="report"]').click();
    await expectText(page, "#report-score", "37.5", 10_000);
    await expectText(page, "#report-score", "3/8");
    await expectText(page, "#report-coverage", "8/8");
    await expectText(page, "#report-counts", "WRONG_TARGET 5");
    await expectText(page, "#report-hashes", T008_GATE_SHA256, 10_000);
    await expectText(page, "#report-hashes", S0_GATE_SHA256);
    await expectVisible(page, "#download-json");
    await expectCount(page, "#report-operator-rows tr", 8);
  }, 180_000);

  it("downloaded UI JSON matches the frozen backend /api/analyze + /api/search field by field", async () => {
    // Still on the F002 report view from the previous test.
    await expectVisible(page, "#download-json");
    const tmpDir = mkdtempSync(join(tmpdir(), "locatorstress-t012-e2e-"));
    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await page.locator("#download-json").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("F002-analysis.json");
    const downloadPath = join(tmpDir, download.suggestedFilename());
    await download.saveAs(downloadPath);
    const exported = JSON.parse(readFileSync(downloadPath, "utf8")) as {
      schema: string;
      fixtureId: string;
      seed: string;
      analysis: ApiAnalysis;
      // The UI stores the full WitnessSummary from /api/search, so the
      // exported witness is { status, witness: { sequence, ... }, ... },
      // not the bare witness object.
      witness: {
        status: string;
        witness: { sequence: string[]; depth: number; verdict: string } | null;
      } | null;
      scores: { overall: { score: string | null } };
    };
    expect(exported.schema).toBe("locatorstress.ui-fixture-export/v1");
    expect(exported.fixtureId).toBe("F002");
    expect(exported.seed).toBe(SEED);
    expect(exported.scores.overall.score).toBe("37.5");

    const api = await fetchAnalysis("F002");
    expect(exported.analysis.fixtureId).toBe(api.fixtureId);
    expect(exported.analysis.baseline.verdict).toBe(api.baseline.verdict);
    expect(exported.analysis.baseline.verdict).toBe("STABLE");
    expect(exported.analysis.cases).toHaveLength(api.cases.length);
    for (let i = 0; i < api.cases.length; i += 1) {
      const uiCase = exported.analysis.cases[i]!;
      const apiCase = api.cases[i]!;
      expect(uiCase.mutationId).toBe(apiCase.mutationId);
      expect(uiCase.verdict).toBe(apiCase.verdict);
      expect(uiCase.analysisStatus).toBe(apiCase.analysisStatus);
      expect(uiCase.executionStatus).toBe(apiCase.executionStatus);
      expect(uiCase.matchCount).toBe(apiCase.matchCount);
      expect(uiCase.identityMatch).toBe(apiCase.identityMatch);
      expect(uiCase.expectedVerdict).toBe(apiCase.expectedVerdict);
      expect(uiCase.matchesGolden).toBe(apiCase.matchesGolden);
      expect(apiCase.matchesGolden).toBe(true);
    }
    // Golden verdicts for F002 (frozen matrix): M01/M02/M04/M06/M07
    // WRONG_TARGET, M03/M05/M08 STABLE.
    const byMutation = new Map(api.cases.map((c) => [c.mutationId, c.verdict]));
    expect(byMutation.get("M01")).toBe("WRONG_TARGET");
    expect(byMutation.get("M03")).toBe("STABLE");
    expect(byMutation.get("M05")).toBe("STABLE");
    expect(byMutation.get("M08")).toBe("STABLE");

    const search = await fetchSearch("F002", 1);
    expect(search.status).toBe("FOUND");
    expect(search.witness?.sequence).toEqual(["M01"]);
    expect(exported.witness).not.toBeNull();
    expect(exported.witness?.status).toBe(search.status);
    expect(exported.witness?.witness?.sequence).toEqual(search.witness?.sequence);
    expect(exported.witness?.witness?.verdict).toBe(search.witness?.verdict);
    expect(exported.witness?.witness?.depth).toBe(search.witness?.depth);
  }, 120_000);

  it("full flow F001: all-STABLE fixture scores 100 and exports 8 STABLE cases", async () => {
    await page.locator('[data-view="fixtures"]').click();
    await page.locator('#fixture-rows tr[data-fixture-id="F001"]').click();
    await expectText(page, "#selected-fixture", "F001");
    await page.locator('[data-view="matrix"]').click();
    await page.locator("#run-analysis").click();
    await expectText(page, '.matrix-cell[data-mutation="baseline"] .cell-verdict', "STABLE", 60_000);
    await expectText(page, '.matrix-cell[data-mutation="M08"] .cell-verdict', "STABLE", 30_000);
    await page.locator('[data-view="report"]').click();
    await expectText(page, "#report-score", "100", 10_000);
    await expectText(page, "#report-score", "8/8");
    await expectText(page, "#report-counts", "STABLE 8");
    const api = await fetchAnalysis("F001");
    expect(api.cases.every((c) => c.verdict === "STABLE")).toBe(true);
    expect(api.cases.every((c) => c.matchesGolden === true)).toBe(true);
  }, 180_000);

  it("keyboard only: Tab/Enter select F003, ArrowRight tabs, Enter runs matrix + BFS + download", async () => {
    await page.goto(server.url, { waitUntil: "networkidle" });
    await expectText(page, "#health-status", "API ok", 10_000);
    // Tab to the F003 row (rows are tabindex=0) and select with Enter.
    await tabTo(page, "F003");
    await page.keyboard.press("Enter");
    await expectText(page, "#selected-fixture", "F003", 10_000);
    // ArrowRight moves between tabs (T009 keyboard support): fixtures
    // -> locator -> mutations -> matrix.
    await page.keyboard.press("Tab");
    await tabTo(page, "Fixture Lab");
    await page.keyboard.press("ArrowRight");
    await expectVisible(page, "#view-locator");
    await page.keyboard.press("ArrowRight");
    await expectVisible(page, "#view-mutations");
    await page.keyboard.press("ArrowRight");
    await expectVisible(page, "#view-matrix");
    // Tab to 运行分析 and run it with Enter.
    await tabTo(page, "运行分析");
    await page.keyboard.press("Enter");
    await expectText(page, '.matrix-cell[data-mutation="baseline"] .cell-verdict', "STABLE", 60_000);
    // F003 golden: only M04 fails (AMBIGUOUS).
    await expectText(page, '.matrix-cell[data-mutation="M04"] .cell-verdict', "AMBIGUOUS", 30_000);
    await expectText(page, '.matrix-cell[data-mutation="M01"] .cell-verdict', "STABLE", 30_000);
    // ArrowRight to witness, Tab to 运行 BFS, Enter; depth defaults to 2.
    await page.keyboard.press("Tab");
    await tabTo(page, "BFS Witness");
    await page.keyboard.press("ArrowRight");
    await expectVisible(page, "#view-witness");
    await tabTo(page, "运行 BFS");
    await page.keyboard.press("Enter");
    await expectText(page, "#witness-summary", "FOUND", 60_000);
    await expectText(page, "#witness-summary", "M04");
    // ArrowRight to report, Tab to the download button, Enter downloads.
    await page.keyboard.press("Tab");
    await tabTo(page, "Report");
    await page.keyboard.press("ArrowRight");
    await expectVisible(page, "#view-report");
    await expectText(page, "#report-score", "87.5", 10_000);
    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await tabTo(page, "下载本次分析 JSON");
    await page.keyboard.press("Enter");
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("F003-analysis.json");
  }, 240_000);

  it("keyboard: ArrowLeft wraps back through tabs and Shift+Tab moves focus backwards", async () => {
    await page.locator('[data-view="fixtures"]').click();
    await expectVisible(page, "#view-fixtures");
    await page.keyboard.press("Tab");
    await tabTo(page, "Fixture Lab");
    await page.keyboard.press("ArrowLeft");
    await expectVisible(page, "#view-report");
    await page.keyboard.press("ArrowRight");
    await expectVisible(page, "#view-fixtures");
    // Focus is on the Fixture Lab tab; Shift+Tab must move focus to an
    // earlier element, not stay on the same tab.
    const before = await page.evaluate(() => document.activeElement?.textContent ?? "");
    await page.keyboard.press("Shift+Tab");
    const after = await page.evaluate(() => document.activeElement?.textContent ?? "");
    expect(after).not.toBe(before);
  }, 120_000);

  it("invalid locator draft is stopped client-side and the server stays alive", async () => {
    // The format guard reads the selector field, which only applies to
    // css/xpath locators: re-select F002 (xpath) first, because the
    // previous keyboard test left a role locator (F003) selected, for
    // which an empty selector input is irrelevant and validation passes.
    await page.locator('[data-view="fixtures"]').click();
    await page.locator('#fixture-rows tr[data-fixture-id="F002"]').click();
    await expectText(page, "#selected-fixture", "F002");
    await page.locator('[data-view="locator"]').click();
    await page.locator("#loc-selector").fill("");
    await page.locator("#loc-validate").click();
    await expectText(page, "#loc-validate-result", "格式检查未通过", 10_000);
    const health = await fetch(`${server.url}/api/health`);
    expect(health.status).toBe(200);
    await page.locator("#loc-reset").click();
    await expect
      .poll(() => page.locator("#loc-selector").inputValue(), { timeout: 10_000 })
      .not.toBe("");
  }, 60_000);

  it("every request in the whole E2E session stayed on loopback (zero external)", async () => {
    expect(requestedUrls.length).toBeGreaterThan(0);
    const external = requestedUrls.filter((u) => isExternalUrl(u));
    expect(external).toEqual([]);
    // Sanity: the recorded traffic is real UI traffic, not an empty log.
    expect(requestedUrls.some((u) => u.endsWith("/app.js"))).toBe(true);
    expect(requestedUrls.some((u) => u.includes("/api/health"))).toBe(true);
    writeFileSync(
      join(repoRoot(), "evidence", "s4", "T012_E2E_REQUESTS.json"),
      JSON.stringify(
        { totalRequests: requestedUrls.length, externalRequests: 0, urls: requestedUrls },
        null,
        2,
      ),
    );
  }, 30_000);
});
