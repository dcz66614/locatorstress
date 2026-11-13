// Minimal ambient declarations for the Node.js built-ins used by the
// JSON exporter only. The project has no @types/node dependency (by
// design: no new dependencies). src/node-builtins.d.ts declares
// readFileSync but not writeFileSync, so this module declares the one
// extra function it uses (same precedent as
// src/canonical/node-shims.d.ts: per-module minimal declarations, no
// shared-file edits).

declare module "node:fs" {
  export function writeFileSync(path: string, data: string, encoding: "utf8" | "utf-8"): void;
}
