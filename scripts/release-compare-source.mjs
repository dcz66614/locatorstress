// FIX-R1-04 — compare release/source.zip against `git archive` of the
// frozen commit, file by file (paths + bytes).
//
// Method: extract release/source.zip into a temp dir, extract a fresh
// `git archive --format=zip` of the pinned FROZEN_COMMIT into a
// second temp dir (same ZIP reader for both, so the comparison is over
// extracted bytes), then compare the sorted relative path lists and
// the SHA-256 of every file. The file count is also cross-checked
// against `git ls-tree -r --name-only` of the frozen commit.
// Temp dirs are removed afterwards. Read-only with respect to the
// repo: nothing under release/ or elsewhere is modified.
//
// Usage: npm run release:compare-source
// Exit:  0 iff every path and every byte matches; 1 otherwise.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readZip } from "./release-zip.mjs";

const ROOT = resolve(join(fileURLToPath(import.meta.url), "..", ".."));

// The frozen commit (full SHA of a834eea). Hard-coded on purpose:
// never derive it from HEAD or the branch tip.
const FROZEN_COMMIT = "a834eeae36f816c2f273677636127facb6902dbf";

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
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

function extractZipEntries(entries, destDir) {
  for (const [relPath, data] of entries) {
    // git archive zip emits explicit directory entries (trailing "/"):
    // create the directory, do not write a file for it.
    if (relPath.endsWith("/")) {
      mkdirSync(join(destDir, ...relPath.split("/").filter((s) => s !== "")), {
        recursive: true,
      });
      continue;
    }
    const target = join(destDir, ...relPath.split("/"));
    mkdirSync(join(destDir, ...relPath.split("/").slice(0, -1)), { recursive: true });
    writeFileSync(target, data);
  }
}

// File entries only: git archive zip also emits explicit directory
// entries (trailing "/"), which are not files.
function fileEntryCount(entries) {
  return [...entries.keys()].filter((p) => !p.endsWith("/")).length;
}

const failures = [];
const tmpBase = mkdtempSync(join(tmpdir(), "p022-release-compare-"));
const dirA = join(tmpBase, "source-zip");
const dirB = join(tmpBase, "git-archive");
try {
  mkdirSync(dirA, { recursive: true });
  mkdirSync(dirB, { recursive: true });

  // A: release/source.zip
  const sourceZipPath = join(ROOT, "release", "source.zip");
  let sourceEntries;
  try {
    sourceEntries = readZip(readFileSync(sourceZipPath));
  } catch (err) {
    console.error(`release:compare-source FAILED: cannot read release/source.zip: ${err.message}`);
    process.exit(1);
  }
  extractZipEntries(sourceEntries, dirA);

  // B: fresh git archive of the frozen commit
  const archive = spawnSync("git", ["archive", "--format=zip", FROZEN_COMMIT], {
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (archive.error !== undefined || archive.status !== 0) {
    console.error(
      `release:compare-source FAILED: git archive ${FROZEN_COMMIT} failed` +
        (archive.error !== undefined ? `: ${archive.error.message}` : ` (exit ${archive.status})`),
    );
    process.exit(1);
  }
  let archiveEntries;
  try {
    archiveEntries = readZip(archive.stdout);
  } catch (err) {
    console.error(`release:compare-source FAILED: cannot parse git archive output: ${err.message}`);
    process.exit(1);
  }
  extractZipEntries(archiveEntries, dirB);

  // Cross-check the count against git ls-tree.
  const lsTree = spawnSync("git", ["ls-tree", "-r", "--name-only", FROZEN_COMMIT], { cwd: ROOT });
  const committedCount = lsTree.stdout
    .toString("utf8")
    .split("\n")
    .filter((l) => l !== "").length;
  console.log(
    `source.zip files: ${fileEntryCount(sourceEntries)}, git archive files: ${fileEntryCount(archiveEntries)}, ` +
      `git ls-tree files: ${committedCount}`,
  );
  if (fileEntryCount(sourceEntries) !== committedCount) {
    failures.push(`source.zip has ${fileEntryCount(sourceEntries)} files, git ls-tree lists ${committedCount}`);
  }
  if (fileEntryCount(archiveEntries) !== committedCount) {
    failures.push(`git archive has ${fileEntryCount(archiveEntries)} files, git ls-tree lists ${committedCount}`);
  }

  // Compare path lists, then bytes.
  const filesA = listFilesRecursive(dirA).map((f) => relative(dirA, f).split(sep).join("/"));
  const filesB = listFilesRecursive(dirB).map((f) => relative(dirB, f).split(sep).join("/"));
  const setB = new Set(filesB);
  const setA = new Set(filesA);
  for (const f of filesA) {
    if (!setB.has(f)) failures.push(`only in source.zip: ${f}`);
  }
  for (const f of filesB) {
    if (!setA.has(f)) failures.push(`only in git archive: ${f}`);
  }
  let compared = 0;
  let matched = 0;
  for (const f of filesA) {
    if (!setB.has(f)) continue;
    compared += 1;
    const hashA = sha256(readFileSync(join(dirA, ...f.split("/"))));
    const hashB = sha256(readFileSync(join(dirB, ...f.split("/"))));
    if (hashA === hashB) {
      matched += 1;
    } else {
      failures.push(`byte mismatch: ${f} (source.zip ${hashA} != git archive ${hashB})`);
    }
  }
  console.log(`compared ${compared} files, ${matched} byte-identical`);

  if (failures.length > 0) {
    console.error(`\nrelease:compare-source FAILED (${failures.length} problem(s)):`);
    for (const f of failures.slice(0, 50)) console.error(`  - ${f}`);
    if (failures.length > 50) console.error(`  ... and ${failures.length - 50} more`);
    process.exit(1);
  }
  console.log(
    `\nrelease:compare-source PASSED — ${matched}/${compared} files byte-identical, ` +
      `0 path differences, 0 byte differences`,
  );
} finally {
  rmSync(tmpBase, { recursive: true, force: true });
}
