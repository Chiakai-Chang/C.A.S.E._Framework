import { randomUUID } from 'node:crypto';

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
If necessary source material is missing and a valid plan cannot be made, return instead {"blocked":{"reason":"the specific missing material and why it is necessary"}}. Do not invent inputs or submit empty deliverables to represent a blocker.
Use the fewest useful packets. No cycles, no absolute paths, no executable plans. Do not do the work yet.
Inspect project materials with read tools if needed. You cannot change the user's goal or authority.`;

export async function runCase({ store, caseId, runSession, signal, maxContextChars = 48000, onProgress = () => {} }) {
  let state = store.get(caseId);
  if (state.status === 'completed') return { state, run: null };
  if (state.status === 'cancelled') throw error('CANCELLED', 'Case is cancelled');
  // A running attempt may still own real side effects. Do not steal it on resume.
  if (state.packets.some(p => p.status === 'running')) throw error('ACTIVE_ATTEMPT', 'Inspect and stop the active attempt before recovery');
  const previous = store.listRuns(caseId);
  const started = Date.now();
  const previousMs = previous.reduce((sum, r) => sum + (r.elapsedMs ?? 0), 0);
  const previousSessions = previous.reduce((sum, r) => sum + r.sessions.length, 0);
  const duration = state.contract.budget.maxDurationMs - previousMs;
  if (duration <= 0) throw error('BUDGET_EXCEEDED', 'Total workflow time budget exhausted');
  const run = { id: randomUUID(), createdAt: new Date().toISOString(), status: 'running', sessions: [], elapsedMs: 0 };
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
        statsError: evidence.statsError ?? null,
      });
      record.error = { code: failure.code ?? 'SESSION_FAILED', message: failure.message };
      save();
      throw failure;
    }
  };
  try {
    save();
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
    while (state.packets.some(p => p.status !== 'verified')) {
      const packet = state.packets.find(p => p.status === 'submitted')
        ?? state.packets.find(p => ['ready', 'planned'].includes(p.status) && p.dependsOn.every(id => state.packets.find(dep => dep.id === id)?.status === 'verified'));
      if (!packet) throw error('BLOCKED', 'No runnable packet; inspect findings or dependencies before retry');
      if (packet.status !== 'submitted') {
        const prompt = store.context(caseId, packet.id, { maxChars: maxContextChars });
        const findings = packet.attempts.at(-1)?.review?.findings ?? [];
        const worker = await invoke('worker', `${prompt}\nPrior review findings: ${JSON.stringify(findings)}\nPerform this packet only. Preserve source constraints. Write the declared deliverables, then return JSON {"summary":"what changed"}. Do not claim independent verification.`, {
          writeScope: packet.writeScope,
          onStart: sessionId => dispatch({ type: 'start', packetId: packet.id, sessionId }),
        });
        const attempt = state.packets.find(p => p.id === packet.id).attempts.at(-1);
        const reply = parseReply(worker.text);
        dispatch({ type: 'submit', packetId: packet.id, attemptId: attempt.id, summary: reply.summary });
      }
      const current = state.packets.find(p => p.id === packet.id);
      const attempt = current.attempts.at(-1);
      // Deliberately exclude worker narration; verification must examine actual files.
      const reviewPrompt = `Independently verify actual deliverables using read/check tools. Do not edit files.\nContract: ${JSON.stringify(state.contract)}\nPacket: ${JSON.stringify({
        id: current.id, purpose: current.purpose, inputs: current.inputs, deliverables: current.deliverables, checks: current.checks,
      })}\nReturn JSON {"passed":true|false,"findings":["specific issues"],"evidence":"actual observations and checks, including untested limits"}.`;
      const review = await invoke('reviewer', reviewPrompt);
      const decision = parseReply(review.text);
      dispatch({ type: 'review', packetId: packet.id, attemptId: attempt.id, sessionId: review.sessionId,
        passed: decision.passed, findings: decision.findings, evidence: decision.evidence });
      if (decision.passed !== true) {
        const attempts = state.packets.find(p => p.id === packet.id).attempts;
        const repeated = attempts.length > 1 && JSON.stringify(attempts.at(-2)?.review?.findings) === JSON.stringify(decision.findings);
        if (attempts.length >= 3 || repeated || !decision.findings.length) {
          throw error('REVIEW_FAILED', 'Review rejected the deliverable; repair limit or repeated findings require a changed approach');
        }
        dispatch({ type: 'retry', packetId: packet.id, reason: `Independent review: ${JSON.stringify(decision.findings)}` });
      }
    }
    const acceptanceIds = state.contract.acceptance.map(c => c.id);
    const shape = { results: acceptanceIds.map(criterionId => ({ criterionId, passed: true, evidence: 'actual check; set passed false if unmet' })), summary: 'overall result and limits' };
    const integrationPrompt = `Verify the whole goal and actual outputs, not just packet pass statuses. Do not edit files.\nContract: ${JSON.stringify(state.contract)}\nDeliverables: ${JSON.stringify(state.packets.map(p => ({ id: p.id, deliverables: p.deliverables, checks: p.checks })))}\nAcceptance IDs (exactly one result each): ${JSON.stringify(acceptanceIds)}. Do not add constraint IDs to results. Constraints must still be checked. Return only this JSON shape with your actual findings: ${JSON.stringify(shape)}.`;
    let correction = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const integrated = await invoke('integrator', integrationPrompt + correction);
      try {
        const decision = parseReply(integrated.text);
        if (Array.isArray(decision.results) && decision.results.some(result => result?.passed === false)) {
          throw error('INTEGRATION_REJECTED', 'Integrator reported failed acceptance; inspect the preserved findings and repair the outputs before another integration');
        }
        if (!Array.isArray(decision.results) || typeof decision.summary !== 'string') throw error('INVALID_REPLY', 'Integration reply requires results and summary');
        dispatch({ type: 'integrate', sessionId: integrated.sessionId, results: decision.results, summary: decision.summary });
        if (state.status !== 'completed') throw error('INTEGRATION_INCOMPLETE', 'Integration did not complete the case');
        break;
      } catch (failure) {
        run.sessions.at(-1).validationError = { code: failure.code ?? 'INVALID_REPLY', message: failure.message };
        save();
        if (attempt > 0 || !['ACCEPTANCE_INCOMPLETE', 'INVALID_REPLY'].includes(failure.code)) throw failure;
        correction = `\nThe previous integration reply was rejected: ${failure.code}: ${failure.message}. Recheck actual outputs in this fresh session. Return exactly the acceptance IDs ${JSON.stringify(acceptanceIds)}, excluding constraint IDs. Correct the reply; do not rerun workers or assume acceptance passed.`;
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
