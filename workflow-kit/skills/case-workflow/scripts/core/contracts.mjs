import { need, text, resolveMaterial, digest, jsonValue } from './io.mjs';
const unique = items => new Set(items).size === items.length;
function ids(items) {
    need(Array.isArray(items) && items.every(i => i && text(i.id) && text(i.text)) && unique(items.map(i => i.id)), 'Invalid IDs');
}
export function contract(input, revision = 1) {
    jsonValue(input);
    need(input && text(input.goal), 'Goal required');
    ids(input.constraints);
    ids(input.acceptance);
    need(input.acceptance.length > 0, 'Acceptance required');
    need(input.budget && Number.isSafeInteger(input.budget.maxAttempts) && input.budget.maxAttempts > 0 && Number.isSafeInteger(input.budget.maxDurationMs) && input.budget.maxDurationMs > 0, 'Positive budgets required');
    return { ...structuredClone(input), revision };
}
export function plan(project, state, packets) {
    need(Array.isArray(packets) && packets.length > 0 && packets.every(p => p && text(p.id)) && unique(packets.map(p => p.id)), 'Unique packets required');
    const covered = new Set();
    const allIds = packets.map(p => p.id);
    const result = packets.map(p => {
        need(text(p.purpose), 'Purpose required');
        for (const key of ['constraintIds', 'inputs', 'dependsOn', 'writeScope', 'deliverables', 'checks', 'unknowns'])
            need(Array.isArray(p[key]), `${key} required`);
        need(p.constraintIds.every(id => state.contract.constraints.some(c => c.id === id)), 'Unknown constraint');
        need(unique(p.dependsOn) && p.dependsOn.every(id => allIds.includes(id) && id !== p.id), 'Invalid dependency');
        p.writeScope.forEach(name => resolveMaterial(project, name));
        need(p.deliverables.length > 0 && unique(p.deliverables.map(d => d.path)), 'Deliverables required');
        for (const d of p.deliverables) {
            resolveMaterial(project, d.path);
            need(p.writeScope.some(s => d.path === s || d.path.startsWith(s.replace(/\/$/, '') + '/')), 'Deliverable outside write scope');
        }
        ids(p.checks);
        for (const c of p.checks) {
            need(Array.isArray(c.criterionIds) && c.criterionIds.length > 0 && c.criterionIds.every(id => state.contract.acceptance.some(a => a.id === id)), 'Invalid criterion references');
            c.criterionIds.forEach(id => covered.add(id));
        }
        const inputs = p.inputs.map(i => {
            need(i && typeof i.required === 'boolean', 'Input required flag missing');
            resolveMaterial(project, i.path);
            const producers = packets.filter(candidate => p.dependsOn.includes(candidate.id) && candidate.deliverables?.some(d => d.path === i.path));
            need(producers.length <= 1, 'Input has ambiguous producers');
            if (producers.length)
                return { ...i, sha256: null, producerPacketId: producers[0].id };
            return { ...i, sha256: digest(project, i) };
        });
        return {
            ...structuredClone(p), inputs, revision: 1, contractRevision: state.contract.revision, status: p.dependsOn.length ? 'planned' : 'ready', attempts: []
        };
    });
    need(state.contract.acceptance.every(a => covered.has(a.id)), 'Acceptance coverage incomplete');
    const visited = new Set(), visiting = new Set();
    function visit(id) {
        need(!visiting.has(id), 'Dependency cycle');
        if (visited.has(id))
            return;
        visiting.add(id);
        result.find(p => p.id === id).dependsOn.forEach(visit);
        visiting.delete(id);
        visited.add(id);
    }
    allIds.forEach(visit);
    return result;
}
