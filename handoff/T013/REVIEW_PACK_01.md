# REVIEW_PACK_01 — Oracle、Runner 与 Locator 契约

审查 commit：`a78d765`。本包为审查时原文逐字拼接（机械拼接，内容未经改写），每个文件附行数、字节数与 SHA-256；审查结论见 `INDEPENDENT_REVIEW.md`。

## src/oracle/target-capture.ts

- 行数：38；字节数：1297；SHA-256：`591b6ea8e4516d3e3472de8c20778f80994a7eacc6e01f15e169874242e2a02d`

```ts
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
```

## src/oracle/identity-compare.ts

- 行数：35；字节数：1329；SHA-256：`91df6bac029fa9363c31077345fc521b7ddec795d7b3abc299f469daadc33f6a`

```ts
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
```

## src/oracle/oracle-runner.ts

- 行数：81；字节数：1992；SHA-256：`7bfec2c2e30396f607d14af5bb98c68726f6ebb700a121a48bd5ee4f32adeb4a`

```ts
import type { Page } from "playwright";
import { captureOriginalTarget } from "./target-capture.js";
import { isSameElement } from "./identity-compare.js";
import { resolveLocator } from "../runner/locator-resolver.js";
import type { ResolverResult } from "../runner/execution.js";
import type { LocatorSpecV1 } from "../contracts/locator.js";

function errorMessageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function runBaselineOracle(
  page: Page,
  spec: LocatorSpecV1,
  privateTargetPath: string,
): Promise<{
  resolverResult: ResolverResult;
  identityMatch: boolean | null;
  originalCaptured: boolean;
}> {
  let original;
  try {
    original = await captureOriginalTarget(page, privateTargetPath);
  } catch (error) {
    const errorMessage = errorMessageOf(error);
    return {
      resolverResult: {
        executionStatus: "INVALID_FIXTURE",
        rawMatchCount: 0,
        finalMatchCount: 0,
        frameFailure: null,
        errorMessage,
      },
      identityMatch: null,
      originalCaptured: false,
    };
  }

  const { result, finalHandle } = await resolveLocator(page, spec);

  if (result.executionStatus !== "COMPLETED") {
    return {
      resolverResult: result,
      identityMatch: null,
      originalCaptured: true,
    };
  }

  if (result.finalMatchCount !== 1 || finalHandle === null) {
    return {
      resolverResult: result,
      identityMatch: null,
      originalCaptured: true,
    };
  }

  let identityMatch: boolean;
  try {
    identityMatch = await isSameElement(page, finalHandle, original);
  } catch (error) {
    const errorMessage = errorMessageOf(error);
    return {
      resolverResult: {
        ...result,
        executionStatus: "ERROR",
        errorMessage,
      },
      identityMatch: null,
      originalCaptured: true,
    };
  }

  return {
    resolverResult: result,
    identityMatch,
    originalCaptured: true,
  };
}
```

## src/runner/browser.ts

- 行数：101；字节数：2164；SHA-256：`7118b7a696d91d858d62b3801b7417b810a8777b1b852fb342192b2c525193f0`

```ts
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
```

## src/runner/execution.ts

- 行数：16；字节数：427；SHA-256：`4666276d965fd14c4f1731555036b22ea888e10beaed237b9cbc2425b0447d84`

```ts
export type ExecutionStatus = "COMPLETED" | "ERROR" | "TIMEOUT" | "INVALID_FIXTURE";

export interface FrameScopeFailure {
  layer: number;
  selector: string;
  matchCount: number;
  kind: "FRAME_MISSING" | "FRAME_AMBIGUOUS";
}

export interface ResolverResult {
  executionStatus: ExecutionStatus;
  rawMatchCount: number;
  finalMatchCount: number;
  frameFailure: FrameScopeFailure | null;
  errorMessage: string | null;
}
```

## src/runner/frame-scope.ts

- 行数：47；字节数：1055；SHA-256：`be1c258ca018e7be1b275b1d4fbaae04fe25864324b3d41671e1eb0a24a02fa8`

```ts
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
```

## src/runner/locator-resolver.ts

- 行数：188；字节数：5031；SHA-256：`40026cdd19b191b2e1339ceeb883fc5b2eab2f19f4df507889adc40480b8c12e`

```ts
import type { ElementHandle, Frame, FrameLocator, Locator, Page } from "playwright";
import { errors } from "playwright";

import type { LocatorSpecV1 } from "../contracts/locator.js";
import { validateLocatorSpec } from "../contracts/locator.js";
import type { ResolverResult } from "./execution.js";
import { resolveFrameScope } from "./frame-scope.js";

type Scope = Page | Frame | FrameLocator;

function errorMessageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof errors.TimeoutError;
}

export function buildLocator(scope: Scope, spec: LocatorSpecV1): Locator {
  if (spec.kind === "css") {
    return scope.locator(spec.selector as string);
  }

  if (spec.kind === "xpath") {
    return scope.locator(`xpath=${spec.selector as string}`);
  }

  // role: pass only defined options; name must already be a string (never regex/function)
  const options: {
    name?: string;
    exact?: boolean;
    includeHidden?: boolean;
  } = {};
  if (spec.name !== undefined) {
    options.name = spec.name;
  }
  if (spec.exact !== undefined) {
    options.exact = spec.exact;
  }
  if (spec.includeHidden !== undefined) {
    options.includeHidden = spec.includeHidden;
  }
  return scope.getByRole(spec.role as never, options);
}

export async function resolveLocator(
  page: Page,
  spec: LocatorSpecV1,
): Promise<{ result: ResolverResult; finalHandle: ElementHandle | null }> {
  const invalidResult: ResolverResult = {
    executionStatus: "INVALID_FIXTURE",
    rawMatchCount: 0,
    finalMatchCount: 0,
    frameFailure: null,
    errorMessage: null,
  };

  // Step 1: validation
  const validationErrors = validateLocatorSpec(spec);
  if (validationErrors.length > 0) {
    return {
      result: {
        ...invalidResult,
        executionStatus: "ERROR",
        errorMessage: validationErrors.join("; "),
      },
      finalHandle: null,
    };
  }

  try {
    // Step 2: frame scope (layer by layer)
    const framePath = spec.framePath ?? [];
    const scopeOutcome = await resolveFrameScope(page, framePath);

    if (!scopeOutcome.ok) {
      return {
        result: {
          executionStatus: "COMPLETED",
          rawMatchCount: 0,
          finalMatchCount: 0,
          frameFailure: scopeOutcome.failure,
          errorMessage: null,
        },
        finalHandle: null,
      };
    }

    const scope = scopeOutcome.scope;

    // Step 3: execute locator
    const locator = buildLocator(scope, spec);

    // Step 4: raw match count
    const rawMatchCount = await locator.count();

    // Step 5-6: apply index / compute final count and target identity
    const index = spec.index ?? null;

    if (index !== null) {
      if (index >= rawMatchCount) {
        // out of range = MISSING (resolver reports 0 matches)
        return {
          result: {
            executionStatus: "COMPLETED",
            rawMatchCount,
            finalMatchCount: 0,
            frameFailure: null,
            errorMessage: null,
          },
          finalHandle: null,
        };
      }

      const nth = locator.nth(index);
      const finalHandle = await nth.elementHandle();
      if (finalHandle === null) {
        // MISSING semantics: raw count unchanged, no final target
        return {
          result: {
            executionStatus: "COMPLETED",
            rawMatchCount,
            finalMatchCount: 0,
            frameFailure: null,
            errorMessage: null,
          },
          finalHandle: null,
        };
      }
      return {
        result: {
          executionStatus: "COMPLETED",
          rawMatchCount,
          finalMatchCount: 1,
          frameFailure: null,
          errorMessage: null,
        },
        finalHandle,
      };
    }

    const finalHandle =
      rawMatchCount === 1 ? await locator.elementHandle() : null;
    // P2-C: rawMatchCount===1 but elementHandle() null means no usable final
    // target; report MISSING semantics (finalMatchCount 0), as the nth branch does.
    const finalMatchCount =
      rawMatchCount === 1 && finalHandle === null ? 0 : rawMatchCount;

    return {
      result: {
        executionStatus: "COMPLETED",
        rawMatchCount,
        finalMatchCount,
        frameFailure: null,
        errorMessage: null,
      },
      finalHandle,
    };
  } catch (error) {
    // Step 7: browser errors/timeouts use a separate executionStatus
    if (isTimeoutError(error)) {
      return {
        result: {
          executionStatus: "TIMEOUT",
          rawMatchCount: 0,
          finalMatchCount: 0,
          frameFailure: null,
          errorMessage: errorMessageOf(error),
        },
        finalHandle: null,
      };
    }

    return {
      result: {
        executionStatus: "ERROR",
        rawMatchCount: 0,
        finalMatchCount: 0,
        frameFailure: null,
        errorMessage: errorMessageOf(error),
      },
      finalHandle: null,
    };
  }
}
```

## src/contracts/locator.ts

- 行数：166；字节数：4504；SHA-256：`7207a6e91a93185531773d9fe90e5aa26206d334b67e854c4335a149aa5c195e`

```ts
export type LocatorKind = "css" | "xpath" | "role";

export interface LocatorSpecV1 {
  kind: LocatorKind;
  selector?: string;
  role?: string;
  name?: string;
  exact?: boolean;
  includeHidden?: boolean;
  framePath?: string[];
  index?: number | null;
}

const KNOWN_KEYS: ReadonlySet<string> = new Set<string>([
  "kind",
  "selector",
  "role",
  "name",
  "exact",
  "includeHidden",
  "framePath",
  "index",
]);

const CSS_XPATH_ALLOWED_KEYS: ReadonlySet<string> = new Set<string>([
  "kind",
  "selector",
  "framePath",
  "index",
]);

const ROLE_ALLOWED_KEYS: ReadonlySet<string> = new Set<string>([
  "kind",
  "role",
  "name",
  "exact",
  "includeHidden",
  "framePath",
  "index",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function validateLocatorSpec(spec: unknown): string[] {
  const errors: string[] = [];

  if (!isPlainObject(spec)) {
    return ["spec must be a plain object"];
  }

  for (const key of Object.keys(spec)) {
    if (!KNOWN_KEYS.has(key)) {
      errors.push(`unknown key: ${key}`);
    }
  }

  const kind = spec["kind"];
  if (kind !== "css" && kind !== "xpath" && kind !== "role") {
    errors.push('kind must be one of "css", "xpath", "role"');
  }

  if (kind === "css" || kind === "xpath") {
    if (!isNonEmptyString(spec["selector"])) {
      errors.push(`selector must be a non-empty string when kind is "${kind}"`);
    }
    for (const key of Object.keys(spec)) {
      if (!CSS_XPATH_ALLOWED_KEYS.has(key)) {
        errors.push(`"${key}" is not allowed when kind is "${kind}"`);
      }
    }
  }

  if (kind === "role") {
    if (!isNonEmptyString(spec["role"])) {
      errors.push('role must be a non-empty string when kind is "role"');
    }
    for (const key of Object.keys(spec)) {
      if (!ROLE_ALLOWED_KEYS.has(key)) {
        errors.push(`"${key}" is not allowed when kind is "role"`);
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(spec, "name")) {
    if (!isNonEmptyString(spec["name"])) {
      errors.push("name must be a non-empty string if present");
    }
  }

  if (Object.prototype.hasOwnProperty.call(spec, "exact")) {
    if (typeof spec["exact"] !== "boolean") {
      errors.push("exact must be a boolean if present");
    }
  }

  if (Object.prototype.hasOwnProperty.call(spec, "includeHidden")) {
    if (typeof spec["includeHidden"] !== "boolean") {
      errors.push("includeHidden must be a boolean if present");
    }
  }

  if (Object.prototype.hasOwnProperty.call(spec, "framePath")) {
    const framePath = spec["framePath"];
    if (!Array.isArray(framePath)) {
      errors.push("framePath must be an array of 0-2 non-empty strings");
    } else {
      if (framePath.length > 2) {
        errors.push("framePath must contain at most 2 entries");
      }
      for (let i = 0; i < framePath.length; i += 1) {
        if (!isNonEmptyString(framePath[i])) {
          errors.push(`framePath[${i}] must be a non-empty string`);
        }
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(spec, "index")) {
    const index = spec["index"];
    if (index !== null && index !== undefined) {
      if (!isNonNegativeInteger(index)) {
        errors.push("index must be null/undefined or a non-negative integer");
      }
    }
  }

  return errors;
}

export function parseLocatorSpec(spec: unknown): LocatorSpecV1 {
  const errors = validateLocatorSpec(spec);
  if (errors.length > 0) {
    throw new Error(`Invalid LocatorSpecV1: ${errors.join("; ")}`);
  }
  return spec as LocatorSpecV1;
}

export function normalizeLocatorSpec(spec: LocatorSpecV1): LocatorSpecV1 {
  const normalized: LocatorSpecV1 = {
    kind: spec.kind,
  };
  if (spec.selector !== undefined) {
    normalized.selector = spec.selector;
  }
  if (spec.role !== undefined) {
    normalized.role = spec.role;
  }
  if (spec.name !== undefined) {
    normalized.name = spec.name;
  }
  normalized.exact = spec.exact ?? false;
  normalized.includeHidden = spec.includeHidden ?? false;
  normalized.framePath = spec.framePath !== undefined ? [...spec.framePath] : [];
  normalized.index = spec.index ?? null;
  return normalized;
}
```
