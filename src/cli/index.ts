// FIX-R1-03 — CLI entry point (P022-R1-P1-03, PROJECT_BOOK §7.3).
//
//   npm run dev
//   npm run demo
//   npm run analyze -- --scenario <file> | --fixture <id>
//   npm run search  -- --scenario <file> | --fixture <id>
//   npm run export  -- --run <id> --format json|html
//   npm run s0:gate
//
// The five commands above are the frozen §7.3 CLI contract. Every
// command reuses the existing service API (FIX-R1-01's scenario path
// + FIX-R1-02's export path) and the frozen runner/mutations/
// Oracle/BFS — the CLI computes no verdict, score or witness
// itself. All failures print `ERROR <CODE>: <message>` on stderr;
// exit 0 ok, 1 work failed, 2 invoked wrongly (see errors.ts).
//
// Usage: node dist/cli/index.js <command> [flags...]

import { mapApiError } from "./browser-service.js";
import { isCliError } from "./args.js";
import { CliError } from "./errors.js";
import { runAnalyze, ANALYZE_USAGE } from "./commands/analyze.js";
import { runSearch, SEARCH_USAGE } from "./commands/search.js";
import { runDemo, DEMO_USAGE } from "./commands/demo.js";
import { runDev, DEV_USAGE } from "./commands/dev.js";
import { runExport, EXPORT_USAGE } from "./commands/export.js";

export const CLI_USAGE = [
  "LocatorStress CLI — PROJECT_BOOK §7.3",
  "",
  "usage: node dist/cli/index.js <command> [flags...]",
  "",
  "commands:",
  `  dev      ${DEV_USAGE}`,
  `  demo     ${DEMO_USAGE}`,
  `  analyze  ${ANALYZE_USAGE}`,
  `  search   ${SEARCH_USAGE}`,
  `  export   ${EXPORT_USAGE}`,
  "",
  "Every command also accepts --help. Run ids are fixture ids",
  "(F001–F024), scenario_ids, \"demo\", or \"t008\" (the frozen T008",
  "report). Runs are stored under runs/<id>.json.",
].join("\n");

async function dispatch(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined) {
    process.stderr.write(`ERROR CLI_USAGE: missing command\n${CLI_USAGE}\n`);
    return 2;
  }
  if (command === "--help" || command === "-h") {
    process.stdout.write(`${CLI_USAGE}\n`);
    return 0;
  }
  switch (command) {
    case "dev":
      return runDev(rest);
    case "demo":
      return runDemo(rest);
    case "analyze":
      return runAnalyze(rest);
    case "search":
      return runSearch(rest);
    case "export":
      return runExport(rest);
    default:
      throw new CliError(
        "CLI_USAGE",
        `unknown command ${JSON.stringify(command)}\n${CLI_USAGE}`,
        2,
      );
  }
}

async function main(): Promise<void> {
  try {
    process.exitCode = await dispatch(process.argv.slice(2));
  } catch (err) {
    if (isCliError(err)) {
      process.stderr.write(`ERROR ${err.code}: ${err.message}\n`);
      process.exitCode = err.exitCode;
      return;
    }
    const mapped = mapApiError(err);
    process.stderr.write(`ERROR ${mapped.code}: ${mapped.message}\n`);
    process.exitCode = mapped.exitCode;
  }
}

void main();
