# REVIEW_PACK_04 — 变异算子 M01–M08 与 Fixture 加载

审查 commit：`a78d765`。本包为审查时原文逐字拼接（机械拼接，内容未经改写），每个文件附行数、字节数与 SHA-256；审查结论见 `INDEPENDENT_REVIEW.md`。

## src/mutations/types.ts

- 行数：24；字节数：604；SHA-256：`8e3df5b04e567cc1295f39ccd7874af7c760ee2fb51f2fb4f73b54c23149ecd2`

```ts
// Operator types and shared constants for the P022 mutation set (fixed semantics, no wall-clock/randomness).
import type { ElementHandle, Page } from "playwright";

export type MutationId = "M01" | "M02" | "M03" | "M04" | "M05" | "M06" | "M07" | "M08";

export interface MutationContext {
  fixtureId: string;
  seed: string;
  m03Token: string;
  framePath: string[];
  newText: string;
}

export type MutationApply = (
  page: Page,
  target: ElementHandle,
  ctx: MutationContext,
) => Promise<void>;

export interface MutationDefinition {
  id: MutationId;
  name: string;
  apply: MutationApply;
}
```

## src/mutations/registry.ts

- 行数：36；字节数：1070；SHA-256：`0d6f958a6829a11b53750feac0a56eca712474b9a2c59a2f30bb018fdb8dd79e`

```ts
// Mutation registry: fixed order and lookup for M01..M08.
import type { MutationDefinition, MutationId } from "./types.js";
import { wrapTarget } from "./M01-wrap-target.js";
import { reorderSiblings } from "./M02-reorder-siblings.js";
import { changeClass } from "./M03-change-class.js";
import { insertSameName } from "./M04-insert-same-name.js";
import { nestedIframe } from "./M05-nested-iframe.js";
import { moveToOpenShadowRoot } from "./M06-open-shadow-root.js";
import { insertHiddenDuplicate } from "./M07-hidden-duplicate.js";
import { changeText } from "./M08-change-text.js";

export const MUTATION_ORDER: MutationId[] = [
  "M01",
  "M02",
  "M03",
  "M04",
  "M05",
  "M06",
  "M07",
  "M08",
];

export const MUTATIONS: Readonly<Record<MutationId, MutationDefinition>> = {
  M01: wrapTarget,
  M02: reorderSiblings,
  M03: changeClass,
  M04: insertSameName,
  M05: nestedIframe,
  M06: moveToOpenShadowRoot,
  M07: insertHiddenDuplicate,
  M08: changeText,
};

export function getMutation(id: MutationId): MutationDefinition {
  return MUTATIONS[id];
}
```

## src/mutations/index.ts

- 行数：11；字节数：565；SHA-256：`52b478f37812bb19577930af9b00eabcb10099626ebaebf5d5845e7db65ae0e8`

```ts
// Public barrel for the mutation module.
export * from "./types.js";
export * from "./registry.js";
export { wrapTarget } from "./M01-wrap-target.js";
export { reorderSiblings } from "./M02-reorder-siblings.js";
export { changeClass } from "./M03-change-class.js";
export { insertSameName } from "./M04-insert-same-name.js";
export { nestedIframe } from "./M05-nested-iframe.js";
export { moveToOpenShadowRoot } from "./M06-open-shadow-root.js";
export { insertHiddenDuplicate } from "./M07-hidden-duplicate.js";
export { changeText } from "./M08-change-text.js";
```

## src/mutations/M01-wrap-target.ts

- 行数：19；字节数：580；SHA-256：`6ed94e7b141466bfd5c380f29e33dffa05fa580cce63e9d7dd6d6d96047bb0fc`

```ts
// M01 WRAP_TARGET: insert a div.wrap before the target in its parent, then move the target inside it.
import type { MutationDefinition } from "./types.js";

export const wrapTarget: MutationDefinition = {
  id: "M01",
  name: "WRAP_TARGET",
  apply: async (_page, target, _ctx) => {
    await target.evaluate((el: Element) => {
      const parent = el.parentNode;
      if (!parent) {
        return;
      }
      const wrap = el.ownerDocument.createElement("div");
      wrap.className = "wrap";
      parent.insertBefore(wrap, el);
      wrap.appendChild(el);
    });
  },
};
```

## src/mutations/M02-reorder-siblings.ts

- 行数：20；字节数：690；SHA-256：`7f4b23cec7dfb70ff6158bb7d11289afa509254020789eba808ab699abd32df4`

```ts
// M02 REORDER_SIBLINGS: swap the target with its next element sibling, else previous element sibling, via one insertBefore.
import type { MutationDefinition } from "./types.js";

export const reorderSiblings: MutationDefinition = {
  id: "M02",
  name: "REORDER_SIBLINGS",
  apply: async (_page, target, _ctx) => {
    await target.evaluate((el: Element) => {
      const parent = el.parentNode;
      if (!parent) {
        return;
      }
      if (el.nextElementSibling) {
        parent.insertBefore(el, el.nextElementSibling.nextElementSibling ?? null);
      } else if (el.previousElementSibling) {
        parent.insertBefore(el, el.previousElementSibling);
      }
    });
  },
};
```

## src/mutations/M03-change-class.ts

- 行数：14；字节数：486；SHA-256：`ecf77aba71fb3886e64bd222d31cb87ac6091392125fa214942f835f7451d7e2`

```ts
// M03 CHANGE_CLASS: if the target's class list contains ctx.m03Token, replace it with token + "-changed".
import type { MutationDefinition } from "./types.js";

export const changeClass: MutationDefinition = {
  id: "M03",
  name: "CHANGE_CLASS",
  apply: async (_page, target, ctx) => {
    await target.evaluate((el: Element, token: string) => {
      if (el.classList.contains(token)) {
        el.classList.replace(token, token + "-changed");
      }
    }, ctx.m03Token);
  },
};
```

## src/mutations/M04-insert-same-name.ts

- 行数：27；字节数：905；SHA-256：`803f15a9fbb55cfcd47a607479286b0ad8ee3256e8e10df9644dd64c592ba304`

```ts
// M04 INSERT_SAME_NAME: insert a fresh decoy before the target with same tag, class, textContent, aria-label (if any).
import type { MutationDefinition } from "./types.js";

export const insertSameName: MutationDefinition = {
  id: "M04",
  name: "INSERT_SAME_NAME",
  apply: async (_page, target, _ctx) => {
    await target.evaluate((el: Element) => {
      const parent = el.parentNode;
      if (!parent) {
        return;
      }
      const doc = el.ownerDocument;
      const decoy = doc.createElement(el.tagName);
      const classAttr = el.getAttribute("class");
      if (classAttr !== null) {
        decoy.setAttribute("class", classAttr);
      }
      decoy.textContent = el.textContent;
      const ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel !== null) {
        decoy.setAttribute("aria-label", ariaLabel);
      }
      parent.insertBefore(decoy, el);
    });
  },
};
```

## src/mutations/M05-nested-iframe.ts

- 行数：31；字节数：1093；SHA-256：`439166d89ca9167320157a49c03bd3a3ec652390b55eb69f2fdf47651f3b9724`

```ts
// M05 NESTED_IFRAME: append a srcdoc-only iframe last in the first frame's parent, or in body when framePath is empty.
import type { MutationDefinition } from "./types.js";

export const nestedIframe: MutationDefinition = {
  id: "M05",
  name: "NESTED_IFRAME",
  apply: async (page, _target, ctx) => {
    if (ctx.framePath.length > 0) {
      const selector = ctx.framePath[0];
      await page.evaluate((sel: string) => {
        const frameEl = document.querySelector(sel);
        if (!frameEl || !frameEl.parentNode) {
          return;
        }
        const iframe = document.createElement("iframe");
        const classAttr = frameEl.getAttribute("class");
        if (classAttr !== null) {
          iframe.setAttribute("class", classAttr);
        }
        iframe.srcdoc = "<button>Decoy</button>";
        frameEl.parentNode.appendChild(iframe);
      }, selector);
      return;
    }
    await page.evaluate(() => {
      const iframe = document.createElement("iframe");
      iframe.srcdoc = "<button>Decoy</button>";
      document.body.appendChild(iframe);
    });
  },
};
```

## src/mutations/M06-open-shadow-root.ts

- 行数：20；字节数：687；SHA-256：`c97e6b5f60b3be105a6b4812a0a5bb62fc26469444a570da6d4efb1f6838cb83`

```ts
// M06 MOVE_TO_OPEN_SHADOW_ROOT: insert div.m06-shadow-host before target, attach open shadow root, move target inside.
import type { MutationDefinition } from "./types.js";

export const moveToOpenShadowRoot: MutationDefinition = {
  id: "M06",
  name: "MOVE_TO_OPEN_SHADOW_ROOT",
  apply: async (_page, target, _ctx) => {
    await target.evaluate((el: Element) => {
      const parent = el.parentNode;
      if (!parent) {
        return;
      }
      const host = el.ownerDocument.createElement("div");
      host.className = "m06-shadow-host";
      parent.insertBefore(host, el);
      const root = host.attachShadow({ mode: "open" });
      root.appendChild(el);
    });
  },
};
```

## src/mutations/M07-hidden-duplicate.ts

- 行数：29；字节数：992；SHA-256：`ad2fcf52a5102c8f1ea3af618f0734d333cba961274df00d61eedec8f4361849`

```ts
// M07 INSERT_HIDDEN_DUPLICATE: like M04 but decoy is display:none and aria-hidden="true".
import type { MutationDefinition } from "./types.js";

export const insertHiddenDuplicate: MutationDefinition = {
  id: "M07",
  name: "INSERT_HIDDEN_DUPLICATE",
  apply: async (_page, target, _ctx) => {
    await target.evaluate((el: Element) => {
      const parent = el.parentNode;
      if (!parent) {
        return;
      }
      const doc = el.ownerDocument;
      const decoy = doc.createElement(el.tagName);
      const classAttr = el.getAttribute("class");
      if (classAttr !== null) {
        decoy.setAttribute("class", classAttr);
      }
      decoy.textContent = el.textContent;
      const ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel !== null) {
        decoy.setAttribute("aria-label", ariaLabel);
      }
      (decoy as HTMLElement).style.display = "none";
      decoy.setAttribute("aria-hidden", "true");
      parent.insertBefore(decoy, el);
    });
  },
};
```

## src/mutations/M08-change-text.ts

- 行数：12；字节数：385；SHA-256：`13000b3a18746859603f45874cc91ec5c485a016af57e1c14dcb90832ed429ef`

```ts
// M08 CHANGE_TEXT: set the target's textContent to ctx.newText (attributes untouched).
import type { MutationDefinition } from "./types.js";

export const changeText: MutationDefinition = {
  id: "M08",
  name: "CHANGE_TEXT",
  apply: async (_page, target, ctx) => {
    await target.evaluate((el: Element, text: string) => {
      el.textContent = text;
    }, ctx.newText);
  },
};
```

## src/fixtures/fixture-loader.ts

- 行数：106；字节数：2858；SHA-256：`1bef5b9f0eb3f10dedbe14ac711db45d188793ccc9312bc1b41f4699d489d9e6`

```ts
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
```

## src/fixtures/fixture-manifest.ts

- 行数：239；字节数：6824；SHA-256：`fb99681e7b559431796675dfedf702ee624927740060d2cf043eb015efcf2607`

```ts
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
```
