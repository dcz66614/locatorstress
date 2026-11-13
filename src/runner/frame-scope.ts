import type { Frame, FrameLocator, Page } from "playwright";

import type { FrameScopeFailure } from "./execution.js";

export type FrameScopeResult =
  | { ok: true; scope: Page | Frame | FrameLocator }
  | { ok: false; failure: FrameScopeFailure };

export async function resolveFrameScope(
  page: Page,
  framePath: string[],
): Promise<FrameScopeResult> {
  let scope: Page | Frame | FrameLocator = page;

  for (let layer = 0; layer < framePath.length; layer += 1) {
    const selector = framePath[layer]!;
    const matchCount = await scope.locator(selector).count();

    if (matchCount === 0) {
      return {
        ok: false,
        failure: {
          layer,
          selector,
          matchCount,
          kind: "FRAME_MISSING",
        },
      };
    }

    if (matchCount > 1) {
      return {
        ok: false,
        failure: {
          layer,
          selector,
          matchCount,
          kind: "FRAME_AMBIGUOUS",
        },
      };
    }

    scope = scope.frameLocator(selector);
  }

  return { ok: true, scope };
}
