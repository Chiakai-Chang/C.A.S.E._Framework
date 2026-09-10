import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createPiSessionRunner } from '../integrations/pi/sdk-session.mjs';
const traceModule = await import('../integrations/pi/session-trace.mjs').catch(e => {
  if (e.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw e;
});
const sha = text => createHash('sha256').update(text).digest('hex');

test('edit trace records versions without replacement text',()=>{
  const trace=create();
  trace.observe({type:'tool_execution_start',toolName:'case_edit',toolCallId:'edit',args:{oldText:'SECRET old',newText:'SECRET new'}});
  trace.observe({type:'tool_execution_end',toolName:'case_edit',toolCallId:'edit',isError:false,result:{details:{path:'out.json',bytes:20,sourceSha256:sha('new'),previousSha256:sha('old')}}});
  const record=trace.finish('completed'),end=record.events.find(e=>e.kind==='tool_end');
  assert.equal(end.toolName,'case_edit');
  assert.equal(end.metadata.previousSha256,sha('old'));
  assert.equal(end.metadata.sourceSha256,sha('new'));
  assert.ok(!JSON.stringify(record).includes('SECRET'));
});
const create = options => {
  assert.equal(typeof traceModule.createSessionTrace, 'function', 'bounded trace must be implemented');
  return traceModule.createSessionTrace({runId:'run',sessionId:'session',role:'worker',project:process.cwd(),agentDir:path.join(process.cwd(),'private-config'),approvedCheckIds:['approved'],...options});
};

test('search trace retains source identity and pagination but not query or matching text',()=>{
  const trace=create();trace.observe({type:'turn_start'});
  trace.observe({type:'tool_execution_start',toolName:'case_search',toolCallId:'search',args:{path:'source.txt',query:'SECRET query'}});
  trace.observe({type:'tool_execution_end',toolName:'case_search',toolCallId:'search',isError:false,result:{details:{path:'source.txt',sourceSha256:sha('source'),startLine:1,matches:[{line:2,text:'SECRET source'}],truncated:false,nextStartLine:null}}});
  trace.observe({type:'turn_end'});
  const record=trace.finish('completed'),end=record.events.find(e=>e.kind==='tool_end');
  assert.equal(end.toolName,'case_search');
  assert.equal(end.metadata.sourceSha256,sha('source'));
  assert.equal(end.metadata.matchCount,1);
  assert.equal(end.metadata.nextStartLine,null);
  assert.equal(JSON.stringify(record).includes('SECRET'),false);
  assert.equal(record.traceComplete,true);
});
test('trace pairs parallel tools by identity and retains only approved result metadata', () => {
  const trace=create();
  trace.observe({type:'turn_start'});
  trace.observe({type:'tool_execution_start',toolName:'case_read',toolCallId:'one',args:{path:'SECRET rejected path',startLine:2,maxLines:3}});
  trace.observe({type:'tool_execution_start',toolName:'case_write',toolCallId:'two',args:{path:'SECRET path',content:'SECRET body'}});
  trace.observe({type:'tool_execution_end',toolName:'case_write',toolCallId:'two',isError:false,result:{content:[{text:'SECRET body'}],details:{path:'out.json',bytes:11,sourceSha256:sha('output')}}});
  trace.observe({type:'tool_execution_end',toolName:'case_read',toolCallId:'one',isError:false,result:{content:[{text:'SECRET read'}],details:{path:'Source.txt',sourceSha256:sha('source'),resultSha256:sha('page'),range:{startLine:2,endLine:4},lines:4,eof:true,wholeFile:false,empty:false,outOfRange:false,nextStartLine:null,receiptVersion:1}}});
  trace.observe({type:'turn_end'});
  const result=trace.finish('completed');
  assert.equal(result.traceVersion,1);
  assert.equal(result.traceComplete,true);
  const ends=result.events.filter(e=>e.kind==='tool_end');
  assert.equal(ends[0].toolCallId,'two');
  assert.equal(ends[1].toolCallId,'one');
  assert.equal(ends[1].requestId,'request-1');
  assert.equal(ends[1].metadata.path,'Source.txt');
  assert.equal(ends[1].metadata.wholeFile,false);
  assert.equal(ends[1].metadata.sourceSha256,sha('source'));
  assert.equal(JSON.stringify(result).includes('SECRET'),false);
});
test('trace bounds overflow and unfinished calls without serializing unknown objects', () => {
  const trace=create({sessionId:'x'.repeat(10000)});
  const circular={};circular.self=circular;
  for(let i=0;i<600;i++) trace.observe({type:'tool_execution_start',toolName:'case_read',toolCallId:`call-${i}`,args:{path:'SECRET',unknown:circular}});
  trace.observe({type:'message_end',message:{role:'assistant',content:[{type:'thinking',thinking:'SECRET thought'}],unknown:circular}});
  const result=trace.finish('cancelled');
  assert.equal(result.sessionId,'unknown');
  assert.equal(result.traceComplete,false);
  assert.ok(result.overflow.droppedEvents>0);
  assert.ok(result.incomplete.pendingTools>0);
  assert.equal(result.incomplete.untrackedTools,true);
  assert.ok(result.events.length<=128);
  assert.ok(Buffer.byteLength(JSON.stringify(result))<=256*1024);
  for(const event of result.events)assert.ok(Buffer.byteLength(JSON.stringify(event))<=4096);
  assert.equal(JSON.stringify(result).includes('SECRET'),false);
});
test('trace reports missing starts, missing ends and compaction visibility as unknown', () => {
  const trace=create();
  trace.observe({type:'tool_execution_end',toolName:'case_read',toolCallId:'orphan',result:new Error('SECRET')});
  trace.observe({type:'tool_execution_start',toolName:'case_check',toolCallId:'pending',args:{id:'approved'}});
  trace.observe({type:'compaction_start',reason:'threshold'});
  trace.observe({type:'compaction_end',reason:'threshold',aborted:false,result:{summary:'SECRET compaction'}});
  const result=trace.finish('cancelled');
  assert.equal(result.traceComplete,false);
  assert.equal(result.incomplete.missingStarts,1);
  assert.equal(result.incomplete.pendingTools,1);
  assert.equal(result.events.find(e=>e.kind==='compaction_end').retainedContent,'unknown');
  assert.equal(result.events.find(e=>e.kind==='tool_end').pairing,'missing_start');
  assert.equal(JSON.stringify(result).includes('SECRET'),false);
});
test('policy evidence hashes actual loaded content and never exposes private absolute paths', () => {
  const trace=create();
  trace.recordPolicy({getAgentsFiles:()=>({agentsFiles:[{path:path.join(process.cwd(),'AGENTS.md'),content:'SECRET policy'},{path:path.join(process.cwd(),'private-config','AGENTS.md'),content:'SECRET global'}]})}, {systemPrompt:'SECRET actual system prompt'});
  const result=trace.finish('completed');
  const policy=result.events.filter(e=>e.kind==='policy');
  assert.deepEqual(policy.map(e=>e.scope),['project','agent-config']);
  assert.equal(policy[0].sourceSha256,sha('SECRET policy'));
  assert.equal(result.systemPromptSha256,sha('SECRET actual system prompt'));
  assert.equal(JSON.stringify(result).includes(process.cwd().replaceAll('\\','\\\\')),false);
  assert.equal(JSON.stringify(result).includes('SECRET'),false);
});
test('SDK returns trace after cancellation including actual policy and unmatched tools', async () => {
  let listener;
  const controller=new AbortController();
  const sdk={SettingsManager:{inMemory:v=>v},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{
    async reload(){} getAgentsFiles(){return {agentsFiles:[{path:path.join(process.cwd(),'AGENTS.md'),content:'SECRET policy'}]};}
  },async createAgentSession(){return {session:{sessionId:'sdk-trace',systemPrompt:'SECRET prompt',subscribe(fn){listener=fn;return ()=>{};},
    async prompt(){listener({type:'turn_start'});listener({type:'tool_execution_start',toolName:'case_write',toolCallId:'pending',args:{path:'SECRET',content:'SECRET'}});controller.abort();throw new Error('SECRET stopped');},
    getLastAssistantText:()=> 'SECRET final',getSessionStats:()=>({}),abort:async()=>{},dispose(){}}};}};
  const run=await createPiSessionRunner({project:process.cwd(),agentDir:process.cwd(),model:{id:'local',provider:'local'},modelRuntime:{},sdk});
  await assert.rejects(run({role:'worker',runId:'parent-run',prompt:'work',signal:controller.signal,onStart(){}}),failure=>{
    assert.ok(failure.sessionEvidence.trace,'SDK must retain bounded trace on failures');
    assert.equal(failure.sessionEvidence.trace.runId,'parent-run');
    assert.equal(failure.sessionEvidence.trace.incomplete.pendingTools,1);
    assert.equal(failure.sessionEvidence.trace.endReason,'cancelled');
    assert.equal(failure.sessionEvidence.trace.systemPromptSha256,sha('SECRET prompt'));
    assert.equal(JSON.stringify(failure.sessionEvidence.trace).includes('SECRET'),false);
    assert.equal(failure.sessionEvidence.rawFinalText,'SECRET final','legacy evidence remains unchanged');
    return true;
  });
});
test('trace rejects oversized escaped metadata and marks unknown tool success without trusting its path', () => {
  const trace=create();
  trace.observe({type:'tool_execution_start',toolName:'case_read',toolCallId:'large'});
  trace.observe({type:'tool_execution_end',toolName:'case_read',toolCallId:'large',isError:false,result:{details:{path:'"'.repeat(2000)}}});
  trace.observe({type:'tool_execution_end',toolName:'case_write',toolCallId:'unknown',result:{details:{path:'SECRET unknown-success-path'}}});
  const result=trace.finish('failed');
  assert.ok(result.overflow.oversizedEvents>=1);
  assert.equal(result.traceComplete,false);
  assert.equal(JSON.stringify(result).includes('SECRET'),false);
  for(const event of result.events)assert.ok(Buffer.byteLength(JSON.stringify(event))<=4096);
});
test('trace does not duplicate read, check, discovery, errors or hidden and final text', () => {
  const trace=create();
  const records=[
    ['case_read',true,{code:'SECRET_ERROR',path:'SECRET rejected',stdout:'SECRET output'}],
    ['case_check',false,{id:'not-approved-SECRET',exitCode:1,stdout:'SECRET stdout',stderr:'SECRET stderr'}],
    ['case_discover',false,{id:'accepted-id',status:'pending',evidence:'SECRET evidence',summary:'SECRET summary'}],
    ['case_result',false,{recorded:true,summary:'SECRET result'}],
  ];
  for(const [toolName,isError,details] of records){
    trace.observe({type:'tool_execution_start',toolName,toolCallId:toolName,args:{result:{summary:'SECRET args'}}});
    trace.observe({type:'tool_execution_end',toolName,toolCallId:toolName,isError,result:{details,content:[{type:'text',text:'SECRET text'}]}});
  }
  trace.observe({type:'message_end',message:{role:'assistant',stopReason:'stop',content:[{type:'thinking',thinking:'SECRET hidden'},{type:'text',text:'SECRET final'}]}});
  const result=trace.finish('completed');
  assert.equal(result.events.find(e=>e.toolName==='case_check'&&e.kind==='tool_end').metadata.id,'unknown');
  assert.equal(result.events.find(e=>e.toolName==='case_discover'&&e.kind==='tool_end').metadata.id,'accepted-id');
  assert.equal(result.events.find(e=>e.kind==='model_response').thinkingPresent,true);
  assert.equal(JSON.stringify(result).includes('SECRET'),false);
});
test('missing policy APIs and unreadable system prompt remain explicitly unknown', () => {
  const trace=create();
  trace.recordPolicy({},{});
  const result=trace.finish('completed');
  assert.equal(result.loadedPolicySha256,'unknown');
  assert.equal(result.systemPromptSha256,'unknown');
  assert.equal(result.policyComplete,false);
});
test('SDK trace terminal reason reflects disposal failures', async () => {
  const sdk={SettingsManager:{inMemory:v=>v},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{async reload(){}},
    async createAgentSession(){return {session:{sessionId:'dispose-failure',subscribe:()=>()=>{},prompt:async()=>{},getLastAssistantText:()=>'{"passed":true}',getSessionStats:()=>({}),abort:async()=>{},dispose(){throw new Error('dispose failure');}}};}};
  const run=await createPiSessionRunner({project:process.cwd(),agentDir:process.cwd(),model:{id:'local',provider:'local'},modelRuntime:{},sdk});
  await assert.rejects(run({role:'reviewer',prompt:'verify',onStart(){}}),failure=>{
    assert.equal(failure.sessionEvidence.trace.endReason,'failed');return true;
  });
});
test('trace limits total serialized bytes before reaching the event-count limit', () => {
  const trace=create();
  for(let i=0;i<100;i++){
    trace.observe({type:'tool_execution_start',toolName:'case_read',toolCallId:`call-${i}`});
    trace.observe({type:'tool_execution_end',toolName:'case_read',toolCallId:`call-${i}`,isError:false,result:{details:{path:'"'.repeat(1670)}}});
  }
  const result=trace.finish('completed');
  assert.ok(result.overflow.droppedEvents>0);
  assert.equal(result.overflow.oversizedEvents,0);
  assert.ok(Buffer.byteLength(JSON.stringify(result))<=256*1024);
  assert.equal(result.incomplete.pendingTools,0,'overflow must still account for paired completed calls');
  assert.equal(result.traceComplete,false);
});
test('request and compaction starts without ends cannot be reported as complete traces', () => {
  const trace=create();
  trace.observe({type:'turn_start'});
  trace.observe({type:'compaction_start',reason:'threshold'});
  const result=trace.finish('cancelled');
  assert.equal(result.traceComplete,false);
  assert.equal(result.incomplete.pendingTools,0);
  assert.equal(result.incomplete.pendingRequests,1);
  assert.equal(result.incomplete.pendingCompactions,1);
});
test('SDK trace records allowlisted thrown codes when pi end events contain only error text', async () => {
  let listener;
  const sdk={SettingsManager:{inMemory:v=>v},SessionManager:{inMemory:()=>({})},DefaultResourceLoader:class{async reload(){}},
    async createAgentSession(options){return {session:{sessionId:'error-code',subscribe(fn){listener=fn;return ()=>{};},async prompt(){
      listener({type:'turn_start'});
      listener({type:'tool_execution_start',toolName:'case_read',toolCallId:'rejected',args:{path:'../SECRET'}});
      try{await options.customTools.find(t=>t.name==='case_read').execute('rejected',{path:'../SECRET'});}catch(error){
        listener({type:'tool_execution_end',toolName:'case_read',toolCallId:'rejected',isError:true,result:{content:[{type:'text',text:error.message}]}});
      }
      listener({type:'turn_end'});
    },getLastAssistantText:()=>'{"passed":true}',getSessionStats:()=>({}),abort:async()=>{},dispose(){}}};}};
  const run=await createPiSessionRunner({project:process.cwd(),agentDir:process.cwd(),model:{id:'local',provider:'local'},modelRuntime:{},sdk});
  const reply=await run({role:'reviewer',prompt:'verify',onStart(){}});
  assert.equal(reply.trace.events.find(e=>e.kind==='tool_end').metadata.errorCode,'UNSAFE_TOOL_PATH');
  assert.equal(JSON.stringify(reply.trace).includes('SECRET'),false);
});
test('installed pi loop closes tool and request events after an accepted tool aborts generation', async t => {
  const file=new URL('../../.npm-cache/pi-host-validation/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js',import.meta.url);
  const sdk=await import(file.href).catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return null;throw error;});
  if(!sdk){t.skip('Optional isolated pi SDK is not installed');return;}
  const trace=create(),controller=new AbortController();
  let requests=0,accepted=0;
  await sdk.runAgentLoop([{role:'user',content:'submit',timestamp:0}],{systemPrompt:'test',messages:[],tools:[{
    name:'case_result',description:'accept',parameters:{type:'object',properties:{},additionalProperties:false},
    async execute(){accepted++;controller.abort();return {content:[{type:'text',text:'accepted'}],details:{recorded:true}};}
  }]},{model:{id:'offline',provider:'offline'},convertToLlm:v=>v},event=>trace.observe(event),controller.signal,async ()=>{
    requests++;
    const message={role:'assistant',content:requests===1?[{type:'toolCall',id:'actual-call',name:'case_result',arguments:{}}]:[],stopReason:requests===1?'toolUse':'aborted',api:'offline',provider:'offline',model:'offline',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},timestamp:0};
    return {async *[Symbol.asyncIterator](){yield {type:'done',message};},async result(){return message;}};
  });
  const result=trace.finish('completed');
  assert.equal(accepted,1);
  assert.equal(result.traceComplete,true);
  assert.equal(result.incomplete.pendingRequests,0);
  assert.equal(result.incomplete.pendingTools,0);
  assert.ok(result.events.some(e=>e.kind==='tool_end'&&e.toolCallId==='actual-call'));
});
