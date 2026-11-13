// T010 HTML safety tests — REAL Chromium opens the generated HTML
// offline and proves zero external requests and zero script execution.
//
// This is not a string-assertion placeholder: the test launches the
// project's pinned Chromium, opens the exported file over file://
// inside an offline browser context, records every request and every
// dialog, and inspects the live DOM for executable scripts, resource
// tags, event-handler attributes and payload text.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";
import type { Browser, Page } from "playwright";

import { canonicalJson } from "../../src/canonical/canonical-json.js";
import { buildAnalysisReport } from "../../src/analysis/witness.js";
import { scanExternalResources } from "../../src/export/html-escape.js";
import { exportReportHtml, writeReportHtml } from "../../src/export/html-export.js";
import { repoRoot, resolveChromiumExecutable } from "../integration/s0-helpers.js";
import { payloadReportInput } from "./t010-helpers.js";

let browser: Browser;
let tmpDir: string;
let htmlPath: string;
let htmlText: string;
let canonical: string;
let requestedUrls: string[] = [];
let dialogs: string[] = [];

beforeAll(async () => {
  const report = buildAnalysisReport(payloadReportInput());
  canonical = canonicalJson(report);
  htmlText = exportReportHtml(report);
  tmpDir = mkdtempSync(join(tmpdir(), "locatorstress-t010-safety-"));
  htmlPath = join(tmpDir, "payload-report.html");
  writeReportHtml(htmlPath, report);
  browser = await chromium.launch({
    executablePath: resolveChromiumExecutable(),
    args: ["--no-sandbox"],
  });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  if (tmpDir !== undefined) rmSync(tmpDir, { recursive: true, force: true });
});

describe("offline HTML report in a real browser", () => {
  it(
    "opens offline with zero non-file requests, zero dialogs, zero executable scripts",
    async () => {
      const context = await browser.newContext({ offline: true });
      const page: Page = await context.newPage();
      requestedUrls = [];
      dialogs = [];
      page.on("request", (req) => requestedUrls.push(req.url()));
      page.on("dialog", (d) => {
        dialogs.push(`${d.type()}: ${d.message()}`);
      });
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
        // The payload is visible as TEXT in the live page.
        expect(dom.bodyText).toContain("<script>alert(1)</script>");
        expect(dom.bodyText).toContain("javascript:alert(1)");
        // The embedded JSON in the live DOM is the same report.
        expect(JSON.parse(dom.embeddedJson)).toEqual(JSON.parse(canonical));
        expect(dom.title).toContain("LocatorStress report");
      } finally {
        await context.close();
      }
    },
    60_000,
  );

  it("the exported file passes the static external-resource scan", () => {
    expect(scanExternalResources(htmlText)).toEqual([]);
  });

  it("the sample report path used by the evidence generator is inside the repo", () => {
    expect(repoRoot()).toContain("p022-locatorstress");
  });
});
