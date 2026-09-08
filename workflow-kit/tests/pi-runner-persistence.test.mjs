import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../skills/case-workflow/scripts/core/index.mjs';
import { runCase, callSession } from '../integrations/pi/runner.mjs';

function fixture(t) {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'case-save-failure-')));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const store = createStore(project); store.init();
  const state = store.create({goal:'write',constraints:[],acceptance:[{id:'a',text:'correct'}],budget:{maxAttempts:3,maxDurationMs:60000}});
  return {project,store,state};
}
const trace = {traceVersion:1,traceComplete:true,events:[]};
const packet = {id:'p',purpose:'write',constraintIds:[],inputs:[],dependsOn:[],writeScope:['out'],deliverables:[{path:'out'}],checks:[{id:'k',text:'correct',criterionIds:['a']}],unknowns:[]};

test('integration validation error remains primary when saving its rejection fails',async t=>{
  const {store,state,project}=fixture(t);const roles=[];let failedSaves=0;
  const wrapped={...store,saveRun(id,runId,run){
    if(run.sessions.some(s=>s.validationError)){
      failedSaves++;throw Object.assign(new Error('disk full'),{code:'ENOSPC'});
    }
    return store.saveRun(id,runId,run);
  }};
  await assert.rejects(runCase({store:wrapped,caseId:state.id,runSession:async request=>{
    roles.push(request.role);const sessionId=`s-${roles.length}`;await request.onStart(sessionId);
    let reply;
    if(request.role==='planner')reply={packets:[packet]};
    else if(request.role==='worker'){fs.writeFileSync(path.join(project,'out'),'written');reply={summary:'written'};}
    else if(request.role==='reviewer')reply={passed:true,findings:[],evidence:'read output'};
    else reply={};
    return {sessionId,text:JSON.stringify(reply),trace};
  }}),failure=>{
    assert.equal(failure.code,'INVALID_REPLY');
    assert.equal(failure.run.error.code,'INVALID_REPLY');
    assert.deepEqual(failure.persistenceErrors,[{code:'ENOSPC'}]);
    assert.deepEqual(failure.run.sessions.at(-1).trace,trace);return true;
  });
  assert.deepEqual(roles,['planner','worker','reviewer','integrator']);
  assert.equal(failedSaves,1);
});

test('primary session error survives failed persistence with in-memory evidence and no redispatch', async t => {
  const {store,state} = fixture(t);
  let savingFails=false, savesAfterFailure=0, calls=0;
  const wrapped = {...store,saveRun(...args){
    if(savingFails){savesAfterFailure++;throw Object.assign(new Error('disk full'),{code:'ENOSPC'});}
    return store.saveRun(...args);
  }};
  const primary=Object.assign(new Error('tool operation failed'),{code:'TOOL_FAILED',sessionEvidence:{text:'partial',trace}});
  await assert.rejects(runCase({store:wrapped,caseId:state.id,runSession:async request=>{
    calls++;await request.onStart('failed-session');savingFails=true;throw primary;
  }}), failure=>{
    assert.equal(failure,primary);
    assert.equal(failure.persistenceErrors[0].code,'ENOSPC');
    assert.deepEqual(failure.run.sessions[0].trace,trace);
    assert.equal(failure.run.error.code,'TOOL_FAILED');return true;
  });
  assert.equal(calls,1);
  assert.equal(savesAfterFailure,1,'do not repeatedly retry the same failing save');
});

for(const stage of ['feedback','waiting'])test(`planner blocker remains primary when saving ${stage} fails`,async t=>{
  const {store,state}=fixture(t);const roles=[];let failedSaves=0;
  const reason='Required external material is missing';
  const wrapped={...store,saveRun(id,runId,run){
    if(run.waitingReason && (stage==='feedback' || run.waitingRevision !== undefined)){
      failedSaves++;throw Object.assign(new Error('disk full'),{code:'ENOSPC'});
    }
    return store.saveRun(id,runId,run);
  }};
  await assert.rejects(runCase({store:wrapped,caseId:state.id,runSession:async request=>{
    roles.push(request.role);const sessionId=`s-${roles.length}`;await request.onStart(sessionId);
    const packets=stage==='feedback'?[packet,{...packet,id:'independent',writeScope:['other'],deliverables:[{path:'other'}]}]:[packet];
    const reply=roles.length===1?{packets}:{blocked:{reason}};
    return {sessionId,text:JSON.stringify(reply),trace};
  }}),failure=>{
    assert.equal(failure.code,'BLOCKED');assert.equal(failure.message,reason);
    assert.deepEqual(failure.persistenceErrors,[{code:'ENOSPC'}]);
    assert.equal(failure.run.error.code,'BLOCKED');
    assert.deepEqual(failure.run.sessions.at(-1).trace,trace);return true;
  });
  assert.deepEqual(roles,['planner','worker','planner']);
  assert.equal(failedSaves,1);
  if(stage==='feedback')assert.equal(store.get(state.id).packets.find(p=>p.id==='independent').attempts.length,0);
});

test('save failure after a worker side effect preserves returned evidence and active attempt', async t=>{
  const {store,state,project}=fixture(t);
  store.dispatch(state.id,{type:'plan',packets:[{id:'p',purpose:'write',constraintIds:[],inputs:[],dependsOn:[],writeScope:['out'],deliverables:[{path:'out'}],checks:[{id:'k',text:'correct',criterionIds:['a']}],unknowns:[]}]},{expectedRevision:state.revision,requestId:'plan'});
  let savingFails=false;const roles=[];
  const wrapped={...store,saveRun(...args){if(savingFails)throw Object.assign(new Error('disk full'),{code:'ENOSPC'});return store.saveRun(...args);}};
  await assert.rejects(runCase({store:wrapped,caseId:state.id,runSession:async request=>{
    roles.push(request.role);await request.onStart('worker-1');
    fs.writeFileSync(path.join(project,'out'),'partial side effect');savingFails=true;
    return {sessionId:'worker-1',text:'{"summary":"written"}',trace};
  }}),failure=>{
    assert.equal(failure.code,'ENOSPC');assert.deepEqual(failure.run.sessions[0].trace,trace);
    assert.equal(failure.run.sessions[0].text,'{"summary":"written"}');
    assert.equal(failure.persistenceErrors.length,1);return true;
  });
  assert.deepEqual(roles,['worker']);assert.equal(fs.readFileSync(path.join(project,'out'),'utf8'),'partial side effect');
  assert.equal(store.get(state.id).packets[0].status,'running');
  await assert.rejects(runCase({store,caseId:state.id,runSession:()=>assert.fail('must not resume')}),{code:'ACTIVE_ATTEMPT'});
});

test('initial save failure prevents all model calls and exposes its in-memory run',async t=>{
  const {store,state}=fixture(t);
  await assert.rejects(runCase({store:{...store,saveRun(){throw Object.assign(new Error('denied'),{code:'EACCES'});}},caseId:state.id,runSession:()=>assert.fail('no session')}),failure=>{
    assert.equal(failure.code,'EACCES');assert.equal(failure.run.sessions.length,0);assert.equal(failure.persistenceErrors.length,1);return true;
  });
});

test('rejected SDK reply keeps trace; older replies without trace stay compatible',async()=>{
  await assert.rejects(callSession(async({onStart})=>{await onStart('s');return {sessionId:'wrong',text:'ok',trace};},{}),failure=>{
    assert.deepEqual(failure.sessionEvidence.trace,trace);return true;
  });
  const reply=await callSession(async({onStart})=>{await onStart('s');return {sessionId:'s',text:'{}'};},{});
  assert.equal(Object.hasOwn(reply,'trace'),false);
});

test('SDK cancellation caused by persistence failure retains the saving cause',async t=>{
  const {store,state}=fixture(t);let saves=0;
  const wrapped={...store,saveRun(...args){if(++saves===3)throw Object.assign(new Error('disk full'),{code:'ENOSPC'});return store.saveRun(...args);}};
  await assert.rejects(runCase({store:wrapped,caseId:state.id,runSession:async request=>{
    try {await request.onStart('s');} catch {
      throw Object.assign(new Error('Session cancelled'),{code:'CANCELLED',sessionEvidence:{trace}});
    }
    assert.fail('no generation after start could not be recorded');
  }}),failure=>{
    assert.equal(failure.code,'ENOSPC');assert.deepEqual(failure.run.sessions[0].trace,trace);return true;
  });
});
