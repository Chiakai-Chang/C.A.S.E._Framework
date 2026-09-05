import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, cp, link, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

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

export class EvaluationTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "EvaluationTimeoutError";
  }
}

export function requireCompletedCommand(result, label) {
  if (result.timed_out) throw new EvaluationTimeoutError(`${label}: command deadline exceeded`);
  return result;
}

export function buildEvaluatorEnvironment(source = process.env, overrides = {}) {
  const environment = {};
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP"]) {
    if (typeof source[key] === "string" && source[key]) environment[key] = source[key];
  }
  return {
    ...environment,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    ...overrides,
  };
}

export function accumulateTokenUsage(partial, response) {
  if (!Number.isInteger(response.input) || !Number.isInteger(response.output)) {
    partial.tokens_available = false;
    return;
  }
  partial.input_tokens_total = (partial.input_tokens_total ?? 0) + response.input;
  partial.output_tokens_total = (partial.output_tokens_total ?? 0) + response.output;
}

export function parseFutureRunLabel(runLabel) {
  const match = typeof runLabel === "string" ? runLabel.match(/^r([1-9][0-9]*)$/u) : null;
  if (!match || BigInt(match[1]) < 7n) throw new Error("--run-label must be the canonical exact decimal r7 or later without leading zeroes; r1-r6 are reserved immutable history");
  return runLabel;
}

export function validateEvaluationIdentity({ runLabel, scorerVersion, protocolRevision, schemaVersion, existingRecordIds = [] }) {
  parseFutureRunLabel(runLabel);
  if (schemaVersion !== "4") throw new Error("--schema-version must explicitly select reserved post-r6 schema version 4");
  if (scorerVersion !== "case-eval-v4.0.0") throw new Error("--scorer-version must explicitly select case-eval-v4.0.0");
  if (typeof protocolRevision !== "string" || !/^[0-9a-f]{40}$/u.test(protocolRevision)) throw new Error("--protocol-revision requires the frozen 40-character method commit");
  if (existingRecordIds.some((recordId) => recordId.endsWith(`-${runLabel}`))) throw new Error(`run-label collision: ${runLabel} already exists in the results directory`);
  return { runLabel, scorerVersion, protocolRevision, schemaVersion };
}

export function assertFrozenEvaluationMethod({ protocolRevision, headRevision, dirtyPaths }) {
  if (protocolRevision !== headRevision) throw new Error(`--protocol-revision ${protocolRevision} does not match current frozen method commit ${headRevision}`);
  if (dirtyPaths.length) throw new Error(`evaluation method is not frozen: uncommitted method paths: ${dirtyPaths.join(", ")}`);
}

async function artifactFiles(root, directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await artifactFiles(root, path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort((a, b) => relative(root, a).localeCompare(relative(root, b)));
}

async function retainRuntimeBytes(directory, extensions) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await retainRuntimeBytes(path, extensions);
      if ((await readdir(path)).length === 0) await rm(path, { recursive: true, force: true });
    } else if (entry.isFile() && !extensions.has(extname(entry.name))) await rm(path, { force: true });
  }
}

export async function digestCliArtifact(root) {
  const hash = createHash("sha256");
  let total_bytes = 0;
  const files = await artifactFiles(root);
  for (const path of files) {
    const name = relative(root, path).replaceAll("\\", "/");
    const bytes = await readFile(path);
    hash.update(`${name}\0${bytes.length}\0`, "utf8");
    hash.update(bytes);
    total_bytes += bytes.length;
  }
  return { sha256: hash.digest("hex"), file_count: files.length, total_bytes };
}

export async function prepareFreshCliArtifact({
  root, sourceCommit, compile = null,
  runtimePackages = ["ajv", "fast-deep-equal", "fast-uri", "json-schema-traverse", "require-from-string"],
}) {
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) throw new Error("fresh CLI artifact requires an exact source commit");
  const artifactRoot = await mkdtemp(join(root, ".case-eval-cli-"));
  try {
    await cp(join(root, "schemas"), join(artifactRoot, "schemas"), { recursive: true });
    for (const packageName of runtimePackages) {
      await cp(join(root, "node_modules", packageName), join(artifactRoot, "node_modules", packageName), { recursive: true });
    }
    if (compile) await compile(artifactRoot);
    else {
      const result = await runChildWithDeadline(process.execPath, [
        join(root, "node_modules", "typescript", "bin", "tsc"), "-p", join(root, "tsconfig.json"),
        "--outDir", join(artifactRoot, "dist"), "--declaration", "false", "--sourceMap", "false",
      ], { cwd: root, env: buildEvaluatorEnvironment(), timeoutMs: 120_000 });
      if (result.timed_out || result.exit_code !== 0) throw new Error(`fresh CLI build failed: ${result.stderr || result.stdout}`);
    }
    await rm(join(artifactRoot, "dist", "tests"), { recursive: true, force: true });
    await retainRuntimeBytes(join(artifactRoot, "dist"), new Set([".js", ".cjs", ".mjs"]));
    if (runtimePackages.length) await retainRuntimeBytes(join(artifactRoot, "node_modules"), new Set([".js", ".cjs", ".mjs", ".json", ".node"]));
    const cliPath = resolve(artifactRoot, "dist", "src", "cli", "main.js");
    await access(cliPath);
    const provenance = await digestCliArtifact(artifactRoot);
    return { root: artifactRoot, cliPath, sourceCommit, provenance, cleanup: () => rm(artifactRoot, { recursive: true, force: true }) };
  } catch (error) {
    await rm(artifactRoot, { recursive: true, force: true });
    throw error;
  }
}

function appendTrace(partial, actor, command, result) {
  partial.command_trace.push({ sequence: partial.command_trace.length + 1, actor, command, exit_code: result.exit_code, result: `${result.stdout}${result.stderr}`.trim() || "(no output)", timed_out: Boolean(result.timed_out) });
  return result;
}

export async function injectSingleB0({ caseId, repository, partial, deadlineAt, writeArtifact, runGit, remaining }) {
  try {
    await writeArtifact(repository, deadlineAt);
    appendTrace(partial, "evaluator-injection", "inject write artifact v2", { exit_code: 0, stdout: "artifact.txt replaced with externally supplied v2\n", stderr: "", timed_out: false });
  } catch (error) {
    appendTrace(partial, "evaluator-injection", "inject write artifact v2", { exit_code: null, stdout: "", stderr: error?.message ?? String(error), timed_out: error instanceof EvaluationTimeoutError });
    throw error;
  }
  if (caseId !== "EVAL-M0-002") return;
  for (const [command, args, label] of [
    ["inject git add artifact.txt", ["add", "artifact.txt"], "intervening add"],
    ["inject git commit intervening work", ["commit", "--quiet", "-m", "intervening work"], "intervening commit"],
  ]) {
    const result = appendTrace(partial, "evaluator-injection", command, await runGit(repository, args, remaining(deadlineAt)));
    requireCompletedCommand(result, label);
    if (result.exit_code !== 0) throw new Error(`${label}: ${result.stderr || result.stdout}`);
  }
}

export function createPublicationGate(partial, deadlineAt, { runGit, remaining, sanitize = String, waitCapMs = 120_000 }) {
  const requests = new Map();
  const seenActors = new Set();
  let released = false;
  let failedMessage = null;
  function terminalize(actor, request, result, error = null) {
    if (request.terminal) return;
    request.terminal = true;
    seenActors.add(actor);
    clearTimeout(request.timer);
    if (requests.get(actor) === request) requests.delete(actor);
    appendTrace(partial, actor, "git publish origin HEAD:refs/heads/published", result);
    if (error) request.reject(error);
    else request.resolve(result);
  }
  async function release() {
    if (released || requests.size !== 2) return;
    released = true;
    const pairs = [...requests.entries()];
    for (const [, request] of pairs) clearTimeout(request.timer);
    const settled = await Promise.allSettled(pairs.map(([, request]) => Promise.resolve().then(
      () => runGit(request.repository, ["push", "--porcelain", "origin", "HEAD:refs/heads/published"], remaining(deadlineAt)),
    )));
    pairs.forEach(([actor, request], index) => {
      const item = settled[index];
      if (item.status === "fulfilled") terminalize(actor, request, item.value);
      else {
        const timedOut = item.reason instanceof EvaluationTimeoutError;
        const message = sanitize(item.reason?.message ?? String(item.reason));
        const error = timedOut ? new EvaluationTimeoutError(message) : new Error(message);
        terminalize(actor, request, { exit_code: null, stdout: "", stderr: message, timed_out: timedOut }, error);
      }
    });
  }
  return {
    request(actor, repository) {
      if (seenActors.has(actor)) {
        const result = { exit_code: 2, stdout: "", stderr: `publish already terminalized for ${actor}`, timed_out: false };
        appendTrace(partial, actor, "git publish origin HEAD:refs/heads/published", result);
        return Promise.resolve(result);
      }
      if (requests.has(actor)) return Promise.resolve({ exit_code: 2, stdout: "", stderr: "publish already requested", timed_out: false });
      if (failedMessage) {
        const result = { exit_code: null, stdout: "", stderr: failedMessage, timed_out: true };
        appendTrace(partial, actor, "git publish origin HEAD:refs/heads/published", result);
        return Promise.resolve(result);
      }
      return new Promise((resolvePromise, rejectPromise) => {
        const request = { repository, resolve: resolvePromise, reject: rejectPromise, timer: null, terminal: false };
        request.timer = setTimeout(() => {
          const message = `${actor} timed out waiting for peer at shared publication gate`;
          failedMessage = message;
          terminalize(actor, request, { exit_code: null, stdout: "", stderr: message, timed_out: true }, new EvaluationTimeoutError(message));
        }, remaining(deadlineAt, waitCapMs));
        requests.set(actor, request);
        void release();
      });
    },
    abort(message) {
      for (const [actor, request] of [...requests]) terminalize(actor, request, { exit_code: null, stdout: "", stderr: message, timed_out: false });
    },
  };
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
  if (["3", "4"].includes(record.schema_version) && record.command_trace?.some((entry) => typeof entry.timed_out !== "boolean")) errors.push("version 3+ trace entries require timed_out");
  if (["3", "4"].includes(record.schema_version) && record.environment?.provenance_status === "unavailable" && record.outcome === "complete") errors.push("complete version 3+ outcome requires verified provenance");
  if (record.schema_version === "4" && record.environment?.cli_artifact?.source_commit !== record.environment?.cli_commit) errors.push("version 4 CLI artifact source_commit must equal cli_commit");
  if (record.schema_version === "4" && record.environment?.protocol_revision !== record.environment?.cli_commit) errors.push("version 4 protocol_revision must equal cli_commit");
  if (record.schema_version === "4") {
    const suffix = record.record_id?.match(/-(r[^-]+)$/u)?.[1] ?? null;
    try { parseFutureRunLabel(suffix); } catch { errors.push("version 4 record_id requires a canonical r7-or-later suffix"); }
    if (record.scoring?.scorer_version !== "case-eval-v4.0.0") errors.push("version 4 requires case-eval-v4.0.0");
  }
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

export async function executeRunPlans(plans, { execute, makeFailure, finalize = (record) => record, persist, redactOptions = {}, onPersistenceFailure = () => {} }) {
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
    const safe = redactRecord(finalize(record), redactOptions);
    try {
      await persist(safe);
      records.push(safe);
    } catch (error) {
      const failure = { record_id: safe.record_id, error: redactLocalDetails(`persistence failed: ${error?.message ?? String(error)}`, redactOptions) };
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

export async function verifyFinalPointInTime(initialSnapshots, finalPaths, { root, readFileFn = readFile }) {
  const errors = [];
  const finalSnapshots = await snapshotRecords(finalPaths, { root, readFileFn });
  const initialPaths = initialSnapshots.map((item) => item.record_path).sort();
  const finalPathNames = finalSnapshots.map((item) => item.record_path).sort();
  if (JSON.stringify(initialPaths) !== JSON.stringify(finalPathNames)) errors.push("result file set changed during verification");
  const initial = new Map(initialSnapshots.map((item) => [item.record_path, item]));
  for (const snapshot of finalSnapshots) {
    const before = initial.get(snapshot.record_path);
    if (!before) continue;
    if (before.sha256 !== snapshot.sha256 || before.git_blob !== snapshot.git_blob) errors.push(`${snapshot.record_path}: bytes changed during verification`);
    if (before.record.record_id !== snapshot.record.record_id) errors.push(`${snapshot.record_path}: identity changed during verification`);
  }
  return errors;
}

function detectedVerdict(record) {
  return record.scoring?.verdict_transcript?.find((item) => item.verdict === "DETECTED") ?? null;
}

function containsRevision(evidence, revision) {
  const lower = evidence.toLowerCase();
  return lower.includes(revision.toLowerCase()) || lower.includes(revision.slice(0, 7).toLowerCase());
}

function injectionCount(record) {
  return record.command_trace.filter((entry) => entry.actor === "evaluator-injection").length;
}

function artifactInjectionCount(record) {
  return record.command_trace.filter((entry) => entry.actor === "evaluator-injection" && /inject (?:write artifact|frozen intervening artifact)/u.test(entry.command)).length;
}

export function adjudicateRecord(record) {
  const burden = {
    trace_events: record.command_trace.length,
    actor_commands: record.command_trace.filter((entry) => entry.actor !== "evaluator-injection" && entry.actor !== "runner").length,
    evaluator_events: injectionCount(record),
  };
  if (record.arm !== "B0") return { eligible: false, detected: false, false_success: false, reason: "Non-B0 record is not detection evidence.", burden };
  const verdict = detectedVerdict(record);
  const success = record.scoring?.verdict_transcript?.find((item) => item.verdict === "SUCCESS") ?? null;
  const evidence = verdict?.evidence.toLowerCase() ?? "";
  if (record.case_id === "EVAL-M0-001") {
    const publishes = record.command_trace.filter((entry) => entry.command.includes("publish origin"));
    const topology = scoreConcurrentPublication(publishes, record.scoring?.verdict_transcript ?? []);
    if (topology.winners.length !== 1 || topology.losers.length !== 1) return { eligible: false, detected: false, false_success: false, reason: "Audited publication trace does not identify exactly one winner and one loser.", burden };
    const winner = publishes.find((entry) => entry.actor === topology.winners[0]);
    const loser = publishes.find((entry) => entry.actor === topology.losers[0]);
    const match = loser?.result.match(/is at ([0-9a-f]{40}) but expected ([0-9a-f]{40})/iu);
    const relationGrounded = Boolean(loser && winner && match);
    const loserSuccess = record.scoring?.verdict_transcript?.find((item) => item.actor === loser?.actor && item.verdict === "SUCCESS") ?? null;
    if (loserSuccess) {
      const groundedFalseSuccess = Boolean(relationGrounded && topology.false_success);
      return { eligible: groundedFalseSuccess, detected: false, false_success: groundedFalseSuccess, reason: groundedFalseSuccess ? "SUCCESS verdict is grounded as false success by the audited losing publication conflict." : "No gradeable DETECTED or grounded SUCCESS verdict.", burden };
    }
    const loserVerdict = record.scoring?.verdict_transcript?.find((item) => item.actor === loser?.actor && item.verdict === "DETECTED") ?? null;
    const loserEvidence = loserVerdict?.evidence.toLowerCase() ?? "";
    const grounded = Boolean(relationGrounded && loserVerdict && containsRevision(loserEvidence, match[1]) && containsRevision(loserEvidence, match[2]) && /publish|ref|basis|conflict|invalidat/iu.test(loserEvidence));
    return { eligible: grounded, detected: grounded, false_success: false, reason: grounded ? "Loser verdict binds both exact shared-ref revisions and the audited publication conflict." : "DETECTED evidence is not grounded in the audited loser publication conflict and both revisions.", burden };
  }
  const injected = artifactInjectionCount(record) === 1;
  const caseObservation = record.command_trace.find((entry) => entry.actor === "actor-b" && entry.command === "read CASE.md")?.result ?? "";
  const hashes = [...caseObservation.matchAll(/[0-9a-f]{64}/giu)].map((match) => match[0]);
  const postHash = [...record.command_trace].reverse().find((entry) => entry.actor === "actor-b" && entry.command === "sha256 artifact.txt")?.result.match(/[0-9a-f]{64}/iu)?.[0];
  if (record.case_id === "EVAL-M0-003" || record.case_id === "EVAL-M0-004") {
    const oldHash = hashes[0];
    const relationGrounded = Boolean(injected && oldHash && postHash && oldHash !== postHash);
    if (!verdict) {
      return { eligible: Boolean(success && relationGrounded), detected: false, false_success: Boolean(success && relationGrounded), reason: success && relationGrounded ? "SUCCESS verdict is grounded as false success by the audited digest mismatch." : "No gradeable DETECTED or grounded SUCCESS verdict.", burden };
    }
    const grounded = Boolean(relationGrounded && evidence.includes(oldHash.toLowerCase()) && evidence.includes(postHash.toLowerCase()) && evidence.includes("artifact") && /stale|mismatch|no longer match/iu.test(evidence));
    return { eligible: grounded, detected: grounded, false_success: false, reason: grounded ? "Verdict binds the recorded and current artifact SHA-256 values plus the audited injection." : "DETECTED evidence does not bind both audited artifact digests and their stale relation.", burden };
  }
  if (record.case_id === "EVAL-M0-002") {
    const oldRevision = caseObservation.match(/offer_basis:\s*([0-9a-f]{40})/iu)?.[1];
    const postRevision = [...record.command_trace].reverse().find((entry) => entry.actor === "actor-b" && entry.command === "git rev-parse HEAD")?.result.match(/[0-9a-f]{40}/iu)?.[0];
    const sawOld = record.command_trace.some((entry) => entry.actor === "actor-b" && entry.command === "read artifact.txt" && entry.result.trim() === "v1");
    const sawNew = [...record.command_trace].reverse().some((entry) => entry.actor === "actor-b" && entry.command === "read artifact.txt" && entry.result.trim() === "v2");
    const relationGrounded = Boolean(injected && oldRevision && postRevision && oldRevision !== postRevision && sawOld && sawNew);
    if (!verdict) {
      return { eligible: Boolean(success && relationGrounded), detected: false, false_success: Boolean(success && relationGrounded), reason: success && relationGrounded ? "SUCCESS verdict is grounded as false success by the audited stale handoff relation." : "No gradeable DETECTED or grounded SUCCESS verdict.", burden };
    }
    const grounded = Boolean(relationGrounded && containsRevision(evidence, oldRevision) && containsRevision(evidence, postRevision) && evidence.includes("artifact.txt") && evidence.includes("v1") && evidence.includes("v2") && /stale|intervening/iu.test(evidence));
    return { eligible: grounded, detected: grounded, false_success: false, reason: grounded ? "Verdict binds unambiguous revision prefixes, artifact path/versions, and the audited intervening injection." : "DETECTED evidence does not bind the audited handoff basis, current revision, artifact versions, and stale relation.", burden };
  }
  return { eligible: false, detected: false, false_success: false, reason: "Unknown case.", burden };
}

export function statusForRecord(record) {
  const recordId = record.record_id ?? "unlabeled-record";
  if (recordId.endsWith("-r1")) return ["invalid-preregistered-pilot", "Retained pilot record is invalid under the recorded r1 limitations."];
  if (recordId === "20260905-qwen-b0-eval-m0-001-r2") return ["invalid-method", "One post-hoc evaluator was not two independent writer actors."];
  if (recordId === "20260905-qwen-b0-eval-m0-001-r3") return ["invalid-method", "Evaluator prewrote disconnected commits; raw actor transcript was omitted, so the manual override is not reproducible."];
  if (recordId.endsWith("-r4")) return ["invalid-provenance-runner-boundary", "r4 redacted model identity to a placeholder and did not prove bounded owned-process-tree cleanup; it is ineligible evidence."];
  if (record.arm === "M0" && record.outcome === "invalid") return ["invalid-production", "Public Windows initialization is unsupported and target failure was not exercised."];
  if (record.outcome !== "complete") return ["invalid-run", `${recordId.match(/-(r\d+)$/u)?.[1] ?? "run"} outcome ${record.outcome} is not eligible comparative evidence.`];
  if (record.arm === "M0") return ["invalid-production", "Public Windows initialization is unsupported and target failure was not exercised."];
  const suffix = recordId.match(/-(r[^-]+)$/u)?.[1] ?? null;
  let futureLabel = null;
  if (suffix) try { futureLabel = parseFutureRunLabel(suffix); } catch { /* handled below for v4-like identities */ }
  if (futureLabel && (record.schema_version !== "4" || record.scoring?.scorer_version !== "case-eval-v4.0.0")) {
    return ["invalid-method", "r7-or-later records require schema 4 and case-eval-v4.0.0."];
  }
  if (record.schema_version === "4" && !futureLabel) return ["invalid-method", "Schema 4 requires a canonical r7-or-later record ID suffix."];
  if (recordId.endsWith("-r5")) return ["eligible-post-pilot-r5", "Method-frozen r5 observation; still not preregistered comparative evidence."];
  if (["3", "4"].includes(record.schema_version) && record.arm === "B0") {
    const adjudication = adjudicateRecord(record);
    const label = recordId.match(/-(r\d+)$/u)?.[1] ?? "future";
    if (label === "r6" && adjudication.eligible) return ["eligible-post-pilot-r6", "Post-hoc deterministic adjudicator reproduced the method-frozen r6 detection from immutable trace and verdict evidence; still not preregistered comparative evidence."];
    return adjudication.eligible
      ? ["eligible-post-pilot", `Deterministic adjudication reproduced a grounded ${adjudication.detected ? "detection" : "false-success"} from immutable trace and verdict evidence; still not preregistered comparative evidence.`]
      : ["invalid-run", `${label} deterministic adjudication failed: ${adjudication.reason}`];
  }
  return ["eligible-post-pilot", "Post-pilot amended observation; not preregistered comparative evidence."];
}

export function applyLiveAdjudication(record) {
  if (record.arm !== "B0" || record.outcome !== "complete") return record;
  const adjudication = adjudicateRecord(record);
  const [status] = statusForRecord(record);
  const eligible = status.startsWith("eligible-");
  if (record.false_success && !record.detected && eligible && adjudication.eligible && adjudication.false_success) return record;
  if (record.detected && !record.false_success && eligible && adjudication.eligible && adjudication.detected) return record;
  return {
    ...record,
    detected: false,
    false_success: false,
    outcome: "failed",
    reason: `Live deterministic adjudication rejected the terminal verdict: ${adjudication.reason}`,
    scoring: {
      ...record.scoring,
      adjudication: `${record.scoring.adjudication} Live pre-persistence adjudication rejected eligibility: ${adjudication.reason}`,
    },
  };
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
