import { fail, need, text, fingerprint } from './io.mjs';
import { plan, scopeContains } from './contracts.mjs';

export function packetDefinition(packet) {
    const { revision, contractRevision, status, attempts, reason, ...definition } = packet;
    definition.inputs = definition.inputs.map(({sha256,producerPacketId,producerAttemptId,...input}) => input);
    definition.checks = definition.checks.map(check => ({...check,criterionIds:[...check.criterionIds].sort()}));
    for (const key of ['inputs','constraintIds','dependsOn','writeScope','deliverables','checks','unknowns'])
        definition[key] = [...definition[key]].sort((a,b)=>fingerprint(a).localeCompare(fingerprint(b)));
    return definition;
}
export function attemptCount(state) {
    return new Set([...state.packets, ...(state.packetHistory ?? []).flat()].flatMap(p => p.attempts.map(a => a.id))).size;
}
export function amendPlan(project, state, action, fresh) {
    need(text(action.reason), 'Plan amendment reason required');
    need(state.packets.length, 'Existing plan required');
    if (state.packets.some(p => ['running','submitted'].includes(p.status) || p.attempts.some(a => ['running','submitted'].includes(a.status)) || p.status === 'blocked' && p.attempts.at(-1)?.status === 'interrupted' && !p.attempts.at(-1).feedback))
        fail('ACTIVE_ATTEMPT', 'Unknown attempt side effects require explicit recovery');
    if (attemptCount(state) >= state.contract.budget.maxAttempts)
        fail('BUDGET_EXCEEDED', 'Case attempt budget exhausted');
    const next = plan(project, state, action.packets);
    const ceiling = state.contract.writeScope ?? state.planWriteScope ?? state.packets.flatMap(p => p.writeScope);
    if (!next.every(p => p.writeScope.every(s => ceiling.some(c => scopeContains(project, c, s)))))
        fail('WRITE_SCOPE_EXCEEDED', 'Plan amendment exceeds original write authority');
    const rerun = action.rerunPacketIds ?? [];
    need(Array.isArray(rerun) && new Set(rerun).size === rerun.length && rerun.every(id => next.some(p => p.id === id) && state.packets.some(p => p.id === id)), 'Invalid rerun packet IDs');
    const signature = packets => fingerprint(packets.map(packetDefinition).sort((a,b) => a.id.localeCompare(b.id)));
    if (!rerun.length && signature(state.packets) === signature(next))
        fail('NO_PLAN_CHANGE', 'Plan amendment must change work or explicitly request rerun');
    const retained = new Set();
    for (const p of next) {
        const old = state.packets.find(o => o.id === p.id);
        if (old?.status !== 'verified' || rerun.includes(p.id) || fingerprint(packetDefinition(old)) !== fingerprint(packetDefinition(p))) continue;
        try { fresh(project, old, true); retained.add(p.id); }
        catch (e) { if (!['STALE_INPUT','STALE_OUTPUT','MISSING_INPUT'].includes(e.code)) throw e; }
    }
    // Both removed writes and forthcoming writes can invalidate otherwise valid work.
    let changed;
    do {
        changed = false;
        const writes = [...state.packets, ...next].filter(p => !retained.has(p.id)).flatMap(p => p.writeScope);
        for (const p of next.filter(p => retained.has(p.id))) {
            if (p.dependsOn.some(id => !retained.has(id)) || writes.some(w => [...p.writeScope, ...p.inputs.map(i => i.path)].some(s => scopeContains(project,w,s) || scopeContains(project,s,w)))) {
                retained.delete(p.id); changed = true;
            }
        }
    } while (changed);
    state.packetHistory ??= [];
    state.packetHistory.push(structuredClone(state.packets));
    state.planWriteScope ??= structuredClone(ceiling);
    state.packets = next.map(p => {
        const old = state.packets.find(o => o.id === p.id);
        return retained.has(p.id) ? old : { ...p, revision: (old?.revision ?? 0) + 1, attempts: old?.attempts ?? [] };
    });
    state.planAmendments ??= [];
    state.planAmendments.push({reason:action.reason,rerunPacketIds:rerun,retainedPacketIds:[...retained],at:new Date().toISOString()});
    state.integration = null;
}
