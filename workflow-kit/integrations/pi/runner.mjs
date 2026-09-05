import { randomUUID } from 'node:crypto';
import { packetDefinition, attemptCount } from '../../skills/case-workflow/scripts/core/amendments.mjs';

function error(code, message) { return Object.assign(new Error(message), { code }); }

export function parseReply(text) {
  if (typeof text !== 'string') throw error('INVALID_REPLY', 'Expected a JSON object reply');
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  try {
    const result = JSON.parse(fenced ? fenced[1] : trimmed);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw error('INVALID_REPLY', 'Reply must be one complete JSON object without surrounding prose'); }
}

function parseWorkerReply(text) {
  try { return { decision: parseReply(text) }; }
  catch (failure) {
    // Only an explicit terminal feedback object can follow prose. Never extract
    // success, multiple objects, extra action keys, or a reply with trailing text.
    const match = typeof text === 'string' && /^[^{}\[\]]+\r?\n\s*(\{\s*"(blocked|changeRequest)"\s*:\s*\{\s*"reason"\s*:\s*("(?:[^"\\]|\\.)*")\s*\}\s*\})\s*$/.exec(text);
    if (!match) throw failure;
    const decision = parseReply(match[1]);
    if (!decision[match[2]].reason.trim()) throw failure;
    return { decision, normalization: {
      kind: 'terminal-worker-feedback', feedbackKind: match[2],
      skippedPrefixChars: text.indexOf(match[1]),
    } };
  }
}

export async function callSession(runSession, { onStart, ...input }) {
  if (input.signal?.aborted) throw error('CANCELLED', 'Operation cancelled before session start');
  let started;
  const reply = await runSession({ ...input, onStart: async sessionId => {
    if (started || typeof sessionId !== 'string' || !sessionId) throw error('SESSION_MISMATCH', 'Invalid or repeated session start');
    started = sessionId;
    await onStart?.(sessionId);
  } });
  const rejectReply = (code, message) => {
    throw Object.assign(error(code, message), { sessionEvidence: {
      text: reply?.text ?? '', usage: reply?.usage ?? 'unknown', observations: reply?.observations ?? [],
      rawFinalText: reply?.rawFinalText ?? null, resultTransport: reply?.resultTransport ?? 'unknown',
      model: reply?.model ?? null, toolCalls: reply?.toolCalls ?? 'unknown', cost: reply?.cost ?? 'unknown',
    } });
  };
  if (!started || reply?.sessionId !== started) rejectReply('SESSION_MISMATCH', 'Session identity changed or was not reported');
  if (input.signal?.aborted) rejectReply('CANCELLED', 'Operation cancelled');
  if (typeof reply.text !== 'string' || !reply.text.trim()) rejectReply('EMPTY_REPLY', 'Model returned no final text');
  return reply;
}

const plannerInstruction = `Return one JSON object {"packets":[...]}. Each packet has:
id, purpose, constraintIds (applicable constraint IDs), inputs:[{path,required}], dependsOn:[packet IDs],
writeScope:[relative file or directory paths], deliverables:[{path}],
checks:[{id,text,criterionIds:[global acceptance IDs]}], unknowns:[] .
Use existing relative input paths, no invented files. Every global acceptance criterion must be covered.
For long source material, use inputs with delivery:"indexed" and read it in bounded parts with read tools. Keep short mandatory rules inline (default delivery).
If necessary source material is missing and a valid plan cannot be made, return instead {"blocked":{"reason":"the specific missing material and why it is necessary"}}. Do not invent inputs or submit empty deliverables to represent a blocker.
Use the fewest useful packets. No cycles, no absolute paths, no executable plans. Do not do the work yet.
Inspect project materials with read tools if needed. You cannot change the user's goal or authority.`;

export async function runCase({ store, caseId, runSession, signal, maxContextChars = 48000, onProgress = () => {}, executeChecks = async () => [] }) {
  let state = store.get(caseId);
  if (state.status === 'completed') return { state, run: null };
  if (state.status === 'cancelled') throw error('CANCELLED', 'Case is cancelled');
  // A running attempt may still own real side effects. Do not steal it on resume.
  if (state.packets.some(p => p.status === 'running' || p.status === 'blocked' && p.attempts.at(-1)?.status === 'interrupted' && !p.attempts.at(-1).feedback)) throw error('ACTIVE_ATTEMPT', 'Inspect and stop the active attempt before recovery');
  const previous = store.listRuns(caseId);
  const lastRun = [...previous].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).at(-1);
  const started = Date.now();
  const previousMs = previous.reduce((sum, r) => sum + (r.elapsedMs ?? 0), 0);
  const previousSessions = previous.reduce((sum, r) => sum + r.sessions.length, 0);
  const duration = state.contract.budget.maxDurationMs - previousMs;
  if (duration <= 0) throw error('BUDGET_EXCEEDED', 'Total workflow time budget exhausted');
  const run = { id: randomUUID(), createdAt: new Date().toISOString(), status: 'running', sessions: [], elapsedMs: 0, pendingFeedback:lastRun?.pendingFeedback??null };
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort('time budget'), duration);
  const save = () => { run.elapsedMs = Date.now() - started; store.saveRun(caseId, run.id, run); };
  const dispatch = action => {
    state = store.dispatch(caseId, action, { expectedRevision: state.revision, requestId: randomUUID() });
    return state;
  };
  const invoke = async (role, prompt, extra = {}) => {
    if (prompt.length > maxContextChars) throw error('CONTEXT_TOO_LARGE', 'Required context exceeds configured character budget');
    if (previousSessions + run.sessions.length >= 3 * state.contract.budget.maxAttempts + 2) throw error('BUDGET_EXCEEDED', 'Total model session budget exhausted');
    const record = { role, status: 'starting', startedAt: new Date().toISOString(), usage: 'unknown' };
    run.sessions.push(record);
    save();
    onProgress({ role, status: 'starting' });
    try {
      const reply = await callSession(runSession, { role, prompt, signal: controller.signal, ...extra,
        onStart: async sessionId => {
          if (previous.some(r => r.sessions.some(s => s.sessionId === sessionId)) || run.sessions.some(s => s !== record && s.sessionId === sessionId)) {
            throw error('SESSION_REUSED', 'Each role invocation must use a fresh context');
          }
          record.sessionId = sessionId;
          save();
          await extra.onStart?.(sessionId);
        },
      });
      Object.assign(record, { status: 'returned', text: reply.text, usage: reply.usage ?? 'unknown',
        rawFinalText: reply.rawFinalText ?? null, resultTransport: reply.resultTransport ?? 'unknown',
        observations: reply.observations ?? [], model: reply.model ?? null, toolCalls: reply.toolCalls ?? 'unknown', cost: reply.cost ?? 'unknown' });
      save();
      return reply;
    } catch (failure) {
      record.status = 'failed';
      const evidence = failure.sessionEvidence;
      if (evidence) Object.assign(record, {
        usage: evidence.usage ?? 'unknown', observations: evidence.observations ?? [],
        model: evidence.model ?? null, toolCalls: evidence.toolCalls ?? 'unknown',
        cost: evidence.cost ?? 'unknown', text: evidence.text ?? '',
        rawFinalText: evidence.rawFinalText ?? null, resultTransport: evidence.resultTransport ?? 'unknown',
        statsError: evidence.statsError ?? null,
      });
      record.error = { code: failure.code ?? 'SESSION_FAILED', message: failure.message };
      save();
      throw failure;
    }
  };
  const blockedReason = decision => {
    if (!Object.hasOwn(decision, 'blocked')) return;
    const reason = decision.blocked?.reason;
    if (typeof reason !== 'string' || !reason.trim()) throw error('INVALID_REPLY', 'Blocked reply requires a non-empty reason');
    throw error('BLOCKED', reason);
  };
  const replan = async feedback => {
    run.pendingFeedback = feedback; save();
    const count = previous.reduce((n,r) => n + (r.replans ?? 0), 0) + (run.replans ?? 0);
    if (count >= 2) throw error('REPLAN_LIMIT', 'Automatic plan amendment limit exhausted');
    if (attemptCount(state) >= state.contract.budget.maxAttempts) throw error('BUDGET_EXCEEDED', 'Case attempt budget exhausted');
    run.replans = (run.replans ?? 0) + 1;
    run.feedback ??= []; run.feedback.push(feedback); save();
    const context = JSON.stringify({contract:state.contract,writeAuthority:state.contract.writeScope??state.planWriteScope??state.packets.flatMap(p=>p.writeScope),packets:state.packets.map(p=>({...packetDefinition(p),status:p.status,attempts:p.attempts.map(a=>({id:a.id,status:a.status,feedback:a.feedback??null,review:a.review??null}))})),feedback});
    const reply = await invoke('planner', `${plannerInstruction}\nRevise the entire existing plan within the unchanged contract and write authority. Return {"packets":[...],"rerunPacketIds":[],"reason":"specific change"} or blocked. Explicit rerun IDs may request actual rework after integration findings. Preserve valid independent work. Never weaken acceptance or budgets.\n${context}`);
    const decision = parseReply(reply.text); blockedReason(decision);
    dispatch({type:'amend_plan',packets:decision.packets,rerunPacketIds:decision.rerunPacketIds??[],reason:decision.reason});
    if (!state.packets.some(p=>p.status!=='verified')) throw error('NO_PLAN_CHANGE','Feedback requires actual work before another integration');
    run.pendingFeedback = null; save();
  };
  const checks = async (role, packetId) => {
    const results = await executeChecks({role,state:structuredClone(state),packetId,signal:controller.signal});
    if (!Array.isArray(results) || results.some(r=>!r || typeof r !== 'object' || Array.isArray(r))) throw error('INVALID_CHECK_RESULT','Checks must return an array of result objects');
    run.checks ??= []; run.checks.push({role,packetId:packetId??null,results,at:new Date().toISOString()}); save();
    return {results,failed:results.some(r=>r.error || r.exitCode !== 0)};
  };
  try {
    save();
    if(run.pendingFeedback) await replan(run.pendingFeedback);
    if (!state.packets.length) {
      const plan = await invoke('planner', `${plannerInstruction}\nContract:\n${JSON.stringify(state.contract)}`);
      const decision = parseReply(plan.text);
      if (Object.hasOwn(decision, 'blocked')) {
        const reason = decision.blocked?.reason;
        if (typeof reason !== 'string' || !reason.trim()) throw error('INVALID_REPLY', 'Planner blocked reply requires a non-empty reason');
        throw error('BLOCKED', reason);
      }
      dispatch({ type: 'plan', packets: decision.packets });
    }
    workflow: while (state.status !== 'completed') {
    while (state.packets.some(p => p.status !== 'verified')) {
      const external = state.packets.find(p=>p.status==='blocked' && p.attempts.at(-1)?.feedback?.kind==='blocked');
      if(external) throw error('BLOCKED', external.attempts.at(-1).feedback.reason);
      const packet = state.packets.find(p => p.status === 'submitted')
        ?? state.packets.find(p => ['ready', 'planned'].includes(p.status) && p.dependsOn.every(id => state.packets.find(dep => dep.id === id)?.status === 'verified'));
      if (!packet) { await replan({reason:'No runnable packet; inspect findings and dependencies'}); continue; }
      if (packet.status !== 'submitted') {
        const prompt = store.context(caseId, packet.id, { maxChars: maxContextChars });
        const findings = packet.attempts.at(-1)?.review?.findings ?? [];
        const worker = await invoke('worker', `${prompt}\nPrior review findings: ${JSON.stringify(findings)}\nPerform this packet only. Preserve source constraints. Write the declared deliverables, then return JSON {"summary":"what changed"}. If external material is missing return {"blocked":{"reason":"specific missing material"}}. If the plan needs a changed approach return {"changeRequest":{"reason":"specific necessary change"}}. Do not invent missing materials or claim independent verification.`, {
          writeScope: packet.writeScope,
          onStart: sessionId => dispatch({ type: 'start', packetId: packet.id, sessionId }),
        });
        const attempt = state.packets.find(p => p.id === packet.id).attempts.at(-1);
        const parsed = parseWorkerReply(worker.text);
        if (parsed.normalization) { run.sessions.at(-1).normalization = parsed.normalization; save(); }
        const reply = parsed.decision;
        if (Object.hasOwn(reply,'blocked') || Object.hasOwn(reply,'changeRequest')) {
          const kind = Object.hasOwn(reply,'blocked') ? 'blocked' : 'changeRequest';
          const reason = reply[kind]?.reason;
          if (typeof reason !== 'string' || !reason.trim()) throw error('INVALID_REPLY','Worker feedback requires a non-empty reason');
          dispatch({type:'block',packetId:packet.id,reason,feedback:{kind,reason}});
          if(kind==='blocked') throw error('BLOCKED',reason);
          await replan({packetId:packet.id,kind,reason}); continue;
        }
        dispatch({ type: 'submit', packetId: packet.id, attemptId: attempt.id, summary: reply.summary });
      }
      const current = state.packets.find(p => p.id === packet.id);
      const attempt = current.attempts.at(-1);
      const checked = await checks('reviewer', packet.id);
      // Deliberately exclude worker narration; verification must examine actual files.
      const reviewPrompt = `Independently verify actual deliverables using read/check tools. Do not edit files.\nContract: ${JSON.stringify(state.contract)}\nPacket: ${JSON.stringify({
        id: current.id, purpose: current.purpose, inputs: current.inputs, deliverables: current.deliverables, checks: current.checks,
      })}\nReturn JSON {"passed":true|false,"findings":["specific issues"],"evidence":"actual observations and checks, including untested limits"}.`;
      const review = await invoke('reviewer', reviewPrompt + `\nConfigured checks: ${JSON.stringify(checked.results)}`);
      const decision = parseReply(review.text);
      if (checked.failed) {
        decision.passed = false;
        decision.findings = [...(Array.isArray(decision.findings)?decision.findings:[]), `Configured checks failed: ${JSON.stringify(checked.results)}`];
        decision.evidence = {model:decision.evidence??null,checks:checked.results};
      }
      dispatch({ type: 'review', packetId: packet.id, attemptId: attempt.id, sessionId: review.sessionId,
        passed: decision.passed, findings: decision.findings, evidence: decision.evidence });
      if (decision.passed !== true) {
        const attempts = state.packets.find(p => p.id === packet.id).attempts;
        const repeated = attempts.length > 1 && JSON.stringify(attempts.at(-2)?.review?.findings) === JSON.stringify(decision.findings);
        if (attempts.length >= 3 || repeated || !decision.findings.length) {
          await replan({packetId:packet.id,reason:'Review repair limit or repeated findings require a changed approach',findings:decision.findings}); continue;
        }
        dispatch({ type: 'retry', packetId: packet.id, reason: `Independent review: ${JSON.stringify(decision.findings)}` });
      }
    }
    const acceptanceIds = state.contract.acceptance.map(c => c.id);
    const shape = { results: acceptanceIds.map(criterionId => ({ criterionId, passed: true, evidence: 'actual check; set passed false if unmet' })), summary: 'overall result and limits' };
    const integrationPrompt = `Verify the whole goal and actual outputs, not just packet pass statuses. Do not edit files.\nContract: ${JSON.stringify(state.contract)}\nDeliverables: ${JSON.stringify(state.packets.map(p => ({ id: p.id, deliverables: p.deliverables, checks: p.checks })))}\nAcceptance IDs (exactly one result each): ${JSON.stringify(acceptanceIds)}. Do not add constraint IDs to results. Constraints must still be checked. Return only this JSON shape with your actual findings: ${JSON.stringify(shape)}.`;
    let correction = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const checked = await checks('integrator');
      if(checked.failed) { await replan({reason:'Global configured checks failed',checks:checked.results}); continue workflow; }
      const integrated = await invoke('integrator', integrationPrompt + correction + `\nConfigured checks: ${JSON.stringify(checked.results)}`);
      let substantiveFailure = false;
      try {
        const decision = parseReply(integrated.text);
        if (Array.isArray(decision.results) && decision.results.some(result => result?.passed === false)) {
          substantiveFailure = true;
          run.sessions.at(-1).validationError = {code:'INTEGRATION_REJECTED',message:'Integrator reported failed acceptance'}; save();
          await replan({reason:'Integrator reported failed acceptance',results:decision.results,summary:decision.summary??''});
          continue workflow;
        }
        if (!Array.isArray(decision.results) || typeof decision.summary !== 'string') throw error('INVALID_REPLY', 'Integration reply requires results and summary');
        dispatch({ type: 'integrate', sessionId: integrated.sessionId, results: decision.results, summary: decision.summary });
        if (state.status !== 'completed') throw error('INTEGRATION_INCOMPLETE', 'Integration did not complete the case');
        break;
      } catch (failure) {
        if (substantiveFailure) throw failure;
        run.sessions.at(-1).validationError = { code: failure.code ?? 'INVALID_REPLY', message: failure.message };
        save();
        if (attempt > 0 || !['ACCEPTANCE_INCOMPLETE', 'INVALID_REPLY'].includes(failure.code)) throw failure;
        correction = `\nThe previous integration reply was rejected: ${failure.code}: ${failure.message}. Recheck actual outputs in this fresh session. Return exactly the acceptance IDs ${JSON.stringify(acceptanceIds)}, excluding constraint IDs. Correct the reply; do not rerun workers or assume acceptance passed.`;
      }
    }
    }
    run.status = 'completed';
    save();
    return { state, run };
  } catch (failure) {
    run.status = controller.signal.aborted ? 'cancelled' : 'failed';
    run.error = { code: failure.code ?? 'RUN_FAILED', message: failure.message };
    save();
    // A failed worker can have partial side effects. Preserve its attempt and require explicit recovery.
    failure.run = run;
    throw failure;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
