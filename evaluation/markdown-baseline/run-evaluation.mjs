import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

import {
  accumulateTokenUsage,
  applyLiveAdjudication,
  atomicPersistRecord,
  buildEvaluatorEnvironment,
  EvaluationTimeoutError,
  executeRunPlans,
  fetchJsonWithDeadline,
  redactLocalDetails,
  requireCompletedCommand,
  runChildWithDeadline,
  classifyM0ProcessResult,
  createPublicationGate,
  injectSingleB0,
  scoreConcurrentPublication,
  validateRecordSemantics,
} from "./runner-lib.mjs";

const root = resolve(import.meta.dirname, "../..");
const endpoint = "http://127.0.0.1:8080/v1/chat/completions";
const runLabel = "r6";
const scorerVersion = "case-eval-v3.0.0";
const childTimeoutMs = 30_000;
const fetchTimeoutMs = 120_000;
const os = `${process.platform} ${process.arch} ${process.version}`;
const serverDescription = "llama.cpp 127.0.0.1:8080; ctx=262144; parallel=1; draft-mtp strict n=3 p-min=0.60; ROCmFP4 Strix Lean";
const serverExecutable = "D:\\MyProject\\ROCmFPX\\build-win-hip-ninja\\bin\\llama-server.exe";
const serverConfigId = "llama.cpp-rocmfp4-strix-ctx262144-p1-fa-b2048-ub1024-mtp-strict-n3-pmin060-froggeric-v22.4-deepseek-preserve";
const cases = [
  ["EVAL-M0-001", "same-version-double-writer.md"],
  ["EVAL-M0-002", "stale-handoff-after-intervening-work.md"],
  ["EVAL-M0-003", "accepted-artifact-changed.md"],
  ["EVAL-M0-004", "evidence-digest-mismatch.md"],
];

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

const protocolRevision = argument("--protocol-revision");
if (!protocolRevision || !/^[0-9a-f]{40}$/u.test(protocolRevision)) throw new Error("--protocol-revision requires the frozen 40-character method commit");
const resultsDirectory = resolve(argument("--results-dir") ?? join(import.meta.dirname, "results"));
const selectedCase = argument("--case");
if (selectedCase && !cases.some(([caseId]) => caseId === selectedCase)) throw new Error(`unknown --case ${selectedCase}`);

const redactionOptions = { roots: [root], usernames: [process.env.USERNAME, process.env.USER].filter(Boolean) };

function safe(value) {
  return redactLocalDetails(value, redactionOptions);
}

async function run(command, args, cwd, env = buildEvaluatorEnvironment(), timeoutMs = childTimeoutMs) {
  const cliPath = join(root, "dist", "src", "cli", "main.js");
  if (command !== "git" && !(command === process.execPath && resolve(args[0] ?? "") === cliPath)) throw new Error(`command outside closed evaluator executable allowlist: ${command}`);
  const result = await runChildWithDeadline(command, args, { cwd, env, timeoutMs });
  return { ...result, stdout: safe(result.stdout), stderr: safe(result.stderr) };
}

async function runGit(cwd, args, timeoutMs = childTimeoutMs) {
  return run("git", ["--no-pager", "-c", `safe.directory=${root}`, "-c", `safe.directory=${cwd}`, "-c", "user.name=CASE Evaluation", "-c", "user.email=case-eval@example.invalid", "-c", `core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`, "-c", "commit.gpgSign=false", "-c", "tag.gpgSign=false", "-c", "credential.helper=", ...args], cwd, buildEvaluatorEnvironment(process.env, {
    GIT_AUTHOR_DATE: "2026-09-05T00:00:00Z",
    GIT_COMMITTER_DATE: "2026-09-05T00:00:00Z",
  }), timeoutMs);
}

function remaining(deadlineAt, cap = childTimeoutMs) {
  const value = deadlineAt - Date.now();
  if (value <= 0) throw new EvaluationTimeoutError("absolute 10-minute case deadline exceeded");
  return Math.min(cap, value);
}

async function readWithinDeadline(path, deadlineAt, encoding = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining(deadlineAt));
  try {
    return await readFile(path, { encoding, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new EvaluationTimeoutError(`read ${basename(path)}: command deadline exceeded`);
    throw error;
  } finally { clearTimeout(timer); }
}

async function writeWithinDeadline(path, content, deadlineAt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining(deadlineAt));
  try {
    await writeFile(path, content, { encoding: "utf8", signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new EvaluationTimeoutError(`write ${basename(path)}: command deadline exceeded`);
    throw error;
  } finally { clearTimeout(timer); }
}

function must(result, label) {
  requireCompletedCommand(result, label);
  if (result.exit_code !== 0) throw new Error(`${label}: ${result.stderr || result.stdout}`);
  return result;
}

async function gitText(cwd, args, label, deadlineAt = null) {
  return must(await runGit(cwd, args, deadlineAt === null ? childTimeoutMs : remaining(deadlineAt)), label).stdout.trim();
}

async function initialize(caseId, deadlineAt) {
  const repository = await mkdtemp(join(tmpdir(), `case-eval-${caseId.toLowerCase()}-`));
  must(await runGit(repository, ["init", "--quiet"], remaining(deadlineAt)), "git init");
  await writeWithinDeadline(join(repository, "artifact.txt"), "v1\n", deadlineAt);
  await writeWithinDeadline(join(repository, "CASE.md"), `# ${caseId}\n\nstatus: prepared\n`, deadlineAt);
  must(await runGit(repository, ["add", "artifact.txt", "CASE.md"], remaining(deadlineAt)), "git add");
  must(await runGit(repository, ["commit", "--quiet", "-m", "fixture base"], remaining(deadlineAt)), "git commit");
  const revision = await gitText(repository, ["rev-parse", "HEAD"], "fixture revision", deadlineAt);
  return { repository, revision };
}

function addTrace(partial, actor, command, result) {
  partial.command_trace.push({
    sequence: partial.command_trace.length + 1,
    actor,
    command,
    exit_code: result.exit_code,
    result: `${result.stdout}${result.stderr}`.trim() || "(no output)",
    timed_out: Boolean(result.timed_out),
  });
  return result;
}

async function traceManualCommand(partial, actor, command, operation) {
  try {
    const result = await operation();
    addTrace(partial, actor, command, result);
    return requireCompletedCommand(result, command);
  } catch (error) {
    if (error instanceof EvaluationTimeoutError) addTrace(partial, actor, command, { exit_code: null, stdout: "", stderr: error.message, timed_out: true });
    throw error;
  }
}

async function artifactProvenance(path) {
  const metadata = await stat(path);
  const hash = createHash("sha256");
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", rejectPromise);
    stream.once("end", resolvePromise);
  });
  return { basename: basename(path), sha256: hash.digest("hex"), size_bytes: metadata.size };
}

async function modelInventory() {
  const { response, body } = await fetchJsonWithDeadline("http://127.0.0.1:8080/v1/models", {}, 10_000);
  if (!response.ok) throw new Error(`model inventory HTTP ${response.status}`);
  const rawPath = body.data?.[0]?.id ?? body.models?.[0]?.model;
  if (typeof rawPath !== "string" || !rawPath) throw new Error("model inventory omitted an artifact path");
  return { id: basename(rawPath), request_id: rawPath, artifact: await artifactProvenance(rawPath) };
}

async function complete(model, messages, timeoutMs = fetchTimeoutMs) {
  const { response, body } = await fetchJsonWithDeadline(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, temperature: 0, max_tokens: 1800, reasoning_effort: "low", messages }),
  }, timeoutMs);
  if (!response.ok) throw new Error(`completion HTTP ${response.status}: ${JSON.stringify(body)}`);
  return {
    content: body.choices?.[0]?.message?.content ?? "",
    input: Number.isInteger(body.usage?.prompt_tokens) ? body.usage.prompt_tokens : null,
    output: Number.isInteger(body.usage?.completion_tokens) ? body.usage.completion_tokens : null,
  };
}

function environment(provenance, fixtureRevision, tokensAvailable, cliCommit) {
  const verified = Boolean(provenance?.model?.artifact && provenance?.server);
  return {
    os,
    node: process.version,
    cli_commit: cliCommit,
    fixture_revision: fixtureRevision,
    protocol_revision: protocolRevision,
    model: provenance?.model?.id ?? "unavailable",
    server: serverDescription,
    sampling: "temperature=0; max_tokens=1800; reasoning_effort=low; seed unavailable",
    token_accounting: tokensAvailable ? "reported" : "unavailable",
    provenance_status: verified ? "verified" : "unavailable",
    model_artifact: provenance?.model?.artifact ?? null,
    server_build: verified ? { ...provenance.server, config_id: serverConfigId } : null,
  };
}

async function prepareSingleB0(caseId, repository, baseRevision, deadlineAt) {
  if (caseId === "EVAL-M0-002") {
    await writeWithinDeadline(join(repository, "CASE.md"), `# ${caseId}\n\nhandoff_from: actor-a\nhandoff_to: actor-b\noffer_basis: ${baseRevision}\nstatus: offered\n`, deadlineAt);
    must(await runGit(repository, ["add", "CASE.md"], remaining(deadlineAt)), "offer add");
    must(await runGit(repository, ["commit", "--quiet", "-m", "record handoff offer"], remaining(deadlineAt)), "offer commit");
    return;
  }
  const digest = createHash("sha256").update("v1\n", "utf8").digest("hex");
  const key = caseId === "EVAL-M0-003" ? "accepted_artifact_sha256" : "evidence_artifact_sha256";
  await writeWithinDeadline(join(repository, "CASE.md"), `# ${caseId}\n\n${key}: ${digest}\nstatus: ${caseId === "EVAL-M0-003" ? "accepted" : "evidence-current"}\n`, deadlineAt);
  must(await runGit(repository, ["add", "CASE.md"], remaining(deadlineAt)), "record add");
  must(await runGit(repository, ["commit", "--quiet", "-m", "record v1 basis"], remaining(deadlineAt)), "record commit");
}

async function singleActorCommand(repository, command, partial, deadlineAt) {
  let result;
  if (command === "read CASE.md") return traceManualCommand(partial, "actor-b", command, async () => ({ exit_code: 0, stdout: await readWithinDeadline(join(repository, "CASE.md"), deadlineAt, "utf8"), stderr: "", timed_out: false }));
  else if (command === "read artifact.txt") return traceManualCommand(partial, "actor-b", command, async () => ({ exit_code: 0, stdout: await readWithinDeadline(join(repository, "artifact.txt"), deadlineAt, "utf8"), stderr: "", timed_out: false }));
  else if (command === "git rev-parse HEAD") result = await runGit(repository, ["rev-parse", "HEAD"], remaining(deadlineAt));
  else if (command === "git log --oneline --decorate -4") result = await runGit(repository, ["log", "--oneline", "--decorate", "-4"], remaining(deadlineAt));
  else if (command === "git diff -- artifact.txt") result = await runGit(repository, ["diff", "--no-ext-diff", "--no-textconv", "--", "artifact.txt"], remaining(deadlineAt));
  else if (command === "sha256 artifact.txt") return traceManualCommand(partial, "actor-b", command, async () => ({ exit_code: 0, stdout: `${createHash("sha256").update(await readWithinDeadline(join(repository, "artifact.txt"), deadlineAt)).digest("hex")}  artifact.txt\n`, stderr: "", timed_out: false }));
  else throw new Error(`actor-b requested command outside allowlist: ${command}`);
  addTrace(partial, "actor-b", command, result);
  return requireCompletedCommand(result, command);
}

async function runSingleB0(provenance, cliCommit, caseId, caseFile, partial) {
  const started = new Date();
  const deadlineAt = started.getTime() + 600_000;
  const { repository, revision } = await initialize(caseId, deadlineAt);
  partial.fixture_revision = revision;
  try {
    await prepareSingleB0(caseId, repository, revision, deadlineAt);
    const caseText = await readWithinDeadline(join(import.meta.dirname, "cases", caseFile), deadlineAt, "utf8");
    const allowed = ["read CASE.md", "read artifact.txt", "git rev-parse HEAD", "git log --oneline --decorate -4", "git diff -- artifact.txt", "sha256 artifact.txt"];
    const messages = [
      { role: "system", content: `You are actor-b. Audit using your own command choices. Reply only JSON: {"action":"command","command":"one allowed command"}, {"action":"ready"}, or {"action":"final","verdict":"DETECTED|SUCCESS|FAILED","evidence":"concrete observed evidence"}. Before ready, observe at least one basis fact. After ready, an external event occurs; observe again before final. Allowed: ${allowed.join("; ")}.` },
      { role: "user", content: `${caseText}\n\nThe frozen basis is prepared. Select your first observation command.` },
    ];
    let ready = false;
    let preCommands = 0;
    let postCommands = 0;
    partial.tokens_available = true;
    let verdict = null;
    for (let turn = 1; turn <= 20 && !verdict; turn += 1) {
      const response = await complete(provenance.model.request_id, messages, remaining(deadlineAt, fetchTimeoutMs));
      partial.actor_outputs.push({ actor: "actor-b", content: `turn ${turn}: ${response.content || "(empty model response)"}` });
      accumulateTokenUsage(partial, response);
      const action = parseActorAction(response.content);
      messages.push({ role: "assistant", content: response.content });
      if (action.action === "ready") {
        if (ready || preCommands < 1) throw new Error("actor-b declared ready without a prior basis observation");
        ready = true;
        await injectSingleB0({
          caseId, repository, partial, deadlineAt, runGit, remaining,
          writeArtifact: (target, cutoff) => writeWithinDeadline(join(target, "artifact.txt"), "v2\n", cutoff),
        });
        messages.push({ role: "user", content: "The scheduled external event occurred. Continue auditing with allowed observations before a final verdict." });
      } else if (action.action === "command") {
        const result = await singleActorCommand(repository, action.command, partial, deadlineAt);
        if (ready) postCommands += 1; else preCommands += 1;
        messages.push({ role: "user", content: `Audited result: exit=${result.exit_code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}\nChoose the next action.` });
      } else {
        if (!ready || postCommands < 1) throw new Error("actor-b finalized before the injected event was independently observed");
        verdict = { actor: "actor-b", verdict: action.verdict, evidence: action.evidence };
      }
    }
    if (!verdict) throw new Error("actor-b reached the 20-turn limit");
    const detected = verdict.verdict === "DETECTED";
    const falseSuccess = verdict.verdict === "SUCCESS";
    const ended = new Date();
    return {
      schema_version: "3", record_id: `20260905-qwen-b0-${caseId.toLowerCase()}-${runLabel}`, arm: "B0", case_id: caseId,
      detected, false_success: falseSuccess, user_decisions: 0, commands: partial.command_trace.length,
      elapsed_ms: ended - started, input_tokens: partial.tokens_available ? partial.input_tokens_total : null, output_tokens: partial.tokens_available ? partial.output_tokens_total : null,
      corrections: 0, recovery_steps: 0, outcome: detected || falseSuccess ? "complete" : "failed",
      reason: detected ? "Actor explicitly detected the injected stale relation." : falseSuccess ? "Actor claimed success while the injected stale relation remained." : "Actor produced no gradeable terminal verdict.",
      started_at: started.toISOString(), ended_at: ended.toISOString(),
      environment: environment(provenance, revision, partial.tokens_available, cliCommit), command_trace: partial.command_trace,
      actor_outputs: partial.actor_outputs,
      scoring: { scorer_version: scorerVersion, verdict_transcript: [verdict], adjudication: `Deterministic terminal-line scorer classified ${verdict.verdict}; the frozen case defines DETECTED as detection and SUCCESS as false success.` },
    };
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
}

function parseActorAction(content) {
  const fenced = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/u)?.[1];
  const candidate = fenced ?? content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
  let parsed;
  try { parsed = JSON.parse(candidate); } catch { throw new Error(`actor returned non-JSON action: ${content}`); }
  if (parsed.action === "command" && typeof parsed.command === "string") return parsed;
  if (parsed.action === "ready") return parsed;
  if (parsed.action === "final" && ["DETECTED", "SUCCESS", "FAILED"].includes(parsed.verdict) && typeof parsed.evidence === "string") return parsed;
  throw new Error(`actor returned invalid action: ${content}`);
}

async function actorCommand(actor, repository, command, gate, partial, deadlineAt) {
  if (partial.command_trace.length >= 30) throw new Error("case reached the 30-command limit");
  let result;
  if (command === "read CASE.md") return traceManualCommand(partial, actor, command, async () => ({ exit_code: 0, stdout: await readWithinDeadline(join(repository, "CASE.md"), deadlineAt, "utf8"), stderr: "", timed_out: false }));
  else if (command === "read artifact.txt") return traceManualCommand(partial, actor, command, async () => ({ exit_code: 0, stdout: await readWithinDeadline(join(repository, "artifact.txt"), deadlineAt, "utf8"), stderr: "", timed_out: false }));
  else if (command === "git rev-parse HEAD") result = await runGit(repository, ["rev-parse", "HEAD"], remaining(deadlineAt));
  else if (command === "git status --short") result = await runGit(repository, ["status", "--short"], remaining(deadlineAt));
  else if (command === "edit artifact.txt") {
    return traceManualCommand(partial, actor, command, async () => {
      const current = await readWithinDeadline(join(repository, "artifact.txt"), deadlineAt, "utf8");
      await writeWithinDeadline(join(repository, "artifact.txt"), `${current}${actor}\n`, deadlineAt);
      return { exit_code: 0, stdout: `appended ${actor}\n`, stderr: "", timed_out: false };
    });
  } else if (command === "git diff -- artifact.txt") result = await runGit(repository, ["diff", "--no-ext-diff", "--no-textconv", "--", "artifact.txt"], remaining(deadlineAt));
  else if (command === "git add artifact.txt") result = await runGit(repository, ["add", "artifact.txt"], remaining(deadlineAt));
  else if (command === "git commit") result = await runGit(repository, ["commit", "--quiet", "-m", `${actor} result`], remaining(deadlineAt));
  else if (command === "git publish") return requireCompletedCommand(await gate.request(actor, repository), command);
  else if (command === "git fetch origin") result = await runGit(repository, ["fetch", "--quiet", "origin"], remaining(deadlineAt));
  else if (command === "git rev-parse origin/published") result = await runGit(repository, ["rev-parse", "origin/published"], remaining(deadlineAt));
  else if (command === "git show origin/published:artifact.txt") result = await runGit(repository, ["show", "origin/published:artifact.txt"], remaining(deadlineAt));
  else throw new Error(`${actor} requested command outside allowlist: ${command}`);
  addTrace(partial, actor, command, result);
  return requireCompletedCommand(result, command);
}

async function runActor(provenance, actor, repository, basis, caseText, gate, partial, deadlineAt) {
  const allowed = ["read CASE.md", "read artifact.txt", "git rev-parse HEAD", "git status --short", "edit artifact.txt", "git diff -- artifact.txt", "git add artifact.txt", "git commit", "git publish", "git fetch origin", "git rev-parse origin/published", "git show origin/published:artifact.txt"];
  const messages = [
    { role: "system", content: `You are ${actor}, one of two independent evaluation actors. Choose and execute the work yourself. Reply with only JSON: {"action":"command","command":"one exact allowed command"} or {"action":"final","verdict":"DETECTED|SUCCESS|FAILED","evidence":"concrete command evidence"}. Allowed commands: ${allowed.join("; ")}. Do not claim success before publishing and observing the shared published ref.` },
    { role: "user", content: `${caseText}\n\nYour actor label: ${actor}\nCommon basis supplied before either actor may edit: ${basis}\nBegin by selecting an allowed observation or mutation command.` },
  ];
  const outputs = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let tokensAvailable = true;
  for (let turn = 1; turn <= 20; turn += 1) {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) throw new Error(`${actor} reached the 10-minute deadline`);
    const response = await complete(provenance.model.request_id, messages, Math.min(fetchTimeoutMs, remainingMs));
    outputs.push(`turn ${turn}: ${response.content || "(empty model response)"}`);
    partial.actor_outputs.push({ actor, content: `turn ${turn}: ${response.content || "(empty model response)"}` });
    if (response.input === null || response.output === null) {
      tokensAvailable = false;
      partial.tokens_available = false;
    } else {
      inputTokens += response.input;
      outputTokens += response.output;
      partial.input_tokens_total = (partial.input_tokens_total ?? 0) + response.input;
      partial.output_tokens_total = (partial.output_tokens_total ?? 0) + response.output;
    }
    const action = parseActorAction(response.content);
    messages.push({ role: "assistant", content: response.content });
    if (action.action === "final") {
      return { actor, content: outputs.join("\n"), verdict: { actor, verdict: action.verdict, evidence: action.evidence }, inputTokens, outputTokens, tokensAvailable };
    }
    const result = await actorCommand(actor, repository, action.command, gate, partial, deadlineAt);
    messages.push({ role: "user", content: `Audited result for ${action.command}: exit=${result.exit_code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}\nSelect the next command or final verdict.` });
  }
  throw new Error(`${actor} reached the 20-turn limit`);
}

async function runConcurrentB0(provenance, cliCommit, partial) {
  const caseId = "EVAL-M0-001";
  const started = new Date();
  const deadlineAt = started.getTime() + 600_000;
  const { repository: source, revision } = await initialize(caseId, deadlineAt);
  partial.fixture_revision = revision;
  const parent = await mkdtemp(join(tmpdir(), "case-eval-r6-writers-"));
  const origin = join(parent, "origin.git");
  const actorA = join(parent, "actor-a");
  const actorB = join(parent, "actor-b");
  const gate = createPublicationGate(partial, deadlineAt, { runGit, remaining, sanitize: safe, waitCapMs: fetchTimeoutMs });
  try {
    must(await runGit(parent, ["clone", "--quiet", "--bare", source, origin], remaining(deadlineAt)), "create shared bare origin");
    must(await runGit(source, ["remote", "add", "shared", origin], remaining(deadlineAt)), "add shared origin");
    must(await runGit(source, ["push", "--quiet", "shared", `HEAD:refs/heads/published`], remaining(deadlineAt)), "seed published ref");
    must(await runGit(parent, ["clone", "--quiet", origin, actorA], remaining(deadlineAt)), "clone actor-a");
    must(await runGit(parent, ["clone", "--quiet", origin, actorB], remaining(deadlineAt)), "clone actor-b");
    const caseText = await readWithinDeadline(join(import.meta.dirname, "cases", "same-version-double-writer.md"), deadlineAt, "utf8");
    const settled = await Promise.allSettled([
      runActor(provenance, "actor-a", actorA, revision, caseText, gate, partial, deadlineAt),
      runActor(provenance, "actor-b", actorB, revision, caseText, gate, partial, deadlineAt),
    ]);
    if (settled.some((item) => item.status === "rejected")) {
      gate.abort("peer actor failed before the shared publication gate completed");
      throw new Error(settled.map((item) => item.status === "rejected" ? safe(String(item.reason)) : `${item.value.actor} completed`).join("; "));
    }
    const actors = settled.map((item) => item.value);
    const tokensAvailable = actors.every((actor) => actor.tokensAvailable);
    const inputTokens = tokensAvailable ? actors.reduce((sum, actor) => sum + actor.inputTokens, 0) : null;
    const outputTokens = tokensAvailable ? actors.reduce((sum, actor) => sum + actor.outputTokens, 0) : null;
    const publishTrace = partial.command_trace.filter((entry) => entry.command === "git publish origin HEAD:refs/heads/published");
    const verdicts = actors.map((actor) => actor.verdict);
    const score = scoreConcurrentPublication(publishTrace, verdicts);
    const { winners, losers, detected, false_success: falseSuccess } = score;
    const ended = new Date();
    return {
      schema_version: "3", record_id: `20260905-qwen-b0-${caseId.toLowerCase()}-${runLabel}`, arm: "B0", case_id: caseId,
      detected, false_success: falseSuccess, user_decisions: 0, commands: partial.command_trace.length,
      elapsed_ms: ended - started, input_tokens: inputTokens, output_tokens: outputTokens,
      corrections: 0, recovery_steps: 0, outcome: score.outcome,
      reason: detected ? "Exactly one shared publication succeeded and the losing model actor explicitly detected that conflict." : falseSuccess ? "Shared publication or losing-actor verdict violated the frozen single-winner rule." : "The actors completed without a gradeable detection or false-success outcome.",
      started_at: started.toISOString(), ended_at: ended.toISOString(),
      environment: environment(provenance, revision, tokensAvailable, cliCommit), command_trace: partial.command_trace,
      actor_outputs: partial.actor_outputs,
      scoring: { scorer_version: scorerVersion, verdict_transcript: verdicts, adjudication: `Shared publish winners=[${winners.join(",")}], losers=[${losers.join(",")}]. Detection requires exactly one winner and an explicit DETECTED verdict from the loser; a loser SUCCESS is false success.` },
    };
  } finally {
    gate.abort("run cleanup");
    await rm(source, { recursive: true, force: true });
    await rm(parent, { recursive: true, force: true });
  }
}

async function runM0(provenance, cliCommit, caseId, partial) {
  const started = new Date();
  const deadlineAt = started.getTime() + 600_000;
  const { repository, revision } = await initialize(caseId, deadlineAt);
  partial.fixture_revision = revision;
  try {
    const result = await run(process.execPath, [join(root, "dist", "src", "cli", "main.js"), "--json", "init", "--operation", `op-${caseId.toLowerCase()}-${runLabel}`], repository, buildEvaluatorEnvironment(), remaining(deadlineAt));
    addTrace(partial, "runner", `case-agent --json init --operation op-${caseId.toLowerCase()}-${runLabel}`, result);
    requireCompletedCommand(result, "M0 initialization");
    const ended = new Date();
    const classification = classifyM0ProcessResult(result);
    const { code, expected_unsupported: expected } = classification;
    const content = expected ? "No model actor invoked: public Windows initialization returned CASE_E_UNSUPPORTED_PROFILE before the target case." : `No model actor invoked: initialization exit=${result.exit_code}, code=${code}.`;
    return {
      schema_version: "3", record_id: `20260905-qwen-m0-${caseId.toLowerCase()}-${runLabel}`, arm: "M0", case_id: caseId,
      detected: false, false_success: false, user_decisions: 0, commands: partial.command_trace.length,
      elapsed_ms: ended - started, input_tokens: null, output_tokens: null, corrections: 0, recovery_steps: 0, outcome: classification.outcome,
      reason: expected ? "Public Windows CLI failed closed at initialization with CASE_E_UNSUPPORTED_PROFILE (exit 10); target failure not exercised." : `M0 could not start safely: exit=${result.exit_code}, code=${code}.`,
      started_at: started.toISOString(), ended_at: ended.toISOString(),
      environment: environment(provenance, revision, false, cliCommit), command_trace: partial.command_trace,
      actor_outputs: [{ actor: "runner", content }],
      scoring: { scorer_version: scorerVersion, verdict_transcript: [{ actor: "runner", verdict: "NONE", evidence: content }], adjudication: "Invalid production-platform initialization receives no detection or false-success credit." },
    };
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
}

const schema = JSON.parse(await readFile(join(import.meta.dirname, "results.schema.json"), "utf8"));
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const cliCommit = (await gitText(root, ["rev-parse", "HEAD"], "CLI commit"));
if (protocolRevision !== cliCommit) throw new Error(`--protocol-revision ${protocolRevision} does not match current frozen method commit ${cliCommit}`);
let provenance = null;
let modelFailure = null;
try {
  provenance = { model: await modelInventory(), server: await artifactProvenance(serverExecutable) };
} catch (error) { modelFailure = error; }

const chosen = selectedCase ? cases.filter(([caseId]) => caseId === selectedCase) : cases;
const plans = [...chosen.map(([caseId, caseFile]) => ({ arm: "B0", caseId, caseFile })), ...chosen.map(([caseId]) => ({ arm: "M0", caseId }))];

function failureRecord(plan, partial, error) {
  const ended = new Date();
  const started = partial.started_at ?? ended;
  const timeout = error instanceof EvaluationTimeoutError || /deadline|turn limit|timed out/i.test(String(error));
  const content = safe(String(error?.stack ?? error));
  return {
    schema_version: "3", record_id: `20260905-qwen-${plan.arm.toLowerCase()}-${plan.caseId.toLowerCase()}-${runLabel}`, arm: plan.arm, case_id: plan.caseId,
    detected: false, false_success: false, user_decisions: 0, commands: partial.command_trace.length,
    elapsed_ms: ended - started,
    input_tokens: partial.tokens_available === false ? null : partial.input_tokens_total ?? null,
    output_tokens: partial.tokens_available === false ? null : partial.output_tokens_total ?? null,
    corrections: 0, recovery_steps: 0, outcome: timeout ? "timeout" : "failed",
    reason: content, started_at: started.toISOString(), ended_at: ended.toISOString(),
    environment: environment(provenance, partial.fixture_revision ?? "unavailable-before-fixture", partial.tokens_available !== false && Number.isInteger(partial.input_tokens_total) && Number.isInteger(partial.output_tokens_total), cliCommit), command_trace: partial.command_trace,
    actor_outputs: partial.actor_outputs.length ? partial.actor_outputs : [{ actor: "runner", content }],
    scoring: { scorer_version: scorerVersion, verdict_transcript: [{ actor: "runner", verdict: "NONE", evidence: "Run did not reach a gradeable terminal verdict." }], adjudication: "Failure/timeout retained with partial trace and receives no detection or false-success credit." },
  };
}

const execution = await executeRunPlans(plans, {
  execute: async (plan, partial) => {
    partial.started_at = new Date();
    if (modelFailure) throw modelFailure;
    if (plan.arm === "M0") return runM0(provenance, cliCommit, plan.caseId, partial);
    if (plan.caseId === "EVAL-M0-001") return runConcurrentB0(provenance, cliCommit, partial);
    return runSingleB0(provenance, cliCommit, plan.caseId, plan.caseFile, partial);
  },
  makeFailure: failureRecord,
  finalize: applyLiveAdjudication,
  persist: async (record) => {
    const semanticErrors = validateRecordSemantics(record);
    if (!validateSchema(record) || semanticErrors.length) throw new Error(`refusing invalid record ${record.record_id}: ${JSON.stringify({ schema: validateSchema.errors, semantic: semanticErrors })}`);
    await atomicPersistRecord(resultsDirectory, record);
  },
  redactOptions: redactionOptions,
  onPersistenceFailure: (failure) => process.stderr.write(`${JSON.stringify({ terminal_failure: failure })}\n`),
});

if (execution.persistence_failures.length) process.exitCode = 1;
process.stdout.write(`${JSON.stringify({ run: runLabel, protocol_revision: protocolRevision, results_directory: basename(resultsDirectory), records: execution.records.map(({ record_id, outcome, detected, false_success }) => ({ record_id, outcome, detected, false_success })), persistence_failures: execution.persistence_failures }, null, 2)}\n`);
