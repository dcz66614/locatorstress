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
