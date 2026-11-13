import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const SEED = "P022-LOCATORSTRESS-S0-2026-11-10";
const RUNS = 100;
const PER_RUN_TIMEOUT_MS = 600000;

const __filename = fileURLToPath(import.meta.url);
const scriptsDir = dirname(__filename);
const repoRoot = dirname(scriptsDir);
const evidenceDir = join(repoRoot, "evidence", "s0");

function canonicalJson(value: unknown): string {
  return serialize(value);
}

function compareCodePoints(a: string, b: string): number {
  const ca = Array.from(a);
  const cb = Array.from(b);
  const len = Math.min(ca.length, cb.length);
  for (let i = 0; i < len; i++) {
    const pa = ca[i].codePointAt(0)!;
    const pb = cb[i].codePointAt(0)!;
    if (pa !== pb) return pa < pb ? -1 : 1;
  }
  if (ca.length !== cb.length) return ca.length < cb.length ? -1 : 1;
  return 0;
}

function serialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number in canonical JSON");
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
  if (Array.isArray(value)) {
    return "[" + value.map(serialize).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort(compareCodePoints);
    const parts: string[] = [];
    for (const k of keys) {
      parts.push(JSON.stringify(k.normalize("NFC")) + ":" + serialize(obj[k]));
    }
    return "{" + parts.join(",") + "}";
  }
  throw new Error("unsupported value in canonical JSON");
}

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

interface RunOutJson {
  passed?: unknown;
  gate_sha256?: unknown;
  externalRequests?: unknown;
}

interface Failure {
  run: number;
  reason: string;
}

interface Evidence {
  schema: string;
  seed: string;
  runs: number;
  completed: number;
  uniqueGateHashes: number;
  gate_sha256: string;
  hashes: string[];
  passed: boolean;
  failures: Failure[];
}

const HEX64 = /^[0-9a-f]{64}$/;

function sanitize(text: string): string {
  let out = text;
  const roots = [repoRoot, tmpdir()];
  for (const r of roots) {
    if (r.length > 0) {
      out = out.split(r).join("<path>");
    }
  }
  return out;
}

class OutputCollector {
  lines: string[] = [];
  print(line: string): void {
    const clean = sanitize(line);
    this.lines.push(clean);
    process.stdout.write(clean + "\n");
  }
}

interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runChild(args: string[]): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      if (!settled) {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    }, PER_RUN_TIMEOUT_MS);

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, timedOut });
    });
    child.on("close", (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

function lastLineStartingWith(text: string, prefix: string): string | null {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith(prefix)) return lines[i];
  }
  return null;
}

function parseKey(hexLine: string, key: string): string | null {
  const m = new RegExp(key + "=([^\\s]+)").exec(hexLine);
  return m ? m[1] : null;
}

function writeEvidence(evidence: Evidence): void {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, "S0_REPEAT_HASH.json"), canonicalJson(evidence) + "\n", "utf8");
}

function writeLog(lines: string[]): void {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, "S0_REPEAT_HASH.log"), lines.join("\n") + (lines.length > 0 ? "\n" : ""), "utf8");
}

function usage(): string {
  return [
    "Usage: node scripts/repeat-hash.ts",
    "",
    "Runs the S0 single-analysis 100 times serially and verifies that the",
    "gate_sha256 is identical across every run.",
    "",
    "No arguments accepted. --help prints this message.",
  ].join("\n");
}

async function main(): Promise<number> {
  const out = new OutputCollector();
  const hashes: string[] = [];
  const failures: Failure[] = [];
  const seen = new Set<string>();
  let firstHash = "";
  let completed = 0;

  let tempDir: string | null = null;
  let passed = false;

  try {
    tempDir = mkdtempSync(join(tmpdir(), "p022-repeat-"));

    for (let i = 1; i <= RUNS; i++) {
      const runNum = i;
      const outPath = join(tempDir, "run-" + pad3(runNum) + ".json");

      const res = await runChild([
        join("scripts", "s0-gate.ts"),
        "--single-analysis",
        "--out",
        outPath,
      ]);

      const fail = (reason: string): number => {
        const cleanReason = sanitize(reason);
        failures.push({ run: runNum, reason: cleanReason });
        out.print(`REPEAT_HASH FAILED run=${runNum} reason=${cleanReason}`);
        const evidence: Evidence = {
          schema: "locatorstress.s0-repeat-hash/v1",
          seed: SEED,
          runs: RUNS,
          completed,
          uniqueGateHashes: seen.size,
          gate_sha256: seen.size === 1 && firstHash !== "" ? firstHash : "",
          hashes,
          passed: false,
          failures,
        };
        writeEvidence(evidence);
        writeLog(out.lines);
        return 1;
      };

      if (res.timedOut) {
        return fail("timeout");
      }
      if (res.code !== 0) {
        return fail("exit code " + String(res.code));
      }

      let parsed: RunOutJson;
      if (!existsSync(outPath)) {
        return fail("out json missing");
      }
      try {
        const raw = readFileSync(outPath, "utf8");
        parsed = JSON.parse(raw) as RunOutJson;
      } catch {
        return fail("out json unparseable");
      }

      if (parsed.passed !== true) {
        return fail("json passed !== true");
      }
      const gate = parsed.gate_sha256;
      if (typeof gate !== "string" || !HEX64.test(gate)) {
        return fail("invalid gate_sha256");
      }
      if (parsed.externalRequests !== 0) {
        return fail("externalRequests !== 0");
      }

      const line = lastLineStartingWith(res.stdout, "SINGLE_ANALYSIS ");
      if (line === null) {
        return fail("missing SINGLE_ANALYSIS line");
      }
      const lineHash = parseKey(line, "gate_sha256");
      if (lineHash === null) {
        return fail("missing gate_sha256 in stdout");
      }
      if (lineHash !== gate) {
        return fail("stdout gate_sha256 mismatch");
      }

      hashes.push(gate);
      seen.add(gate);
      if (firstHash === "") firstHash = gate;
      completed = runNum;

      if (completed % 10 === 0) {
        out.print(
          `REPEAT_HASH progress runs=${completed}/100 unique_gate_hashes=${seen.size} gate_sha256=${firstHash}`,
        );
      }
    }

    const uniqueGateHashes = seen.size;
    passed = completed === RUNS && uniqueGateHashes === 1;

    const evidence: Evidence = {
      schema: "locatorstress.s0-repeat-hash/v1",
      seed: SEED,
      runs: RUNS,
      completed,
      uniqueGateHashes,
      gate_sha256: passed ? firstHash : "",
      hashes,
      passed,
      failures,
    };
    writeEvidence(evidence);
    writeLog(out.lines);

    if (passed) {
      out.print(`REPEAT_HASH unique_gate_hashes=1 gate_sha256=${firstHash}`);
      writeLog(out.lines);
      return 0;
    }
    out.print(
      `REPEAT_HASH FAILED reason=unique_gate_hashes_${uniqueGateHashes}_completed_${completed}`,
    );
    writeLog(out.lines);
    return 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    failures.push({ run: completed + 1, reason: sanitize(msg) });
    out.print(`REPEAT_HASH FAILED run=${completed + 1} reason=${sanitize(msg)}`);
    const evidence: Evidence = {
      schema: "locatorstress.s0-repeat-hash/v1",
      seed: SEED,
      runs: RUNS,
      completed,
      uniqueGateHashes: seen.size,
      gate_sha256: "",
      hashes,
      passed: false,
      failures,
    };
    try {
      writeEvidence(evidence);
      writeLog(out.lines);
    } catch {
      // ignore write errors in error path
    }
    return 1;
  } finally {
    if (tempDir !== null) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

function isMain(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  return argv1.replace(/\\/g, "/").endsWith("repeat-hash.ts");
}

if (isMain()) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(usage() + "\n");
    process.exit(0);
  }
  if (args.length !== 0) {
    process.stderr.write("repeat-hash: unexpected arguments\n" + usage() + "\n");
    process.exit(2);
  }
  main().then(
    (code) => {
      process.exit(code);
    },
    () => {
      process.exit(1);
    },
  );
}
