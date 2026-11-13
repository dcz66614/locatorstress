import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
export interface BaselineBrowser {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  externalRequestCount(): number;
  blockedRequestCount(): number;
  close(): Promise<void>;
}

export interface LaunchBaselineBrowserOptions {
  executablePath?: string;
}

function isLoopbackUrl(url: string): boolean {
  if (url.startsWith("about:")) {
    return true;
  }
  if (url.startsWith("data:")) {
    return true;
  }
  if (url.startsWith("blob:")) {
    return true;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const protocol = parsed.protocol;
  if (protocol !== "http:" && protocol !== "https:") {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  return (
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "[::1]" ||
    host === "::1"
  );
}

export async function launchBaselineBrowser(
  options: LaunchBaselineBrowserOptions,
): Promise<BaselineBrowser> {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    ...(options.executablePath !== undefined
      ? { executablePath: options.executablePath }
      : {}),
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  let externalCount = 0;
  let blockedCount = 0;

  // Route handler must be registered before any navigation/setContent.
  await page.route("**/*", async (route) => {
    const url = route.request().url();

    if (isLoopbackUrl(url)) {
      await route.continue();
      return;
    }

    externalCount += 1;
    blockedCount += 1;
    await route.abort();
  });

  return {
    browser,
    context,
    page,
    externalRequestCount(): number {
      return externalCount;
    },
    blockedRequestCount(): number {
      return blockedCount;
    },
    async close(): Promise<void> {
      await browser.close();
    },
  };
}

export function browserVersion(browser: Browser): string {
  return browser.version();
}

/**
 * FIX-R2-01 — execution-layer defence for user-supplied HTML
 * (P022-R2-P1-01, PROJECT_BOOK §13): run `work` with page
 * JavaScript disabled, then restore it.
 *
 * Why per-page, and why not `javaScriptEnabled: false` on the
 * context: the lab's own page JavaScript is NOT all CDP-driven.
 * The T001 oracle probe (scripts/s0-locator-oracle.mjs) runs page
 * timers and image load/error listeners inside page.evaluate; with
 * page JavaScript disabled those never settle and the probe hangs
 * forever (verified live: setTimeout and img error events time out,
 * while sync evaluate / fetch / locators keep working). A blanket
 * `javaScriptEnabled: false` on the shared context therefore breaks
 * frozen verification machinery, so the general runner context stays
 * JavaScript-enabled and the defence is scoped to exactly the pages
 * and moments that handle user-supplied HTML (the custom branches
 * of the AnalysisService and the snapshotter's snapshotCustom).
 *
 * Mechanism: CDP `Emulation.setScriptExecutionDisabled` on a
 * session attached to THIS page only — other pages in the same
 * context are unaffected, and the lab's own synchronous CDP
 * `page.evaluate` calls (mutations, Oracle, resolvers) keep working
 * while the toggle is on, because they run through CDP, not through
 * the page's script engine. The session MUST stay attached for the
 * whole of `work`: detaching reverts the setting (verified live —
 * a detached session lets `<script/>` execute). Restoration runs in
 * a finally, so a throwing run can never leave the page disabled.
 * Do not nest calls on the same page.
 */
export async function withPageJavaScriptDisabled<T>(
  page: Page,
  work: () => Promise<T>,
): Promise<T> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Emulation.setScriptExecutionDisabled", {
      value: true,
    });
    return await work();
  } finally {
    try {
      await session.send("Emulation.setScriptExecutionDisabled", {
        value: false,
      });
    } catch {
      // The page may be closing; restoration is best-effort here.
    }
    await session.detach().catch(() => undefined);
  }
}
