// T008 API server tests — real HTTP over a fake service.
//
// Proves the loopback-only bind: the server starts on 127.0.0.1 with an
// ephemeral port, reports that exact address, and REFUSES to start on
// 0.0.0.0 (or any non-loopback host). Also covers malformed JSON (400)
// and unknown paths (404) at the HTTP layer.

import { describe, it, expect } from "vitest";

import { startAnalysisServer, assertLoopbackHost } from "../../src/api/server.js";
import type { AnalysisService } from "../../src/api/service.js";

function fakeService(): AnalysisService {
  return {
    health: () => ({
      status: "ok",
      service: "locatorstress",
      version: "0.1.0",
      seed: "P022-LOCATORSTRESS-S0-2026-11-10",
      bfsLimits: { maxDepth: 6, maxExpandedStates: 4096 },
      mutationOrder: ["M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08"],
    }),
    listFixtures: () => [],
    listMutations: () => [],
    validate: () => ({ valid: true, errors: [] }),
    analyze: async () => {
      throw new Error("not used in server tests");
    },
    search: async () => {
      throw new Error("not used in server tests");
    },
  };
}

describe("loopback-only bind", () => {
  it("assertLoopbackHost accepts 127.0.0.1 and ::1 and rejects the rest", () => {
    expect(() => assertLoopbackHost("127.0.0.1")).not.toThrow();
    expect(() => assertLoopbackHost("::1")).not.toThrow();
    expect(() => assertLoopbackHost("0.0.0.0")).toThrow(/loopback/);
    expect(() => assertLoopbackHost("192.168.1.1")).toThrow(/loopback/);
    expect(() => assertLoopbackHost("localhost")).toThrow(/loopback/);
    expect(() => assertLoopbackHost("")).toThrow(/loopback/);
  });

  it("startAnalysisServer refuses 0.0.0.0 without listening", async () => {
    await expect(
      startAnalysisServer(fakeService(), { host: "0.0.0.0", port: 0 }),
    ).rejects.toThrow(/loopback/);
  });

  it("serves on 127.0.0.1 only, with the verified address", async () => {
    const running = await startAnalysisServer(fakeService(), { host: "127.0.0.1", port: 0 });
    try {
      expect(running.host).toBe("127.0.0.1");
      expect(running.port).toBeGreaterThan(0);
      // The live socket address must be the loopback host we asked for.
      const address = running.server.address();
      expect(address).not.toBeNull();
      if (typeof address !== "string" && address !== null) {
        expect(address.address).toBe("127.0.0.1");
        expect(address.port).toBe(running.port);
      }

      const health = await fetch(`${running.url}/api/health`);
      expect(health.status).toBe(200);
      const healthBody = (await health.json()) as Record<string, unknown>;
      expect(healthBody["status"]).toBe("ok");
      expect(healthBody["seed"]).toBe("P022-LOCATORSTRESS-S0-2026-11-10");

      const fixtures = await fetch(`${running.url}/api/fixtures`);
      expect(fixtures.status).toBe(200);
      expect(((await fixtures.json()) as { fixtures: unknown[] }).fixtures).toEqual([]);

      const missing = await fetch(`${running.url}/api/nope`);
      expect(missing.status).toBe(404);
    } finally {
      await running.close();
    }
  });

  it("malformed JSON body is a 400, not a crash", async () => {
    const running = await startAnalysisServer(fakeService(), { host: "127.0.0.1", port: 0 });
    try {
      const res = await fetch(`${running.url}/api/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("BAD_REQUEST");
      // The server is still alive after the bad body.
      const health = await fetch(`${running.url}/api/health`);
      expect(health.status).toBe(200);
    } finally {
      await running.close();
    }
  });
});
