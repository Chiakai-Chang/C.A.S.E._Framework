import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

import { buildIntegrityManifest, runChildWithDeadline, validateRecordSemantics, verifyIntegrityManifest } from "./runner-lib.mjs";

const directory = import.meta.dirname;
const root = resolve(directory, "../..");
const resultsDirectory = join(directory, "results");
const manifestPath = join(directory, "integrity-manifest.json");
const write = process.argv.includes("--write");
const revisionIndex = process.argv.indexOf("--protocol-revision");
const protocolRevision = revisionIndex >= 0 ? process.argv[revisionIndex + 1] : null;

async function git(args) {
  const result = await runChildWithDeadline("git", args, { cwd: root, timeoutMs: 30_000 });
  if (result.exit_code !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

function statusFor(record) {
  if (record.record_id.endsWith("-r1")) return ["invalid-preregistered-pilot", "Retained pilot record is invalid under the recorded r1 limitations."];
  if (record.record_id === "20260905-qwen-b0-eval-m0-001-r2") return ["invalid-method", "One post-hoc evaluator was not two independent writer actors."];
  if (record.record_id === "20260905-qwen-b0-eval-m0-001-r3") return ["invalid-method", "Evaluator prewrote disconnected commits; raw actor transcript was omitted, so the manual override is not reproducible."];
  if (record.arm === "M0") return ["invalid-production", "Public Windows initialization is unsupported and target failure was not exercised."];
  if (record.record_id.endsWith("-r4")) return record.outcome === "complete"
    ? ["eligible-post-pilot-r4", "Method-frozen r4 observation; still not preregistered comparative evidence."]
    : ["invalid-run", `r4 outcome ${record.outcome} is not eligible comparative evidence.`];
  return ["eligible-post-pilot", "Post-pilot amended observation; not preregistered comparative evidence."];
}

const resultSchema = JSON.parse(await readFile(join(directory, "results.schema.json"), "utf8"));
const manifestSchema = JSON.parse(await readFile(join(directory, "integrity-manifest.schema.json"), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateResult = ajv.compile(resultSchema);
const validateManifest = ajv.compile(manifestSchema);
const files = (await readdir(resultsDirectory)).filter((file) => file.endsWith(".json")).sort();
const failures = [];
const records = [];
for (const file of files) {
  const record = JSON.parse(await readFile(join(resultsDirectory, file), "utf8"));
  const semantic = validateRecordSemantics(record);
  if (!validateResult(record)) failures.push(`${file}: schema ${JSON.stringify(validateResult.errors)}`);
  if (semantic.length) failures.push(`${file}: semantic ${semantic.join("; ")}`);
  records.push({ file, record });
}

if (write) {
  if (!protocolRevision || !/^[0-9a-f]{40}$/u.test(protocolRevision)) throw new Error("--write requires --protocol-revision with the frozen method commit");
  const entries = [];
  for (const { file, record } of records) {
    const recordPath = `evaluation/markdown-baseline/results/${file}`;
    const recordCommit = await git(["log", "-1", "--format=%H", "--", recordPath]);
    if (!recordCommit) throw new Error(`${file} must be committed before manifest generation`);
    const [status, statusReason] = statusFor(record);
    entries.push({ path: join(resultsDirectory, file), record_git_commit: recordCommit, protocol_revision: record.environment.protocol_revision, status, status_reason: statusReason });
  }
  const manifest = await buildIntegrityManifest(entries, { root: directory, protocol_revision: protocolRevision });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!validateManifest(manifest)) failures.push(`integrity-manifest.json: schema ${JSON.stringify(validateManifest.errors)}`);
if (manifest.records.length !== records.length) failures.push(`integrity manifest has ${manifest.records.length} entries for ${records.length} records`);
failures.push(...await verifyIntegrityManifest(manifest, { root: directory }));
for (const entry of manifest.records) {
  const repositoryPath = relative(root, join(directory, entry.record_path)).replaceAll("\\", "/");
  const committedBlob = await git(["rev-parse", `${entry.record_git_commit}:${repositoryPath}`]).catch(() => "");
  if (committedBlob !== entry.git_blob) failures.push(`${entry.record_path}: commit/blob mapping mismatch`);
}

process.stdout.write(`${JSON.stringify({ records: records.length, manifest_entries: manifest.records.length, failures }, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
