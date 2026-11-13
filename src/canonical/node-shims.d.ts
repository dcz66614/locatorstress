// Minimal ambient declarations for the Node.js built-ins used by the
// canonical module only. The project has no @types/node dependency (by
// design: no new dependencies), and src/node-builtins.d.ts is shared
// infrastructure that this task must not modify — so the canonical
// module carries its own declarations, covering exactly the API surface
// it uses. Kept in src/canonical/ so the module stays self-contained.
declare module "node:crypto" {
  interface Hash {
    update(data: string, encoding: string): Hash;
    update(data: Uint8Array): Hash;
    digest(encoding: "hex"): string;
  }
  export function createHash(algorithm: string): Hash;
}

declare module "node:os" {
  export function hostname(): string;
  export function tmpdir(): string;
  export function userInfo(): { username: string };
}
