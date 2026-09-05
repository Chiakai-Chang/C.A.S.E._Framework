import { need, text, jsonValue, digest, fail } from './io.mjs';

export function preparePolicy(project, input, revision, reason) {
    jsonValue(input);
    need(input && text(input.summary) && text(reason), 'Project summary and change reason required');
    need(Array.isArray(input.constraints) && input.constraints.every(c => c && text(c.id) && text(c.text)) && new Set(input.constraints.map(c => c.id)).size === input.constraints.length, 'Unique project constraints required');
    need(Array.isArray(input.sources) && input.sources.every(text) && new Set(input.sources).size === input.sources.length, 'Unique project source paths required');
    return {
        revision, summary: input.summary,
        constraints: input.constraints.map(c => ({ id: `project:${c.id}`, text: c.text })),
        sources: input.sources.map(p => ({ path: p, required: true, sha256: digest(project, { path: p, required: true }) })),
        reason, updatedAt: new Date().toISOString(),
    };
}

function currentSources(project, policy) {
    for (const source of policy?.sources ?? []) {
        let same = false;
        try { same = digest(project, source) === source.sha256; } catch { /* Report alignment, never silently accept a missing rule. */ }
        if (!same) fail('PROJECT_POLICY_CHANGED', `Project instruction changed: ${source.path}; explicitly update project consensus and revise affected cases`);
    }
}

export function assertProjectAligned(project, current, snapshot) {
    if ((current?.revision ?? 0) !== (snapshot?.revision ?? 0))
        fail('PROJECT_POLICY_CHANGED', 'Project consensus changed; explicitly revise this case before continuing');
    currentSources(project, current);
}

export function inheritProject(project, input, policy, previous) {
    jsonValue(input);
    currentSources(project, policy);
    need(input && Array.isArray(input.constraints), 'Case constraints required');
    const constraints = input.constraints.filter(c => {
        if (!c?.id?.startsWith('project:')) return true;
        // A whole-contract revision may carry the unchanged former snapshot.
        need(previous?.constraints.some(old => old.id === c.id && old.text === c.text), 'project: constraint IDs are reserved');
        return false;
    });
    const result = { ...structuredClone(input), constraints: [...constraints, ...structuredClone(policy?.constraints ?? [])] };
    delete result.project;
    if (policy) result.project = structuredClone(policy);
    return result;
}
