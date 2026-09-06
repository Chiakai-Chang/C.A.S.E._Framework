import { randomUUID } from 'node:crypto';
import { fail, need, text, digest, evidence } from './io.mjs';
import { contract, plan } from './contracts.mjs';
import { amendPlan, attemptCount } from './amendments.mjs';
import {reportDiscovery,resolveDiscoveries,reopenDiscovery,assertDiscoveriesResolved,assertDiscoveryLinks,packetDiscoveryBlocked} from './discoveries.mjs';
export function fresh(project, packet, outputs = false, submitting = false) {
    const a = packet.attempts.at(-1);
    const submittedVersion = ['submitted', 'verified'].includes(packet.status);
    for (const i of packet.inputs) {
        const output = packet.deliverables.some(d => d.path === i.path);
        if (output && (submitting || submittedVersion && a?.deliverables))
            continue;
        if (digest(project, i) !== i.sha256)
            fail('STALE_INPUT', `Input changed: ${i.path}`);
    }
    if (outputs || submittedVersion && a?.deliverables && !submitting)
        for (const d of a?.deliverables ?? [])
            if (digest(project, { ...d, required: true }) !== d.sha256)
                fail('STALE_OUTPUT', `Output changed: ${d.path}`);
}
function ready(state) {
    for (const p of state.packets) {
        if (p.status !== 'planned' || !p.dependsOn.every(id => state.packets.find(d => d.id === id).status === 'verified'))
            continue;
        for (const input of p.inputs.filter(i => i.producerPacketId)) {
            const attempt = state.packets.find(d => d.id === input.producerPacketId).attempts.at(-1);
            input.sha256 = attempt.deliverables.find(d => d.path === input.path).sha256;
            input.producerAttemptId = attempt.id;
        }
        p.status = 'ready';
    }
    state.status = state.packets.some(p => p.status === 'blocked') ? 'blocked' : 'active';
}
function invalidate(state, id, reason) {
    for (const p of state.packets.filter(p => p.dependsOn.includes(id))) {
        p.status = 'blocked';
        p.reason = reason;
        invalidate(state, p.id, reason);
    }
    state.integration = null;
}
export function transition(project, state, a) {
    need(a && text(a.type), 'Action required');
    if (state.status === 'cancelled' || state.status === 'completed' && a.type !== 'revise')
        fail('INVALID_TRANSITION', 'Case is terminal');
    if (['start', 'submit', 'review', 'integrate', 'amend_plan'].includes(a.type) && state.startedAt && Date.now() - Date.parse(state.startedAt) >= state.contract.budget.maxDurationMs)
        fail('BUDGET_EXCEEDED', 'Case duration budget exhausted');
    const p = state.packets.find(p => p.id === a.packetId);
    const last = p?.attempts.at(-1);
    const requirePacket = (...statuses) => {
        if (!p || !statuses.includes(p.status))
            fail('INVALID_TRANSITION', 'Packet state does not allow action');
    };
    switch (a.type) {
        case 'plan':
            if (state.packets.length) {
                if (!state.packets.every(p => p.status === 'blocked' && p.contractRevision !== state.contract.revision))
                    fail('INVALID_TRANSITION', 'Already planned');
                state.packetHistory ??= [];
                state.packetHistory.push(state.packets);
            }
            state.packets = plan(project, state, a.packets);
            state.planWriteScope = state.contract.writeScope ?? state.packets.flatMap(p => p.writeScope);
            break;
        case 'amend_plan':
            amendPlan(project, state, a, fresh);
            assertDiscoveryLinks(state);
            break;
        case 'report_discovery':
            reportDiscovery(state, a);
            break;
        case 'resolve_discoveries':
            if (state.packets.some(p => ['running','submitted'].includes(p.status)))
                fail('ACTIVE_ATTEMPT', 'Resolve discoveries at a safe worker/review boundary');
            if (a.packets) amendPlan(project, state, a, fresh);
            resolveDiscoveries(state, a);
            break;
        case 'reopen_discovery':
            reopenDiscovery(state, a);
            break;
        case 'start':
            requirePacket('ready');
            if (packetDiscoveryBlocked(state,p.id)) fail('UNRESOLVED_DISCOVERY','Blocking discovery must be resolved before this packet can run');
            need(text(a.sessionId), 'Session required');
            if ([...state.packets, ...(state.packetHistory ?? []).flat()].filter(old => old.id === p.id).some(old => old.attempts.some(x => x.sessionId === a.sessionId)))
                fail('SAME_SESSION', 'Retry requires new session');
            if (state.packets.some(x => x.status === 'running'))
                fail('BUSY', 'Only one worker may run');
            for (const id of p.dependsOn) {
                const dep = state.packets.find(d => d.id === id);
                if (dep.status !== 'verified')
                    fail('INVALID_TRANSITION', 'Dependency not verified');
                fresh(project, dep, true);
            }
            fresh(project, p);
            if (attemptCount(state) >= state.contract.budget.maxAttempts || state.startedAt && Date.now() - Date.parse(state.startedAt) >= state.contract.budget.maxDurationMs)
                fail('BUDGET_EXCEEDED', 'Case budget exhausted');
            state.startedAt ??= new Date().toISOString();
            p.status = 'running';
            p.attempts.push({
                id: randomUUID(), sessionId: a.sessionId, status: 'running', startedAt: new Date().toISOString(), inputs: structuredClone(p.inputs), contractRevision: state.contract.revision, usage: 'unknown'
            });
            break;
        case 'submit':
            requirePacket('running');
            if (packetDiscoveryBlocked(state,p.id)) fail('UNRESOLVED_DISCOVERY','Blocking discovery must be resolved before submission');
            if (last.id !== a.attemptId)
                fail('INVALID_ATTEMPT', 'Attempt mismatch');
            need(text(a.summary), 'Summary required');
            fresh(project, p, false, true);
            last.deliverables = p.deliverables.map(d => ({ ...d, sha256: digest(project, { ...d, required: true }) }));
            last.summary = a.summary;
            last.status = 'submitted';
            last.submittedAt = new Date().toISOString();
            p.status = 'submitted';
            break;
        case 'review':
            requirePacket('submitted');
            if (last.id !== a.attemptId)
                fail('INVALID_ATTEMPT', 'Attempt mismatch');
            need(text(a.sessionId) && typeof a.passed === 'boolean' && Array.isArray(a.findings) && evidence(a.evidence), 'Review evidence required');
            if (last.sessionId === a.sessionId)
                fail('SAME_SESSION', 'Independent session required');
            fresh(project, p, true);
            last.review = {
                sessionId: a.sessionId, passed: a.passed, findings: a.findings, evidence: a.evidence, source: 'independent-review', at: new Date().toISOString()
            };
            last.status = p.status = a.passed ? 'verified' : 'blocked';
            if (!a.passed)
                invalidate(state, p.id, 'Dependency review failed');
            break;
        case 'retry':
            requirePacket('blocked', 'running', 'submitted', 'verified');
            need(text(a.reason), 'Retry reason required');
            if (p.contractRevision !== state.contract.revision)
                fail('REPLAN_REQUIRED', 'Contract revision requires explicit plan replacement');
            if (last && ['running', 'submitted'].includes(last.status)) {
                last.status = 'interrupted';
                last.reason = a.reason;
            }
            p.inputs = p.inputs.map(i => ({ ...i, sha256: i.producerPacketId ? null : digest(project, i) }));
            p.contractRevision = state.contract.revision;
            p.revision++;
            p.status = 'planned';
            p.reason = a.reason;
            invalidate(state, p.id, 'Dependency retry requires new review');
            break;
        case 'block':
            requirePacket('planned', 'ready', 'running', 'submitted', 'blocked');
            need(text(a.reason), 'Block reason required');
            p.status = 'blocked';
            p.reason = a.reason;
            if (last?.status === 'running') {
                last.status = 'interrupted';
                last.reason = a.reason;
                if (a.feedback) {
                    need(['blocked', 'changeRequest'].includes(a.feedback.kind) && text(a.feedback.reason), 'Invalid worker feedback');
                    last.feedback = structuredClone(a.feedback);
                    last.status = 'blocked';
                }
            }
            invalidate(state, p.id, a.reason);
            break;
        case 'cancel':
            need(text(a.reason), 'Cancel reason required');
            state.status = 'cancelled';
            state.reason = a.reason;
            for (const packet of state.packets)
                if (packet.status !== 'verified') {
                    packet.status = 'cancelled';
                    const attempt = packet.attempts.at(-1);
                    if (attempt?.status === 'running')
                        attempt.status = 'cancelled';
                }
            return state;
        case 'revise':
            need(text(a.reason), 'Revision reason required');
            state.contractHistory ??= [];
            state.contractHistory.push({ contract: state.contract, reason: a.reason });
            state.contract = contract(a.contract, state.contract.revision + 1);
            for (const d of state.discoveries ?? [])
                if (d.status !== 'pending') reopenDiscovery(state,{id:d.id,reason:'Contract revised; discovery requires alignment'});
            for (const packet of state.packets) {
                packet.status = 'blocked';
                packet.reason = 'Contract revised; alignment and review required';
            }
            state.integration = null;
            break;
        case 'integrate':
            assertDiscoveriesResolved(state);
            need(text(a.sessionId) && text(a.summary) && Array.isArray(a.results), 'Integration required');
            if (!state.packets.length || state.packets.some(p => p.status !== 'verified' || p.contractRevision !== state.contract.revision))
                fail('ACCEPTANCE_INCOMPLETE', 'All packets must be verified');
            state.packets.forEach(p => fresh(project, p, true));
            if (a.results.length !== state.contract.acceptance.length || new Set(a.results.map(r => r.criterionId)).size !== a.results.length || !state.contract.acceptance.every(c => a.results.some(r => r.criterionId === c.id && r.passed === true && evidence(r.evidence))))
                fail('ACCEPTANCE_INCOMPLETE', 'Each global criterion requires pass evidence');
            state.integration = {
                sessionId: a.sessionId, results: a.results, summary: a.summary, contractRevision: state.contract.revision, packets: state.packets.map(p => ({ id: p.id, revision: p.revision, attemptId: p.attempts.at(-1).id })), at: new Date().toISOString()
            };
            state.status = 'completed';
            return state;
        default: fail('INVALID_ARGUMENT', 'Unknown action');
    }
    ready(state);
    return state;
}
