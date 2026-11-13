// T012 offline — the product must make zero external network requests,
// in the UI session, in the exported HTML report, and when the page
// itself tries to reach the outside world.
//
// Coverage:
//   1. Static scan: UI sources + exported HTML template contain no
//      non-loopback http(s) URL (no CDN, font, analytics, or tracker).
//   2. Live UI session: every request recorded across goto + analyze
//      stays on loopback.
//   3. Exported HTML report opened over file:// inside an offline
//      browser context: zero non-file requests, zero dialogs, zero
//      executable scripts, payload shown as text only.
//   4. Hostile page: an <img> and a fetch() to https://example.invalid
//      are both intercepted and aborted by the runner's route handler;
//      the counters prove the interception fired (positive check, not
//      "nothing happened"), and the page keeps working afterwards.
//   5. Server binding: the API server refuses a non-loopback host.
//   6. API export boundary (FIX-R1-02): HTML export via /api/export
//      serves the full report as standalone offline HTML (200,
//      text/html, zero external references); an invalid report is 422.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";
import type { Browser, Page } from "playwright";

import { canonicalJson } from "../../src/canonical/canonical-json.js";
import { buildAnalysisReport } from "../../src/analysis/witness.js";
import { scanExternalResources } from "../../src/export/html-escape.js";
import { exportReportHtml, writeReportHtml } from "../../src/export/html-export.js";
import { startAnalysisServer } from "../../src/api/server.js";
import type { AnalysisService } from "../../src/api/service.js";
import { launchTestBrowser, repoRoot } from "../integration/s0-helpers.js";
import { payloadReportInput } from "../export/t010-helpers.js";
import {
  isExternalUrl,
  startUiServer,
  launchChromium,
  expectText,
  type UiServerHandle,
} from "./e2e-helpers.js";

let browser: Browser;

beforeAll(async () => {
  browser = await launchChromium();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

describe("T012 offline (real Chromium)", () => {
  it("static scan: UI sources and the HTML export template contain no external URL", () => {
    const files = [
      "src/ui/index.html",
      "src/ui/app.js",
      "src/ui/styles.css",
      "src/export/templates/report.html.ts",
      "src/export/html-export.ts",
    ];
    const externalUrlRe = /https?:\/\/(?!127\.0\.0\.1|localhost|::1)/g;
    for (const rel of files) {
      const text = readFileSync(join(repoRoot(), rel), "utf8");
      const hits = text.match(externalUrlRe) ?? [];
      expect(hits, `${rel} must not reference an external URL`).toEqual([]);
    }
    // The exported HTML of a real report also passes the static scan.
    const report = buildAnalysisReport(payloadReportInput());
    const html = exportReportHtml(report);
    expect(scanExternalResources(html)).toEqual([]);
    expect(html).not.toMatch(/src="https?:/);
    expect(html).not.toMatch(/href="https?:/);
  });

  it("live UI session: goto + analyze makes zero external requests", async () => {
    const server: UiServerHandle = await startUiServer();
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page: Page = await context.newPage();
    const urls: string[] = [];
    page.on("request", (req) => urls.push(req.url()));
    try {
      await page.goto(server.url, { waitUntil: "networkidle" });
      await expectText(page, "#health-status", "API ok", 10_000);
      await page.locator('#fixture-rows tr[data-fixture-id="F002"]').click();
      await expectText(page, "#selected-fixture", "F002");
      await page.locator('[data-view="matrix"]').click();
      await page.locator("#run-analysis").click();
      await expectText(page, '.matrix-cell[data-mutation="M01"] .cell-verdict', "WRONG_TARGET", 60_000);
      // Direct API traffic from the test itself is also loopback.
      const res = await fetch(`${server.url}/api/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fixtureId: "F002" }),
      });
      expect(res.status).toBe(200);
      expect(urls.length).toBeGreaterThan(0);
      const external = urls.filter((u) => isExternalUrl(u));
      expect(external).toEqual([]);
      expect(urls.every((u) => u.startsWith("http://127.0.0.1"))).toBe(true);
    } finally {
      await context.close();
      await server.stop();
    }
  }, 120_000);

  it("exported HTML report opens offline over file:// with zero non-file requests", async () => {
    const report = buildAnalysisReport(payloadReportInput());
    const canonical = canonicalJson(report);
    const htmlText = exportReportHtml(report);
    const tmpDir = mkdtempSync(join(tmpdir(), "locatorstress-t012-offline-"));
    const htmlPath = join(tmpDir, "payload-report.html");
    writeReportHtml(htmlPath, report);
    const requestedUrls: string[] = [];
    const dialogs: string[] = [];
    try {
      const context = await browser.newContext({ offline: true });
      const page: Page = await context.newPage();
      page.on("request", (req) => requestedUrls.push(req.url()));
      page.on("dialog", (d) => dialogs.push(`${d.type()}: ${d.message()}`));
      try {
        await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load", timeout: 30_000 });
        await page.waitForTimeout(500);
        const external = requestedUrls.filter((u) => !u.startsWith("file:"));
        expect(external).toEqual([]);
        expect(dialogs).toEqual([]);
        const dom = await page.evaluate(() => ({
          scripts: [...document.querySelectorAll("script")].map((s) => s.getAttribute("type")),
          resourceTags: document.querySelectorAll(
            "img,iframe,link,video,audio,embed,object,source,track",
          ).length,
          handlerAttrs: [...document.querySelectorAll("*")].flatMap((el) =>
            [...el.attributes].filter((a) => a.name.startsWith("on")).map((a) => a.name),
          ),
          bodyText: document.body.innerText,
          embeddedJson: document.getElementById("report-json")?.textContent ?? "",
          title: document.title,
        }));
        expect(dom.scripts).toEqual(["application/json"]);
        expect(dom.resourceTags).toBe(0);
        expect(dom.handlerAttrs).toEqual([]);
        expect(dom.bodyText).toContain("<script>alert(1)</script>");
        expect(JSON.parse(dom.embeddedJson)).toEqual(JSON.parse(canonical));
        expect(dom.title).toContain("LocatorStress report");
      } finally {
        await context.close();
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    expect(scanExternalResources(htmlText)).toEqual([]);
  }, 60_000);

  it("hostile page: external img + fetch are intercepted and aborted, page keeps working", async () => {
    const handle = await launchTestBrowser();
    try {
      const page = handle.page;
      await page.setContent(
        `<main><button class="primary">Target</button>` +
          `<img src="https://example.invalid/x.png" alt="">` +
          `</main>`,
      );
      const fetchOutcome = await page.evaluate(async () => {
        try {
          await fetch("https://example.invalid/");
          return "unexpected-success";
        } catch (err) {
          return `failed:${err instanceof Error ? err.name : String(err)}`;
        }
      });
      expect(fetchOutcome.startsWith("failed:")).toBe(true);
      await page.waitForTimeout(300);
      // Positive interception check: both external attempts were seen
      // AND blocked by the route handler (not silently absent).
      expect(handle.externalRequestCount()).toBeGreaterThanOrEqual(2);
      expect(handle.blockedRequestCount()).toBe(handle.externalRequestCount());
      // The page itself is unaffected by the aborted requests.
      expect(await page.evaluate(() => document.querySelector("button.primary")?.textContent)).toBe(
        "Target",
      );
      expect(await page.evaluate(() => 1 + 1)).toBe(2);
    } finally {
      await handle.close();
    }
  }, 60_000);

  it("API server refuses a non-loopback bind host", async () => {
    // startAnalysisServer(service, options): the service is the first
    // argument — passing the options object as the service silently
    // defaults the host to loopback, so use a minimal fake service.
    const fakeService: AnalysisService = {
      health: () => ({
        status: "ok",
        service: "locatorstress",
        version: "0.1.0",
        seed: "P022-LOCATORSTRESS-S0-2026-11-10",
        bfsLimits: { maxDepth: 6, maxExpandedStates: 4096 },
        mutationOrder: ["M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08"],
      }),
      listFixtures: () => [],
      listMutations: () => [],
      validate: () => ({ valid: true, errors: [] }),
      analyze: async () => {
        throw new Error("not used in offline tests");
      },
      search: async () => {
        throw new Error("not used in offline tests");
      },
    };
    await expect(
      startAnalysisServer(fakeService, { host: "0.0.0.0", port: 0 }),
    ).rejects.toThrow(/loopback/);
    await expect(
      startAnalysisServer(fakeService, { host: "192.168.1.1", port: 0 }),
    ).rejects.toThrow(/loopback/);
    // And the loopback bind itself still works.
    const running = await startAnalysisServer(fakeService, { host: "127.0.0.1", port: 0 });
    try {
      expect(running.host).toBe("127.0.0.1");
      expect(running.port).toBeGreaterThan(0);
    } finally {
      await running.close();
    }
  });

  it("FIX-R1-02: API export serves a full report as standalone HTML via the UI proxy", async () => {
    const server: UiServerHandle = await startUiServer();
    try {
      const report = JSON.parse(
        readFileSync(join(repoRoot(), "evidence", "s2", "T008_API_REPORT.json"), "utf-8"),
      ) as { hashes: Record<string, string> };
      const res = await fetch(`${server.url}/api/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html", report }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const html = await res.text();
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(html).toContain(report.hashes["gate_sha256"] as string);
      expect(html).toContain("WRONG_TARGET");
      // Offline: zero external-resource references in the served HTML.
      expect(scanExternalResources(html)).toEqual([]);
      expect(html).not.toContain("https://");
      // And an invalid report is still rejected through the proxy.
      const bad = await fetch(`${server.url}/api/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html", report: {} }),
      });
      expect(bad.status).toBe(422);
      const badBody = (await bad.json()) as { error?: { code?: string } };
      expect(badBody.error?.code).toBe("INVALID_REPORT");
    } finally {
      await server.stop();
    }
  }, 60_000);
});
