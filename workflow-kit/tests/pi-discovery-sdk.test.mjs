import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createPiSessionRunner} from '../integrations/pi/sdk-session.mjs';

async function fixture(t,script,options={}) {
  const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-discovery-sdk-')));
  t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
  let prompts=0,aborts=0,text='{"summary":"done"}';
  const sdk={SettingsManager:{inMemory:x=>x},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{async reload(){}},
    async createAgentSession(config){return {session:{sessionId:'isolated',subscribe:()=>()=>{},
      async prompt(){await script({project,prompt:++prompts,setText:value=>text=value,tool:(name,args)=>{
        const tool=config.customTools.find(t=>t.name===name);assert.ok(tool,`${name} must be registered`);return tool.execute(name,args);
      }});},getLastAssistantText:()=>text,getSessionStats:()=>({}),abort:async()=>{aborts++;if(options.abortFailure)throw Object.assign(new Error('stop failed'),{code:'STOP_FAILED'});},dispose(){}}};}};
  return {project,run:await createPiSessionRunner({project,agentDir:project,sdk,model:{id:'local',provider:'local'},modelRuntime:{},...options}),prompts:()=>prompts,aborts:()=>aborts};
}

test('async rejected result leaves original session open to repair its actual file',async t=>{
  let validations=0;
  const f=await fixture(t,async ({project,tool})=>{
    await assert.rejects(tool('case_result',{result:{summary:'done'}}),{code:'CHECK_FAILED'});
    await tool('case_write',{path:'out',content:'correct'});
    await tool('case_result',{result:{summary:'repaired'}});
    assert.equal(fs.readFileSync(path.join(project,'out'),'utf8'),'correct');
  });
  const reply=await f.run({role:'worker',prompt:'work',writeScope:['out'],onStart(){},async validateResult(){
    validations++;await Promise.resolve();if(!fs.existsSync(path.join(f.project,'out')))throw Object.assign(new Error('missing output'),{code:'CHECK_FAILED'});
  }});
  assert.equal(validations,2);assert.equal(f.prompts(),1);assert.equal(JSON.parse(reply.text).summary,'repaired');
});
test('pending asynchronous validation rejects overlapping writes without changing the file',async t=>{
  let release,entered;
  const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  const f=await fixture(t,async ({project,tool})=>{
    const result=tool('case_result',{result:{summary:'done'}});await started;
    await assert.rejects(tool('case_write',{path:'out',content:'racing'}),{code:'RESULT_BUSY'});
    assert.equal(fs.existsSync(path.join(project,'out')),false);release();await result;
  });
  await f.run({role:'worker',prompt:'work',writeScope:['out'],onStart(){},async validateResult(){entered();await gate;}});
});
test('final text is asynchronously validated after the final correction and cannot bypass rejection',async t=>{
  const f=await fixture(t,async()=>{});
  await assert.rejects(f.run({role:'worker',prompt:'work',onStart(){},async validateResult(){throw Object.assign(new Error('no file'),{code:'MISSING_INPUT'});}}),{code:'MISSING_INPUT'});
  assert.equal(f.prompts(),2);
});
test('successful final-text preflight runs approved checks only once',async t=>{
  const f=await fixture(t,async()=>{});let validations=0;
  await f.run({role:'worker',prompt:'work',onStart(){},async validateResult(){validations++;}});
  assert.equal(validations,1);
});
test('cancellation during async validation never records a successful result',async t=>{
  const controller=new AbortController();
  const f=await fixture(t,async ({tool})=>{await assert.rejects(tool('case_result',{result:{summary:'done'}}),{code:'CANCELLED'});});
  await assert.rejects(f.run({role:'worker',prompt:'work',signal:controller.signal,onStart(){},async validateResult(){controller.abort();}}),failure=>{
    assert.equal(failure.code,'CANCELLED');assert.equal(failure.sessionEvidence.resultTransport,'final-text');return true;
  });
});
for(const impact of ['nonblocking','blocking'])test(`case_discover ${impact} persists before continuing or handing back`,async t=>{
  const events=[];
  const f=await fixture(t,async ({tool,project})=>{
    const receipt=await tool('case_discover',{key:'gap',summary:'missing report',evidence:'source requires report',impact});
    assert.equal(receipt.details.id,'saved-id');assert.deepEqual(events,['saved']);
    if(impact==='blocking'){
      await assert.rejects(tool('case_write',{path:'out',content:'late'}),{code:'DISCOVERY_BLOCKED'});
      assert.equal(fs.existsSync(path.join(project,'out')),false);
    }else {await tool('case_write',{path:'out',content:'correct'});await tool('case_result',{result:{summary:'done'}});}
  });
  const reply=await f.run({role:'worker',prompt:'work',writeScope:['out'],onStart(){},async onDiscovery(d){assert.equal(d.impact,impact);await Promise.resolve();events.push('saved');return {id:'saved-id',status:'pending'};}});
  if(impact==='blocking')assert.match(JSON.parse(reply.text).changeRequest.reason,/missing report/);
  else assert.equal(fs.readFileSync(path.join(f.project,'out'),'utf8'),'correct');
});
test('accepted result stops model generation and identical replay cannot poison valid work',async t=>{
  const f=await fixture(t,async ({tool})=>{
    await tool('case_result',{result:{summary:'done'}});
    await tool('case_result',{result:{summary:'done'}});
  });
  const reply=await f.run({role:'worker',prompt:'work',onStart(){},async validateResult(){}});
  assert.equal(JSON.parse(reply.text).summary,'done');assert.equal(f.aborts(),1);
});
test('scoped discovery reader returns only the explicitly provided bounded record',async t=>{
  const f=await fixture(t,async ({tool})=>{
    const read=await tool('case_discovery_read',{id:'known',start:0,maxChars:20});assert.equal(read.details.text,'authoritative chunk');
    await assert.rejects(tool('case_discovery_read',{id:'other'}),{code:'DISCOVERY_ACCESS_DENIED'});
    await tool('case_result',{result:{summary:'done'}});
  });
  await f.run({role:'planner',prompt:'work',onStart(){},readDiscovery:async args=>{
    if(args.id!=='known')throw Object.assign(new Error('not in this context'),{code:'DISCOVERY_ACCESS_DENIED'});
    return {id:'known',text:'authoritative chunk',start:0,nextStart:19,totalChars:19,complete:true};
  }});
});
test('failed stop after accepted result preserves the accepted evidence and reports uncertain shutdown',async t=>{
  const f=await fixture(t,async ({tool})=>{await tool('case_result',{result:{summary:'done'}});},{abortFailure:true});
  await assert.rejects(f.run({role:'worker',prompt:'work',onStart(){}}),failure=>{
    assert.equal(failure.code,'STOP_FAILED');assert.equal(failure.sessionEvidence.text,'{"summary":"done"}');assert.equal(failure.sessionEvidence.resultTransport,'case_result');return true;
  });
});
test('expected AbortError after accepted result is a controlled handoff',async t=>{
  const f=await fixture(t,async ({tool})=>{await tool('case_result',{result:{summary:'done'}});throw Object.assign(new Error('session stopped'),{name:'AbortError'});});
  const reply=await f.run({role:'worker',prompt:'work',onStart(){}});assert.equal(reply.text,'{"summary":"done"}');
});
test('worker result rejects unknown and mixed fields before preflight while allowing a corrected reply',async t=>{
  let preflights=0;
  const f=await fixture(t,async ({tool})=>{
    for(const result of [{summary:'done',discoveries:[{key:'lost'}]},{summary:'done',blocked:{reason:'missing'}},{blocked:{reason:'missing',evidence:'lost'}},{changeRequest:{reason:'change',extra:'lost'}}])
      await assert.rejects(tool('case_result',{result}),failure=>{assert.equal(failure.code,'INVALID_REPLY');assert.match(failure.message,/case_discover/);return true;});
    await tool('case_write',{path:'out',content:'correct'});await tool('case_result',{result:{summary:'done'}});
  });
  const reply=await f.run({role:'worker',prompt:'work',writeScope:['out'],onStart(){},async validateResult(){preflights++;}});
  assert.equal(preflights,1);assert.equal(reply.text,'{"summary":"done"}');assert.equal(fs.readFileSync(path.join(f.project,'out'),'utf8'),'correct');
});
test('worker final-text rejects unsupported structured data even without an injected validator',async t=>{
  const f=await fixture(t,async ({setText})=>setText('{"summary":"done","discoveries":[{"key":"lost"}]}'));
  await assert.rejects(f.run({role:'worker',prompt:'work',onStart(){}}),{code:'INVALID_REPLY'});assert.equal(f.prompts(),2);
});
