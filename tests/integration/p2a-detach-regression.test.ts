// P2-A regression — detach the frame holding the resolved target AFTER capture and
// BEFORE identity comparison, and verify runBaselineOracle returns executionStatus
// ERROR via its isSameElement catch branch. The original target is captured in the
// MAIN frame (string private path), while the spec resolves inside the iframe;
// detaching the iframe destroys the resolved handle's execution context, so the
// compare evaluate throws ("Frame has been detached" / "Cannot find context").
//
// Deterministic interleaving (a blind Node-side delay sweep cannot hit the
// ~1-round-trip window between resolveLocator's elementHandle and the compare
// evaluate: 26 blind attempts all returned COMPLETED): each attempt blocks the
// page main thread for 200 ms with a busy-loop evaluate. CDP commands sent while
// blocked queue in arrival order, so a second evaluate that waits `delay` ms in
// the page and then removes the iframe is anchored to the end of the blocker,
// i.e. to the start of the oracle's post-block round trips. Sweeping `delay`
// across the oracle's post-block duration lands the removal between
// elementHandle and the compare evaluate. Delays that land between the locator
// count and elementHandle instead make elementHandle wait out its 30 s
// timeout; those attempts are abandoned after 4 s on a fresh context so the
// pending wait dies with the context instead of stalling the suite.
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import type { BaselineBrowser } from "../../src/runner/browser.js";
import type { LocatorSpecV1 } from "../../src/contracts/locator.js";
import { runBaselineOracle } from "../../src/oracle/oracle-runner.js";
import { launchTestBrowser } from "./s0-helpers.js";

const HTML =
  `<main><button class="primary">Main target</button><iframe srcdoc="<button class='primary'>InFrame</button>"></iframe></main>`;

const SPEC: LocatorSpecV1 = {
  kind: "css",
  selector: "button.primary",
  framePath: ["iframe"],
};

const PRIVATE_PATH = "main > button:nth-child(1)";

// Delays (ms) for the in-page removal timer, swept across the oracle's
// post-block duration. ERROR was observed at 42-56 ms and 70 ms in probing;
// the band shifts a few ms per run with CDP round-trip jitter, so sweep in
// 2 ms steps and retry up to 5 passes. T012 widened the window from
// 38-80 ms to 30-120 ms after the test flaked once in four full runs
// (485/486): a narrow window misses the ~1-round-trip gap between
// elementHandle and the compare evaluate when CDP latency drifts.
// The sweep still stops at the first ERROR, so the common case costs
// no extra time; only a miss pays for the wider window.
const DELAYS_MS = [
  30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60, 62, 64,
  66, 68, 70, 72, 74, 76, 78, 80, 82, 84, 86, 88, 90, 92, 94, 96, 98, 100,
  102, 104, 106, 108, 110, 112, 114, 116, 118, 120,
];
const ATTEMPT_GUARD_MS = 4000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("P2-A detach regression", () => {
  let browserHandle: BaselineBrowser;

  beforeAll(async () => {
    browserHandle = await launchTestBrowser();
  });

  afterAll(async () => {
    await browserHandle.close();
  });

  it(
    "baseline sanity: iframe target resolves, identity is false",
    async () => {
      const page = browserHandle.page;
      await page.setContent(HTML);
      const r = await runBaselineOracle(page, SPEC, PRIVATE_PATH);
      expect(r.resolverResult.executionStatus).toBe("COMPLETED");
      expect(r.resolverResult.finalMatchCount).toBe(1);
      expect(r.identityMatch).toBe(false);
      expect(r.originalCaptured).toBe(true);
    },
    60000,
  );

  it(
    "detaching the target frame mid-oracle yields executionStatus ERROR",
    async () => {
      const attempts: string[] = [];
      let errorSeen = false;
      let errorDetail = "";

      for (let pass = 0; pass < 5 && !errorSeen; pass += 1) {
        for (const delayMs of DELAYS_MS) {
          const context = await browserHandle.browser.newContext();
          const page = await context.newPage();
          try {
            await page.setContent(HTML);
            const blocker = page.evaluate(() => {
              const end = Date.now() + 200;
              while (Date.now() < end) {
                // Busy-wait anchor only; see the file header comment.
              }
            });
            const oraclePromise = runBaselineOracle(page, SPEC, PRIVATE_PATH);
            await page.evaluate(async (d: number) => {
              await new Promise((resolve) => {
                setTimeout(resolve, d);
              });
              document.querySelector("iframe")?.remove();
            }, delayMs);
            await blocker;
            const outcome = await Promise.race([
              oraclePromise,
              sleep(ATTEMPT_GUARD_MS).then(() => "GUARD_TIMEOUT" as const),
            ]);
            if (outcome === "GUARD_TIMEOUT") {
              attempts.push(`${delayMs}ms:ABANDONED_AFTER_${ATTEMPT_GUARD_MS}ms`);
              continue;
            }
            attempts.push(
              `${delayMs}ms:${outcome.resolverResult.executionStatus}` +
                `/final=${outcome.resolverResult.finalMatchCount}` +
                `/identity=${String(outcome.identityMatch)}`,
            );
            if (outcome.resolverResult.executionStatus === "ERROR") {
              expect(outcome.resolverResult.finalMatchCount).toBe(1);
              expect(outcome.identityMatch).toBeNull();
              expect(outcome.originalCaptured).toBe(true);
              errorDetail = outcome.resolverResult.errorMessage ?? "";
              errorSeen = true;
              break;
            }
          } finally {
            await context.close();
          }
        }
      }

      expect(
        errorSeen,
        `no ERROR observed (compare-branch error: ${errorDetail}); attempts=${attempts.join(",")}`,
      ).toBe(true);
    },
    180000,
  );
});
