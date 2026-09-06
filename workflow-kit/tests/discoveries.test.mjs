import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createStore} from '../skills/case-workflow/scripts/core/index.mjs';
import {runCase} from '../integrations/pi/runner.mjs';

const packet=(id='p',extra={})=>({id,purpose:`write ${id}`,constraintIds:[],inputs:[],dependsOn:[],writeScope:[`out/${id}`],deliverables:[{path:`out/${id}`}],checks:[{id:'k',text:'correct',criterionIds:['a']}],unknowns:[],...extra});
const discovery=(extra={})=>({key:'missing-prep',summary:'Need prepared input',evidence:'The source describes preparation but no packet produces it',impact:'blocking',...extra});
function fixture(t){
  const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-discovery-')));
  t.after(()=>fs.rmSync(project,{recursive:true,force:true})); fs.mkdirSync(path.join(project,'out'));
  const store=createStore(project);store.init();const initial=store.create({goal:'correct output',constraints:[],acceptance:[{id:'a',text:'correct output'}],writeScope:['out'],budget:{maxAttempts:12,maxDurationMs:60000}});
  const get=()=>store.get(initial.id),send=action=>store.dispatch(initial.id,action,{expectedRevision:get().revision,requestId:randomUUID()});
  send({type:'plan',packets:[packet()]});
  return {project,store,id:initial.id,get,send,start(){send({type:'start',packetId:'p',sessionId:randomUUID()});},report(d=discovery()){return send({type:'report_discovery',packetId:'p',attemptId:get().packets[0].attempts.at(-1).id,discovery:d});}};
}
function finish(f,id='p'){
  let p=f.get().packets.find(p=>p.id===id);if(p.status==='ready')f.send({type:'start',packetId:id,sessionId:randomUUID()});
  p=f.get().packets.find(p=>p.id===id);fs.writeFileSync(path.join(f.project,`out/${id}`),'correct');
  f.send({type:'submit',packetId:id,attemptId:p.attempts.at(-1).id,summary:'written'});
  f.send({type:'review',packetId:id,attemptId:p.attempts.at(-1).id,sessionId:randomUUID(),passed:true,findings:[],evidence:'actual file'});
}
test('discovery persists before worker completion, deduplicates retries and rejects changed key content',t=>{
  const f=fixture(t);f.start();f.report(discovery({impact:'nonblocking'}));f.report(discovery({impact:'nonblocking'}));
  const reread=createStore(f.project).get(f.id);assert.equal(reread.discoveries.length,1);assert.equal(reread.packets[0].status,'running');assert.equal(reread.format,'case-workflow/2.1');
  assert.equal(reread.discoveries[0].source.attemptId,reread.packets[0].attempts[0].id);
  assert.throws(()=>f.report(discovery({summary:'different'})),{code:'DISCOVERY_CONFLICT'});
});
test('discovery rejects a stale attempt and missing evidence without writing',t=>{
  const f=fixture(t);f.start();const before=f.get();
  assert.throws(()=>f.send({type:'report_discovery',packetId:'p',attemptId:'stale',discovery:discovery()}),{code:'INVALID_ATTEMPT'});
  assert.throws(()=>f.report(discovery({evidence:''})),{code:'INVALID_ARGUMENT'});assert.deepEqual(f.get(),before);
});
test('pending discovery prevents completion even when all packets pass',t=>{
  const f=fixture(t);f.start();f.report(discovery({impact:'nonblocking'}));finish(f);
  assert.throws(()=>f.send({type:'integrate',sessionId:'i',summary:'done',results:[{criterionId:'a',passed:true,evidence:'read'}]}),{code:'UNRESOLVED_DISCOVERY'});
});
test('resolution and amended dependency plan commit atomically and preserve evidence',t=>{
  const f=fixture(t);f.start();f.report();f.send({type:'block',packetId:'p',reason:'need prep',feedback:{kind:'changeRequest',reason:'need prep'}});
  const id=f.get().discoveries[0].id,before=f.get();
  assert.throws(()=>f.send({type:'resolve_discoveries',decisions:[{id,status:'accepted',reason:'prepare',packetIds:['prep']}],packets:[packet('prep',{writeScope:['outside'],deliverables:[{path:'outside/x'}]})],reason:'prepare'}),{code:'WRITE_SCOPE_EXCEEDED'});
  assert.deepEqual(f.get(),before);
  f.send({type:'resolve_discoveries',decisions:[{id,status:'accepted',reason:'prepare',packetIds:['prep']}],packets:[packet('prep'),packet('p',{dependsOn:['prep'],inputs:[{path:'out/prep',required:true}]})],reason:'prepare'});
  assert.equal(f.get().discoveries[0].status,'accepted');assert.equal(f.get().packets.find(p=>p.id==='p').status,'planned');assert.equal(f.get().packetHistory[0][0].attempts.length,1);
});
test('blocking discovery cannot be deferred and every pending item needs an explicit decision',t=>{
  const f=fixture(t);f.start();f.report();f.send({type:'block',packetId:'p',reason:'need prep',feedback:{kind:'changeRequest',reason:'need prep'}});
  const id=f.get().discoveries[0].id;
  assert.throws(()=>f.send({type:'resolve_discoveries',decisions:[]}),{code:'UNRESOLVED_DISCOVERY'});
  assert.throws(()=>f.send({type:'resolve_discoveries',decisions:[{id,status:'deferred',reason:'later'}]}),{code:'INVALID_ARGUMENT'});
  f.send({type:'resolve_discoveries',decisions:[{id,status:'needs_input',reason:'external source required'}]});
  f.send({type:'reopen_discovery',id,reason:'operator supplied source'});assert.equal(f.get().discoveries[0].status,'pending');assert.equal(f.get().discoveries[0].history[0].status,'needs_input');
});
test('read-only submit preflight catches missing artifacts and leaves the running state unchanged',t=>{
  const f=fixture(t);f.start();const before=f.get(), action={type:'submit',packetId:'p',attemptId:before.packets[0].attempts[0].id,summary:'done'};
  assert.throws(()=>f.store.validateAction(f.id,action,{expectedRevision:before.revision}),{code:'MISSING_INPUT'});
  fs.writeFileSync(path.join(f.project,'out/p'),'correct');assert.deepEqual(f.store.validateAction(f.id,action,{expectedRevision:before.revision}),{valid:true});assert.deepEqual(f.get(),before);
});

test('same key in a later attempt preserves new evidence instead of losing the report',t=>{
  const f=fixture(t);f.start();f.report(discovery({impact:'nonblocking'}));
  f.send({type:'block',packetId:'p',reason:'pause',feedback:{kind:'changeRequest',reason:'pause'}});
  f.send({type:'retry',packetId:'p',reason:'inspected'});f.start();f.report(discovery({impact:'nonblocking',evidence:'New evidence in second attempt'}));
  assert.equal(f.get().discoveries.length,2);assert.notEqual(f.get().discoveries[0].source.attemptId,f.get().discoveries[1].source.attemptId);
});
test('blocking report prevents submit and acceptance requires a real prerequisite',t=>{
  const f=fixture(t);f.start();f.report();fs.writeFileSync(path.join(f.project,'out/p'),'premature');
  assert.throws(()=>f.send({type:'submit',packetId:'p',attemptId:f.get().packets[0].attempts[0].id,summary:'done'}),{code:'UNRESOLVED_DISCOVERY'});
  f.send({type:'block',packetId:'p',reason:'need prep',feedback:{kind:'changeRequest',reason:'prep'}});
  assert.throws(()=>f.send({type:'resolve_discoveries',decisions:[{id:f.get().discoveries[0].id,status:'accepted',packetIds:['q'],reason:'do q'}],packets:[packet(),packet('q')],reason:'new work'}),{code:'DISCOVERY_DEPENDENCY'});
});
test('accepted work cannot disappear in a later amendment',t=>{
  const f=fixture(t);f.start();f.report(discovery({impact:'nonblocking'}));finish(f);
  f.send({type:'resolve_discoveries',decisions:[{id:f.get().discoveries[0].id,status:'accepted',packetIds:['q'],reason:'do q'}],packets:[packet(),packet('q')],reason:'new work'});
  const before=f.get();assert.throws(()=>f.send({type:'amend_plan',packets:[packet('p',{purpose:'changed'})],reason:'drop q'}),{code:'UNRESOLVED_DISCOVERY'});assert.deepEqual(f.get(),before);
});
test('reopening a canonical discovery reopens its duplicates and revision requires new alignment',t=>{
  const f=fixture(t);f.start();f.report(discovery({impact:'nonblocking'}));f.report(discovery({key:'same-gap',impact:'nonblocking'}));finish(f);
  const [one,two]=f.get().discoveries;
  f.send({type:'resolve_discoveries',decisions:[{id:one.id,status:'dismissed',reason:'outside goal'},{id:two.id,status:'duplicate',duplicateOf:one.id,reason:'same gap'}]});
  f.send({type:'reopen_discovery',id:one.id,reason:'new requirement evidence'});
  assert.deepEqual(f.get().discoveries.map(d=>d.status),['pending','pending']);
  f.send({type:'resolve_discoveries',decisions:[{id:one.id,status:'dismissed',reason:'outside goal'},{id:two.id,status:'duplicate',duplicateOf:one.id,reason:'same gap'}]});
  f.send({type:'revise',contract:f.get().contract,reason:'realign'});assert.deepEqual(f.get().discoveries.map(d=>d.status),['pending','pending']);
});
const reviewed={passed:true,findings:[],evidence:'read actual output'},integrated={results:[{criterionId:'a',passed:true,evidence:'actual outputs'}],summary:'complete'};
function sessions(respond){let n=0;return async r=>{const sessionId=`discovery-${++n}`;await r.onStart(sessionId);return {sessionId,text:JSON.stringify(await respond(r)),usage:'unknown'};};}
test('nonblocking discovery adds work before integration without repeating verified producer',async t=>{
  const f=fixture(t);const writes=[];
  const result=await runCase({store:f.store,caseId:f.id,runSession:sessions(async r=>{
    if(r.role==='worker'){
      const id=r.writeScope[0].split('/').at(-1);writes.push(id);fs.writeFileSync(path.join(f.project,`out/${id}`),'correct');
      if(id==='p')await r.onDiscovery(discovery({impact:'nonblocking'}));
      return {summary:'written'};
    }
    if(r.role==='planner'){const id=f.get().discoveries[0].id;return {decisions:[{id,status:'accepted',reason:'additional required output',packetIds:['q']}],packets:[packet(),packet('q')],reason:'complete coverage'};}
    return r.role==='reviewer'?reviewed:integrated;
  })});
  assert.equal(result.state.status,'completed');assert.deepEqual(writes,['p','q']);assert.equal(result.state.discoveries[0].status,'accepted');
});
test('blocked discovery allows unrelated work to finish before returning real external blocker',async t=>{
  const f=fixture(t);f.send({type:'amend_plan',packets:[packet(),packet('q')],reason:'independent output'});const writes=[];
  await assert.rejects(runCase({store:f.store,caseId:f.id,runSession:sessions(async r=>{
    if(r.role==='worker'){
      const id=r.writeScope[0].split('/').at(-1);
      if(id==='p'){await r.onDiscovery(discovery());return {changeRequest:{reason:'external input missing'}};}
      writes.push(id);fs.writeFileSync(path.join(f.project,`out/${id}`),'correct');return {summary:'written'};
    }
    if(r.role==='planner')return {decisions:[{id:f.get().discoveries[0].id,status:'needs_input',reason:'external input missing'}]};
    return reviewed;
  })}),{code:'BLOCKED'});
  assert.deepEqual(writes,['q']);assert.equal(f.get().packets.find(p=>p.id==='q').status,'verified');
  await assert.rejects(runCase({store:f.store,caseId:f.id,runSession:async()=>assert.fail('do not repeat triage without new information')}),{code:'BLOCKED'});
});

test('blocking discovery adds prerequisite then resumes the original packet in a fresh attempt',async t=>{
  const f=fixture(t),writes=[];let reports=0;
  const result=await runCase({store:f.store,caseId:f.id,runSession:sessions(async r=>{
    if(r.role==='worker'){
      const id=r.writeScope[0].split('/').at(-1);
      if(id==='p' && reports++===0){await r.onDiscovery(discovery());return {changeRequest:{reason:'need prep'}};}
      writes.push(id);fs.writeFileSync(path.join(f.project,`out/${id}`),'correct');await r.validateResult({summary:'written'});return {summary:'written'};
    }
    if(r.role==='planner')return {decisions:[{id:f.get().discoveries[0].id,status:'accepted',packetIds:['prep'],reason:'prepare original goal input'}],packets:[packet('prep'),packet('p',{dependsOn:['prep'],inputs:[{path:'out/prep',required:true}]})],reason:'add missing preparation'};
    return r.role==='reviewer'?reviewed:integrated;
  })});
  assert.equal(result.state.status,'completed');assert.deepEqual(writes,['prep','p']);assert.equal(result.state.packets.find(p=>p.id==='p').attempts.length,2);
});
test('worker preflight preserves failed checks and allows actual repair in the same attempt',async t=>{
  const f=fixture(t);let workers=0;
  const result=await runCase({store:f.store,caseId:f.id,executeChecks:async r=>[{id:'actual',exitCode:fs.readFileSync(path.join(f.project,'out/p'),'utf8')==='correct'?0:1}],runSession:sessions(async r=>{
    if(r.role==='worker'){
      workers++;await assert.rejects(r.validateResult({summary:'done'}),{code:'MISSING_INPUT'});
      fs.writeFileSync(path.join(f.project,'out/p'),'wrong');await assert.rejects(r.validateResult({summary:'done'}),{code:'CHECK_FAILED'});
      assert.equal(f.get().packets[0].status,'running');fs.writeFileSync(path.join(f.project,'out/p'),'correct');await r.validateResult({summary:'repaired'});return {summary:'repaired'};
    }
    return r.role==='reviewer'?reviewed:integrated;
  })});
  assert.equal(workers,1);assert.equal(result.state.status,'completed');assert.equal(result.run.checks[0].role,'worker');assert.equal(result.run.checks[0].results[0].exitCode,1);
});
test('duplicate disposition cannot introduce a chain or conceal deferred blocking work',t=>{
  const f=fixture(t);f.start();f.report(discovery({impact:'nonblocking'}));f.report(discovery({key:'blocking'}));
  f.send({type:'block',packetId:'p',reason:'stop',feedback:{kind:'changeRequest',reason:'stop'}});const [one,two]=f.get().discoveries;
  assert.throws(()=>f.send({type:'resolve_discoveries',decisions:[{id:one.id,status:'deferred',reason:'optional'},{id:two.id,status:'duplicate',duplicateOf:one.id,reason:'same'}]}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>f.send({type:'resolve_discoveries',decisions:[{id:one.id,status:'duplicate',duplicateOf:two.id,reason:'cycle'},{id:two.id,status:'duplicate',duplicateOf:one.id,reason:'cycle'}]}),{code:'INVALID_ARGUMENT'});
  assert.deepEqual(f.get().discoveries.map(d=>d.status),['pending','pending']);
});
test('disposition cannot forge packet mappings through a dismissed duplicate target',t=>{
  const f=fixture(t);f.start();f.report(discovery({impact:'nonblocking'}));f.report(discovery({key:'second',impact:'nonblocking'}));finish(f);
  const [one,two]=f.get().discoveries;
  assert.throws(()=>f.send({type:'resolve_discoveries',decisions:[{id:one.id,status:'dismissed',reason:'irrelevant'},{id:two.id,status:'duplicate',duplicateOf:one.id,packetIds:['p'],reason:'same'}]}),{code:'INVALID_ARGUMENT'});
});
test('unresolved discovery also blocks descendants of its source packet',t=>{
  const f=fixture(t);f.send({type:'amend_plan',packets:[packet(),packet('q',{dependsOn:['p']})],reason:'dependent work'});
  f.start();f.report(discovery());f.send({type:'block',packetId:'p',reason:'pause',feedback:{kind:'changeRequest',reason:'pause'}});
  const id=f.get().discoveries[0].id;f.send({type:'resolve_discoveries',decisions:[{id,status:'dismissed',reason:'false alarm'}]});f.send({type:'retry',packetId:'p',reason:'continue'});finish(f);
  f.send({type:'retry',packetId:'q',reason:'source is verified'});
  f.send({type:'reopen_discovery',id,reason:'new evidence source invalid'});
  assert.throws(()=>f.send({type:'start',packetId:'q',sessionId:'premature'}),{code:'UNRESOLVED_DISCOVERY'});
});
test('repeated failed review with missing external input still permits independent work',async t=>{
  const f=fixture(t);f.send({type:'amend_plan',packets:[packet(),packet('q')],reason:'independent output'});const writes=[];
  await assert.rejects(runCase({store:f.store,caseId:f.id,runSession:sessions(async r=>{
    if(r.role==='worker') {const id=r.writeScope[0].split('/').at(-1);writes.push(id);fs.writeFileSync(path.join(f.project,`out/${id}`),'written');return {summary:'written'};}
    if(r.role==='reviewer')return writes.at(-1)==='p'?{passed:false,findings:['external source missing'],evidence:'cannot reconcile missing source'}:reviewed;
    if(r.role==='planner')return {blocked:{reason:'external source must be supplied'}};
    assert.fail('integration cannot pass missing external source');
  })}),{code:'BLOCKED'});
  assert.deepEqual(writes,['p','p','q']);assert.equal(f.get().packets.find(p=>p.id==='q').status,'verified');
});
test('discovery context carries disposition into resumed work without unrelated history',t=>{
  const f=fixture(t);f.start();f.report();f.send({type:'block',packetId:'p',reason:'need prep',feedback:{kind:'changeRequest',reason:'need prep'}});
  const id=f.get().discoveries[0].id;f.send({type:'resolve_discoveries',decisions:[{id,status:'accepted',packetIds:['prep'],reason:'source normalization is required'}],packets:[packet('prep'),packet('p',{dependsOn:['prep']})],reason:'prep'});
  finish(f,'prep');const context=JSON.parse(f.store.context(f.id,'p'));
  assert.equal(context.discoveries[0].decision.reasonPreview,'source normalization is required');
  const full=JSON.parse(f.store.readDiscovery(f.id,id).text);assert.equal(full.evidence,discovery().evidence);
});
test('explicit new evidence reopens waiting work without rerunning verified independent output',async t=>{
  const f=fixture(t);f.send({type:'amend_plan',packets:[packet(),packet('q')],reason:'independent output'});let supplied=false;const writes=[];
  const runSession=sessions(async r=>{
    if(r.role==='worker'){
      const id=r.writeScope[0].split('/').at(-1);
      if(id==='p'&&!supplied){await r.onDiscovery(discovery());return {changeRequest:{reason:'external source missing'}};}
      writes.push(id);fs.writeFileSync(path.join(f.project,`out/${id}`),'correct');return {summary:'written'};
    }
    if(r.role==='planner')return supplied?{decisions:[{id:f.get().discoveries[0].id,status:'dismissed',reason:'the missing source has now been supplied and checked'}]}:{decisions:[{id:f.get().discoveries[0].id,status:'needs_input',reason:'external source missing'}]};
    return r.role==='reviewer'?reviewed:integrated;
  });
  await assert.rejects(runCase({store:f.store,caseId:f.id,runSession}),{code:'BLOCKED'});
  const firstRun=f.store.listRuns(f.id)[0],firstStart=f.get().startedAt;
  supplied=true;f.send({type:'reopen_discovery',id:f.get().discoveries[0].id,reason:'supplied and checked source'});
  const result=await runCase({store:f.store,caseId:f.id,runSession});
  assert.equal(result.state.status,'completed');assert.deepEqual(writes,['q','p']);assert.equal(result.state.startedAt,firstStart);assert.deepEqual(f.store.listRuns(f.id).find(r=>r.id===firstRun.id),firstRun);
});
test('bounded discovery reports preserve all accepted receipts at the cap',t=>{
  const f=fixture(t);f.start();
  for(let i=0;i<32;i++)f.report(discovery({key:`gap-${i}`,impact:'nonblocking'}));
  const before=f.get();assert.throws(()=>f.report(discovery({key:'overflow'})),{code:'DISCOVERY_LIMIT'});assert.deepEqual(f.get(),before);
  f.report(discovery({key:'gap-0',impact:'nonblocking'}));assert.equal(f.get().discoveries.length,32);
});
test('new independent evidence can clear an earlier external wait after successful replanning',async t=>{
  const f=fixture(t);f.send({type:'amend_plan',packets:[packet(),packet('q')],reason:'independent output'});let planners=0;const workers=[];
  const result=await runCase({store:f.store,caseId:f.id,runSession:sessions(async r=>{
    if(r.role==='worker'){
      const id=r.writeScope[0].split('/').at(-1);workers.push(id);
      if(workers.length===1)return {blocked:{reason:'missing preparation source'}};
      if(workers.length===2)return {changeRequest:{reason:'found authorized equivalent source usable for both packets'}};
      fs.writeFileSync(path.join(f.project,`out/${id}`),'correct');return {summary:'written'};
    }
    if(r.role==='planner')return ++planners===1?{blocked:{reason:'preparation source unavailable'}}:{packets:[packet('p',{purpose:'use equivalent source'}),packet('q',{purpose:'use equivalent source'})],reason:'independent investigation found sufficient existing source'};
    return r.role==='reviewer'?reviewed:integrated;
  })});
  assert.equal(result.state.status,'completed');assert.deepEqual(workers,['p','q','p','q']);assert.equal(result.run.waitingReason,undefined);
});
test('large legal discovery evidence stays readable through bounded planner and integration contexts',async t=>{
  const f=fixture(t);f.start();
  for(let i=0;i<8;i++)f.report(discovery({key:`large-${i}`,impact:'nonblocking',summary:'s'.repeat(2000),evidence:`${i}:`+'e'.repeat(3998)}));
  finish(f);const ids=f.get().discoveries.map(d=>d.id),reads=[];
  const result=await runCase({store:f.store,caseId:f.id,runSession:sessions(async r=>{
    assert.ok(r.prompt.length<48000);assert.equal(r.prompt.includes('e'.repeat(3000)),false);
    for(const id of ids){let text='',start=0,part;do {part=await r.readDiscovery({id,start,maxChars:1000});assert.ok(part.text.length<=1000);text+=part.text;start=part.nextStart;}while(!part.complete);assert.equal(JSON.parse(text).evidence.length,4000);reads.push(id);}
    return r.role==='planner'?{decisions:ids.map(id=>({id,status:'dismissed',reason:'reviewed complete evidence: optional follow-up outside original goal'}))}:integrated;
  })});
  assert.equal(result.state.status,'completed');assert.equal(reads.length,16);
});
test('discovery read enforces explicit bounded offsets without mutating authority',t=>{
  const f=fixture(t);f.start();f.report(discovery({impact:'nonblocking'}));const before=f.get(),id=before.discoveries[0].id;
  const part=f.store.readDiscovery(f.id,id,{start:0,maxChars:30});assert.equal(part.text.length,30);assert.equal(part.complete,false);assert.equal(part.nextStart,30);
  assert.throws(()=>f.store.readDiscovery(f.id,id,{start:-1}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>f.store.readDiscovery(f.id,id,{maxChars:12001}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>f.store.readDiscovery(f.id,'unknown'),{code:'INVALID_ARGUMENT'});assert.deepEqual(f.get(),before);
});
test('discovery amendment can release an earlier legacy wait when independent evidence repairs the plan',async t=>{
  const f=fixture(t);f.send({type:'amend_plan',packets:[packet(),packet('q')],reason:'independent output'});let planners=0;const workers=[];
  const result=await runCase({store:f.store,caseId:f.id,runSession:sessions(async r=>{
    if(r.role==='worker'){
      const id=r.writeScope[0].split('/').at(-1);workers.push(id);
      if(workers.length===1)return {blocked:{reason:'missing preparation source'}};
      fs.writeFileSync(path.join(f.project,`out/${id}`),'correct');
      if(id==='q')await r.onDiscovery(discovery({impact:'nonblocking',summary:'Equivalent source can prepare missing work'}));
      return {summary:'written'};
    }
    if(r.role==='planner')return ++planners===1?{blocked:{reason:'preparation source unavailable'}}:{decisions:[{id:f.get().discoveries[0].id,status:'accepted',reason:'prepare available source',packetIds:['prep']}],packets:[packet('prep'),packet('p',{dependsOn:['prep']}),packet('q')],reason:'independent source discovery resolves initial obstacle'};
    return r.role==='reviewer'?reviewed:integrated;
  })});
  assert.equal(result.state.status,'completed');assert.deepEqual(workers,['p','q','prep','p']);assert.equal(result.run.pendingFeedback,null);assert.equal(result.run.waitingReason,undefined);
});
for(const reply of [
  {summary:'written',discoveries:[{key:'lost',summary:'new required work'}]},
  {summary:'written',evidence:'unhandled extra data'},
  {summary:'written',blocked:{reason:'cannot continue'}},
  {blocked:{reason:'missing'},changeRequest:{reason:'change'}},
  {blocked:{reason:'missing',evidence:'must not discard'}},
  {changeRequest:{reason:'change',packetIds:['prep']}},
])test(`standalone runner rejects unhandled or mixed worker data: ${JSON.stringify(reply)}`,async t=>{
  const f=fixture(t);
  await assert.rejects(runCase({store:f.store,caseId:f.id,runSession:sessions(async r=>{
    if(r.role==='worker'){fs.writeFileSync(path.join(f.project,'out/p'),'correct');return reply;}
    if(r.role==='planner')return {blocked:{reason:'unexpected legacy routing'}};
    return r.role==='reviewer'?reviewed:integrated;
  })}),failure=>{assert.equal(failure.code,'INVALID_REPLY');assert.match(failure.message,/case_discover/);return true;});
  assert.equal(f.get().packets[0].status,'running');assert.equal(f.get().packets[0].attempts[0].summary,undefined);
});
