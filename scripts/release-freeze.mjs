// FIX-R1-04 — re-freeze the release package from the new frozen commit.
//
// Generates, from the pinned frozen commit only:
//   release/source.zip            (git archive of the frozen commit)
//   release/dist.zip              (fresh `npm run build` dist/ + the
//                                  five release docs, deterministic zip)
//   release/RELEASE_MANIFEST.json (commit, version, sizes, SHAs, the
//                                  dist file list, the four S0 hashes)
//   release/SHA256SUMS.txt       (source.zip, dist.zip,
//                                  RELEASE_MANIFEST.json — never itself,
//                                  never the freeze report)
//   release/R2_FREEZE_REPORT.md (freeze record; the acceptance
//                                  section is PENDING at freeze time and
//                                  is filled in by the FIX-R2-03 agent after
//                                  running release:verify,
//                                  release:compare-source and
//                                  release:verify-hashes — a later
//                                  re-run of release:freeze regenerates
//                                  only the freeze-time sections)
//
// FROZEN_COMMIT is a hard-coded constant, never HEAD and never the
// current tip: re-running release:freeze after the R1 freeze commit must
// regenerate byte-identical artifacts from the same frozen commit
// (P021 lesson — a freeze that follows HEAD silently re-archives the
// new tip). source.zip comes straight from `git archive` of that
// commit; its output is deterministic for a given commit. dist.zip
// uses scripts/release-zip.mjs (STORE entries, fixed 1980-01-01
// timestamps, sorted paths), so it is deterministic too.
//
// Safety: writes are checked (a 0-byte file is deleted and rewritten
// once, then fails loudly — never leave a 0-byte artifact behind);
// the S0 gate evidence SHA and the five release docs are verified
// against the frozen commit before anything is packaged; no source,
// fixture, golden, test or evidence file is touched.
//
// Usage: npm run release:freeze
// Exit:  0 iff all artifacts are written and self-checked; otherwise
// the failing step's code (non-zero).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readZip, writeZip } from "./release-zip.mjs";

const ROOT = resolve(join(fileURLToPath(import.meta.url), "..", ".."));
const RELEASE_DIR = join(ROOT, "release");

// The frozen commit (full SHA of a834eea). Hard-coded on purpose:
// never derive it from HEAD or the branch tip.
const FROZEN_COMMIT = "a834eeae36f816c2f273677636127facb6902dbf";
const SPEC_VERSION = "1.0.0";
// Frozen evidence/s0/S0_GATE.json SHA-256 (verified by the coordinator
// after the T013 + FIX rounds; release:verify re-checks it).
const EXPECTED_S0_GATE_SHA256 =
  "15b5c2d5b4f995ffa40979101b94c21f4565617152dfc8f9ebf9b0e53cd3572d";
// The five release docs, already in the frozen commit (FIX-06).
const RELEASE_DOCS = [
  "README.md",
  "USER_GUIDE.md",
  "HOW_TO_REPRODUCE.md",
  "THIRD_PARTY_NOTICES.md",
  "LICENSE_STATUS.md",
];

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { cwd: ROOT, ...opts });
  if (result.error !== undefined) {
    throw new Error(`${cmd} ${args.join(" ")} failed to start: ${result.error.message}`);
  }
  return result;
}

// Write a file, then verify it landed non-empty; on a 0-byte write
// (storage jitter) delete it and write once more, then fail loudly
// rather than leaving a 0-byte artifact behind.
function writeChecked(path, data) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    writeFileSync(path, data);
    const size = statSync(path).size;
    if (size > 0) return size;
    rmSync(path, { force: true });
    if (attempt === 2) {
      throw new Error(`write failed: ${path} is 0 bytes after two attempts`);
    }
    console.error(`warning: ${path} wrote 0 bytes, retrying once`);
  }
  throw new Error(`unreachable write path for ${path}`);
}

function listFilesRecursive(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}

// --- Step 0: frozen commit must exist; evidence + docs must match it --
console.log(`[0/6] frozen commit: ${FROZEN_COMMIT}`);
const catFile = run("git", ["cat-file", "-t", FROZEN_COMMIT]);
if (catFile.status !== 0 || catFile.stdout.toString().trim() !== "commit") {
  console.error(`release:freeze FAILED: ${FROZEN_COMMIT} is not a commit in this repo`);
  process.exit(1);
}

const s0GatePath = join(ROOT, "evidence", "s0", "S0_GATE.json");
if (!existsSync(s0GatePath)) {
  console.error("release:freeze FAILED: missing evidence/s0/S0_GATE.json");
  process.exit(1);
}
const s0GateBytes = readFileSync(s0GatePath);
const s0GateSha = sha256(s0GateBytes);
if (s0GateSha !== EXPECTED_S0_GATE_SHA256) {
  console.error(
    `release:freeze FAILED: evidence/s0/S0_GATE.json SHA ${s0GateSha} != frozen ${EXPECTED_S0_GATE_SHA256}`,
  );
  process.exit(1);
}
const s0Gate = JSON.parse(s0GateBytes.toString("utf8"));
const s0Hashes = s0Gate.hashes;
for (const key of ["scenario_sha256", "oracle_result_sha256", "analysis_sha256", "gate_sha256"]) {
  if (typeof s0Hashes?.[key] !== "string" || !/^[0-9a-f]{64}$/.test(s0Hashes[key])) {
    console.error(`release:freeze FAILED: S0_GATE.json has no valid ${key}`);
    process.exit(1);
  }
}
console.log(`      S0_GATE.json SHA matches frozen value ${EXPECTED_S0_GATE_SHA256}`);
console.log(`      gate_sha256 ${s0Hashes.gate_sha256}`);

// The five release docs packaged into dist.zip must be byte-identical
// to the frozen commit's copies — never package uncommitted edits.
for (const doc of RELEASE_DOCS) {
  const disk = readFileSync(join(RELEASE_DIR, doc));
  const frozen = run("git", ["show", `${FROZEN_COMMIT}:release/${doc}`]);
  if (frozen.status !== 0) {
    console.error(`release:freeze FAILED: git show ${FROZEN_COMMIT}:release/${doc} failed`);
    process.exit(1);
  }
  if (!disk.equals(frozen.stdout)) {
    console.error(
      `release:freeze FAILED: release/${doc} on disk differs from ${FROZEN_COMMIT}:release/${doc}`,
    );
    process.exit(1);
  }
}
console.log(`      release docs: ${RELEASE_DOCS.length}/5 match the frozen commit`);

// --- Step 1: fresh build ---------------------------------------------------
console.log("[1/6] npm run build (fresh dist/ for dist.zip)");
const build = spawnSync("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
if ((build.status ?? 1) !== 0) {
  console.error(`release:freeze FAILED: npm run build exited ${build.status ?? 1}`);
  process.exit(build.status ?? 1);
}
const distDir = join(ROOT, "dist");
const distFiles = listFilesRecursive(distDir);
if (distFiles.length === 0) {
  console.error("release:freeze FAILED: dist/ is empty after build");
  process.exit(1);
}
console.log(`      dist/ files: ${distFiles.length}`);

// --- Step 2: source.zip from git archive -----------------------------------
console.log("[2/6] source.zip <- git archive --format=zip <frozen commit>");
const archive = run("git", ["archive", "--format=zip", FROZEN_COMMIT], {
  maxBuffer: 64 * 1024 * 1024,
});
if (archive.status !== 0) {
  console.error(`release:freeze FAILED: git archive exited ${archive.status}`);
  process.exit(archive.status ?? 1);
}
const sourceZipPath = join(RELEASE_DIR, "source.zip");
const sourceZipBytes = writeChecked(sourceZipPath, archive.stdout);
const sourceZipSha = sha256(archive.stdout);
const sourceEntries = readZip(archive.stdout);
// git archive zip also emits explicit directory entries (trailing
// "/"); only file entries count toward the frozen file total.
const sourceFileCount = [...sourceEntries.keys()].filter((p) => !p.endsWith("/")).length;
const lsTree = run("git", ["ls-tree", "-r", "--name-only", FROZEN_COMMIT]);
const committedCount = lsTree.stdout
  .toString("utf8")
  .split("\n")
  .filter((l) => l !== "").length;
if (sourceFileCount !== committedCount) {
  console.error(
    `release:freeze FAILED: source.zip has ${sourceFileCount} files, git ls-tree lists ${committedCount}`,
  );
  process.exit(1);
}
console.log(`      source.zip: ${sourceZipBytes} bytes, ${sourceFileCount} files`);

// --- Step 3: dist.zip (deterministic) ---------------------------------------
console.log("[3/6] dist.zip <- dist/ + the five release docs (deterministic zip)");
const distEntries = [];
for (const full of distFiles) {
  const rel = relative(distDir, full).split(sep).join("/");
  distEntries.push({ path: `dist/${rel}`, data: readFileSync(full) });
}
for (const doc of RELEASE_DOCS) {
  distEntries.push({ path: doc, data: readFileSync(join(RELEASE_DIR, doc)) });
}
const distZipBuffer = writeZip(distEntries);
const distZipPath = join(RELEASE_DIR, "dist.zip");
const distZipBytes = writeChecked(distZipPath, distZipBuffer);
const distZipSha = sha256(distZipBuffer);
const distZipEntryPaths = [...readZip(distZipBuffer).keys()].sort();
console.log(`      dist.zip: ${distZipBytes} bytes, ${distZipEntryPaths.length} files`);

// --- Step 4: RELEASE_MANIFEST.json + SHA256SUMS.txt --------------------------
console.log("[4/6] RELEASE_MANIFEST.json + SHA256SUMS.txt");
const manifest = {
  schema: "locatorstress.release-manifest/v1",
  project: "P022 LocatorStress",
  spec_version: SPEC_VERSION,
  frozen_commit: FROZEN_COMMIT,
  license: "PENDING_SAM_DECISION",
  generated_by: "npm run release:freeze (scripts/release-freeze.mjs)",
  generation: {
    source_zip: `git archive --format=zip ${FROZEN_COMMIT}`,
    dist_zip:
      "npm run build (fresh, immediately before packaging) + deterministic STORE zip " +
      "(scripts/release-zip.mjs: fixed 1980-01-01 timestamps, entries sorted by path); " +
      "entries are dist/<path> for the build output plus the five release docs at the zip root",
    note:
      "Re-running release:freeze regenerates byte-identical artifacts from the same " +
      "frozen commit; FROZEN_COMMIT is hard-coded and never taken from HEAD.",
  },
  source_zip: {
    file: "source.zip",
    bytes: sourceZipBytes,
    sha256: sourceZipSha,
    file_count: sourceFileCount,
  },
  dist_zip: {
    file: "dist.zip",
    bytes: distZipBytes,
    sha256: distZipSha,
    file_count: distZipEntryPaths.length,
    files: distZipEntryPaths,
  },
  s0: {
    s0_gate_json_sha256: s0GateSha,
    scenario_sha256: s0Hashes.scenario_sha256,
    oracle_result_sha256: s0Hashes.oracle_result_sha256,
    analysis_sha256: s0Hashes.analysis_sha256,
    gate_sha256: s0Hashes.gate_sha256,
  },
};
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
const manifestPath = join(RELEASE_DIR, "RELEASE_MANIFEST.json");
const manifestBytes = writeChecked(manifestPath, manifestText);
const manifestSha = sha256(Buffer.from(manifestText, "utf8"));

// SHA256SUMS.txt lists exactly three items, never itself and never
// the freeze report (a sums file must not self-reference).
const sumsText =
  `${sourceZipSha}  source.zip\n` +
  `${distZipSha}  dist.zip\n` +
  `${manifestSha}  RELEASE_MANIFEST.json\n`;
const sumsPath = join(RELEASE_DIR, "SHA256SUMS.txt");
const sumsBytes = writeChecked(sumsPath, sumsText);
console.log(`      RELEASE_MANIFEST.json: ${manifestBytes} bytes`);
console.log(`      SHA256SUMS.txt: ${sumsBytes} bytes (3 entries)`);

// --- Step 5: R2_FREEZE_REPORT.md -----------------------------------------
console.log("[5/6] R2_FREEZE_REPORT.md");
const distList = distZipEntryPaths.map((p) => `- \`${p}\``).join("\n");
const report = `# P022 LocatorStress — R2 Freeze Report

- TASK_ID: FIX-R2-03
- Frozen commit: \`${FROZEN_COMMIT}\` (short: \`a834eea\`)
- SPEC_VERSION: \`${SPEC_VERSION}\`
- License: \`PENDING_SAM_DECISION\` (no LICENSE file added by FIX-R2-03)
- Generated by: \`npm run release:freeze\` (\`scripts/release-freeze.mjs\`)
- Generation commands:
  - \`npm run typecheck:scripts\`
  - \`npm run build\` (fresh, run by release:freeze immediately before packaging)
  - \`git archive --format=zip ${FROZEN_COMMIT}\` → \`release/source.zip\`
  - deterministic STORE zip of \`dist/\` + the five release docs → \`release/dist.zip\`
  - \`scripts/release-freeze.mjs\` writes \`RELEASE_MANIFEST.json\`, \`SHA256SUMS.txt\` and this report

## Artifacts

| file | bytes | SHA-256 |
| --- | ---: | --- |
| \`source.zip\` | ${sourceZipBytes} | \`${sourceZipSha}\` |
| \`dist.zip\` | ${distZipBytes} | \`${distZipSha}\` |
| \`RELEASE_MANIFEST.json\` | ${manifestBytes} | \`${manifestSha}\` |
| \`SHA256SUMS.txt\` | ${sumsBytes} | \`${sha256(Buffer.from(sumsText, "utf8"))}\` |

- \`source.zip\` file count: ${sourceFileCount} (equals \`git ls-tree -r --name-only ${FROZEN_COMMIT}\` count: ${committedCount}; the zip itself also carries ${sourceEntries.size - sourceFileCount} explicit directory entries, which are not files)
- \`dist.zip\` file count: ${distZipEntryPaths.length} (${distFiles.length} build outputs under \`dist/\` + ${RELEASE_DOCS.length} release docs at the zip root)

## dist.zip file list

${distList}

## S0 hashes (from evidence/s0/S0_GATE.json)

- \`evidence/s0/S0_GATE.json\` SHA-256: \`${s0GateSha}\` (frozen value, re-checked by \`release:verify\`)
- \`scenario_sha256\`: \`${s0Hashes.scenario_sha256}\`
- \`oracle_result_sha256\`: \`${s0Hashes.oracle_result_sha256}\`
- \`analysis_sha256\`: \`${s0Hashes.analysis_sha256}\`
- \`gate_sha256\`: \`${s0Hashes.gate_sha256}\`

## Acceptance verification (filled in after the three checks)

Run after \`release:freeze\`, in this order:

- \`npm run release:verify\`
- \`npm run release:compare-source\`
- \`npm run release:verify-hashes\`

Status at freeze time: PENDING — the exit codes and key outputs are
filled in by the FIX-R2-03 agent after running the three commands. This
section is a manual completion, not generated by \`release:freeze\`;
re-running \`release:freeze\` regenerates only the freeze-time sections
above and resets this section to PENDING (the report itself is not
listed in \`SHA256SUMS.txt\`, so completing it does not change any
hashed artifact).

## Freeze conclusion

- \`source.zip\` is byte-for-byte the \`git archive\` output of the frozen commit
  (entry count checked against \`git ls-tree\` at freeze time).
- \`dist.zip\` contains only the fresh build output plus the five
  frozen release docs listed above.
- \`RELEASE_MANIFEST.json\` records the frozen commit, the sizes and
  SHA-256 values of both zips, the full dist file list and the four S0 hashes.
- \`SHA256SUMS.txt\` lists exactly three items and does not self-reference.
- No business source, fixture, golden, test or evidence file was
  modified by the freeze; nothing was committed, pushed or uploaded.
`;
const reportPath = join(RELEASE_DIR, "R2_FREEZE_REPORT.md");
const reportBytes = writeChecked(reportPath, report);
console.log(`      R2_FREEZE_REPORT.md: ${reportBytes} bytes`);

// --- Step 6: self-check — re-read every artifact from disk -----------------
console.log("[6/6] self-check: re-read artifacts from disk");
const checks = [
  ["source.zip", sourceZipPath, sourceZipBytes, sourceZipSha],
  ["dist.zip", distZipPath, distZipBytes, distZipSha],
  ["RELEASE_MANIFEST.json", manifestPath, manifestBytes, manifestSha],
  ["SHA256SUMS.txt", sumsPath, sumsBytes, sha256(Buffer.from(sumsText, "utf8"))],
];
for (const [name, path, wantBytes, wantSha] of checks) {
  const buf = readFileSync(path);
  if (buf.length !== wantBytes || sha256(buf) !== wantSha) {
    console.error(`release:freeze FAILED: disk re-read mismatch for ${name}`);
    process.exit(1);
  }
}
console.log("\nrelease:freeze DONE");
console.log(`  source.zip            ${sourceZipBytes} bytes  ${sourceZipSha}`);
console.log(`  dist.zip              ${distZipBytes} bytes  ${distZipSha}`);
console.log(`  RELEASE_MANIFEST.json ${manifestBytes} bytes  ${manifestSha}`);
console.log(`  SHA256SUMS.txt        ${sumsBytes} bytes`);
console.log(`  source.zip files: ${sourceFileCount}, dist.zip files: ${distZipEntryPaths.length}`);
console.log("  Re-run `npm run release:freeze` and confirm the four SHAs above are unchanged.");
