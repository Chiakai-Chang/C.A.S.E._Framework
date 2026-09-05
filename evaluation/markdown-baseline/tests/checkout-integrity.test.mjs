import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('fresh Git checkout preserves immutable result bytes with autocrlf enabled', async () => {
  const root = new URL('../../../', import.meta.url);
  const scratch = await mkdtemp(join(tmpdir(), 'case-checkout-integrity-'));
  const repository = join(scratch, 'repository');
  const checkout = join(scratch, 'checkout');
  const resultPath = 'evaluation/markdown-baseline/results/example.json';
  const expected = Buffer.from('{\n  "result": "immutable"\n}\n');
  function git(args) {
    const result = spawnSync('git', ['-c', 'core.autocrlf=true', ...args], {
      cwd: repository, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' },
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
  }
  try {
    await mkdir(repository);
    await mkdir(checkout);
    await mkdir(join(repository, 'evaluation/markdown-baseline/results'), { recursive: true });
    await writeFile(join(repository, '.gitattributes'), await readFile(new URL('.gitattributes', root)));
    await writeFile(join(repository, resultPath), expected);
    git(['init', '--quiet']);
    git(['add', '--', '.gitattributes', resultPath]);
    git(['checkout-index', `--prefix=${checkout.replaceAll('\\', '/')}/`, '--all']);
    assert.deepEqual(await readFile(join(checkout, resultPath)), expected);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
