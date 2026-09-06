import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStore } from '../skills/case-workflow/scripts/core/index.mjs';
import { runCase } from '../integrations/pi/runner.mjs';

// Verbatim terminal reply from the preserved local-model probe (20260906-1).
const probeFeedback = 'All four indexed raw sources (`orders.json`, `prices.json`, `returns.json`, `rates.json`) are present and readable, but `normalized.json` is absent from the workspace, and the packet\'s purpose and `unknowns` state that preparation is outside this packet\'s `writeScope` (`report.json` only). Per constraint `preserve`, this packet must consume the verified normalization rather than recompute raw sources, and per the goal a missing `normalized.json` is a missing prerequisite packet, not missing external material.\n\n{"changeRequest":{"reason":"normalized.json does not exist yet and the normalization preparation packet is outside this packet\'s writeScope (only report.json); the planner must add the prerequisite normalization packet that writes normalized.json before this report packet can consume it."}}';

const packet = (id = 'p', extra = {}) => ({ id, purpose: 'write', constraintIds: [], inputs: [{path:'source',required:true}], dependsOn: [], writeScope: [`out/${id}`], deliverables: [{path:`out/${id}`}], checks:[{id:'k',text:'correct',criterionIds:['a']}], unknowns:[], ...extra });
function fixture(t, extra = {}) {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-feedback-')));
  t.after(() => fs.rmSync(project,{recursive:true,force:true}));
  fs.writeFileSync(path.join(project,'source'),'original');
  fs.mkdirSync(path.join(project,'out'));
  const store = createStore(project); store.init();
  const contract={goal:'correct output',constraints:[],acceptance:[{id:'a',text:'correct'}],budget:{maxAttempts:8,maxDurationMs:60000},writeScope:['out'],...extra};
  if(contract.writeScope===undefined)delete contract.writeScope;
  let state = store.create(contract);
  return {project,store,get state(){return state;},send(action){state=store.dispatch(state.id,action,{expectedRevision:state.revision,requestId:randomUUID()});return state;}};
}
function verify(f,id='p') {
  f.send({type:'start',packetId:id,sessionId:randomUUID()});
  const p=f.state.packets.find(p=>p.id===id), attemptId=p.attempts.at(-1).id;
  for(const d of p.deliverables) fs.writeFileSync(path.join(f.project,d.path),'correct');
  f.send({type:'submit',packetId:id,attemptId,summary:'written'});
  f.send({type:'review',packetId:id,attemptId,sessionId:randomUUID(),passed:true,findings:[],evidence:'read actual file'});
}
test('amendment preserves valid independent work and counts historical attempts once',t=>{
  const f=fixture(t,{budget:{maxAttempts:3,maxDurationMs:60000}});
  f.send({type:'plan',packets:[packet(),packet('q')]});verify(f);
  const old=f.state.packets[0].attempts[0].id, start=f.state.startedAt;
  f.send({type:'amend_plan',packets:[packet(),packet('q',{purpose:'improved'})],reason:'new approach'});
  assert.equal(f.state.packets[0].status,'verified');assert.equal(f.state.packets[0].attempts[0].id,old);
  assert.equal(f.state.startedAt,start);assert.equal(f.state.planAmendments[0].reason,'new approach');
  verify(f,'q');
  f.send({type:'amend_plan',packets:[packet(),packet('q',{purpose:'improved'})],rerunPacketIds:['q'],reason:'integration finding'});
  verify(f,'q');
  assert.equal(f.state.packets[1].attempts.length,2);
});
test('amendment cannot expand legacy scope through renamed packets or drop acceptance',t=>{
  const f=fixture(t,{writeScope:undefined});
  f.send({type:'plan',packets:[packet()]});
  assert.throws(()=>f.send({type:'amend_plan',packets:[packet('renamed')],reason:'rename'}),{code:'WRITE_SCOPE_EXCEEDED'});
  assert.throws(()=>f.send({type:'amend_plan',packets:[packet('p',{checks:[]})],reason:'skip'}),{code:'INVALID_ARGUMENT'});
});
test('initial plan respects contract write authority',t=>{
  const f=fixture(t,{writeScope:['out/p']});
  assert.throws(()=>f.send({type:'plan',packets:[packet('q')]}),{code:'WRITE_SCOPE_EXCEEDED'});
});
test('unchanged amendment is rejected, including reordered object keys',t=>{
  const f=fixture(t);f.send({type:'plan',packets:[packet()]});
  assert.throws(()=>f.send({type:'amend_plan',packets:[{...packet(),purpose:'write'}],reason:'again'}),{code:'NO_PLAN_CHANGE'});
});
test('reordering plan declarations is not a substantive amendment',t=>{
  const f=fixture(t);const p=packet('p',{writeScope:['out/p','out/extra'],unknowns:['one','two']});
  f.send({type:'plan',packets:[p]});
  assert.throws(()=>f.send({type:'amend_plan',packets:[{...p,writeScope:['out/extra','out/p'],unknowns:['two','one']}],reason:'reordered'}),{code:'NO_PLAN_CHANGE'});
});
for(const mode of ['source','overlap','dependency'])test(`amendment invalidates verified work affected by ${mode}`,t=>{
  const f=fixture(t);const q=packet('q', mode==='dependency'?{dependsOn:['p']} : {});
  f.send({type:'plan',packets:[packet(),q]});verify(f);verify(f,'q');
  if(mode==='source')fs.writeFileSync(path.join(f.project,'source'),'changed');
  const replacement= mode==='overlap' ? [packet(),q,packet('new',{writeScope:['out'],deliverables:[{path:'out/new'}]})] : [packet('p',{purpose:'new approach'}),q];
  f.send({type:'amend_plan',packets:replacement,reason:'changed requirements within contract'});
  assert.notEqual(f.state.packets.find(p=>p.id==='q').status,'verified');
});
for(const status of ['running','submitted'])test(`amendment refuses ${status} side effects`,t=>{
  const f=fixture(t);f.send({type:'plan',packets:[packet()]});f.send({type:'start',packetId:'p',sessionId:'w'});
  if(status==='submitted'){fs.writeFileSync(path.join(f.project,'out/p'),'partial');f.send({type:'submit',packetId:'p',attemptId:f.state.packets[0].attempts[0].id,summary:'partial'});}
  assert.throws(()=>f.send({type:'amend_plan',packets:[packet('p',{purpose:'changed'})],reason:'take over'}),{code:'ACTIVE_ATTEMPT'});
});

function sessions(f,respond){let n=0;return async request=>{const sessionId=`s-${++n}`;await request.onStart(sessionId);return {sessionId,text:JSON.stringify(await respond(request)),usage:'unknown'};};}
const reviewed={passed:true,findings:[],evidence:'read actual output'};
const integrated={results:[{criterionId:'a',passed:true,evidence:'read complete output'}],summary:'complete'};
for(const feedbackKind of ['changeRequest','blocked'])test(`worker ${feedbackKind} adds prerequisite and finishes with fresh work`,async t=>{
  const f=fixture(t);let planners=0,workers=0;
  const result=await runCase({store:f.store,caseId:f.state.id,runSession:sessions(f,request=>{
    if(['worker','reviewer'].includes(request.role))assert.deepEqual(request.criterionIds,['a']);
    if(request.role==='planner'){
      assert.equal(typeof request.validateResult,'function');
      assert.throws(()=>request.validateResult({packets:[packet('bad',{checks:[]})],reason:'incomplete'}),{code:'INVALID_ARGUMENT'});
      const result=++planners===1?{packets:[packet()]}:{packets:[packet('prep'),packet('p',{dependsOn:['prep'],inputs:[{path:'out/prep',required:true}]})],reason:'prepare material'};
      request.validateResult(result);return result;
    }
    if(request.role==='worker'){
      if(++workers===1)return {[feedbackKind]:{reason:'need prepared material'}};
      const filename=workers===2?'prep':'p';fs.writeFileSync(path.join(f.project,'out',filename),'correct');return {summary:'written'};
    }
    return request.role==='reviewer'?reviewed:integrated;
  })});
  assert.equal(result.state.status,'completed');assert.equal(result.state.packetHistory[0][0].attempts[0].feedback.kind,feedbackKind);
});
test('planner triages worker external blocker and stops without invented output',async t=>{
  const f=fixture(t);const roles=[];
  await assert.rejects(runCase({store:f.store,caseId:f.state.id,runSession:sessions(f,r=>{roles.push(r.role);return roles.length===1?{packets:[packet()]}:{blocked:{reason:'external price list missing'}};})}),{code:'BLOCKED'});
  assert.deepEqual(roles,['planner','worker','planner']);assert.equal(fs.existsSync(path.join(f.project,'out/p')),false);
  const p=f.store.get(f.state.id).packets[0];assert.equal(p.status,'blocked');assert.equal(p.attempts[0].feedback.reason,'external price list missing');
});
test('integration false requires actual rerun before reintegration',async t=>{
  const f=fixture(t);let planners=0,workers=0,integrators=0;const roles=[];
  const result=await runCase({store:f.store,caseId:f.state.id,runSession:sessions(f,r=>{
    roles.push(r.role);
    if(r.role==='planner')return ++planners===1?{packets:[packet()]}:{packets:[packet()],rerunPacketIds:['p'],reason:'global output wrong'};
    if(r.role==='worker'){fs.writeFileSync(path.join(f.project,'out/p'),++workers===1?'wrong':'correct');return {summary:'written'};}
    if(r.role==='reviewer')return reviewed;
    return ++integrators===1?{results:[{criterionId:'a',passed:false,evidence:'wrong actual output'}],summary:'wrong'}:integrated;
  })});
  assert.equal(result.state.status,'completed');assert.equal(workers,2);assert.deepEqual(roles.slice(-4),['planner','worker','reviewer','integrator']);
});
test('configured check failure cannot be overridden by reviewer pass',async t=>{
  const f=fixture(t);let workers=0;
  const result=await runCase({store:f.store,caseId:f.state.id,executeChecks:async()=>[{id:'check',exitCode:workers===1?1:0,stdout:'actual check',stderr:'',error:null}],runSession:sessions(f,r=>{
    if(r.role==='planner')return {packets:[packet()]};
    if(r.role==='worker'){workers++;fs.writeFileSync(path.join(f.project,'out/p'),'correct');return {summary:'written'};}
    return r.role==='reviewer'?reviewed:integrated;
  })});
  assert.equal(result.state.status,'completed');assert.equal(workers,2);
  assert.equal(result.state.packets[0].attempts[0].review.passed,false);
  assert.equal(result.run.checks[0].results[0].exitCode,1);
});
test('planner repeated unchanged work stops without another worker',async t=>{
  const f=fixture(t);let workers=0;
  await assert.rejects(runCase({store:f.store,caseId:f.state.id,runSession:sessions(f,r=>{
    if(r.role==='planner')return {packets:[packet()],reason:'same again'};
    workers++;return {changeRequest:{reason:'needs a different plan'}};
  })}),{code:'NO_PLAN_CHANGE'});
  assert.equal(workers,1);assert.equal(f.store.get(f.state.id).packets[0].status,'blocked');
});
test('automatic replan limit survives resumed runs',async t=>{
  const f=fixture(t);let planners=0;let sequence=0;
  const runSession=async r=>{
    const sessionId=`resume-${++sequence}`;await r.onStart(sessionId);
    let reply;
    if(r.role==='planner')reply=++planners===1?{packets:[packet()]}:{packets:[packet('p',{purpose:`change ${planners}`})],reason:'new approach'};
    else reply={changeRequest:{reason:'still not workable'}};
    return {sessionId,text:JSON.stringify(reply),usage:'unknown'};
  };
  await assert.rejects(runCase({store:f.store,caseId:f.state.id,runSession}),{code:'REPLAN_LIMIT'});
  const before=sequence;
  await assert.rejects(runCase({store:f.store,caseId:f.state.id,runSession}),{code:'REPLAN_LIMIT'});
  assert.equal(sequence,before);assert.equal(f.store.get(f.state.id).planAmendments.length,2);
});
test('amendment never changes contract and cannot reset exhausted attempt budget',t=>{
  const f=fixture(t,{budget:{maxAttempts:1,maxDurationMs:60000}});
  f.send({type:'plan',packets:[packet()]});verify(f);
  const before=f.state.contract;
  assert.throws(()=>f.send({type:'amend_plan',packets:[packet('p',{purpose:'new'})],reason:'retry',contract:{goal:'less work',acceptance:[],budget:{maxAttempts:999,maxDurationMs:999999}}}),{code:'BUDGET_EXCEEDED'});
  assert.deepEqual(f.store.get(f.state.id).contract,before);
});
test('unknown interrupted worker cannot be taken over on resume',async t=>{
  const f=fixture(t);f.send({type:'plan',packets:[packet()]});f.send({type:'start',packetId:'p',sessionId:'interrupted'});f.send({type:'block',packetId:'p',reason:'connection lost'});
  await assert.rejects(runCase({store:f.store,caseId:f.state.id,runSession:async()=>assert.fail('must not invoke a model')}),{code:'ACTIVE_ATTEMPT'});
});
test('explicit recovery of interrupted work permits a fresh worker',async t=>{
  const f=fixture(t);f.send({type:'plan',packets:[packet()]});f.send({type:'start',packetId:'p',sessionId:'old'});
  f.send({type:'retry',packetId:'p',reason:'Operator confirmed stopped and inspected side effects'});
  const result=await runCase({store:f.store,caseId:f.state.id,runSession:sessions(f,r=>{
    if(r.role==='worker'){fs.writeFileSync(path.join(f.project,'out/p'),'correct');return {summary:'recovered'};}
    return r.role==='reviewer'?reviewed:integrated;
  })});
  assert.equal(result.state.status,'completed');assert.equal(result.state.packets[0].attempts.length,2);
});
test('input delivery rejects unknown modes',t=>{
  const f=fixture(t);assert.throws(()=>f.send({type:'plan',packets:[packet('p',{inputs:[{path:'source',required:true,delivery:'skip'}]})]}),{code:'INVALID_ARGUMENT'});
});
test('resuming a rejected integration waits without new model work until explicit state change',async t=>{
  const f=fixture(t);f.send({type:'plan',packets:[packet()]});verify(f);
  await assert.rejects(runCase({store:f.store,caseId:f.state.id,runSession:sessions(f,r=>r.role==='integrator'?{results:[{criterionId:'a',passed:false,evidence:'incorrect'}],summary:'failed'}:{blocked:{reason:'need source'}})}),{code:'BLOCKED'});
  const roles=[];
  await assert.rejects(runCase({store:f.store,caseId:f.state.id,runSession:async r=>{
    roles.push(r.role);const sessionId='second-run';await r.onStart(sessionId);return {sessionId,text:JSON.stringify(r.role==='planner'?{blocked:{reason:'still need source'}}:integrated),usage:'unknown'};
  }}),{code:'BLOCKED'});
  assert.deepEqual(roles,[]);assert.notEqual(f.store.get(f.state.id).status,'completed');
});
test('malformed replanning after integration rejection cannot trigger format reintegration',async t=>{
  const f=fixture(t);f.send({type:'plan',packets:[packet()]});verify(f);const roles=[];
  await assert.rejects(runCase({store:f.store,caseId:f.state.id,runSession:async r=>{
    roles.push(r.role);const sessionId=`invalid-replan-${roles.length}`;await r.onStart(sessionId);
    return {sessionId,text:r.role==='planner'?'not json':JSON.stringify(roles.length===1?{results:[{criterionId:'a',passed:false,evidence:'incorrect'}],summary:'failed'}:integrated),usage:'unknown'};
  }}),{code:'INVALID_REPLY'});
  assert.deepEqual(roles,['integrator','planner']);assert.notEqual(f.store.get(f.state.id).status,'completed');
});
test('malformed configured check results stop with a structured error',async t=>{
  const f=fixture(t);f.send({type:'plan',packets:[packet()]});verify(f);
  await assert.rejects(runCase({store:f.store,caseId:f.state.id,executeChecks:async()=>[null],runSession:async()=>assert.fail('invalid checks stop before model')}),{code:'INVALID_CHECK_RESULT'});
});
test('local probe explanatory prose plus terminal feedback routes planner and preserves normalization evidence',async t=>{
  const f=fixture(t);f.send({type:'plan',packets:[packet()]});const roles=[];
  await assert.rejects(runCase({store:f.store,caseId:f.state.id,runSession:async r=>{
    roles.push(r.role);const sessionId=`probe-${roles.length}`;await r.onStart(sessionId);
    return {sessionId,text:r.role==='worker'?probeFeedback:'{"blocked":{"reason":"operator review needed"}}',usage:'unknown'};
  }}),{code:'BLOCKED'});
  assert.deepEqual(roles,['worker','planner']);
  const state=f.store.get(f.state.id), record=f.store.listRuns(f.state.id)[0].sessions[0];
  assert.equal(state.packets[0].attempts[0].feedback.kind,'changeRequest');
  assert.equal(record.text,probeFeedback);assert.equal(record.normalization.kind,'terminal-worker-feedback');
  assert.equal(record.normalization.feedbackKind,'changeRequest');assert.equal(fs.existsSync(path.join(f.project,'out/p')),false);
});
for(const text of [
  'Explanation\n{"summary":"success"}',
  'Explanation\n{"changeRequest":{"reason":"change"}} trailing',
  'Explanation {}\n{"changeRequest":{"reason":"change"}}',
  'Explanation []\n{"blocked":{"reason":"missing"}}',
  'Explanation\n{"blocked":{"reason":"missing"},"summary":"success"}',
  'Explanation\n{"blocked":{"reason":"missing"},"changeRequest":{"reason":"change"}}',
  'Explanation\n{"blocked":{"reason":" "}}',
  'Explanation\n{"blocked":{"reason":"first"}}\n{"blocked":{"reason":"second"}}',
])test(`ambiguous or success-bearing worker prose remains rejected: ${text}`,async t=>{
  const f=fixture(t);f.send({type:'plan',packets:[packet()]});
  await assert.rejects(runCase({store:f.store,caseId:f.state.id,runSession:async r=>{await r.onStart('unsafe');return {sessionId:'unsafe',text,usage:'unknown'};}}),{code:'INVALID_REPLY'});
  assert.equal(f.store.get(f.state.id).packets[0].status,'running');
  assert.equal(f.store.listRuns(f.state.id)[0].sessions[0].text,text);
});
for(const mode of ['returned','sdk-failure','identity-rejection'])test(`run evidence preserves structured transport narrative: ${mode}`,async t=>{
  const f=fixture(t);const structured='{"blocked":{"reason":"missing source"}}';
  await assert.rejects(runCase({store:f.store,caseId:f.state.id,runSession:async r=>{
    await r.onStart('transport');
    const evidence={text:structured,rawFinalText:'The source is unavailable; structured response recorded.',resultTransport:'case_result',usage:'unknown'};
    if(mode==='sdk-failure')throw Object.assign(new Error('stopped'),{code:'RESULT_ALREADY_RECORDED',sessionEvidence:evidence});
    return {...evidence,sessionId:mode==='identity-rejection'?'different':'transport'};
  }}),{code:mode==='returned'?'BLOCKED':mode==='sdk-failure'?'RESULT_ALREADY_RECORDED':'SESSION_MISMATCH'});
  const record=f.store.listRuns(f.state.id)[0].sessions[0];
  assert.equal(record.text,structured);
  assert.equal(record.rawFinalText,'The source is unavailable; structured response recorded.');
  assert.equal(record.resultTransport,'case_result');
});
