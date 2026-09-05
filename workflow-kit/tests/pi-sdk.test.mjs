import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const adapter = await import('../integrations/pi/sdk-session.mjs').catch(e => {
    if (e.code === 'ERR_MODULE_NOT_FOUND')
        return {};
    throw e;
});
test('SDK failure and cancellation retain observations and available costs before disposal', async (t) => {
    const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-sdk-failure-')));
    t.after(() => fs.rmSync(project, { recursive: true, force: true }));
    for (const mode of ['failure', 'cancel', 'unknown']) {
        let disposed = false, listener;
        const controller = new AbortController();
        const sdk = { SettingsManager: { inMemory: v => v }, SessionManager: { inMemory: () => ({}) }, DefaultResourceLoader: class {
                async reload() {
                }
            },
            async createAgentSession() {
                return { session: { sessionId: `sdk-${mode}`, subscribe(fn) {
                            listener = fn;
                            return () => {
                            };
                        }, async prompt() {
                            listener({ type: 'tool_execution_end', toolName: 'case_write', result: { content: [{ type: 'text', text: 'partial output written' }] } });
                            if (mode === 'cancel')
                                controller.abort();
                            throw new Error('prompt stopped');
                        }, getSessionStats() {
                            assert.equal(disposed, false);
                            if (mode === 'unknown')
                                throw new Error('stats unavailable');
                            return { tokens: { input: 21, output: 5 }, toolCalls: 1, cost: 0.01 };
                        }, getLastAssistantText: () => '', abort: async () => {
                        }, dispose() {
                            disposed = true;
                        } } };
            } };
        const run = await adapter.createPiSessionRunner({ project, agentDir: project, model: { id: 'local', provider: 'local' }, modelRuntime: {}, sdk });
        await assert.rejects(run({ role: 'worker', prompt: 'work', writeScope: ['out'], onStart: () => {
            }, signal: controller.signal }), failure => {
            assert.equal(failure.sessionEvidence.observations[0].toolName, 'case_write');
            assert.equal(failure.sessionEvidence.usage === 'unknown' ? 'unknown' : failure.sessionEvidence.usage.input, mode === 'unknown' ? 'unknown' : 21);
            if (mode === 'cancel')
                assert.equal(failure.code, 'CANCELLED');
            return true;
        });
        assert.equal(disposed, true);
    }
});
test('SDK session factory requires explicit model and does not fall back to a cloud default', async () => {
    assert.equal(typeof adapter.createPiSessionRunner, 'function', 'SDK adapter is not implemented');
    await assert.rejects(adapter.createPiSessionRunner({ project: '.', agentDir: '.', sdk: {} }), { code: 'MODEL_REQUIRED' });
});
test('SDK adapter produces fresh bounded sessions and captures tool evidence', async (t) => {
    assert.equal(typeof adapter.createPiSessionRunner, 'function', 'SDK adapter is not implemented');
    const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-sdk-')));
    t.after(() => fs.rmSync(project, { recursive: true, force: true }));
    let next = 0;
    let disposed = 0;
    const inputs = [];
    const sdk = {
        SettingsManager: { inMemory: value => value },
        SessionManager: { inMemory: () => ({ id: `sdk-${++next}` }) },
        DefaultResourceLoader: class {
            constructor(options) {
                this.options = options;
            }
            async reload() {
            }
        },
        async createAgentSession(options) {
            inputs.push(options);
            let listener;
            return { session: {
                    sessionId: options.sessionManager.id,
                    subscribe(fn) {
                        listener = fn;
                        return () => {
                        };
                    },
                    async prompt() {
                        listener({ type: 'tool_execution_end', toolName: 'case_read', result: { content: [{ type: 'text', text: 'observed' }] } });
                    },
                    getLastAssistantText: () => '{"passed":true}',
                    getSessionStats: () => ({ tokens: { input: 12, output: 8 }, toolCalls: 1, cost: 0 }),
                    abort: async () => {
                    }, dispose() {
                        disposed++;
                    },
                } };
        },
    };
    const run = await adapter.createPiSessionRunner({ project, agentDir: project, sdk, modelRuntime: {},
        model: { id: 'local', provider: 'local', contextWindow: 8192 }, maxTurns: 5 });
    const starts = [];
    const replies = [];
    for (const role of ['worker', 'reviewer'])
        replies.push(await run({ role, prompt: 'bounded packet', writeScope: ['output.txt'], onStart: id => starts.push(id) }));
    assert.deepEqual(starts, ['sdk-1', 'sdk-2']);
    assert.equal(disposed, 2);
    assert.equal(replies[0].observations[0].toolName, 'case_read');
    assert.equal(replies[1].usage.input, 12);
    assert.equal(inputs[0].resourceLoader.options.noExtensions, true);
    assert.equal(inputs[0].resourceLoader.options.noSkills, true);
    assert.equal(inputs[0].resourceLoader.options.noContextFiles, false);
    assert.deepEqual(inputs[1].tools.sort(), ['case_list', 'case_read']);
});
