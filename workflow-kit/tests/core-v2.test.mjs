import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run as v1 } from '../skills/case-workflow/scripts/case.mjs';
import { digest } from '../skills/case-workflow/scripts/core/io.mjs';
const mod = await import('../skills/case-workflow/scripts/core/index.mjs').catch(() => null);

for (const input of [
    { required: true, delivery: 'inline' },
    { required: true, delivery: 'indexed' },
    { required: false }
]) {
    test(`受保護材料不得加入計畫：${input.delivery ?? 'optional'}`, async t => {
        const f = setup(t);
        for (const segment of ['.git', '.pi', '.agents', '.codex', '.claude', '.case-agent']) {
            for (const name of [`${segment}/tasks/fixture.txt`, `nested/${segment.toUpperCase()}/fixture.txt`]) {
                await t.test(name, () => {
                    // All settings here are synthetic files beneath the temporary fixture.
                    const file = path.join(f.dir, name);
                    fs.mkdirSync(path.dirname(file), { recursive: true });
                    fs.writeFileSync(file, 'synthetic protected material');
                    const action = { type: 'plan', packets: [{ ...packet(), inputs: [{ ...input, path: name }] }] };
                    assert.throws(() => f.store.validatePlan(f.state.id, action, { expectedRevision: f.state.revision }), { code: 'UNSAFE_PATH' });
                    assert.throws(() => f.send(action), { code: 'UNSAFE_PATH' });
                    assert.equal(f.store.get(f.state.id).revision, 0);
                });
            }
        }
    });
}

test('舊有不安全工作包的 context 與 digest 也拒絕受保護材料', async t => {
    for (const input of [
        { path: '.git/config', required: true, delivery: 'inline' },
        { path: 'nested/.CASE-AGENT/fixture.txt', required: true, delivery: 'indexed' },
        { path: 'nested/.Pi/settings.json', required: false }
    ]) {
        await t.test(input.delivery ?? 'optional', () => {
            const f = setup(t);
            f.send({ type: 'plan', packets: [packet()] });
            const file = path.join(f.dir, input.path);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, '原始材料');
            const state = f.store.get(f.state.id);
            state.packets[0].inputs[0] = { ...state.packets[0].inputs[0], ...input };
            fs.writeFileSync(path.join(f.dir, '.case-agent', 'cases', state.id, 'state.json'), JSON.stringify(state));
            assert.throws(() => f.store.context(state.id, 'p'), { code: 'UNSAFE_PATH' });
            assert.throws(() => digest(f.dir, input), { code: 'UNSAFE_PATH' });
        });
    }
});

test('不存在的選用受保護材料仍拒絕，並保留頂層 CASE 狀態前綴排除', t => {
    const f = setup(t);
    for (const name of ['nested/.codex/missing.json', '.case-agent-backup/state.json', './.CASE-AGENT-migration-state.json']) {
        const input = { path: name, required: false };
        assert.throws(() => f.send({ type: 'plan', packets: [{ ...packet(), inputs: [input] }] }), { code: 'UNSAFE_PATH' });
        assert.throws(() => digest(f.dir, input), { code: 'UNSAFE_PATH' });
    }
});

test('一般 AGENTS.md 與正常來源仍可組裝 context', t => {
    const f = setup(t);
    const paths = ['AGENTS.md', 'nested/AGENTS.md', 'src/git/config.txt', '.github/workflows/check.yml'];
    for (const name of paths) {
        fs.mkdirSync(path.dirname(path.join(f.dir, name)), { recursive: true });
        fs.writeFileSync(path.join(f.dir, name), `source: ${name}`);
    }
    f.send({ type: 'plan', packets: [{ ...packet(), inputs: paths.map(name => ({ path: name, required: true })) }] });
    assert.deepEqual(JSON.parse(f.store.context(f.state.id, 'p')).requiredMaterials.map(i => i.content), paths.map(name => `source: ${name}`));
});

test('plan validation returns actionable errors without committing or weakening authority', t => {
    const f = setup(t);
    const before = JSON.stringify(f.store.get(f.state.id));
    const options = {expectedRevision:f.state.revision};
    assert.throws(() => f.store.validatePlan(f.state.id, {type:'plan',packets:[{...packet(),checks:[]}]}, options), failure=>failure.code==='INVALID_ARGUMENT' && /missing a/.test(failure.message));
    assert.deepEqual(f.store.validatePlan(f.state.id, {type:'plan',packets:[packet()]}, options), {valid:true});
    assert.equal(JSON.stringify(f.store.get(f.state.id)), before);
    assert.throws(() => f.store.validatePlan(f.state.id, {type:'cancel'}, options), {code:'INVALID_ARGUMENT'});
    assert.throws(() => f.store.validatePlan(f.state.id, {type:'plan',packets:[packet()]}, {expectedRevision:999}), {code:'REVISION_CONFLICT'});
    f.send({type:'plan',packets:[packet()]});
    const planned = JSON.stringify(f.store.get(f.state.id));
    assert.deepEqual(f.store.validatePlan(f.state.id, {type:'amend_plan',packets:[{...packet(),purpose:'revised approach'}],reason:'new legal plan'}, {expectedRevision:f.state.revision}), {valid:true});
    assert.equal(JSON.stringify(f.store.get(f.state.id)), planned);
});
test('畸形操作始終提供結構化錯誤碼', t => {
    const f = setup(t);
    assert.throws(() => f.send({ type: 'plan', packets: [{ ...packet(), deliverables: [null] }] }), { code: 'INVALID_ARGUMENT' });
});
test('已核對產物陳舊後明示retry可重新執行', t => {
    const f = setup(t);
    const attemptId = submitted(f);
    f.send({
        type: 'review', packetId: 'p', attemptId, sessionId: 'r', passed: true, findings: [], evidence: 'read'
    });
    fs.writeFileSync(path.join(f.dir, 'out.txt'), '需要重作');
    f.send({ type: 'retry', packetId: 'p', reason: '明示更新' });
    f.send({ type: 'start', packetId: 'p', sessionId: 'new-worker' });
    assert.equal(f.state.packets[0].attempts.length, 2);
});
test('下游必讀材料可由明示上游產生並綁定驗證版本', t => {
    const f = setup(t);
    f.send({ type: 'plan', packets: [packet(), {
                ...packet('q'), dependsOn: ['p'], inputs: [{ path: 'out.txt', required: true }], writeScope: ['q.txt'], deliverables: [{ path: 'q.txt' }]
            }] });
    assert.equal(f.state.packets[1].inputs[0].sha256, null);
    f.send({ type: 'start', packetId: 'p', sessionId: 'w' });
    fs.writeFileSync(path.join(f.dir, 'out.txt'), '上游產物');
    const attemptId = f.state.packets[0].attempts[0].id;
    f.send({
        type: 'submit', packetId: 'p', attemptId, summary: 'ok'
    });
    f.send({
        type: 'review', packetId: 'p', attemptId, sessionId: 'r', passed: true, findings: [], evidence: 'read'
    });
    assert.match(f.store.context(f.state.id, 'q'), /上游產物/);
    f.send({ type: 'start', packetId: 'q', sessionId: 'qw' });
    assert.equal(f.state.packets[1].attempts[0].inputs[0].producerAttemptId, attemptId);
});
test('契約更動不可用retry直接宣稱對齊且重新規劃不重置預算', t => {
    const f = setup(t);
    submitted(f);
    const revised = { ...contract(), acceptance: [{ id: 'new', text: '新驗收' }], budget: { maxAttempts: 1, maxDurationMs: 60000 } };
    f.send({ type: 'revise', contract: revised, reason: '改需求' });
    assert.throws(() => f.send({ type: 'retry', packetId: 'p', reason: 'retry' }), { code: 'REPLAN_REQUIRED' });
    f.send({ type: 'plan', packets: [{ ...packet(), checks: [{ id: 'n', text: 'new', criterionIds: ['new'] }] }] });
    assert.throws(() => f.send({ type: 'start', packetId: 'p', sessionId: 'new-w' }), { code: 'BUDGET_EXCEEDED' });
});
const contract = () => ({
    goal: '交付報告', constraints: [{ id: 'c', text: '保留原文' }], acceptance: [{ id: 'a', text: '報告正確' }], budget: { maxAttempts: 3, maxDurationMs: 60000 }
});
const packet = (id = 'p') => ({
    id, purpose: '整理', constraintIds: ['c'], inputs: [{ path: 'source.txt', required: true }], dependsOn: [], writeScope: ['out.txt'], deliverables: [{ path: 'out.txt' }], checks: [{ id: 'check', text: '核對', criterionIds: ['a'] }], unknowns: []
});
function setup(t) {
    assert.ok(mod?.createStore, 'versioned core must exist');
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-v2-')));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, 'source.txt'), '原始材料');
    const store = mod.createStore(dir);
    store.init();
    let state = store.create(contract());
    return {
        dir, store, get state() {
            return state;
        }, send(action, opts = {}) {
            state = store.dispatch(state.id, action, { expectedRevision: state.revision, requestId: crypto.randomUUID(), ...opts });
            return state;
        }
    };
}
function submitted(f) {
    f.send({ type: 'plan', packets: [packet()] });
    f.send({ type: 'start', packetId: 'p', sessionId: 'worker' });
    fs.writeFileSync(path.join(f.dir, 'out.txt'), '完成');
    const attemptId = f.state.packets[0].attempts.at(-1).id;
    f.send({
        type: 'submit', packetId: 'p', attemptId, summary: '完成'
    });
    return attemptId;
}
test('完整循環必須經不同session核對與全域證據才能完成', t => {
    const f = setup(t);
    const attemptId = submitted(f);
    assert.equal(f.state.status, 'active');
    assert.throws(() => f.send({
        type: 'review', packetId: 'p', attemptId, sessionId: 'worker', passed: true, evidence: 'read', findings: []
    }), { code: 'SAME_SESSION' });
    f.send({
        type: 'review', packetId: 'p', attemptId, sessionId: 'reviewer', passed: true, evidence: '比對原文', findings: []
    });
    assert.throws(() => f.send({
        type: 'integrate', sessionId: 'integrator', results: [], summary: 'ok'
    }), { code: 'ACCEPTANCE_INCOMPLETE' });
    f.send({
        type: 'integrate', sessionId: 'integrator', results: [{ criterionId: 'a', passed: true, evidence: '讀取報告' }], summary: 'ok'
    });
    assert.equal(f.store.get(f.state.id).status, 'completed');
    assert.equal(f.store.list().length, 1);
});
test('拒絕循環、漏驗收、路徑逃逸及未規劃執行', t => {
    const f = setup(t);
    assert.throws(() => f.send({ type: 'start', packetId: 'p', sessionId: 'w' }));
    for (const p of [{ ...packet(), dependsOn: ['p'] }, { ...packet(), checks: [] }, { ...packet(), inputs: [{ path: '../escape', required: false }] }, { ...packet(), deliverables: [{ path: 'other.txt' }] }])
        assert.throws(() => f.send({ type: 'plan', packets: [p] }));
    assert.equal(f.state.revision, 0);
});
test('同請求重送不重複副作用且不同內容與revision競爭拒絕', t => {
    const f = setup(t);
    const action = { type: 'plan', packets: [packet()] };
    f.send(action, { requestId: 'r' });
    const revision = f.state.revision;
    f.send(action, { requestId: 'r', expectedRevision: 0 });
    assert.equal(f.state.revision, revision);
    assert.throws(() => f.send({ type: 'cancel', reason: 'x' }, { requestId: 'r' }), { code: 'REQUEST_CONFLICT' });
    assert.throws(() => f.send({ type: 'cancel', reason: 'x' }, { expectedRevision: 0 }), { code: 'REVISION_CONFLICT' });
});
test('來源及產物變動不能沿用核對', t => {
    const f = setup(t);
    const attemptId = submitted(f);
    fs.writeFileSync(path.join(f.dir, 'source.txt'), '變動');
    assert.throws(() => f.send({
        type: 'review', packetId: 'p', attemptId, sessionId: 'review', passed: true, evidence: 'read', findings: []
    }), { code: 'STALE_INPUT' });
    assert.throws(() => f.store.context(f.state.id, 'p'), { code: 'STALE_INPUT' });
});
test('context保留全域限制與必讀內容並拒絕默默截斷', t => {
    const f = setup(t);
    f.send({ type: 'plan', packets: [packet()] });
    const context = f.store.context(f.state.id, 'p', { maxChars: 10000 });
    assert.match(context, /保留原文/);
    assert.match(context, /原始材料/);
    assert.throws(() => f.store.context(f.state.id, 'p', { maxChars: 10 }), { code: 'CONTEXT_TOO_LARGE' });
});
test('重試保留失敗且不得重用session或超出共享attempt預算', t => {
    const f = setup(t);
    let id = submitted(f);
    f.send({
        type: 'review', packetId: 'p', attemptId: id, sessionId: 'r', passed: false, findings: ['錯誤'], evidence: '比較'
    });
    f.send({ type: 'retry', packetId: 'p', reason: '修正' });
    assert.throws(() => f.send({ type: 'start', packetId: 'p', sessionId: 'worker' }), { code: 'SAME_SESSION' });
    for (let i = 2; i <= 3; i++) {
        f.send({ type: 'start', packetId: 'p', sessionId: `w${i}` });
        f.send({ type: 'block', packetId: 'p', reason: '中斷' });
        f.send({ type: 'retry', packetId: 'p', reason: '已確認可重跑' });
    }
    assert.throws(() => f.send({ type: 'start', packetId: 'p', sessionId: 'w4' }), { code: 'BUDGET_EXCEEDED' });
    assert.equal(f.state.packets[0].attempts.length, 3);
});
test('修訂契約使既有成果需重驗', t => {
    const f = setup(t);
    const attemptId = submitted(f);
    f.send({
        type: 'review', packetId: 'p', attemptId, sessionId: 'r', passed: true, evidence: 'read', findings: []
    });
    f.send({ type: 'revise', contract: { ...contract(), goal: '新目標' }, reason: '需求改變' });
    assert.equal(f.state.packets[0].status, 'blocked');
    assert.equal(f.state.integration, null);
    assert.equal(f.state.contract.revision, 2);
});
test('v1必須明示migration並保留外部備份和唯讀歷史', t => {
    assert.ok(mod?.createStore, 'versioned core must exist');
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-migrate-')));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    v1(['init', '--project', dir]);
    const store = mod.createStore(dir);
    assert.throws(() => store.init(), { code: 'MIGRATION_REQUIRED' });
    const result = store.migrate();
    assert.equal(fs.existsSync(result.backupPath), true);
    assert.equal(path.dirname(result.backupPath), dir);
    assert.throws(() => v1(['list', '--project', dir]));
    assert.equal(store.create(contract()).status, 'active');
});
test('原地修改保留原始版本並只接受submitted版本', t => {
    const f = setup(t);
    f.send({ type: 'plan', packets: [{ ...packet(), writeScope: ['source.txt'], deliverables: [{ path: 'source.txt' }] }] });
    f.send({ type: 'start', packetId: 'p', sessionId: 'w' });
    const attempt = f.state.packets[0].attempts[0];
    fs.writeFileSync(path.join(f.dir, 'source.txt'), '修正');
    f.send({
        type: 'submit', packetId: 'p', attemptId: attempt.id, summary: '修正'
    });
    assert.notEqual(f.state.packets[0].attempts[0].deliverables[0].sha256, attempt.inputs[0].sha256);
    fs.writeFileSync(path.join(f.dir, 'source.txt'), '核對前竄改');
    assert.throws(() => f.send({
        type: 'review', packetId: 'p', attemptId: attempt.id, sessionId: 'r', passed: true, findings: [], evidence: 'read'
    }), { code: 'STALE_OUTPUT' });
    fs.writeFileSync(path.join(f.dir, 'source.txt'), '修正');
    f.send({
        type: 'review', packetId: 'p', attemptId: attempt.id, sessionId: 'r', passed: true, findings: [], evidence: 'read'
    });
    assert.equal(f.state.packets[0].status, 'verified');
});
test('run紀錄原子更新且不更動權威revision', t => {
    const f = setup(t);
    const id = randomUUID();
    assert.equal(typeof f.store.saveRun, 'function');
    f.store.saveRun(f.state.id, id, { createdAt: '2026-09-05T00:00:00Z', sessions: [], elapsedMs: 10 });
    f.store.saveRun(f.state.id, id, { createdAt: '2026-09-05T00:00:00Z', sessions: [{ role: 'planner' }], elapsedMs: 20 });
    assert.equal(f.store.listRuns(f.state.id).length, 1);
    assert.equal(f.store.listRuns(f.state.id)[0].elapsedMs, 20);
    assert.equal(f.store.get(f.state.id).revision, 0);
    assert.throws(() => f.store.saveRun(f.state.id, '../escape', {}));
});
test('CLI從JSON契約建卷並將錯誤寫stderr', t => {
    const f = setup(t);
    const cli = fileURLToPath(new URL('../skills/case-workflow/scripts/case-v2.mjs', import.meta.url));
    fs.writeFileSync(path.join(f.dir, 'contract.json'), JSON.stringify(contract()));
    let r = spawnSync(process.execPath, [cli, 'create', '--project', f.dir, '--data', path.join(f.dir, 'contract.json')], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout).contract.goal, '交付報告');
    r = spawnSync(process.execPath, [cli, 'get', '--project', f.dir, '--case', '../bad'], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.equal(JSON.parse(r.stderr).code, 'INVALID_ARGUMENT');
});
test('相依必須先驗證且上游重試使下游需重驗', t => {
    const f = setup(t);
    f.send({ type: 'plan', packets: [packet(), {
                ...packet('q'), dependsOn: ['p'], writeScope: ['q.txt'], deliverables: [{ path: 'q.txt' }]
            }] });
    assert.equal(f.state.packets[1].status, 'planned');
    assert.throws(() => f.send({ type: 'start', packetId: 'q', sessionId: 'qw' }), { code: 'INVALID_TRANSITION' });
    f.send({ type: 'start', packetId: 'p', sessionId: 'w' });
    fs.writeFileSync(path.join(f.dir, 'out.txt'), 'ok');
    let id = f.state.packets[0].attempts[0].id;
    f.send({
        type: 'submit', packetId: 'p', attemptId: id, summary: 'ok'
    });
    f.send({
        type: 'review', packetId: 'p', attemptId: id, sessionId: 'r', passed: true, findings: [], evidence: 'read'
    });
    assert.equal(f.state.packets[1].status, 'ready');
    fs.writeFileSync(path.join(f.dir, 'out.txt'), 'changed');
    assert.throws(() => f.send({ type: 'start', packetId: 'q', sessionId: 'qw' }), { code: 'STALE_OUTPUT' });
});
test('殘留鎖不因年代久遠而移除', t => {
    const f = setup(t);
    fs.writeFileSync(path.join(f.dir, '.case-agent', '.write-lock'), 'old');
    assert.throws(() => f.send({ type: 'cancel', reason: 'stop' }), { code: 'BUSY' });
    assert.equal(fs.readFileSync(path.join(f.dir, '.case-agent', '.write-lock'), 'utf8'), 'old');
});
test('已驗證上游可明示重跑並使下游失效', t => {
    const f = setup(t);
    f.send({ type: 'plan', packets: [packet(), {
                ...packet('q'), dependsOn: ['p'], writeScope: ['q.txt'], deliverables: [{ path: 'q.txt' }]
            }] });
    f.send({ type: 'start', packetId: 'p', sessionId: 'w' });
    fs.writeFileSync(path.join(f.dir, 'out.txt'), 'ok');
    const attemptId = f.state.packets[0].attempts[0].id;
    f.send({
        type: 'submit', packetId: 'p', attemptId, summary: 'ok'
    });
    f.send({
        type: 'review', packetId: 'p', attemptId, sessionId: 'r', passed: true, findings: [], evidence: 'read'
    });
    f.send({ type: 'retry', packetId: 'p', reason: '來源更新' });
    assert.equal(f.state.packets[0].status, 'ready');
    assert.equal(f.state.packets[1].status, 'blocked');
});
test('超過時間不得提交成功且空證據不得冒充核對', t => {
    const f = setup(t);
    const attemptId = submitted(f);
    assert.throws(() => f.send({
        type: 'review', packetId: 'p', attemptId, sessionId: 'r', passed: true, findings: [], evidence: []
    }), { code: 'INVALID_ARGUMENT' });
    const file = path.join(f.dir, '.case-agent', 'cases', f.state.id, 'state.json');
    const state = f.store.get(f.state.id);
    state.startedAt = '2000-01-01T00:00:00Z';
    fs.writeFileSync(file, JSON.stringify(state));
    assert.throws(() => f.send({
        type: 'review', packetId: 'p', attemptId, sessionId: 'r', passed: true, findings: [], evidence: 'read'
    }), { code: 'BUDGET_EXCEEDED' });
    f.send({ type: 'block', packetId: 'p', reason: '逾時保留' });
    assert.equal(f.state.status, 'blocked');
});
test('run資料不得靜默遺失非JSON欄位', t => {
    const f = setup(t);
    assert.throws(() => f.store.saveRun(f.state.id, randomUUID(), { value: undefined }), { code: 'INVALID_ARGUMENT' });
    assert.throws(() => f.store.create({ ...contract(), unexpected: () => {
        } }), { code: 'INVALID_ARGUMENT' });
});
test('migration提交前程序中止保留v1且可確認停止後續接', t => {
    const f = setup(t);
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-crash-')));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    v1(['init', '--project', dir]);
    const code = `import fs from 'node:fs';import {createStore} from ${JSON.stringify(new URL('../skills/case-workflow/scripts/core/index.mjs', import.meta.url).href)};const rename=fs.renameSync;fs.renameSync=(from,to)=>{if(to.endsWith('workflow.json'))process.exit(73);return rename(from,to)};createStore(${JSON.stringify(dir)}).migrate();`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
    assert.equal(result.status, 73);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.case-agent', 'workflow.json'), 'utf8')).format, 'case-workflow/1');
    fs.unlinkSync(path.join(dir, '.case-agent', '.write-lock'));
    const recovered = mod.createStore(dir).migrate();
    assert.equal(recovered.migrated, true);
    assert.equal(mod.createStore(dir).create(contract()).status, 'active');
});
test('材料路徑不得以點路徑別名碰觸狀態與CLI不得忽略錯字', t => {
    const f = setup(t);
    assert.throws(() => f.send({ type: 'plan', packets: [{ ...packet(), inputs: [{ path: './.case-agent/workflow.json', required: true }] }] }), { code: 'UNSAFE_PATH' });
    const r = spawnSync(process.execPath, [fileURLToPath(new URL('../skills/case-workflow/scripts/case-v2.mjs', import.meta.url)), 'list', '--project', f.dir, '--typo', 'x'], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stderr).code, 'INVALID_ARGUMENT');
});
test('新契約可重新規劃且原attempt保留歷史', t => {
    const f = setup(t);
    submitted(f);
    f.send({ type: 'revise', contract: { ...contract(), acceptance: [{ id: 'new', text: '新條件' }] }, reason: '改需求' });
    f.send({ type: 'plan', packets: [{ ...packet(), checks: [{ id: 'new-check', text: '新核對', criterionIds: ['new'] }] }] });
    assert.equal(f.state.packets[0].contractRevision, 2);
    assert.equal(f.state.packetHistory[0][0].attempts.length, 1);
});
