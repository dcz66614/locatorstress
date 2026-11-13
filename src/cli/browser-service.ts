// FIX-R1-03 — Shared browser + service helper for the CLI commands
// that run real analysis (P022-R1-P1-03).
//
// Every browser-backed command goes through here so they all share
// one lifecycle: launch the frozen baseline browser (local Chromium,
// non-loopback requests aborted), build the frozen browser-backed
// AnalysisService, run the work, close the browser. The CLI never
// re-implements analysis, BFS, Oracle or scoring — it only calls the
// service, exactly like the API server does.
//
// ApiError mapping: the service speaks HTTP codes; the CLI speaks
// error codes on stderr. 400s that carry a specific product code keep
// it (CUSTOM_TARGET_*, CUSTOM_HTML_TOO_LARGE); generic 400s become
// the CLI code that names the failing input.

import type { Page } from "playwright";
import { ApiError } from "../api/service.js";
import type { AnalysisService } from "../api/service.js";
import { createBrowserAnalysisService } from "../api/service.js";
import type { BaselineBrowser } from "../runner/browser.js";
import { launchBaselineBrowser } from "../runner/browser.js";
import { runtimeError } from "./errors.js";
import type { CliError } from "./errors.js";

export interface BrowserServiceHandle {
  browserHandle: BaselineBrowser;
  service: AnalysisService;
  page: Page;
}

/** Launch Chromium + service, run `work`, always close the browser. */
export async function withBrowserService<T>(
  work: (handle: BrowserServiceHandle) => Promise<T>,
): Promise<T> {
  let browserHandle: BaselineBrowser;
  try {
    browserHandle = await launchBaselineBrowser({});
  } catch (err) {
    throw runtimeError(
      "BROWSER_LAUNCH_FAILED",
      `failed to launch local Chromium: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    const service = createBrowserAnalysisService(browserHandle.page);
    return await work({ browserHandle, service, page: browserHandle.page });
  } finally {
    await browserHandle.close();
  }
}

/**
 * Map a service ApiError to the CLI error code that names the failing
 * input. Product codes (target missing/ambiguous, oversized HTML)
 * pass through unchanged so the CLI reports exactly what the API
 * reports; generic 400/404s become CLI input codes.
 */
export function mapApiError(err: unknown): CliError {
  if (err instanceof ApiError) {
    if (
      err.code === "CUSTOM_TARGET_NOT_FOUND" ||
      err.code === "CUSTOM_TARGET_AMBIGUOUS" ||
      err.code === "CUSTOM_HTML_TOO_LARGE"
    ) {
      return runtimeError(err.code, err.message);
    }
    if (err.status === 400 && err.message.includes("invalid custom scenario")) {
      return runtimeError("INVALID_SCENARIO", err.message);
    }
    if (err.status === 400 && err.message.includes("fixtureId must match")) {
      return runtimeError("INVALID_FIXTURE", err.message);
    }
    if (err.status === 404) {
      return runtimeError("UNKNOWN_FIXTURE", err.message);
    }
    if (err.status === 400) {
      return runtimeError("INVALID_REQUEST", err.message);
    }
    return runtimeError(err.code, err.message);
  }
  if (err instanceof Error) {
    return runtimeError("INTERNAL_ERROR", err.message);
  }
  return runtimeError("INTERNAL_ERROR", String(err));
}
