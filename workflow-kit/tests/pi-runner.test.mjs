import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const runner = await import('../integrations/pi/runner.mjs').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND')
        return {};
    throw error;
});
for (const reason of ['缺少必要的 prices.json，無法計算價格。', '   ']) test(`planner blocked reply preserves a concrete reason and never starts workers: ${JSON.stringify(reason)}`, async t => {
    const { createStore } = await import('../skills/case-workflow/scripts/core/index.mjs');
    const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-planner-blocked-')));
    t.after(() => fs.rmSync(project, { recursive: true, force: true }));
    const store = createStore(project);
    store.init();
    const state = store.create({ goal: 'Use required prices.json to calculate prices', constraints: [], acceptance: [{ id: 'a', text: 'Prices match source data' }], budget: { maxAttempts: 3, maxDurationMs: 60000 } });
    const rawReply = JSON.stringify({ blocked: { reason } });
    const roles = [];
    const expectedCode = reason.trim() ? 'BLOCKED' : 'INVALID_REPLY';
    await assert.rejects(runner.runCase({ store, caseId: state.id, runSession: async request => {
        roles.push(request.role);
        const sessionId = `planner-${roles.length}`;
        await request.onStart(sessionId);
        return { sessionId, text: rawReply, usage: { input: 8, output: 12 }, observations: [{ toolName: 'case_list', result: { content: [{ type: 'text', text: 'No source files' }] } }] };
    } }), failure => {
        assert.equal(failure.code, expectedCode);
        if (reason.trim()) assert.equal(failure.message, reason);
        return true;
    });
    assert.deepEqual(roles, ['planner']);
    assert.deepEqual(store.get(state.id), state);
    assert.deepEqual(fs.readdirSync(project), ['.case-agent']);
    const run = store.listRuns(state.id)[0];
    assert.equal(run.status, 'failed');
    assert.equal(run.error.code, expectedCode);
    if (reason.trim()) assert.equal(run.error.message, reason);
    assert.equal(run.sessions[0].text, rawReply);
    assert.equal(run.sessions[0].usage.output, 12);
    assert.equal(run.sessions[0].observations[0].toolName, 'case_list');
});

test('integrator data cannot replace the requested action or actual session', async (t) => {
    const { createStore } = await import('../skills/case-workflow/scripts/core/index.mjs');
    const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-integrator-data-')));
    t.after(() => fs.rmSync(project, { recursive: true, force: true }));
    const store = createStore(project);
    store.init();
    let state = store.create({ goal: 'write', constraints: [], acceptance: [{ id: 'a', text: 'correct' }], budget: { maxAttempts: 3, maxDurationMs: 60000 } });
    let sequence = 0;
    const send = action => state = store.dispatch(state.id, action, { expectedRevision: state.revision, requestId: `r${++sequence}` });
    send({ type: 'plan', packets: [{ id: 'p', purpose: 'write', constraintIds: [], inputs: [], dependsOn: [], writeScope: ['out'], deliverables: [{ path: 'out' }], checks: [{ id: 'k', text: 'check', criterionIds: ['a'] }], unknowns: [] }] });
    send({ type: 'start', packetId: 'p', sessionId: 'w' });
    fs.writeFileSync(path.join(project, 'out'), 'ok');
    const attemptId = state.packets[0].attempts[0].id;
    send({ type: 'submit', packetId: 'p', attemptId, summary: 'ok' });
    send({ type: 'review', packetId: 'p', attemptId, sessionId: 'r', passed: true, findings: [], evidence: 'read' });
    await assert.rejects(runner.runCase({ store, caseId: state.id, runSession: async ({ onStart }) => {
            await onStart('integrator-1');
            return { sessionId: 'integrator-1', text: JSON.stringify({ type: 'cancel', reason: 'model chose cancellation' }), usage: null };
        } }));
    assert.equal(store.get(state.id).status, 'active');
    assert.equal(store.listRuns(state.id)[0].status, 'failed');
    const result = await runner.runCase({ store, caseId: state.id, runSession: async ({ onStart }) => {
            await onStart('integrator-2');
            return { sessionId: 'integrator-2', text: JSON.stringify({ type: 'cancel', sessionId: 'forged', results: [{ criterionId: 'a', passed: true, evidence: 'read' }], summary: 'ok' }), usage: null };
        } });
    assert.equal(result.state.integration.sessionId, 'integrator-2');
});
test('failed sessions retain supplied tool observations and known usage in run artifacts', async (t) => {
    const { createStore } = await import('../skills/case-workflow/scripts/core/index.mjs');
    const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-failure-record-')));
    t.after(() => fs.rmSync(project, { recursive: true, force: true }));
    const store = createStore(project);
    store.init();
    const state = store.create({ goal: 'write', constraints: [], acceptance: [{ id: 'a', text: 'correct' }], budget: { maxAttempts: 3, maxDurationMs: 60000 } });
    await assert.rejects(runner.runCase({ store, caseId: state.id, runSession: async ({ onStart }) => {
            await onStart('failure-session');
            throw Object.assign(new Error('connection lost'), { code: 'NETWORK', sessionEvidence: { usage: { input: 17, output: 4 }, observations: [{ toolName: 'case_read', result: 'read before failure' }], model: { id: 'local' }, toolCalls: 1 } });
        } }), { code: 'NETWORK' });
    const saved = store.listRuns(state.id)[0].sessions[0];
    assert.equal(saved.usage.input, 17);
    assert.equal(saved.observations[0].result, 'read before failure');
    assert.equal(saved.toolCalls, 1);
});
test('integration format repair uses a fresh session and preserves the rejected reply without rerunning workers', async (t) => {
    const { createStore } = await import('../skills/case-workflow/scripts/core/index.mjs');
    const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-integration-repair-')));
    t.after(() => fs.rmSync(project, { recursive: true, force: true }));
    const store = createStore(project);
    store.init();
    const state = store.create({ goal: 'write', constraints: [{ id: 'c1', text: 'keep source' }], acceptance: [{ id: 'a1', text: 'correct output' }], budget: { maxAttempts: 3, maxDurationMs: 60000 } });
    let calls = 0, workers = 0, integrators = 0;
    const result = await runner.runCase({ store, caseId: state.id, runSession: async (request) => {
            const sessionId = `repair-format-${++calls}`;
            await request.onStart(sessionId);
            let reply;
            if (request.role === 'planner')
                reply = { packets: [{ id: 'p', purpose: 'write', constraintIds: ['c1'], inputs: [], dependsOn: [], writeScope: ['out'], deliverables: [{ path: 'out' }], checks: [{ id: 'k', text: 'correct', criterionIds: ['a1'] }], unknowns: [] }] };
            if (request.role === 'worker') {
                workers++;
                fs.writeFileSync(path.join(project, 'out'), 'ok');
                reply = { summary: 'written' };
            }
            if (request.role === 'reviewer')
                reply = { passed: true, findings: [], evidence: 'read output' };
            if (request.role === 'integrator') {
                integrators++;
                reply = { results: [{ criterionId: 'a1', passed: true, evidence: 'read output' }], summary: 'ok' };
                if (integrators === 1)
                    reply.results.push({ criterionId: 'c1', passed: true, evidence: 'source kept' });
                else
                    assert.match(request.prompt, /ACCEPTANCE_INCOMPLETE/);
            }
            return { sessionId, text: JSON.stringify(reply), usage: null };
        } });
    assert.equal(result.state.status, 'completed');
    assert.equal(workers, 1);
    assert.equal(integrators, 2);
    const saved = store.listRuns(state.id)[0].sessions.filter(s => s.role === 'integrator');
    assert.equal(JSON.parse(saved[0].text).results.length, 2);
    assert.equal(saved[0].validationError.code, 'ACCEPTANCE_INCOMPLETE');
});
for (const criterionId of ['a', 'wrong-id']) test(`failed integration returns to planner without format retry even for criterion ${criterionId}`, async t => {
    const { createStore } = await import('../skills/case-workflow/scripts/core/index.mjs');
    const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-integration-rejected-')));
    t.after(() => fs.rmSync(project, { recursive: true, force: true }));
    const store = createStore(project);
    store.init();
    let state = store.create({ goal: 'correct output', constraints: [], acceptance: [{ id: 'a', text: 'correct' }], budget: { maxAttempts: 3, maxDurationMs: 60000 } });
    let revisionRequest = 0;
    const send = action => state = store.dispatch(state.id, action, { expectedRevision: state.revision, requestId: `setup-${++revisionRequest}` });
    send({ type: 'plan', packets: [{ id: 'p', purpose: 'write', constraintIds: [], inputs: [], dependsOn: [], writeScope: ['out'], deliverables: [{ path: 'out' }], checks: [{ id: 'k', text: 'check', criterionIds: ['a'] }], unknowns: [] }] });
    send({ type: 'start', packetId: 'p', sessionId: 'worker' });
    fs.writeFileSync(path.join(project, 'out'), 'incorrect');
    const attemptId = state.packets[0].attempts[0].id;
    send({ type: 'submit', packetId: 'p', attemptId, summary: 'written' });
    send({ type: 'review', packetId: 'p', attemptId, sessionId: 'reviewer', passed: true, findings: [], evidence: 'local packet check passed' });
    const rejectedText = JSON.stringify({ results: [{ criterionId, passed: false, evidence: 'actual output is incorrect' }], summary: 'global acceptance failed' });
    const roles = [];
    await assert.rejects(runner.runCase({ store, caseId: state.id, runSession: async request => {
        roles.push(request.role);
        const sessionId = `integrator-${roles.length}`;
        await request.onStart(sessionId);
        return { sessionId, text: roles.length === 1 ? rejectedText : JSON.stringify({ blocked: {reason:'External acceptance source missing'} }), usage: { input: 10, output: 5 } };
    } }), { code: 'BLOCKED' });
    assert.deepEqual(roles, ['integrator','planner']);
    assert.deepEqual(store.get(state.id), state);
    assert.equal(fs.readFileSync(path.join(project, 'out'), 'utf8'), 'incorrect');
    const run = store.listRuns(state.id)[0];
    assert.equal(run.status, 'failed');
    assert.equal(run.error.code, 'BLOCKED');
    assert.match(run.error.message, /External acceptance source/);
    assert.equal(run.sessions[0].text, rejectedText);
    assert.equal(run.sessions[0].usage.input, 10);
    assert.equal(run.sessions[0].validationError.code, 'INTEGRATION_REJECTED');
});

test('model replies must contain one complete JSON object, not embedded prose', () => {
    assert.equal(typeof runner.parseReply, 'function', 'JSON reply validation is not implemented');
    assert.deepEqual(runner.parseReply('{"passed":true}'), { passed: true });
    assert.deepEqual(runner.parseReply('```json\n{"passed":false}\n```'), { passed: false });
    for (const text of ['Here is {"passed":true}', '{} trailing', '[]', 'null', '{"passed":true}\n{}']) {
        assert.throws(() => runner.parseReply(text), { code: 'INVALID_REPLY' });
    }
});
test('a session cannot silently return a different identity after it starts', async () => {
    assert.equal(typeof runner.callSession, 'function', 'session boundary is not implemented');
    await assert.rejects(runner.callSession(async ({ onStart }) => {
        await onStart('worker-1');
        return { sessionId: 'other-session', text: '{}', usage: null };
    }, { role: 'worker', prompt: 'work' }), { code: 'SESSION_MISMATCH' });
});
test('empty final replies preserve known session evidence on the validation failure', async () => {
    await assert.rejects(runner.callSession(async ({ onStart }) => {
        await onStart('empty');
        return { sessionId: 'empty', text: '', usage: { input: 9, output: 0 }, observations: [{ toolName: 'case_read' }] };
    }, { role: 'reviewer', prompt: 'read' }), failure => {
        assert.equal(failure.code, 'EMPTY_REPLY');
        assert.ok(failure.sessionEvidence, 'retain evidence when validating a completed SDK call');
        assert.equal(failure.sessionEvidence.usage.input, 9);
        return true;
    });
});
test('a cancelled operation does not begin a model session', async () => {
    assert.equal(typeof runner.callSession, 'function', 'session boundary is not implemented');
    const controller = new AbortController();
    controller.abort();
    let called = false;
    await assert.rejects(runner.callSession(async () => {
        called = true;
    }, {
        role: 'worker', prompt: 'work', signal: controller.signal,
    }), { code: 'CANCELLED' });
    assert.equal(called, false);
});
test('fresh planner, worker, reviewer and integrator complete a real stored case', async (t) => {
    assert.equal(typeof runner.runCase, 'function', 'workflow orchestration is not implemented');
    const { createStore } = await import('../skills/case-workflow/scripts/core/index.mjs');
    const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-runner-')));
    t.after(() => fs.rmSync(project, { recursive: true, force: true }));
    fs.writeFileSync(path.join(project, 'input.txt'), 'source material');
    const store = createStore(project);
    store.init();
    const state = store.create({ goal: 'Produce a checked result', constraints: [{ id: 'c1', text: 'Keep the source unchanged' }],
        acceptance: [{ id: 'a1', text: 'The output contains the result' }], budget: { maxAttempts: 3, maxDurationMs: 60000 } });
    const roles = [];
    const result = await runner.runCase({ store, caseId: state.id, runSession: async (request) => {
            roles.push(request.role);
            const sessionId = `session-${roles.length}`;
            await request.onStart(sessionId);
            let reply;
            if (request.role === 'planner')
                reply = { packets: [{ id: 'p1', purpose: 'Produce output', constraintIds: ['c1'],
                            inputs: [{ path: 'input.txt', required: true }], dependsOn: [], writeScope: ['output.txt'],
                            deliverables: [{ path: 'output.txt' }], checks: [{ id: 'k1', text: 'Output is correct', criterionIds: ['a1'] }], unknowns: [] }] };
            if (request.role === 'worker') {
                assert.match(request.prompt, /source material/);
                fs.writeFileSync(path.join(project, 'output.txt'), 'result');
                reply = { summary: 'PRIVATE_WORKER_NARRATIVE' };
            }
            if (request.role === 'reviewer') {
                assert.doesNotMatch(request.prompt, /PRIVATE_WORKER_NARRATIVE/);
                assert.equal(fs.readFileSync(path.join(project, 'output.txt'), 'utf8'), 'result');
                reply = { passed: true, findings: [], evidence: 'Read output.txt: result' };
            }
            if (request.role === 'integrator')
                reply = { results: [{ criterionId: 'a1', passed: true, evidence: 'Read result; source unchanged' }], summary: 'Complete' };
            return { sessionId, text: JSON.stringify(reply), usage: { input: 10, output: 5 } };
        } });
    assert.equal(result.state.status, 'completed');
    assert.deepEqual(roles, ['planner', 'worker', 'reviewer', 'integrator']);
    assert.equal(result.run.sessions.length, 4);
    const resumed = await runner.runCase({ store, caseId: state.id, runSession: async () => {
            throw new Error('must not rerun');
        } });
    assert.equal(resumed.state.status, 'completed');
});
test('failed review produces a bounded repair with fresh context, not a false completion', async (t) => {
    const { createStore } = await import('../skills/case-workflow/scripts/core/index.mjs');
    const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-repair-')));
    t.after(() => fs.rmSync(project, { recursive: true, force: true }));
    fs.writeFileSync(path.join(project, 'source.txt'), 'keep');
    const store = createStore(project);
    store.init();
    const state = store.create({ goal: 'Write a correct answer', constraints: [], acceptance: [{ id: 'a', text: 'correct output' }], budget: { maxAttempts: 3, maxDurationMs: 60000 } });
    let next = 0, workers = 0, reviews = 0;
    const result = await runner.runCase({ store, caseId: state.id, runSession: async (request) => {
            const sessionId = `repair-${++next}`;
            await request.onStart(sessionId);
            let data;
            if (request.role === 'planner')
                data = { packets: [{ id: 'p', purpose: 'output', constraintIds: [], inputs: [{ path: 'source.txt', required: true }], dependsOn: [], writeScope: ['answer.txt'], deliverables: [{ path: 'answer.txt' }], checks: [{ id: 'k', text: 'correct', criterionIds: ['a'] }], unknowns: [] }] };
            if (request.role === 'worker') {
                workers++;
                if (workers === 2)
                    assert.match(request.prompt, /answer is wrong/);
                fs.writeFileSync(path.join(project, 'answer.txt'), workers === 1 ? 'wrong' : 'correct');
                data = { summary: 'written' };
            }
            if (request.role === 'reviewer')
                data = { passed: ++reviews > 1, findings: reviews === 1 ? ['answer is wrong'] : [], evidence: 'Read answer.txt' };
            if (request.role === 'integrator')
                data = { results: [{ criterionId: 'a', passed: true, evidence: 'Read correct answer' }], summary: 'complete' };
            return { sessionId, text: JSON.stringify(data), usage: null };
        } });
    assert.equal(result.state.status, 'completed');
    assert.equal(workers, 2);
    assert.equal(result.state.packets[0].attempts[0].review.passed, false);
});
