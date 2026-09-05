#!/usr/bin/env node
// Opt-in native package loading and real extension-tool execution against a loopback model.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const endpoint = new URL(option('--endpoint', 'http://127.0.0.1:8080/v1'));
if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) throw new Error('Only loopback model endpoints are allowed');
const installProject = path.resolve(option('--install-project', '.npm-cache'));
const sdkPath = path.resolve(option('--sdk', '.npm-cache/pi-host-validation/node_modules/@earendil-works/pi-coding-agent/dist/index.js'));
const output = path.resolve(option('--output', path.join(os.tmpdir(), `case-native-smoke-${randomUUID()}.json`)));
if (fs.existsSync(output)) throw new Error('Refusing to overwrite an existing smoke record');
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'case-native-project-'));
const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'case-native-agent-'));
const record = { createdAt: new Date().toISOString(), sdkPath, installProject, project, agentDir, endpoint: endpoint.href, phases: [], passed: false };
const save = () => fs.writeFileSync(output, JSON.stringify(record, null, 2));
const start = Date.now();
try {
  const sdk = await import(pathToFileURL(sdkPath).href);
  const settingsManager = sdk.SettingsManager.create(installProject, agentDir);
  const loader = new sdk.DefaultResourceLoader({ cwd: installProject, agentDir, settingsManager, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
  await loader.reload();
  const loaded = loader.getExtensions();
  record.loadErrors = loaded.errors;
  const extension = loaded.extensions.find(extension => extension.tools.has('case_workflow'));
  if (!extension) throw new Error(`Native CASE extension was not loaded: ${JSON.stringify(loaded.errors)}`);
  record.extension = { path: extension.path, resolvedPath: extension.resolvedPath };
  record.phases.push('native-package-loaded');
  save();
  const inventoryResponse = await fetch(`${endpoint.href.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(5000) });
  if (!inventoryResponse.ok) throw new Error(`Model inventory returned ${inventoryResponse.status}`);
  const inventory = await inventoryResponse.json();
  const modelId = option('--model', inventory.data?.[0]?.id);
  if (!modelId) throw new Error('No local model available');
  record.modelId = modelId;
  const runtime = await sdk.ModelRuntime.create({ authPath: path.join(agentDir, 'auth.json'), modelsPath: null, modelsStorePath: path.join(agentDir, 'models-store.json'), allowModelNetwork: false });
  runtime.registerProvider('case-native-smoke', {
    baseUrl: endpoint.href, api: 'openai-completions', apiKey: 'local',
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
    models: [{ id: modelId, name: modelId, reasoning: false, input: ['text'], contextWindow: 32768, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  });
  const modelRegistry = new sdk.ModelRegistry(runtime);
  const ctx = { cwd: project, model: runtime.getModel('case-native-smoke', modelId), modelRegistry, thinkingLevel: 'off', ui: { notify: message => process.stdout.write(`${message}\n`) } };
  fs.writeFileSync(path.join(project, 'input.txt'), 'native smoke source\n');
  const tool = extension.tools.get('case_workflow').definition;
  const created = await tool.execute('create-native', { operation: 'create', contract: {
    goal: 'Read input.txt and create result.txt containing exactly NATIVE_CASE_OK followed by a newline. Only write result.txt. Use one packet.',
    constraints: [{ id: 'c1', text: 'Keep input.txt unchanged; only create result.txt.' }],
    acceptance: [{ id: 'a1', text: 'result.txt contains exactly NATIVE_CASE_OK followed by one newline.' }],
    budget: { maxAttempts: 3, maxDurationMs: 240000 },
  } }, undefined, undefined, ctx);
  record.caseId = created.details.id;
  record.phases.push('native-tool-create');
  save();
  const result = await tool.execute('run-native', { operation: 'run', caseId: record.caseId }, AbortSignal.timeout(240000), undefined, ctx);
  record.result = result.details;
  record.phases.push('native-tool-run-returned');
  record.checks = { completed: result.details.status === 'completed', outputExact: fs.readFileSync(path.join(project, 'result.txt'), 'utf8') === 'NATIVE_CASE_OK\n', inputUnchanged: fs.readFileSync(path.join(project, 'input.txt'), 'utf8') === 'native smoke source\n' };
  record.passed = Object.values(record.checks).every(Boolean);
} catch (failure) {
  record.error = { code: failure.code ?? 'ERROR', message: failure.message, stack: failure.stack };
  process.exitCode = 1;
} finally {
  record.elapsedMs = Date.now() - start;
  if (!record.passed) process.exitCode = 1;
  save();
  process.stdout.write(`${record.passed ? 'PASS' : 'FAIL'} native extension smoke\nEvidence: ${output}\n`);
}
