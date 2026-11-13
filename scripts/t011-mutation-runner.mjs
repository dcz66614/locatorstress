// T011 — Hand-rolled mutation testing for the frozen pure modules.
//
// Why hand-rolled: no mutation framework is installed (no Stryker in
// node_modules) and `npm install` is currently blocked by the VM-wide
// exec-write EPERM fault, so a dependency-based runner cannot be
// installed in this session. This script is a real mutation runner,
// not a simulation: for each mutant it (1) rewrites one production
// source file, (2) runs the real vitest suite for that module, and
// (3) restores the file byte-for-byte (SHA-256 verified).
//
// SAFETY DESIGN (v2): mutants are applied ONLY inside a scratch copy
// of the project (~/t011-mutation-work/), NEVER to the real tree.
// The v1 design mutated production files in place; the VM's storage
// fault truncated src/verdict/classify.ts to 0 bytes twice (once when
// a plain write silently wrote 0 bytes, once when the service
// restarted mid-run), and the file had to be restored from git both
// times. Production files are now only READ: the runner verifies the
// real src/ tree against a pre-run SHA-256 manifest before and after,
// and exits 2 if it differs. The scratch tree is disposable.
//
// Mutation score threshold: >= 90% killed, after excluding mutants
// proven equivalent (EQUIVALENT list below, currently empty).
// Justification for 90% (not 100%): these are hand-written,
// single-edit semantic mutants on frozen pure functions; each one
// changes exactly one decision the spec pins down, so the suite
// should catch nearly all of them. 100% would be the ideal, and any
// survivor below the threshold is a FAIL that must be dispositioned
// (add a killing test, or prove the mutant equivalent and record it
// with its proof). A survivor is never silently dropped.
//
// Usage: node scripts/t011-mutation-runner.mjs [--mutant <id>]
// Exit: 0 iff score >= threshold AND inconclusive == 0 AND no config
// errors; 1 for a below-threshold score or inconclusive mutants;
// 2 for a config error (stale anchor), a scratch-setup failure, or a
// real-tree mismatch.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRATCH_ROOT = join(process.env.HOME ?? "/tmp", "t011-mutation-work");
const EVIDENCE_PATH = join(PROJECT_ROOT, "evidence", "s4", "T011_MUTATION_RESULTS.json");
const MUTATION_SCORE_THRESHOLD = 0.9;
const PER_MUTANT_TIMEOUT_MS = 180000;
const MAX_WRITE_ATTEMPTS = 8;

// Mutants proven equivalent to the original (with proof). Empty: every
// mutant below is expected to be killed. Add an entry here ONLY with a
// proof that the replacement is behaviourally identical on all inputs.
const EQUIVALENT = [];

const TESTS = {
  classify: [
    "tests/verdict/classify.test.ts",
    "tests/verdict/classify-boundaries.test.ts",
    "tests/property/property.test.ts",
  ],
  score: [
    "tests/score/stability-score.test.ts",
    "tests/score/format-percent-boundaries.test.ts",
    "tests/score/controls.test.ts",
    "tests/property/property.test.ts",
  ],
  canonical: [
    "tests/canonical/canonical-json.test.ts",
    "tests/canonical/canonical-boundaries.test.ts",
    "tests/canonical/hash-contract.test.ts",
  ],
  stateKey: ["tests/search/bfs.test.ts", "tests/search/state-key-boundaries.test.ts"],
  bfs: [
    "tests/search/bfs.test.ts",
    "tests/search/bfs-determinism.test.ts",
    "tests/analysis/witness.test.ts",
    "tests/analysis/witness-boundaries.test.ts",
  ],
  htmlEscape: ["tests/export/html-escape.test.ts"],
  forbiddenScan: ["tests/canonical/forbidden-scan.test.ts"],
  routes: ["tests/api/routes.test.ts", "tests/api/routes-boundaries.test.ts"],
  locator: ["tests/contracts/locator-spec.test.ts"],
  witness: ["tests/analysis/witness.test.ts", "tests/analysis/witness-boundaries.test.ts"],
};

// Each mutant changes exactly ONE decision in one production file.
// `anchor` must occur exactly once in the file (verified before use);
// `replacement` is the mutated text. `killedBy` names the test that
// is expected to catch it (documentation; the runner checks the real
// vitest result, not the name).
const MUTANTS = [
  // --- verdict/classify.ts -------------------------------------------
  {
    id: "M-CL-01", file: "src/verdict/classify.ts", group: "classify",
    name: "invert execution-status gate (ERROR/TIMEOUT now classified)",
    anchor: 'if (executionStatus !== "COMPLETED") {',
    replacement: 'if (executionStatus === "COMPLETED") {',
    killedBy: "classify: ERROR/TIMEOUT rows must yield no verdict",
  },
  {
    id: "M-CL-02", file: "src/verdict/classify.ts", group: "classify",
    name: "MISSING triggers at final==1 instead of final==0",
    anchor: "if (result.finalMatchCount === 0) {",
    replacement: "if (result.finalMatchCount === 1) {",
    killedBy: "classify: MISSING positive (0 matches) and STABLE (1 match)",
  },
  {
    id: "M-CL-03", file: "src/verdict/classify.ts", group: "classify",
    name: "AMBIGUOUS threshold 1 -> 2 (2 matches no longer ambiguous)",
    anchor: "if (result.finalMatchCount > 1) {",
    replacement: "if (result.finalMatchCount > 2) {",
    killedBy: "classify: AMBIGUOUS positive (2 matches)",
  },
  {
    id: "M-CL-04", file: "src/verdict/classify.ts", group: "classify",
    name: "swap STABLE/WRONG_TARGET (identity true treated as false)",
    anchor: "if (identityMatch === true) {",
    replacement: "if (identityMatch === false) {",
    killedBy: "classify: STABLE positive and WRONG_TARGET positive",
  },
  {
    id: "M-CL-05", file: "src/verdict/classify.ts", group: "classify",
    name: "count sanity final>=raw instead of final>raw (final==raw now invalid)",
    anchor: "result.finalMatchCount > result.rawMatchCount",
    replacement: "result.finalMatchCount >= result.rawMatchCount",
    killedBy: "classify: every valid 1/1 and 2/2 row",
  },
  {
    id: "M-CL-06", file: "src/verdict/classify.ts", group: "classify",
    name: "drop the >= 0 check (negative counts accepted)",
    anchor: "return Number.isInteger(value) && value >= 0;",
    replacement: "return Number.isInteger(value);",
    killedBy: "classify: negative-count rows must yield no verdict",
  },
  {
    id: "M-CL-07", file: "src/verdict/classify.ts", group: "classify",
    name: "frame-kind swap (FRAME_MISSING read as AMBIGUOUS branch)",
    anchor: 'if (result.frameFailure.kind === "FRAME_AMBIGUOUS") {',
    replacement: 'if (result.frameFailure.kind === "FRAME_MISSING") {',
    killedBy: "classify: frame AMBIGUOUS/MISSING positives",
  },
  // --- score/stability-score.ts --------------------------------------
  {
    id: "M-SC-01", file: "src/score/stability-score.ts", group: "score",
    name: "rounding half-up -> truncation (200000n -> 100000n)",
    anchor: "(200000n * BigInt(numerator) + BigInt(denominator))",
    replacement: "(100000n * BigInt(numerator) + BigInt(denominator))",
    killedBy: "formatPercent: exact-half rows (0.0005 -> 0.001)",
  },
  {
    id: "M-SC-02", file: "src/score/stability-score.ts", group: "score",
    name: "score denominator completed -> expected (incomplete cases dilute the score)",
    anchor: "row.scoreDenominator = row.completed;",
    replacement: "row.scoreDenominator = row.expected;",
    killedBy: "score: 1 stable + 1 incomplete must score 100, coverage 50",
  },
  {
    id: "M-SC-03", file: "src/score/stability-score.ts", group: "score",
    name: "invert incomplete handling (complete cases skipped, incomplete counted)",
    anchor: "if (c.verdict === null) {\n    // Incomplete: never counted as STABLE, never enters the score",
    replacement: "if (c.verdict !== null) {\n    // Incomplete: never counted as STABLE, never enters the score",
    killedBy: "score: incomplete cases never count as STABLE",
  },
  {
    id: "M-SC-04", file: "src/score/stability-score.ts", group: "score",
    name: "swap score operands (completed/stable instead of stable/completed)",
    anchor: "row.score = formatPercent(row.stable, row.completed);",
    replacement: "row.score = formatPercent(row.completed, row.stable);",
    killedBy: "score: 1/4 must be 25, not 400",
  },
  {
    id: "M-SC-05", file: "src/score/stability-score.ts", group: "score",
    name: "mismatched = pairs - completed instead of pairs - matched",
    anchor: "out.mismatched = out.pairs - out.matched;",
    replacement: "out.mismatched = out.pairs - out.completed;",
    killedBy: "controls: incomplete cases count as mismatches",
  },
  {
    id: "M-SC-06", file: "src/score/stability-score.ts", group: "score",
    name: "invert row analysisStatus (COMPLETE <-> INCOMPLETE)",
    anchor: 'row.analysisStatus = row.incomplete === 0 ? "COMPLETE" : "INCOMPLETE";',
    replacement: 'row.analysisStatus = row.incomplete === 0 ? "INCOMPLETE" : "COMPLETE";',
    killedBy: "score: empty input row must be COMPLETE",
  },
  // --- canonical/canonical-json.ts ------------------------------------
  {
    id: "M-CJ-01", file: "src/canonical/canonical-json.ts", group: "canonical",
    name: "key sort by code point -> JS default UTF-16 sort",
    anchor: "const keys = Object.keys(obj).sort(compareCodePoints);",
    replacement: "const keys = Object.keys(obj).sort();",
    killedBy: "canonical: astral-plane keys sort after the whole BMP",
  },
  {
    id: "M-CJ-02", file: "src/canonical/canonical-json.ts", group: "canonical",
    name: "string normalisation NFC -> NFD",
    anchor: 'if (typeof value === "string") return value.normalize("NFC");',
    replacement: 'if (typeof value === "string") return value.normalize("NFD");',
    killedBy: "canonical: e + combining acute becomes precomposed é",
  },
  {
    id: "M-CJ-03", file: "src/canonical/canonical-json.ts", group: "canonical",
    name: "non-finite numbers silently pass through instead of throwing",
    anchor: 'if (!Number.isFinite(value)) {\n      throw new Error("non-finite number in canonical JSON");\n    }',
    replacement: 'if (!Number.isFinite(value)) {\n      return value;\n    }',
    killedBy: "canonical: rejects non-finite numbers",
  },
  {
    id: "M-CJ-04", file: "src/canonical/canonical-json.ts", group: "canonical",
    name: "arrays reversed (order no longer preserved)",
    anchor: "if (Array.isArray(value)) return value.map((v) => canonicalize(v));",
    replacement: "if (Array.isArray(value)) return value.map((v) => canonicalize(v)).reverse();",
    killedBy: "canonical: preserves array order",
  },
  {
    id: "M-CJ-05", file: "src/canonical/canonical-json.ts", group: "canonical",
    name: "SHA-256 -> SHA-1 (hash length 64 -> 40)",
    anchor: 'return createHash("sha256").update(text, "utf8").digest("hex");',
    replacement: 'return createHash("sha1").update(text, "utf8").digest("hex");',
    killedBy: "canonical: sha256Hex matches the known vector",
  },
  {
    id: "M-CJ-06", file: "src/canonical/canonical-json.ts", group: "canonical",
    name: "invert code-point comparison (descending order)",
    anchor: "if (ca !== cb) return ca < cb ? -1 : 1;",
    replacement: "if (ca !== cb) return ca < cb ? 1 : -1;",
    killedBy: "canonical: sorts ASCII by code point",
  },
  // --- search/state-key.ts --------------------------------------------
  {
    id: "M-SK-01", file: "src/search/state-key.ts", group: "stateKey",
    name: "plan key sorts the sequence (order-insensitive plan hash)",
    anchor: "plan: [...sequence],",
    replacement: "plan: [...sequence].sort(),",
    killedBy: "state-key: planStateKey is order-sensitive",
  },
  {
    id: "M-SK-02", file: "src/search/state-key.ts", group: "stateKey",
    name: "failure predicate: STABLE counts as failure, MISSING does not",
    anchor: 'return verdict !== null && verdict !== "STABLE";',
    replacement: 'return verdict !== null && verdict !== "MISSING";',
    killedBy: "bfs: depth-1 witness + BOUNDED_NO_WITNESS cases",
  },
  {
    id: "M-SK-03", file: "src/search/state-key.ts", group: "stateKey",
    name: "compareSequences prefix rule inverted (longer sorts first)",
    anchor: "return a.length - b.length;",
    replacement: "return b.length - a.length;",
    killedBy: "state-key: a prefix is smaller than the longer sequence",
  },
  // --- search/bfs.ts ---------------------------------------------------
  {
    id: "M-BF-01", file: "src/search/bfs.ts", group: "bfs",
    name: "depth limit off by one (expand one level too deep)",
    anchor: "if (depth >= maxDepth) {",
    replacement: "if (depth > maxDepth) {",
    killedBy: "bfs: BOUNDED_NO_WITNESS when the failure is deeper than maxDepth",
  },
  {
    id: "M-BF-02", file: "src/search/bfs.ts", group: "bfs",
    name: "expansion budget off by one (one extra expansion allowed)",
    anchor: "if (statesExpanded >= maxExpandedStates) {",
    replacement: "if (statesExpanded > maxExpandedStates) {",
    killedBy: "bfs: BOUNDED_INCOMPLETE when the state budget runs out",
  },
  {
    id: "M-BF-03", file: "src/search/bfs.ts", group: "bfs",
    name: "allowRepeat ignored (repeats always forbidden)",
    anchor: "if (!allowRepeat && sequence.includes(op)) {",
    replacement: "if (sequence.includes(op)) {",
    killedBy: "bfs: allowRepeat explores repeated operators",
  },
  {
    id: "M-BF-04", file: "src/search/bfs.ts", group: "bfs",
    name: "FIFO queue -> LIFO stack (DFS instead of BFS)",
    anchor: "const sequence = queue.shift() as MutationId[];",
    replacement: "const sequence = queue.pop() as MutationId[];",
    killedBy: "bfs: returns the shortest witness, not the first failing sequence",
  },
  {
    id: "M-BF-05", file: "src/search/bfs.ts", group: "bfs",
    name: "dedup disabled (duplicate states re-expanded)",
    anchor: "const duplicate = visited.has(evaluation.stateKey);",
    replacement: "const duplicate = false;",
    killedBy: "bfs: prunes a duplicate state and never expands it",
  },
  {
    id: "M-BF-06", file: "src/search/bfs.ts", group: "bfs",
    name: "INCOMPLETE nodes expanded (untrusted DOM state trusted)",
    anchor: "if (evaluation.verdict === null) {",
    replacement: "if (false) {",
    killedBy: "bfs: skips an incomplete node and does not expand it",
  },
  // --- export/html-escape.ts -------------------------------------------
  {
    id: "M-HE-01", file: "src/export/html-escape.ts", group: "htmlEscape",
    name: "single quote no longer escaped",
    anchor: `"'": "&#39;",`,
    replacement: `"'": "'",`,
    killedBy: "html-escape: escapes each character in isolation",
  },
  {
    id: "M-HE-02", file: "src/export/html-escape.ts", group: "htmlEscape",
    name: "< no longer escaped in the JSON script block (</script> breakout)",
    anchor: '.replace(/</g, "\\\\u003c")',
    replacement: '.replace(/</g, "<")',
    killedBy: "html-escape: rewrites </script> so the block cannot be terminated",
  },
  {
    id: "M-HE-03", file: "src/export/html-escape.ts", group: "htmlEscape",
    name: "<img> removed from the forbidden-tag set",
    anchor: '  "link",\n  "img",\n  "iframe",',
    replacement: '  "link",\n  "iframe",',
    killedBy: "html-escape: flags each forbidden resource tag",
  },
  // --- canonical/forbidden-scan.ts --------------------------------------
  {
    id: "M-FS-01", file: "src/canonical/forbidden-scan.ts", group: "forbiddenScan",
    name: "createdAt rule narrowed to created_at only",
    anchor: "/createdAt|created_at/,",
    replacement: "/created_at/,",
    killedBy: "forbidden-scan: createdAt literal is flagged",
  },
  {
    id: "M-FS-02", file: "src/canonical/forbidden-scan.ts", group: "forbiddenScan",
    name: "epoch rule widened to 14 digits (13-digit epochs missed)",
    anchor: String.raw`/\b1[67]\d{11}\b/,`,
    replacement: String.raw`/\b1[67]\d{12}\b/,`,
    killedBy: "forbidden-scan: 13-digit millisecond epoch is flagged",
  },
  // --- api/routes.ts -----------------------------------------------------
  {
    id: "M-RT-01", file: "src/api/routes.ts", group: "routes",
    name: "known/unknown path check inverted (known paths 404)",
    anchor: "if (!KNOWN_PATHS.has(path)) {",
    replacement: "if (KNOWN_PATHS.has(path)) {",
    killedBy: "routes: GET /api/health returns ok",
  },
  {
    id: "M-RT-02", file: "src/api/routes.ts", group: "routes",
    name: "P2-2 rejection removed (test-only BFS options reach the search)",
    anchor: 'if ("operatorOrder" in body || "allowRepeat" in body) {',
    replacement: "if (false) {",
    killedBy: "routes: search rejects operatorOrder and allowRepeat",
  },
  {
    id: "M-RT-03", file: "src/api/routes.ts", group: "routes",
    name: "HTML export regresses to 501 (FIX-R1-02 undone)",
    anchor: "const html = exportReportHtml(body[\"report\"]);\n        return {\n          status: 200,",
    replacement: "const html = exportReportHtml(body[\"report\"]);\n        return {\n          status: 501,",
    killedBy: "routes: FIX-R1-02 HTML export must be 200 text/html, not 501",
  },
  // --- contracts/locator.ts ----------------------------------------------
  {
    id: "M-LC-01", file: "src/contracts/locator.ts", group: "locator",
    name: "framePath cap 2 -> 3 (3-layer paths accepted)",
    anchor: "if (framePath.length > 2) {",
    replacement: "if (framePath.length > 3) {",
    killedBy: "locator-spec: rejects a 3-layer framePath",
  },
  {
    id: "M-LC-02", file: "src/contracts/locator.ts", group: "locator",
    name: "index must be > 0 (index 0 rejected)",
    anchor: "return typeof value === \"number\" && Number.isInteger(value) && value >= 0;",
    replacement: "return typeof value === \"number\" && Number.isInteger(value) && value > 0;",
    killedBy: "locator-spec: accepts index 0",
  },
  // --- analysis/witness.ts ------------------------------------------------
  {
    id: "M-WN-01", file: "src/analysis/witness.ts", group: "witness",
    name: "BOUNDED_NO_WITNESS meaning swapped with BOUNDED_INCOMPLETE",
    anchor: 'if (status === "BOUNDED_NO_WITNESS") {',
    replacement: 'if (status === "BOUNDED_INCOMPLETE") {',
    killedBy: "witness: BOUNDED_NO_WITNESS disclaims safety",
  },
  {
    id: "M-WN-02", file: "src/analysis/witness.ts", group: "witness",
    name: "FOUND-with-null-witness invariant check removed",
    anchor: 'if (result.status === "FOUND" && result.witness === null) {',
    replacement: "if (false) {",
    killedBy: "witness: throws on contradictory BFS results",
  },
];

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function listFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) listFiles(p, out);
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

// Verified write: the VM's storage fault intermittently makes
// writeFileSync succeed while writing 0 bytes (or throw EPERM), so
// every write is checked by byte length AND SHA-256 of the content
// read back, and retried. Used for scratch files AND evidence.
function writeFileVerified(path, text) {
  const expectedSize = Buffer.byteLength(text, "utf8");
  const expectedSha = sha256(text);
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
    try {
      writeFileSync(path, text, "utf-8");
      const back = readFileSync(path, "utf8");
      if (statSync(path).size === expectedSize && sha256(back) === expectedSha) return;
      lastError = new Error(`content mismatch after write (attempt ${attempt})`);
    } catch (err) {
      lastError = err;
    }
    sleepSync(5000);
  }
  throw new Error(
    `cannot write ${path} after ${MAX_WRITE_ATTEMPTS} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

function copyFileVerified(src, dest) {
  const text = readFileSync(src, "utf8");
  writeFileVerified(dest, text);
  const destSha = sha256(readFileSync(dest, "utf8"));
  if (destSha !== sha256(text)) {
    throw new Error(`copy verification failed: ${src} -> ${dest}`);
  }
}

function copyTreeVerified(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const src = join(srcDir, entry.name);
    const dest = join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyTreeVerified(src, dest);
    } else if (entry.isFile()) {
      copyFileVerified(src, dest);
    }
  }
}

function setupScratch() {
  if (existsSync(SCRATCH_ROOT)) {
    rmSync(SCRATCH_ROOT, { recursive: true, force: true });
  }
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  copyTreeVerified(join(PROJECT_ROOT, "src"), join(SCRATCH_ROOT, "src"));
  copyTreeVerified(join(PROJECT_ROOT, "tests"), join(SCRATCH_ROOT, "tests"));
  for (const f of ["package.json", "tsconfig.json", "tsconfig.scripts.json"]) {
    copyFileVerified(join(PROJECT_ROOT, f), join(SCRATCH_ROOT, f));
  }
  if (existsSync(join(PROJECT_ROOT, "vitest.config.ts"))) {
    copyFileVerified(join(PROJECT_ROOT, "vitest.config.ts"), join(SCRATCH_ROOT, "vitest.config.ts"));
  }
  // node_modules is a symlink: vitest resolves its own binary and the
  // test imports through it; nothing is ever written into it by the run
  // except vitest's cache, which tolerates write failures.
  symlinkSync(join(PROJECT_ROOT, "node_modules"), join(SCRATCH_ROOT, "node_modules"), "dir");
  // Verify the scratch tree matches the real tree file for file.
  const realFiles = listFiles(join(PROJECT_ROOT, "src"))
    .concat(listFiles(join(PROJECT_ROOT, "tests")))
    .sort();
  for (const f of realFiles) {
    const rel = relative(PROJECT_ROOT, f);
    const scratchFile = join(SCRATCH_ROOT, rel);
    if (!existsSync(scratchFile)) throw new Error(`scratch setup missing ${rel}`);
    if (sha256(readFileSync(scratchFile, "utf8")) !== sha256(readFileSync(f, "utf8"))) {
      throw new Error(`scratch setup mismatch for ${rel}`);
    }
  }
}

function runVitest(testFiles) {
  const vitestEntry = join(SCRATCH_ROOT, "node_modules", "vitest", "vitest.mjs");
  const started = Date.now();
  const res = spawnSync(
    process.execPath,
    [vitestEntry, "run", ...testFiles, "--no-file-parallelism"],
    { cwd: SCRATCH_ROOT, timeout: PER_MUTANT_TIMEOUT_MS, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const durationMs = Date.now() - started;
  const rawOutput = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
  // Vitest emits ANSI colour codes even on a pipe, so the "Tests N
  // failed | M passed" summary cannot be matched literally: strip
  // the escapes first, otherwise every killed mutant looks
  // INCONCLUSIVE (exit 1 with failed=0).
  const output = rawOutput.replace(/\[[0-9;]*m/g, "");
  const failedMatch = output.match(/Tests\s+(\d+) failed/);
  const failedCount = failedMatch ? Number(failedMatch[1]) : 0;
  const passedMatch = output.match(/Tests\s+(\d+) passed/);
  const passedCount = passedMatch ? Number(passedMatch[1]) : 0;
  return {
    exitCode: res.status,
    signal: res.signal,
    timedOut: res.error?.code === "ETIMEDOUT",
    failedCount,
    passedCount,
    outputTail: output.slice(-1200),
  };
}

function main() {
  const onlyId = process.argv.includes("--mutant")
    ? process.argv[process.argv.indexOf("--mutant") + 1]
    : null;
  const mutants = onlyId ? MUTANTS.filter((m) => m.id === onlyId) : MUTANTS;
  if (onlyId && mutants.length === 0) {
    console.error(`unknown mutant id: ${onlyId}`);
    process.exit(2);
  }

  // Pre-run manifest of the REAL src/ tree (read-only check).
  const realSrcFiles = listFiles(join(PROJECT_ROOT, "src")).sort();
  const preManifest = new Map(
    realSrcFiles.map((f) => [relative(PROJECT_ROOT, f), sha256(readFileSync(f, "utf8"))]),
  );

  console.log(`setting up scratch tree at ${SCRATCH_ROOT} ...`);
  setupScratch();
  console.log("scratch tree verified against the real tree.");

  const results = [];
  let configErrors = 0;

  for (const mutant of mutants) {
    const realPath = join(PROJECT_ROOT, mutant.file);
    const scratchPath = join(SCRATCH_ROOT, mutant.file);
    const original = readFileSync(realPath, "utf8");
    const occurrences = original.split(mutant.anchor).length - 1;
    if (occurrences !== 1) {
      console.error(`CONFIG ERROR ${mutant.id}: anchor occurs ${occurrences}x in ${mutant.file} (expected exactly 1)`);
      results.push({ ...mutant, status: "CONFIG_ERROR", killed: false, exitCode: null });
      configErrors += 1;
      continue;
    }
    const mutated = original.replace(mutant.anchor, mutant.replacement);
    if (mutated === original) {
      console.error(`CONFIG ERROR ${mutant.id}: replacement equals original in ${mutant.file}`);
      results.push({ ...mutant, status: "CONFIG_ERROR", killed: false, exitCode: null });
      configErrors += 1;
      continue;
    }

    const started = Date.now();
    let run = null;
    let status = "SURVIVED";
    try {
      // Mutate ONLY the scratch copy; the real file is never written.
      writeFileVerified(scratchPath, mutated);
      run = runVitest(TESTS[mutant.group]);
      if (run.timedOut) {
        status = "TIMEOUT";
      } else if (run.exitCode !== 0 && run.failedCount > 0) {
        status = "KILLED";
      } else if (run.exitCode !== 0) {
        // Non-zero exit but no failed test counted: infrastructure
        // fault (e.g. EPERM), not a kill. Re-run once to confirm.
        const retry = runVitest(TESTS[mutant.group]);
        if (retry.exitCode !== 0 && retry.failedCount > 0) {
          run = retry;
          status = "KILLED";
        } else if (retry.exitCode === 0) {
          run = retry;
          status = "SURVIVED";
        } else {
          run = retry;
          status = "INCONCLUSIVE";
        }
      } else {
        status = "SURVIVED";
      }
    } catch (err) {
      status = "ERROR";
      run = { exitCode: null, failedCount: 0, passedCount: 0, outputTail: String(err), timedOut: false };
    } finally {
      // Restore the scratch copy from the pristine real file.
      writeFileVerified(scratchPath, original);
    }
    const durationMs = Date.now() - started;
    console.log(`${status} ${mutant.id} (${mutant.name}) exit=${run?.exitCode} failed=${run?.failedCount} ${durationMs}ms`);
    results.push({
      id: mutant.id,
      file: mutant.file,
      group: mutant.group,
      name: mutant.name,
      killedBy: mutant.killedBy,
      status,
      killed: status === "KILLED",
      exitCode: run?.exitCode ?? null,
      failedTests: run?.failedCount ?? 0,
      passedTests: run?.passedCount ?? 0,
      outputTail: status === "SURVIVED" || status === "INCONCLUSIVE" || status === "ERROR" ? (run?.outputTail ?? "") : undefined,
    });
  }

  // The real tree must be byte-identical to before the run.
  let treeOk = true;
  for (const [rel, hash] of preManifest) {
    const now = sha256(readFileSync(join(PROJECT_ROOT, rel), "utf8"));
    if (now !== hash) {
      console.error(`REAL TREE MISMATCH after mutation run: ${rel} changed (the runner never writes it — investigate)`);
      treeOk = false;
    }
  }
  if (!treeOk) process.exit(2);

  const total = results.length;
  const killed = results.filter((r) => r.status === "KILLED").length;
  const survived = results.filter((r) => r.status === "SURVIVED").map((r) => r.id);
  const inconclusive = results.filter((r) => ["INCONCLUSIVE", "TIMEOUT", "ERROR"].includes(r.status)).map((r) => r.id);
  const equivalentCount = EQUIVALENT.length;
  const score = total - equivalentCount === 0 ? 1 : killed / (total - equivalentCount);

  const payload = {
    schema: "locatorstress.t011-mutation-results/v1",
    threshold: MUTATION_SCORE_THRESHOLD,
    thresholdRationale:
      "Hand-written single-edit semantic mutants on frozen pure functions; each changes one spec-pinned decision, so the suite should catch >= 90%. Any non-equivalent survivor is a test gap (FAIL).",
    totals: { total, killed, survived: survived.length, inconclusive: inconclusive.length, equivalent: equivalentCount, configErrors },
    mutationScore: score,
    passed: score >= MUTATION_SCORE_THRESHOLD && inconclusive.length === 0 && configErrors === 0 && treeOk,
    survived,
    inconclusive,
    equivalent: EQUIVALENT,
    results,
  };

  const payloadText = JSON.stringify(payload, null, 2) + "\n";
  mkdirSync(join(PROJECT_ROOT, "evidence", "s4"), { recursive: true });
  let evidenceWritten = false;
  try {
    writeFileVerified(EVIDENCE_PATH, payloadText);
    evidenceWritten = true;
  } catch (err) {
    console.error(`evidence write to ${EVIDENCE_PATH} failed (EPERM fault): ${err.message}`);
    // Fall back to the scratch copy so the results are not lost; the
    // coordinator can copy it into evidence/s4/ when the fault clears.
    try {
      writeFileVerified(join(SCRATCH_ROOT, "T011_MUTATION_RESULTS.json"), payloadText);
      console.error(`results preserved at ${join(SCRATCH_ROOT, "T011_MUTATION_RESULTS.json")}`);
    } catch (err2) {
      console.error(`scratch evidence write also failed: ${err2.message}`);
    }
  }

  console.log(`\nMutation score: ${killed}/${total - equivalentCount} = ${(score * 100).toFixed(1)}% (threshold ${(MUTATION_SCORE_THRESHOLD * 100).toFixed(0)}%)`);
  console.log(`Killed: ${killed}, Survived: ${survived.length} [${survived.join(", ")}], Inconclusive: ${inconclusive.length} [${inconclusive.join(", ")}], Config errors: ${configErrors}`);
  console.log(`Evidence written to ${EVIDENCE_PATH}: ${evidenceWritten}`);
  process.exit(payload.passed && evidenceWritten ? 0 : 1);
}

main();
