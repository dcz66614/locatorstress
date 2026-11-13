import type { ElementHandle, Locator, Page } from "playwright";

async function countMatches(locator: Locator): Promise<number> {
  return locator.count();
}

async function handleFromLocator(locator: Locator): Promise<ElementHandle> {
  const count = await countMatches(locator);
  if (count !== 1) {
    throw new Error(`ORACLE_TARGET_NOT_UNIQUE: ${count}`);
  }
  const handle = await locator.elementHandle();
  if (handle === null) {
    throw new Error(`ORACLE_TARGET_HANDLE_NULL: 1`);
  }
  return handle;
}

export async function captureOriginalTarget(
  page: Page,
  privateTargetPath: string,
): Promise<ElementHandle> {
  const locator = page.locator(privateTargetPath);
  return handleFromLocator(locator);
}

// Accepts a frame-scoped locator (e.g. built from a FrameLocator). This is the
// established usage for T002 nested-iframe-family original-target capture:
// the locator itself already carries the frame scope, so the original target
// may live inside a nested iframe without a separate framePath argument.
export async function captureOriginalTargetFromLocator(
  page: Page,
  locator: Locator,
): Promise<ElementHandle> {
  // page is accepted for symmetry with the public API; locator already carries its frame scope.
  void page;
  return handleFromLocator(locator);
}
