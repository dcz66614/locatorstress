import type { ElementHandle, Locator, Page } from "playwright";

export async function isSameElement(
  page: Page,
  actual: ElementHandle | null,
  original: ElementHandle | null,
): Promise<boolean> {
  if (actual === null || original === null) {
    return false;
  }
  // Playwright creates a FRESH JS wrapper on each elementHandle() call, so Node-side `actual === original` is always false; true DOM identity must be tested inside the page.
  // The page function receives the unwrapped DOM nodes, hence [Node, Node].
  return page.evaluate(
    ([a, b]: [Node, Node]) => a === b,
    [actual, original] as [ElementHandle, ElementHandle],
  );
}

export async function probeHandleWrapperIdentity(
  page: Page,
  locator: Locator,
): Promise<{ nodeIdentity: boolean; wrapperIdentity: boolean }> {
  const h1 = await locator.elementHandle();
  const h2 = await locator.elementHandle();
  if (h1 === null || h2 === null) {
    return { nodeIdentity: false, wrapperIdentity: h1 === h2 };
  }
  // Different JS wrapper objects can still point at the same DOM node; compare inside the page for node identity.
  const nodeIdentity = await page.evaluate(
    ([a, b]: [Node, Node]) => a === b,
    [h1, h2] as [ElementHandle, ElementHandle],
  );
  const wrapperIdentity = h1 === h2;
  return { nodeIdentity, wrapperIdentity };
}
