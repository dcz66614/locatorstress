// Minimal ambient declarations for the Node.js built-ins used by the
// CLI only. The project has no @types/node dependency (by design: no
// new dependencies), and src/node-builtins.d.ts is shared
// infrastructure — so the CLI module carries its own declarations,
// covering exactly the API surface it uses (same precedent as
// src/canonical/node-shims.d.ts and src/export/node-shims.d.ts).
// Kept in src/cli/ so the module stays self-contained.

declare module "node:fs" {
  export function mkdirSync(
    path: string,
    options: { recursive: boolean },
  ): void;
  export function readdirSync(path: string): string[];
}
