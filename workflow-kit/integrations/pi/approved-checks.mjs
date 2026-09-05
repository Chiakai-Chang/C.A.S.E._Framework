import { createScopedTools } from './scoped-tools.mjs';

const invalid = message => { throw Object.assign(new Error(message), { code: 'INVALID_CHECK_CONFIG' }); };
export function approveChecks(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Checks must be an object keyed by ID');
  return Object.freeze(Object.fromEntries(Object.entries(input).map(([id, check]) => {
    if (!id.trim() || !check || typeof check.command !== 'string' || !check.command.trim() || !Array.isArray(check.args) || check.args.some(a => typeof a !== 'string')) invalid('Each check needs command and string args');
    const timeoutMs = check.timeoutMs ?? 30000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120000) invalid('timeoutMs must be 1–120000');
    if (check.criterionIds !== undefined && (!Array.isArray(check.criterionIds) || !check.criterionIds.length || check.criterionIds.some(id => typeof id !== 'string' || !id.trim()))) invalid('criterionIds must be a nonempty array of IDs');
    return [id, Object.freeze({ command: check.command, args: Object.freeze([...check.args]), timeoutMs,
      ...(check.criterionIds ? { criterionIds: Object.freeze([...check.criterionIds]) } : {}) })];
  })));
}

export function createCheckExecutor(project, checks) {
  const tool = createScopedTools({ project, role: 'reviewer', checks }).find(t => t.name === 'case_check');
  return async ({ role, state, packetId, signal }) => {
    const criteria = role === 'reviewer'
      ? new Set(state.packets.find(p => p.id === packetId)?.checks.flatMap(c => c.criterionIds) ?? [])
      : null;
    const results = [];
    for (const [id, check] of Object.entries(checks)) {
      // Explicit criterion checks apply only to matching work. Unscoped checks
      // are whole-case checks: running them on a half-built project is misleading.
      if (criteria && (!check.criterionIds || !check.criterionIds.some(c => criteria.has(c)))) continue;
      if (signal?.aborted) throw Object.assign(new Error('Checks cancelled'), { code: 'CANCELLED' });
      results.push((await tool.execute(`check-${id}`, { id }, signal)).details);
    }
    return results;
  };
}
