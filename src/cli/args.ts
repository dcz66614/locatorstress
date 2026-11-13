// FIX-R1-03 — Minimal flag parser for the CLI (P022-R1-P1-03).
//
// Flags are `--name value` (value-taking) or `--name` (boolean). A
// bare `--` ends flag parsing; anything after it is a positional.
// Unknown flags and missing values are usage errors (exit 2) —
// never silently ignored, so a typo cannot silently change a run.

import { usageError } from "./errors.js";
import type { CliError } from "./errors.js";

export interface ParsedFlags {
  /** Flag values by name (boolean flags map to the string "true"). */
  values: Map<string, string>;
  /** Positional arguments (after `--`, or bare words). */
  positionals: string[];
}

export function parseFlags(
  argv: readonly string[],
  valueFlags: ReadonlySet<string>,
  booleanFlags: ReadonlySet<string>,
): ParsedFlags {
  const values = new Map<string, string>();
  const positionals: string[] = [];
  let onlyPositionals = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (onlyPositionals) {
      positionals.push(arg);
      continue;
    }
    if (arg === "--") {
      onlyPositionals = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      if (name === "" || name.includes("=")) {
        throw usageError(
          `malformed flag ${JSON.stringify(arg)} (expected --name value, no "=" form)`,
        );
      }
      if (booleanFlags.has(name)) {
        if (values.has(name)) {
          throw usageError(`flag --${name} supplied twice`);
        }
        values.set(name, "true");
        continue;
      }
      if (valueFlags.has(name)) {
        if (values.has(name)) {
          throw usageError(`flag --${name} supplied twice`);
        }
        if (i + 1 >= argv.length) {
          throw usageError(`flag --${name} requires a value`);
        }
        values.set(name, argv[i + 1]!);
        i += 1;
        continue;
      }
      throw usageError(`unknown flag --${name}`);
    }
    if (arg.startsWith("-") && arg !== "-") {
      throw usageError(
        `unknown flag ${JSON.stringify(arg)} (only --long flags are accepted)`,
      );
    }
    positionals.push(arg);
  }
  return { values, positionals };
}

/** Require that no positional arguments were supplied. */
export function rejectPositionals(flags: ParsedFlags): void {
  if (flags.positionals.length > 0) {
    throw usageError(
      `unexpected positional argument(s): ${flags.positionals.map((p) => JSON.stringify(p)).join(", ")}`,
    );
  }
}

export function requiredFlag(
  flags: ParsedFlags,
  name: string,
): string {
  const value = flags.values.get(name);
  if (value === undefined) {
    throw usageError(`missing required flag --${name}`);
  }
  return value;
}

/** Parse an integer flag value, enforcing the given inclusive range. */
export function integerFlag(
  flags: ParsedFlags,
  name: string,
  min: number,
  max: number,
): number | undefined {
  const raw = flags.values.get(name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw usageError(
      `--${name} must be an integer in ${min}..${max}, got ${JSON.stringify(raw)}`,
    );
  }
  return n;
}

/** Re-throw a CliError unchanged; anything else is a bug in the caller. */
export function isCliError(err: unknown): err is CliError {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    "exitCode" in err &&
    typeof (err as CliError).code === "string" &&
    typeof (err as CliError).exitCode === "number"
  );
}
