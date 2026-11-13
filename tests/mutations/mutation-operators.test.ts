// T011 — M01–M08 operator unit tests on minimal synthetic pages
// (PROJECT_BOOK §4; src/mutations/M01–M08).
//
// Previously the operators were only exercised through the 192-case
// integration run. These tests pin each operator's DOM effect in
// isolation, plus the two cross-cutting invariants:
//   - the Oracle target node keeps its identity (same DOM object);
//   - applying the same operator to two fresh pages gives identical DOM.
//
// Each test uses a fresh page so operators never interfere.

import { describe, it, expect, beforeAll, afterAll } from "vitest";

import type { BaselineBrowser } from "../../src/runner/browser.js";
import { isSameElement } from "../../src/oracle/identity-compare.js";
import { MUTATION_ORDER, getMutation } from "../../src/mutations/registry.js";
import type { MutationContext } from "../../src/mutations/types.js";
import { launchTestBrowser } from "../integration/s0-helpers.js";

const PAGE_HTML = `<main>
  <button class="primary" aria-label="Save">Save</button>
  <button class="secondary">Cancel</button>
  <a href="/x" class="nav">Home</a>
</main>`;

function ctx(overrides: Partial<MutationContext> = {}): MutationContext {
  return {
    fixtureId: "T011-OPERATORS",
    seed: "P022-LOCATORSTRESS-S0-2026-11-10",
    m03Token: "primary",
    framePath: [],
    newText: "Changed Text",
    ...overrides,
  };
}

describe("mutation registry", () => {
  it("exposes M01–M08 in fixed order with matching ids and names", () => {
    expect(MUTATION_ORDER).toEqual(["M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08"]);
    const names: Record<string, string> = {
      M01: "WRAP_TARGET",
      M02: "REORDER_SIBLINGS",
      M03: "CHANGE_CLASS",
      M04: "INSERT_SAME_NAME",
      M05: "NESTED_IFRAME",
      M06: "MOVE_TO_OPEN_SHADOW_ROOT",
      M07: "INSERT_HIDDEN_DUPLICATE",
      M08: "CHANGE_TEXT",
    };
    for (const id of MUTATION_ORDER) {
      const def = getMutation(id);
      expect(def.id).toBe(id);
      expect(def.name).toBe(names[id]);
      expect(typeof def.apply).toBe("function");
    }
  });
});

describe("M01–M08 operators (real Chromium)", () => {
  let browserHandle: BaselineBrowser;

  beforeAll(async () => {
    browserHandle = await launchTestBrowser();
  });

  afterAll(async () => {
    await browserHandle.close();
  });

  async function freshPageWithTarget() {
    const page = browserHandle.page;
    await page.setContent(PAGE_HTML);
    const target = await page.locator("button.primary").elementHandle();
    if (target === null) throw new Error("target handle is null");
    return { page, target };
  }

  it("M01 wraps the target in a div.wrap; target identity is preserved", async () => {
    const { page, target } = await freshPageWithTarget();
    await getMutation("M01").apply(page, target, ctx());
    const parentClass = await page.evaluate(() => {
      const t = document.querySelector("button.primary")!;
      return (t.parentElement as HTMLElement).className;
    });
    expect(parentClass).toBe("wrap");
    expect(await page.locator("div.wrap > button.primary").count()).toBe(1);
    expect(await isSameElement(page, target, await page.locator("button.primary").elementHandle())).toBe(true);
  });

  it("M02 swaps the target with its next sibling (target moves after Cancel)", async () => {
    const { page, target } = await freshPageWithTarget();
    await getMutation("M02").apply(page, target, ctx());
    const order = await page.evaluate(() =>
      [...document.querySelectorAll("main > *")].map((el) => el.textContent),
    );
    expect(order).toEqual(["Cancel", "Save", "Home"]);
    expect(await isSameElement(page, target, await page.locator("button.primary").elementHandle())).toBe(true);
  });

  it("M02 on the last element swaps with the previous sibling instead", async () => {
    const page = browserHandle.page;
    await page.setContent(PAGE_HTML);
    const target = await page.locator("a.nav").elementHandle();
    if (target === null) throw new Error("target handle is null");
    await getMutation("M02").apply(page, target, ctx());
    const order = await page.evaluate(() =>
      [...document.querySelectorAll("main > *")].map((el) => el.textContent),
    );
    expect(order).toEqual(["Save", "Home", "Cancel"]);
  });

  it("M02 on a lone child is a no-op (no siblings to swap with)", async () => {
    const page = browserHandle.page;
    await page.setContent(`<main><button class="only">Only</button></main>`);
    const target = await page.locator("button.only").elementHandle();
    if (target === null) throw new Error("target handle is null");
    const before = await page.evaluate(() => document.querySelector("main")!.innerHTML);
    await getMutation("M02").apply(page, target, ctx());
    const after = await page.evaluate(() => document.querySelector("main")!.innerHTML);
    expect(after).toBe(before);
  });

  it("M03 replaces the token class with token-changed; other classes untouched", async () => {
    const { page, target } = await freshPageWithTarget();
    await getMutation("M03").apply(page, target, ctx());
    expect(await page.locator("button.primary-changed").count()).toBe(1);
    expect(await page.locator("button.primary").count()).toBe(0);
    expect(await page.locator("button.secondary").count()).toBe(1);
  });

  it("M03 is a no-op when the token is not on the target", async () => {
    const { page, target } = await freshPageWithTarget();
    const before = await page.evaluate(() => document.querySelector("main")!.innerHTML);
    await getMutation("M03").apply(page, target, ctx({ m03Token: "absent-token" }));
    const after = await page.evaluate(() => document.querySelector("main")!.innerHTML);
    expect(after).toBe(before);
  });

  it("M04 inserts a decoy before the target with same tag/class/text/aria-label, as a different node", async () => {
    const { page, target } = await freshPageWithTarget();
    await getMutation("M04").apply(page, target, ctx());
    expect(await page.locator("button.primary").count()).toBe(2);
    const check = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button.primary")];
      const [decoy, original] = buttons as [HTMLElement, HTMLElement];
      return {
        firstText: decoy.textContent,
        firstAria: decoy.getAttribute("aria-label"),
        decoyBeforeTarget: (decoy.compareDocumentPosition(original) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      };
    });
    expect(check.firstText).toBe("Save");
    expect(check.firstAria).toBe("Save");
    expect(check.decoyBeforeTarget).toBe(true);
    // The decoy is a different DOM object from the Oracle target.
    const decoyHandle = await page.locator("button.primary").first().elementHandle();
    expect(await isSameElement(page, decoyHandle, target)).toBe(false);
  });

  it("M05 appends a srcdoc-only iframe to body when framePath is empty", async () => {
    const { page, target } = await freshPageWithTarget();
    await getMutation("M05").apply(page, target, ctx());
    const frames = await page.evaluate(() => {
      const iframes = [...document.querySelectorAll("iframe")];
      return iframes.map((f) => ({ srcdoc: f.srcdoc, src: f.getAttribute("src") }));
    });
    expect(frames).toHaveLength(1);
    expect(frames[0]!.srcdoc).toContain("Decoy");
    expect(frames[0]!.src).toBeNull();
    expect(await page.locator("button.primary").count()).toBe(1);
  });

  it("M05 with a framePath appends a decoy iframe beside the framed iframe, copying its class", async () => {
    const page = browserHandle.page;
    await page.setContent(
      `<main><iframe class="frame-a" srcdoc="<button class='primary'>Save</button>"></iframe></main>`,
    );
    // The button lives inside the srcdoc iframe, so it must be
    // reached through a frameLocator; page.locator only searches the
    // main frame and elementHandle() would auto-wait past the test
    // timeout on a non-matching selector.
    const target = await page
      .frameLocator("iframe.frame-a")
      .locator("button.primary")
      .elementHandle();
    if (target === null) throw new Error("target handle is null");
    await getMutation("M05").apply(page, target, ctx({ framePath: ["iframe.frame-a"] }));
    const info = await page.evaluate(() => {
      const iframes = [...document.querySelectorAll("main > iframe")];
      return {
        count: iframes.length,
        classes: iframes.map((f) => f.className),
        srcdocs: iframes.map((f) => f.srcdoc),
      };
    });
    expect(info.count).toBe(2);
    expect(info.classes).toEqual(["frame-a", "frame-a"]);
    expect(info.srcdocs[1]).toContain("Decoy");
  });

  it("M06 moves the target into an open shadow root; light DOM no longer contains it, identity preserved", async () => {
    const { page, target } = await freshPageWithTarget();
    await getMutation("M06").apply(page, target, ctx());
    // The light DOM no longer contains the button. (Playwright's CSS
    // engine pierces open shadow roots, so page.locator still finds
    // it — the correct observable is document.querySelector, not the
    // locator count.)
    const inLightDom = await page.evaluate(() => document.querySelector("button.primary") !== null);
    expect(inLightDom).toBe(false);
    const inShadow = await page.evaluate(() => {
      const host = document.querySelector("div.m06-shadow-host") as HTMLElement | null;
      if (!host || !host.shadowRoot) return false;
      return host.shadowRoot.querySelector("button.primary") !== null;
    });
    expect(inShadow).toBe(true);
    const shadowHandle = await page.evaluateHandle(() => {
      const host = document.querySelector("div.m06-shadow-host") as HTMLElement;
      return host.shadowRoot!.querySelector("button.primary") as Element;
    });
    const shadowEl = shadowHandle.asElement();
    expect(shadowEl).not.toBeNull();
    expect(await isSameElement(page, shadowEl, target)).toBe(true);
  });

  it("M07 inserts a hidden duplicate (display:none + aria-hidden) before the target", async () => {
    const { page, target } = await freshPageWithTarget();
    await getMutation("M07").apply(page, target, ctx());
    expect(await page.locator("button.primary").count()).toBe(2);
    const hidden = await page.evaluate(() => {
      const first = document.querySelectorAll("button.primary")[0] as HTMLElement;
      return {
        display: first.style.display,
        ariaHidden: first.getAttribute("aria-hidden"),
        visible: first.offsetParent !== null,
      };
    });
    expect(hidden.display).toBe("none");
    expect(hidden.ariaHidden).toBe("true");
    expect(hidden.visible).toBe(false);
    const decoyHandle = await page.locator("button.primary").first().elementHandle();
    expect(await isSameElement(page, decoyHandle, target)).toBe(false);
  });

  it("M08 replaces the target text with ctx.newText and leaves attributes untouched", async () => {
    const { page, target } = await freshPageWithTarget();
    await getMutation("M08").apply(page, target, ctx());
    const info = await page.evaluate(() => {
      const b = document.querySelector("button.primary") as HTMLElement;
      return { text: b.textContent, cls: b.className, aria: b.getAttribute("aria-label") };
    });
    expect(info).toEqual({ text: "Changed Text", cls: "primary", aria: "Save" });
  });

  it("M08 with an empty newText clears the text", async () => {
    const { page, target } = await freshPageWithTarget();
    await getMutation("M08").apply(page, target, ctx({ newText: "" }));
    expect(await page.evaluate(() => document.querySelector("button.primary")!.textContent)).toBe("");
  });

  it("determinism: each operator applied to two fresh pages gives identical DOM", async () => {
    const page = browserHandle.page;
    for (const id of MUTATION_ORDER) {
      const doms: string[] = [];
      for (let run = 0; run < 2; run += 1) {
        await page.setContent(PAGE_HTML);
        const target = await page.locator("button.primary").elementHandle();
        if (target === null) throw new Error("target handle is null");
        await getMutation(id).apply(page, target, ctx());
        doms.push(await page.evaluate(() => document.querySelector("main")!.outerHTML));
      }
      expect(doms[0], `operator ${id} must be deterministic`).toBe(doms[1]);
    }
  });

  it("M01 applied twice nests twice (wrap is not idempotent by design)", async () => {
    const { page, target } = await freshPageWithTarget();
    await getMutation("M01").apply(page, target, ctx());
    await getMutation("M01").apply(page, target, ctx());
    expect(await page.locator("div.wrap > div.wrap > button.primary").count()).toBe(1);
  });
});
