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
//       POST /ui/export-html   — the current (fixture or custom) analysis
//         as a standalone offline HTML document (FIX-R1-02; renders the
//         same page-level payload the JSON download writes, via
//         src/export/ui-report-html.ts — NOT a full T008 report);
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
import { exportPageReportHtml } from "../export/ui-report-html.js";
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
    // FIX-R1-01: custom runs carry controlGroup "custom", which the
    // frozen T005 scorer rejects as unknown. Omit it: ScoreCase
    // controlGroup is optional, and control metrics are only computed
    // when every case has an expected verdict (never for custom runs).
    const controlGroup = entry["controlGroup"];
    return {
      fixtureId: entry["fixtureId"],
      mutationId: entry["mutationId"],
      locatorKind: entry["locatorKind"],
      ...(controlGroup === "stable" || controlGroup === "fragile"
        ? { controlGroup }
        : {}),
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
          // FIX-R1-01: a custom scenario may replace fixtureId for the
          // DOM diff (same mutations, same Oracle target capture).
          if (body["scenario"] !== undefined) {
            if (body["fixtureId"] !== undefined) {
              throw new Error("supply exactly one of fixtureId or scenario");
            }
            const sequence = validateSnapshotSequence(body["sequence"] ?? []);
            const snapshot = await snapshotter.snapshotCustom(body["scenario"], sequence);
            sendJson(res, 200, snapshot);
            return;
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

      if (method === "POST" && path === "/ui/export-html") {
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
          // FIX-R1-02: renders the same page-level payload the JSON
          // download writes (fixture or custom run). The renderer
          // validates the shape and throws on a malformed payload.
          const html = exportPageReportHtml(body);
          sendText(res, 200, "text/html; charset=utf-8", html);
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

// Only run the standalone server when this module is the entry
// point (node dist/ui/server.js ...). When imported as a library —
// by the CLI `dev` command and by tests, which call startUiServer()
// directly — the entry point's argv must NOT be parsed here: it
// belongs to the importer, and parsing it would print a spurious
// "unknown argument" error and set a wrong exit code.
const invokedAsMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsMain) {
  void main();
}
