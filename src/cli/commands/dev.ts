// FIX-R1-03 — `dev` command (P022-R1-P1-03, PROJECT_BOOK §7.3).
//
//   npm run dev [--port N] [--host 127.0.0.1]
//
// Starts the local Web UI server (the same startUiServer() the UI
// entry point uses: frozen API proxied same-origin, static UI files,
// loopback-only bind) and stays in the foreground until SIGINT /
// SIGTERM. Default port is 0 (ephemeral, like src/ui/server.ts);
// the actual URL is printed on stdout as UI_URL= / API_URL=.
//
// Exit codes: 0 on clean shutdown; 1 when the server cannot start;
// 2 CLI usage error.

import { startUiServer } from "../../ui/server.js";
import type { RunningUiServer } from "../../ui/server.js";
import { integerFlag, parseFlags, rejectPositionals } from "../args.js";
import type { ParsedFlags } from "../args.js";
import { runtimeError } from "../errors.js";

export const DEV_USAGE =
  "usage: npm run dev [--port N] [--host 127.0.0.1]";

const VALUE_FLAGS = new Set(["port", "host"]);
const BOOLEAN_FLAGS = new Set(["help"]);

export async function runDev(argv: readonly string[]): Promise<number> {
  const flags: ParsedFlags = parseFlags(argv, VALUE_FLAGS, BOOLEAN_FLAGS);
  if (flags.values.has("help")) {
    process.stdout.write(`${DEV_USAGE}\n`);
    return 0;
  }
  rejectPositionals(flags);
  const port = integerFlag(flags, "port", 0, 65535);
  const host = flags.values.get("host") ?? "127.0.0.1";

  let running: RunningUiServer;
  try {
    running = await startUiServer({
      host,
      ...(port !== undefined ? { port } : {}),
    });
  } catch (err) {
    throw runtimeError(
      "SERVER_START_FAILED",
      `failed to start UI server: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  process.stdout.write(`UI_URL=${running.url}\n`);
  process.stdout.write(`API_URL=${running.apiUrl}\n`);
  process.stdout.write(
    `LocatorStress UI listening on ${running.url} (API proxied at /api, backend ${running.apiUrl})\n`,
  );
  await new Promise<void>((resolvePromise) => {
    const shutdown = (): void => {
      void running.close().finally(() => {
        resolvePromise();
      });
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
  return 0;
}
