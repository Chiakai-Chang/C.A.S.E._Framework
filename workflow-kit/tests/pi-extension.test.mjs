import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('extension operations use the SDK supplied by the native host entry', async t => {
  const module = await import('../integrations/pi/extension-core.mjs').catch(() => ({}));
  assert.equal(typeof module.default, 'function', 'Host SDK injection entry is required');
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-extension-sdk-')));
  t.after(() => fs.rmSync(project, {recursive:true, force:true}));
  let tool;
  module.default({registerTool:value=>{tool=value;},registerCommand:()=>{},on:()=>{},sendMessage:()=>{}}, {
    ModelRuntime:{create:async()=>{throw Object.assign(new Error('Reached provided native SDK'),{code:'SDK_REACHED'});}},
  });
  await assert.rejects(tool.execute('run',{operation:'run',caseId:'unused'},undefined,undefined,{
    cwd:project,model:{id:'local',provider:'local'},modelRegistry:{getApiKeyAndHeaders:async()=>({ok:true,apiKey:'local'})},
  }),{code:'SDK_REACHED'});
});

test('pi extension exposes explicit CASE operations and list does not initialize a project', async t => {
  const module = await import('../integrations/pi/extension-core.mjs').catch(e => {
    if (e.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw e;
  });
  assert.equal(typeof module.default, 'function', 'pi extension is not implemented');
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-extension-')));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const registered = {};
  module.default({ registerTool: t => registered.tool = t, registerCommand: (n, c) => registered.command = c,
    on: () => {}, sendMessage: () => {} });
  assert.equal(registered.tool.name, 'case_workflow');
  const result = await registered.tool.execute('id', { operation: 'list' }, undefined, undefined, { cwd: project });
  assert.deepEqual(result.details.cases, []);
  assert.equal(fs.existsSync(path.join(project, '.case-agent')), false);
});
