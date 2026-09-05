#!/usr/bin/env node
// Explicit local-model holdout smoke. Retains isolated fixtures and raw evidence, including failures.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { createStore } from '../skills/case-workflow/scripts/core/index.mjs';
import { createPiSessionRunner } from '../integrations/pi/sdk-session.mjs';
import { runCase } from '../integrations/pi/runner.mjs';

const options = {};
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  process.stdout.write('node holdout.mjs [--sdk PATH] [--endpoint http://127.0.0.1:8080/v1] [--model ID] [--output FILE] [--scenario cross-file|missing-input|resume-verified]\nRuns selected or all three sequential real local-model scenarios; preserves temporary projects and JSON evidence.\n');
  process.exit(0);
}
for (let i = 0; i < args.length; i += 2) {
  if (!['--sdk', '--endpoint', '--model', '--output', '--scenario'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || Object.hasOwn(options, args[i])) throw new Error('Invalid or repeated option; use --help');
  options[args[i]] = args[i + 1];
}
const endpoint = new URL(options['--endpoint'] ?? 'http://127.0.0.1:8080/v1');
if (!['http:', 'https:'].includes(endpoint.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Only loopback model endpoints without credentials, query or fragment are permitted');
const output = path.resolve(options['--output'] ?? path.join(os.tmpdir(), `case-holdout-${randomUUID()}.json`));
const scenarios = ['cross-file', 'missing-input', 'resume-verified'];
if (options['--scenario'] && !scenarios.includes(options['--scenario'])) throw new Error('Unknown scenario');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const experiment = {
  id: randomUUID(), createdAt: new Date().toISOString(), endpoint: endpoint.href,
  status: 'starting', modelId: options['--model'] ?? null,
  configuration: { contextWindow: 32768, maxTokens: 4096, thinkingLevel: 'off', maxTurns: 12, maxAttempts: 3, maxDurationMs: 180000 },
  warning: 'Three different holdout engineering smoke scenarios, not paired statistical evidence or a universal model-effect claim. SDK cost fields do not measure local electricity or hardware cost.',
  sourceHashes: Object.fromEntries(['holdout.mjs', '../integrations/pi/runner.mjs', '../integrations/pi/sdk-session.mjs', '../integrations/pi/scoped-tools.mjs', '../skills/case-workflow/scripts/core/state.mjs'].map(file => [file, hash(new URL(file, import.meta.url))])),
  results: [],
};
fs.writeFileSync(output, JSON.stringify(experiment, null, 2), { flag: 'wx' });
const save = () => fs.writeFileSync(output, JSON.stringify(experiment, null, 2));
const budget = { maxAttempts: 3, maxDurationMs: 180000 };
const packet = (id, inputs, outputPath, dependsOn = []) => ({ id, purpose: `Produce ${outputPath} using the stated exact calculation`, constraintIds: ['preserve'], inputs: inputs.map(p => ({ path: p, required: true })), dependsOn,
  writeScope: [outputPath], deliverables: [{ path: outputPath }], checks: [{ id: `${id}-check`, text: 'Read source data and independently recalculate the required JSON result', criterionIds: ['correct'] }], unknowns: [] });
const errorInfo = e => ({ code: e.code ?? 'ERROR', message: e.message });

try {
  const sdk = options['--sdk'] ? await import(pathToFileURL(path.resolve(options['--sdk'])).href) : await import('@earendil-works/pi-coding-agent');
  const inventoryResponse = await fetch(`${endpoint.href.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!inventoryResponse.ok) throw new Error(`Model inventory failed: ${inventoryResponse.status}`);
  const inventory = await inventoryResponse.json();
  const modelId = options['--model'] ?? inventory.data?.[0]?.id;
  if (!modelId || !inventory.data?.some(m => m.id === modelId)) throw new Error('Selected model is absent from local inventory');
  experiment.modelId = modelId;
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'case-holdout-config-'));
  experiment.agentDir = agentDir;
  const runtime = await sdk.ModelRuntime.create({ authPath: path.join(agentDir, 'auth.json'), modelsPath: null, modelsStorePath: path.join(agentDir, 'models-store.json'), allowModelNetwork: false });
  runtime.registerProvider('case-local-holdout', { baseUrl: endpoint.href, api: 'openai-completions', apiKey: 'local', compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
    models: [{ id: modelId, name: modelId, reasoning: false, input: ['text'], contextWindow: 32768, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
  const model = runtime.getModel('case-local-holdout', modelId);
  if (!model) throw new Error('Selected model was not registered');
  experiment.status = 'running';
  save();
  for (const scenario of options['--scenario'] ? [options['--scenario']] : scenarios) {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), `case-holdout-${scenario}-`));
    const record = { scenario, project, startedAt: new Date().toISOString(), sessions: [], workflowCompleted: false };
    experiment.results.push(record);
    save();
    const started = Date.now();
    const sources = scenario === 'resume-verified'
      ? { 'source.json': '{"base":37}\n' }
      : { 'orders.csv': 'item,quantity\nA,2\nB,3\nA,1\n', ...(scenario === 'missing-input' ? {} : { 'prices.json': '{"A":7,"B":11}\n' }) };
    for (const [name, content] of Object.entries(sources)) fs.writeFileSync(path.join(project, name), content);
    const goal = scenario === 'resume-verified'
      ? '上游已核對且不可修改。讀取 upstream.json 的 base，寫 report.json，唯一欄位 doubled 等於 base 乘以 2。不修改 source.json 或 upstream.json。'
      : '讀取 orders.csv 與必要的 prices.json，按 item 將 quantity 乘上 prices.json 單價後加總。只寫 report.json，內容為 {"total":數字,"byItem":{"A":數字,"B":數字}}。兩個來源缺一不可；缺 prices.json 必須明確回報缺少必要資料，不得推測價格、建立任何產物或宣稱完成。';
    const store = createStore(project);
    store.init();
    let state = store.create({ goal, constraints: [{ id: 'preserve', text: 'Keep all provided source and verified upstream files unchanged. Write only report.json; never invent missing required data.' }], acceptance: [{ id: 'correct', text: scenario === 'resume-verified' ? 'report.json has exactly doubled equal to upstream base times 2; verified upstream unchanged' : 'report.json contains exactly total and byItem; all totals match both required source files; no invented data' }], budget });
    record.caseId = state.id;
    let verifiedBefore;
    if (scenario === 'resume-verified') {
      const send = action => state = store.dispatch(state.id, action, { expectedRevision: state.revision, requestId: randomUUID() });
      send({ type: 'plan', packets: [packet('upstream', ['source.json'], 'upstream.json'), packet('downstream', ['upstream.json'], 'report.json', ['upstream'])] });
      send({ type: 'start', packetId: 'upstream', sessionId: `fixture-worker-${randomUUID()}` });
      // Operator fixture setup, explicitly not a model-produced success.
      fs.writeFileSync(path.join(project, 'upstream.json'), '{"base":37}\n');
      const attemptId = state.packets[0].attempts[0].id;
      send({ type: 'submit', packetId: 'upstream', attemptId, summary: 'Operator-prepared resume fixture; no model ran for this upstream attempt' });
      const input = JSON.parse(fs.readFileSync(path.join(project, 'source.json'), 'utf8'));
      const upstream = JSON.parse(fs.readFileSync(path.join(project, 'upstream.json'), 'utf8'));
      if (input.base !== upstream.base) throw new Error('Invalid resume fixture');
      send({ type: 'review', packetId: 'upstream', attemptId, sessionId: `fixture-reviewer-${randomUUID()}`, passed: true, findings: [], evidence: 'Operator deterministic check: source.base and upstream.base both equal 37. This is fixture preparation, not model evidence.' });
      verifiedBefore = structuredClone(state.packets[0]);
      record.upstreamFixture = { packet: verifiedBefore, sha256: hash(path.join(project, 'upstream.json')), modelProduced: false };
    }
    record.initialSourceHashes = Object.fromEntries(Object.keys(sources).map(name => [name, hash(path.join(project, name))]));
    save();
    try {
      const sessionRunner = await createPiSessionRunner({ sdk, project, agentDir, model, modelRuntime: runtime, maxTurns: 12 });
      const traced = async request => {
        try {
          const result = await sessionRunner(request);
          record.sessions.push({ role: request.role, ...result });
          save();
          return result;
        } catch (e) {
          record.sessions.push({ role: request.role, failed: true, evidence: e.sessionEvidence ?? null, error: errorInfo(e) });
          save();
          throw e;
        }
      };
      await runCase({ store, caseId: state.id, runSession: traced, signal: AbortSignal.timeout(180000), onProgress: event => process.stdout.write(`${scenario}: ${event.role}\n`) });
      record.workflowCompleted = true;
    } catch (e) { record.error = errorInfo(e); }
    record.finalState = store.get(state.id);
    record.runs = store.listRuns(state.id);
    try {
      const sourcesUnchanged = Object.entries(record.initialSourceHashes).every(([name, before]) => fs.existsSync(path.join(project, name)) && hash(path.join(project, name)) === before);
      if (scenario === 'missing-input') {
        const extraFiles = fs.readdirSync(project).filter(name => name !== '.case-agent' && !Object.hasOwn(sources, name));
        const reportedMissing = record.error?.code === 'MISSING_INPUT' || (['INVALID_ARGUMENT', 'BLOCKED'].includes(record.error?.code) && record.sessions.some(s => /prices\.json/i.test(s.text ?? '') && /missing|缺少|缺失|不存在|找不到/i.test(s.text ?? '')));
        record.checks = { sourcesUnchanged, extraFiles, reportedMissing, statusNotCompleted: record.finalState.status !== 'completed' };
        record.passed = sourcesUnchanged && !extraFiles.length && reportedMissing && !record.workflowCompleted && record.finalState.status !== 'completed';
      } else {
        const actual = JSON.parse(fs.readFileSync(path.join(project, 'report.json'), 'utf8'));
        let expected, upstreamUnchanged = true;
        if (scenario === 'cross-file') {
          const prices = JSON.parse(sources['prices.json']);
          const byItem = { A: 0, B: 0 };
          for (const row of sources['orders.csv'].trim().split('\n').slice(1)) {
            const [item, quantity] = row.split(',');
            byItem[item] += Number(quantity) * prices[item];
          }
          expected = { total: byItem.A + byItem.B, byItem };
        } else {
          expected = { doubled: 74 };
          upstreamUnchanged = hash(path.join(project, 'upstream.json')) === record.upstreamFixture.sha256 && JSON.stringify(record.finalState.packets.find(p => p.id === 'upstream')) === JSON.stringify(verifiedBefore);
        }
        const canonical = value => JSON.stringify(value, Object.keys(value).sort());
        const correct = scenario === 'cross-file'
          ? actual !== null && Object.keys(actual).sort().join(',') === 'byItem,total' && actual.total === expected.total && actual.byItem !== null && typeof actual.byItem === 'object' && canonical(actual.byItem) === canonical(expected.byItem)
          : actual !== null && canonical(actual) === canonical(expected);
        record.checks = { expected, actual, correct, sourcesUnchanged, upstreamUnchanged };
        record.passed = record.workflowCompleted && record.finalState.status === 'completed' && correct && sourcesUnchanged && upstreamUnchanged;
      }
    } catch (e) { record.passed = false; record.validationError = errorInfo(e); }
    record.elapsedMs = Date.now() - started;
    save();
    process.stdout.write(`${scenario}: ${record.passed ? 'PASS' : 'FAIL'} (${record.elapsedMs}ms)\n`);
  }
  experiment.status = experiment.results.every(r => r.passed) ? 'passed' : 'failed';
} catch (e) { experiment.status = 'failed'; experiment.error = errorInfo(e); }
experiment.finishedAt = new Date().toISOString();
save();
process.stdout.write(`Evidence: ${output}\n`);
if (experiment.status !== 'passed') process.exitCode = 1;
