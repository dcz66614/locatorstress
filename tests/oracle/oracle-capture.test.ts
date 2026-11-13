// T011 — Oracle capture + identity comparison boundaries
// (PROJECT_BOOK §5.1; src/oracle/target-capture.ts,
// src/oracle/identity-compare.ts, src/oracle/oracle-runner.ts).
//
// captureOriginalTarget and probeHandleWrapperIdentity previously had
// no direct tests (only indirect coverage through fixtures). These
// tests pin: uniqueness errors (0 / 2 matches), frame-scoped capture,
// the null-handle rule in isSameElement, the wrapper-vs-node identity
// distinction, and the runBaselineOracle happy/invalid paths.

import { describe, it, expect, beforeAll, afterAll } from "vitest";

import type { BaselineBrowser } from "../../src/runner/browser.js";
import {
  captureOriginalTarget,
  captureOriginalTargetFromLocator,
} from "../../src/oracle/target-capture.js";
import { isSameElement, probeHandleWrapperIdentity } from "../../src/oracle/identity-compare.js";
import { runBaselineOracle } from "../../src/oracle/oracle-runner.js";
import { resolveLocator } from "../../src/runner/locator-resolver.js";
import { launchTestBrowser } from "../integration/s0-helpers.js";

describe("captureOriginalTarget", () => {
  let browserHandle: BaselineBrowser;

  beforeAll(async () => {
    browserHandle = await launchTestBrowser();
  });

  afterAll(async () => {
    await browserHandle.close();
  });

  it("captures the unique target handle", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button class="primary">Save</button></main>`);
    const handle = await captureOriginalTarget(page, "button.primary");
    expect(handle).not.toBeNull();
    expect(await handle.evaluate((el: Element) => el.textContent)).toBe("Save");
  });

  it("throws ORACLE_TARGET_NOT_UNIQUE: 0 when nothing matches", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button class="primary">Save</button></main>`);
    await expect(captureOriginalTarget(page, "button.gone")).rejects.toThrow(
      "ORACLE_TARGET_NOT_UNIQUE: 0",
    );
  });

  it("throws ORACLE_TARGET_NOT_UNIQUE: 2 when the path is ambiguous", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button>One</button><button>Two</button></main>`);
    await expect(captureOriginalTarget(page, "button")).rejects.toThrow(
      "ORACLE_TARGET_NOT_UNIQUE: 2",
    );
  });

  it("throws ORACLE_TARGET_NOT_UNIQUE: 3 for three matches", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button>1</button><button>2</button><button>3</button></main>`);
    await expect(captureOriginalTarget(page, "button")).rejects.toThrow(
      "ORACLE_TARGET_NOT_UNIQUE: 3",
    );
  });

  it("captures inside a shadow host via a scoped locator", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><div id="host"></div></main>`);
    await page.evaluate(() => {
      const host = document.querySelector("#host") as HTMLElement;
      const root = host.attachShadow({ mode: "open" });
      root.innerHTML = `<button class="in-shadow">Shadow</button>`;
    });
    const handle = await captureOriginalTargetFromLocator(
      page,
      page.locator("#host").locator("button.in-shadow"),
    );
    expect(await handle.evaluate((el: Element) => el.textContent)).toBe("Shadow");
  });

  it("captures inside an iframe via a frame locator", async () => {
    const page = browserHandle.page;
    await page.setContent(
      `<main><iframe class="f" srcdoc="<button class='in'>InFrame</button>"></iframe></main>`,
    );
    const handle = await captureOriginalTargetFromLocator(
      page,
      page.frameLocator("iframe.f").locator("button.in"),
    );
    expect(await handle.evaluate((el: Element) => el.textContent)).toBe("InFrame");
  });
});

describe("isSameElement — node identity, not wrapper identity", () => {
  let browserHandle: BaselineBrowser;

  beforeAll(async () => {
    browserHandle = await launchTestBrowser();
  });

  afterAll(async () => {
    await browserHandle.close();
  });

  it("two handles of the same node are the same element", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button class="primary">Save</button></main>`);
    const h1 = await page.locator("button.primary").elementHandle();
    const h2 = await page.locator("button.primary").elementHandle();
    expect(await isSameElement(page, h1, h2)).toBe(true);
  });

  it("handles of two different nodes are not the same element", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button>One</button><button>Two</button></main>`);
    const h1 = await page.locator("button >> nth=0").elementHandle();
    const h2 = await page.locator("button >> nth=1").elementHandle();
    expect(await isSameElement(page, h1, h2)).toBe(false);
  });

  it("a null actual handle is never the same element", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button>One</button></main>`);
    const h = await page.locator("button").elementHandle();
    expect(await isSameElement(page, null, h)).toBe(false);
  });

  it("a null original handle is never the same element", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button>One</button></main>`);
    const h = await page.locator("button").elementHandle();
    expect(await isSameElement(page, h, null)).toBe(false);
  });

  it("both null is false, not true", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main></main>`);
    expect(await isSameElement(page, null, null)).toBe(false);
  });

  it("a node moved by M01 is still the same element (identity survives wrapping)", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button class="primary">Save</button></main>`);
    const before = await page.locator("button.primary").elementHandle();
    await page.evaluate(() => {
      const el = document.querySelector("button.primary")!;
      const wrap = document.createElement("div");
      wrap.className = "wrap";
      el.parentNode!.insertBefore(wrap, el);
      wrap.appendChild(el);
    });
    const after = await page.locator("button.primary").elementHandle();
    expect(await isSameElement(page, before, after)).toBe(true);
  });

  it("probeHandleWrapperIdentity: same node, different JS wrappers", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button class="primary">Save</button></main>`);
    const probe = await probeHandleWrapperIdentity(page, page.locator("button.primary"));
    // Two elementHandle() calls return different JS wrapper objects
    // for the same DOM node: nodeIdentity true, wrapperIdentity false.
    expect(probe).toEqual({ nodeIdentity: true, wrapperIdentity: false });
  });

  it("probeHandleWrapperIdentity throws on a non-matching locator (it requires a match)", async () => {
    // The function calls locator.elementHandle() twice. Verified
    // empirically against Playwright 1.65: elementHandle() THROWS on
    // timeout and never returns null for a non-matching selector, so
    // the null branch (h1 === null || h2 === null) in
    // probeHandleWrapperIdentity is unreachable through the public
    // API — defensive code, not a defect, recorded as an uncovered
    // item in the T011 report. The observable contract is that the
    // function requires a matching locator and throws otherwise.
    const page = browserHandle.page;
    await page.setContent(`<main></main>`);
    page.setDefaultTimeout(100);
    try {
      await expect(
        probeHandleWrapperIdentity(page, page.locator("button.gone")),
      ).rejects.toThrow(/Timeout 100ms exceeded/);
    } finally {
      page.setDefaultTimeout(30_000);
    }
  });
});

describe("runBaselineOracle", () => {
  let browserHandle: BaselineBrowser;

  beforeAll(async () => {
    browserHandle = await launchTestBrowser();
  });

  afterAll(async () => {
    await browserHandle.close();
  });

  it("happy path: unique baseline, identity true, originalCaptured true", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button class="primary">Save</button></main>`);
    const out = await runBaselineOracle(page, { kind: "css", selector: "button.primary" }, "button.primary");
    expect(out.originalCaptured).toBe(true);
    expect(out.resolverResult.executionStatus).toBe("COMPLETED");
    expect(out.resolverResult.finalMatchCount).toBe(1);
    expect(out.identityMatch).toBe(true);
  });

  it("a WRONG_TARGET baseline: locator matches a different unique node, identity false", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button class="a">A</button><button class="b">B</button></main>`);
    const out = await runBaselineOracle(page, { kind: "css", selector: "button.b" }, "button.a");
    expect(out.originalCaptured).toBe(true);
    expect(out.resolverResult.finalMatchCount).toBe(1);
    expect(out.identityMatch).toBe(false);
  });

  it("an unmatchable private target path is INVALID_FIXTURE with originalCaptured false", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button class="primary">Save</button></main>`);
    const out = await runBaselineOracle(page, { kind: "css", selector: "button.primary" }, "button.gone");
    expect(out.originalCaptured).toBe(false);
    expect(out.resolverResult.executionStatus).toBe("INVALID_FIXTURE");
    expect(out.identityMatch).toBeNull();
  });

  it("an ambiguous private target path is INVALID_FIXTURE", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button>One</button><button>Two</button></main>`);
    const out = await runBaselineOracle(page, { kind: "css", selector: "button >> nth=0" }, "button");
    expect(out.originalCaptured).toBe(false);
    expect(out.resolverResult.executionStatus).toBe("INVALID_FIXTURE");
    expect(out.resolverResult.errorMessage).toMatch(/ORACLE_TARGET_NOT_UNIQUE: 2/);
  });

  it("a locator that matches nothing still captures the original (identity null, not an error)", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button class="primary">Save</button></main>`);
    const out = await runBaselineOracle(page, { kind: "css", selector: "button.gone" }, "button.primary");
    expect(out.originalCaptured).toBe(true);
    expect(out.resolverResult.executionStatus).toBe("COMPLETED");
    expect(out.resolverResult.finalMatchCount).toBe(0);
    expect(out.identityMatch).toBeNull();
  });

  it("agrees with the manual resolveLocator + isSameElement path on a mutated page", async () => {
    const page = browserHandle.page;
    await page.setContent(
      `<main><button class="primary">Save</button><button class="secondary">Cancel</button></main>`,
    );
    // Apply M04 by hand: insert a decoy before the target, then resolve with index 0.
    await page.evaluate(() => {
      const el = document.querySelector("button.primary")!;
      const decoy = document.createElement("button");
      decoy.className = "primary";
      decoy.textContent = "Save";
      el.parentNode!.insertBefore(decoy, el);
    });
    const spec = { kind: "css", selector: "button.primary", index: 0 } as const;
    const viaRunner = await runBaselineOracle(page, spec, "button.primary >> nth=1");
    const { result, finalHandle } = await resolveLocator(page, spec);
    const original = await captureOriginalTarget(page, "button.primary >> nth=1");
    const manualIdentity = await isSameElement(page, finalHandle, original);
    expect(result.executionStatus).toBe(viaRunner.resolverResult.executionStatus);
    expect(result.finalMatchCount).toBe(viaRunner.resolverResult.finalMatchCount);
    expect(manualIdentity).toBe(viaRunner.identityMatch);
    expect(viaRunner.identityMatch).toBe(false);
  });
});
