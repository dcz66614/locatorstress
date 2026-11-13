import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LocatorSpecV1 } from "../contracts/locator.js";
import { validateLocatorSpec } from "../contracts/locator.js";

export type FixtureKind = "css" | "xpath" | "role";
export type ControlGroup = "stable" | "fragile";
export type CaptureMode = "page" | "frame" | "shadow";

export interface FixtureManifest {
  fixtureId: string;
  family: string;
  kind: FixtureKind;
  controlGroup: ControlGroup;
  locator: LocatorSpecV1;
  privateTargetPath: string;
  captureMode: CaptureMode;
  shadowHost?: string;
  m03Token: string;
  seed: string;
}

export const SEED = "P022-LOCATORSTRESS-S0-2026-11-10";

export const FIXTURE_IDS: string[] = [
  "F001",
  "F002",
  "F003",
  "F004",
  "F005",
  "F006",
  "F007",
  "F008",
  "F009",
  "F010",
  "F011",
  "F012",
  "F013",
  "F014",
  "F015",
  "F016",
  "F017",
  "F018",
  "F019",
  "F020",
  "F021",
  "F022",
  "F023",
  "F024",
];

const FIXTURE_ID_PATTERN = /^F0(0[1-9]|1[0-9]|2[0-4])$/;
const KINDS: readonly FixtureKind[] = ["css", "xpath", "role"];
const CONTROL_GROUPS: readonly ControlGroup[] = ["stable", "fragile"];
const CAPTURE_MODES: readonly CaptureMode[] = ["page", "frame", "shadow"];

// Directory of this module at runtime (works under ESM / nodenext).
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

// Fixture data lives in src/fixtures/. When this module runs from src the
// data sits next to it; when it runs compiled from dist/fixtures, fall back
// to the sibling src/fixtures tree. Both candidates are checked in order;
// the first directory that contains the pages/ tree wins.
function fixtureDataDir(): string {
  const candidates = [
    MODULE_DIR,
    resolve(MODULE_DIR, "..", "..", "src", "fixtures"),
  ];
  for (const dir of candidates) {
    if (existsSync(resolve(dir, "pages"))) {
      return dir;
    }
  }
  return candidates[0]!;
}

export function fixtureManifestPath(fixtureId: string): string {
  return resolve(fixtureDataDir(), "oracle-manifests", `${fixtureId}.json`);
}

export function fixtureHtmlPath(fixtureId: string): string {
  return resolve(fixtureDataDir(), "pages", `${fixtureId}.html`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const REQUIRED_KEYS: readonly string[] = [
  "fixtureId",
  "family",
  "kind",
  "controlGroup",
  "locator",
  "privateTargetPath",
  "captureMode",
  "m03Token",
  "seed",
];

export function validateFixtureManifest(manifest: unknown): string[] {
  const errors: string[] = [];

  if (!isPlainObject(manifest)) {
    return ["manifest is not a plain object"];
  }

  for (const key of REQUIRED_KEYS) {
    if (!(key in manifest)) {
      errors.push(`missing required key "${key}"`);
    }
  }

  const fixtureId = manifest["fixtureId"];
  if (typeof fixtureId !== "string" || !FIXTURE_ID_PATTERN.test(fixtureId)) {
    errors.push('fixtureId must match /^F0(0[1-9]|1[0-9]|2[0-4])$/');
  }

  const family = manifest["family"];
  if (typeof family !== "string" || family.length === 0) {
    errors.push("family must be a non-empty string");
  }

  const kind = manifest["kind"];
  const kindValid = typeof kind === "string" && (KINDS as readonly string[]).includes(kind);
  if (!kindValid) {
    errors.push('kind must be one of "css", "xpath", "role"');
  }

  const controlGroup = manifest["controlGroup"];
  if (
    typeof controlGroup !== "string" ||
    !(CONTROL_GROUPS as readonly string[]).includes(controlGroup)
  ) {
    errors.push('controlGroup must be one of "stable", "fragile"');
  }

  const locator = manifest["locator"];
  const locatorErrors = validateLocatorSpec(locator);
  if (locatorErrors.length > 0) {
    for (const e of locatorErrors) {
      errors.push(`locator: ${e}`);
    }
  } else if (kindValid && isPlainObject(locator) && locator["kind"] !== kind) {
    errors.push('locator.kind must equal manifest "kind"');
  }

  const privateTargetPath = manifest["privateTargetPath"];
  if (typeof privateTargetPath !== "string" || privateTargetPath.length === 0) {
    errors.push("privateTargetPath must be a non-empty string");
  } else {
    const lowered = privateTargetPath.toLowerCase();
    if (
      lowered.includes("data-testid") ||
      lowered.includes("data-target") ||
      lowered.includes("data-oracle")
    ) {
      errors.push(
        "privateTargetPath must not contain data-testid, data-target, or data-oracle",
      );
    }
  }

  const captureMode = manifest["captureMode"];
  const captureModeValid =
    typeof captureMode === "string" &&
    (CAPTURE_MODES as readonly string[]).includes(captureMode);
  if (!captureModeValid) {
    errors.push('captureMode must be one of "page", "frame", "shadow"');
  } else if (captureMode === "frame") {
    if (locatorErrors.length === 0 && isPlainObject(locator)) {
      const framePath = locator["framePath"];
      if (!Array.isArray(framePath) || framePath.length === 0) {
        errors.push('captureMode "frame" requires a non-empty locator.framePath array');
      }
    }
  } else if (captureMode === "shadow") {
    const shadowHost = manifest["shadowHost"];
    if (typeof shadowHost !== "string" || shadowHost.length === 0) {
      errors.push('captureMode "shadow" requires a non-empty shadowHost string');
    }
  }

  const m03Token = manifest["m03Token"];
  if (typeof m03Token !== "string" || m03Token.length === 0) {
    errors.push("m03Token must be a non-empty string");
  }

  const seed = manifest["seed"];
  if (seed !== SEED) {
    errors.push(`seed must equal "${SEED}"`);
  }

  return errors;
}

export function loadFixtureManifest(fixtureId: string): FixtureManifest {
  const path = fixtureManifestPath(fixtureId);

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    throw new Error(
      `Failed to read manifest for fixture ${fixtureId} at ${path}: ${errorMessage(err)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse manifest JSON for fixture ${fixtureId} at ${path}: ${errorMessage(err)}`,
    );
  }

  const errors = validateFixtureManifest(parsed);
  if (errors.length > 0) {
    throw new Error(
      `Invalid manifest for fixture ${fixtureId}: ${errors.join("; ")}`,
    );
  }

  return parsed as FixtureManifest;
}

export function loadAllFixtureManifests(): FixtureManifest[] {
  const manifests: FixtureManifest[] = [];
  for (const id of FIXTURE_IDS) {
    manifests.push(loadFixtureManifest(id));
  }
  return manifests;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
