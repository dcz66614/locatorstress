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
