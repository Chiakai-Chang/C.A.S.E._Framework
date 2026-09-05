import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join, relative } from "node:path";

const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

export async function fetchJsonWithDeadline(url, init, timeoutMs, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`fetch deadline exceeded after ${timeoutMs} ms`)), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const body = await response.json();
    return { response, body };
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`fetch deadline exceeded after ${timeoutMs} ms`, { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function runChildWithDeadline(command, args, { cwd, env = process.env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ exit_code: timedOut ? null : code, signal, timed_out: timedOut, stdout, stderr });
    });
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function redactLocalDetails(value, { roots = [], usernames = [] } = {}) {
  let redacted = String(value);
  for (const root of [...roots].sort((a, b) => b.length - a.length)) {
    redacted = redacted.replace(new RegExp(escapeRegExp(root), "giu"), "<worktree>");
  }
  redacted = redacted.replace(/[A-Za-z]:\\Users\\[^\\\r\n]+/gu, "<user-profile>");
  redacted = redacted.replace(/\/(?:home|Users)\/[^/\r\n]+/gu, "<user-profile>");
  redacted = redacted.replace(/[A-Za-z]:\\(?:[^\\\s"']+\\)*[^\\\s"']+/gu, "<local-path>");
  for (const username of usernames) {
    redacted = redacted.replace(new RegExp(`(?<=[\\/])${escapeRegExp(username)}(?=[\\/])`, "giu"), "<user>");
  }
  return redacted;
}

export async function atomicPersistRecord(directory, record) {
  await mkdir(directory, { recursive: true });
  const target = join(directory, `${record.record_id}.json`);
  const temporary = join(directory, `.${record.record_id}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(target, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`record already exists: ${record.record_id}`, { cause: error });
    throw error;
  }
  await handle.close();
  await rm(target);
  handle = await open(temporary, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    const reservation = await open(target, "wx");
    await reservation.close();
    await rm(target);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    if (error?.code === "EEXIST") throw new Error(`record already exists: ${record.record_id}`, { cause: error });
    throw error;
  }
  return target;
}

export function validateRecordSemantics(record) {
  const errors = [];
  if (record.detected && record.false_success) errors.push("detected and false_success are mutually exclusive");
  if (record.commands !== record.command_trace?.length) errors.push("commands must equal command_trace length");
  if (!Array.isArray(record.command_trace) || record.command_trace.some((entry, index) => entry.sequence !== index + 1)) errors.push("command_trace sequences must be contiguous and unique from 1");
  const started = typeof record.started_at === "string" && UTC_INSTANT.test(record.started_at) ? Date.parse(record.started_at) : Number.NaN;
  const ended = typeof record.ended_at === "string" && UTC_INSTANT.test(record.ended_at) ? Date.parse(record.ended_at) : Number.NaN;
  if (!Number.isFinite(started)) errors.push("started_at must be an RFC 3339 UTC instant");
  if (!Number.isFinite(ended)) errors.push("ended_at must be an RFC 3339 UTC instant");
  else if (Number.isFinite(started) && ended < started) errors.push("ended_at must not precede started_at");
  const accounting = record.environment?.token_accounting;
  if (accounting === "reported" && (!Number.isInteger(record.input_tokens) || !Number.isInteger(record.output_tokens))) errors.push("reported token accounting requires both token counts");
  if (accounting === "unavailable" && (record.input_tokens !== null || record.output_tokens !== null)) errors.push("unavailable token accounting requires null token counts");
  if (record.outcome === "invalid" && (record.detected || record.false_success)) errors.push("invalid outcome cannot claim detection or false success");
  if (record.outcome === "timeout" && (record.detected || record.false_success)) errors.push("timeout outcome cannot claim detection or false success");
  return errors;
}

function redactRecord(record, options) {
  if (typeof record === "string") return redactLocalDetails(record, options);
  if (Array.isArray(record)) return record.map((value) => redactRecord(value, options));
  if (record && typeof record === "object") {
    return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, redactRecord(value, options)]));
  }
  return record;
}

export async function executeRunPlans(plans, { execute, makeFailure, persist, redactOptions = {} }) {
  const records = [];
  for (const plan of plans) {
    const partial = { command_trace: [], actor_outputs: [] };
    let record;
    try {
      record = await execute(plan, partial);
    } catch (error) {
      record = makeFailure(plan, partial, error);
    }
    const safe = redactRecord(record, redactOptions);
    await persist(safe);
    records.push(safe);
  }
  return records;
}

function gitBlobDigest(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

export async function buildIntegrityManifest(entries, { root, protocol_revision }) {
  const records = [];
  for (const entry of entries) {
    const bytes = await readFile(entry.path);
    records.push({
      record_path: relative(root, entry.path).replaceAll("\\", "/"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      git_blob: gitBlobDigest(bytes),
      record_git_commit: entry.record_git_commit,
      protocol_revision: entry.protocol_revision ?? protocol_revision,
      status: entry.status,
      ...(entry.status_reason ? { status_reason: entry.status_reason } : {}),
    });
  }
  records.sort((a, b) => a.record_path.localeCompare(b.record_path, "en"));
  return { schema_version: "1", protocol_revision, records };
}

export async function verifyIntegrityManifest(manifest, { root }) {
  const errors = [];
  for (const entry of manifest.records) {
    const bytes = await readFile(join(root, entry.record_path));
    if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) errors.push(`${entry.record_path}: sha256 mismatch`);
    if (gitBlobDigest(bytes) !== entry.git_blob) errors.push(`${entry.record_path}: git blob mismatch`);
  }
  return errors;
}
