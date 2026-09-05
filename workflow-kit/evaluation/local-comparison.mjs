#!/usr/bin/env node
// Explicit opt-in local-model experiment. Generated projects and traces remain outside source files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { createStore } from '../skills/case-workflow/scripts/core/index.mjs';
import { createPiSessionRunner } from '../integrations/pi/sdk-session.mjs';
import { runCase, callSession } from '../integrations/pi/runner.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const endpoint = new URL(option('--endpoint', 'http://127.0.0.1:8080/v1'));
if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) throw new Error('This evaluation only permits loopback model endpoints');
const repeats = Number(option('--repeats', '1'));
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('repeats must be 1–10');
const output = path.resolve(option('--output', path.join(os.tmpdir(), `case-comparison-${randomUUID()}.json`)));
if (fs.existsSync(output)) throw new Error('Refusing to overwrite an existing experiment');
const sdkPath = option('--sdk', null);
const sdk = sdkPath ? await import(pathToFileURL(path.resolve(sdkPath)).href) : await import('@earendil-works/pi-coding-agent');
const inventoryResponse = await fetch(`${endpoint.href.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(5000) });
if (!inventoryResponse.ok) throw new Error(`Model inventory failed: ${inventoryResponse.status}`);
const inventory = await inventoryResponse.json();
const modelId = option('--model', inventory.data?.[0]?.id);
if (!modelId) throw new Error('No local model found');
const experiment = { id: randomUUID(), createdAt: new Date().toISOString(), modelId, endpoint: endpoint.href,
  sourceHashes: Object.fromEntries(['../integrations/pi/runner.mjs', '../integrations/pi/sdk-session.mjs', '../integrations/pi/scoped-tools.mjs'].map(file => [file, createHash('sha256').update(fs.readFileSync(new URL(file, import.meta.url))).digest('hex')])),
  configuration: { contextWindow: 32768, maxTokens: 4096, thinkingLevel: 'off', maxTurns: 12, repeats },
  warning: 'Small paired engineering probe, not statistical or universal evidence. No pricing claim for local inference.', results: [] };
const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'case-pi-config-'));
const runtime = await sdk.ModelRuntime.create({ authPath: path.join(agentDir, 'auth.json'), modelsPath: null,
  modelsStorePath: path.join(agentDir, 'models-store.json'), allowModelNetwork: false });
runtime.registerProvider('case-local-evaluation', { baseUrl: endpoint.href, api: 'openai-completions', apiKey: 'local',
  compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
  models: [{ id: modelId, name: modelId, reasoning: false, input: ['text'], contextWindow: 32768, maxTokens: 4096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
const model = runtime.getModel('case-local-evaluation', modelId);
if (!model) throw new Error('The selected model was not registered');
const goal = '修正 quote.mjs 的 quote(value) CSV 欄位函式。輸入皆為字串：含逗號、雙引號、CR 或 LF 時，整個欄位加雙引號，內部雙引號加倍；其他字串原樣回傳。保留具名匯出 quote，不新增依賴。只修改 quote.mjs。';
const probes = [['plain', 'plain'], ['a,b', '"a,b"'], ['a"b', '"a""b"'], ['a\nb', '"a\nb"'], ['a\rb', '"a\rb"'], ['', '']];
for (let repeat = 0; repeat < repeats; repeat++) {
  for (const mode of (repeat % 2 ? ['separated', 'single'] : ['single', 'separated'])) {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), `case-${mode}-`));
    fs.writeFileSync(path.join(project, 'quote.mjs'), 'export function quote(value) { return value; }\n');
    fs.writeFileSync(path.join(project, 'requirements.txt'), goal);
    const record = { repeat, mode, project, startedAt: new Date().toISOString(), sessions: [] };
    experiment.results.push(record);
    fs.writeFileSync(output, JSON.stringify(experiment, null, 2));
    const start = Date.now();
    const sessionRunner = await createPiSessionRunner({ sdk, project, agentDir, model, modelRuntime: runtime, maxTurns: 12 });
    const traced = async request => {
      try {
        const result = await sessionRunner(request);
        record.sessions.push({ role: request.role, ...result });
        return result;
      } catch (error) {
        record.sessions.push({ role: request.role, failed: true, evidence: error.sessionEvidence ?? null, error: error.message });
        throw error;
      }
    };
    try {
      if (mode === 'single') {
        await callSession(traced, { role: 'worker', prompt: `${goal}\nRead the existing files, implement the correction, then check it against the requirements. Return JSON {"summary":"result and checks"}.`,
          writeScope: ['quote.mjs'], signal: AbortSignal.timeout(300000) });
      } else {
        const store = createStore(project);
        store.init();
        const state = store.create({ goal, constraints: [{ id: 'c1', text: 'Only change quote.mjs; keep named export quote; no dependencies.' }],
          acceptance: [{ id: 'a1', text: 'CSV escaping handles comma, quotes, CR, LF, plain text and empty string.' }],
          budget: { maxAttempts: 3, maxDurationMs: 300000 } });
        record.caseId = state.id;
        await runCase({ store, caseId: state.id, runSession: traced, onProgress: event => process.stdout.write(`${mode}: ${event.role}\n`) });
      }
      record.workflowCompleted = true;
    } catch (e) { record.workflowCompleted = false; record.error = { code: e.code ?? 'ERROR', message: e.message }; }
    // Artifact correctness and protocol completion are independent outcomes.
    try {
      const module = await import(`${pathToFileURL(path.join(project, 'quote.mjs')).href}?evaluation=${randomUUID()}`);
      record.checks = probes.map(([input, expected]) => {
        try { const actual = module.quote(input); return { input, expected, actual, passed: actual === expected }; }
        catch (e) { return { input, expected, passed: false, error: e.message }; }
      });
      record.artifactPassed = record.checks.every(c => c.passed) && fs.readFileSync(path.join(project, 'requirements.txt'), 'utf8') === goal;
    } catch (e) { record.artifactPassed = false; record.artifactError = e.message; }
    record.passed = record.workflowCompleted && record.artifactPassed;
    record.elapsedMs = Date.now() - start;
    fs.writeFileSync(output, JSON.stringify(experiment, null, 2));
    process.stdout.write(`${mode} repeat ${repeat + 1}: ${record.passed ? 'PASS' : 'FAIL'} (${record.elapsedMs}ms)\n`);
  }
}
process.stdout.write(`Evidence: ${output}\n`);
