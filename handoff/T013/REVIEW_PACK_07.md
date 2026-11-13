# REVIEW_PACK_07 — Web UI：服务器、DOM 快照、前端、页面与样式

审查 commit：`a78d765`。本包为审查时原文逐字拼接（机械拼接，内容未经改写），每个文件附行数、字节数与 SHA-256；审查结论见 `INDEPENDENT_REVIEW.md`。

## src/ui/server.ts

- 行数：558；字节数：18080；SHA-256：`ce143067cff21dbce1ec78d846b9b8644eea2fe83190c04f2d188129bbceb0c2`

```ts
// T009 — Local Web UI server (PROJECT_BOOK §7.2 user flow, §8 UI design).
//
// One process, one origin (so the browser UI needs no CORS):
//   - the FROZEN analysis API server (src/api/server.ts, untouched) is
//     started on an ephemeral loopback port and proxied under /api/*;
//   - static UI files (index.html / styles.css / app.js) are served
//     from src/ui/;
//   - synthetic fixture HTML is served read-only at
//     /ui/fixture-html/F001.html … F024.html (public synthetic data;
//     the private Oracle manifest fields are never served);
//   - UI-owned display endpoints (all prefixed /ui/, none of them part
//     of the frozen /api contract):
//       POST /ui/dom-snapshot  — real mutated DOM per step (see
//         snapshot.ts; HTML text only, no verdict/score);
//       POST /ui/scores        — stability scores + control metrics for
//         an /api/analyze response, computed SERVER-side by the frozen
//         T005 scorer (the browser never computes scores);
//       GET  /ui/reports       — the four hashes of the T008 full
//         analysis report and the frozen S0 gate hash, read from the
//         evidence files (read-only; absent file => present: false).
//
// The UI server never classifies a verdict, never re-implements a
// mutation, and never touches the frozen modules' semantics: it only
// calls them. It binds loopback only (127.0.0.1 by default, ::1 also
// accepted) and refuses any other host, mirroring the API server.
//
// Usage: node dist/ui/server.js [--port N] [--host 127.0.0.1]
// Prints UI_URL=http://127.0.0.1:<port> on stdout once listening.

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "../canonical/canonical-json.js";
import {
  assertLoopbackHost,
  startAnalysisServer,
} from "../api/server.js";
import { createBrowserAnalysisService } from "../api/service.js";
import { MAX_JSON_BODY_BYTES } from "../api/service.js";
import {
  computeControlMetrics,
  computeStabilityScores,
} from "../score/stability-score.js";
import type { ScoreCase } from "../score/stability-score.js";
import { launchBaselineBrowser } from "../runner/browser.js";
import type { BaselineBrowser } from "../runner/browser.js";
import { fixtureHtmlPath } from "../fixtures/fixture-manifest.js";
import { createDomSnapshotter } from "./snapshot.js";
import type { DomSnapshotter } from "./snapshot.js";
import { validateFixtureId, validateSnapshotSequence } from "./snapshot.js";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const UI_STATIC_FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
};

/** Locate the src/ui/ directory (works from src/ and from dist/ui/). */
function uiDir(): string {
  const candidates = [
    MODULE_DIR,
    resolve(MODULE_DIR, "..", "..", "src", "ui"),
  ];
  for (const dir of candidates) {
    if (existsSync(resolve(dir, "index.html"))) {
      return dir;
    }
  }
  return candidates[0]!;
}

/** Locate the repo root (works from src/ui/ and from dist/ui/). */
function repoRoot(): string {
  const candidates = [
    resolve(MODULE_DIR, "..", ".."),
    resolve(MODULE_DIR, "..", "..", ".."),
  ];
  for (const dir of candidates) {
    if (existsSync(resolve(dir, "package.json"))) {
      return dir;
    }
  }
  return candidates[0]!;
}

function readJsonFile(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as unknown;
  } catch {
    return null;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(canonicalJson(body));
}

function sendText(
  res: ServerResponse,
  status: number,
  contentType: string,
  body: string,
): void {
  res.writeHead(status, { "content-type": contentType });
  res.end(body);
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_JSON_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) {
        rejectPromise(
          new Error(`JSON body exceeds ${MAX_JSON_BODY_BYTES} bytes`),
        );
        return;
      }
      const text = Buffer.concat(chunks).toString("utf-8");
      if (text.trim() === "") {
        resolvePromise(null);
        return;
      }
      try {
        resolvePromise(JSON.parse(text) as unknown);
      } catch {
        rejectPromise(new Error("request body is not valid JSON"));
      }
    });
    req.on("error", (err: Error) => rejectPromise(err));
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Map an /api/analyze response case list to ScoreCase input for the
 * frozen T005 scorer. Throws (=> 400) on a malformed case list.
 */
function toScoreCases(value: unknown): ScoreCase[] {
  if (!Array.isArray(value)) {
    throw new Error("cases must be an array");
  }
  return value.map((entry, i) => {
    if (!isPlainObject(entry)) {
      throw new Error(`cases[${i}] is not a plain object`);
    }
    const expected =
      entry["expectedVerdict"] === null ||
      entry["expectedVerdict"] === undefined
        ? undefined
        : entry["expectedVerdict"];
    return {
      fixtureId: entry["fixtureId"],
      mutationId: entry["mutationId"],
      locatorKind: entry["locatorKind"],
      controlGroup: entry["controlGroup"],
      verdict: entry["verdict"],
      analysisStatus: entry["analysisStatus"],
      expectedVerdict: expected,
    } as ScoreCase;
  });
}

interface UiReportsResponse {
  t008: {
    present: true;
    hashes: Record<string, string>;
    verdictCounts: Record<string, number>;
    score: string | null;
    coverage: string | null;
    expectedCases: number;
    completedCases: number;
  } | { present: false };
  s0: { present: true; gateSha256: string } | { present: false };
}

function buildReportsResponse(): UiReportsResponse {
  const root = repoRoot();
  const t008 = readJsonFile(
    resolve(root, "evidence", "s2", "T008_API_REPORT.json"),
  );
  let t008Out: UiReportsResponse["t008"] = { present: false };
  if (isPlainObject(t008)) {
    const hashes = t008["hashes"];
    const scores = t008["scores"];
    if (
      isPlainObject(hashes) &&
      typeof hashes["gate_sha256"] === "string" &&
      isPlainObject(scores) &&
      isPlainObject(scores["overall"])
    ) {
      t008Out = {
        present: true,
        hashes: {
          scenario_sha256: String(hashes["scenario_sha256"] ?? ""),
          oracle_result_sha256: String(hashes["oracle_result_sha256"] ?? ""),
          analysis_sha256: String(hashes["analysis_sha256"] ?? ""),
          gate_sha256: String(hashes["gate_sha256"]),
        },
        verdictCounts: isPlainObject(t008["verdictCounts"])
          ? (t008["verdictCounts"] as Record<string, number>)
          : {},
        score:
          typeof scores["overall"]["score"] === "string"
            ? (scores["overall"]["score"] as string)
            : null,
        coverage:
          typeof scores["overall"]["coverage"] === "string"
            ? (scores["overall"]["coverage"] as string)
            : null,
        expectedCases:
          typeof t008["expectedCases"] === "number"
            ? (t008["expectedCases"] as number)
            : 0,
        completedCases:
          typeof t008["completedCases"] === "number"
            ? (t008["completedCases"] as number)
            : 0,
      };
    }
  }
  const s0 = readJsonFile(resolve(root, "evidence", "s0", "S0_GATE.json"));
  let s0Out: UiReportsResponse["s0"] = { present: false };
  if (isPlainObject(s0) && isPlainObject(s0["hashes"])) {
    const gate = s0["hashes"]["gate_sha256"];
    if (typeof gate === "string" && gate.length === 64) {
      s0Out = { present: true, gateSha256: gate };
    }
  }
  return { t008: t008Out, s0: s0Out };
}

export interface RunningUiServer {
  host: string;
  port: number;
  url: string;
  apiUrl: string;
  close(): Promise<void>;
}

export async function startUiServer(options: {
  host?: string;
  port?: number;
}): Promise<RunningUiServer> {
  const host = options.host ?? "127.0.0.1";
  assertLoopbackHost(host);
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`UI port must be an integer in 0..65535, got ${String(port)}`);
  }

  // One browser for the whole UI process: the service page runs the
  // frozen analysis; a second page in the same context takes DOM
  // snapshots. Both pages block non-loopback requests.
  const browserHandle: BaselineBrowser = await launchBaselineBrowser({});
  const service = createBrowserAnalysisService(browserHandle.page);
  const api = await startAnalysisServer(service, { host, port: 0 });

  const snapshotPage = await browserHandle.context.newPage();
  await snapshotPage.route("**/*", async (route) => {
    const url = route.request().url();
    if (
      url.startsWith("about:") ||
      url.startsWith("data:") ||
      url.startsWith("blob:")
    ) {
      await route.continue();
      return;
    }
    await route.abort();
  });
  const snapshotter: DomSnapshotter = createDomSnapshotter(snapshotPage);

  const dir = uiDir();
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}`);
      const path = url.pathname;
      const method = req.method ?? "GET";

      // ---- Frozen API, proxied same-origin ----
      if (path === "/api" || path.startsWith("/api/")) {
        const target = `${api.url}${path}${url.search}`;
        // The proxy only forwards JSON bodies (it re-stringifies the
        // parsed body), so the content type is always application/json.
        const headers: Record<string, string> = {
          "content-type": "application/json",
        };
        let body: string | undefined;
        if (method === "POST") {
          try {
            const parsed = await readJsonBody(req);
            body = parsed === null ? undefined : JSON.stringify(parsed);
          } catch (err) {
            sendJson(res, 400, {
              error: {
                code: "BAD_REQUEST",
                message: err instanceof Error ? err.message : String(err),
              },
            });
            return;
          }
        }
        const upstream = await fetch(target, {
          method,
          headers,
          body,
        });
        const text = await upstream.text();
        res.writeHead(upstream.status, {
          "content-type":
            upstream.headers.get("content-type") ?? "application/json",
        });
        res.end(text);
        return;
      }

      // ---- UI-owned display endpoints ----
      if (method === "GET" && path.startsWith("/ui/fixture-html/")) {
        const name = path.slice("/ui/fixture-html/".length);
        const match = /^F0(0[1-9]|1[0-9]|2[0-4])\.html$/.exec(name);
        if (!match) {
          sendJson(res, 404, {
            error: { code: "NOT_FOUND", message: `unknown fixture HTML ${name}` },
          });
          return;
        }
        const fixtureId = name.slice(0, 4);
        try {
          const html = readFileSync(fixtureHtmlPath(fixtureId), "utf-8");
          sendText(res, 200, "text/html; charset=utf-8", html);
        } catch (err) {
          sendJson(res, 500, {
            error: {
              code: "INTERNAL_ERROR",
              message: err instanceof Error ? err.message : String(err),
            },
          });
        }
        return;
      }

      if (method === "POST" && path === "/ui/dom-snapshot") {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch (err) {
          sendJson(res, 400, {
            error: {
              code: "BAD_REQUEST",
              message: err instanceof Error ? err.message : String(err),
            },
          });
          return;
        }
        try {
          if (!isPlainObject(body)) {
            throw new Error("dom-snapshot body must be a JSON object");
          }
          const fixtureId = validateFixtureId(body["fixtureId"]);
          const sequence = validateSnapshotSequence(body["sequence"] ?? []);
          const snapshot = await snapshotter.snapshot(fixtureId, sequence);
          sendJson(res, 200, snapshot);
        } catch (err) {
          sendJson(res, 400, {
            error: {
              code: "BAD_REQUEST",
              message: err instanceof Error ? err.message : String(err),
            },
          });
        }
        return;
      }

      if (method === "POST" && path === "/ui/scores") {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch (err) {
          sendJson(res, 400, {
            error: {
              code: "BAD_REQUEST",
              message: err instanceof Error ? err.message : String(err),
            },
          });
          return;
        }
        try {
          if (!isPlainObject(body)) {
            throw new Error("scores body must be a JSON object");
          }
          const cases = toScoreCases(body["cases"]);
          const scores = computeStabilityScores(cases);
          const allHaveExpected = cases.every(
            (c) => c.expectedVerdict !== undefined,
          );
          const controls = allHaveExpected
            ? computeControlMetrics(cases)
            : null;
          sendJson(res, 200, {
            scores,
            controls,
            controlsAvailable: allHaveExpected,
          });
        } catch (err) {
          sendJson(res, 400, {
            error: {
              code: "BAD_REQUEST",
              message: err instanceof Error ? err.message : String(err),
            },
          });
        }
        return;
      }

      if (method === "GET" && path === "/ui/reports") {
        sendJson(res, 200, buildReportsResponse());
        return;
      }

      // ---- Static UI ----
      if (method === "GET") {
        const entry = UI_STATIC_FILES[path];
        if (entry) {
          try {
            const content = readFileSync(resolve(dir, entry.file), "utf-8");
            sendText(res, 200, entry.type, content);
          } catch (err) {
            sendJson(res, 500, {
              error: {
                code: "INTERNAL_ERROR",
                message: err instanceof Error ? err.message : String(err),
              },
            });
          }
          return;
        }
      }

      sendJson(res, 404, {
        error: { code: "NOT_FOUND", message: `unknown path ${path}` },
      });
    } catch (err) {
      sendJson(res, 500, {
        error: {
          code: "INTERNAL_ERROR",
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(port, host, () => {
      server.removeListener("error", rejectPromise);
      resolvePromise();
    });
  });

  const address = server.address();
  if (
    address === null ||
    typeof address === "string" ||
    address.address !== host
  ) {
    const actual =
      address === null
        ? "null"
        : typeof address === "string"
          ? address
          : `${address.address}:${address.port}`;
    await new Promise<void>((done) => server.close(() => done()));
    await api.close();
    await browserHandle.close();
    throw new Error(
      `UI loopback bind verification failed: requested ${host}, server reports ${actual}`,
    );
  }
  const actualPort = address.port;
  return {
    host,
    port: actualPort,
    url: `http://${host}:${actualPort}`,
    apiUrl: api.url,
    async close(): Promise<void> {
      await new Promise<void>((done) => server.close(() => done()));
      await api.close();
      await browserHandle.close();
    },
  };
}

function parseArgs(argv: readonly string[]): { host: string; port: number } {
  let host = "127.0.0.1";
  let port = 0;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--host" && i + 1 < argv.length) {
      host = argv[i + 1]!;
      i += 1;
    } else if (argv[i] === "--port" && i + 1 < argv.length) {
      const n = Number(argv[i + 1]);
      if (!Number.isInteger(n) || n < 0 || n > 65535) {
        throw new Error(`--port must be an integer in 0..65535, got ${argv[i + 1]}`);
      }
      port = n;
      i += 1;
    } else {
      throw new Error(`unknown argument ${argv[i]} (expected --host / --port)`);
    }
  }
  return { host, port };
}

async function main(): Promise<void> {
  let running: RunningUiServer;
  try {
    running = await startUiServer(parseArgs(process.argv.slice(2)));
  } catch (err) {
    process.stderr.write(
      `failed to start UI server: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`UI_URL=${running.url}\n`);
  process.stdout.write(`API_URL=${running.apiUrl}\n`);
  process.stdout.write(
    `LocatorStress UI listening on ${running.url} (API proxied at /api, backend ${running.apiUrl})\n`,
  );
  const shutdown = (): void => {
    void running.close().finally(() => {
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
```

## src/ui/snapshot.ts

- 行数：146；字节数：4996；SHA-256：`95d7481dea0535e7960573fbcc499f8a836da1c3002fd1234a6c5b1fc8bb7160`

```ts
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
import { MUTATION_ORDER, getMutation } from "../mutations/registry.js";
import type { MutationId } from "../mutations/types.js";

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
  };
}
```

## src/ui/app.js

- 行数：920；字节数：39672；SHA-256：`ea353228bcf4d26d73d50818fef782b5d4fc706170af3ed92e9ae4ba1f7f842c`

```js
// T009 — LocatorStress Web UI (vanilla ES module, no build step, no CDN).
//
// RULE (PROJECT_BOOK §10 architecture invariant): the UI never computes
// a verdict and never computes a score. Verdicts come from POST
// /api/analyze, witnesses from POST /api/search, scores from POST
// /ui/scores (server-side, frozen T005 scorer), hashes from GET
// /ui/reports (read from the backend report files). The browser only
// renders backend data, plus two explicitly-labelled previews that do
// NOT feed any verdict:
//   (a) the Locator edit preview resolves a draft LocatorSpec against
//       the fixture DOM in this browser (match count + same-element
//       check only);
//   (b) the DOM diff shows original vs mutated HTML; the mutated HTML
//       is produced server-side by the frozen mutation registry
//       (POST /ui/dom-snapshot), never by re-implementing mutations here.

const $ = (id) => document.getElementById(id);

const MUTATION_NAMES = {
  M01: "WRAP_TARGET",
  M02: "REORDER_SIBLINGS",
  M03: "CHANGE_CLASS",
  M04: "INSERT_SAME_NAME",
  M05: "NESTED_IFRAME",
  M06: "MOVE_TO_OPEN_SHADOW_ROOT",
  M07: "INSERT_HIDDEN_DUPLICATE",
  M08: "CHANGE_TEXT",
};
const MUTATION_ORDER = ["M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08"];

const VERDICT_TEXT = {
  STABLE: "STABLE",
  WRONG_TARGET: "WRONG_TARGET",
  AMBIGUOUS: "AMBIGUOUS",
  MISSING: "MISSING",
};
const VERDICT_EXPLAIN = {
  STABLE: "最终匹配恰好 1 个，且与原目标为同一 DOM 对象。",
  WRONG_TARGET: "返回了一个元素，但不是原目标。",
  AMBIGUOUS: "最终匹配多于 1 个（或 framePath 某层匹配多个 frame）。",
  MISSING: "最终匹配为 0（或 framePath 某层无匹配 frame）。",
};

const state = {
  fixtures: [],
  mutations: [],
  seed: "",
  selectedFixtureId: null,
  selectedFixture: null,
  fixtureHtml: null,
  analysis: null,
  scores: null,
  controls: null,
  witness: null,
  snapshotCache: new Map(), // key: sequence.join("+") -> DomSnapshot
  selectedMutation: null,
  selectedCase: null,
};

function setStatus(msg) {
  $("run-status").textContent = msg || "";
}

async function apiJson(path, options) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body && body.error ? body.error : {};
    throw new Error(`${path} -> HTTP ${res.status} ${err.code || ""} ${err.message || ""}`.trim());
  }
  return body;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function locatorSummary(loc) {
  if (!loc) return "—";
  if (loc.kind === "css" || loc.kind === "xpath") return `${loc.kind}: ${loc.selector || ""}`;
  const parts = [`role: ${loc.role || ""}`];
  if (loc.name !== undefined && loc.name !== "") parts.push(`name=${JSON.stringify(loc.name)}`);
  if (loc.exact) parts.push("exact");
  if (loc.includeHidden) parts.push("includeHidden");
  return parts.join(" ");
}

function framePathText(loc) {
  return (loc && loc.framePath && loc.framePath.length > 0 ? loc.framePath.join(" › ") : "—");
}

// ---------------------------------------------------------------- tabs
const VIEWS = ["fixtures", "locator", "mutations", "matrix", "witness", "report"];
function showView(name) {
  for (const v of VIEWS) {
    const tab = document.querySelector(`[data-view="${v}"]`);
    const panel = $(`view-${v}`);
    const active = v === name;
    tab.setAttribute("aria-selected", active ? "true" : "false");
    panel.hidden = !active;
  }
}
document.querySelectorAll("[data-view]").forEach((tab) => {
  tab.addEventListener("click", () => showView(tab.dataset.view));
});
document.querySelector(".tabs").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const current = VIEWS.indexOf(document.querySelector('[aria-selected="true"]').dataset.view);
  const next = (current + (e.key === "ArrowRight" ? 1 : VIEWS.length - 1)) % VIEWS.length;
  showView(VIEWS[next]);
  document.querySelector(`[data-view="${VIEWS[next]}"]`).focus();
  e.preventDefault();
});

// ---------------------------------------------------------------- Fixture Lab
function renderFixtureRows() {
  const kind = $("fixture-filter-kind").value;
  const control = $("fixture-filter-control").value;
  const family = $("fixture-filter-family").value;
  const rows = state.fixtures.filter(
    (f) =>
      (!kind || f.kind === kind) &&
      (!control || f.controlGroup === control) &&
      (!family || f.family === family),
  );
  $("fixture-count").textContent = `显示 ${rows.length} / 24 个 fixture。`;
  $("fixture-rows").innerHTML = rows
    .map(
      (f) => `<tr data-fixture-id="${escHtml(f.fixtureId)}" data-selected="${f.fixtureId === state.selectedFixtureId}" tabindex="0">
        <td class="mono">${escHtml(f.fixtureId)}</td>
        <td>${escHtml(f.family)}</td>
        <td>${escHtml(f.kind)}</td>
        <td>${escHtml(f.controlGroup)}</td>
        <td class="mono">${escHtml(locatorSummary(f.locator))}</td>
      </tr>`,
    )
    .join("");
}

async function selectFixture(fixtureId) {
  const fixture = state.fixtures.find((f) => f.fixtureId === fixtureId);
  if (!fixture) return;
  state.selectedFixtureId = fixtureId;
  state.selectedFixture = fixture;
  state.analysis = null;
  state.scores = null;
  state.controls = null;
  state.witness = null;
  state.snapshotCache.clear();
  state.selectedMutation = null;
  state.selectedCase = null;
  state.fixtureHtml = null;
  $("selected-fixture").textContent =
    `已选 ${fixture.fixtureId}（${fixture.family} · ${fixture.kind} · ${fixture.controlGroup}）— Locator：${locatorSummary(fixture.locator)}${fixture.locator.framePath && fixture.locator.framePath.length ? `；framePath：${framePathText(fixture.locator)}` : ""}${fixture.locator.index !== null && fixture.locator.index !== undefined ? `；index：${fixture.locator.index}` : ""}`;
  loadLocatorForm(fixture.locator);
  renderFixtureRows();
  renderMatrixEmpty();
  renderWitnessEmpty();
  renderReport();
  setStatus("");
}

$("fixture-rows").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-fixture-id]");
  if (tr) void selectFixture(tr.dataset.fixtureId);
});
$("fixture-rows").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const tr = e.target.closest("tr[data-fixture-id]");
  if (tr) {
    void selectFixture(tr.dataset.fixtureId);
    e.preventDefault();
  }
});
for (const id of ["fixture-filter-kind", "fixture-filter-control", "fixture-filter-family"]) {
  $(id).addEventListener("change", renderFixtureRows);
}

// ---------------------------------------------------------------- Locator edit
function readLocatorForm() {
  const kind = $("loc-kind").value;
  const loc = { kind };
  if (kind === "css" || kind === "xpath") {
    // exact / includeHidden / role / name are role-only keys per the
    // LocatorSpec contract (T001); sending them for css/xpath makes the
    // spec invalid.
    loc.selector = $("loc-selector").value;
  } else {
    loc.role = $("loc-role").value;
    const name = $("loc-name").value;
    if (name !== "") loc.name = name;
    loc.exact = $("loc-exact").checked;
    loc.includeHidden = $("loc-include-hidden").checked;
  }
  const frameLines = $("loc-framepath").value.split("\n").map((s) => s.trim()).filter(Boolean);
  if (frameLines.length > 0) loc.framePath = frameLines;
  const idx = $("loc-index").value.trim();
  if (idx !== "") loc.index = Number(idx);
  return loc;
}

/**
 * Client-side SHAPE check for a draft LocatorSpec, mirroring the shape
 * rules of validateLocatorSpec (non-empty selector/role, framePath 0–2,
 * non-negative integer index). This is a guard, not a re-implementation
 * of validation: the backend (/api/validate) remains authoritative for
 * everything actually sent.
 *
 * WHY the guard exists (frozen T008 defect, NOT worked around by
 * changing the API): service.validate() returns `{ valid, errors,
 * locator }` with `locator: undefined` whenever the spec is invalid,
 * and the frozen API server serialises the response with canonicalJson,
 * which throws on an `undefined` property — after writeHead already
 * sent headers — so the outer 500 handler throws ERR_HTTP_HEADERS_SENT
 * and the whole API/UI server process dies. Any invalid draft sent to
 * /api/validate therefore kills the server. The shape check keeps
 * such drafts from ever being sent; see T009_UI_REPORT.md for the
 * minimal repro and the recommended frozen-code fix (FIX task for the
 * coordinator — the UI must not modify frozen modules).
 */
function checkLocatorShape(loc) {
  const errors = [];
  if (loc.kind !== "css" && loc.kind !== "xpath" && loc.kind !== "role") {
    errors.push('kind must be one of "css", "xpath", "role"');
    return errors;
  }
  if ((loc.kind === "css" || loc.kind === "xpath") && (typeof loc.selector !== "string" || loc.selector.length === 0)) {
    errors.push(`selector must be a non-empty string when kind is "${loc.kind}"`);
  }
  if (loc.kind === "role" && (typeof loc.role !== "string" || loc.role.length === 0)) {
    errors.push('role must be a non-empty string when kind is "role"');
  }
  if (loc.framePath !== undefined) {
    if (!Array.isArray(loc.framePath) || loc.framePath.length > 2 || loc.framePath.some((s) => typeof s !== "string" || s.length === 0)) {
      errors.push("framePath must contain 0–2 non-empty strings");
    }
  }
  if (loc.index !== undefined && loc.index !== null && (!Number.isInteger(loc.index) || loc.index < 0)) {
    errors.push("index must be null or a non-negative integer");
  }
  return errors;
}

function loadLocatorForm(loc) {
  $("loc-kind").value = loc.kind;
  $("loc-selector").value = loc.kind === "css" || loc.kind === "xpath" ? loc.selector || "" : "";
  $("loc-role").value = loc.kind === "role" ? loc.role || "" : "";
  $("loc-name").value = loc.kind === "role" ? loc.name || "" : "";
  $("loc-exact").checked = !!loc.exact;
  $("loc-include-hidden").checked = !!loc.includeHidden;
  $("loc-framepath").value = (loc.framePath || []).join("\n");
  $("loc-index").value = loc.index === null || loc.index === undefined ? "" : String(loc.index);
  syncLocatorKindRows();
  $("loc-fixture-note").textContent = state.selectedFixture
    ? `当前 fixture：${state.selectedFixture.fixtureId}（${locatorSummary(state.selectedFixture.locator)}）。表单已载入该冻结 Locator；分析始终使用它，编辑仅用于校验与匹配预览。`
    : "先在 Fixture Lab 选择一个 fixture。";
  $("loc-validate-result").innerHTML = "";
  $("loc-preview-result").innerHTML = "";
}

function syncLocatorKindRows() {
  const kind = $("loc-kind").value;
  $("row-selector").hidden = kind === "role";
  $("row-role").hidden = kind !== "role";
  $("row-name").hidden = kind !== "role";
}
$("loc-kind").addEventListener("change", syncLocatorKindRows);

$("loc-reset").addEventListener("click", () => {
  if (state.selectedFixture) loadLocatorForm(state.selectedFixture.locator);
});

$("loc-validate").addEventListener("click", async () => {
  const loc = readLocatorForm();
  const shapeErrors = checkLocatorShape(loc);
  if (shapeErrors.length > 0) {
    // Guard (see checkLocatorShape): do not send a shape-invalid draft
    // to /api/validate — the frozen server cannot answer it without
    // dying. These are format errors only; semantic validation still
    // happens on the backend for every draft that is sent.
    $("loc-validate-result").innerHTML =
      `<p><strong>格式检查未通过（未发送给后端）。</strong></p><ul>${shapeErrors.map((e) => `<li>${escHtml(e)}</li>`).join("")}</ul>`;
    return;
  }
  try {
    const result = await apiJson("/api/validate", {
      method: "POST",
      body: JSON.stringify({ locator: loc }),
    });
    if (result.valid) {
      $("loc-validate-result").innerHTML =
        `<p><strong>校验通过（后端 /api/validate）。</strong>规范化 Locator：<code>${escHtml(JSON.stringify(result.locator))}</code></p>`;
    } else {
      $("loc-validate-result").innerHTML =
        `<p><strong>校验未通过。</strong></p><ul>${(result.errors || []).map((e) => `<li>${escHtml(e)}</li>`).join("")}</ul>`;
    }
  } catch (err) {
    setStatus(`校验失败：${err.message}`);
  }
});

// ---- Client-side locator preview (match count + same-element check only).
// This runs entirely in this browser against the fixture DOM. It never
// produces a verdict and never reaches the Oracle.
const IMPLICIT_ROLE = {
  button: (el) =>
    el.tagName === "BUTTON" ||
    (el.tagName === "INPUT" && ["button", "submit", "reset", "image"].includes((el.getAttribute("type") || "").toLowerCase())) ||
    el.getAttribute("role") === "button",
  link: (el) => (el.tagName === "A" && el.hasAttribute("href")) || el.getAttribute("role") === "link",
  textbox: (el) =>
    (el.tagName === "INPUT" && !["button", "submit", "reset", "image", "checkbox", "radio", "hidden", "file"].includes((el.getAttribute("type") || "text").toLowerCase())) ||
    el.tagName === "TEXTAREA" || el.getAttribute("role") === "textbox",
  checkbox: (el) => (el.tagName === "INPUT" && (el.getAttribute("type") || "").toLowerCase() === "checkbox") || el.getAttribute("role") === "checkbox",
  radio: (el) => (el.tagName === "INPUT" && (el.getAttribute("type") || "").toLowerCase() === "radio") || el.getAttribute("role") === "radio",
  heading: (el) => /^H[1-6]$/.test(el.tagName) || el.getAttribute("role") === "heading",
  navigation: (el) => el.tagName === "NAV" || el.getAttribute("role") === "navigation",
  main: (el) => el.tagName === "MAIN" || el.getAttribute("role") === "main",
  dialog: (el) => el.getAttribute("role") === "dialog",
  img: (el) => el.tagName === "IMG" || el.getAttribute("role") === "img",
};

function accessibleName(el, doc) {
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy.split(/\s+/).map((id) => {
      const target = doc.getElementById(id);
      return target ? target.textContent : "";
    });
    const joined = parts.join(" ").replace(/\s+/g, " ").trim();
    if (joined) return joined;
  }
  const label = el.getAttribute("aria-label");
  if (label) return label;
  if (el.tagName === "INPUT") return el.getAttribute("value") || el.getAttribute("placeholder") || "";
  if (el.tagName === "IMG") return el.getAttribute("alt") || "";
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}

function normName(s) {
  return String(s).replace(/\s+/g, " ").trim().toLowerCase();
}

function allElementsWithShadow(doc) {
  const out = [];
  const walk = (node) => {
    for (const child of node.children || []) {
      out.push(child);
      if (child.tagName === "TEMPLATE" && child.content) walk(child.content);
      else walk(child);
    }
  };
  walk(doc.documentElement || doc);
  return out;
}

function isHiddenApprox(el) {
  if (el.hasAttribute("hidden")) return true;
  if (el.getAttribute("aria-hidden") === "true") return true;
  const style = el.getAttribute("style") || "";
  if (/display\s*:\s*none/i.test(style) || /visibility\s*:\s*hidden/i.test(style)) return true;
  return false;
}

/** Resolve a LocatorSpec inside a parsed fixture document (preview only). */
function resolveLocatorPreview(doc, loc) {
  let currentDocs = [doc];
  const framePath = loc.framePath || [];
  for (const sel of framePath) {
    const next = [];
    let foundFrame = false;
    for (const d of currentDocs) {
      const frames = [...d.querySelectorAll("iframe")].filter((f) => {
        try { return f.matches(sel); } catch { return false; }
      });
      for (const f of frames) {
        foundFrame = true;
        const srcdoc = f.getAttribute("srcdoc");
        if (srcdoc !== null) {
          next.push(new DOMParser().parseFromString(srcdoc, "text/html"));
        }
      }
    }
    if (!foundFrame) return { matches: [], error: `framePath 在原始 DOM 中无匹配的 iframe：${sel}` };
    if (next.length === 0) return { matches: [], error: "framePath 指向的 iframe 没有 srcdoc 内容，预览无法进入（后端执行时解析）" };
    currentDocs = next;
  }

  let matches = [];
  if (loc.kind === "css") {
    try {
      for (const d of currentDocs) {
        matches.push(...allElementsWithShadow(d).filter((el) => {
          try { return el.matches(loc.selector); } catch { return false; }
        }));
      }
    } catch {
      return { matches: [], error: `CSS selector 无法解析：${loc.selector}` };
    }
  } else if (loc.kind === "xpath") {
    for (const d of currentDocs) {
      const scopes = [d, ...allElementsWithShadow(d).filter((el) => el.tagName === "TEMPLATE").map((t) => t.content)];
      for (const scope of scopes) {
        try {
          const result = d.evaluate(loc.selector, scope, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          for (let i = 0; i < result.snapshotLength; i += 1) {
            const node = result.snapshotItem(i);
            if (node && node.nodeType === 1) matches.push(node);
          }
        } catch {
          return { matches: [], error: `XPath 无法解析：${loc.selector}` };
        }
      }
    }
  } else if (loc.kind === "role") {
    const test = IMPLICIT_ROLE[loc.role];
    if (!test) return { matches: [], error: `预览不支持的 role：${loc.role}（仅支持 button/link/textbox/checkbox/radio/heading/navigation/main/dialog/img）` };
    for (const d of currentDocs) {
      for (const el of allElementsWithShadow(d)) {
        if (!test(el)) continue;
        if (loc.name !== undefined && loc.name !== "") {
          const name = normName(accessibleName(el, d));
          const want = normName(loc.name);
          if (loc.exact ? name !== want : !name.includes(want)) continue;
        }
        matches.push(el);
      }
    }
  } else {
    return { matches: [], error: `未知 kind：${loc.kind}` };
  }

  if (!loc.includeHidden) matches = matches.filter((el) => !isHiddenApprox(el));
  if (loc.index !== null && loc.index !== undefined) {
    if (loc.index < 0 || loc.index >= matches.length) {
      return { matches: [], error: `.nth(${loc.index}) 越界：原始匹配 ${matches.length} 个` };
    }
    matches = [matches[loc.index]];
  }
  return { matches, error: null };
}

async function fetchFixtureHtml() {
  if (state.fixtureHtml !== null) return state.fixtureHtml;
  const res = await fetch(`/ui/fixture-html/${state.selectedFixtureId}.html`);
  if (!res.ok) throw new Error(`fixture HTML 加载失败：HTTP ${res.status}`);
  state.fixtureHtml = await res.text();
  return state.fixtureHtml;
}

$("loc-preview").addEventListener("click", async () => {
  if (!state.selectedFixture) {
    setStatus("请先在 Fixture Lab 选择一个 fixture。");
    return;
  }
  const draft = readLocatorForm();
  try {
    const html = await fetchFixtureHtml();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const draftRes = resolveLocatorPreview(doc, draft);
    const frozenRes = resolveLocatorPreview(doc, state.selectedFixture.locator);
    const draftEl = draftRes.matches[0] || null;
    const frozenEl = frozenRes.matches[0] || null;
    const same = draftEl !== null && frozenEl !== null && draftEl === frozenEl;
    const describe = (el) => (el ? `<code>${escHtml(el.outerHTML.slice(0, 160))}</code>` : "—");
    $("loc-preview-result").innerHTML = `
      <p><strong>浏览器内匹配预览（仅预览，不计算 verdict；隐藏元素按近似规则过滤）。</strong></p>
      <ul>
        <li>编辑的 Locator 在原始 DOM 上匹配 <strong>${draftRes.matches.length}</strong> 个元素${draftRes.error ? `；注意：${escHtml(draftRes.error)}` : ""}。${draftEl ? `首个匹配：${describe(draftEl)}` : ""}</li>
        <li>fixture 冻结 Locator 在原始 DOM 上匹配 <strong>${frozenRes.matches.length}</strong> 个元素${frozenRes.error ? `；注意：${escHtml(frozenRes.error)}` : ""}。</li>
        <li>是否命中同一元素：<strong>${same ? "是" : draftEl && frozenEl ? "否（不同元素）" : "无法判断（至少一方未命中）"}</strong></li>
      </ul>
      <p class="hint">iframe / Shadow DOM 内的目标可能无法在顶层 DOM 预览中解析；最终判定以后端 /api/analyze 的执行结果为准。</p>`;
  } catch (err) {
    setStatus(`匹配预览失败：${err.message}`);
  }
});

// ---------------------------------------------------------------- DOM diff
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

function prettyPrintHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const lines = [];
  const attrText = (el) => {
    let s = "";
    for (const name of el.getAttributeNames()) {
      s += ` ${name}="${String(el.getAttribute(name)).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`;
    }
    return s;
  };
  const walk = (node, depth) => {
    const pad = "  ".repeat(depth);
    if (node.nodeType === 3) {
      const text = node.textContent.replace(/\s+/g, " ").trim();
      if (text) lines.push(`${pad}${text}`);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node;
    const tag = el.tagName.toLowerCase();
    if (tag === "template" && el.content) {
      lines.push(`${pad}<template${attrText(el)}>`);
      for (const child of el.content.childNodes) walk(child, depth + 1);
      lines.push(`${pad}</template>`);
      return;
    }
    const children = [...el.childNodes].filter(
      (n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim() !== ""),
    );
    if (children.length === 0 || VOID_TAGS.has(tag)) {
      lines.push(`${pad}<${tag}${attrText(el)}>${VOID_TAGS.has(tag) ? "" : `</${tag}>`}`);
      return;
    }
    lines.push(`${pad}<${tag}${attrText(el)}>`);
    for (const child of children) walk(child, depth + 1);
    lines.push(`${pad}</${tag}>`);
  };
  lines.push("<!doctype html>");
  walk(doc.documentElement, 0);
  return lines;
}

/** LCS line diff: [{type: "same"|"add"|"del", text, oldNo, newNo}]. */
function lineDiff(oldLines, newLines) {
  const n = oldLines.length;
  const m = newLines.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      rows.push({ type: "same", text: oldLines[i], oldNo: i + 1, newNo: j + 1 });
      i += 1; j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: "del", text: oldLines[i], oldNo: i + 1, newNo: null });
      i += 1;
    } else {
      rows.push({ type: "add", text: newLines[j], oldNo: null, newNo: j + 1 });
      j += 1;
    }
  }
  while (i < n) { rows.push({ type: "del", text: oldLines[i], oldNo: i + 1, newNo: null }); i += 1; }
  while (j < m) { rows.push({ type: "add", text: newLines[j], oldNo: null, newNo: j + 1 }); j += 1; }
  return rows;
}

function renderDiff(container, oldHtml, newHtml, label) {
  const oldLines = prettyPrintHtml(oldHtml);
  const newLines = prettyPrintHtml(newHtml);
  const rows = lineDiff(oldLines, newLines);
  const adds = rows.filter((r) => r.type === "add").length;
  const dels = rows.filter((r) => r.type === "del").length;
  const summary = adds === 0 && dels === 0
    ? `${label}：DOM 无行级差异。`
    : `${label}：新增 ${adds} 行，删除 ${dels} 行（绿色 = 变异后新增，红色 = 原 DOM 删除）。`;
  container.innerHTML = `<table aria-label="DOM diff"><tbody>${rows
    .map((r) => `<tr class="diff-${r.type}"><td class="ln">${r.oldNo ?? ""}</td><td class="ln">${r.newNo ?? ""}</td><td class="sign">${r.type === "add" ? "+" : r.type === "del" ? "−" : " "}</td><td>${escHtml(r.text)}</td></tr>`)
    .join("")}</tbody></table>`;
  return summary;
}

async function fetchSnapshot(sequence) {
  const key = sequence.join("+");
  if (state.snapshotCache.has(key)) return state.snapshotCache.get(key);
  const snap = await apiJson("/ui/dom-snapshot", {
    method: "POST",
    body: JSON.stringify({ fixtureId: state.selectedFixtureId, sequence }),
  });
  state.snapshotCache.set(key, snap);
  return snap;
}

// ---------------------------------------------------------------- Mutation Lab
function renderMutationList() {
  $("mutation-list").innerHTML = MUTATION_ORDER.map(
    (id) => `<button type="button" data-mutation="${id}" aria-pressed="${state.selectedMutation === id}">${id} ${MUTATION_NAMES[id]}</button>`,
  ).join("");
  if (!state.selectedMutation) {
    $("diff-view").innerHTML = `<p class="diff-empty">选择一个算子查看 DOM diff。</p>`;
    $("diff-summary").textContent = "";
  }
}

$("mutation-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-mutation]");
  if (!btn || !state.selectedFixture) {
    if (!state.selectedFixture) setStatus("请先在 Fixture Lab 选择一个 fixture。");
    return;
  }
  const id = btn.dataset.mutation;
  state.selectedMutation = id;
  renderMutationList();
  try {
    const snap = await fetchSnapshot([id]);
    const summary = renderDiff($("diff-view"), snap.steps[0].html, snap.steps[1].html, `${id} ${MUTATION_NAMES[id]} 之后`);
    $("diff-summary").textContent = summary;
  } catch (err) {
    setStatus(`DOM 快照失败：${err.message}`);
  }
});

// ---------------------------------------------------------------- Verdict Matrix
function renderMatrixEmpty() {
  $("matrix-grid").innerHTML = `<p class="diff-empty">尚未运行分析。选择 fixture 后点击「运行分析」。</p>`;
  $("case-detail").innerHTML = "";
  $("analysis-status").textContent = "";
}

function verdictChip(v) {
  if (v === null || v === undefined) return `<span class="verdict verdict-none">（无 verdict）</span>`;
  return `<span class="verdict verdict-${v}">${VERDICT_TEXT[v]}</span>`;
}

function renderMatrix() {
  const a = state.analysis;
  if (!a) { renderMatrixEmpty(); return; }
  const cells = [{ id: null, label: "baseline", c: a.baseline }, ...a.cases.map((c) => ({ id: c.mutationId, label: c.mutationId, c }))];
  $("matrix-grid").innerHTML = cells
    .map(({ id, label, c }) => `<button type="button" class="matrix-cell" data-mutation="${id ?? "baseline"}" aria-pressed="${state.selectedCase === (id ?? "baseline")}">
      <span class="cell-id">${label}${id ? ` ${MUTATION_NAMES[id]}` : ""}</span><br>
      <span class="cell-verdict">${verdictChip(c.verdict)}</span>
      <span class="cell-detail">匹配 ${c.matchCount} 个 · ${c.identityMatch === null ? "身份未知" : c.identityMatch ? "同一目标 ✓" : "非原目标 ✕"}</span>
    </button>`)
    .join("");
  $("analysis-status").textContent =
    `分析完成：baseline ${a.baseline.verdict ?? "（无 verdict）"}；8 个变异用例中 ${a.cases.filter((c) => c.verdict !== null).length} 个已完成。`;
}

$("matrix-grid").addEventListener("click", async (e) => {
  const btn = e.target.closest(".matrix-cell[data-mutation]");
  if (!btn || !state.analysis) return;
  const key = btn.dataset.mutation;
  state.selectedCase = key;
  const c = key === "baseline" ? state.analysis.baseline : state.analysis.cases.find((x) => x.mutationId === key);
  if (!c) return;
  renderMatrix();
  const verdictLine = c.verdict
    ? `${verdictChip(c.verdict)}<span class="verdict-note">${escHtml(VERDICT_EXPLAIN[c.verdict])}</span>`
    : `<span class="verdict verdict-none">（无 verdict）</span><span class="verdict-note">执行未完成，见 executionStatus；不得计为 STABLE。</span>`;
  let diffHtml = "";
  if (key !== "baseline") {
    try {
      const snap = await fetchSnapshot([key]);
      const tmp = document.createElement("div");
      const summary = renderDiff(tmp, snap.steps[0].html, snap.steps[1].html, `${key} 之后`);
      diffHtml = `<h3>DOM diff（${key} ${MUTATION_NAMES[key]}）</h3><p>${escHtml(summary)}</p>${tmp.innerHTML}`;
    } catch (err) {
      diffHtml = `<p>DOM diff 加载失败：${escHtml(err.message)}</p>`;
    }
  }
  $("case-detail").innerHTML = `
    <h3>${key === "baseline" ? "baseline" : `${key} ${MUTATION_NAMES[key]}`}</h3>
    <p>${verdictLine}</p>
    <dl>
      <dt>matchCount</dt><dd>${c.matchCount}</dd>
      <dt>identityMatch</dt><dd>${c.identityMatch === null ? "null（无唯一命中可比较）" : c.identityMatch ? "true（同一 DOM 对象）" : "false（不是原目标）"}</dd>
      <dt>expectedVerdict（golden）</dt><dd>${c.expectedVerdict ?? "—"}</dd>
      <dt>matchesGolden</dt><dd>${c.matchesGolden === null ? "null" : String(c.matchesGolden)}</dd>
      <dt>executionStatus</dt><dd>${escHtml(c.executionStatus)}</dd>
      <dt>analysisStatus</dt><dd>${escHtml(c.analysisStatus)}</dd>
      <dt>framePath</dt><dd>${escHtml(framePathText(state.selectedFixture.locator))}</dd>
    </dl>
    ${diffHtml}`;
});

$("run-analysis").addEventListener("click", async () => {
  if (!state.selectedFixture) {
    setStatus("请先在 Fixture Lab 选择一个 fixture。");
    return;
  }
  const btn = $("run-analysis");
  btn.disabled = true;
  $("analysis-status").textContent = "运行中：后端正在 Chromium 上执行 baseline + M01–M08…";
  setStatus("");
  try {
    const analysis = await apiJson("/api/analyze", {
      method: "POST",
      body: JSON.stringify({ fixtureId: state.selectedFixtureId }),
    });
    state.analysis = analysis;
    state.selectedCase = null;
    renderMatrix();
    try {
      const scored = await apiJson("/ui/scores", {
        method: "POST",
        body: JSON.stringify({ cases: analysis.cases }),
      });
      state.scores = scored.scores;
      state.controls = scored.controls;
    } catch (err) {
      setStatus(`分数计算失败（后端 /ui/scores）：${err.message}`);
      state.scores = null;
      state.controls = null;
    }
    renderReport();
  } catch (err) {
    setStatus(`分析失败：${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------- BFS Witness
function renderWitnessEmpty() {
  $("witness-summary").innerHTML = "";
  $("witness-steps").innerHTML = "";
  $("witness-status").textContent = "";
}

function renderWitness() {
  const w = state.witness;
  if (!w) { renderWitnessEmpty(); return; }
  const statusText = {
    FOUND: "FOUND — 已找到最短失败序列",
    BOUNDED_NO_WITNESS: "BOUNDED_NO_WITNESS — 有限搜索内未找到失败序列（不证明安全）",
    BOUNDED_INCOMPLETE: "BOUNDED_INCOMPLETE — 预算耗尽，搜索未完成（不是“无见证”）",
  }[w.status] || w.status;
  $("witness-status").textContent = statusText;
  $("witness-summary").innerHTML = `
    <dl class="report-facts">
      <div><dt>状态</dt><dd>${escHtml(w.status)}</dd></div>
      <div><dt>含义</dt><dd style="font-size:14px">${escHtml(w.meaning)}</dd></div>
      <div><dt>见证序列</dt><dd>${w.witness ? escHtml(w.witness.sequence.join(" → ")) + `（深度 ${w.witness.depth}，失败 verdict ${w.witness.verdict}）` : "—"}</dd></div>
      <div><dt>已评估 / 已扩展 / 去重</dt><dd>${w.statesEvaluated} / ${w.statesExpanded} / ${w.statesDeduplicated}</dd></div>
      <div><dt>唯一状态 / 队列剩余</dt><dd>${w.uniqueStates} / ${w.queueRemaining}</dd></div>
      <div><dt>到达的最大深度</dt><dd>${w.maxDepthReached}（上限 ${w.limits.maxDepth}，预算 ${w.limits.maxExpandedStates}）</dd></div>
    </dl>
    ${w.budgetNote ? `<p class="hint">${escHtml(w.budgetNote)}</p>` : ""}
    <p class="hint">按深度评估：${escHtml(JSON.stringify(w.perDepthEvaluated))}</p>`;
}

$("run-bfs").addEventListener("click", async () => {
  if (!state.selectedFixture) {
    setStatus("请先在 Fixture Lab 选择一个 fixture。");
    return;
  }
  const depth = Number($("bfs-depth").value);
  const budget = Number($("bfs-budget").value);
  if (!Number.isInteger(depth) || depth < 0 || depth > 6) {
    setStatus("maxDepth 必须是 0–6 的整数。");
    return;
  }
  if (!Number.isInteger(budget) || budget < 1 || budget > 4096) {
    setStatus("maxExpandedStates 必须是 1–4096 的整数。");
    return;
  }
  const btn = $("run-bfs");
  btn.disabled = true;
  $("witness-status").textContent = "BFS 运行中（后端有界搜索，深度越大越慢）…";
  setStatus("");
  try {
    const witness = await apiJson("/api/search", {
      method: "POST",
      body: JSON.stringify({ fixtureId: state.selectedFixtureId, maxDepth: depth, maxExpandedStates: budget }),
    });
    state.witness = witness;
    renderWitness();
    renderReport();
    if (witness.witness) {
      const seq = witness.witness.sequence;
      const snap = await fetchSnapshot(seq);
      const stepsDiv = $("witness-steps");
      stepsDiv.innerHTML = "<h3>每一步 DOM diff</h3>";
      for (let i = 0; i < seq.length; i += 1) {
        const holder = document.createElement("div");
        const summary = renderDiff(holder, snap.steps[i].html, snap.steps[i + 1].html, `第 ${i + 1} 步：${seq[i]} ${MUTATION_NAMES[seq[i]]} 之后`);
        const block = document.createElement("div");
        block.innerHTML = `<p>${escHtml(summary)}</p>`;
        block.appendChild(holder);
        stepsDiv.appendChild(block);
      }
    }
  } catch (err) {
    setStatus(`BFS 失败：${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------- Report
async function renderReport() {
  const body = $("report-body");
  const empty = $("report-empty");
  if (!state.analysis || !state.scores) {
    body.hidden = true;
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  body.hidden = false;
  const overall = state.scores.overall;
  const a = state.analysis;
  $("report-score").textContent =
    overall.score === null ? "—（无已完成用例）" : `${overall.score}（${overall.scoreNumerator}/${overall.scoreDenominator}）`;
  const counts = a.cases.reduce((acc, c) => {
    if (c.verdict) acc[c.verdict] = (acc[c.verdict] || 0) + 1;
    return acc;
  }, {});
  $("report-counts").textContent =
    `STABLE ${counts.STABLE || 0} · WRONG_TARGET ${counts.WRONG_TARGET || 0} · AMBIGUOUS ${counts.AMBIGUOUS || 0} · MISSING ${counts.MISSING || 0} · incomplete ${overall.incomplete}`;
  $("report-coverage").textContent =
    `${overall.coverageNumerator}/${overall.coverageDenominator}${overall.coverage === null ? "" : `（${overall.coverage}）`} · analysisStatus ${overall.analysisStatus}`;
  $("report-baseline").textContent =
    `${a.baseline.verdict ?? "（无 verdict）"}（executionStatus ${a.baseline.executionStatus}，matchCount ${a.baseline.matchCount}）`;
  $("report-witness").textContent = state.witness
    ? `${state.witness.status}${state.witness.witness ? `：${state.witness.witness.sequence.join(" → ")}（${state.witness.witness.verdict}）` : ""}`
    : "未运行 BFS";
  $("report-operator-rows").innerHTML = MUTATION_ORDER.map((id) => {
    const row = state.scores.perOperator[id];
    if (!row) return "";
    return `<tr><td>${id} ${MUTATION_NAMES[id]}</td><td>${row.stable}</td><td>${row.wrongTarget}</td><td>${row.ambiguous}</td><td>${row.missing}</td><td>${row.score === null ? "—" : `${row.score}（${row.scoreNumerator}/${row.scoreDenominator}）`}</td></tr>`;
  }).join("");
  try {
    const reports = await apiJson("/ui/reports", {});
    let html = "";
    if (reports.t008.present) {
      const h = reports.t008.hashes;
      html += `<p><strong>T008 全量分析报告</strong>（24 fixtures / ${reports.t008.expectedCases} cases，已完成 ${reports.t008.completedCases}；总体分数 ${reports.t008.score ?? "—"}，coverage ${reports.t008.coverage ?? "—"}）：</p>
        <dl class="hash-list">
          <dt>scenario_sha256</dt><dd>${escHtml(h.scenario_sha256)}</dd>
          <dt>oracle_result_sha256</dt><dd>${escHtml(h.oracle_result_sha256)}</dd>
          <dt>analysis_sha256</dt><dd>${escHtml(h.analysis_sha256)}</dd>
          <dt>gate_sha256</dt><dd>${escHtml(h.gate_sha256)}</dd>
        </dl>`;
    } else {
      html += `<p>T008 全量分析报告文件不存在（evidence/s2/T008_API_REPORT.json）；可运行 <code>npm run report:t008</code> 生成。</p>`;
    }
    if (reports.s0.present) {
      html += `<p><strong>S0 冻结门禁哈希</strong>（evidence/s0/S0_GATE.json，只读展示）：<code>${escHtml(reports.s0.gateSha256)}</code></p>`;
    } else {
      html += `<p>S0 门禁文件不存在。</p>`;
    }
    $("report-hashes").innerHTML = html;
  } catch (err) {
    $("report-hashes").innerHTML = `<p>哈希加载失败：${escHtml(err.message)}</p>`;
  }
}

$("download-json").addEventListener("click", () => {
  if (!state.analysis) return;
  const payload = {
    schema: "locatorstress.ui-fixture-export/v1",
    fixtureId: state.selectedFixtureId,
    seed: state.seed,
    analysis: state.analysis,
    witness: state.witness,
    scores: state.scores,
    controls: state.controls,
    note: "Fixture-level export from the T009 UI: verdicts/witness from the frozen API, scores computed server-side by the frozen T005 scorer. Not a T008 full AnalysisReport.",
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${state.selectedFixtureId}-analysis.json`;
  link.click();
  URL.revokeObjectURL(url);
});

$("clear-run").addEventListener("click", () => {
  state.analysis = null;
  state.scores = null;
  state.controls = null;
  state.witness = null;
  state.snapshotCache.clear();
  state.selectedCase = null;
  renderMatrixEmpty();
  renderWitnessEmpty();
  renderReport();
  setStatus("本地运行数据已清空（后端无持久化状态）。");
});

// ---------------------------------------------------------------- init
async function init() {
  try {
    const health = await apiJson("/api/health", {});
    state.seed = health.seed || "";
    $("seed-text").textContent = state.seed;
    $("health-status").textContent =
      `API ok · 服务 locatorstress v${health.version} · seed ${health.seed} · BFS 上限 depth ${health.bfsLimits.maxDepth} / ${health.bfsLimits.maxExpandedStates} 扩展 · 变异顺序 ${health.mutationOrder.join(" ")}`;
  } catch (err) {
    $("health-status").textContent = `API 不可用：${err.message}`;
    setStatus(`无法连接本地 API：${err.message}`);
    return;
  }
  try {
    const [fixturesBody, mutationsBody] = await Promise.all([
      apiJson("/api/fixtures", {}),
      apiJson("/api/mutations", {}),
    ]);
    state.fixtures = fixturesBody.fixtures || [];
    state.mutations = mutationsBody.mutations || [];
    const families = [...new Set(state.fixtures.map((f) => f.family))].sort();
    $("fixture-filter-family").innerHTML =
      `<option value="">全部</option>` + families.map((f) => `<option value="${escHtml(f)}">${escHtml(f)}</option>`).join("");
    renderFixtureRows();
    renderMutationList();
    if (state.fixtures.length > 0) {
      await selectFixture(state.fixtures[0].fixtureId);
    }
  } catch (err) {
    setStatus(`fixture 列表加载失败：${err.message}`);
  }
}

void init();
```

## src/ui/index.html

- 行数：183；字节数：10649；SHA-256：`7c640c1822693081b72d08417c2ddedbfb57e6f85a32ffbe917c977677025142`

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LocatorStress — 定位器压力台</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<header class="app-header">
  <h1>LocatorStress <span class="subtitle">定位器压力台</span></h1>
  <p class="tagline">合成页面 × 确定性 DOM 变异 × Playwright 真实执行 × 元素身份 Oracle — 只展示后端算好的 verdict / 分数 / 见证，不在前端重新计算。</p>
  <p class="health" id="health-status" aria-live="polite">正在连接本地 API…</p>
</header>

<nav class="tabs" role="tablist" aria-label="视图">
  <button role="tab" id="tab-fixtures" aria-selected="true" aria-controls="view-fixtures" data-view="fixtures">Fixture Lab</button>
  <button role="tab" id="tab-locator" aria-selected="false" aria-controls="view-locator" data-view="locator">Locator 编辑</button>
  <button role="tab" id="tab-mutations" aria-selected="false" aria-controls="view-mutations" data-view="mutations">Mutation Lab</button>
  <button role="tab" id="tab-matrix" aria-selected="false" aria-controls="view-matrix" data-view="matrix">Verdict Matrix</button>
  <button role="tab" id="tab-witness" aria-selected="false" aria-controls="view-witness" data-view="witness">BFS Witness</button>
  <button role="tab" id="tab-report" aria-selected="false" aria-controls="view-report" data-view="report">Report</button>
</nav>

<main>
  <p id="run-status" class="status" aria-live="polite"></p>
  <p id="selected-fixture" class="selected-fixture" aria-live="polite">未选择 fixture。</p>

  <!-- 1. Fixture Lab -->
  <section id="view-fixtures" role="tabpanel" aria-labelledby="tab-fixtures">
    <h2>Fixture Lab — 24 个合成页面</h2>
    <p>固定 seed：<code id="seed-text">—</code>。每页 baseline 必须唯一命中原目标；稳定控制 12 / 脆弱控制 12；CSS / XPath / role 各 8。</p>
    <div class="filters">
      <label>Locator 类型
        <select id="fixture-filter-kind">
          <option value="">全部</option>
          <option value="css">css</option>
          <option value="xpath">xpath</option>
          <option value="role">role</option>
        </select>
      </label>
      <label>控制组
        <select id="fixture-filter-control">
          <option value="">全部</option>
          <option value="stable">stable</option>
          <option value="fragile">fragile</option>
        </select>
      </label>
      <label>页面家族
        <select id="fixture-filter-family">
          <option value="">全部</option>
        </select>
      </label>
    </div>
    <p id="fixture-count" aria-live="polite"></p>
    <table id="fixture-table">
      <thead><tr><th scope="col">Fixture</th><th scope="col">家族</th><th scope="col">Locator 类型</th><th scope="col">控制组</th><th scope="col">Locator</th></tr></thead>
      <tbody id="fixture-rows"></tbody>
    </table>
    <p class="hint">点击一行选择 fixture；Locator 列显示该 fixture 的冻结 Locator（分析始终使用它）。</p>
  </section>

  <!-- 2. Locator 编辑 -->
  <section id="view-locator" role="tabpanel" aria-labelledby="tab-locator" hidden>
    <h2>Locator 编辑</h2>
    <p id="loc-fixture-note">先在 Fixture Lab 选择一个 fixture，这里载入它的冻结 Locator 供编辑与校验。</p>
    <p class="hint">分析始终使用所选 fixture 的冻结 Locator；本页只做两件事：① 用后端 <code>/api/validate</code> 校验编辑后的 LocatorSpec 语法；② 在浏览器内预览它在原始 DOM 上的匹配情况（匹配计数与是否命中同一元素，仅为预览，不计算 verdict）。空必填字段等格式问题先由格式检查拦下（不发送给后端）；通过格式检查的草稿一律发给后端校验。本工具不提供自动生成、推荐或修复 Locator 的功能。</p>
    <form id="locator-form">
      <div class="form-row">
        <label for="loc-kind">kind</label>
        <select id="loc-kind">
          <option value="css">css</option>
          <option value="xpath">xpath</option>
          <option value="role">role</option>
        </select>
      </div>
      <div class="form-row" id="row-selector">
        <label for="loc-selector">selector</label>
        <input id="loc-selector" type="text" autocomplete="off" spellcheck="false">
      </div>
      <div class="form-row" id="row-role" hidden>
        <label for="loc-role">role</label>
        <input id="loc-role" type="text" autocomplete="off" spellcheck="false" placeholder="button / link / textbox …">
      </div>
      <div class="form-row" id="row-name" hidden>
        <label for="loc-name">name（accessible name，字符串）</label>
        <input id="loc-name" type="text" autocomplete="off" spellcheck="false">
      </div>
      <div class="form-row">
        <label><input id="loc-exact" type="checkbox"> exact（role name 精确匹配）</label>
        <label><input id="loc-include-hidden" type="checkbox"> includeHidden</label>
      </div>
      <div class="form-row">
        <label for="loc-framepath">framePath（0–2 层 iframe CSS selector，每行一个）</label>
        <textarea id="loc-framepath" rows="2" spellcheck="false"></textarea>
      </div>
      <div class="form-row">
        <label for="loc-index">index（可选 .nth(index)，0-based；留空表示无）</label>
        <input id="loc-index" type="number" min="0" step="1" placeholder="留空">
      </div>
      <div class="form-actions">
        <button type="button" id="loc-validate">校验 LocatorSpec</button>
        <button type="button" id="loc-preview">浏览器内匹配预览</button>
        <button type="button" id="loc-reset">恢复 fixture 冻结 Locator</button>
      </div>
    </form>
    <div id="loc-validate-result" aria-live="polite"></div>
    <div id="loc-preview-result" aria-live="polite"></div>
  </section>

  <!-- 3. Mutation Lab -->
  <section id="view-mutations" role="tabpanel" aria-labelledby="tab-mutations" hidden>
    <h2>Mutation Lab — M01–M08 与 DOM diff</h2>
    <p class="hint">变异后 DOM 来自 UI 服务器：它在独立 Playwright 页面上用冻结的变异注册表真实执行算子并序列化 DOM（含 open ShadowRoot 内容），只作展示，不参与 verdict 计算。选择一个算子查看原始 DOM 与变异 DOM 的行级差异。</p>
    <div id="mutation-list" class="mutation-list" role="group" aria-label="变异算子"></div>
    <p id="diff-summary" aria-live="polite"></p>
    <div id="diff-view" class="diff-view" aria-live="polite"></div>
  </section>

  <!-- 4. Verdict Matrix -->
  <section id="view-matrix" role="tabpanel" aria-labelledby="tab-matrix" hidden>
    <h2>Verdict Matrix — 四态结果</h2>
    <p class="hint">点击「运行分析」后，后端在真实 Chromium 上跑 baseline + M01–M08（共 9 次执行），返回四态 verdict。WRONG_TARGET 表示“返回了一个元素，但不是原目标”。颜色不是唯一的状态通道：每个格子都写明 verdict 文字。</p>
    <div class="form-actions">
      <button type="button" id="run-analysis">运行分析（baseline + M01–M08）</button>
    </div>
    <p id="analysis-status" aria-live="polite"></p>
    <div id="matrix-grid" class="matrix-grid" role="group" aria-label="verdict 矩阵"></div>
    <div id="case-detail" class="case-detail" aria-live="polite"></div>
  </section>

  <!-- 5. BFS Witness -->
  <section id="view-witness" role="tabpanel" aria-labelledby="tab-witness" hidden>
    <h2>BFS Witness — 最短失败序列</h2>
    <p class="hint">有界 BFS（深度 ≤ 6，状态 ≤ 4096）在后端运行；首个非 STABLE 序列即最短失败见证。BOUNDED_NO_WITNESS 只表示有限搜索内未找到，不证明所有 DOM 变化都安全；BOUNDED_INCOMPLETE 表示预算耗尽、搜索未完成，绝不是“无见证”。</p>
    <div class="form-row">
      <label for="bfs-depth">maxDepth（0–6）</label>
      <input id="bfs-depth" type="number" min="0" max="6" step="1" value="2">
      <label for="bfs-budget">maxExpandedStates（1–4096）</label>
      <input id="bfs-budget" type="number" min="1" max="4096" step="1" value="4096">
      <button type="button" id="run-bfs">运行 BFS</button>
    </div>
    <p id="witness-status" aria-live="polite"></p>
    <div id="witness-summary" aria-live="polite"></div>
    <div id="witness-steps" aria-live="polite"></div>
  </section>

  <!-- 6. Report -->
  <section id="view-report" role="tabpanel" aria-labelledby="tab-report" hidden>
    <h2>Report — 稳定性分数与导出</h2>
    <p class="hint">分数 = 100 × STABLE 用例数 / 已完成用例数（合成变异集比例，不是生产失败概率）；incomplete 用例不计分但降低 coverage。分数与控制组指标由 UI 服务器调用冻结的 T005 计分模块算出，浏览器只展示。</p>
    <div id="report-empty">还没有运行结果：先在 Verdict Matrix 运行分析（BFS 见证可选）。</div>
    <div id="report-body" hidden>
      <dl class="report-facts">
        <div><dt>稳定性分数</dt><dd id="report-score">—</dd></div>
        <div><dt>四态分布</dt><dd id="report-counts">—</dd></div>
        <div><dt>Coverage（已完成 / 应完成）</dt><dd id="report-coverage">—</dd></div>
        <div><dt>Baseline</dt><dd id="report-baseline">—</dd></div>
        <div><dt>BFS 见证</dt><dd id="report-witness">—</dd></div>
      </dl>
      <h3>按算子分数</h3>
      <table id="report-per-operator">
        <thead><tr><th scope="col">算子</th><th scope="col">STABLE</th><th scope="col">WRONG_TARGET</th><th scope="col">AMBIGUOUS</th><th scope="col">MISSING</th><th scope="col">分数</th></tr></thead>
        <tbody id="report-operator-rows"></tbody>
      </table>
      <h3>哈希（只读，来自后端报告文件）</h3>
      <div id="report-hashes" aria-live="polite"></div>
      <div class="form-actions">
        <button type="button" id="download-json">下载本次分析 JSON</button>
        <button type="button" id="clear-run">清空本地运行数据</button>
      </div>
      <p class="hint">离线 HTML 导出由 T010 提供（本版本只提供 JSON 下载；<code>/api/export</code> 的 HTML 格式目前返回 501）。</p>
    </div>
  </section>
</main>

<footer>
  <p>LocatorStress P022 · 本地工具，不连接外网；全部请求只走 loopback。合成数据，不证明真实用户价值（USER_VALUE_NOT_MEASURED）。</p>
</footer>

<script type="module" src="/app.js"></script>
</body>
</html>
```

## src/ui/styles.css

- 行数：132；字节数：7205；SHA-256：`5cd3e5d02038151de0f8a6c959dd45fc3cf622baf78f12bfbffe2a3f69a31345`

```css
/* T009 — LocatorStress UI styles. No external resources: system fonts only. */
:root {
  --ink: #1a1d21;
  --muted: #5b6470;
  --line: #d7dce1;
  --bg: #f7f8f9;
  --panel: #ffffff;
  --accent: #0b5fff;
  --ok: #137333;
  --warn: #8a5a00;
  --bad: #b3261e;
  --info: #5b21b6;
  --mono: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.app-header { padding: 16px 20px 8px; background: var(--panel); border-bottom: 1px solid var(--line); }
.app-header h1 { margin: 0; font-size: 22px; }
.app-header .subtitle { color: var(--muted); font-size: 16px; font-weight: 400; }
.tagline, .health { margin: 6px 0 0; }
.health { color: var(--muted); }
main { max-width: 1180px; margin: 0 auto; padding: 12px 20px 32px; }
footer { max-width: 1180px; margin: 0 auto; padding: 12px 20px 24px; color: var(--muted); font-size: 13px; }
h2 { font-size: 19px; margin: 18px 0 8px; }
h3 { font-size: 16px; margin: 18px 0 6px; }
code { font-family: var(--mono); font-size: 0.92em; background: #eef1f4; padding: 0 4px; border-radius: 3px; }
.hint { color: var(--muted); font-size: 13.5px; }
.status { min-height: 1.4em; color: var(--bad); font-weight: 600; }
.selected-fixture { font-weight: 600; }

/* Tabs */
.tabs { display: flex; flex-wrap: wrap; gap: 4px; padding: 10px 20px 0; background: var(--panel); border-bottom: 1px solid var(--line); }
.tabs button {
  border: 1px solid var(--line); border-bottom: none; background: #eef1f4;
  padding: 8px 14px; font: inherit; cursor: pointer; border-radius: 6px 6px 0 0;
}
.tabs button[aria-selected="true"] { background: var(--panel); font-weight: 700; border-bottom: 2px solid var(--accent); }
button, select, input, textarea { font: inherit; }
button { cursor: pointer; }
button:focus-visible, select:focus-visible, input:focus-visible, textarea:focus-visible, [tabindex]:focus-visible {
  outline: 3px solid var(--accent); outline-offset: 1px;
}
.form-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
.form-actions button, .mutation-list button {
  border: 1px solid var(--accent); background: var(--accent); color: #fff;
  border-radius: 6px; padding: 8px 14px;
}
.form-actions button[aria-pressed="true"], .mutation-list button[aria-pressed="true"] {
  background: #083d9e; border-color: #083d9e; box-shadow: inset 0 0 0 2px #fff;
}
.form-actions button:disabled { opacity: 0.55; cursor: wait; }
.form-row { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin: 8px 0; }
.form-row label { display: flex; flex-direction: column; gap: 4px; font-weight: 600; font-size: 13.5px; }
.form-row label:has(input[type="checkbox"]) { flex-direction: row; align-items: center; font-weight: 400; }
input[type="text"], input[type="number"], textarea, select {
  border: 1px solid var(--line); border-radius: 6px; padding: 7px 9px; background: #fff; min-width: 220px;
}
input[type="number"] { min-width: 90px; }
textarea { width: 100%; max-width: 560px; font-family: var(--mono); font-size: 13px; }

/* Tables */
table { border-collapse: collapse; width: 100%; background: var(--panel); }
th, td { border: 1px solid var(--line); padding: 7px 9px; text-align: left; vertical-align: top; }
thead th { background: #eef1f4; }
tbody tr[data-selected="true"] { background: #dce8ff; }
tbody tr { cursor: pointer; }
tbody tr:hover { background: #eef6ff; }
#fixture-table td.mono, td.mono { font-family: var(--mono); font-size: 13px; }

/* Verdict chips — text always present; colour is never the only channel. */
.verdict { display: inline-block; font-weight: 700; padding: 2px 8px; border-radius: 999px; border: 1.5px solid; white-space: nowrap; }
.verdict-STABLE { color: var(--ok); border-color: var(--ok); background: #e6f4ea; }
.verdict-WRONG_TARGET { color: var(--bad); border-color: var(--bad); background: #fce8e6; }
.verdict-AMBIGUOUS { color: var(--warn); border-color: var(--warn); background: #fef7e0; }
.verdict-MISSING { color: var(--info); border-color: var(--info); background: #f3e8ff; }
.verdict-none { color: var(--muted); border-color: var(--muted); background: #f1f3f4; }
.verdict-note { display: block; font-size: 12.5px; font-weight: 400; color: var(--muted); margin-top: 2px; }

/* Matrix grid */
.matrix-grid { display: grid; grid-template-columns: repeat(3, minmax(140px, 1fr)); gap: 10px; margin: 12px 0; }
.matrix-cell {
  border: 1px solid var(--line); border-radius: 8px; background: var(--panel);
  padding: 10px; text-align: left; cursor: pointer;
}
.matrix-cell[aria-pressed="true"] { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent); }
.matrix-cell .cell-id { font-weight: 700; font-family: var(--mono); }
.matrix-cell .cell-detail { font-size: 13px; color: var(--muted); margin-top: 4px; }
.case-detail { border: 1px solid var(--line); border-radius: 8px; background: var(--panel); padding: 12px; margin-top: 12px; }
.case-detail dl { display: grid; grid-template-columns: 180px 1fr; gap: 4px 12px; margin: 0; }
.case-detail dt { font-weight: 700; }
.case-detail dd { margin: 0; }

/* Mutation list + diff */
.mutation-list { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
.diff-view { font-family: var(--mono); font-size: 12.5px; line-height: 1.5; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); overflow-x: auto; }
.diff-view table { border: none; }
.diff-view td { border: none; padding: 1px 8px; white-space: pre; }
.diff-view tr.diff-add td { background: #d9f2df; }
.diff-view tr.diff-del td { background: #fbd9d3; }
.diff-view tr.diff-same td { color: var(--muted); }
.diff-view .ln { color: #9aa0a6; text-align: right; user-select: none; width: 1%; }
.diff-view .sign { width: 1%; text-align: center; font-weight: 700; }
.diff-empty { padding: 12px; color: var(--muted); font-family: system-ui, sans-serif; }

/* Report */
.report-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin: 12px 0; }
.report-facts > div { border: 1px solid var(--line); border-radius: 8px; background: var(--panel); padding: 10px 12px; }
.report-facts dt { font-weight: 700; font-size: 13px; color: var(--muted); }
.report-facts dd { margin: 4px 0 0; font-size: 16px; }
.hash-list { font-family: var(--mono); font-size: 12.5px; word-break: break-all; }
.hash-list dt { font-weight: 700; }
.hash-list dd { margin: 0 0 6px; }

.filters { display: flex; flex-wrap: wrap; gap: 12px; margin: 10px 0; }
.filters label { display: flex; flex-direction: column; gap: 4px; font-weight: 600; font-size: 13.5px; }
.filters select { min-width: 140px; }

/* Narrow screens (390×844 target) */
@media (max-width: 640px) {
  body { font-size: 14px; }
  main, .app-header, .tabs, footer { padding-left: 12px; padding-right: 12px; }
  .matrix-grid { grid-template-columns: repeat(2, 1fr); }
  .case-detail dl { grid-template-columns: 1fr; }
  input[type="text"], input[type="number"], textarea, select { min-width: 0; width: 100%; }
  .form-row { flex-direction: column; align-items: stretch; }
  table { display: block; overflow-x: auto; }
}
```

## src/ui/node-shims.d.ts

- 行数：16；字节数：670；SHA-256：`5afd4c231a9e11df1ea75dc08ac09b1f2a5571729b8eb3aa8e6bed2c99e570c6`

```ts
// Minimal ambient declarations for the Node.js built-ins used by the
// UI server only. Same precedent as src/api/node-shims.d.ts: the
// project has no @types/node dependency (by design: no new
// dependencies), so each module carries declarations covering exactly
// the surface it uses. Only `process` is declared here; everything
// else the UI server needs comes from src/node-builtins.d.ts and
// src/api/node-shims.d.ts.

declare const process: {
  argv: string[];
  stdout: { write(text: string): void };
  stderr: { write(text: string): void };
  exitCode: number;
  exit(code: number): never;
  on(event: "SIGINT" | "SIGTERM", listener: () => void): void;
};
```

## src/node-builtins.d.ts

- 行数：17；字节数：666；SHA-256：`eeda48723c9afd64fb091d7e623ca5a6b6025ca9488dc1607337999d3b08424a`

```ts
// Minimal ambient declarations for the Node.js built-ins used by T002 fixture
// loading. The runtime is Node.js 24 (see ENVIRONMENT_REPORT.md); no new npm
// dependency is introduced for these standard-library functions.
declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: "utf8" | "utf-8"): string;
}

declare module "node:path" {
  export function join(...paths: string[]): string;
  export function dirname(path: string): string;
  export function resolve(...paths: string[]): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}
```
