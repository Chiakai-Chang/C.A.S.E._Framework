import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const toolsModule = await import('../integrations/pi/scoped-tools.mjs').catch(e => {
    if (e.code === 'ERR_MODULE_NOT_FOUND')
        return {};
    throw e;
});
test('declared new directory allows its first nested deliverable without widening scope', async (t) => {
    const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-new-dir-')));
    t.after(() => fs.rmSync(project, { recursive: true, force: true }));
    const write = toolsModule.createScopedTools({ project, role: 'worker', writeScope: ['reports'] }).find(t => t.name === 'case_write');
    await write.execute('1', { path: 'reports/nested/result.txt', content: 'result' });
    assert.equal(fs.readFileSync(path.join(project, 'reports/nested/result.txt'), 'utf8'), 'result');
    for (const path of ['reports-other/result.txt', 'reports/../escape.txt', 'reports/.case-agent/state.json'])
        await assert.rejects(write.execute('2', { path, content: 'bad' }), { code: 'UNSAFE_TOOL_PATH' });
});
test('invalid check timeouts are rejected before starting a process', async (t) => {
    const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-timeout-')));
    t.after(() => fs.rmSync(project, { recursive: true, force: true }));
    for (const timeoutMs of [0, -1, NaN, Infinity, '100']) {
        const check = toolsModule.createScopedTools({ project, role: 'reviewer', checks: { bad: { command: process.execPath, args: ['-e', ''], timeoutMs } } }).find(t => t.name === 'case_check');
        await assert.rejects(check.execute('1', { id: 'bad' }), { code: 'INVALID_CHECK_CONFIG' });
    }
});
test('worker file writes are restricted to declared paths and cannot change CASE state', async (t) => {
    assert.equal(typeof toolsModule.createScopedTools, 'function', 'scoped tools are not implemented');
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-tools-')));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, 'source.txt'), 'keep');
    const tools = toolsModule.createScopedTools({ project: dir, role: 'worker', writeScope: ['output.txt'] });
    const write = tools.find(x => x.name === 'case_write');
    await write.execute('1', { path: 'output.txt', content: 'result' });
    assert.equal(fs.readFileSync(path.join(dir, 'output.txt'), 'utf8'), 'result');
    for (const target of ['source.txt', '../escape.txt', '.case-agent/workflow.json']) {
        await assert.rejects(write.execute('2', { path: target, content: 'bad' }));
    }
    assert.equal(fs.readFileSync(path.join(dir, 'source.txt'), 'utf8'), 'keep');
});
test('review tools can inspect actual files but have no write or arbitrary shell tool', async (t) => {
    assert.equal(typeof toolsModule.createScopedTools, 'function', 'scoped tools are not implemented');
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-read-')));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, 'source.txt'), 'grounded material');
    const tools = toolsModule.createScopedTools({ project: dir, role: 'reviewer' });
    assert.deepEqual(tools.map(x => x.name).sort(), ['case_list', 'case_read']);
    const result = await tools.find(x => x.name === 'case_read').execute('1', { path: 'source.txt' });
    assert.equal(result.content[0].text, 'grounded material');
});
test('approved checks execute argv without interpreting model-provided shell text', async (t) => {
    assert.equal(typeof toolsModule.createScopedTools, 'function', 'scoped tools are not implemented');
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-check-')));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const tools = toolsModule.createScopedTools({ project: dir, role: 'reviewer', checks: {
            smoke: { command: process.execPath, args: ['-e', 'process.stdout.write("ok")'] },
        } });
    const check = tools.find(x => x.name === 'case_check');
    const result = await check.execute('1', { id: 'smoke' });
    assert.equal(result.details.exitCode, 0);
    assert.match(result.content[0].text, /ok/);
    await assert.rejects(check.execute('2', { id: 'smoke; echo unexpected' }));
});
