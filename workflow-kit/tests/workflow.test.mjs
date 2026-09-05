import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run } from '../skills/case-workflow/scripts/case.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'case-workflow-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, call: (cmd, ...args) => run([cmd, '--project', dir, ...args]) };
}
function newTask(call) { return call('new', '--title', 'Resume fix', '--goal', 'Fix the actual bug', '--criterion', 'Regression passes', '--constraint', 'Preserve unrelated edits').task; }

test('full lifecycle preserves restart context and requires fresh acceptance after reopen', t => {
  const { dir, call } = fixture(t);
  assert.equal(call('init').code, 'INITIALIZED');
  assert.equal(call('init').code, 'ALREADY_INITIALIZED');
  const { id } = newTask(call);
  call('checkpoint', '--task', id, '--summary', 'Found cause in input validation', '--next', 'Patch validation', '--status', 'blocked');
  // A fresh process receives current essentials without loading prior session history.
  const cli = fileURLToPath(new URL('../skills/case-workflow/scripts/case.mjs', import.meta.url));
  const fresh = spawnSync(process.execPath, [cli, 'context', '--project', dir, '--task', id], { encoding: 'utf8' });
  assert.equal(fresh.status, 0); assert.match(fresh.stdout, /Preserve unrelated edits/); assert.match(fresh.stdout, /Patch validation/);
  assert.doesNotMatch(fresh.stdout, /Task created; work has not started/);
  call('record', '--task', id, '--criterion', '1', '--result', 'pass', '--evidence', 'tests/validation.test.js passed at commit abc');
  const handed = call('handoff', '--task', id, '--to', 'reviewer', '--summary', 'Fix ready', '--next', 'Review test output').task;
  assert.equal(handed.criteria[0].result, 'pass'); assert.equal(handed.recipient, 'reviewer');
  assert.equal(call('finish', '--task', id, '--summary', 'Delivered').code, 'COMPLETED_RECORDED');
  assert.throws(() => call('record', '--task', id, '--criterion', '1', '--result', 'fail', '--evidence', 'Later failure'), { code: 'REOPEN_REQUIRED' });
  const reopened = call('reopen', '--task', id, '--reason', 'New failing case').task;
  assert.equal(reopened.criteria[0].result, 'pending');
  assert.ok(reopened.history.some(e => e.note.includes('commit abc')));
  assert.throws(() => call('finish', '--task', id, '--summary', 'Not yet'), { code: 'ACCEPTANCE_INCOMPLETE' });
  assert.equal(call('doctor').tasks, 1); assert.equal(call('list').tasks[0].id, id);
});

test('invalid input and incomplete acceptance leave state byte-identical', t => {
  const { dir, call } = fixture(t); call('init'); const { id } = newTask(call);
  const file = path.join(dir, '.case-agent', 'tasks', `${id}.json`); const before = fs.readFileSync(file, 'utf8');
  for (const args of [
    ['finish', '--task', id, '--summary', 'Premature'],
    ['checkpoint', '--task', id, '--summary', 'x', '--next', 'y', '--status', 'done'],
    ['record', '--task', id, '--criterion', '0', '--result', 'pass', '--evidence', 'x'],
    ['record', '--task', id, '--criterion', '2', '--result', 'pass', '--evidence', 'x'],
    ['record', '--task', id, '--criterion', '1', '--result', 'pass', '--evidence', ' '],
    ['checkpoint', '--task', id, '--summary', 'x', '--summary', 'y', '--next', 'z'],
    ['checkpoint', '--task', '../outside', '--summary', 'x', '--next', 'y'],
    ['show', '--task', id, '--unknown', 'x'],
  ]) assert.throws(() => call(...args));
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(dir, '.case-agent', '.write-lock')), false);
});

test('foreign namespace, M0 and corrupted task fail closed without writes', t => {
  const { dir, call } = fixture(t); const root = path.join(dir, '.case-agent'); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'manifest.json'), '{"legacy":true}');
  assert.throws(() => call('init'), { code: 'NAMESPACE_CONFLICT' });
  assert.deepEqual(fs.readdirSync(root), ['manifest.json']);
  fs.unlinkSync(path.join(root, 'manifest.json')); fs.rmdirSync(root); call('init'); const { id } = newTask(call);
  fs.writeFileSync(path.join(root, 'tasks', `${id}.json`), '{}');
  assert.throws(() => call('doctor'), { code: 'INVALID_STATE' });
});

test('lock blocks concurrent mutations and diagnostics remain read-only', t => {
  const { dir, call } = fixture(t); call('init');
  const lock = path.join(dir, '.case-agent', '.write-lock'); fs.writeFileSync(lock, 'writer');
  assert.throws(() => newTask(call), { code: 'BUSY' }); assert.throws(() => call('doctor'), { code: 'BUSY' });
  assert.equal(fs.readFileSync(lock, 'utf8'), 'writer'); assert.equal(call('list').tasks.length, 0);
});

test('bounded history and context explicitly mark long fields', t => {
  const { call } = fixture(t); call('init'); const { id } = newTask(call);
  for (let i = 0; i < 35; i++) call('checkpoint', '--task', id, '--summary', `Step ${i} ${'x'.repeat(1000)}`, '--next', 'Proceed');
  const task = call('show', '--task', id).task;
  assert.equal(task.history.length, 30); assert.equal(task.eventCount, 36);
  const output = call('context', '--task', id); assert.match(output, /^ATTENTION:.*Read full show output before acting/); assert.match(output, /truncated; use show/); assert.ok(output.length < 2000); assert.doesNotMatch(output, /Step 33/);
});

test('symlink namespace is refused when platform permits symlink creation', t => {
  const { dir, call } = fixture(t); const target = path.join(dir, 'other'); fs.mkdirSync(target);
  try { fs.symlinkSync(target, path.join(dir, '.case-agent'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (e) { if (['EPERM', 'EACCES'].includes(e.code)) { t.skip('symlink permission unavailable'); return; } throw e; }
  assert.throws(() => call('init'), { code: 'UNSAFE_PATH' }); assert.deepEqual(fs.readdirSync(target), []);
});

test('public process help is offline and failures are nonzero structured JSON', t => {
  const { dir } = fixture(t);
  const cli = fileURLToPath(new URL('../skills/case-workflow/scripts/case.mjs', import.meta.url));
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /finish --task ID/); assert.equal(help.stderr, '');
  const failed = spawnSync(process.execPath, [cli, 'show', '--project', dir, '--task', '../foreign'], { encoding: 'utf8' });
  assert.equal(failed.status, 1); assert.equal(JSON.parse(failed.stdout).ok, false); assert.equal(failed.stderr, '');
  assert.deepEqual(fs.readdirSync(dir), []);
});
