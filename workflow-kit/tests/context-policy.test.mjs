import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStore } from '../skills/case-workflow/scripts/core/index.mjs';
import { run as cli } from '../skills/case-workflow/scripts/case-v2.mjs';

function setup(t) {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-policy-')));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  fs.writeFileSync(path.join(project, 'AGENTS.md'), '不得傳送資料至外部服務。');
  const store = createStore(project); store.init();
  return { project, store };
}
const contract = () => ({ goal: '產生報告', constraints: [], acceptance: [{ id: 'a', text: '資料可追溯' }], budget: { maxAttempts: 4, maxDurationMs: 60000 } });
const packet = inputs => ({ id: 'report', purpose: '產生可追溯報告', constraintIds: [], inputs, dependsOn: [], writeScope: ['report.md'], deliverables: [{ path: 'report.md' }], checks: [{ id: 'check', text: '核對來源', criterionIds: ['a'] }], unknowns: [] });
const policy = () => ({ summary: '本機完成工作，降低監督負擔', constraints: [{ id: 'local', text: '不得外傳資料' }], sources: ['AGENTS.md'] });
function dispatch(store, state, action) { return store.dispatch(state.id, action, { expectedRevision: state.revision, requestId: randomUUID() }); }

test('required indexed material retains its version without filling context and missing input still fails', t => {
  const { project, store } = setup(t);
  fs.writeFileSync(path.join(project, 'data.txt'), 'record\n'.repeat(10000));
  let state = store.create(contract());
  state = dispatch(store, state, { type: 'plan', packets: [packet([{ path: 'data.txt', required: true, delivery: 'indexed', purpose: '核對交易來源' }])] });
  const ctx = JSON.parse(store.context(state.id, 'report', { maxChars: 4000 }));
  assert.equal(ctx.requiredMaterials.length, 0);
  assert.equal(ctx.materialIndex[0].required, true);
  assert.equal(ctx.materialIndex[0].sha256.length, 64);
  assert.equal(ctx.materialIndex[0].purpose, '核對交易來源');
  fs.unlinkSync(path.join(project, 'data.txt'));
  assert.throws(() => store.context(state.id, 'report'), /data.txt/);
});

test('project consensus is inherited across cases and stale source requires explicit realignment', t => {
  const { project, store } = setup(t);
  const configured = store.setProject(policy(), { expectedRevision: 0, reason: '使用者確認' });
  assert.equal(configured.revision, 1);
  let first = store.create(contract());
  const second = store.create(contract());
  assert.deepEqual(first.contract.project, second.contract.project);
  assert.deepEqual(first.contract.constraints, [{ id: 'project:local', text: '不得外傳資料' }]);
  first = dispatch(store, first, { type: 'plan', packets: [packet([])] });
  assert.equal(JSON.parse(store.context(first.id, 'report')).project.summary, '本機完成工作，降低監督負擔');
  fs.writeFileSync(path.join(project, 'AGENTS.md'), '不得外傳；報告需列出來源。');
  assert.throws(() => store.context(first.id, 'report'), { code: 'PROJECT_POLICY_CHANGED' });
  assert.throws(() => store.create(contract()), { code: 'PROJECT_POLICY_CHANGED' });
  store.setProject(policy(), { expectedRevision: 1, reason: '來源增加可追溯要求，使用者確認' });
  assert.throws(() => dispatch(store, first, { type: 'start', packetId: 'report', sessionId: 'new' }), { code: 'PROJECT_POLICY_CHANGED' });
  const old = first.contract;
  first = dispatch(store, first, { type: 'revise', contract: contract(), reason: '使用者確認新的專案共識' });
  assert.equal(first.contract.project.revision, 2);
  assert.equal(first.contractHistory[0].contract.project.revision, old.project.revision);
  assert.equal(store.project().history.length, 1);
});

test('project consensus rejects competing revisions and case constraint spoofing without writes', t => {
  const { project, store } = setup(t);
  store.setProject(policy(), { expectedRevision: 0, reason: '授權' });
  const before = fs.readFileSync(path.join(project, '.case-agent', 'workflow.json'), 'utf8');
  assert.throws(() => store.setProject(policy(), { expectedRevision: 0, reason: 'old' }), { code: 'REVISION_CONFLICT' });
  assert.throws(() => store.create({ ...contract(), constraints: [{ id: 'project:local', text: '可外傳' }] }), { code: 'INVALID_ARGUMENT' });
  assert.equal(fs.readFileSync(path.join(project, '.case-agent', 'workflow.json'), 'utf8'), before);
});

test('portable CLI can explicitly set and inspect the same project consensus as pi', t => {
  const { project, store } = setup(t);
  const file = path.join(project, 'project-policy.json');
  fs.writeFileSync(file, JSON.stringify(policy()));
  const updated = cli(['set-project', '--project', project, '--data', file, '--revision', '0', '--reason', '使用者確認']);
  assert.equal(updated.revision, 1);
  assert.equal(cli(['project', '--project', project]).policy.summary, '本機完成工作，降低監督負擔');
  assert.equal(store.create(contract()).contract.project.revision, 1);
});
