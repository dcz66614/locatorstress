// T008 — Local API HTTP server (PROJECT_BOOK §7.3, §10).
//
// Node built-in http only; no framework, no external dependency. The
// server binds ONLY to a loopback address — 127.0.0.1 by default, ::1
// also accepted — and startAnalysisServer() THROWS for any other host,
// including 0.0.0.0. Binding is verified after listen(): the reported
// address must equal the requested loopback host, otherwise the server
// is closed and startup fails. The port defaults to 0 (ephemeral); the
// actual port is reported in the returned handle and is never part of
// any canonical hash.
//
// JSON bodies are limited to 1 MiB; malformed JSON is a 400, never a
// crash. Responses are canonical JSON (sorted keys) for stable bytes.

import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import { canonicalJson } from "../canonical/canonical-json.js";
import type { AnalysisService } from "./service.js";
import { MAX_JSON_BODY_BYTES } from "./service.js";
import { handleApiRequest } from "./routes.js";

export const LOOPBACK_HOSTS: readonly string[] = ["127.0.0.1", "::1"];
export const DEFAULT_API_HOST = "127.0.0.1";

export function assertLoopbackHost(host: string): void {
  if (!LOOPBACK_HOSTS.includes(host)) {
    throw new Error(
      `API host must be a loopback address (${LOOPBACK_HOSTS.join(" or ")}); got ${JSON.stringify(host)} — refusing to bind a non-loopback address`,
    );
  }
}

export interface RunningApiServer {
  server: Server;
  host: string;
  port: number;
  url: string;
  close(): Promise<void>;
}

export interface StartApiServerOptions {
  host?: string;
  port?: number;
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
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
        reject(new Error(`JSON body exceeds ${MAX_JSON_BODY_BYTES} bytes`));
        return;
      }
      const text = Buffer.concat(chunks).toString("utf-8");
      if (text.trim() === "") {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(text) as unknown);
      } catch {
        reject(new Error("request body is not valid JSON"));
      }
    });
    req.on("error", (err: Error) => reject(err));
  });
}

export async function startAnalysisServer(
  service: AnalysisService,
  options: StartApiServerOptions = {},
): Promise<RunningApiServer> {
  const host = options.host ?? DEFAULT_API_HOST;
  assertLoopbackHost(host);
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`API port must be an integer in 0..65535, got ${String(port)}`);
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}`);
      const path = url.pathname;
      let body: unknown = null;
      if (req.method === "POST") {
        try {
          body = await readJsonBody(req);
        } catch (err) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(
            canonicalJson({
              error: {
                code: "BAD_REQUEST",
                message: err instanceof Error ? err.message : String(err),
              },
            }),
          );
          return;
        }
      }
      const result = await handleApiRequest(
        service,
        req.method ?? "GET",
        path,
        body,
      );
      // FIX-R1-02: a route may return raw text (the HTML export) instead
      // of a JSON body. Send it with the route's content type; the
      // headersSent guard below still applies if serialisation fails
      // after writeHead.
      if (result.rawBody !== undefined) {
        res.writeHead(result.status, {
          "content-type": result.contentType ?? "application/json",
        });
        res.end(result.rawBody);
        return;
      }
      res.writeHead(result.status, { "content-type": "application/json" });
      res.end(canonicalJson(result.body));
    } catch (err) {
      // FIX-T009 (defence in depth): if headers already went out — e.g.
      // canonicalJson() threw after writeHead(200) — never write headers
      // again; doing so throws ERR_HTTP_HEADERS_SENT uncaught and kills
      // the process. Just end the response.
      if (res.headersSent) {
        res.end();
        return;
      }
      res.writeHead(500, { "content-type": "application/json" });
      res.end(
        canonicalJson({
          error: {
            code: "INTERNAL_ERROR",
            message: err instanceof Error ? err.message : String(err),
          },
        }),
      );
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
    throw new Error(
      `API loopback bind verification failed: requested ${host}, server reports ${actual}`,
    );
  }
  const actualPort = address.port;
  return {
    server,
    host,
    port: actualPort,
    url: `http://${host}:${actualPort}`,
    async close(): Promise<void> {
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
