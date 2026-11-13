// T012 E2E helpers — shared by the T012 suites (main flow, offline,
// performance, stress). Real Chromium only; no mocks, no network.
//
// The UI server is spawned exactly as T009 does (`node
// dist/ui/server.js --port 0`) and killed afterwards. Every request the
// page makes is recorded so the offline suites can assert zero external
// traffic; a URL is external when it is not loopback http(s), file:,
// data:, blob: or about:.

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { join } from "node:path";

import { chromium } from "playwright";
import type { Browser, Page } from "playwright";

import { repoRoot, resolveChromiumExecutable } from "../integration/s0-helpers.js";

export const SEED = "P022-LOCATORSTRESS-S0-2026-11-10";
export const S0_GATE_SHA256 =
  "651c3fd4ec68bcc57404d03484e30d47e2c635c1d190be0892725fce06a62c52";
export const T008_GATE_SHA256 =
  "5e9707f7b0daf1c87801048554557234c62d8f333a82fc5f5ebc5043d2096634";

export function isExternalUrl(url: string): boolean {
  if (
    url.startsWith("file:") ||
    url.startsWith("data:") ||
    url.startsWith("blob:") ||
    url.startsWith("about:")
  ) {
    return false;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
    const host = parsed.hostname.toLowerCase();
    return host !== "127.0.0.1" && host !== "localhost" && host !== "::1" && host !== "[::1]";
  } catch {
    return true;
  }
}

export async function waitForUiUrl(proc: ChildProcess): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    let buffer = "";
    const timer = setTimeout(() => {
      rejectPromise(
        new Error(`UI server did not print UI_URL within 60s; output so far: ${buffer}`),
      );
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

export interface UiServerHandle {
  child: ChildProcess;
  url: string;
  stop(): Promise<void>;
}

/** Spawn the real UI server on an ephemeral loopback port. */
export async function startUiServer(): Promise<UiServerHandle> {
  const child = spawn("node", [join(repoRoot(), "dist", "ui", "server.js"), "--port", "0"], {
    cwd: repoRoot(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const url = await waitForUiUrl(child);
  return {
    child,
    url,
    async stop(): Promise<void> {
      if (!child.killed) {
        child.kill("SIGTERM");
        await new Promise<void>((done) => {
          child.on("exit", () => done());
          setTimeout(done, 5_000);
        });
      }
    },
  };
}

export async function launchChromium(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    executablePath: resolveChromiumExecutable(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
}

/** Poll until the element's text contains `text`. */
export async function expectText(
  page: Page,
  selector: string,
  text: string,
  timeout = 30_000,
): Promise<void> {
  const { expect } = await import("vitest");
  await expect
    .poll(async () => (await page.locator(selector).textContent()) ?? "", { timeout })
    .toContain(text);
}

/** Poll until the locator matches exactly `n` elements. */
export async function expectCount(
  page: Page,
  selector: string,
  n: number,
  timeout = 30_000,
): Promise<void> {
  const { expect } = await import("vitest");
  await expect.poll(() => page.locator(selector).count(), { timeout }).toBe(n);
}

/** Poll until the element is visible. */
export async function expectVisible(
  page: Page,
  selector: string,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import("vitest");
  await expect.poll(() => page.locator(selector).isVisible(), { timeout }).toBe(true);
}

/** Press Tab until the focused element's text includes `label` (or fail).
 *
 * Only real focusable elements count: BODY's innerText contains the whole
 * page, so matching against it would "find" every label without moving
 * focus at all (that bug made the keyboard F003 test select the default
 * F001 instead). Fixture rows match on their data-fixture-id exactly;
 * buttons/inputs match on their visible text. */
export async function tabTo(page: Page, label: string, maxTabs = 100): Promise<void> {
  for (let i = 0; i < maxTabs; i += 1) {
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return "";
      const tag = el.tagName;
      if (tag !== "BUTTON" && tag !== "TR" && tag !== "SELECT" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "A") {
        return "";
      }
      const fid = el.getAttribute("data-fixture-id");
      if (fid) return `fixture:${fid}`;
      return el.innerText || el.textContent || "";
    });
    if (focused === `fixture:${label}` || (focused !== "" && focused.includes(label))) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`could not reach ${JSON.stringify(label)} by Tab within ${maxTabs} presses`);
}

/** Nearest-rank percentile over a non-empty sample (ms). */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) throw new Error("percentile of empty sample");
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank - 1))]!;
}

export function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}
