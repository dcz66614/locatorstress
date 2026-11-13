// Minimal ambient declarations for the Node.js built-ins used by T002 fixture
// loading. The runtime is Node.js 24 (see ENVIRONMENT_REPORT.md); no new npm
// dependency is introduced for these standard-library functions.
declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: "utf8" | "utf-8"): string;
}

declare module "node:path" {
  export function join(...paths: string[]): string;
  export function dirname(path: string): string;
  export function resolve(...paths: string[]): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}
