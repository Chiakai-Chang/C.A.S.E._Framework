import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installSkill } from '../install.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'case-installer-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const project = join(dir, 'project');
  const source = join(dir, 'source');
  await mkdir(project);
  await mkdir(join(source, 'scripts'), { recursive: true });
  await writeFile(join(source, 'SKILL.md'), '---\nname: case-workflow\ndescription: Test skill\n---\n');
  await writeFile(join(source, 'scripts', 'case.mjs'), 'console.log("ready");\n');
  await writeFile(join(project, 'AGENTS.md'), 'User rules\n');
  return { project, source };
}

test('project install is complete, shared by Pi/Codex, and idempotent', async t => {
  const f = await fixture(t);
  const first = await installSkill({ ...f, host: 'all' });
  assert.equal(first.results.length, 2);
  for (const result of first.results) {
    assert.equal(result.action, 'installed');
    assert.equal(await readFile(join(result.destination, 'scripts', 'case.mjs'), 'utf8'), 'console.log("ready");\n');
  }
  assert.equal((await installSkill({ ...f, host: 'pi' })).results[0].action, 'unchanged');
  assert.equal((await installSkill({ ...f, host: 'codex' })).results[0].action, 'unchanged');
  assert.equal(await readFile(join(f.project, 'AGENTS.md'), 'utf8'), 'User rules\n');
  assert.ok(!(await readdir(f.project)).includes('.case-agent'));
});

test('updates require explicit flag and preserve a retrievable previous copy', async t => {
  const f = await fixture(t);
  await installSkill({ ...f, host: 'pi' });
  await writeFile(join(f.source, 'scripts', 'case.mjs'), 'console.log("v2");\n');
  await assert.rejects(installSkill({ ...f, host: 'pi' }), /--update/);
  const { results: [updated] } = await installSkill({ ...f, host: 'pi', update: true });
  assert.equal(updated.action, 'updated');
  assert.equal(await readFile(join(updated.backup, 'scripts', 'case.mjs'), 'utf8'), 'console.log("ready");\n');
  assert.equal(await readFile(join(updated.destination, 'scripts', 'case.mjs'), 'utf8'), 'console.log("v2");\n');
});

test('customized or foreign installations are not overwritten or removed', async t => {
  const f = await fixture(t);
  const { results: [installed] } = await installSkill({ ...f, host: 'pi' });
  await writeFile(join(installed.destination, 'notes.txt'), 'custom');
  await assert.rejects(installSkill({ ...f, host: 'pi', update: true }), /edited/);
  await assert.rejects(installSkill({ ...f, host: 'pi', uninstall: true }), /edited/);
  assert.equal(await readFile(join(installed.destination, 'notes.txt'), 'utf8'), 'custom');
  await mkdir(join(f.project, '.claude', 'skills', 'case-workflow'), { recursive: true });
  await assert.rejects(installSkill({ ...f, host: 'claude' }), /Foreign/);
});

test('uninstall removes discovery only, retains backup and task state', async t => {
  const f = await fixture(t);
  await mkdir(join(f.project, '.case-agent'));
  await writeFile(join(f.project, '.case-agent', 'work.txt'), 'Keep this');
  await installSkill({ ...f, host: 'claude' });
  const { results: [removed] } = await installSkill({ ...f, host: 'claude', uninstall: true });
  assert.equal(removed.action, 'removed');
  await assert.rejects(readFile(join(removed.destination, 'SKILL.md')), { code: 'ENOENT' });
  assert.match(await readFile(join(removed.backup, 'SKILL.md'), 'utf8'), /case-workflow/);
  assert.equal(await readFile(join(f.project, '.case-agent', 'work.txt'), 'utf8'), 'Keep this');
  assert.equal((await installSkill({ ...f, host: 'claude', uninstall: true })).results[0].action, 'absent');
});

test('linked host directories are rejected before writing outside the project', async t => {
  const f = await fixture(t);
  const external = join(f.source, 'outside');
  await mkdir(external);
  await symlink(external, join(f.project, '.agents'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(installSkill({ ...f, host: 'pi' }), /ordinary directory/);
  assert.deepEqual(await readdir(external), []);
});
