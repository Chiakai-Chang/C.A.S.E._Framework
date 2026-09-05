import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import caseExtension from '../integrations/pi/extension-core.mjs';

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
