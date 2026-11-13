// Minimal ambient declarations for the Node.js built-ins used by scripts/.
// The project has no @types/node dependency (by design: no new dependencies),
// and the build tsconfig (include ["src"]) is untouched. These declarations
// cover exactly the API surface used by scripts/s0-gate.ts and
// scripts/repeat-hash.ts, so `npm run typecheck:scripts` can run strict
// tsc --noEmit over scripts/ without them.

declare module "node:crypto" {
  interface Hash {
    update(data: string, encoding: string): Hash;
    digest(encoding: "hex"): string;
  }
  export function createHash(algorithm: string): Hash;
}

declare module "node:child_process" {
  interface ChildProcessStream {
    on(event: "data", listener: (chunk: Buffer) => void): void;
  }
  interface ChildProcess {
    stdout: ChildProcessStream;
    stderr: ChildProcessStream;
    on(event: "error", listener: (err: unknown) => void): void;
    on(event: "close", listener: (code: number | null) => void): void;
    kill(signal?: string): void;
  }
  export function spawn(
    command: string,
    args: string[],
    options?: { cwd?: string; stdio?: unknown },
  ): ChildProcess;
  export function spawnSync(
    command: string,
    args: string[],
    options: { cwd?: string; timeout?: number; encoding?: string; stdio?: unknown },
  ): { stdout: string; stderr: string; status: number | null };
}

declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function rmSync(path: string, options?: { force?: boolean; recursive?: boolean }): void;
  export function writeFileSync(path: string, data: string, encoding: "utf8"): void;
  export function mkdtempSync(prefix: string): string;
}

declare module "node:path" {
  export function dirname(path: string): string;
  export function join(...paths: string[]): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare module "node:os" {
  export function tmpdir(): string;
}

declare const process: {
  argv: string[];
  version: string;
  versions: { node: string };
  cwd(): string;
  execPath: string;
  env: Record<string, string | undefined>;
  exit(code?: number): never;
  stdout: { write(s: string): void };
  stderr: { write(s: string): void };
};

declare class Buffer extends Uint8Array {
  toString(encoding?: string): string;
}
