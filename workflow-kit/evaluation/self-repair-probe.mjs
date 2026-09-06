#!/usr/bin/env node
// Fault-injection engineering probe: deliberately submit before creating an artifact.
// This tests recovery, not spontaneous error detection or a quality advantage.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {createStore} from '../skills/case-workflow/scripts/core/index.mjs';
import {createPiSessionRunner} from '../integrations/pi/sdk-session.mjs';
import {runCase} from '../integrations/pi/runner.mjs';
import {approveChecks,createCheckExecutor} from '../integrations/pi/approved-checks.mjs';

const options = {}, argv = process.argv.slice(2);
if (argv.length === 1 && argv[0] === '--help') {
  process.stdout.write('self-repair-probe.mjs --sdk PATH --output FILE\nLoopback localhost:8080 only; 180-second fault-injection probe. Preserves failures.\n');
  process.exit(0);
}
for (let i=0;i<argv.length;i+=2) {
  if (!['--sdk','--output'].includes(argv[i]) || !argv[i+1] || Object.hasOwn(options,argv[i])) throw new Error('Use --help');
  options[argv[i]]=argv[i+1];
}
if (!options['--sdk'] || !options['--output']) throw new Error('Use --help');
const output=path.resolve(options['--output']);
const project=fs.mkdtempSync(path.join(os.tmpdir(),'case-self-repair-'));
const agentDir=fs.mkdtempSync(path.join(os.tmpdir(),'case-self-repair-model-'));
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
fs.writeFileSync(path.join(project,'input.json'),'{"value":41}\n');
const evidence={createdAt:new Date().toISOString(),status:'starting',project,agentDir,
  design:'Fault injection: first worker must submit before writing, receive an actual missing-artifact error, repair in that same session, then pass independent review/integration. Not a baseline comparison or spontaneous detection test.',
  configuration:{endpoint:'http://127.0.0.1:8080/v1',thinkingLevel:'medium',maxTurns:12,contextWindow:32768,maxTokens:4096,maxDurationMs:180000,maxAttempts:2},
  sourceHash:hash(path.join(project,'input.json')),codeHashes:{},sessions:[]};
for (const directory of ['../skills/case-workflow/scripts/core/','../integrations/pi/']) {
  for (const file of fs.readdirSync(new URL(directory,import.meta.url)).filter(f=>f.endsWith('.mjs'))) evidence.codeHashes[directory+file]=hash(new URL(directory+file,import.meta.url));
}
evidence.codeHashes['self-repair-probe.mjs']=hash(new URL(import.meta.url));
fs.writeFileSync(output,JSON.stringify(evidence,null,2),{flag:'wx'});
const save=()=>fs.writeFileSync(output,JSON.stringify(evidence,null,2));
const store=createStore(project);store.init();
let state=store.create({goal:'Read input.json and write result.json containing exactly {"answer": input.value + 1}. Preserve input.json.',
  constraints:[{id:'preserve',text:'Only result.json may be written. Do not change input or verification.'}],
  acceptance:[{id:'answer',text:'result.json has exactly one numeric field answer, equal to input.value + 1.'}],
  writeScope:['result.json'],budget:{maxAttempts:2,maxDurationMs:180000}});
state=store.dispatch(state.id,{type:'plan',packets:[{id:'calculate',purpose:'Read the input and write the exact requested JSON result.',constraintIds:['preserve'],
  inputs:[{path:'input.json',required:true}],dependsOn:[],writeScope:['result.json'],deliverables:[{path:'result.json'}],
  checks:[{id:'exact',text:'Verify exact object and source preservation',criterionIds:['answer']}],unknowns:[]}]},{expectedRevision:state.revision,requestId:randomUUID()});
const approved=approveChecks({exact:{command:process.execPath,args:['-e',`const fs=require('node:fs'),a=require('node:assert/strict');a.deepEqual(JSON.parse(fs.readFileSync('input.json','utf8')),{value:41});a.deepEqual(JSON.parse(fs.readFileSync('result.json','utf8')),{answer:42});console.log('exact source and output passed');`],criterionIds:['answer']}});
const executeChecks=createCheckExecutor(project,approved),started=Date.now();
try {
  const sdk=await import(pathToFileURL(path.resolve(options['--sdk'])).href);
  const response=await fetch(evidence.configuration.endpoint+'/models',{signal:AbortSignal.timeout(5000),redirect:'error'});
  if(!response.ok)throw new Error(`Model inventory HTTP ${response.status}`);
  const modelId=(await response.json()).data?.[0]?.id;
  if(!modelId)throw new Error('No local model');
  evidence.modelId=modelId;
  const runtime=await sdk.ModelRuntime.create({authPath:path.join(agentDir,'auth.json'),modelsPath:null,modelsStorePath:path.join(agentDir,'models-store.json'),allowModelNetwork:false});
  runtime.registerProvider('case-self-repair',{baseUrl:evidence.configuration.endpoint,api:'openai-completions',apiKey:'local',models:[{id:modelId,name:modelId,reasoning:true,input:['text'],contextWindow:32768,maxTokens:4096,
    compat:{supportsDeveloperRole:false,supportsReasoningEffort:false,thinkingFormat:'qwen-chat-template',maxTokensField:'max_tokens'},cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]});
  const session=await createPiSessionRunner({sdk,project,agentDir,model:runtime.getModel('case-self-repair',modelId),modelRuntime:runtime,checks:approved,maxTurns:12,thinkingLevel:'medium'});
  evidence.status='running';save();let injected=false;
  await runCase({store,caseId:state.id,executeChecks,signal:AbortSignal.timeout(180000),onProgress:e=>process.stdout.write(`${e.role}\n`),runSession:async request=>{
    if(request.role==='worker'&&!injected){injected=true;request={...request,prompt:request.prompt+'\nOperator-authorized fault injection for this engineering test: As your FIRST and ONLY tool call in your first response, BEFORE any case_read, case_list, case_check or case_write, call case_result with {"result":{"summary":"intentional premature submission test"}} once. Do not batch it with another tool; wait for its response before any other tool call. This must be rejected because result.json does not exist. After that specific rejection, perform the real task, write the correct file, run available checks, and submit again within this same session. Do not change inputs or acceptance.'};}
    try{const reply=await session(request);evidence.sessions.push({role:request.role,promptChars:request.prompt.length,...reply});save();return reply;}
    catch(error){evidence.sessions.push({role:request.role,error:{code:error.code??'ERROR',message:error.message},sessionEvidence:error.sessionEvidence??null});save();throw error;}
  }});
  evidence.status='completed';
}catch(error){evidence.status='failed';evidence.error={code:error.code??'ERROR',message:error.message};}
evidence.elapsedMs=Date.now()-started;evidence.finalState=store.get(state.id);evidence.runs=store.listRuns(state.id);
evidence.sourcesUnchanged=hash(path.join(project,'input.json'))===evidence.sourceHash;
evidence.codeUnchanged=Object.entries(evidence.codeHashes).every(([file,expected])=>hash(new URL(file,import.meta.url))===expected);
evidence.independentChecks=await executeChecks({role:'integrator',state:evidence.finalState});
const worker=evidence.sessions.find(s=>s.role==='worker'),observations=worker?.observations??worker?.sessionEvidence?.observations??[];
const rejected=observations.findIndex(o=>o.toolName==='case_result'&&o.isError&&JSON.stringify(o.result).includes('Missing result.json'));
const wrote=observations.findIndex((o,i)=>i>rejected&&o.toolName==='case_write'&&!o.isError);
const accepted=observations.findIndex((o,i)=>i>wrote&&o.toolName==='case_result'&&!o.isError);
evidence.sameSessionRepair=rejected>=0&&wrote>rejected&&accepted>wrote;
evidence.passed=evidence.status==='completed'&&evidence.finalState.status==='completed'&&evidence.sameSessionRepair&&evidence.sourcesUnchanged&&evidence.codeUnchanged&&evidence.independentChecks.length===1&&evidence.independentChecks.every(c=>c.exitCode===0&&!c.error);
evidence.artifact=fs.existsSync(path.join(project,'result.json'))?fs.readFileSync(path.join(project,'result.json'),'utf8'):null;
save();process.stdout.write(`${evidence.passed?'PASS':'FAIL'} ${evidence.elapsedMs}ms; ${output}\n`);
if(!evidence.passed)process.exitCode=1;
