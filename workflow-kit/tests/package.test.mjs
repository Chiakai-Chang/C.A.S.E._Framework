import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const kit = fileURLToPath(new URL('../', import.meta.url));

test('package ships the native entry and dependency-free operation factory without private traces', async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(kit, 'package.json'), 'utf8'));
  const registered = [];
  const extension = await import('../integrations/pi/extension-core.mjs');
  extension.default({ registerTool: tool => registered.push(tool), registerCommand() {}, on() {} });
  assert.ok(registered.some(tool => tool.name === 'case_workflow' && typeof tool.execute === 'function'), 'No usable CASE operation was discovered');
  for (const file of ['integrations/pi/extension.mjs', 'integrations/pi/extension-core.mjs', 'skills/case-workflow/scripts/core/index.mjs']) {
    assert.equal(fs.existsSync(path.join(kit, file)), true);
    assert.ok(pkg.files.some(prefix => file.startsWith(prefix + '/')));
  }
  assert.equal(pkg.files.includes('evaluation'), false, 'local experiment runner is a developer asset, not adoption material');
});

test('copied skill can run the v2 core entry without the framework checkout', t => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-copy-v2-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const installed = path.join(dir, 'skill');
  const project = path.join(dir, 'project');
  fs.mkdirSync(project);
  fs.cpSync(path.join(kit, 'skills/case-workflow'), installed, { recursive: true });
  const result = spawnSync(process.execPath, [path.join(installed, 'scripts/case-v2.mjs'), 'init', '--project', project], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(project, '.case-agent/workflow.json'), 'utf8')).format, 'case-workflow/2');
});
