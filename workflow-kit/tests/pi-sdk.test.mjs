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

for (const mode of ['read-only','checks','worker','abort-failed','dispose-failed'])
test(`failed SDK session reports conservative recovery eligibility: ${mode}`, async t => {
  const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-recovery-sdk-')));
  t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
  let aborted=false, disposed=false;
  const sdk={SettingsManager:{inMemory:v=>v},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{async reload(){}},
    async createAgentSession(){return {session:{sessionId:'failed-read',subscribe(){return ()=>{};},
      async prompt(){throw Object.assign(new Error('connection reset'),{code:'ECONNRESET'});},
      getLastAssistantText:()=>'',getSessionStats:()=>({tokens:{input:7,output:0}}),
      setAutoCompactionEnabled(){},abortCompaction(){},
      async abort(){aborted=true;if(mode==='abort-failed')throw new Error('abort failed');},
      dispose(){disposed=true;if(mode==='dispose-failed')throw new Error('dispose failed');}}};}};
  const run=await adapter.createPiSessionRunner({project,agentDir:project,sdk,model:{id:'local',provider:'local'},modelRuntime:{},
    checks:mode==='checks'?{check:{command:process.execPath,args:['--version']}}:{}});
  await assert.rejects(run({role:mode==='worker'?'worker':'integrator',prompt:'verify',onStart(){}}),failure=>{
    assert.equal(failure.code,'ECONNRESET');
    assert.equal(failure.sessionEvidence.recovery?.safeToRetry,mode==='read-only');
    assert.equal(failure.sessionEvidence.usage.input,7);
    return true;
  });
  assert.equal(aborted,true);assert.equal(disposed,true);
});

for(const kind of ['connection','http-error']) test(`native stream keeps transport evidence separate from HTTP error text: ${kind}`,async t=>{
  const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-fetch-evidence-')));
  t.after(()=>fs.rmSync(project,{recursive:true,force:true}));let notify;
  const model={id:'local',provider:'local',api:'openai-completions'};
  const sdk={SettingsManager:{inMemory:v=>v},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{async reload(){}},
    async createAgentSession(){
      const agent={streamFunction:async (_model,_context,options)=>{
        // Provider consumes fetch errors and emits normal error messages, as pi does.
        try {await options.fetch('http://unused.invalid');}catch{}
        notify({type:'message_end',message:{role:'assistant',stopReason:'error',errorMessage:'ECONNRESET'}});
      }};
      return {session:{agent,sessionId:'fetch-evidence',subscribe(fn){notify=fn;return ()=>{};},
        async prompt(){await agent.streamFunction(model,{}, {fetch:async()=>{
          if(kind==='connection')throw new TypeError('fetch failed',{cause:Object.assign(new Error('reset'),{code:'ECONNRESET'})});
          return {status:401};
        }});},getLastAssistantText:()=>'',getSessionStats:()=>({}),setAutoCompactionEnabled(){},abortCompaction(){},async abort(){},dispose(){}}};}};
  const run=await adapter.createPiSessionRunner({project,agentDir:project,sdk,model,modelRuntime:{}});
  await assert.rejects(run({role:'integrator',prompt:'verify',onStart(){}}),{code:kind==='connection'?'ECONNRESET':'MODEL_PROVIDER_ERROR'});
});

for(const message of ['read ECONNRESET','401 invalid API key','429 quota exceeded'])
test(`native provider error is not a JSON repair: ${message}`,async t=>{
  const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-provider-error-')));
  t.after(()=>fs.rmSync(project,{recursive:true,force:true}));let prompts=0,notify;
  const sdk={SettingsManager:{inMemory:v=>v},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{async reload(){}},
    async createAgentSession(){return {session:{sessionId:'provider-error',subscribe(fn){notify=fn;return ()=>{};},
      async prompt(){prompts++;notify({type:'message_end',message:{role:'assistant',stopReason:'error',errorMessage:message}});},
      getLastAssistantText:()=>'',getSessionStats:()=>({}),setAutoCompactionEnabled(){},abortCompaction(){},async abort(){},dispose(){}}};}};
  const run=await adapter.createPiSessionRunner({project,agentDir:project,sdk,model:{id:'local',provider:'local'},modelRuntime:{}});
  await assert.rejects(run({role:'integrator',prompt:'verify',onStart(){}}),failure=>{
    assert.equal(failure.code,'MODEL_PROVIDER_ERROR');assert.equal(failure.message,message);return true;
  });
  assert.equal(prompts,1);
});

test('SDK stop evidence drives runner recovery through to actual file acceptance',async t=>{
  const {createStore}=await import('../skills/case-workflow/scripts/core/index.mjs');
  const {runCase}=await import('../integrations/pi/runner.mjs');
  const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-sdk-run-resume-')));
  t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
  let sessions=0,writes=0;const stopped=new Set();
  const sdk={SettingsManager:{inMemory:v=>v},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{async reload(){}},
    async createAgentSession(options){const n=++sessions;return {session:{sessionId:`native-${n}`,subscribe(){return ()=>{};},
      async prompt(){
        const tool=name=>options.customTools.find(t=>t.name===name);
        let result;
        if(n===1)result={packets:[{id:'p',purpose:'write result',constraintIds:[],inputs:[],dependsOn:[],writeScope:['out'],deliverables:[{path:'out'}],checks:[{id:'k',text:'out contains result',criterionIds:['a']}],unknowns:[]}]};
        else if(n===2){await tool('case_write').execute('write',{path:'out',content:'result'});writes++;result={summary:'written'};}
        else if(n===4)throw Object.assign(new Error('connection reset'),{code:'ECONNRESET'});
        else {
          if(n===5)assert.ok(stopped.has(4),'failed session is disposed before replacement');
          const receipt=(await tool('case_read').execute('read',{path:'out'})).details;
          const evidence={assessment:'actual file contains result',receiptIds:[receipt.receiptId]};
          result=n===3?{passed:true,findings:[],evidence}:{results:[{criterionId:'a',passed:true,evidence}],summary:'complete'};
        }
        await tool('case_result').execute('result',{result});
      },getLastAssistantText:()=>'',getSessionStats:()=>({tokens:{input:5,output:1}}),
      setAutoCompactionEnabled(){},abortCompaction(){},async abort(){},dispose(){stopped.add(n);}}};}};
  const runSession=await adapter.createPiSessionRunner({project,agentDir:project,sdk,model:{id:'local',provider:'local'},modelRuntime:{}});
  const store=createStore(project);store.init();
  const state=store.create({goal:'write result',constraints:[],acceptance:[{id:'a',text:'out contains result'}],budget:{maxAttempts:3,maxDurationMs:60000}});
  const completed=await runCase({store,caseId:state.id,runSession});
  assert.equal(completed.state.status,'completed');
  assert.equal(fs.readFileSync(path.join(project,'out'),'utf8'),'result');
  assert.equal(writes,1);assert.equal(sessions,5);
  assert.deepEqual(completed.run.sessions.map(s=>s.status),['returned','returned','returned','failed','returned']);
  assert.equal(completed.run.transportRecoveries.length,1);
  assert.equal(completed.run.sessions[3].usage.input,5);
});

// Exercise real scoped reads and result validation; only the external model loop is replaced.
for (const role of ['reviewer','integrator']) for (const transport of ['tool','final'])
test(`receipt evidence resolves actual sources without rewriting model input: ${role}/${transport}`, async t=>{
  const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-cited-review-')));
  t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
  fs.writeFileSync(path.join(project,'source'),'one\r\ntwo\r\n');
  let raw,receipt,validated;
  const sdk={SettingsManager:{inMemory:v=>v},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{async reload(){}},
    async createAgentSession(options){return {session:{sessionId:'cited',subscribe(){return ()=>{};},async prompt(){
      const read=options.customTools.find(t=>t.name==='case_read');
      const result=await read.execute('read',{path:'source',startLine:2,maxLines:1});
      receipt=result.details;
      assert.equal(typeof receipt.receiptId,'string');
      assert.equal(JSON.parse(result.content[0].text.split('\n')[0].slice(10)).receiptId,receipt.receiptId);
      const evidence={assessment:'Second line supports the claim; semantic relevance remains a judgment.',receiptIds:[receipt.receiptId]};
      raw=role==='reviewer'?{passed:true,findings:[],evidence}:{results:[{criterionId:'a',passed:true,evidence}],summary:'done'};
      if(transport==='tool')await options.customTools.find(t=>t.name==='case_result').execute('done',{result:raw});
    },getLastAssistantText:()=>JSON.stringify(raw),getSessionStats:()=>({}),abort:async()=>{},dispose(){}}};}};
  const run=await adapter.createPiSessionRunner({project,agentDir:project,sdk,model:{id:'local',provider:'local'},modelRuntime:{}});
  const result=await run({role,prompt:'verify',evidenceMode:'read-receipts',verificationPaths:['source'],onStart(){},validateResult(reply){validated=reply;}});
  const parsed=JSON.parse(result.text),e=role==='reviewer'?parsed.evidence:parsed.results[0].evidence;
  assert.deepEqual(e.citations,[receipt]);
  assert.deepEqual(e.citations[0].range,{startLine:2,endLine:2});
  assert.equal(e.citations[0].path,'source');
  assert.equal(e.assessment,role==='reviewer'?raw.evidence.assessment:raw.results[0].evidence.assessment);
  assert.deepEqual(validated,parsed,'consumer validation sees resolved evidence');
  assert.equal(result.rawResultText,JSON.stringify(raw),'original model submission survives normalization');
  assert.equal(Object.hasOwn(role==='reviewer'?raw.evidence:raw.results[0].evidence,'citations'),false);
});

test('receipt evidence rejects fabricated, stale, out-of-range and malformed citations without stopping repair',async t=>{
  const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-invalid-citation-')));
  t.after(()=>fs.rmSync(project,{recursive:true,force:true}));fs.writeFileSync(path.join(project,'source'),'original');
  const sdk={SettingsManager:{inMemory:v=>v},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{async reload(){}},
    async createAgentSession(options){return {session:{sessionId:'invalid-cited',subscribe(){return ()=>{};},async prompt(){
      const read=options.customTools.find(t=>t.name==='case_read'),result=options.customTools.find(t=>t.name==='case_result');
      const submit=evidence=>result.execute('result',{result:{passed:true,findings:[],evidence}});
      await assert.rejects(submit('free prose'),{code:'INVALID_CITATION'});
      await assert.rejects(submit({assessment:'checked',receiptIds:['invented']}),{code:'INVALID_CITATION'});
      await assert.rejects(submit({assessment:'checked',receiptIds:[]}),{code:'INVALID_CITATION'});
      const outside=(await read.execute('outside',{path:'source',startLine:99})).details;
      await assert.rejects(submit({assessment:'checked',receiptIds:[outside.receiptId]}),{code:'INVALID_CITATION'});
      const first=(await read.execute('first',{path:'source'})).details;
      await assert.rejects(submit({assessment:'checked',receiptIds:[first.receiptId],sha256:'invented'}),{code:'INVALID_CITATION'});
      await assert.rejects(submit({assessment:'checked',receiptIds:[first.receiptId,first.receiptId]}),{code:'INVALID_CITATION'});
      fs.writeFileSync(path.join(project,'source'),'changed');
      await assert.rejects(submit({assessment:'checked',receiptIds:[first.receiptId]}),{code:'STALE_CITATION'});
      const fresh=(await read.execute('fresh',{path:'source'})).details;
      await submit({assessment:'checked current content',receiptIds:[fresh.receiptId]});
    },getLastAssistantText:()=>'',getSessionStats:()=>({}),abort:async()=>{},dispose(){}}};}};
  const run=await adapter.createPiSessionRunner({project,agentDir:project,sdk,model:{id:'local',provider:'local'},modelRuntime:{}});
  assert.equal(JSON.parse((await run({role:'reviewer',prompt:'verify',evidenceMode:'read-receipts',onStart(){}})).text).passed,true);
});

test('negative receipt review can report missing evidence without inventing a citation',async t=>{
  const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-negative-citation-')));
  t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
  const raw={passed:false,findings:['source unavailable'],evidence:{assessment:'Cannot verify the source.',receiptIds:[]}};
  const sdk={SettingsManager:{inMemory:v=>v},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{async reload(){}},
    async createAgentSession(){return {session:{sessionId:'negative',subscribe(){return ()=>{};},async prompt(){},getLastAssistantText:()=>JSON.stringify(raw),getSessionStats:()=>({}),abort:async()=>{},dispose(){}}};}};
  const run=await adapter.createPiSessionRunner({project,agentDir:project,sdk,model:{id:'local',provider:'local'},modelRuntime:{}});
  const result=await run({role:'reviewer',prompt:'verify',evidenceMode:'read-receipts',verificationPaths:['missing'],onStart(){}});
  assert.deepEqual(JSON.parse(result.text).evidence,{assessment:'Cannot verify the source.',citations:[]});
});

test('receipt review format errors expose the active evidence contract, not the legacy string example',async t=>{
  const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-citation-format-')));
  t.after(()=>fs.rmSync(project,{recursive:true,force:true}));let prompts=0;
  const sdk={SettingsManager:{inMemory:v=>v},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{async reload(){}},
    async createAgentSession(){return {session:{sessionId:'format-citation',subscribe(){return ()=>{};},async prompt(message){
      if(++prompts===2){
        assert.match(message,/receiptIds/,'repair feedback must identify the required evidence contract');
        assert.doesNotMatch(message,/"evidence":"actual observations/,'must not instruct a rejected string shape');
      }
    },getLastAssistantText:()=>prompts===1?'{"result":{"passed":false}}':'{"passed":false,"findings":["missing"],"evidence":{"assessment":"unavailable","receiptIds":[]}}',getSessionStats:()=>({}),abort:async()=>{},dispose(){}}};}};
  const run=await adapter.createPiSessionRunner({project,agentDir:project,sdk,model:{id:'local',provider:'local'},modelRuntime:{}});
  assert.equal(JSON.parse((await run({role:'reviewer',prompt:'verify',evidenceMode:'read-receipts',onStart(){}})).text).passed,false);
  assert.equal(prompts,2);
});

test('legacy final-text transport preserves original JSON whitespace',async t=>{
  const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-legacy-text-')));
  t.after(()=>fs.rmSync(project,{recursive:true,force:true}));const raw='{\n  "summary": "unchanged transport"\n}';
  const sdk={SettingsManager:{inMemory:v=>v},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{async reload(){}},
    async createAgentSession(){return {session:{sessionId:'legacy',subscribe(){return ()=>{};},async prompt(){},getLastAssistantText:()=>raw,getSessionStats:()=>({}),abort:async()=>{},dispose(){}}};}};
  const run=await adapter.createPiSessionRunner({project,agentDir:project,sdk,model:{id:'local',provider:'local'},modelRuntime:{}});
  assert.equal((await run({role:'worker',prompt:'work',onStart(){}})).text,raw);
});

test('empty-file receipts remain usable, but IDs do not carry into a fresh evidence registry',async t=>{
  const {createReviewEvidence}=await import('../integrations/pi/review-evidence.mjs');
  const {createScopedTools}=await import('../integrations/pi/scoped-tools.mjs');
  const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-empty-citation-')));
  t.after(()=>fs.rmSync(project,{recursive:true,force:true}));fs.writeFileSync(path.join(project,'empty'),'');
  const read=createScopedTools({project,role:'reviewer'}).find(t=>t.name==='case_read');
  const receipt=(await read.execute('read',{path:'empty'})).details;
  const registry=createReviewEvidence(project);registry.record(receipt);
  const reply={passed:true,findings:[],evidence:{assessment:'File is empty.',receiptIds:[receipt.receiptId]}};
  assert.equal(registry.resolve(reply,'reviewer').evidence.citations[0].empty,true);
  assert.throws(()=>createReviewEvidence(project).resolve(reply,'reviewer'),{code:'INVALID_CITATION'});
  fs.unlinkSync(path.join(project,'empty'));
  assert.throws(()=>registry.resolve(reply,'reviewer'),{code:'STALE_CITATION'});
});

for(const mode of ['accepted','limit','cancelled'])test(`terminal ${mode} prevents post-stop compaction work`,async t=>{
  const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-stop-compaction-')));
  t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
  let listener,enabled=true,active=true,extraModelWork=0;
  const controller=new AbortController();
  const sdk={SettingsManager:{inMemory:v=>v},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{async reload(){}},
    async createAgentSession(options){return {session:{sessionId:'stop-compaction',subscribe(fn){listener=fn;return ()=>{};},
      setAutoCompactionEnabled(value){enabled=value;},abortCompaction(){active=false;},
      async prompt(){
        assert.equal(enabled,true,'normal execution retains compaction');
        if(mode==='accepted')await options.customTools.find(t=>t.name==='case_result').execute('done',{result:{summary:'done'}});
        if(mode==='limit'){listener({type:'turn_start'});listener({type:'turn_start'});}
        if(mode==='cancelled')controller.abort();
        if(enabled||active)extraModelWork++;
      },getLastAssistantText:()=>'',getSessionStats:()=>({}),abort:async()=>{},dispose(){}}};}};
  const run=await adapter.createPiSessionRunner({project,agentDir:project,sdk,model:{id:'local',provider:'local'},modelRuntime:{},maxTurns:1});
  const promise=run({role:'worker',prompt:'work',onStart(){},signal:controller.signal});
  if(mode==='accepted')assert.equal(JSON.parse((await promise).text).summary,'done');
  else await assert.rejects(promise,{code:mode==='limit'?'BUDGET_EXCEEDED':'CANCELLED'});
  assert.equal(extraModelWork,0,'terminal sessions must not start or continue compaction');
});

for(const cancelled of [true,false])test(`compaction controller created after start notification respects cancellation: ${cancelled}`,async t=>{
  const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-stop-race-')));
  t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
  const controller=new AbortController();
  let listener,compactionController,compactionAborted;
  const sdk={SettingsManager:{inMemory:v=>v},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{async reload(){}},
    async createAgentSession(){return {session:{sessionId:'stop-race',subscribe(fn){listener=fn;return ()=>{};},
      setAutoCompactionEnabled(){},abortCompaction(){compactionController?.abort();},abort:async()=>{},
      async prompt(){
        // pi 0.84.2 awaits auth before announcing compaction, then creates its controller.
        await Promise.resolve();
        if(cancelled)controller.abort();
        listener({type:'compaction_start',reason:'threshold'});
        compactionController=new AbortController();
        await Promise.resolve();
        compactionAborted=compactionController.signal.aborted;
      },getLastAssistantText:()=>'{"summary":"done"}',getSessionStats:()=>({}),dispose(){}}};}};
  const run=await adapter.createPiSessionRunner({project,agentDir:project,sdk,model:{id:'local',provider:'local'},modelRuntime:{}});
  const promise=run({role:'worker',prompt:'work',onStart(){},signal:controller.signal});
  if(cancelled)await assert.rejects(promise,{code:'CANCELLED'});else await promise;
  assert.equal(compactionAborted,cancelled,'late controller must be cancelled only for a terminal session');
});

test('final-text pass triggers same-session acquisition repair while a negative review remains reportable',async t=>{
    const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-review-final-read-')));
    t.after(()=>fs.rmSync(project,{recursive:true,force:true}));fs.writeFileSync(path.join(project,'out'),'');
    for(const passed of [true,false]){
      let prompts=0;const reply={passed,findings:passed?[]:['cannot verify'],evidence:'observed limits'};
      const sdk={SettingsManager:{inMemory:v=>v},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{async reload(){}},
        async createAgentSession(options){return {session:{sessionId:'final-read',subscribe(){return ()=>{};},async prompt(){
          if(++prompts===2)await options.customTools.find(t=>t.name==='case_read').execute('empty-file',{path:'out'});
        },getLastAssistantText:()=>JSON.stringify(reply),getSessionStats:()=>({}),abort:async()=>{},dispose(){}}};}};
      const run=await adapter.createPiSessionRunner({project,agentDir:project,sdk,model:{id:'local',provider:'local'},modelRuntime:{}});
      const result=await run({role:'reviewer',prompt:'verify',verificationPaths:['out'],onStart(){}});
      assert.equal(JSON.parse(result.text).passed,passed);assert.equal(prompts,passed?2:1);
    }
});

for(const role of ['reviewer','integrator'])test(`${role} cannot pass without current-session material reads`,async t=>{
    const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-verification-reads-')));
    t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
    fs.writeFileSync(path.join(project,'out'),'correct');
    const good=role==='reviewer'?{passed:true,findings:[],evidence:'checked'}:{results:[{criterionId:'a',passed:true,evidence:'checked'}],summary:'checked'};
    const sdk={SettingsManager:{inMemory:v=>v},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{async reload(){}},
      async createAgentSession(options){return {session:{sessionId:'evidence-'+role,subscribe(){return ()=>{};},async prompt(){
        const result=options.customTools.find(t=>t.name==='case_result'),read=options.customTools.find(t=>t.name==='case_read');
        await assert.rejects(result.execute('unread',{result:good}),{code:'VERIFICATION_MATERIAL_UNREAD'});
        await read.execute('empty-range',{path:'out',startLine:99});
        await assert.rejects(result.execute('still-unread',{result:good}),{code:'VERIFICATION_MATERIAL_UNREAD'});
        await read.execute('read',{path:'out'});
        fs.writeFileSync(path.join(project,'out'),'changed');
        await assert.rejects(result.execute('stale',{result:good}),{code:'VERIFICATION_MATERIAL_UNREAD'});
        await read.execute('fresh',{path:'out'});
        await result.execute('done',{result:good});
      },getLastAssistantText:()=>'',getSessionStats:()=>({}),abort:async()=>{},dispose(){}}};}};
    const run=await adapter.createPiSessionRunner({project,agentDir:project,sdk,model:{id:'local',provider:'local'},modelRuntime:{}});
    const result=await run({role,prompt:'verify',verificationPaths:['./out'],onStart(){}});
    assert.deepEqual(JSON.parse(result.text),good);
});

for (const transport of ['final-text','tool']) test(`reviewer corrects a wrapped reply in the same session: ${transport}`,async t=>{
    const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-review-shape-')));
    t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
    const good={passed:true,findings:[],evidence:'Read actual output'};
    let prompts=0,finalText='';
    const sdk={SettingsManager:{inMemory:v=>v},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{async reload(){}},
      async createAgentSession(options){return {session:{sessionId:'review-shape',subscribe(){return ()=>{};},
        async prompt(){prompts++;const tool=options.customTools.find(t=>t.name==='case_result');
          if(transport==='tool'){
            await assert.rejects(tool.execute('bad',{result:{result:good}}),{code:'INVALID_REPLY'});
            await tool.execute('good',{result:good});
          }else finalText=JSON.stringify(prompts===1?{result:good}:good);
        },getLastAssistantText:()=>finalText,getSessionStats:()=>({}),abort:async()=>{},dispose(){}}};}};
    const run=await adapter.createPiSessionRunner({project,agentDir:project,sdk,model:{id:'local',provider:'local'},modelRuntime:{}});
    const result=await run({role:'reviewer',prompt:'Verify output',onStart(){}});
    assert.deepEqual(JSON.parse(result.text),good);
    assert.equal(prompts,transport==='tool'?1:2);
    assert.equal(result.replyCorrections.length,transport==='tool'?0:1);
});

for(const planningPhase of ['initial',undefined])test(`planning phase selects system and result guidance: ${planningPhase}`,async t=>{
    const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-planning-phase-')));
    t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
    let observed;
    const sdk={SettingsManager:{inMemory:v=>v},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{
      constructor(options){this.options=options;}async reload(){}
    },async createAgentSession(options){observed=options;return {session:{sessionId:'phase',subscribe:()=>()=>{},
      prompt:async()=>{},getLastAssistantText:()=>'{"blocked":{"reason":"missing required source"}}',getSessionStats:()=>({}),abort:async()=>{},dispose(){}}};}};
    const run=await adapter.createPiSessionRunner({project,agentDir:project,sdk,model:{id:'local',provider:'local'},modelRuntime:{}});
    await run({role:'planner',planningPhase,prompt:'Plan authorized work',onStart(){}});
    for(const guidance of [observed.resourceLoader.options.appendSystemPrompt.join('\n'),observed.customTools.find(t=>t.name==='case_result').description]){
      if(planningPhase==='initial'){
        assert.doesNotMatch(guidance,/reviewDispute/,'initial planning must not inherit dispute instructions');
        assert.match(guidance,/initial planning/i);
      }else assert.match(guidance,/reviewDispute/,'legacy/feedback planning retains dispute guidance');
    }
    assert.ok(observed.tools.includes('case_read'));assert.ok(observed.tools.includes('case_list'));
    assert.ok(!observed.tools.includes('case_write'));
});

test('read-only planning receives planning guidance at both system and result-tool boundaries',async t=>{
    const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-role-guidance-')));
    t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
    const observed=[];
    const sdk={SettingsManager:{inMemory:v=>v},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{
      constructor(options){this.options=options;} async reload(){}
    },async createAgentSession(options){
      observed.push(options);return {session:{sessionId:'role-'+observed.length,subscribe(){return ()=>{};},
        async prompt(){await options.customTools.find(t=>t.name==='case_result').execute('result',{result:{blocked:{reason:'external input unavailable'}}});},
        getLastAssistantText:()=>'',getSessionStats:()=>({}),abort:async()=>{},dispose(){}}};
    }};
    const run=await adapter.createPiSessionRunner({project,agentDir:project,sdk,model:{id:'local',provider:'local'},modelRuntime:{}});
    await run({role:'planner',prompt:'Triage missing input',onStart(){}});
    const options=observed[0];
    assert.ok(!options.tools.includes('case_write'));
    for(const guidance of [options.resourceLoader.options.appendSystemPrompt.join('\n'),options.customTools.find(t=>t.name==='case_result').description]){
      assert.doesNotMatch(guidance,/repair (the )?actual (files|artifacts)/i,'planner must not receive worker repair instructions');
      assert.match(guidance,/reviewDispute/,'planning instructions must explain its own decision interface');
      assert.match(guidance,/criterionIds/,'disputes need a complete decision, not just a reason');
    }
});
test('small-context sessions reserve room for compaction and do not retry truncated output as JSON syntax',async t=>{
    const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-context-budget-')));
    t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
    let listener,settings,prompts=0;
    const sdk={SettingsManager:{inMemory:v=>(settings=v)},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{async reload(){}},
      async createAgentSession(){return {session:{sessionId:'context-budget',subscribe(fn){listener=fn;return ()=>{};},
        async prompt(){prompts++;listener({type:'message_end',message:{role:'assistant',stopReason:'length',content:[{type:'text',text:'unfinished'}]}});},
        getLastAssistantText:()=> 'unfinished',getSessionStats:()=>({}),abort:async()=>{},dispose(){}}};}};
    const run=await adapter.createPiSessionRunner({project,agentDir:project,model:{id:'local',provider:'local',contextWindow:32768,maxTokens:4096},modelRuntime:{},sdk});
    await assert.rejects(run({role:'worker',prompt:'work',writeScope:['out'],onStart(){}}),e=>{
      assert.equal(e.code,'MODEL_OUTPUT_TRUNCATED');
      assert.deepEqual(e.sessionEvidence.replyCorrections,[]);return true;
    });
    assert.equal(prompts,1);
    assert.equal(settings.compaction.enabled,true);
    assert.equal(settings.compaction.keepRecentTokens,8192);
    assert.equal(settings.compaction.reserveTokens,16384);
});

for(const mode of ['recovered','accepted','cancelled','turn-limit'])test(`truncation classification preserves SDK recovery and terminal precedence: ${mode}`,async t=>{
    const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-context-terminal-')));
    t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
    const controller=new AbortController();let listener,prompts=0;
    const sdk={SettingsManager:{inMemory:v=>v},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{async reload(){}},
      async createAgentSession(options){return {session:{sessionId:'terminal',subscribe(fn){listener=fn;return ()=>{};},
        async prompt(){prompts++;listener({type:'turn_start'});
          listener({type:'message_end',message:{role:'assistant',stopReason:'length'}});
          if(mode==='recovered')listener({type:'message_end',message:{role:'assistant',stopReason:'stop'}});
          if(mode==='accepted')await options.customTools.find(t=>t.name==='case_result').execute('done',{result:{summary:'done'}});
          if(mode==='cancelled')controller.abort();
          if(mode==='turn-limit')listener({type:'turn_start'});
        },getLastAssistantText:()=>'{"summary":"done"}',getSessionStats:()=>({}),abort:async()=>{},dispose(){}}};}};
    const run=await adapter.createPiSessionRunner({project,agentDir:project,model:{id:'local',provider:'local',contextWindow:32768},modelRuntime:{},sdk,maxTurns:1});
    const request={role:'worker',prompt:'work',onStart(){},signal:controller.signal};
    if(mode==='cancelled'||mode==='turn-limit')await assert.rejects(run(request),e=>e.code===(mode==='cancelled'?'CANCELLED':'BUDGET_EXCEEDED'));
    else assert.equal(JSON.parse((await run(request)).text).summary,'done');
    assert.equal(prompts,1);
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
                            listener({ type: 'tool_execution_start', toolCallId: 'write-1', toolName: 'case_write', args: { path: 'wrong.json', content: 'private write body' } });
                            listener({ type: 'tool_execution_end', toolCallId: 'write-1', toolName: 'case_write', isError: true, result: { content: [{ type: 'text', text: 'Write is outside packet writeScope' }] } });
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
            assert.deepEqual(failure.sessionEvidence.observations[0].writeRequest, {path:'wrong.json',writeScope:['out']});
            assert.equal(JSON.stringify(failure.sessionEvidence.observations).includes('private write body'),false);
            assert.equal(failure.sessionEvidence.usage === 'unknown' ? 'unknown' : failure.sessionEvidence.usage.input, mode === 'unknown' ? 'unknown' : 21);
            if (mode === 'cancel')
                assert.equal(failure.code, 'CANCELLED');
            return true;
        });
        assert.equal(disposed, true);
    }
});
for(const mode of ['still-prose','turn-limit','cancelled'])test(`reply correction is bounded in the existing session: ${mode}`,async t=>{
    const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-correction-')));
    t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
    let prompts=0,listener;
    const controller=new AbortController();
    const sdk={SettingsManager:{inMemory:v=>v},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{async reload(){}},
      async createAgentSession(){return {session:{sessionId:'one-session',subscribe(fn){listener=fn;return ()=>{};},
        async prompt(){prompts++;listener({type:'turn_start'});if(mode==='cancelled')controller.abort();},
        getLastAssistantText:()=> 'Unstructured reply',getSessionStats:()=>({}),abort:async()=>{},dispose(){}}};}};
    const run=await adapter.createPiSessionRunner({project,agentDir:project,model:{id:'local',provider:'local'},modelRuntime:{},sdk,maxTurns:mode==='turn-limit'?1:3});
    const request={role:'planner',prompt:'plan',onStart(){},signal:controller.signal};
    if(mode==='cancelled')await assert.rejects(run(request),failure=>{
      assert.equal(failure.code,'CANCELLED');assert.deepEqual(failure.sessionEvidence.replyCorrections,[]);return true;
    });
    else {
      await assert.rejects(run(request),failure=>{
        assert.equal(failure.code,'INVALID_REPLY');
        assert.equal(failure.sessionEvidence.replyCorrections.length,mode==='still-prose'?1:0);
        assert.equal(failure.sessionEvidence.resultTransport,'final-text');
        return true;
      });
    }
    assert.equal(prompts,mode==='still-prose'?2:1);
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
                    getLastAssistantText: () => options.tools.includes('case_write') ? '{"summary":"written"}' : '{"passed":true,"findings":[],"evidence":"observed"}',
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
    assert.equal(replies[0].text, '{"summary":"written"}');
    assert.equal(replies[0].resultTransport, 'final-text');
    assert.equal(inputs[0].resourceLoader.options.noExtensions, true);
    assert.equal(inputs[0].resourceLoader.options.noSkills, true);
    assert.equal(inputs[0].resourceLoader.options.noContextFiles, false);
    assert.deepEqual(inputs[1].tools.sort(), ['case_list', 'case_read', 'case_result', 'case_search']);
});

for (const mode of ['result','repair-prose','correct-invalid','conflict','repeat','late-read','late-write','late-check']) test(`structured result transport: ${mode}`,async t=>{
    const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-sdk-result-')));
    t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
    fs.writeFileSync(path.join(project,'source'),'source evidence');
    const sdk={SettingsManager:{inMemory:v=>v},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{async reload(){}},
      async createAgentSession(options){let listener,prompts=0;return {session:{sessionId:'structured',subscribe(fn){listener=fn;return ()=>{};},
        async prompt(){
          async function invoke(name,args){
            const tool=options.customTools.find(t=>t.name===name);
            assert.ok(tool,`${name} must be an actual custom tool`);
            try{const result=await tool.execute('call',args);listener({type:'tool_execution_end',toolName:name,result,isError:false});return result;}
            catch(e){listener({type:'tool_execution_end',toolName:name,result:{content:[{type:'text',text:e.message}],details:{code:e.code}},isError:true});}
          }
          const read=await invoke('case_read',{path:'source'});assert.match(read.content[0].text,/source evidence/);
          if(mode==='repair-prose' && ++prompts===1)return;
          if(mode==='correct-invalid'){
            await invoke('case_result',{result:{summary:'invalid reply'}});
            const lastError = await invoke('case_read',{path:'source'});
            assert.ok(lastError,'invalid result must not close the session');
            assert.match(lastError.content[0].text,/source evidence/,'invalid result must leave session open');
          }
          await invoke('case_result',{result:{changeRequest:{reason:'need prerequisite'}}});
          if(mode==='conflict')await invoke('case_result',{result:{summary:'contradictory success'}});
          if(mode==='repeat')await invoke('case_result',{result:{changeRequest:{reason:'need prerequisite'}}});
          if(mode==='late-read')await invoke('case_read',{path:'source'});
          if(mode==='late-write')await invoke('case_write',{path:'out',content:'must never write'});
          if(mode==='late-check')await invoke('case_check',{id:'late'});
        },getLastAssistantText:()=> 'I have explained the result in prose.',getSessionStats:()=>({toolCalls:2}),abort:async()=>{},dispose(){}}};}};
    const run=await adapter.createPiSessionRunner({project,agentDir:project,model:{id:'local',provider:'local'},modelRuntime:{},sdk,
      checks:{late:{command:process.execPath,args:['-e',"require('node:fs').writeFileSync('out','must never execute')"],criterionIds:['a']}}});
    if(['result','correct-invalid','repair-prose','repeat'].includes(mode)){
      const reply=await run({role:'worker',prompt:'work',writeScope:['out'],criterionIds:['a'],onStart:()=>{},
        validateResult:result=>{if(!result.changeRequest)throw Object.assign(new Error('Missing change request'),{code:'INVALID_REPLY'});}});
      assert.deepEqual(JSON.parse(reply.text),{changeRequest:{reason:'need prerequisite'}});
      assert.equal(reply.rawFinalText,'I have explained the result in prose.');
      assert.equal(reply.resultTransport,'case_result');
      assert.equal(reply.observations[mode==='repair-prose'?2:1].toolName,'case_result');
      if(mode==='repair-prose'){
        assert.equal(reply.replyCorrections.length,1);
        assert.equal(reply.replyCorrections[0].priorText,'I have explained the result in prose.');
      }
      if(mode==='correct-invalid')assert.equal(reply.observations[1].isError,true);
    }else await assert.rejects(run({role:'worker',prompt:'work',writeScope:['out'],criterionIds:['a'],onStart:()=>{}}),failure=>{
      assert.equal(failure.code,'RESULT_ALREADY_RECORDED');
      assert.equal(failure.sessionEvidence.observations.at(-1).isError,true);
      assert.equal(failure.sessionEvidence.observations.at(-1).result.details.code,'RESULT_ALREADY_RECORDED');
      assert.equal(failure.sessionEvidence.rawFinalText,'I have explained the result in prose.');return true;
    });
    assert.equal(fs.existsSync(path.join(project,'out')),false);
});
for(const role of ['worker','reviewer','planner','integrator'])test(`capability context reflects actual scoped tools and executable check IDs: ${role}`,async t=>{
    const project=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-sdk-capabilities-')));
    t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
    const sdk={SettingsManager:{inMemory:v=>v},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{
      constructor(options){this.options=options;}async reload(){}
    },async createAgentSession(options){
      const section=options.resourceLoader.options.appendSystemPrompt.find(s=>s.startsWith('{'));
      assert.ok(section,'machine-readable capabilities must accompany the actual tool boundary');
      const caps=JSON.parse(section).caseCapabilities;
      assert.equal(caps.role,role);
      assert.deepEqual(caps.availableTools,options.customTools.map(t=>t.name));
      assert.deepEqual(caps.availableTools,options.tools);
      // pi only includes custom tools with promptSnippet in its system tool list.
      for(const tool of options.customTools){
        assert.equal(typeof tool.promptSnippet,'string',`${tool.name} missing system tool-list entry`);
        assert.ok(tool.promptSnippet.trim().length>0);
      }
      if(role==='planner'){
        const schema=options.customTools.find(t=>t.name==='case_result').parameters.properties.result;
        assert.deepEqual(schema.properties?.packets.items.properties.inputs.items.properties.delivery.enum,['inline','indexed']);
        assert.ok(schema.properties?.blocked,'planner must retain external-blocker exit');
      }
      assert.deepEqual(caps.writeScope,role==='worker'?['output']:[]);
      assert.deepEqual(caps.approvedCheckIds,role==='planner'?[]:role==='integrator'?['exact','whole','unrelated']:['exact']);
      assert.deepEqual(caps.packetChecks,{kind:'acceptance-descriptions',executable:false});
      const check=options.customTools.find(t=>t.name==='case_check');
      if(role==='planner')assert.equal(check,undefined);
      else {
        assert.equal((await check.execute('actual',{id:caps.approvedCheckIds[0]})).details.exitCode,0);
        await assert.rejects(check.execute('description',{id:'normalized-lines'}),{code:'CHECK_NOT_APPROVED'});
        if(role!=='integrator')await assert.rejects(check.execute('premature',{id:'whole'}),{code:'CHECK_NOT_APPROVED'});
      }
      const write=options.customTools.find(t=>t.name==='case_write');
      if(role==='worker'){
        await write.execute('write',{path:caps.writeScope[0],content:'written through declared scope'});
        assert.equal(fs.readFileSync(path.join(project,'output'),'utf8'),'written through declared scope');
      }else assert.equal(write,undefined);
      return {session:{sessionId:'capabilities',subscribe:()=>()=>{},prompt:async()=>{},getLastAssistantText:()=>role==='worker'?'{"summary":"written"}':role==='planner'?'{"blocked":{"reason":"required input missing"}}':'{"passed":true,"findings":[],"evidence":"observed"}',getSessionStats:()=>({}),dispose(){},abort:async()=>{}}};
    }};
    const run=await adapter.createPiSessionRunner({project,agentDir:project,model:{id:'local',provider:'local'},modelRuntime:{},sdk,
      checks:{exact:{command:process.execPath,args:['-e','process.stdout.write("checked")'],criterionIds:['a']},whole:{command:process.execPath,args:['-e','throw Error("not built yet")']},unrelated:{command:process.execPath,args:[],criterionIds:['b']}}});
    await run({role,prompt:'packet check normalized-lines describes acceptance',writeScope:['output'],criterionIds:['a'],onStart:()=>{}});
});
