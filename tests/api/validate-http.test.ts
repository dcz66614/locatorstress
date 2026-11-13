// FIX-T009 — HTTP-layer regression tests for the POST /api/validate crash.
//
// The frozen T008 API returned `locator: undefined` from validate() whenever
// the top-level locator was invalid or absent, and canonicalJson() throws on
// undefined values after writeHead(200); the outer catch then wrote a second
// header set (ERR_HTTP_HEADERS_SENT), killing the whole API/UI process.
// T008's tests never saw it: server.test.ts used a fake validate() that
// returned no locator key, and routes.test.ts called handleApiRequest
// directly without canonicalJson. These tests use the REAL service
// (createBrowserAnalysisService) behind a REAL startAnalysisServer and REAL
// HTTP fetch calls, exactly how the defect was reproduced.

import { describe, it, expect, beforeAll, afterAll } from "vitest";

import type { BaselineBrowser } from "../../src/runner/browser.js";
import { startAnalysisServer } from "../../src/api/server.js";
import type { RunningApiServer } from "../../src/api/server.js";
import {
  createBrowserAnalysisService,
  type AnalysisService,
} from "../../src/api/service.js";
import { launchTestBrowser } from "../integration/s0-helpers.js";

describe("POST /api/validate over real HTTP (FIX-T009)", () => {
  let browserHandle: BaselineBrowser;
  let service: AnalysisService;
  let running: RunningApiServer;

  beforeAll(async () => {
    browserHandle = await launchTestBrowser();
    service = createBrowserAnalysisService(browserHandle.page);
    running = await startAnalysisServer(service, {
      host: "127.0.0.1",
      port: 0,
    });
  });

  afterAll(async () => {
    await running.close();
    await browserHandle.close();
  });

  async function postValidate(
    payload: unknown,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await fetch(`${running.url}/api/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as Record<string, unknown>;
    return { status: res.status, body };
  }

  async function expectServerAlive(): Promise<void> {
    const health = await fetch(`${running.url}/api/health`);
    expect(health.status).toBe(200);
    const healthBody = (await health.json()) as Record<string, unknown>;
    expect(healthBody["status"]).toBe("ok");
  }

  it("invalid xpath locator returns 200 without a locator key and the server survives", async () => {
    // `exact` / `includeHidden` are not allowed keys for kind xpath, so
    // this locator is invalid — pre-fix this request killed the process.
    const { status, body } = await postValidate({
      locator: {
        kind: "xpath",
        selector: "/html/body/main/form/button[1]",
        exact: false,
        includeHidden: false,
      },
    });
    expect(status).toBe(200);
    expect(body["valid"]).toBe(false);
    expect(Array.isArray(body["errors"])).toBe(true);
    expect((body["errors"] as unknown[]).length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(body, "locator")).toBe(false);
    await expectServerAlive();
  });

  it("scenario-only request returns 200 without a locator key and the server survives", async () => {
    // A fully legal scenario-only request: no top-level locator at all.
    // Pre-fix this also killed the process (validate() returned
    // `locator: undefined` whenever the top level had no valid locator).
    const { status, body } = await postValidate({
      scenario: {
        schema: "locatorstress.scenario/v1",
        seed: "P022-LOCATORSTRESS-S0-2026-11-10",
        html: "<button>x</button>",
        locator: { kind: "css", selector: "button" },
      },
    });
    expect(status).toBe(200);
    expect(body["valid"]).toBe(true);
    expect(body["errors"]).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(body, "locator")).toBe(false);
    await expectServerAlive();
  });

  it("valid locator still returns the normalized locator", async () => {
    const { status, body } = await postValidate({
      locator: { kind: "css", selector: "button" },
    });
    expect(status).toBe(200);
    expect(body["valid"]).toBe(true);
    expect(body["errors"]).toEqual([]);
    const locator = body["locator"] as Record<string, unknown>;
    expect(locator["kind"]).toBe("css");
    expect(locator["selector"]).toBe("button");
    await expectServerAlive();
  });
});
