import type { ElementHandle, Page } from "playwright";
import { readFileSync } from "node:fs";
import {
  captureOriginalTarget,
  captureOriginalTargetFromLocator,
} from "../oracle/target-capture.js";
import type { MutationContext } from "../mutations/types.js";
import type { FixtureManifest } from "./fixture-manifest.js";
import {
  FIXTURE_IDS,
  SEED,
  fixtureHtmlPath,
  loadFixtureManifest,
} from "./fixture-manifest.js";

export interface LoadedFixture {
  manifest: FixtureManifest;
  html: string;
}

export function loadFixture(fixtureId: string): LoadedFixture {
  const manifest = loadFixtureManifest(fixtureId);

  const htmlPath = fixtureHtmlPath(fixtureId);

  let html: string;
  try {
    html = readFileSync(htmlPath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to read HTML for fixture ${fixtureId} at ${htmlPath}: ${message}`,
    );
  }

  return { manifest, html };
}

export async function setFixtureContent(
  page: Page,
  fixture: LoadedFixture,
): Promise<void> {
  await page.setContent(fixture.html);
}

export async function captureOriginalTargetForFixture(
  page: Page,
  manifest: FixtureManifest,
): Promise<ElementHandle> {
  switch (manifest.captureMode) {
    case "page": {
      return captureOriginalTarget(page, manifest.privateTargetPath);
    }
    case "frame": {
      const framePath = manifest.locator.framePath ?? [];
      if (framePath.length === 0) {
        throw new Error(
          `Fixture ${manifest.fixtureId}: captureMode "frame" requires a framePath`,
        );
      }
      let loc = page.frameLocator(framePath[0]);
      for (let i = 1; i < framePath.length; i += 1) {
        loc = loc.frameLocator(framePath[i]);
      }
      return captureOriginalTargetFromLocator(
        page,
        loc.locator(manifest.privateTargetPath),
      );
    }
    case "shadow": {
      const shadowHost = manifest.shadowHost;
      if (typeof shadowHost !== "string" || shadowHost.length === 0) {
        throw new Error(
          `Fixture ${manifest.fixtureId}: captureMode "shadow" requires a shadowHost`,
        );
      }
      return captureOriginalTargetFromLocator(
        page,
        page.locator(shadowHost).locator(manifest.privateTargetPath),
      );
    }
    default: {
      throw new Error(
        `Fixture ${manifest.fixtureId}: unsupported captureMode "${String(
          manifest.captureMode,
        )}"`,
      );
    }
  }
}

export function mutationContextForFixture(
  manifest: FixtureManifest,
): MutationContext {
  return {
    fixtureId: manifest.fixtureId,
    seed: SEED,
    m03Token: manifest.m03Token,
    framePath: [...(manifest.locator.framePath ?? [])],
    newText: "Changed Text",
  };
}

export function listFixtureIds(): string[] {
  return [...FIXTURE_IDS];
}
