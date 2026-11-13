// FIX-R1-01 — Custom synthetic scenario contract (P022-R1-P1-01).
//
// A custom scenario is a user-supplied `locatorstress.scenario/v1`
// document (§11.2) PLUS a private target descriptor. The target
// descriptor is the custom-input analogue of the frozen fixtures'
// `privateTargetPath` (§11.3): it tells the Oracle — and ONLY the
// Oracle — which DOM node is the original target. It is never written
// into the page DOM, never exposed through the API, and never handed
// to the locator under test. Target identity is always established by
// Node-side ElementHandle comparison (oracle/identity-compare.ts),
// exactly as for frozen fixtures.
//
// Safety bounds (PROJECT_BOOK §13 — HTML is text, never executed):
//   - synthetic HTML only: no <script>, no external URLs, no
//     event-handler attributes, no javascript: URIs, no <link>/<base>/
//     <object>/<embed>, no <iframe src=> (srcdoc only), no refresh meta.
//     Anything matching the denylist is rejected — fail closed.
//     FIX-R2-01: the denylist is a regex first pass only; a structured
//     tokenizer second pass (validateCustomHtmlStructure) judges tags
//     and attributes by parsed meaning, so self-closing `<script/>`,
//     SVG scripts, srcdoc scripts and unquoted values are caught too.
//   - execution layer: every custom run / custom snapshot executes
//     with page JavaScript disabled via withPageJavaScriptDisabled
//     (runner/browser.ts, CDP Emulation.setScriptExecutionDisabled,
//     scoped to the custom page work only), so even a validation miss
//     cannot execute user JavaScript; the lab's own JS runs via CDP
//     page.evaluate, which the toggle does not block. A blanket
//     javaScriptEnabled:false on the runner context is NOT used: the
//     T001 oracle probe needs page timers / image events, which page
//     JavaScript being disabled would stall forever.
//   - size: at most MAX_CUSTOM_HTML_BYTES of UTF-8 HTML.
//   - DOM nodes: at most MAX_CUSTOM_DOM_NODES elements after setContent
//     (checked at run time, in the service preflight).
//   - BFS bounds are the frozen caps (depth <= 6, states <= 4096).
//
// Validation layers:
//   - validateCustomScenarioShape() — shape + safety; used by
//     /api/validate (target optional there, so a scenario without a
//     target can still be shape-checked — frozen behaviour).
//   - validateCustomScenarioForRun() — shape + safety + target
//     REQUIRED; used by /api/analyze and /api/search before any
//     browser work. A scenario that fails here is a 400, never a
//     silent fall back to a fixture locator.
//   - Target resolvability (exactly one match) is checked at run time
//     against the live DOM (oracle/custom-target.ts) and fails closed
//     with 422 when the target is missing or ambiguous.

import { SEED } from "../canonical/hashes.js";
import { MUTATION_ORDER } from "../mutations/registry.js";
import type { MutationId } from "../mutations/types.js";
import type { LocatorSpecV1 } from "./locator.js";
import { validateLocatorSpec } from "./locator.js";

/** Max user-supplied HTML, UTF-8 bytes (fail closed above this). */
export const MAX_CUSTOM_HTML_BYTES = 128 * 1024;

/** Max elements in the custom DOM after setContent (run-time check). */
export const MAX_CUSTOM_DOM_NODES = 2000;

/** Fallback run id when the scenario carries no scenario_id. */
export const CUSTOM_RUN_ID = "custom";

export interface CustomTargetDescriptor {
  /** Private CSS selector the Oracle resolves; never shown to the locator. */
  css: string;
  /** 0–2 iframe CSS selectors when the target lives inside (nested) iframes. */
  framePath?: string[];
  /** CSS selector of the open shadow host when the target lives in a shadow root. */
  shadowHost?: string;
}

export interface CustomScenarioV1 {
  schema: "locatorstress.scenario/v1";
  scenario_id: string;
  seed: string;
  html: string;
  locator: LocatorSpecV1;
  target: CustomTargetDescriptor;
  mutation_suite: MutationId[];
  bfs: { max_depth: number; max_expanded_states: number };
}

const SCENARIO_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Fail-closed denylist for user-supplied HTML. Each entry is a
 * case-insensitive pattern for something that would let the "synthetic
 * HTML" escape the lab: a script, an external resource, or a
 * navigation. The check runs on the raw HTML string, so srcdoc
 * payloads are scanned too (they are part of the same string).
 *
 * FIX-R2-01: this regex layer is only the FIRST pass. It cannot be
 * the whole defence — see validateCustomHtmlStructure below for why
 * (P022-R2-P1-01: `<script/>`, unquoted URLs, no-space handlers and
 * entity-obfuscated schemes all slip past plain-text patterns). The
 * regex layer is kept as defence in depth: it also scans text the
 * tokenizer deliberately skips (comments, CDATA, raw-text elements).
 */
const FORBIDDEN_HTML_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  reason: string;
}> = [
  { pattern: /<script[\s>]/i, reason: "script elements are not allowed in custom HTML" },
  { pattern: /<link[\s>]/i, reason: "link elements are not allowed in custom HTML" },
  { pattern: /<base[\s>]/i, reason: "base elements are not allowed in custom HTML" },
  { pattern: /<object[\s>]/i, reason: "object elements are not allowed in custom HTML" },
  { pattern: /<embed[\s>]/i, reason: "embed elements are not allowed in custom HTML" },
  {
    pattern: /<meta[^>]*http-equiv\s*=\s*["']?refresh/i,
    reason: "refresh meta elements are not allowed in custom HTML",
  },
  {
    pattern: /<iframe[^>]*\ssrc\s*=/i,
    reason: "iframe src= is not allowed in custom HTML (use srcdoc only)",
  },
  {
    // Any URL-bearing attribute pointing off-page (absolute or
    // protocol-relative). Covers src/href/action/poster/cite/data.
    pattern: /(?:src|href|action|poster|cite|data)\s*=\s*["']\s*(?:https?:)?\/\//i,
    reason: "external URLs are not allowed in custom HTML (synthetic HTML only)",
  },
  {
    pattern: /javascript\s*:/i,
    reason: "javascript: URIs are not allowed in custom HTML",
  },
  {
    pattern: /url\s*\(/i,
    reason: "url(...) references are not allowed in custom HTML",
  },
  { pattern: /@import/i, reason: "@import is not allowed in custom HTML" },
  {
    // Inline event handlers (onclick=, onerror=, ...).
    pattern: /\son\w+\s*=/i,
    reason: "inline event-handler attributes are not allowed in custom HTML",
  },
];

/** Safety checks on the raw HTML string (size + denylist + structure). */
export function validateCustomHtmlSafety(html: unknown): string[] {
  const errors: string[] = [];
  if (typeof html !== "string" || html.length === 0) {
    errors.push("scenario.html must be a non-empty string");
    return errors;
  }
  if (new TextEncoder().encode(html).length > MAX_CUSTOM_HTML_BYTES) {
    errors.push(
      `scenario.html exceeds ${MAX_CUSTOM_HTML_BYTES} bytes (synthetic HTML only)`,
    );
  }
  for (const { pattern, reason } of FORBIDDEN_HTML_PATTERNS) {
    if (pattern.test(html)) {
      errors.push(reason);
    }
  }
  // FIX-R2-01: structured second pass (see below). Reasons are
  // deduplicated so a payload caught by both layers is reported once.
  errors.push(...validateCustomHtmlStructure(html));
  return [...new Set(errors)];
}

// ---- FIX-R2-01: structured HTML safety parsing (P022-R2-P1-01) ----
//
// Why regex alone is insufficient: a denylist of string patterns
// cannot enumerate every spelling the HTML parser accepts. The R2
// bypasses prove it:
//   - `<script/>` — the script regex required `[\s>]` after the tag
//     name, so a self-closing slash slipped through;
//   - `src=https://...` — the external-URL regex required a quote;
//   - `<img src="x"onerror=...>` — the handler regex required
//     whitespace before `on*`;
//   - `java&#115;cript:` — an entity-obfuscated scheme is invisible
//     to a plain-text scan but decodes to `javascript:` in the parser.
// A real tokenizer sees what the browser's parser sees: tag names
// regardless of case, whitespace or a self-closing slash; attributes
// regardless of quoting; values after entity decoding. Deliberate
// over-approximation: a `<script>` start tag is rejected wherever it
// appears (even inside <template>/<noscript>), because synthetic lab
// HTML never needs one. No new dependency: the tokenizer below is
// ~100 lines of dependency-free TypeScript.

interface ParsedHtmlAttribute {
  name: string;
  value: string;
}

interface ParsedHtmlElement {
  tag: string;
  attrs: ParsedHtmlAttribute[];
}

/** Max recursion depth when scanning nested iframe srcdoc documents. */
const MAX_SRCDOC_DEPTH = 3;

/** Attributes that carry a URL which must stay on-page (synthetic HTML only). */
const URL_BEARING_ATTRIBUTES: ReadonlySet<string> = new Set([
  "src",
  "href",
  "action",
  "poster",
  "cite",
  "data",
  "formaction",
  "srcset",
  "background",
  "longdesc",
]);

const STRUCTURAL_REASONS = {
  script: "script elements are not allowed in custom HTML",
  link: "link elements are not allowed in custom HTML",
  base: "base elements are not allowed in custom HTML",
  object: "object elements are not allowed in custom HTML",
  embed: "embed elements are not allowed in custom HTML",
  refresh: "refresh meta elements are not allowed in custom HTML",
  iframeSrc: "iframe src= is not allowed in custom HTML (use srcdoc only)",
  external:
    "external URLs are not allowed in custom HTML (synthetic HTML only)",
  javascript: "javascript: URIs are not allowed in custom HTML",
  dataHtml: "data:text/html URIs are not allowed in custom HTML",
  handler: "inline event-handler attributes are not allowed in custom HTML",
  srcdocDepth: "iframe srcdoc nesting is too deep in custom HTML",
} as const;

const FORBIDDEN_TAGS: Readonly<Record<string, string>> = {
  script: STRUCTURAL_REASONS.script,
  link: STRUCTURAL_REASONS.link,
  base: STRUCTURAL_REASONS.base,
  object: STRUCTURAL_REASONS.object,
  embed: STRUCTURAL_REASONS.embed,
};

/**
 * Decode the HTML entities that can smuggle a scheme past a
 * plain-text scan (e.g. `java&#115;cript:` decodes to `javascript:`).
 * Single pass only — that matches browser parsing, which decodes
 * each entity reference exactly once.
 */
function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(#(?:[xX][0-9a-fA-F]+|\d+)|[a-zA-Z][a-zA-Z0-9]+);/g,
    (whole: string, body: string) => {
      if (body.startsWith("#")) {
        const isHex = body[1] === "x" || body[1] === "X";
        const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
        if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
          return String.fromCodePoint(code);
        }
        return whole;
      }
      switch (body.toLowerCase()) {
        case "amp":
          return "&";
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "quot":
          return '"';
        case "apos":
          return "'";
        case "colon":
          return ":";
        case "tab":
          return "\t";
        case "newline":
          return "\n";
        default:
          return whole;
      }
    },
  );
}

/**
 * Minimal HTML tokenizer: walks start tags and their attributes the
 * way the browser parser does — tag names case-insensitively,
 * attributes in double / single / no quotes, self-closing slashes,
 * and `>` inside quoted values not ending the tag. Comments,
 * doctypes, CDATA sections and closing tags are skipped (the regex
 * layer still scans their raw text). Text content is never
 * tokenized, so escaped markup (`&lt;script&gt;`) is not mistaken
 * for a tag.
 */
function tokenizeHtmlElements(html: string): ParsedHtmlElement[] {
  const elements: ParsedHtmlElement[] = [];
  const len = html.length;
  let i = 0;
  while (i < len) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;
    i = lt + 1;
    if (i >= len) break;
    const ch = html[i]!;
    if (ch === "!") {
      if (html.startsWith("--", i + 1)) {
        const end = html.indexOf("-->", i + 3);
        i = end === -1 ? len : end + 3;
      } else if (html.startsWith("[CDATA[", i + 1)) {
        const end = html.indexOf("]]>", i + 8);
        i = end === -1 ? len : end + 3;
      } else {
        const end = html.indexOf(">", i + 1);
        i = end === -1 ? len : end + 1;
      }
      continue;
    }
    if (ch === "/" || ch === "?") {
      const end = html.indexOf(">", i + 1);
      i = end === -1 ? len : end + 1;
      continue;
    }
    if (!/[A-Za-z]/.test(ch)) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < len && /[A-Za-z0-9:-]/.test(html[j]!)) j += 1;
    const tag = html.slice(i, j).toLowerCase();
    const attrs: ParsedHtmlAttribute[] = [];
    i = j;
    while (i < len) {
      while (i < len && /\s/.test(html[i]!)) i += 1;
      if (i >= len) break;
      if (html[i] === ">") {
        i += 1;
        break;
      }
      if (html[i] === "/") {
        if (html[i + 1] === ">") {
          i += 2;
          break;
        }
        i += 1;
        continue;
      }
      let a = i;
      while (a < len && !/[\s=/>]/.test(html[a]!)) a += 1;
      if (a === i) {
        i += 1;
        continue;
      }
      const name = html.slice(i, a).toLowerCase();
      i = a;
      while (i < len && /\s/.test(html[i]!)) i += 1;
      let value = "";
      if (html[i] === "=") {
        i += 1;
        while (i < len && /\s/.test(html[i]!)) i += 1;
        const quote = html[i];
        if (quote === '"' || quote === "'") {
          i += 1;
          const start = i;
          const end = html.indexOf(quote, i);
          if (end === -1) {
            // Unterminated quote: fail closed, treat the rest as the value.
            value = html.slice(start);
            i = len;
          } else {
            value = html.slice(start, end);
            i = end + 1;
          }
        } else {
          const start = i;
          while (i < len && !/[\s>]/.test(html[i]!)) i += 1;
          value = html.slice(start, i);
        }
      }
      attrs.push({ name, value });
    }
    elements.push({ tag, attrs });
  }
  return elements;
}

/** True when a (decoded) attribute value points off-page. */
function isExternalUrlValue(rawValue: string): boolean {
  const value = decodeHtmlEntities(rawValue)
    .trim()
    .replace(/^[\u0000-\u0020]+/, "");
  const lower = value.toLowerCase();
  return (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("//")
  );
}

/**
 * Classifies a (decoded, whitespace/control-stripped) attribute value
 * as a script-carrying URI scheme. Stripping the whitespace matches
 * what browsers do with schemes (`java\tscript:` still runs).
 */
function scriptUriKind(rawValue: string): "javascript" | "data-html" | null {
  const decoded = decodeHtmlEntities(rawValue)
    .replace(/[\u0000-\u0020]+/g, "")
    .toLowerCase();
  if (decoded.startsWith("javascript:") || decoded.startsWith("vbscript:")) {
    return "javascript";
  }
  if (decoded.startsWith("data:text/html")) {
    return "data-html";
  }
  return null;
}

/**
 * Structural safety check: tokenize the HTML and judge each element
 * and attribute by its parsed meaning, not by its spelling. Catches
 * the forms the regex layer misses: self-closing `<script/>`,
 * scripts inside SVG/MathML foreign content, `srcdoc` documents
 * carrying scripts (recursed into, entity-decoded first), event
 * handlers and external URLs in any quoting (including unquoted and
 * no-space-after-quote), and entity-obfuscated `javascript:` URIs.
 */
function validateCustomHtmlStructure(html: string, depth = 0): string[] {
  const errors: string[] = [];
  if (depth > MAX_SRCDOC_DEPTH) {
    return [STRUCTURAL_REASONS.srcdocDepth];
  }
  for (const { tag, attrs } of tokenizeHtmlElements(html)) {
    const forbidden = FORBIDDEN_TAGS[tag];
    if (forbidden !== undefined) {
      errors.push(forbidden);
    }
    if (tag === "meta") {
      const httpEquiv = attrs.find((a) => a.name === "http-equiv");
      if (
        httpEquiv !== undefined &&
        decodeHtmlEntities(httpEquiv.value).trim().toLowerCase() === "refresh"
      ) {
        errors.push(STRUCTURAL_REASONS.refresh);
      }
    }
    if (tag === "iframe") {
      if (attrs.some((a) => a.name === "src")) {
        errors.push(STRUCTURAL_REASONS.iframeSrc);
      }
      const srcdoc = attrs.find((a) => a.name === "srcdoc");
      if (srcdoc !== undefined) {
        errors.push(
          ...validateCustomHtmlStructure(
            decodeHtmlEntities(srcdoc.value),
            depth + 1,
          ),
        );
      }
    }
    for (const attr of attrs) {
      if (/^on[a-z]+$/.test(attr.name)) {
        errors.push(STRUCTURAL_REASONS.handler);
      }
      const uriKind = scriptUriKind(attr.value);
      if (uriKind === "javascript") {
        errors.push(STRUCTURAL_REASONS.javascript);
      } else if (uriKind === "data-html") {
        errors.push(STRUCTURAL_REASONS.dataHtml);
      }
      if (URL_BEARING_ATTRIBUTES.has(attr.name)) {
        if (attr.name === "srcset") {
          for (const candidate of attr.value.split(",")) {
            const url = candidate.trim().split(/\s+/)[0] ?? "";
            if (url !== "" && isExternalUrlValue(url)) {
              errors.push(STRUCTURAL_REASONS.external);
              break;
            }
          }
        } else if (isExternalUrlValue(attr.value)) {
          errors.push(STRUCTURAL_REASONS.external);
        }
      }
    }
  }
  return [...new Set(errors)];
}

/** Shape checks for the private target descriptor (no DOM access). */
export function validateCustomTarget(target: unknown): string[] {
  const errors: string[] = [];
  if (!isPlainObject(target)) {
    return ["scenario.target must be a plain object"];
  }
  const knownKeys = new Set(["css", "framePath", "shadowHost"]);
  for (const key of Object.keys(target)) {
    if (!knownKeys.has(key)) {
      errors.push(`scenario.target: unknown key: ${key}`);
    }
  }
  if (!isNonEmptyString(target["css"])) {
    errors.push("scenario.target.css must be a non-empty string");
  }
  if (target["framePath"] !== undefined) {
    const framePath = target["framePath"];
    if (
      !Array.isArray(framePath) ||
      framePath.length > 2 ||
      framePath.some((s) => !isNonEmptyString(s))
    ) {
      errors.push("scenario.target.framePath must be an array of 0–2 non-empty strings");
    }
  }
  if (target["shadowHost"] !== undefined && !isNonEmptyString(target["shadowHost"])) {
    errors.push("scenario.target.shadowHost must be a non-empty string");
  }
  const hasFramePath =
    Array.isArray(target["framePath"]) && (target["framePath"] as unknown[]).length > 0;
  if (hasFramePath && target["shadowHost"] !== undefined) {
    errors.push(
      "scenario.target: framePath and shadowHost are mutually exclusive (the target lives in one scope)",
    );
  }
  return errors;
}

/**
 * Shape + safety validation of a custom scenario. The target is
 * OPTIONAL here so /api/validate keeps its frozen behaviour (a
 * scenario without a target is still shape-checkable); when a target
 * IS present it must be well-formed. Use
 * validateCustomScenarioForRun() for analyze/search, where the target
 * is required.
 */
export function validateCustomScenarioShape(scenario: unknown): string[] {
  const errors: string[] = [];
  if (!isPlainObject(scenario)) {
    return ["scenario must be a plain object"];
  }
  const s = scenario as Record<string, unknown>;
  if (s["schema"] !== "locatorstress.scenario/v1") {
    errors.push('scenario.schema must be "locatorstress.scenario/v1"');
  }
  if (s["seed"] !== SEED) {
    errors.push(`scenario.seed must be "${SEED}"`);
  }
  if (s["scenario_id"] !== undefined) {
    if (
      typeof s["scenario_id"] !== "string" ||
      !SCENARIO_ID_PATTERN.test(s["scenario_id"])
    ) {
      errors.push(
        "scenario.scenario_id must be 1–64 chars of [A-Za-z0-9_-] when present",
      );
    }
  }
  errors.push(...validateCustomHtmlSafety(s["html"]));
  if (s["locator"] !== undefined) {
    errors.push(...validateLocatorSpec(s["locator"]).map((e) => `scenario.locator: ${e}`));
  } else {
    errors.push("scenario.locator is required");
  }
  if (s["target"] !== undefined) {
    errors.push(...validateCustomTarget(s["target"]));
  }
  if (s["mutation_suite"] !== undefined) {
    if (
      !Array.isArray(s["mutation_suite"]) ||
      (s["mutation_suite"] as unknown[]).some(
        (m) => typeof m !== "string" || !(MUTATION_ORDER as readonly string[]).includes(m),
      )
    ) {
      errors.push("scenario.mutation_suite must be an array of M01–M08");
    }
  }
  if (s["bfs"] !== undefined) {
    if (!isPlainObject(s["bfs"])) {
      errors.push("scenario.bfs must be an object");
    } else {
      const bfs = s["bfs"] as Record<string, unknown>;
      if (
        bfs["max_depth"] !== undefined &&
        (typeof bfs["max_depth"] !== "number" ||
          !Number.isInteger(bfs["max_depth"]) ||
          (bfs["max_depth"] as number) < 0 ||
          (bfs["max_depth"] as number) > 6)
      ) {
        errors.push("scenario.bfs.max_depth must be an integer in 0..6");
      }
      if (
        bfs["max_expanded_states"] !== undefined &&
        (typeof bfs["max_expanded_states"] !== "number" ||
          !Number.isInteger(bfs["max_expanded_states"]) ||
          (bfs["max_expanded_states"] as number) < 1 ||
          (bfs["max_expanded_states"] as number) > 4096)
      ) {
        errors.push("scenario.bfs.max_expanded_states must be an integer in 1..4096");
      }
    }
  }
  return errors;
}

/**
 * Full validation for an analyze/search run: shape + safety + a
 * target is REQUIRED. Any error here is a 400 at the API layer.
 */
export function validateCustomScenarioForRun(scenario: unknown): string[] {
  const errors = validateCustomScenarioShape(scenario);
  if (isPlainObject(scenario) && scenario["target"] === undefined) {
    errors.push(
      "scenario.target is required for analyze/search: the Oracle needs a private target descriptor (css selector) to resolve the original target; without it the run cannot start",
    );
  }
  return errors;
}

/**
 * Normalise a scenario that already passed
 * validateCustomScenarioForRun(). Applies the spec defaults
 * (§11.2): full M01–M08 suite, BFS 6 / 4096, scenario_id "custom"
 * when absent.
 */
export function normalizeCustomScenario(scenario: unknown): CustomScenarioV1 {
  const errors = validateCustomScenarioForRun(scenario);
  if (errors.length > 0) {
    throw new Error(`Invalid custom scenario: ${errors.join("; ")}`);
  }
  const s = scenario as Record<string, unknown>;
  const rawTarget = s["target"] as Record<string, unknown>;
  const target: CustomTargetDescriptor = { css: rawTarget["css"] as string };
  if (rawTarget["framePath"] !== undefined) {
    target.framePath = [...(rawTarget["framePath"] as string[])];
  }
  if (rawTarget["shadowHost"] !== undefined) {
    target.shadowHost = rawTarget["shadowHost"] as string;
  }
  const bfs = (s["bfs"] as Record<string, unknown> | undefined) ?? {};
  return {
    schema: "locatorstress.scenario/v1",
    scenario_id:
      typeof s["scenario_id"] === "string" ? s["scenario_id"] : CUSTOM_RUN_ID,
    seed: SEED,
    html: s["html"] as string,
    // Keep the locator EXACTLY as supplied (already validated above).
    // Do NOT normalise it: normalizeLocatorSpec() adds exact /
    // includeHidden keys, which the frozen resolver validator rejects
    // for css/xpath specs — a normalised custom locator would fail
    // every evaluation with executionStatus ERROR.
    locator: s["locator"] as LocatorSpecV1,
    target,
    mutation_suite:
      s["mutation_suite"] !== undefined
        ? [...(s["mutation_suite"] as MutationId[])]
        : [...MUTATION_ORDER],
    bfs: {
      max_depth:
        typeof bfs["max_depth"] === "number" ? (bfs["max_depth"] as number) : 6,
      max_expanded_states:
        typeof bfs["max_expanded_states"] === "number"
          ? (bfs["max_expanded_states"] as number)
          : 4096,
    },
  };
}
