// Minimal ambient declarations for the Node.js built-ins used by the
// API server only. The project has no @types/node dependency (by
// design: no new dependencies), and src/node-builtins.d.ts is shared
// infrastructure — so the API module carries its own declarations,
// covering exactly the API surface it uses (same precedent as
// src/canonical/node-shims.d.ts). Kept in src/api/ so the module stays
// self-contained.

declare module "node:http" {
  interface IncomingMessage {
    url?: string;
    method?: string;
    on(event: "data", listener: (chunk: Buffer) => void): void;
    on(event: "end", listener: () => void): void;
    on(event: "error", listener: (err: Error) => void): void;
  }
  interface ServerResponse {
    readonly headersSent: boolean;
    writeHead(statusCode: number, headers: Record<string, string>): void;
    end(data?: string): void;
  }
  interface AddressInfo {
    address: string;
    port: number;
    family: string;
  }
  interface Server {
    listen(port: number, host: string, callback: () => void): void;
    address(): AddressInfo | string | null;
    close(callback: () => void): void;
    once(event: "error", listener: (err: Error) => void): void;
    removeListener(event: "error", listener: (err: Error) => void): void;
  }
  export function createServer(
    handler: (req: IncomingMessage, res: ServerResponse) => void,
  ): Server;
}

declare class Buffer extends Uint8Array {
  static concat(list: Buffer[]): Buffer;
  toString(encoding?: string): string;
}
