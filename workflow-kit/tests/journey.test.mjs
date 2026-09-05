import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { installSkill } from '../install.mjs';

test('installed kit completes a task across fresh processes and preserves work after uninstall', async t => {
  const project = await mkdtemp(join(await realpath(tmpdir()), 'case-kit-journey-'));
  t.after(() => rm(project, { recursive: true, force: true }));
  const installed = await installSkill({ project, host: 'all' });
  const cli = join(installed.results[0].destination, 'scripts', 'case.mjs');
  const claudeCli = join(installed.results[1].destination, 'scripts', 'case.mjs');
  const invoke = (command, args = [], script = cli, success = true) => {
    const result = spawnSync(process.execPath, [script, command, '--project', project, ...args], { cwd: tmpdir(), encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, success ? 0 : 1, result.stdout + result.stderr);
    return command === 'context' ? result.stdout : JSON.parse(result.stdout);
  };
  invoke('init');
  const { task } = invoke('new', ['--title', 'Write a useful answer', '--goal', 'Deliver the requested answer file', '--criterion', 'answer.txt contains 42', '--constraint', 'Do not delete existing work']);
  const id = ['--task', task.id];
  invoke('finish', [...id, '--summary', 'Premature'], cli, false);
  invoke('checkpoint', [...id, '--summary', 'Need to create answer.txt', '--next', 'Write 42 and read it back']);
  invoke('handoff', [...id, '--to', 'Claude receiver', '--summary', 'No artifact yet', '--next', 'Create and verify answer.txt']);
  const context = invoke('context', id, claudeCli);
  assert.match(context, /Do not delete existing work/);
  assert.match(context, /Create and verify answer.txt/);
  assert.doesNotMatch(context, /"history"/);
  // Deterministic fixture actor, not an LLM: make and independently observe the artifact.
  const artifact = join(project, 'answer.txt');
  await writeFile(artifact, '42\n');
  assert.equal(await readFile(artifact, 'utf8'), '42\n');
  invoke('record', [...id, '--criterion', '1', '--result', 'pass', '--evidence', 'Read answer.txt and observed exactly 42 plus newline'], claudeCli);
  const completed = invoke('finish', [...id, '--summary', 'Answer delivered and observed'], claudeCli);
  assert.equal(completed.code, 'COMPLETED_RECORDED');
  invoke('reopen', [...id, '--reason', 'Recheck after new user request']);
  assert.equal(invoke('show', id).task.criteria[0].result, 'pending');
  assert.equal(invoke('doctor').ok, true);
  await installSkill({ project, host: 'all', uninstall: true });
  assert.equal(await readFile(artifact, 'utf8'), '42\n');
  const state = JSON.parse(await readFile(join(project, '.case-agent', 'tasks', `${task.id}.json`), 'utf8'));
  assert.equal(state.id, task.id);
  assert.equal(state.status, 'active');
});
