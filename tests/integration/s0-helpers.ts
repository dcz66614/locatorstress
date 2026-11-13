import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  launchBaselineBrowser,
  type BaselineBrowser,
} from "../../src/runner/browser.js";
import type { ResolverResult } from "../../src/runner/execution.js";

export function resolveChromiumExecutable(): string {
  const candidate = join(
    process.env.HOME ?? "",
    ".cache/ms-playwright/chromium-1254/chrome-linux64/chrome",
  );
  if (!existsSync(candidate)) {
    throw new Error(`chromium-1254 not found at ${candidate}; no fallback is allowed`);
  }
  return candidate;
}

export async function launchTestBrowser(): Promise<BaselineBrowser> {
  return launchBaselineBrowser({ executablePath: resolveChromiumExecutable() });
}

export type Verdict = "STABLE" | "WRONG_TARGET" | "AMBIGUOUS" | "MISSING";

export function deriveVerdict(
  result: ResolverResult,
  identityMatch: boolean | null,
): Verdict | null {
  if (result.executionStatus !== "COMPLETED") {
    return null;
  }
  if (result.frameFailure !== null) {
    return result.frameFailure.kind === "FRAME_AMBIGUOUS" ? "AMBIGUOUS" : "MISSING";
  }
  if (result.finalMatchCount === 0) {
    return "MISSING";
  }
  if (result.finalMatchCount > 1) {
    return "AMBIGUOUS";
  }
  if (result.finalMatchCount === 1) {
    return identityMatch === true
      ? "STABLE"
      : identityMatch === false
        ? "WRONG_TARGET"
        : null;
  }
  return null;
}

export function repoRoot(): string {
  return fileURLToPath(new URL("../..", import.meta.url));
}
