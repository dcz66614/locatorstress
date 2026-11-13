// T007 — Browser evaluator for the bounded BFS (PROJECT_BOOK §5.6).
//
// Adapts the frozen S0 machinery (fixture loader, mutation registry,
// locator resolver, Oracle identity compare, T004 classifier) to the
// BfsEvaluator interface in bfs.ts. It changes none of those modules:
// it only calls them, in exactly the per-case order the S0 integration
// test uses (setContent -> capture original target -> apply mutations
// in sequence order -> resolve locator -> identity compare when there
// is exactly one final match -> classify).
//
// Per evaluation, the page is reset from the fixture HTML, so every
// sequence is evaluated from the same baseline, independently of every
// other sequence. The state key is the canonical DOM-state hash of the
// serialised DOM after the sequence (domStateKey); two sequences that
// converge on the same DOM share a key and the second is pruned.
//
// INCOMPLETE handling: any throw during apply/resolve/identity (or a
// null verdict from the classifier) yields verdict null / INCOMPLETE,
// never a disguised verdict. The evaluator still tries to snapshot the
// DOM for the state key; if even that fails, it falls back to the
// canonical plan hash of the sequence, so the BFS can still dedup
// repeated evaluations of the same failing sequence.

import type { Page } from "playwright";

import type { FixtureManifest } from "../fixtures/fixture-manifest.js";
import {
  loadFixture,
  setFixtureContent,
  captureOriginalTargetForFixture,
  mutationContextForFixture,
} from "../fixtures/fixture-loader.js";
import { getMutation } from "../mutations/registry.js";
import type { MutationId, MutationContext } from "../mutations/types.js";
import { resolveLocator } from "../runner/locator-resolver.js";
import { isSameElement } from "../oracle/identity-compare.js";
import { captureCustomTarget } from "../oracle/custom-target.js";
import type { CustomTargetDescriptor } from "../contracts/custom-scenario.js";
import type { LocatorSpecV1 } from "../contracts/locator.js";
import { classifyVerdict } from "../verdict/classify.js";
import type { BfsEvaluator } from "./bfs.js";
import { domStateKey, planStateKey } from "./state-key.js";

export interface BrowserEvaluatorOptions {
  manifest: FixtureManifest;
}

/**
 * Build a BFS evaluator bound to one fixture and one Playwright page.
 * The caller owns the page (launch/close); the evaluator only calls
 * setContent / evaluate / resolve on it, and performs no navigation and
 * no network access beyond what the page's own route handler allows.
 */
export function createBrowserEvaluator(
  page: Page,
  manifest: FixtureManifest,
): BfsEvaluator {
  const fixture = loadFixture(manifest.fixtureId);
  const ctx = mutationContextForFixture(manifest);

  return async (sequence: readonly MutationId[]) => {
    try {
      await setFixtureContent(page, fixture);
      const original = await captureOriginalTargetForFixture(page, manifest);
      for (const mutationId of sequence) {
        const mutation = getMutation(mutationId);
        await mutation.apply(page, original, ctx);
      }
      const html = await page.evaluate(
        () => document.documentElement.outerHTML,
      );
      const stateKey = domStateKey(manifest.fixtureId, html);

      const { result, finalHandle } = await resolveLocator(
        page,
        manifest.locator,
      );
      let identityMatch: boolean | null = null;
      if (
        result.executionStatus === "COMPLETED" &&
        result.finalMatchCount === 1 &&
        finalHandle !== null
      ) {
        identityMatch = await isSameElement(page, finalHandle, original);
      }
      const classification = classifyVerdict(result, identityMatch);
      return {
        verdict: classification.verdict,
        analysisStatus: classification.analysisStatus,
        stateKey,
      };
    } catch {
      // No verdict may be claimed from a failed evaluation. Snapshot
      // if the DOM is still readable; otherwise fall back to the plan
      // hash so repeated failures of the same sequence still dedup.
      let stateKey: string;
      try {
        const html = await page.evaluate(
          () => document.documentElement.outerHTML,
        );
        stateKey = domStateKey(manifest.fixtureId, html);
      } catch {
        stateKey = planStateKey(manifest.fixtureId, sequence);
      }
      return { verdict: null, analysisStatus: "INCOMPLETE", stateKey };
    }
  };
}

export interface CustomEvaluatorInput {
  /** Run id used for BFS state keys (scenario_id, or "custom"). */
  runId: string;
  /** User-supplied synthetic HTML (already safety-validated). */
  html: string;
  /** Locator under test. */
  locator: LocatorSpecV1;
  /** Private target descriptor — Oracle use only, never shown to the locator. */
  target: CustomTargetDescriptor;
  /** Mutation context (m03Token derived from the target's first class token). */
  ctx: MutationContext;
}

/**
 * FIX-R1-01 — BFS evaluator for a custom scenario. Mirrors
 * createBrowserEvaluator step for step (reset from the scenario HTML
 * -> capture the original target via the private descriptor -> apply
 * mutations in sequence order -> resolve the locator -> identity
 * compare on exactly one final match -> classify), but the target
 * comes from the user's private descriptor instead of a frozen
 * manifest. The fixture evaluator above is untouched; this function
 * has its own body so the frozen 192-case path cannot drift.
 *
 * A target that stops resolving mid-search (e.g. a mutation removed
 * it — which cannot happen for M01–M08, they never delete the
 * target — or the page errored) yields verdict null / INCOMPLETE,
 * never a disguised verdict, exactly like the fixture evaluator.
 */
export function createBrowserEvaluatorForCustom(
  page: Page,
  input: CustomEvaluatorInput,
): BfsEvaluator {
  return async (sequence: readonly MutationId[]) => {
    try {
      await page.setContent(input.html);
      const original = await captureCustomTarget(page, input.target);
      for (const mutationId of sequence) {
        const mutation = getMutation(mutationId);
        await mutation.apply(page, original, input.ctx);
      }
      const html = await page.evaluate(
        () => document.documentElement.outerHTML,
      );
      const stateKey = domStateKey(input.runId, html);

      const { result, finalHandle } = await resolveLocator(
        page,
        input.locator,
      );
      let identityMatch: boolean | null = null;
      if (
        result.executionStatus === "COMPLETED" &&
        result.finalMatchCount === 1 &&
        finalHandle !== null
      ) {
        identityMatch = await isSameElement(page, finalHandle, original);
      }
      const classification = classifyVerdict(result, identityMatch);
      return {
        verdict: classification.verdict,
        analysisStatus: classification.analysisStatus,
        stateKey,
      };
    } catch {
      let stateKey: string;
      try {
        const html = await page.evaluate(
          () => document.documentElement.outerHTML,
        );
        stateKey = domStateKey(input.runId, html);
      } catch {
        stateKey = planStateKey(input.runId, sequence);
      }
      return { verdict: null, analysisStatus: "INCOMPLETE", stateKey };
    }
  };
}
