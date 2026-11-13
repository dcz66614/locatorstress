// FIX-R1-01 E2E — real Chromium drives the Web UI in CUSTOM input
// mode and checks the result against the backend, exactly like the
// T012 main flow does for fixtures.
//
// Covers, all with CUSTOM (non-fixture) input:
//   - three locator types (CSS, XPath, role);
//   - a WRONG_TARGET case (css button + index 0, M04 decoy steals nth(0));
//   - an AMBIGUOUS case (M04/M07 decoys);
//   - a MISSING case (M03 class change / M08 text change / no-match locator);
//   - a shortest-witness BFS case (FOUND [M03] MISSING at depth 1);
//   - fail-closed UI behaviour for an ambiguous target descriptor;
//   - zero external requests for the whole session.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Browser, BrowserContext, Page } from "playwright";

import { scanExternalResources } from "../../src/export/html-escape.js";
import { parseEmbeddedReportJson } from "../../src/export/html-export.js";
import { repoRoot } from "../integration/s0-helpers.js";
import {
  SEED,
  isExternalUrl,
  startUiServer,
  launchChromium,
  expectText,
  expectCount,
  expectVisible,
  type UiServerHandle,
} from "./e2e-helpers.js";

let server: UiServerHandle;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let requestedUrls: string[] = [];

const DEMO_HTML =
  '<main><form><button type="submit" class="primary">Save</button>' +
  '<button type="button" class="secondary">Cancel</button></form></main>';
const DEMO_TARGET = "main > form > button:nth-child(1)";

async function switchToCustomMode(): Promise<void> {
  await page.locator('[data-view="locator"]').click();
  await page.locator("#mode-custom").check();
  await expectVisible(page, "#custom-fields");
}

async function setCustomFields(html: string, targetCss: string): Promise<void> {
  await page.locator("#custom-html").fill(html);
  await page.locator("#custom-target-css").fill(targetCss);
}

async function setCssLocator(selector: string, index: string): Promise<void> {
  await page.locator("#loc-kind").selectOption("css");
  await page.locator("#loc-selector").fill(selector);
  await page.locator("#loc-index").fill(index);
}

async function runCustomAnalysis(): Promise<void> {
  await page.locator('[data-view="matrix"]').click();
  await page.locator("#run-analysis").click();
  await expectText(
    page,
    '.matrix-cell[data-mutation="baseline"] .cell-verdict',
    "STABLE",
    60_000,
  );
}

describe("FIX-R1-01 E2E custom input (real Chromium)", () => {
  beforeAll(async () => {
    server = await startUiServer();
    browser = await launchChromium();
    context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await context.newPage();
    page.on("request", (req) => requestedUrls.push(req.url()));
    expect(browser.version()).toBe("158.0.8127.18");
  }, 120_000);

  afterAll(async () => {
    await page?.context().close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await server?.stop();
  });

  it("CSS custom flow: validate + preview + matrix + BFS witness + report + download", async () => {
    await page.goto(server.url, { waitUntil: "networkidle" });
    await expectText(page, "#health-status", "API ok", 10_000);
    await expectText(page, "#seed-text", SEED);

    await switchToCustomMode();
    await setCustomFields(DEMO_HTML, DEMO_TARGET);
    await setCssLocator("button.primary", "");
    await page.locator("#custom-validate").click();
    await expectText(page, "#custom-validate-result", "自定义场景校验通过", 10_000);
    await page.locator("#loc-preview").click();
    await expectText(page, "#loc-preview-result", "匹配 1 个元素", 10_000);
    await expectText(page, "#loc-preview-result", "是否命中同一元素", 10_000);
    await expectText(
      page,
      "#loc-preview-result",
      "目标描述 target.css 在自定义 HTML 上匹配 1 个元素",
      10_000,
    );

    // Matrix: baseline STABLE, M03 MISSING, M04/M07 AMBIGUOUS.
    await runCustomAnalysis();
    await expectText(page, '.matrix-cell[data-mutation="M03"] .cell-verdict', "MISSING", 30_000);
    await expectText(page, '.matrix-cell[data-mutation="M04"] .cell-verdict', "AMBIGUOUS", 30_000);
    await expectText(page, '.matrix-cell[data-mutation="M07"] .cell-verdict', "AMBIGUOUS", 30_000);
    await expectText(page, '.matrix-cell[data-mutation="M01"] .cell-verdict', "STABLE", 30_000);
    await expectText(page, '.matrix-cell[data-mutation="M08"] .cell-verdict', "STABLE", 30_000);

    // BFS witness at depth 1: shortest witness is [M03] MISSING.
    await page.locator('[data-view="witness"]').click();
    await page.locator("#bfs-depth").fill("1");
    await page.locator("#run-bfs").click();
    await expectText(page, "#witness-summary", "FOUND", 60_000);
    await expectText(page, "#witness-summary", "M03", 10_000);
    await expectText(page, "#witness-summary", "MISSING", 10_000);
    await expectCount(page, "#witness-steps table", 1, 30_000);

    // Report: 5/8 STABLE -> 62.5, counts MISSING 1 / AMBIGUOUS 2.
    await page.locator('[data-view="report"]').click();
    await expectText(page, "#report-score", "62.5", 10_000);
    await expectText(page, "#report-score", "5/8", 10_000);
    await expectText(page, "#report-counts", "AMBIGUOUS 2", 10_000);
    await expectText(page, "#report-counts", "MISSING 1", 10_000);

    // Download: custom filename, source custom, witness matches backend.
    const tmpDir = mkdtempSync(join(tmpdir(), "locatorstress-fix-r1-01-e2e-"));
    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await page.locator("#download-json").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("P022-CUSTOM-001-analysis.json");
    const downloadPath = join(tmpDir, download.suggestedFilename());
    await download.saveAs(downloadPath);
    const exported = JSON.parse(readFileSync(downloadPath, "utf8")) as {
      fixtureId: string;
      analysis: {
        source: string;
        fixtureId: string;
        baseline: { verdict: string };
        cases: Array<{ mutationId: string; verdict: string }>;
      };
      witness: { status: string; witness: { sequence: string[] } | null };
    };
    expect(exported.fixtureId).toBe("P022-CUSTOM-001");
    expect(exported.analysis.source).toBe("custom");
    expect(exported.analysis.baseline.verdict).toBe("STABLE");
    expect(exported.analysis.cases.find((c) => c.mutationId === "M03")?.verdict).toBe(
      "MISSING",
    );
    expect(exported.witness.status).toBe("FOUND");
    expect(exported.witness.witness?.sequence).toEqual(["M03"]);

    // FIX-R1-02 HTML download: same custom analysis, standalone
    // offline HTML (same payload as the JSON download, rendered
    // server-side via POST /ui/export-html).
    const htmlDownloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await page.locator("#download-html").click();
    const htmlDownload = await htmlDownloadPromise;
    expect(htmlDownload.suggestedFilename()).toBe("P022-CUSTOM-001-analysis.html");
    const htmlPath = join(tmpDir, htmlDownload.suggestedFilename());
    await htmlDownload.saveAs(htmlPath);
    const htmlText = readFileSync(htmlPath, "utf8");
    expect(htmlText.startsWith("<!doctype html>")).toBe(true);
    expect(htmlText).toContain("P022-CUSTOM-001");
    expect(htmlText).toContain("MISSING");
    expect(htmlText).toContain("AMBIGUOUS");
    expect(htmlText).toContain("62.5");
    expect(scanExternalResources(htmlText)).toEqual([]);
    const htmlEmbedded = parseEmbeddedReportJson(htmlText) as {
      fixtureId: string;
      analysis: { source: string };
      witness: { status: string; witness: { sequence: string[] } | null };
    };
    expect(htmlEmbedded.fixtureId).toBe("P022-CUSTOM-001");
    expect(htmlEmbedded.analysis.source).toBe("custom");
    expect(htmlEmbedded.witness.status).toBe("FOUND");
    expect(htmlEmbedded.witness.witness?.sequence).toEqual(["M03"]);
    // And the embedded JSON is exactly the JSON download's payload.
    expect(htmlEmbedded).toEqual(exported);
  }, 240_000);

  it("XPath custom flow: M03 MISSING, M04 AMBIGUOUS", async () => {
    await switchToCustomMode();
    await setCustomFields(DEMO_HTML, DEMO_TARGET);
    await page.locator("#loc-kind").selectOption("xpath");
    await page.locator("#loc-selector").fill("//button[@class='primary']");
    await page.locator("#loc-index").fill("");
    await runCustomAnalysis();
    await expectText(page, '.matrix-cell[data-mutation="M03"] .cell-verdict', "MISSING", 30_000);
    await expectText(page, '.matrix-cell[data-mutation="M04"] .cell-verdict', "AMBIGUOUS", 30_000);
    await expectText(page, '.matrix-cell[data-mutation="M01"] .cell-verdict', "STABLE", 30_000);
  }, 180_000);

  it("role custom flow: M08 MISSING, M04 AMBIGUOUS", async () => {
    await switchToCustomMode();
    await setCustomFields(DEMO_HTML, DEMO_TARGET);
    await page.locator("#loc-kind").selectOption("role");
    await page.locator("#loc-role").fill("button");
    await page.locator("#loc-name").fill("Save");
    await page.locator("#loc-index").fill("");
    await runCustomAnalysis();
    await expectText(page, '.matrix-cell[data-mutation="M08"] .cell-verdict', "MISSING", 30_000);
    await expectText(page, '.matrix-cell[data-mutation="M04"] .cell-verdict', "AMBIGUOUS", 30_000);
    await expectText(page, '.matrix-cell[data-mutation="M01"] .cell-verdict', "STABLE", 30_000);
  }, 180_000);

  it("WRONG_TARGET custom flow: single button + index 0, M04 decoy steals nth(0)", async () => {
    await switchToCustomMode();
    await setCustomFields(
      '<main><button class="only">Click me</button></main>',
      "main > button.only",
    );
    await setCssLocator("button", "0");
    await runCustomAnalysis();
    await expectText(page, '.matrix-cell[data-mutation="M04"] .cell-verdict', "WRONG_TARGET", 30_000);
    await page.locator('.matrix-cell[data-mutation="M04"]').click();
    await expectText(page, "#case-detail", "不是原目标", 30_000);

    // MISSING baseline: a locator that matches nothing on the page.
    await page.locator('[data-view="locator"]').click();
    await page.locator("#loc-selector").fill("button.gone");
    await page.locator("#loc-index").fill("");
    await page.locator('[data-view="matrix"]').click();
    await page.locator("#run-analysis").click();
    await expectText(page, '.matrix-cell[data-mutation="baseline"] .cell-verdict', "MISSING", 60_000);
  }, 240_000);

  it("ambiguous target fails closed in the UI and the server stays alive", async () => {
    await switchToCustomMode();
    await setCustomFields(DEMO_HTML, "button");
    await setCssLocator("button.primary", "");
    await page.locator('[data-view="matrix"]').click();
    await page.locator("#run-analysis").click();
    await expectText(page, "#run-status", "CUSTOM_TARGET_AMBIGUOUS", 60_000);
    const health = await fetch(`${server.url}/api/health`);
    expect(health.status).toBe(200);
    // Restore a resolving target: analysis works again.
    await page.locator('[data-view="locator"]').click();
    await page.locator("#custom-target-css").fill(DEMO_TARGET);
    await runCustomAnalysis();
    await expectText(page, '.matrix-cell[data-mutation="M04"] .cell-verdict', "AMBIGUOUS", 30_000);
  }, 180_000);

  it("every request in the custom E2E session stayed on loopback (zero external)", async () => {
    expect(requestedUrls.length).toBeGreaterThan(0);
    const external = requestedUrls.filter((u) => isExternalUrl(u));
    expect(external).toEqual([]);
    expect(requestedUrls.some((u) => u.endsWith("/app.js"))).toBe(true);
    expect(requestedUrls.some((u) => u.includes("/api/health"))).toBe(true);
    writeFileSync(
      join(repoRoot(), "evidence", "s4", "T012_CUSTOM_E2E_REQUESTS.json"),
      JSON.stringify(
        { totalRequests: requestedUrls.length, externalRequests: 0, urls: requestedUrls },
        null,
        2,
      ),
    );
  }, 30_000);
});
