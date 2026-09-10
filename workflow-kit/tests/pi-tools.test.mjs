import test from 'node:test';
import {createHash} from 'node:crypto';
import {createScopedTools as scopedSearchTools} from '../integrations/pi/scoped-tools.mjs';

test('literal search uses existing read boundaries without giving a planner writes',async t=>{
  const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-search-scope-')));
  t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
  fs.writeFileSync(path.join(project,'source.txt'),'first\nconst VALUE = 7;\nlast');
  const tools=scopedSearchTools({project,role:'planner'}),search=tools.find(t=>t.name==='case_search');
  assert.ok(search,'read-only roles need exact source lookup');
  assert.ok(!tools.some(t=>t.name==='case_write'));
  const result=await search.execute('lookup',{path:'source.txt',query:'VALUE'});
  assert.deepEqual(result.details.matches,[{line:2,text:'const VALUE = 7;'}]);
  assert.match(result.content[0].text,/const VALUE = 7/);
  for(const target of ['../private','.git/config','.pi/settings.json','C:/private'])
    await assert.rejects(search.execute('outside',{path:target,query:'secret'}),{code:'UNSAFE_TOOL_PATH'});
});
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('localized edits preserve unrelated bytes and refuse stale or ambiguous changes', async t => {
    const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-edit-')));
    t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
    const file=path.join(project,'out.json');
    const original='\uFEFF{\r\n  "allowed": true,\r\n  "tags": ["help", "封裝設定"]\r\n}\r\n';
    fs.writeFileSync(file,original);
    const hash=s=>createHash('sha256').update(s).digest('hex');
    const edit=scopedSearchTools({project,role:'worker',writeScope:['out.json']}).find(t=>t.name==='case_edit');
    assert.ok(edit,'workers need a localized repair capability');
    const args={path:'out.json',sourceSha256:hash(original),oldText:'"allowed": true',newText:'"allowed": false'};
    for(const change of [{sourceSha256:'0'.repeat(64)},{oldText:'absent'},{oldText:'"'},{oldText:''},{path:'source.json'},{path:'../out.json'},{path:'.git/config'},{path:'AGENTS.md'}]) {
        await assert.rejects(edit.execute('invalid',{...args,...change}));
        assert.equal(fs.readFileSync(file,'utf8'),original);
    }
    const result=await edit.execute('fix',args);
    const expected='\uFEFF{\r\n  "allowed": false,\r\n  "tags": ["help", "封裝設定"]\r\n}\r\n';
    assert.deepEqual(fs.readFileSync(file),Buffer.from(expected));
    assert.equal(result.details.sourceSha256,hash(expected));
    assert.equal(result.details.previousSha256,hash(original));
    await assert.rejects(edit.execute('stale-replay',args));
    fs.writeFileSync(file,'a😀b');
    await assert.rejects(edit.execute('split-surrogate',{...args,sourceSha256:hash('a😀b'),oldText:'\ud83d',newText:'X'}));
    assert.equal(fs.readFileSync(file,'utf8'),'a😀b');
    for(const role of ['planner','reviewer','integrator'])assert.ok(!scopedSearchTools({project,role,writeScope:['out.json']}).some(t=>t.name==='case_edit'));
});
const toolsModule = await import('../integrations/pi/scoped-tools.mjs').catch(e => {
    if (e.code === 'ERR_MODULE_NOT_FOUND')
        return {};
    throw e;
});

test('planner inventory provides bounded metadata without reading bodies or nested files', async t => {
    const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-plan-index-')));
    t.after(() => fs.rmSync(project, {recursive:true,force:true}));
    fs.writeFileSync(path.join(project,'data.txt'),'秘密');
    fs.mkdirSync(path.join(project,'nested'));
    fs.writeFileSync(path.join(project,'nested','hidden.txt'),'do not crawl');
    fs.mkdirSync(path.join(project,'.pi'));
    const read = t.mock.method(fs,'readFileSync',()=>{throw new Error('Inventory must not read bodies');});
    const list=toolsModule.createScopedTools({project,role:'planner'}).find(t=>t.name==='case_list');
    const result=await list.execute('index',{path:'.'});
    assert.deepEqual(JSON.parse(result.content[0].text),{path:'.',complete:true,recursive:false,entries:[
        {name:'data.txt',kind:'file',bytes:6},{name:'nested',kind:'directory',bytes:null}
    ]});
    assert.equal(read.mock.callCount(),0);
});

test('planner inventory refuses oversized metadata instead of silently losing entries', async t => {
    const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-plan-limit-')));
    t.after(() => fs.rmSync(project, {recursive:true,force:true}));
    for(let i=0;i<200;i++)fs.writeFileSync(path.join(project,`${i}-${'x'.repeat(120)}`),'');
    const list=toolsModule.createScopedTools({project,role:'planner'}).find(t=>t.name==='case_list');
    await assert.rejects(list.execute('index',{path:'.'}),{code:'MATERIAL_INDEX_TOO_LARGE'});
});

test('scoped tools exclude protected settings at every depth and preserve ordinary instructions for reading', async t => {
    const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-protected-tools-')));
    t.after(() => fs.rmSync(project, { recursive: true, force: true }));
    const tools = toolsModule.createScopedTools({ project, role: 'worker', writeScope: ['nested'] });
    const read = tools.find(tool => tool.name === 'case_read');
    const write = tools.find(tool => tool.name === 'case_write');
    const list = tools.find(tool => tool.name === 'case_list');
    fs.mkdirSync(path.join(project, 'nested'));
    fs.writeFileSync(path.join(project, 'nested', 'AGENTS.md'), 'ordinary project instructions');
    for (const segment of ['.git', '.pi', '.agents', '.codex', '.claude', '.case-agent']) {
        for (const name of [`${segment}/fixture.txt`, `nested/${segment.toUpperCase()}/fixture.txt`]) {
            fs.mkdirSync(path.dirname(path.join(project, name)), { recursive: true });
            fs.writeFileSync(path.join(project, name), 'synthetic protected material');
            await assert.rejects(read.execute('read', { path: name }), { code: 'UNSAFE_TOOL_PATH' });
            await assert.rejects(write.execute('write', { path: name, content: 'changed' }), { code: 'UNSAFE_TOOL_PATH' });
            await assert.rejects(list.execute('list', { path: path.posix.dirname(name) }), { code: 'UNSAFE_TOOL_PATH' });
        }
    }
    assert.equal((await read.execute('normal', { path: 'nested/AGENTS.md' })).content[0].text.split('\n').slice(1).join('\n'), 'ordinary project instructions');
    assert.equal((await list.execute('root', { path: '.' })).content[0].text, 'nested/');
    assert.equal((await list.execute('nested', { path: 'nested' })).content[0].text, 'AGENTS.md');
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
    await assert.rejects(write.execute('3',{path:'source.txt',content:'bad'}),failure=>{
        assert.equal(failure.code,'UNSAFE_TOOL_PATH');
        assert.match(failure.message,/source\.txt/);
        assert.match(failure.message,/output\.txt/);
        return true;
    });
});
test('review tools can inspect actual files but have no write or arbitrary shell tool', async (t) => {
    assert.equal(typeof toolsModule.createScopedTools, 'function', 'scoped tools are not implemented');
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-read-')));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, 'source.txt'), 'grounded material');
    const tools = toolsModule.createScopedTools({ project: dir, role: 'reviewer' });
    assert.deepEqual(tools.map(x => x.name).sort(), ['case_list', 'case_read', 'case_search']);
    const result = await tools.find(x => x.name === 'case_read').execute('1', { path: 'source.txt' });
    assert.equal(result.content[0].text.split('\n').slice(1).join('\n'), 'grounded material');
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
