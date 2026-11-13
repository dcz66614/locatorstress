// FIX-R1-03 — CLI error type (P022-R1-P1-03, PROJECT_BOOK §7.3).
//
// Every CLI failure prints `ERROR <CODE>: <message>` on stderr and
// exits non-zero. Exit codes:
//   - 0: success.
//   - 1: the invocation was well-formed but the work failed (missing
//     file, invalid scenario content, unknown run, target not
//     found/ambiguous, browser launch failure, ...).
//   - 2: the CLI itself was invoked wrongly (unknown flag, missing
//     required flag, malformed flag value). Usage errors never launch
//     a browser.

export class CliError extends Error {
  readonly code: string;
  readonly exitCode: number;
  constructor(code: string, message: string, exitCode = 1) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
  }
}

export function usageError(message: string): CliError {
  return new CliError("CLI_USAGE", message, 2);
}

export function runtimeError(code: string, message: string): CliError {
  return new CliError(code, message, 1);
}
