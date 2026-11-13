// T009 UI E2E — real Chromium against the real UI server.
//
// Flow under test (PROJECT_BOOK §7.1 user flow):
//   Fixture Lab select F002 -> Locator edit validate/preview ->
//   Mutation Lab M01 DOM diff -> Verdict Matrix analyze (backend
//   verdicts) -> BFS Witness depth 1 (FOUND [M01]) -> Report (server
//   score 37.5 + backend hashes) -> keyboard-only run -> no external
//   requests -> narrow viewport.
// The test spawns `node dist/ui/server.js --port 0` itself and kills it
// afterwards. Screenshots go to evidence/s3/screenshots/.
//
// NOTE: this project uses vitest's `expect`, not @playwright/test, so
// Playwright's toContainText/toHaveCount matchers are unavailable.
// Assertions below use vitest `expect.poll` over locator reads instead.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";
import type { Browser, Page } from "playwright";

import { scanExternalResources } from "../../src/export/html-escape.js";
import { parseEmbeddedReportJson } from "../../src/export/html-export.js";
import { repoRoot, resolveChromiumExecutable } from "../integration/s0-helpers.js";

const SCREENSHOT_DIR = join(repoRoot(), "evidence", "s3", "screenshots");
const T008_GATE_SHA256 = "5e9707f7b0daf1c87801048554557234c62d8f333a82fc5f5ebc5043d2096634";
const S0_GATE_SHA256 = "651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52";

let child: ChildProcess;
let uiUrl = "";
let browser: Browser;
let page: Page;
let requestedUrls: string[] = [];

async function waitForUiUrl(proc: ChildProcess): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    let buffer = "";
    const timer = setTimeout(() => {
      rejectPromise(new Error(`UI server did not print UI_URL within 60s; output so far: ${buffer}`));
    }, 60_000);
    proc.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      const match = /UI_URL=(http:\/\/127\.0\.0\.1:\d+)/.exec(buffer);
      if (match) {
        clearTimeout(timer);
        resolvePromise(match[1]!);
      }
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      rejectPromise(err);
    });
  });
}

/** Poll until the element's text contains `text`. */
async function expectText(selector: string, text: string, timeout = 30_000): Promise<void> {
  await expect
    .poll(async () => (await page.locator(selector).textContent()) ?? "", { timeout })
    .toContain(text);
}

/** Poll until the locator matches exactly `n` elements. */
async function expectCount(selector: string, n: number, timeout = 30_000): Promise<void> {
  await expect.poll(() => page.locator(selector).count(), { timeout }).toBe(n);
}

/** Poll until the element is visible. */
async function expectVisible(selector: string, timeout = 10_000): Promise<void> {
  await expect.poll(() => page.locator(selector).isVisible(), { timeout }).toBe(true);
}

/** Press Tab until the focused element's text includes `label` (or fail). */
async function tabTo(label: string, maxTabs = 80): Promise<void> {
  for (let i = 0; i < maxTabs; i += 1) {
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? (el.innerText || el.textContent || "") : "";
    });
    if (focused.includes(label)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`could not reach ${JSON.stringify(label)} by Tab within ${maxTabs} presses`);
}

describe("T009 UI end-to-end (real Chromium)", () => {
  beforeAll(async () => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const serverLog = createWriteStream("/tmp/ui-e2e-server.log", { flags: "w" });
    child = spawn("node", [join(repoRoot(), "dist", "ui", "server.js"), "--port", "0"], {
      cwd: repoRoot(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.pipe(serverLog);
    child.stderr?.pipe(serverLog);
    child.on("exit", (code, signal) => {
      serverLog.write(`\n[test] UI server exited code=${String(code)} signal=${String(signal)} at ${new Date().toISOString()}\n`);
    });
    uiUrl = await waitForUiUrl(child);
    browser = await chromium.launch({
      headless: true,
      executablePath: resolveChromiumExecutable(),
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await context.newPage();
    page.on("request", (req) => requestedUrls.push(req.url()));
  }, 120_000);

  afterAll(async () => {
    await page?.context().close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    if (child && !child.killed) {
      child.kill("SIGTERM");
      await new Promise<void>((done) => {
        child.on("exit", () => done());
        setTimeout(done, 5_000);
      });
    }
  });

  it("loads the UI, shows health + 24 fixtures, and selects F002", async () => {
    await page.goto(uiUrl, { waitUntil: "networkidle" });
    await expectText("#health-status", "API ok", 10_000);
    await expectText("#seed-text", "P022-LOCATORSTRESS-S0-2026-11-10");
    await expectCount("#fixture-rows tr", 24);
    for (const view of ["Fixture Lab", "Locator 编辑", "Mutation Lab", "Verdict Matrix", "BFS Witness", "Report"]) {
      await expectVisible(`.tabs button:has-text("${view}")`);
    }
    await page.locator('#fixture-rows tr[data-fixture-id="F002"]').click();
    await expectText("#selected-fixture", "F002");
    await expectText("#selected-fixture", "xpath");
  }, 60_000);

  it("locator edit validates the frozen locator and previews its match", async () => {
    await page.locator('[data-view="locator"]').click();
    await expectText("#loc-fixture-note", "F002");
    await expect
      .poll(() => page.locator("#loc-selector").inputValue(), { timeout: 10_000 })
      .toBe("/html/body/main/form/button[1]");
    await page.locator("#loc-validate").click();
    await expectText("#loc-validate-result", "校验通过", 10_000);
    await page.locator("#loc-preview").click();
    await expectText("#loc-preview-result", "匹配 1 个元素", 10_000);
    await expectText("#loc-preview-result", "是否命中同一元素：是");
  }, 60_000);

  it("invalid draft is stopped by the format guard and the server stays alive", async () => {
    // Regression test for the frozen T008 /api/validate crash: an
    // invalid draft must never be sent, and the server must survive.
    await page.locator("#loc-selector").fill("");
    await page.locator("#loc-validate").click();
    await expectText("#loc-validate-result", "格式检查未通过", 10_000);
    await expectText("#loc-validate-result", "selector must be a non-empty string");
    const health = await fetch(`${uiUrl}/api/health`);
    expect(health.status).toBe(200);
    const healthBody = (await health.json()) as { status: string };
    expect(healthBody.status).toBe("ok");
    // Restore the frozen locator so later tests start from a valid draft.
    await page.locator("#loc-reset").click();
    await expect
      .poll(() => page.locator("#loc-selector").inputValue(), { timeout: 10_000 })
      .toBe("/html/body/main/form/button[1]");
  }, 60_000);

  it("mutation lab shows a real DOM diff for M01 (wrap div appears)", async () => {
    await page.locator('[data-view="mutations"]').click();
    await page.locator('.mutation-list button[data-mutation="M01"]').click();
    await expect.poll(() => page.locator("#diff-view tr.diff-add").count(), { timeout: 30_000 }).toBeGreaterThan(0);
    await expectText("#diff-view", 'class="wrap"');
    await expectText("#diff-summary", "新增");
  }, 60_000);

  it("matrix flow: analyze F002 shows backend verdicts (M01 WRONG_TARGET)", async () => {
    await page.locator('[data-view="matrix"]').click();
    await page.locator("#run-analysis").click();
    await expectText('.matrix-cell[data-mutation="M01"] .cell-verdict', "WRONG_TARGET", 60_000);
    await expectText('.matrix-cell[data-mutation="baseline"] .cell-verdict', "STABLE");
    await expectText('.matrix-cell[data-mutation="M03"] .cell-verdict', "STABLE");
    await page.locator('.matrix-cell[data-mutation="M01"]').click();
    await expectText("#case-detail", "不是原目标", 30_000);
    await expectText("#case-detail", "matchCount");
    await expectText("#case-detail", "DOM diff");
    await page.screenshot({ path: join(SCREENSHOT_DIR, "matrix-F002.png") });
  }, 120_000);

  it("witness flow: BFS depth 1 finds [M01] with a per-step DOM diff", async () => {
    await page.locator('[data-view="witness"]').click();
    await page.locator("#bfs-depth").fill("1");
    await page.locator("#run-bfs").click();
    await expectText("#witness-summary", "FOUND", 60_000);
    await expectText("#witness-summary", "M01");
    await expectText("#witness-summary", "WRONG_TARGET");
    await expectCount("#witness-steps table", 1, 30_000);
    await expectText("#witness-steps", 'class="wrap"');
    await page.screenshot({ path: join(SCREENSHOT_DIR, "witness-F002.png") });
  }, 120_000);

  it("report shows the server-computed score and the backend hashes", async () => {
    await page.locator('[data-view="report"]').click();
    await expectText("#report-score", "37.5", 10_000);
    await expectText("#report-score", "3/8");
    await expectText("#report-coverage", "8/8");
    await expectText("#report-counts", "WRONG_TARGET 5");
    await expectText("#report-hashes", T008_GATE_SHA256, 10_000);
    await expectText("#report-hashes", S0_GATE_SHA256);
    await expectVisible("#download-json");
    await expectVisible("#download-html");
    await expectCount("#report-operator-rows tr", 8);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "report-F002.png") });

    // FIX-R1-02: HTML download for the same fixture analysis — a
    // standalone offline document, not just the JSON download.
    const tmpDir = mkdtempSync(join(tmpdir(), "locatorstress-t009-html-"));
    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await page.locator("#download-html").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("F002-analysis.html");
    const htmlPath = join(tmpDir, download.suggestedFilename());
    await download.saveAs(htmlPath);
    const htmlText = readFileSync(htmlPath, "utf8");
    expect(htmlText.startsWith("<!doctype html>")).toBe(true);
    expect(htmlText).toContain("F002");
    expect(htmlText).toContain("WRONG_TARGET");
    expect(htmlText).toContain("37.5");
    expect(scanExternalResources(htmlText)).toEqual([]);
    const embedded = parseEmbeddedReportJson(htmlText) as {
      fixtureId: string;
      analysis: { source: string; cases: Array<{ mutationId: string; verdict: string }> };
      witness: { status: string };
    };
    expect(embedded.fixtureId).toBe("F002");
    expect(embedded.analysis.source).toBe("fixture");
    expect(embedded.analysis.cases.find((c) => c.mutationId === "M01")?.verdict).toBe(
      "WRONG_TARGET",
    );
    expect(embedded.witness.status).toBe("FOUND");
  }, 60_000);

  it("keyboard only: Tab to the Matrix tab, Tab to run-analysis, Enter runs it", async () => {
    await page.goto(uiUrl, { waitUntil: "networkidle" });
    await expectText("#health-status", "API ok", 10_000);
    await page.keyboard.press("Tab");
    await tabTo("Verdict Matrix");
    await page.keyboard.press("Enter");
    await expectVisible("#view-matrix");
    await tabTo("运行分析");
    await page.keyboard.press("Enter");
    // Default fixture is F001 (all STABLE): baseline cell must appear.
    await expectText('.matrix-cell[data-mutation="baseline"] .cell-verdict', "STABLE", 60_000);
  }, 120_000);

  it("offers no locator generation or repair affordance", async () => {
    const badButtons = await page.locator("button").filter({ hasText: /生成|修复|自愈|推荐/ }).count();
    expect(badButtons).toBe(0);
    await expectText("#view-locator", "不提供自动生成、推荐或修复 Locator 的功能");
  }, 30_000);

  it("UI-server endpoints return real data (snapshot, scores, reports)", async () => {
    const snap = await fetch(`${uiUrl}/ui/dom-snapshot`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fixtureId: "F001", sequence: ["M08"] }),
    });
    expect(snap.status).toBe(200);
    const snapBody = (await snap.json()) as { steps: Array<{ html: string }> };
    expect(snapBody.steps).toHaveLength(2);
    expect(snapBody.steps[1]?.html).toContain("Changed Text");

    const analysisRes = await fetch(`${uiUrl}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fixtureId: "F002" }),
    });
    expect(analysisRes.status).toBe(200);
    const analysis = (await analysisRes.json()) as {
      cases: Array<Record<string, unknown>>;
    };
    const scored = await fetch(`${uiUrl}/ui/scores`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cases: analysis.cases }),
    });
    expect(scored.status).toBe(200);
    const scoredBody = (await scored.json()) as {
      scores: { overall: { score: string | null } };
    };
    expect(scoredBody.scores.overall.score).toBe("37.5");

    const reports = await fetch(`${uiUrl}/ui/reports`);
    expect(reports.status).toBe(200);
    const reportsBody = (await reports.json()) as {
      t008: { present: boolean; hashes?: Record<string, string> };
      s0: { present: boolean; gateSha256?: string };
    };
    expect(reportsBody.t008.present).toBe(true);
    expect(reportsBody.t008.hashes?.["gate_sha256"]).toBe(T008_GATE_SHA256);
    expect(reportsBody.s0.gateSha256).toBe(S0_GATE_SHA256);
  }, 120_000);

  it("narrow viewport (390px) has no horizontal overflow", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(uiUrl, { waitUntil: "networkidle" });
    await expectCount("#fixture-rows tr", 24, 10_000);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "narrow-390.png") });
    await page.setViewportSize({ width: 1280, height: 800 });
  }, 60_000);

  it("every request the page made stayed on loopback (zero external)", async () => {
    expect(requestedUrls.length).toBeGreaterThan(0);
    const external = requestedUrls.filter((u) => !u.startsWith("http://127.0.0.1"));
    expect(external).toEqual([]);
  }, 30_000);
});
