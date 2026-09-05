import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../../skills/case-workflow/scripts/core/index.mjs';
import { runCase } from './runner.mjs';
import { createPiSessionRunner } from './sdk-session.mjs';

const reply = details => ({ content: [{ type: 'text', text: JSON.stringify(details) }], details });

export default function caseExtension(pi, sdk) {
  const active = new Map();
  const stop = () => { for (const controller of active.values()) controller.abort(); };
  pi.on('session_shutdown', stop);

  async function operate(params, ctx, signal) {
    const store = createStore(ctx.cwd);
    if (params.operation === 'list' && !fs.existsSync(path.join(ctx.cwd, '.case-agent'))) return { cases: [] };
    switch (params.operation) {
      case 'list': return { cases: store.list() };
      case 'init': return store.init();
      case 'migrate': return store.migrate();
      case 'create': store.init(); return store.create(params.contract);
      case 'show': return store.get(params.caseId);
      case 'retry': {
        if (active.has(ctx.cwd)) throw new Error('Stop and await the active workflow before retry');
        const state = store.get(params.caseId);
        if (state.packets.some(p => p.status === 'running')) throw new Error('Confirm the old process has stopped, then recover through the explicit core action');
        return store.dispatch(params.caseId, { type: 'retry', packetId: params.packetId, reason: params.reason },
          { expectedRevision: state.revision, requestId: crypto.randomUUID() });
      }
      case 'stop': active.get(ctx.cwd)?.abort(); return { stopRequested: active.has(ctx.cwd) };
      case 'run': break;
      default: throw new Error('Unknown CASE operation');
    }
    if (active.has(ctx.cwd)) throw new Error('A CASE workflow is already active in this project');
    if (!ctx.model) throw new Error('Select the intended model in pi first');
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    active.set(ctx.cwd, controller);
    try {
      if (!sdk) throw new Error('The native pi entry must provide its SDK');
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
      if (!auth.ok) throw new Error(auth.error);
      // Isolated runtime files; credentials are registered in memory, not written into the project.
      const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'case-pi-runtime-'));
      const modelRuntime = await sdk.ModelRuntime.create({ authPath: path.join(runtimeDir, 'auth.json'), modelsPath: null,
        modelsStorePath: path.join(runtimeDir, 'models-store.json'), allowModelNetwork: false });
      const config = ctx.modelRegistry.getRegisteredProviderConfig(ctx.model.provider);
      modelRuntime.registerProvider(ctx.model.provider, { ...config, baseUrl: auth.baseUrl ?? ctx.model.baseUrl,
        api: ctx.model.api, apiKey: auth.apiKey ?? 'local', headers: auth.headers, models: [ctx.model] });
      const runSession = await createPiSessionRunner({ project: ctx.cwd, agentDir: sdk.getAgentDir(), model: ctx.model,
        modelRuntime, sdk, thinkingLevel: ctx.thinkingLevel ?? 'off' });
      const result = await runCase({ store, caseId: params.caseId, runSession, signal: controller.signal,
        onProgress: event => ctx.ui?.notify(`CASE：${event.role}`, 'info') });
      return { id: result.state.id, status: result.state.status, integration: result.state.integration, runId: result.run?.id ?? null };
    } finally {
      signal?.removeEventListener('abort', abort);
      active.delete(ctx.cwd);
    }
  }
  pi.registerTool({
    name: 'case_workflow', label: 'CASE 工作流程',
    description: 'Keep a durable goal and run planner/worker/reviewer/integrator in fresh contexts using the currently selected model. Use only for work needing handoff or bounded packets. create requires a contract with goal, constraints [{id,text}], acceptance [{id,text}], and budget {maxAttempts,maxDurationMs}. Never migrate existing v1 data without explicit user intent. run writes only declared packet files using scoped tools; it does not inherit arbitrary shell commands.',
    parameters: { type: 'object', properties: {
      operation: { type: 'string', enum: ['list', 'init', 'migrate', 'create', 'show', 'run', 'retry', 'stop'] },
      caseId: { type: 'string' }, packetId: { type: 'string' }, reason: { type: 'string' }, contract: { type: 'object', additionalProperties: true },
    }, required: ['operation'], additionalProperties: false },
    async execute(_id, params, signal, _update, ctx) { return reply(await operate(params, ctx, signal)); },
  });
  pi.registerCommand('case', {
    description: 'CASE：list | show ID | run ID | stop',
    async handler(args, ctx) {
      const [operation = 'list', caseId, ...extra] = args.trim().split(/\s+/).filter(Boolean);
      if (!['list', 'show', 'run', 'stop'].includes(operation) || extra.length) {
        ctx.ui.notify('用法：/case list、/case show ID、/case run ID、/case stop', 'error');
        return;
      }
      try {
        const result = await operate({ operation, caseId }, ctx, ctx.signal);
        pi.sendMessage({ customType: 'case-status', content: JSON.stringify(result, null, 2), display: true });
      } catch (error) { ctx.ui.notify(`CASE：${error.message}`, 'error'); }
    },
  });
}
