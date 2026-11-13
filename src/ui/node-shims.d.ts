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
