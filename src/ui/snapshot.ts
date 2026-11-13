// T009 — DOM snapshots for the Web UI (display only).
//
// The Mutation Lab and BFS Witness views need the *actual* mutated DOM,
// not a hand-written description of what a mutation "should" do. This
// module produces it by running the FROZEN mutation registry against a
// real Playwright page, exactly as the analysis service does — load the
// fixture, capture the original target via the private manifest, apply
// the requested sequence step by step, and serialise the DOM after each
// step. It returns HTML text only: no verdict, no score, no identity
// judgement. Verdicts/scores/witnesses always come from the frozen API.
//
// Shadow DOM: M06 moves the target into an open ShadowRoot, which a
// plain outerHTML serialisation would hide. Serialisation therefore
// uses getInnerHTML({ includeShadowRoots: true }) when the browser
// offers it, so shadow content appears as
// <template shadowrootmode="open">…</template> in the snapshot.
//
// Concurrency: one page is shared, so calls are serialised through a
// promise-chain mutex (same pattern as the analysis service).

import type { Page } from "playwright";

import {
  captureOriginalTargetForFixture,
  loadFixture,
  mutationContextForFixture,
  setFixtureContent,
} from "../fixtures/fixture-loader.js";
import {
  MAX_CUSTOM_DOM_NODES,
  normalizeCustomScenario,
  validateCustomScenarioForRun,
} from "../contracts/custom-scenario.js";
import {
  captureCustomTarget,
  readTargetClassToken,
} from "../oracle/custom-target.js";
import { SEED } from "../canonical/hashes.js";
import { MUTATION_ORDER, getMutation } from "../mutations/registry.js";
import type { MutationContext, MutationId } from "../mutations/types.js";
import { withPageJavaScriptDisabled } from "../runner/browser.js";

export interface DomSnapshotStep {
  /** null = baseline (original DOM, before any mutation). */
  mutationId: MutationId | null;
  html: string;
}

export interface DomSnapshot {
  fixtureId: string;
  sequence: MutationId[];
  /** steps[0] is the baseline; steps[i+1] is the DOM after sequence[i]. */
  steps: DomSnapshotStep[];
}

const FIXTURE_ID_PATTERN = /^F0(0[1-9]|1[0-9]|2[0-4])$/;

export function validateSnapshotSequence(
  sequence: unknown,
): MutationId[] {
  if (!Array.isArray(sequence)) {
    throw new Error("sequence must be an array of M01–M08");
  }
  if (sequence.length > 6) {
    throw new Error(
      `sequence has ${sequence.length} steps (BFS depth cap is 6)`,
    );
  }
  const out: MutationId[] = [];
  for (const id of sequence) {
    if (
      typeof id !== "string" ||
      !(MUTATION_ORDER as readonly string[]).includes(id)
    ) {
      throw new Error(`unknown mutationId ${JSON.stringify(id)} (expected M01–M08)`);
    }
    if (out.includes(id as MutationId)) {
      throw new Error(
        `sequence repeats ${id}: one use per operator per sequence (BFS rule)`,
      );
    }
    out.push(id as MutationId);
  }
  return out;
}

export function validateFixtureId(fixtureId: unknown): string {
  if (typeof fixtureId !== "string" || !FIXTURE_ID_PATTERN.test(fixtureId)) {
    throw new Error(
      `fixtureId must match /^F0(0[1-9]|1[0-9]|2[0-4])$/, got ${JSON.stringify(fixtureId)}`,
    );
  }
  return fixtureId;
}

/** Serialise the current DOM, including open shadow roots when possible. */
async function serializeDom(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const candidate = root as unknown as {
      getInnerHTML?: (options: { includeShadowRoots: boolean }) => string;
    };
    if (typeof candidate.getInnerHTML === "function") {
      return `<!doctype html>\n<html>${candidate.getInnerHTML({ includeShadowRoots: true })}</html>`;
    }
    return root.outerHTML;
  });
}

export interface DomSnapshotter {
  snapshot(fixtureId: string, sequence: readonly MutationId[]): Promise<DomSnapshot>;
  /** FIX-R1-01: same DOM steps for a user-supplied custom scenario. */
  snapshotCustom(scenario: unknown, sequence: readonly MutationId[]): Promise<DomSnapshot>;
}

/**
 * Build a snapshotter around one dedicated Playwright page. The caller
 * owns the page lifecycle; the snapshotter never closes it and never
 * navigates outside setContent on that page.
 */
export function createDomSnapshotter(page: Page): DomSnapshotter {
  let chain: Promise<unknown> = Promise.resolve();

  function runExclusive<T>(work: () => Promise<T>): Promise<T> {
    const task = chain.then(work, work);
    chain = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  return {
    async snapshot(
      fixtureId: string,
      sequence: readonly MutationId[],
    ): Promise<DomSnapshot> {
      return runExclusive(async () => {
        const id = validateFixtureId(fixtureId);
        const seq = validateSnapshotSequence([...sequence]);
        const fixture = loadFixture(id);
        const ctx = mutationContextForFixture(fixture.manifest);
        await setFixtureContent(page, fixture);
        const original = await captureOriginalTargetForFixture(
          page,
          fixture.manifest,
        );
        const steps: DomSnapshotStep[] = [
          { mutationId: null, html: await serializeDom(page) },
        ];
        for (const mutationId of seq) {
          await getMutation(mutationId).apply(page, original, ctx);
          steps.push({ mutationId, html: await serializeDom(page) });
        }
        return { fixtureId: id, sequence: seq, steps };
      });
    },

    async snapshotCustom(
      scenario: unknown,
      sequence: readonly MutationId[],
    ): Promise<DomSnapshot> {
      return runExclusive(async () => {
        // FIX-R2-01: the whole custom snapshot runs with page
        // JavaScript disabled (same defence as the service's custom
        // branches — every setContent of user HTML happens inside).
        return withPageJavaScriptDisabled(page, async () => {
          const errors = validateCustomScenarioForRun(scenario);
          if (errors.length > 0) {
            throw new Error(`invalid custom scenario: ${errors.join("; ")}`);
          }
          const parsed = normalizeCustomScenario(scenario);
          const seq = validateSnapshotSequence([...sequence]);
          await page.setContent(parsed.html);
          const nodeCount = await page.evaluate(
            () => document.querySelectorAll("*").length,
          );
          if (nodeCount > MAX_CUSTOM_DOM_NODES) {
            throw new Error(
              `custom scenario HTML has ${nodeCount} elements (max ${MAX_CUSTOM_DOM_NODES})`,
            );
          }
          const original = await captureCustomTarget(page, parsed.target);
          const m03Token = await readTargetClassToken(original);
          const ctx: MutationContext = {
            fixtureId: parsed.scenario_id,
            seed: SEED,
            m03Token,
            framePath: [...(parsed.locator.framePath ?? [])],
            newText: "Changed Text",
          };
          const steps: DomSnapshotStep[] = [
            { mutationId: null, html: await serializeDom(page) },
          ];
          for (const mutationId of seq) {
            await getMutation(mutationId).apply(page, original, ctx);
            steps.push({ mutationId, html: await serializeDom(page) });
          }
          return { fixtureId: parsed.scenario_id, sequence: seq, steps };
        });
      });
    },
  };
}
