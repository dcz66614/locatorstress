// T011 — LocatorResolver + frame-scope boundaries (PROJECT_BOOK §5.2).
//
// Previously resolveLocator / resolveFrameScope were only exercised
// through the 24 frozen fixtures. These tests pin the resolver's
// contract on small synthetic pages: frame layers 0/1/2, missing and
// ambiguous frames, index in/out of range, role includeHidden, and
// the ERROR (not verdict) path for invalid specs and bad selectors.

import { describe, it, expect, beforeAll, afterAll } from "vitest";

import type { BaselineBrowser } from "../../src/runner/browser.js";
import { resolveFrameScope } from "../../src/runner/frame-scope.js";
import { buildLocator, resolveLocator } from "../../src/runner/locator-resolver.js";
import type { LocatorSpecV1 } from "../../src/contracts/locator.js";
import { launchTestBrowser } from "../integration/s0-helpers.js";

const LIST_HTML = `<main>
  <button class="item">One</button>
  <button class="item">Two</button>
  <button class="item">Three</button>
</main>`;

describe("resolveFrameScope", () => {
  let browserHandle: BaselineBrowser;

  beforeAll(async () => {
    browserHandle = await launchTestBrowser();
  });

  afterAll(async () => {
    await browserHandle.close();
  });

  it("empty framePath resolves to the page itself", async () => {
    const page = browserHandle.page;
    await page.setContent(LIST_HTML);
    const out = await resolveFrameScope(page, []);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(await out.scope.locator("button.item").count()).toBe(3);
    }
  });

  it("one matching frame resolves into it", async () => {
    const page = browserHandle.page;
    await page.setContent(
      `<main><iframe class="f" srcdoc="<button class='in'>In</button>"></iframe></main>`,
    );
    const out = await resolveFrameScope(page, ["iframe.f"]);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(await out.scope.locator("button.in").count()).toBe(1);
    }
  });

  it("two nested layers resolve layer by layer", async () => {
    const page = browserHandle.page;
    await page.setContent(
      `<main><iframe class="outer" srcdoc="<iframe class='inner' srcdoc=&quot;<button class='deep'>Deep</button>&quot;></iframe>"></iframe></main>`,
    );
    const out = await resolveFrameScope(page, ["iframe.outer", "iframe.inner"]);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(await out.scope.locator("button.deep").count()).toBe(1);
    }
  });

  it("zero frames at layer 0 is FRAME_MISSING with layer 0", async () => {
    const page = browserHandle.page;
    await page.setContent(LIST_HTML);
    const out = await resolveFrameScope(page, ["iframe.gone"]);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.failure).toEqual({
        layer: 0,
        selector: "iframe.gone",
        matchCount: 0,
        kind: "FRAME_MISSING",
      });
    }
  });

  it("zero frames at layer 1 reports layer 1 (first layer matched)", async () => {
    const page = browserHandle.page;
    await page.setContent(
      `<main><iframe class="f" srcdoc="<p>no inner frame</p>"></iframe></main>`,
    );
    const out = await resolveFrameScope(page, ["iframe.f", "iframe.inner"]);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.failure.layer).toBe(1);
      expect(out.failure.kind).toBe("FRAME_MISSING");
    }
  });

  it("two frames at one layer is FRAME_AMBIGUOUS with the real count", async () => {
    const page = browserHandle.page;
    await page.setContent(
      `<main><iframe class="f" srcdoc="<p>a</p>"></iframe><iframe class="f" srcdoc="<p>b</p>"></iframe></main>`,
    );
    const out = await resolveFrameScope(page, ["iframe.f"]);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.failure).toEqual({
        layer: 0,
        selector: "iframe.f",
        matchCount: 2,
        kind: "FRAME_AMBIGUOUS",
      });
    }
  });

  it("three frames at one layer reports matchCount 3", async () => {
    const page = browserHandle.page;
    await page.setContent(
      `<main><iframe class="f" srcdoc="<p>a</p>"></iframe><iframe class="f" srcdoc="<p>b</p>"></iframe><iframe class="f" srcdoc="<p>c</p>"></iframe></main>`,
    );
    const out = await resolveFrameScope(page, ["iframe.f"]);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.failure.matchCount).toBe(3);
      expect(out.failure.kind).toBe("FRAME_AMBIGUOUS");
    }
  });
});

describe("resolveLocator — counts and index", () => {
  let browserHandle: BaselineBrowser;

  beforeAll(async () => {
    browserHandle = await launchTestBrowser();
  });

  afterAll(async () => {
    await browserHandle.close();
  });

  async function resolve(spec: LocatorSpecV1, html: string = LIST_HTML) {
    const page = browserHandle.page;
    await page.setContent(html);
    return resolveLocator(page, spec);
  }

  it("css with 1 match: raw 1, final 1, handle present", async () => {
    const { result, finalHandle } = await resolve({ kind: "css", selector: "button.item >> nth=0" });
    expect(result.executionStatus).toBe("COMPLETED");
    expect(result.rawMatchCount).toBe(1);
    expect(result.finalMatchCount).toBe(1);
    expect(finalHandle).not.toBeNull();
  });

  it("css with 0 matches: raw 0, final 0, no handle", async () => {
    const { result, finalHandle } = await resolve({ kind: "css", selector: "button.nope" });
    expect(result.executionStatus).toBe("COMPLETED");
    expect(result.rawMatchCount).toBe(0);
    expect(result.finalMatchCount).toBe(0);
    expect(finalHandle).toBeNull();
  });

  it("css with 3 matches and no index: raw 3, final 3, no handle", async () => {
    const { result, finalHandle } = await resolve({ kind: "css", selector: "button.item" });
    expect(result.rawMatchCount).toBe(3);
    expect(result.finalMatchCount).toBe(3);
    expect(finalHandle).toBeNull();
  });

  it("index 0 narrows raw 3 to final 1 with a handle", async () => {
    const { result, finalHandle } = await resolve({ kind: "css", selector: "button.item", index: 0 });
    expect(result.rawMatchCount).toBe(3);
    expect(result.finalMatchCount).toBe(1);
    expect(finalHandle).not.toBeNull();
  });

  it("index 2 (last) narrows raw 3 to final 1", async () => {
    const { result, finalHandle } = await resolve({ kind: "css", selector: "button.item", index: 2 });
    expect(result.rawMatchCount).toBe(3);
    expect(result.finalMatchCount).toBe(1);
    expect(finalHandle).not.toBeNull();
    const text = await finalHandle!.evaluate((el: Element) => el.textContent);
    expect(text).toBe("Three");
  });

  it("index 3 (one past the end) is out of range: final 0, raw unchanged", async () => {
    const { result, finalHandle } = await resolve({ kind: "css", selector: "button.item", index: 3 });
    expect(result.rawMatchCount).toBe(3);
    expect(result.finalMatchCount).toBe(0);
    expect(finalHandle).toBeNull();
  });

  it("index on an empty match set is final 0", async () => {
    const { result } = await resolve({ kind: "css", selector: "button.nope", index: 0 });
    expect(result.rawMatchCount).toBe(0);
    expect(result.finalMatchCount).toBe(0);
  });

  it("xpath matches by text predicate", async () => {
    const { result } = await resolve({ kind: "xpath", selector: "//button[text()='Two']" });
    expect(result.rawMatchCount).toBe(1);
    expect(result.finalMatchCount).toBe(1);
  });

  it("xpath with an index predicate matches one", async () => {
    const { result } = await resolve({ kind: "xpath", selector: "(//button[@class='item'])[2]" });
    expect(result.rawMatchCount).toBe(1);
  });

  it("role with an exact name matches one", async () => {
    const { result } = await resolve(
      { kind: "role", role: "button", name: "Two", exact: true },
      `<main><button>One</button><button>Two</button></main>`,
    );
    expect(result.rawMatchCount).toBe(1);
    expect(result.finalMatchCount).toBe(1);
  });

  it("role without exact matches a substring name", async () => {
    const { result } = await resolve(
      { kind: "role", role: "button", name: "Tw" },
      `<main><button>One</button><button>Two</button></main>`,
    );
    expect(result.rawMatchCount).toBe(1);
  });

  it("role includeHidden=false skips a display:none button; true finds it", async () => {
    const html = `<main><button style="display:none">Hidden</button><button>Shown</button></main>`;
    const hidden = await resolve(
      { kind: "role", role: "button", name: "Hidden", exact: true },
      html,
    );
    expect(hidden.result.rawMatchCount).toBe(0);
    const shown = await resolve(
      { kind: "role", role: "button", name: "Hidden", exact: true, includeHidden: true },
      html,
    );
    expect(shown.result.rawMatchCount).toBe(1);
  });

  it("framePath into a real iframe resolves the inner target", async () => {
    const { result, finalHandle } = await resolve(
      { kind: "css", selector: "button.in", framePath: ["iframe.f"] },
      `<main><iframe class="f" srcdoc="<button class='in'>In</button>"></iframe></main>`,
    );
    expect(result.executionStatus).toBe("COMPLETED");
    expect(result.finalMatchCount).toBe(1);
    expect(finalHandle).not.toBeNull();
  });

  it("framePath with no matching frame reports FRAME_MISSING, counts 0", async () => {
    const { result } = await resolve({ kind: "css", selector: "button.in", framePath: ["iframe.gone"] });
    expect(result.executionStatus).toBe("COMPLETED");
    expect(result.frameFailure?.kind).toBe("FRAME_MISSING");
    expect(result.rawMatchCount).toBe(0);
    expect(result.finalMatchCount).toBe(0);
  });

  it("framePath with two matching frames reports FRAME_AMBIGUOUS", async () => {
    const { result } = await resolve(
      { kind: "css", selector: "button.in", framePath: ["iframe.f"] },
      `<main><iframe class="f" srcdoc="<p>a</p>"></iframe><iframe class="f" srcdoc="<p>b</p>"></iframe></main>`,
    );
    expect(result.frameFailure?.kind).toBe("FRAME_AMBIGUOUS");
    expect(result.frameFailure?.matchCount).toBe(2);
  });
});

describe("resolveLocator — invalid input is ERROR, never a verdict-shaped result", () => {
  let browserHandle: BaselineBrowser;

  beforeAll(async () => {
    browserHandle = await launchTestBrowser();
  });

  afterAll(async () => {
    await browserHandle.close();
  });

  it("an invalid spec (empty selector) is ERROR with an error message", async () => {
    const page = browserHandle.page;
    await page.setContent(LIST_HTML);
    const { result, finalHandle } = await resolveLocator(page, { kind: "css", selector: "" });
    expect(result.executionStatus).toBe("ERROR");
    expect(result.errorMessage).toMatch(/selector must be a non-empty string/);
    expect(finalHandle).toBeNull();
  });

  it("a 3-layer framePath spec is ERROR (validation rejects it before any browser call)", async () => {
    const page = browserHandle.page;
    await page.setContent(LIST_HTML);
    const { result } = await resolveLocator(page, {
      kind: "css",
      selector: "a",
      framePath: ["iframe.a", "iframe.b", "iframe.c"],
    });
    expect(result.executionStatus).toBe("ERROR");
    expect(result.errorMessage).toMatch(/at most 2 entries/);
  });

  it("a syntactically invalid xpath is ERROR, not a silent 0-match", async () => {
    const page = browserHandle.page;
    await page.setContent(LIST_HTML);
    const { result } = await resolveLocator(page, { kind: "xpath", selector: "///[" });
    expect(result.executionStatus).toBe("ERROR");
    expect(result.errorMessage).not.toBeNull();
  });

  it("an invalid css selector is ERROR", async () => {
    const page = browserHandle.page;
    await page.setContent(LIST_HTML);
    const { result } = await resolveLocator(page, { kind: "css", selector: "button[[" });
    expect(result.executionStatus).toBe("ERROR");
  });

  it("buildLocator builds a role locator that honours exact + includeHidden", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button style="display:none">Hidden</button></main>`);
    const locator = buildLocator(page, {
      kind: "role",
      role: "button",
      name: "Hidden",
      exact: true,
      includeHidden: true,
    });
    expect(await locator.count()).toBe(1);
  });
});
