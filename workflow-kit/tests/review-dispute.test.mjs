import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createStore} from '../skills/case-workflow/scripts/core/store.mjs';

function setup(t) {
    const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-dispute-')));
    t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    fs.writeFileSync(path.join(dir,'source.txt'),'第一行\r\n來源支持成果\r\n最後一行');
    const store=createStore(dir); store.init();
    let state=store.create({goal:'保留正確成果',constraints:[],acceptance:[{id:'a',text:'符合來源'}],budget:{maxAttempts:3,maxDurationMs:60000}});
    const send=action=>state=store.dispatch(state.id,action,{expectedRevision:state.revision,requestId:randomUUID()});
    send({type:'plan',packets:[{id:'p',purpose:'整理',constraintIds:[],inputs:[{path:'source.txt',required:true}],dependsOn:[],writeScope:['out.txt'],deliverables:[{path:'out.txt'}],checks:[{id:'check',text:'核對',criterionIds:['a']}],unknowns:[]}]});
    send({type:'start',packetId:'p',sessionId:'worker'});
    fs.writeFileSync(path.join(dir,'out.txt'),'正確成果');
    const attemptId=state.packets[0].attempts.at(-1).id;
    send({type:'submit',packetId:'p',attemptId,summary:'完成'});
    send({type:'review',packetId:'p',attemptId,sessionId:'reviewer',passed:true,findings:[],evidence:'逐行核對'});
    return {dir,store,send,get state(){return state;},statePath:path.join(dir,'.case-agent','cases',state.id,'state.json')};
}
const dispute=snapshot=>({reason:'來源支持目前成果',criterionIds:['a'],citations:[{...snapshot.materials.find(m=>m.path==='source.txt'),startLine:1,endLine:2,quote:'第一行\n來源支持成果'}]});

test('反證核對使用目前來源與成果版本且完全唯讀',t=>{
    const f=setup(t), before=fs.readFileSync(f.statePath,'utf8');
    const snapshot=f.store.reviewSnapshot(f.state.id);
    assert.deepEqual(snapshot.materials.map(m=>m.path),['out.txt','source.txt']);
    assert.match(snapshot.versionKey,/^[a-f0-9]{64}$/);
    assert.equal(snapshot.revision,f.state.revision);
    assert.deepEqual(f.store.reviewSnapshot(f.state.id),snapshot);
    assert.deepEqual(f.store.validateReviewDispute(f.state.id,snapshot,dispute(snapshot)),{valid:true});
    assert.equal(fs.readFileSync(f.statePath,'utf8'),before);
    assert.deepEqual(fs.readdirSync(path.dirname(f.statePath)).sort(),['artifacts','state.json']);
});

test('拒絕假引用、越界、未知條件、混合欄位與未授權路徑，保留原狀態',t=>{
    const f=setup(t), snapshot=f.store.reviewSnapshot(f.state.id), before=fs.readFileSync(f.statePath,'utf8');
    for(const change of [d=>d.citations[0].quote='虛構',d=>d.citations[0].endLine=99,d=>d.citations[0].startLine=0,d=>d.citations[0].sha256='0'.repeat(64),d=>d.citations[0].path='private.txt',d=>d.criterionIds=['unknown'],d=>d.criterionIds=['a','a'],d=>d.criterionIds=[],d=>d.packets=[],d=>d.citations[0].extra=true,d=>d.citations=[],d=>d.citations=Array(17).fill(d.citations[0]),d=>d.citations[0].quote='x'.repeat(4001)]) {
        const d=dispute(snapshot); change(d);
        assert.throws(()=>f.store.validateReviewDispute(f.state.id,snapshot,d),{code:'INVALID_REVIEW_DISPUTE'});
    }
    assert.equal(fs.readFileSync(f.statePath,'utf8'),before);
});

for(const [name,code] of [['source.txt','STALE_INPUT'],['out.txt','STALE_OUTPUT']]) test(`拒絕過期 ${name}`,t=>{
    const f=setup(t), snapshot=f.store.reviewSnapshot(f.state.id);
    fs.writeFileSync(path.join(f.dir,name),'已變更');
    assert.throws(()=>f.store.validateReviewDispute(f.state.id,snapshot,dispute(snapshot)),{code});
});

test('拒絕修改快照、卷宗版本變更與非已核對工作包',t=>{
    const f=setup(t), snapshot=f.store.reviewSnapshot(f.state.id);
    assert.throws(()=>f.store.validateReviewDispute(f.state.id,{...snapshot,materials:[]},dispute(snapshot)),{code:'STALE_REVIEW_DISPUTE'});
    const state=f.store.get(f.state.id); state.revision++;
    fs.writeFileSync(f.statePath,JSON.stringify(state));
    assert.throws(()=>f.store.validateReviewDispute(f.state.id,snapshot,dispute(snapshot)),{code:'STALE_REVIEW_DISPUTE'});
    state.packets[0].status='submitted'; fs.writeFileSync(f.statePath,JSON.stringify(state));
    assert.throws(()=>f.store.reviewSnapshot(f.state.id),{code:'INVALID_TRANSITION'});
});

test('引用來源被替換為符號連結時拒絕',t=>{
    const f=setup(t), snapshot=f.store.reviewSnapshot(f.state.id);
    fs.writeFileSync(path.join(f.dir,'linked.txt'),'第一行\r\n來源支持成果\r\n最後一行');
    fs.unlinkSync(path.join(f.dir,'source.txt'));
    try {fs.symlinkSync(path.join(f.dir,'linked.txt'),path.join(f.dir,'source.txt'));}
    catch(error) {if(['EPERM','EACCES'].includes(error.code))return t.skip('環境不允許建立符號連結'); throw error;}
    assert.throws(()=>f.store.validateReviewDispute(f.state.id,snapshot,dispute(snapshot)),{code:'UNSAFE_PATH'});
});

test('未處置發現與非 active 卷宗不得取得反證快照',t=>{
    const f=setup(t), state=f.store.get(f.state.id);
    state.discoveries=[{id:'d',status:'pending',blocking:true}];
    fs.writeFileSync(f.statePath,JSON.stringify(state));
    assert.throws(()=>f.store.reviewSnapshot(state.id),{code:'UNRESOLVED_DISCOVERY'});
    state.discoveries=[]; state.status='completed'; fs.writeFileSync(f.statePath,JSON.stringify(state));
    assert.throws(()=>f.store.reviewSnapshot(state.id),{code:'INVALID_TRANSITION'});
});

test('即使快照遭竄改也不接受受保護或專案外路徑',t=>{
    const f=setup(t), snapshot=f.store.reviewSnapshot(f.state.id);
    for(const name of ['.git/config','../secret.txt','nested/.codex/settings.json']) {
        const d=dispute(snapshot); d.citations[0].path=name;
        assert.throws(()=>f.store.validateReviewDispute(f.state.id,snapshot,d),{code:'INVALID_REVIEW_DISPUTE'});
        const forged=structuredClone(snapshot); forged.materials.push({path:name,sha256:d.citations[0].sha256});
        assert.throws(()=>f.store.validateReviewDispute(f.state.id,forged,d),{code:'STALE_REVIEW_DISPUTE'});
    }
});
