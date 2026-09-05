#!/usr/bin/env node
// A deliberately incomplete operator plan tests real local-model feedback and recovery.
// This is not a baseline comparison, hidden holdout, or model-quality improvement claim.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { createStore } from '../skills/case-workflow/scripts/core/index.mjs';
import { createPiSessionRunner } from '../integrations/pi/sdk-session.mjs';
import { runCase } from '../integrations/pi/runner.mjs';
import { approveChecks, createCheckExecutor } from '../integrations/pi/approved-checks.mjs';

const argv = process.argv.slice(2), options = {};
if (argv.length === 1 && argv[0] === '--help') {
  process.stdout.write('feedback-probe.mjs --sdk PATH --output FILE [--endpoint http://127.0.0.1:8080/v1] [--max-duration-ms 300000]\nSynthetic orders/prices/returns/rates, deliberately missing preparation packet. Local model only; preserves all results including failures.\n');
  process.exit(0);
}
for (let i = 0; i < argv.length; i += 2) {
  if (!['--sdk', '--output', '--endpoint', '--max-duration-ms'].includes(argv[i]) || !argv[i + 1] || Object.hasOwn(options, argv[i])) throw new Error('Use --help');
  options[argv[i]] = argv[i + 1];
}
if (!options['--sdk'] || !options['--output']) throw new Error('--sdk and --output required');
const durationMs = Number(options['--max-duration-ms'] ?? 300000);
if (!Number.isSafeInteger(durationMs) || durationMs < 1000 || durationMs > 900000) throw new Error('Duration must be 1000–900000ms');
const endpoint = new URL(options['--endpoint'] ?? 'http://127.0.0.1:8080/v1');
if (!['http:', 'https:'].includes(endpoint.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Loopback endpoint only');
const output = path.resolve(options['--output']);
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'case-feedback-probe-'));
const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'case-feedback-model-'));
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sources = {
  'orders.json': [{ id: 'o1', item: 'A', quantity: 2 }, { id: 'o2', item: 'B', quantity: 3 }],
  'prices.json': { A: { amount: 10, currency: 'USD' }, B: { amount: 8, currency: 'EUR' } },
  'returns.json': [{ orderId: 'o2', quantity: 1 }],
  'rates.json': { USD: 32, EUR: 35 },
};
for (const [file, value] of Object.entries(sources)) fs.writeFileSync(path.join(project, file), JSON.stringify(value, null, 2));
fs.writeFileSync(path.join(project, 'AGENTS.md'), '僅使用本機資料，不修改原始來源；缺外部資料不可猜測。');
const sourceHashes = Object.fromEntries([...Object.keys(sources), 'AGENTS.md'].map(file => [file, hash(path.join(project, file))]));
const codeFiles = ['feedback-probe.mjs', '../integrations/pi/runner.mjs', '../integrations/pi/sdk-session.mjs', '../integrations/pi/scoped-tools.mjs', '../integrations/pi/approved-checks.mjs', '../skills/case-workflow/scripts/core/state.mjs', '../skills/case-workflow/scripts/core/amendments.mjs', '../skills/case-workflow/scripts/core/contracts.mjs', '../skills/case-workflow/scripts/core/store.mjs', '../skills/case-workflow/scripts/core/context.mjs', '../skills/case-workflow/scripts/core/project-policy.mjs'];
const evidence = { createdAt: new Date().toISOString(), project, agentDir, endpoint: endpoint.href, status: 'starting',
  design: 'One engineering probe. Operator deliberately supplies a missing prerequisite plan, not an unbiased autonomous planning benchmark. No A/B quality inference.',
  configuration: { contextWindow: 32768, maxTokens: 4096, maxTurns: 12, maxAttempts: 5, maxDurationMs: durationMs, thinkingLevel: 'off' },
  sourceHashes, codeHashes: Object.fromEntries(codeFiles.map(f => [f, hash(new URL(f, import.meta.url))])), sessions: [] };
fs.writeFileSync(output, JSON.stringify(evidence, null, 2), { flag: 'wx' });
const save = () => fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
const store = createStore(project); store.init();
store.setProject({ summary: '以可追溯資料完成本機報告', constraints: [{ id: 'local', text: '來源不可更動；缺外部資料不可猜測。' }], sources: ['AGENTS.md'] }, { expectedRevision: 0, reason: 'Operator-authorized synthetic probe' });
let state = store.create({
  goal: '讀取 orders.json、prices.json、returns.json、rates.json。依 orderId 扣除退貨數量，netAmount=netQuantity*單價，netTwd=netAmount*對應匯率。先產出 normalized.json：{"lines":[{"orderId":字串,"netQuantity":數字,"currency":字串,"netAmount":數字,"netTwd":數字}]}，每筆訂單一列。再只依已驗證 normalized.json 產出 report.json：{"netTwd":總和,"byCurrency":{"USD":原幣淨額總和,"EUR":原幣淨額總和},"sourceFiles":["orders.json","prices.json","returns.json","rates.json"]}。缺少 normalized.json 時需要規劃者補前置包，不是外部缺料。不得改來源。',
  constraints: [{ id: 'preserve', text: 'Only normalized.json and report.json may be written; report packet must consume verified normalization, not recompute raw sources.' }],
  acceptance: [{ id: 'normalization', text: 'normalized.json contains exactly the stated fields, one line per order after returns and currency conversion.' }, { id: 'report', text: 'report.json exactly matches verified normalized amounts and identifies all four raw sources.' }],
  writeScope: ['normalized.json', 'report.json'], budget: { maxAttempts: 5, maxDurationMs: durationMs },
});
state = store.dispatch(state.id, { type: 'plan', packets: [{ id: 'report', purpose: 'Consume verified normalized.json and write report.json. It has not been prepared yet; preparation is outside this packet writeScope. Report the missing prerequisite to the planner.',
  constraintIds: ['preserve', 'project:local'], inputs: [...Object.keys(sources).map(p => ({ path: p, required: true, delivery: 'indexed' })), { path: 'normalized.json', required: false }],
  dependsOn: [], writeScope: ['report.json'], deliverables: [{ path: 'report.json' }],
  checks: [{ id: 'full', text: 'Check normalization provenance and report sums', criterionIds: ['normalization', 'report'] }], unknowns: ['Missing preparation packet'] }] }, { expectedRevision: state.revision, requestId: randomUUID() });
evidence.initialState = state;
const checkCode = `const fs=require('node:fs'),assert=require('node:assert/strict');const report=JSON.parse(fs.readFileSync('report.json','utf8'));assert.deepEqual(report,{netTwd:1200,byCurrency:{USD:20,EUR:16},sourceFiles:['orders.json','prices.json','returns.json','rates.json']});const norm=JSON.parse(fs.readFileSync('normalized.json','utf8'));assert.deepEqual(norm,{lines:[{orderId:'o1',netQuantity:2,currency:'USD',netAmount:20,netTwd:640},{orderId:'o2',netQuantity:2,currency:'EUR',netAmount:16,netTwd:560}]});process.stdout.write('Exact normalization, return adjustment, currency and report checks passed');`;
const approved = approveChecks({ exact: { command: process.execPath, args: ['-e', checkCode] } });
const executeChecks = createCheckExecutor(project, approved);
const started = Date.now();
try {
  const sdk = await import(pathToFileURL(path.resolve(options['--sdk'])).href);
  const response = await fetch(`${endpoint.href.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!response.ok) throw new Error(`Model inventory HTTP ${response.status}`);
  const modelId = (await response.json()).data?.[0]?.id;
  if (!modelId) throw new Error('No local model');
  evidence.modelId = modelId;
  const runtime = await sdk.ModelRuntime.create({ authPath: path.join(agentDir, 'auth.json'), modelsPath: null, modelsStorePath: path.join(agentDir, 'models-store.json'), allowModelNetwork: false });
  // Record only names after provider payload construction and before HTTP.
  // Preserve any native hook and its return; do not retain secrets or messages.
  evidence.providerToolNames = [];
  const tracedSdk = { ...sdk, async createAgentSession(sessionOptions) {
    const created = await sdk.createAgentSession(sessionOptions);
    const originalPayload = created.session.agent.onPayload;
    created.session.agent.onPayload = async (payload, selectedModel) => {
      const transformed = await originalPayload?.(payload, selectedModel);
      const effective = transformed ?? payload;
      evidence.providerToolNames.push({ at: new Date().toISOString(), sessionId: created.session.sessionId, names: (effective.tools ?? []).map(tool => tool.function?.name ?? tool.name) });
      save(); return transformed;
    };
    return created;
  } };
  runtime.registerProvider('case-local-feedback', { baseUrl: endpoint.href, api: 'openai-completions', apiKey: 'local', compat: { supportsDeveloperRole: false, supportsReasoningEffort: false }, models: [{ id: modelId, name: modelId, reasoning: false, input: ['text'], contextWindow: 32768, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
  const runSession = await createPiSessionRunner({ sdk: tracedSdk, project, agentDir, model: runtime.getModel('case-local-feedback', modelId), modelRuntime: runtime, checks: approved, maxTurns: 12 });
  evidence.status = 'running'; save();
  await runCase({ store, caseId: state.id, executeChecks, signal: AbortSignal.timeout(durationMs), onProgress: e => process.stdout.write(`${e.role}\n`), runSession: async request => {
    try {
      const reply = await runSession(request);
      evidence.sessions.push({ role: request.role, promptChars: request.prompt.length, ...reply }); save(); return reply;
    } catch (error) { evidence.sessions.push({ role: request.role, promptChars: request.prompt.length, error: { code: error.code ?? 'ERROR', message: error.message }, sessionEvidence: error.sessionEvidence ?? null }); save(); throw error; }
  } });
  evidence.status = 'completed';
} catch (error) { evidence.status = 'failed'; evidence.error = { code: error.code ?? 'ERROR', message: error.message }; }
evidence.elapsedMs = Date.now() - started;
evidence.finalState = store.get(state.id); evidence.runs = store.listRuns(state.id);
evidence.sourcesUnchanged = Object.entries(sourceHashes).every(([f, expected]) => hash(path.join(project, f)) === expected);
evidence.independentChecks = await executeChecks({ role: 'integrator', state: evidence.finalState });
evidence.feedbackObserved = evidence.runs.some(r => r.feedback?.some(f => f.kind === 'changeRequest'));
evidence.passed = evidence.status === 'completed' && evidence.sourcesUnchanged && evidence.feedbackObserved && evidence.independentChecks.every(c => c.exitCode === 0 && !c.error);
evidence.artifacts = Object.fromEntries(['normalized.json', 'report.json'].filter(f => fs.existsSync(path.join(project, f))).map(f => [f, fs.readFileSync(path.join(project, f), 'utf8')]));
save(); process.stdout.write(`${evidence.passed ? 'PASS' : 'FAIL'} ${evidence.elapsedMs}ms; ${output}\n`);
if (!evidence.passed) process.exitCode = 1;
