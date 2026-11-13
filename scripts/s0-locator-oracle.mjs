import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { launchBaselineBrowser } from "../dist/runner/browser.js";
import { runBaselineOracle } from "../dist/oracle/oracle-runner.js";
import {
  probeHandleWrapperIdentity,
  isSameElement,
} from "../dist/oracle/identity-compare.js";
import { captureOriginalTargetFromLocator } from "../dist/oracle/target-capture.js";
import { resolveLocator } from "../dist/runner/locator-resolver.js";

const SEED = "P022-LOCATORSTRESS-S0-2026-11-10";

const EXPECTED_CHROMIUM_VERSION = "158.0.8127.18";

const HTML =
  '<main><h1>LocatorStress baseline</h1><button class="primary">Save</button><button class="secondary">Cancel</button></main>';

const PROBE_HTML = '<main></main>';

const FRAME_HTML =
  "<main><iframe srcdoc=\"<button class='primary'>InFrame</button><button class='decoy'>Decoy</button>\"></iframe></main>";

const SPEC = { kind: "css", selector: "button.primary" };
const PRIVATE_TARGET_PATH = "main > button:nth-child(2)";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = dirname(__dirname);
const evidenceDir = join(repoRoot, "evidence", "environment");
const evidenceJsonPath = join(evidenceDir, "T001_BASELINE.json");
const evidenceLogPath = join(evidenceDir, "T001_BASELINE.log");

function resolveExecutablePath() {
  const home = process.env.HOME;
  if (!home) {
    throw new Error(
      "HOME is not set; cannot locate chromium-1254 (no fallback to another revision is allowed)",
    );
  }
  const candidate = join(
    home,
    ".cache/ms-playwright/chromium-1254/chrome-linux64/chrome",
  );
  if (!existsSync(candidate)) {
    throw new Error(
      `chromium-1254 not found at ${candidate}; no fallback to another revision is allowed`,
    );
  }
  return candidate;
}

function readPlaywrightVersion() {
  try {
    const pkgPath = join(repoRoot, "node_modules/playwright/package.json");
    const raw = readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.version === "string") return parsed.version;
    return "unknown";
  } catch {
    return "unknown";
  }
}

function writeStaleEvidence(lines, errorMessage) {
  mkdirSync(evidenceDir, { recursive: true });
  const record = {
    schema: "locatorstress.t001-baseline/v1",
    seed: SEED,
    status: "STALE",
    error: errorMessage,
    note: "previous evidence removed; this run failed before producing fresh evidence",
  };
  writeFileSync(evidenceJsonPath, JSON.stringify(record, null, 2) + "\n", "utf8");
  writeFileSync(
    evidenceLogPath,
    lines.join("\n") +
      "\n" +
      "STALE: run failed, no fresh evidence produced\n",
    "utf8",
  );
}

async function main() {
  const lines = [];
  const log = (line) => {
    lines.push(line);
    console.log(line);
  };

  let evidenceWritten = false;

  const htmlBytes = Buffer.byteLength(HTML, "utf8");

  let browserHandle = null;
  let playwrightVersion = readPlaywrightVersion();
  let chromiumVersion = "unknown";

  let rawMatchCount = 0;
  let finalMatchCount = 0;
  let executionStatus = "UNKNOWN";
  let identityMatch = null;
  let firstRun = null;

  let probe = { nodeIdentity: false, wrapperIdentity: false };
  let secondRun = null;
  let externalRequests = 0;
  let blockedRequests = 0;

  let offlineProbe = {
    attempts: 2,
    externalRequests: 0,
    blockedRequests: 0,
    passed: false,
  };

  let frameIdentityProbe = {
    sameTarget: false,
    decoy: false,
    passed: false,
  };

  let checks = {
    uniqueHit: false,
    identityReproducible: false,
    offlineProbePassed: false,
  };

  // Remove stale evidence up front so a failed run can never leave old files.
  rmSync(evidenceJsonPath, { force: true });
  rmSync(evidenceLogPath, { force: true });
  log("stale evidence removed (T001_BASELINE.json, T001_BASELINE.log)");

  try {
    const executablePath = resolveExecutablePath();

    browserHandle = await launchBaselineBrowser({ executablePath });
    const { browser, page } = browserHandle;

    try {
      chromiumVersion = browser.version();
    } catch {
      chromiumVersion = "unknown";
    }

    if (chromiumVersion !== EXPECTED_CHROMIUM_VERSION) {
      throw new Error(
        `unexpected chromium version: ${chromiumVersion} (expected ${EXPECTED_CHROMIUM_VERSION})`,
      );
    }

    // Offline negative probe: must run BEFORE the baseline setContent.
    // Both the image load and the fetch attempt to reach example.invalid and
    // must be intercepted; failures are caught inside the probe and can never
    // crash the run.
    await page.setContent(PROBE_HTML);
    await page.evaluate(async () => {
      const img = new Image();
      const imgPromise = new Promise((resolve) => {
        img.addEventListener("load", () => resolve("load"));
        img.addEventListener("error", () => resolve("error"));
      });
      img.src = "https://example.invalid/x.png";
      document.body.appendChild(img);
      const fetchPromise = (async () => {
        try {
          await fetch("https://example.invalid/");
          return "fetch-ok";
        } catch {
          return "fetch-error";
        }
      })();
      const timeout = new Promise((resolve) => {
        setTimeout(() => resolve("timeout"), 5000);
      });
      await Promise.race([
        Promise.allSettled([imgPromise, fetchPromise]),
        timeout,
      ]);
    });

    externalRequests = browserHandle.externalRequestCount();
    blockedRequests = browserHandle.blockedRequestCount();
    offlineProbe = {
      attempts: 2,
      externalRequests,
      blockedRequests,
      passed: externalRequests === 2 && blockedRequests === 2,
    };
    log(
      `offline probe attempts=${offlineProbe.attempts} externalRequests=${offlineProbe.externalRequests} blockedRequests=${offlineProbe.blockedRequests} passed=${String(
        offlineProbe.passed,
      )}`,
    );

    await page.setContent(HTML);
    const rawLocator = page.locator(SPEC.selector);
    rawMatchCount = await rawLocator.count();

    firstRun = await runBaselineOracle(page, SPEC, PRIVATE_TARGET_PATH);
    finalMatchCount = firstRun.resolverResult.finalMatchCount;
    executionStatus = firstRun.resolverResult.executionStatus;
    identityMatch = firstRun.identityMatch;

    log(
      `baseline rawMatchCount=${rawMatchCount} finalMatchCount=${finalMatchCount} executionStatus=${executionStatus} identityMatch=${String(
        identityMatch,
      )}`,
    );

    probe = await probeHandleWrapperIdentity(
      page,
      page.locator(PRIVATE_TARGET_PATH),
    );
    log(
      `identity probe nodeIdentity=${String(probe.nodeIdentity)} wrapperIdentity=${String(
        probe.wrapperIdentity,
      )}`,
    );

    await page.setContent(HTML);
    secondRun = await runBaselineOracle(page, SPEC, PRIVATE_TARGET_PATH);
    log(
      `second run rawMatchCount=${secondRun.resolverResult.rawMatchCount} finalMatchCount=${secondRun.resolverResult.finalMatchCount} executionStatus=${secondRun.resolverResult.executionStatus} identityMatch=${String(
        secondRun.identityMatch,
      )}`,
    );

    // Frame identity probe: inline HTML only, no fixture file.
    await page.setContent(FRAME_HTML);
    const original = await captureOriginalTargetFromLocator(
      page,
      page.frameLocator("iframe").locator("button.primary"),
    );
    const resolved = await resolveLocator(page, {
      kind: "css",
      selector: "button.primary",
      framePath: ["iframe"],
    });
    const sameTarget =
      resolved.result.executionStatus === "COMPLETED" &&
      resolved.result.finalMatchCount === 1 &&
      resolved.finalHandle !== null
        ? await isSameElement(page, resolved.finalHandle, original)
        : false;
    const decoyHandle = await page
      .frameLocator("iframe")
      .locator("button.decoy")
      .elementHandle();
    const decoy = await isSameElement(page, decoyHandle, original);
    frameIdentityProbe = {
      sameTarget,
      decoy,
      passed: sameTarget === true && decoy === false,
    };
    log(
      `frame identity probe sameTarget=${String(frameIdentityProbe.sameTarget)} decoy=${String(
        frameIdentityProbe.decoy,
      )} passed=${String(frameIdentityProbe.passed)}`,
    );

    externalRequests = browserHandle.externalRequestCount();
    blockedRequests = browserHandle.blockedRequestCount();
    log(
      `externalRequests=${externalRequests} blockedRequests=${blockedRequests}`,
    );

    const identityReproducible =
      secondRun.resolverResult.executionStatus === "COMPLETED" &&
      secondRun.resolverResult.finalMatchCount === 1 &&
      secondRun.identityMatch === true;

    checks = {
      uniqueHit: rawMatchCount === 1 && finalMatchCount === 1,
      identityReproducible,
      offlineProbePassed: offlineProbe.passed,
    };

    log(
      `checks uniqueHit=${String(checks.uniqueHit)} identityReproducible=${String(
        checks.identityReproducible,
      )} offlineProbePassed=${String(checks.offlineProbePassed)}`,
    );

    const allPass =
      checks.uniqueHit &&
      checks.identityReproducible &&
      checks.offlineProbePassed &&
      frameIdentityProbe.passed;
    log(`result ${allPass ? "PASS" : "FAIL"}`);

    mkdirSync(evidenceDir, { recursive: true });

    const record = {
      schema: "locatorstress.t001-baseline/v1",
      seed: SEED,
      playwright: playwrightVersion,
      chromium: chromiumVersion,
      node: process.version,
      baseline: {
        htmlBytes,
        locator: { kind: SPEC.kind, selector: SPEC.selector },
        privateTargetPathUsed: true,
        rawMatchCount,
        finalMatchCount,
        executionStatus,
        identityMatch,
      },
      identityProbe: {
        nodeIdentity: probe.nodeIdentity,
        wrapperIdentity: probe.wrapperIdentity,
        reproducibleSecondRun: identityReproducible,
      },
      offlineProbe,
      frameIdentityProbe,
      externalRequests,
      blockedRequests,
      checks,
    };

    writeFileSync(evidenceJsonPath, JSON.stringify(record, null, 2) + "\n", "utf8");
    writeFileSync(evidenceLogPath, lines.join("\n") + "\n", "utf8");
    evidenceWritten = true;

    if (!allPass) {
      process.exitCode = 1;
    } else {
      process.exitCode = 0;
    }
  } catch (error) {
    if (!evidenceWritten) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        writeStaleEvidence(lines, message);
      } catch {
        // ignore stale-evidence write errors; exit code still reflects failure
      }
    }
    throw error;
  } finally {
    if (browserHandle) {
      try {
        await browserHandle.close();
      } catch {
        // ignore close errors
      }
    }
  }
}

main().catch((err) => {
  console.error(`fatal: ${err && err.message ? err.message : String(err)}`);
  process.exitCode = 1;
});
