import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import caseExtension from '../integrations/pi/extension-core.mjs';
import { createStore } from '../skills/case-workflow/scripts/core/index.mjs';
import { runCase } from '../integrations/pi/runner.mjs';
import { approveChecks, createCheckExecutor } from '../integrations/pi/approved-checks.mjs';

test('real check failure repairs the artifact, then a fresh run resumes integration without repeating writes', async t => {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-checked-resume-')));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  fs.writeFileSync(path.join(project, 'numbers.json'), '[2,3,7]');
  const checks = approveChecks({ sum: { command: process.execPath, args: ['-e',
    'const fs=require("node:fs");const want=JSON.parse(fs.readFileSync("numbers.json")).reduce((a,b)=>a+b,0);if(Number(fs.readFileSync("answer.txt","utf8"))!==want){console.error("answer does not equal source sum");process.exit(1)}'], criterionIds: ['total'] } });
  const executeChecks = createCheckExecutor(project, checks);
  let store = createStore(project); store.init();
  const state = store.create({ goal: 'Calculate the source total', constraints: [], acceptance: [{ id: 'total', text: 'answer equals source sum' }], budget: { maxAttempts: 3, maxDurationMs: 60000 } });
  const roles = []; let writes = 0;
  await assert.rejects(runCase({ store, caseId: state.id, executeChecks, runSession: async request => {
    const sessionId = `first-${roles.length}`; roles.push(request.role); await request.onStart(sessionId);
    let result;
    if (request.role === 'planner') result = { packets: [{ id: 'p', purpose: 'sum numbers', constraintIds: [], inputs: [{ path: 'numbers.json', required: true }], dependsOn: [], writeScope: ['answer.txt'], deliverables: [{ path: 'answer.txt' }], checks: [{ id: 'sum', text: 'compare source sum', criterionIds: ['total'] }], unknowns: [] }] };
    if (request.role === 'worker') {
      fs.writeFileSync(path.join(project, 'answer.txt'), '11'); writes++;
      await assert.rejects(request.validateResult({ summary: 'done' }), { code: 'CHECK_FAILED' });
      assert.notEqual(store.get(state.id).status, 'completed');
      fs.writeFileSync(path.join(project, 'answer.txt'), '12'); writes++;
      await request.validateResult({ summary: 'corrected source sum' });
      result = { summary: 'corrected source sum' };
    }
    if (request.role === 'reviewer') result = { passed: true, findings: [], evidence: 'source sum checked' };
    if (request.role === 'integrator') throw Object.assign(new Error('connection interrupted'), { code: 'NETWORK' });
    return { sessionId, text: JSON.stringify(result) };
  } }), { code: 'NETWORK' });
  const before = store.get(state.id);
  assert.equal(before.packets[0].status, 'verified');
  const firstRun = store.listRuns(state.id)[0];
  assert.equal(firstRun.status, 'failed');
  assert.ok(firstRun.checks.some(c => c.role === 'worker' && c.results.some(r => r.exitCode === 1)));
  store = createStore(project); // No in-memory workflow history is required for continuation.
  const resumed = await runCase({ store, caseId: state.id, executeChecks, runSession: async request => {
    roles.push(request.role); assert.equal(request.role, 'integrator'); await request.onStart('resumed-integrator');
    return { sessionId: 'resumed-integrator', text: JSON.stringify({ results: [{ criterionId: 'total', passed: true, evidence: 'actual check passed' }], summary: 'source total delivered' }) };
  } });
  assert.equal(resumed.state.status, 'completed');
  assert.equal(fs.readFileSync(path.join(project, 'answer.txt'), 'utf8'), '12');
  assert.equal(fs.readFileSync(path.join(project, 'numbers.json'), 'utf8'), '[2,3,7]');
  assert.equal(writes, 2);
  assert.deepEqual(resumed.state.packets, before.packets);
  assert.deepEqual(roles, ['planner', 'worker', 'reviewer', 'integrator', 'integrator']);
  assert.equal(store.listRuns(state.id).length, 2);
});

test('trusted checks run frozen argv and filter packet criteria while integration runs all', async t => {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-approved-')));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const mod = await import('../integrations/pi/approved-checks.mjs').catch(() => ({}));
  assert.equal(typeof mod.approveChecks, 'function');
  const input = {
    price: { command: process.execPath, args: ['-e', 'process.stdout.write("price verified")'], criterionIds: ['price'] },
    report: { command: process.execPath, args: ['-e', 'process.exit(3)'], criterionIds: ['report'] },
  };
  const approved = mod.approveChecks(input);
  input.price.args = ['-e', 'process.exit(9)'];
  const executeChecks = mod.createCheckExecutor(project, approved);
  const state = { contract: { acceptance: [{ id: 'price' }, { id: 'report' }] }, packets: [{ id: 'p', checks: [{ criterionIds: ['price'] }] }] };
  const local = await executeChecks({ role: 'reviewer', state, packetId: 'p' });
  assert.deepEqual(local.map(r => [r.id, r.exitCode, r.stdout]), [['price', 0, 'price verified']]);
  assert.deepEqual((await executeChecks({ role: 'integrator', state })).map(r => [r.id, r.exitCode]), [['price', 0], ['report', 3]]);
  assert.throws(() => mod.approveChecks({ bad: { command: 'node', args: ['x'], timeoutMs: 0 } }), { code: 'INVALID_CHECK_CONFIG' });
});

test('only explicit confirmed human command can register checks or project consensus', async t => {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-human-')));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  fs.writeFileSync(path.join(project, 'checks.json'), JSON.stringify({ smoke: { command: process.execPath, args: ['--version'] } }));
  fs.writeFileSync(path.join(project, 'policy.json'), JSON.stringify({ summary: '本機處理', constraints: [{ id: 'no-upload', text: '不外傳' }], sources: [] }));
  const registered = {}, messages = [], errors = [], confirmations = [];
  caseExtension({ registerTool: v => registered.tool = v, registerCommand: (n,v) => registered.command = v, on: () => {}, sendMessage: v => messages.push(v) });
  const ctx = { cwd: project, ui: { notify: (...args) => errors.push(args), confirm: async (...args) => { confirmations.push(args); return true; } } };
  await assert.rejects(registered.tool.execute('id', { operation: 'checks', file: 'checks.json' }, undefined, undefined, ctx));
  await registered.command.handler('checks checks.json', ctx);
  assert.equal(errors.length, 0);
  assert.match(confirmations[0][1], /--version/);
  assert.match(messages[0].content, /smoke/);
  await registered.command.handler('project policy.json', { ...ctx, ui: { ...ctx.ui, confirm: async () => false } });
  assert.equal(fs.existsSync(path.join(project, '.case-agent')), false);
  await registered.command.handler('project policy.json', ctx);
  const result = await registered.tool.execute('id', { operation: 'project' }, undefined, undefined, ctx);
  assert.equal(result.details.policy.summary, '本機處理');
});
