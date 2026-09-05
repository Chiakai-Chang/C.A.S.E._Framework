import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

import { buildIntegrityManifest, runChildWithDeadline, snapshotRecords, validateRecordSemantics, verifyClosedManifest } from "./runner-lib.mjs";

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

export function statusFor(record) {
  if (record.record_id.endsWith("-r1")) return ["invalid-preregistered-pilot", "Retained pilot record is invalid under the recorded r1 limitations."];
  if (record.record_id === "20260905-qwen-b0-eval-m0-001-r2") return ["invalid-method", "One post-hoc evaluator was not two independent writer actors."];
  if (record.record_id === "20260905-qwen-b0-eval-m0-001-r3") return ["invalid-method", "Evaluator prewrote disconnected commits; raw actor transcript was omitted, so the manual override is not reproducible."];
  if (record.record_id.endsWith("-r4")) return ["invalid-provenance-runner-boundary", "r4 redacted model identity to a placeholder and did not prove bounded owned-process-tree cleanup; it is ineligible evidence."];
  if (record.arm === "M0") return ["invalid-production", "Public Windows initialization is unsupported and target failure was not exercised."];
  if (record.record_id.endsWith("-r5")) return record.outcome === "complete"
    ? ["eligible-post-pilot-r5", "Method-frozen r5 observation; still not preregistered comparative evidence."]
    : ["invalid-run", `r5 outcome ${record.outcome} is not eligible comparative evidence.`];
  return ["eligible-post-pilot", "Post-pilot amended observation; not preregistered comparative evidence."];
}

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

process.stdout.write(`${JSON.stringify({ records: snapshots.length, manifest_entries: manifest.records.length, failures }, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
