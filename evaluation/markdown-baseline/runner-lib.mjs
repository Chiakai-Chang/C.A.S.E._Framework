import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, link, mkdir, open, readFile, rename, rm } from "node:fs/promises";
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
    const child = spawn(command, args, { cwd, env, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    child.once("error", finishReject);
    const timer = setTimeout(async () => {
      timedOut = true;
      await terminateOwnedProcessTree(child.pid);
    }, timeoutMs);
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exit_code: timedOut ? null : code, signal, timed_out: timedOut, stdout, stderr });
    });
  });
}

async function terminateOwnedProcessTree(pid) {
  if (!Number.isInteger(pid)) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      const timer = setTimeout(() => { killer.kill(); resolve(); }, 2_000);
      killer.once("error", () => { clearTimeout(timer); resolve(); });
      killer.once("close", () => { clearTimeout(timer); resolve(); });
    });
    try { process.kill(pid, "SIGKILL"); } catch { /* taskkill already completed */ }
    return;
  }
  try { process.kill(-pid, "SIGTERM"); } catch { return; }
  await new Promise((resolve) => setTimeout(resolve, 200));
  try { process.kill(-pid, "SIGKILL"); } catch { /* already exited */ }
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
  const serialized = `${JSON.stringify(record, null, 2)}\n`;
  await mkdir(directory, { recursive: true });
  const target = join(directory, `${record.record_id}.json`);
  const temporary = join(directory, `.${record.record_id}.${process.pid}.${randomUUID()}.tmp`);
  const reservation = join(directory, `.${record.record_id}.lock`);
  let handle = null;
  let reserved = false;
  try {
    handle = await open(temporary, "wx");
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    if (process.platform === "win32") {
      try {
        await mkdir(reservation);
        reserved = true;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        try {
          await access(target);
          throw new Error(`record already exists: ${record.record_id}`);
        } catch (targetError) {
          if (targetError?.code !== "ENOENT") throw targetError;
          throw new Error(`record has an in-flight or stale reservation requiring recovery: ${record.record_id}`);
        }
      }
      try {
        await access(target);
        throw new Error(`record already exists: ${record.record_id}`);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      await rename(temporary, target);
    } else await link(temporary, target);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`record already exists: ${record.record_id}`, { cause: error });
    throw error;
  } finally {
    if (handle) await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    if (reserved) await rm(reservation, { recursive: true, force: true }).catch(() => {});
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
  if (record.schema_version === "3" && record.command_trace?.some((entry) => typeof entry.timed_out !== "boolean")) errors.push("version 3 trace entries require timed_out");
  if (record.schema_version === "3" && record.environment?.provenance_status === "unavailable" && record.outcome === "complete") errors.push("complete version 3 outcome requires verified provenance");
  if (record.command_trace?.some((entry) => entry.timed_out) && (record.outcome !== "timeout" || record.detected || record.false_success)) errors.push("timed-out command requires timeout without detection credit");
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

export async function executeRunPlans(plans, { execute, makeFailure, persist, redactOptions = {}, onPersistenceFailure = () => {} }) {
  const records = [];
  const persistence_failures = [];
  for (const plan of plans) {
    const partial = { command_trace: [], actor_outputs: [] };
    let record;
    try {
      record = await execute(plan, partial);
    } catch (error) {
      record = makeFailure(plan, partial, error);
    }
    const safe = redactRecord(record, redactOptions);
    try {
      await persist(safe);
      records.push(safe);
    } catch (error) {
      const failure = { record_id: safe.record_id, error: `persistence failed: ${error?.message ?? String(error)}` };
      persistence_failures.push(failure);
      onPersistenceFailure(failure);
    }
  }
  return { records, persistence_failures };
}

function gitBlobDigest(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

export async function buildIntegrityManifest(entries, { root, protocol_revision }) {
  const records = [];
  for (const entry of entries) {
    const bytes = entry.snapshot?.bytes ?? await readFile(entry.path);
    records.push({
      record_path: entry.snapshot?.record_path ?? relative(root, entry.path).replaceAll("\\", "/"),
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

export async function snapshotRecords(paths, { root, readFileFn = readFile }) {
  const snapshots = [];
  for (const path of paths) {
    const bytes = await readFileFn(path);
    snapshots.push({
      record_path: relative(root, path).replaceAll("\\", "/"),
      bytes,
      record: JSON.parse(bytes.toString("utf8")),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      git_blob: gitBlobDigest(bytes),
    });
  }
  return snapshots;
}

export async function verifyClosedManifest(manifest, snapshots, { policy, firstCommit }) {
  const errors = [];
  const snapshotPaths = snapshots.map((item) => item.record_path).sort();
  const manifestPaths = manifest.records.map((item) => item.record_path).sort();
  if (new Set(manifestPaths).size !== manifestPaths.length) errors.push("manifest contains duplicate record paths");
  if (JSON.stringify(snapshotPaths) !== JSON.stringify([...new Set(manifestPaths)].sort())) errors.push("record file set mismatch");
  const byPath = new Map(manifest.records.map((entry) => [entry.record_path, entry]));
  for (const snapshot of snapshots) {
    const entry = byPath.get(snapshot.record_path);
    if (!entry) continue;
    if (`${snapshot.record.record_id}.json` !== snapshot.record_path.split("/").at(-1)) errors.push(`${snapshot.record_path}: filename/record_id mismatch`);
    if (entry.sha256 !== snapshot.sha256) errors.push(`${snapshot.record_path}: sha256 mismatch`);
    if (entry.git_blob !== snapshot.git_blob) errors.push(`${snapshot.record_path}: git blob mismatch`);
    const [status, reason] = policy(snapshot.record);
    if (entry.status !== status) errors.push(`${snapshot.record_path}: status mismatch`);
    if (entry.status_reason !== reason) errors.push(`${snapshot.record_path}: status_reason mismatch`);
    if (entry.protocol_revision !== snapshot.record.environment?.protocol_revision) errors.push(`${snapshot.record_path}: protocol_revision mismatch`);
    if (entry.record_git_commit !== await firstCommit(snapshot.record_path)) errors.push(`${snapshot.record_path}: first-containing commit mismatch`);
  }
  return errors;
}

export function scoreConcurrentPublication(publishTrace, verdicts) {
  const winners = publishTrace.filter((entry) => !entry.timed_out && entry.exit_code === 0).map((entry) => entry.actor);
  const losers = publishTrace.filter((entry) => !entry.timed_out && entry.exit_code !== null && entry.exit_code !== 0).map((entry) => entry.actor);
  if (publishTrace.some((entry) => entry.timed_out)) return { outcome: "timeout", detected: false, false_success: false, winners, losers };
  const detected = winners.length === 1 && losers.length === 1 && verdicts.some((item) => losers.includes(item.actor) && item.verdict === "DETECTED") && !verdicts.some((item) => losers.includes(item.actor) && item.verdict === "SUCCESS");
  const false_success = winners.length !== 1 || verdicts.some((item) => losers.includes(item.actor) && item.verdict === "SUCCESS");
  return { outcome: detected || false_success ? "complete" : "failed", detected, false_success, winners, losers };
}

export function classifyM0ProcessResult(result) {
  let code = "unparseable";
  try { code = JSON.parse(result.stdout).code; } catch { /* exact output remains in trace */ }
  if (result.timed_out) return { outcome: "timeout", expected_unsupported: false, code };
  const expected_unsupported = result.exit_code === 10 && code === "CASE_E_UNSUPPORTED_PROFILE";
  return { outcome: expected_unsupported ? "invalid" : "failed", expected_unsupported, code };
}
