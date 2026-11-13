// FIX-R1-01 — Private target capture for custom scenarios
// (P022-R1-P1-01).
//
// The custom target descriptor (contracts/custom-scenario.ts) is the
// analogue of a frozen fixture's `privateTargetPath` (§11.3). It is
// resolved here, in Node, through a Playwright Locator that is used
// ONLY to obtain the original target's ElementHandle. The descriptor
// itself is never written into the page DOM, never returned by the
// API, and never passed to the locator under test — so the locator
// cannot match it. Identity is established afterwards by
// oracle/identity-compare.ts (DOM node identity in page context),
// exactly as for frozen fixtures.
//
// Fail closed: the descriptor must resolve to EXACTLY ONE element on
// the pristine custom HTML. Zero matches or more than one match is a
// CustomTargetError (mapped to HTTP 422 by the API service); the run
// never silently falls back to a fixture locator or to a guessed
// target.

import type { ElementHandle, Locator, Page } from "playwright";
import type { CustomTargetDescriptor } from "../contracts/custom-scenario.js";

export class CustomTargetError extends Error {
  readonly code: "CUSTOM_TARGET_NOT_FOUND" | "CUSTOM_TARGET_AMBIGUOUS";
  constructor(
    code: "CUSTOM_TARGET_NOT_FOUND" | "CUSTOM_TARGET_AMBIGUOUS",
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}

/**
 * Build the Oracle-only locator for a custom target descriptor.
 * Frame scope (framePath) and shadow scope (shadowHost) are mutually
 * exclusive by validation; the plain case resolves in the top page.
 */
export function buildCustomTargetLocator(
  page: Page,
  target: CustomTargetDescriptor,
): Locator {
  const framePath = target.framePath ?? [];
  if (framePath.length > 0) {
    let scope = page.frameLocator(framePath[0]!);
    for (let i = 1; i < framePath.length; i += 1) {
      scope = scope.frameLocator(framePath[i]!);
    }
    return scope.locator(target.css);
  }
  if (target.shadowHost !== undefined) {
    return page.locator(target.shadowHost).locator(target.css);
  }
  return page.locator(target.css);
}

/**
 * Resolve the custom target to exactly one ElementHandle on the
 * current page content. Throws CustomTargetError when the descriptor
 * matches zero or more than one element, or yields no handle.
 */
export async function captureCustomTarget(
  page: Page,
  target: CustomTargetDescriptor,
): Promise<ElementHandle> {
  const locator = buildCustomTargetLocator(page, target);
  const count = await locator.count();
  if (count === 0) {
    throw new CustomTargetError(
      "CUSTOM_TARGET_NOT_FOUND",
      `custom scenario target matched 0 elements (css: ${JSON.stringify(target.css)}); ` +
        "the target descriptor must resolve to exactly one element on the supplied HTML",
    );
  }
  if (count !== 1) {
    throw new CustomTargetError(
      "CUSTOM_TARGET_AMBIGUOUS",
      `custom scenario target matched ${count} elements (css: ${JSON.stringify(target.css)}); ` +
        "the target descriptor must resolve to exactly one element — refine the selector",
    );
  }
  const handle = await locator.elementHandle();
  if (handle === null) {
    throw new CustomTargetError(
      "CUSTOM_TARGET_NOT_FOUND",
      `custom scenario target matched 1 element but produced no handle (css: ${JSON.stringify(target.css)})`,
    );
  }
  return handle;
}

/**
 * First class token of the target element, for the M03 CHANGE_CLASS
 * operator (the frozen fixtures carry an equivalent per-fixture
 * m03Token). Empty when the target has no class: M03 is then a
 * no-op for this scenario, which is honest — a class change cannot
 * break a classless target.
 */
export async function readTargetClassToken(
  target: ElementHandle,
): Promise<string> {
  const className = await target.evaluate((el: Element) => el.getAttribute("class") ?? "");
  const first = className.split(/\s+/).filter(Boolean)[0];
  return first ?? "";
}
