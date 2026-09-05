import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

import { adjudicateRecord, buildIntegrityManifest, runChildWithDeadline, snapshotRecords, statusForRecord, validateRecordSemantics, verifyClosedManifest, verifyFinalPointInTime } from "./runner-lib.mjs";

const directory = import.meta.dirname;
const root = resolve(directory, "../..");
const resultsDirectory = join(directory, "results");
const manifestPath = join(directory, "integrity-manifest.json");
const write = process.argv.includes("--write");
const revisionIndex = process.argv.indexOf("--protocol-revision");
const protocolRevision = revisionIndex >= 0 ? process.argv[revisionIndex + 1] : null;
if (!protocolRevision || !/^[0-9a-f]{40}$/u.test(protocolRevision)) throw new Error("verification requires external --protocol-revision with the frozen method commit");

async function git(args) {
  const result = await runChildWithDeadline("git", args, { cwd: root, timeoutMs: 30_000 });
  if (result.timed_out || result.exit_code !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

async function recursiveJsonFiles(path) {
  const found = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) found.push(...await recursiveJsonFiles(child));
    else if (entry.isFile() && entry.name.endsWith(".json")) found.push(child);
  }
  return found.sort();
}

export const statusFor = statusForRecord;

const paths = await recursiveJsonFiles(resultsDirectory);
const snapshots = await snapshotRecords(paths, { root: directory });
const resultSchema = JSON.parse(await readFile(join(directory, "results.schema.json"), "utf8"));
const manifestSchema = JSON.parse(await readFile(join(directory, "integrity-manifest.schema.json"), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateResult = ajv.compile(resultSchema);
const validateManifest = ajv.compile(manifestSchema);
const failures = [];

for (const snapshot of snapshots) {
  if (!validateResult(snapshot.record)) failures.push(`${snapshot.record_path}: schema ${JSON.stringify(validateResult.errors)}`);
  const semantic = validateRecordSemantics(snapshot.record);
  if (semantic.length) failures.push(`${snapshot.record_path}: semantic ${semantic.join("; ")}`);
  if (["3", "4"].includes(snapshot.record.schema_version) && snapshot.record.arm === "B0" && snapshot.record.outcome === "complete") {
    const adjudication = adjudicateRecord(snapshot.record);
    if (snapshot.record.detected !== adjudication.detected || snapshot.record.false_success !== adjudication.false_success || !adjudication.eligible) failures.push(`${snapshot.record_path}: deterministic adjudication ${adjudication.reason}`);
  }
}

async function firstContainingCommit(recordPath) {
  const repositoryPath = `evaluation/markdown-baseline/${recordPath}`;
  const commits = (await git(["log", "--diff-filter=A", "--format=%H", "--", repositoryPath])).split(/\r?\n/u).filter(Boolean);
  return commits.at(-1) ?? "";
}

if (write) {
  const entries = [];
  for (const snapshot of snapshots) {
    const [status, statusReason] = statusFor(snapshot.record);
    entries.push({
      snapshot,
      record_git_commit: await firstContainingCommit(snapshot.record_path),
      protocol_revision: snapshot.record.environment.protocol_revision,
      status,
      status_reason: statusReason,
    });
  }
  const manifest = await buildIntegrityManifest(entries, { root: directory, protocol_revision: protocolRevision });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!validateManifest(manifest)) failures.push(`integrity-manifest.json: schema ${JSON.stringify(validateManifest.errors)}`);
if (manifest.protocol_revision !== protocolRevision) failures.push("integrity manifest protocol revision does not match external frozen revision");
failures.push(...await verifyClosedManifest(manifest, snapshots, { policy: statusFor, firstCommit: firstContainingCommit }));
for (const entry of manifest.records) {
  const repositoryPath = relative(root, join(directory, entry.record_path)).replaceAll("\\", "/");
  const committedBlob = await git(["rev-parse", `${entry.record_git_commit}:${repositoryPath}`]).catch(() => "");
  if (committedBlob !== entry.git_blob) failures.push(`${entry.record_path}: commit/blob mapping mismatch`);
}
const finalPaths = await recursiveJsonFiles(resultsDirectory);
failures.push(...await verifyFinalPointInTime(snapshots, finalPaths, { root: directory }));

process.stdout.write(`${JSON.stringify({ records: snapshots.length, manifest_entries: manifest.records.length, failures }, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
