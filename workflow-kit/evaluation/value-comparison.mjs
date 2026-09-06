#!/usr/bin/env node
// Fixed six-arm engineering comparison; not a statistical or unmodified-pi benchmark.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {fixture,grade} from './value-fixtures.mjs';
import {createStore} from '../skills/case-workflow/scripts/core/index.mjs';
import {createPiSessionRunner} from '../integrations/pi/sdk-session.mjs';
import {runCase,callSession} from '../integrations/pi/runner.mjs';
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const artifactHash=file=>{try{return hash(file);}catch{return null;}};
const errorInfo=e=>({code:e.code??'ERROR',message:e.message});
const packet=(id,inputs,output,criterion,dependsOn=[])=>({id,purpose:`Produce ${output} under requirements.md and policy.md; follow exact fields in the goal.`,
  constraintIds:['preserve'],inputs:inputs.map(p=>({path:p,required:true,delivery:'indexed'})),dependsOn,writeScope:[output],deliverables:[{path:output}],
  checks:[{id:`${id}-check`,text:'Read actual files and check the goal, rules and all output fields.',criterionIds:[criterion]}],unknowns:[]});

export async function evaluateArm({spec,mode,project,createRunner,maxDurationMs=600000,onUpdate=()=>{}}){
  if(!['single','case'].includes(mode)||fs.readdirSync(project).length)throw new Error('Unknown arm or nonempty project');
  for(const [f,v] of Object.entries(spec.sources))fs.writeFileSync(path.join(project,f),v,{flag:'wx'});
  const record={scenario:spec.name,mode,project,status:'running',sessions:[],humanInterventions:0,
    sourceHashes:Object.fromEntries(Object.keys(spec.sources).map(f=>[f,hash(path.join(project,f))]))};
  const started=Date.now(),signal=AbortSignal.timeout(maxDurationMs);
  const save=()=>{record.elapsedMs=Date.now()-started;onUpdate(record);};
  let run;save();
  const traced=async request=>{
    const entry={role:request.role,prompt:request.prompt,writeScope:request.writeScope??[],startedAt:new Date().toISOString()};
    record.sessions.push(entry);save();
    try{const reply=await run(request);Object.assign(entry,reply);save();return reply;}
    catch(e){Object.assign(entry,e.sessionEvidence??{}, {error:errorInfo(e)});save();throw e;}
  };
  let store,state;
  try{
    run=await createRunner(project);
    if(mode==='single'){
      const prompt=spec.goal+'\nRead requirements.md and source files, perform the requested work, and check the actual outputs. Return {"summary":"what was done and checked"}.';
      if(spec.name==='resume'){
        const first=await callSession(traced,{role:'worker',prompt:prompt+'\nThis invocation is stage 1 only: write normalized.json, do not write report.json yet. The next invocation will have fresh context. Include useful handoff information in your final summary.',writeScope:['normalized.json'],signal});
        const checked=grade(project,spec,['normalized.json']);
        record.checkpoint={kind:'completed-stage-new-context',upstreamPassed:checked.artifactPassed,sha256:artifactHash(path.join(project,'normalized.json'))};save();
        if(!checked.artifactPassed)throw new Error('First stage artifact failed; not replaced with an oracle fixture');
        await callSession(traced,{role:'worker',prompt:prompt+'\nStage 1 ended. Preserve normalized.json; finish report.json only. Previous actual handoff:\n'+first.text,writeScope:['report.json'],signal});
      }else await callSession(traced,{role:'worker',prompt,writeScope:spec.scope,signal});
    }else{
      store=createStore(project);store.init();
      state=store.create({goal:spec.goal,constraints:[{id:'preserve',text:'Never change source files. Only write declared outputs; preserve fields and active rules in requirements.md and policy.md when present.'}],
        acceptance:spec.name==='simple'?[{id:'correct',text:'result.json exactly satisfies the goal and sources are unchanged.'}]:[
          {id:'normalization',text:'normalized.json has exactly required fields and correct current-price, cancellation, approved-return and zero-line handling.'},
          {id:'report',text:'report.json exactly aggregates normalized amounts and identifies excluded orders and the current policy version.'}],
        writeScope:spec.scope,budget:{maxAttempts:5,maxDurationMs}});
      record.caseId=state.id;
      if(spec.name==='resume'){
        state=store.dispatch(state.id,{type:'plan',packets:[packet('normalize',Object.keys(spec.sources),'normalized.json','normalization'),
          packet('report',['normalized.json','requirements.md','policy.md','orders.json'],'report.json','report',['normalize'])]},
          {expectedRevision:state.revision,requestId:randomUUID()});
        let boundaryReached=false;
        try{
          await runCase({store,caseId:state.id,signal,runSession:async request=>{
            if(request.role==='worker'&&!request.writeScope.includes('normalized.json')){
              boundaryReached=true;throw Object.assign(new Error('Controlled pause before downstream worker; no downstream tool ran'),{code:'EVALUATION_CHECKPOINT'});
            }
            return traced(request);
          }});
        }catch(e){if(e.code!=='EVALUATION_CHECKPOINT')throw e;}
        if(!boundaryReached)throw new Error('Expected safe stage boundary not reached');
        const checked=grade(project,spec,['normalized.json']);
        record.checkpoint={kind:'verified-stage-new-run',upstreamPassed:checked.artifactPassed,sha256:artifactHash(path.join(project,'normalized.json'))};save();
        if(!checked.artifactPassed)throw new Error('First stage artifact failed; not replaced with an oracle fixture');
      }
      await runCase({store,caseId:state.id,signal,runSession:traced});
    }
    record.workflowCompleted=true;
  }catch(e){record.workflowCompleted=false;record.error=errorInfo(e);}
  Object.assign(record,grade(project,spec));
  if(record.checkpoint)record.checkpoint.upstreamUnchanged=record.checkpoint.sha256!==null&&artifactHash(path.join(project,'normalized.json'))===record.checkpoint.sha256;
  if(store){record.finalState=store.get(state.id);record.runs=store.listRuns(state.id);}
  record.passed=record.workflowCompleted&&record.artifactPassed&&(!record.checkpoint||record.checkpoint.upstreamUnchanged);
  record.status=record.passed?'passed':'failed';
  record.sdkTotalTokens=record.sessions.length&&record.sessions.every(s=>Number.isFinite(s.usage?.total))?record.sessions.reduce((n,s)=>n+s.usage.total,0):null;
  record.artifacts={};record.artifactErrors={};
  for(const f of spec.scope){try{record.artifacts[f]=fs.readFileSync(path.join(project,f),'utf8');}catch(e){record.artifactErrors[f]=errorInfo(e);}}
  save();return record;
}

async function main(){
  const args=process.argv.slice(2),options={};
  if(args.length===1&&args[0]==='--help'){console.log('value-comparison.mjs --sdk PATH --output NEW_FILE\nSix fixed local-model arms: simple, multi-source, real-stage resume. Same scoped tools; not default-pi UX.');return;}
  for(let i=0;i<args.length;i+=2){if(!['--sdk','--output'].includes(args[i])||!args[i+1]||Object.hasOwn(options,args[i]))throw new Error('Use --help');options[args[i]]=args[i+1];}
  if(!options['--sdk']||!options['--output'])throw new Error('Use --help');
  const output=path.resolve(options['--output']);
  const kit=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const files=[];const collect=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())collect(p);else if(/\.(mjs|ts)$/.test(e.name))files.push(p);}};
  collect(path.join(kit,'integrations/pi'));collect(path.join(kit,'skills/case-workflow/scripts/core'));
  files.push(fileURLToPath(import.meta.url),fileURLToPath(new URL('./value-fixtures.mjs',import.meta.url)));
  const codeHashes=Object.fromEntries(files.map(f=>[path.relative(kit,f).replaceAll('\\','/'),hash(f)]));
  const evidence={createdAt:new Date().toISOString(),status:'starting',codeHashes,
    configuration:{endpoint:'http://127.0.0.1:8080/v1',thinkingLevel:'medium',contextWindow:32768,maxTokens:4096,maxTurns:12,maxAttempts:5,maxDurationMs:600000},
    limitations:['Same scoped pi SDK tool loop baseline, not unmodified native pi defaults.','One pair per scenario; no success-rate or long-context claim.','Resume uses actual model-produced first stage, not process killing.','Tokens include cache; no hardware/energy or peak-context measurement.','No human correction during arms; not a user-burden study.'],payloads:[],results:[]};
  fs.writeFileSync(output,JSON.stringify(evidence,null,2),{flag:'wx'});
  const save=()=>fs.writeFileSync(output,JSON.stringify(evidence,null,2));
  try{
    const sdk=await import(pathToFileURL(path.resolve(options['--sdk'])).href);
    const inventory=await fetch('http://127.0.0.1:8080/v1/models',{signal:AbortSignal.timeout(5000),redirect:'error'});
    if(!inventory.ok)throw new Error('Local model inventory failed');
    const modelId=(await inventory.json()).data?.[0]?.id;if(!modelId)throw new Error('No local model');evidence.modelId=modelId;
    const props=await fetch('http://127.0.0.1:8080/props',{signal:AbortSignal.timeout(5000),redirect:'error'});
    if(props.ok){const p=await props.json();evidence.server={buildInfo:p.build_info,defaultGenerationSettings:p.default_generation_settings};}
    const tracedSdk={...sdk,async createAgentSession(opts){
      const created=await sdk.createAgentSession(opts),original=created.session.agent.onPayload;
      created.session.agent.onPayload=async(payload,model)=>{
        const transformed=await original?.(payload,model),p=transformed??payload;
        evidence.payloads.push({sessionId:created.session.sessionId,tools:(p.tools??[]).map(t=>t.function?.name??t.name),
          chatTemplateKwargs:p.chat_template_kwargs,maxTokens:p.max_tokens??p.max_completion_tokens,
          sampling:{temperature:p.temperature??null,topP:p.top_p??null,seed:p.seed??null}});save();return transformed;
      };return created;
    }};
    const createRunner=async project=>{
      const agentDir=fs.mkdtempSync(path.join(os.tmpdir(),'case-value-config-'));
      const runtime=await sdk.ModelRuntime.create({authPath:path.join(agentDir,'auth.json'),modelsPath:null,modelsStorePath:path.join(agentDir,'models.json'),allowModelNetwork:false});
      runtime.registerProvider('case-value-local',{baseUrl:evidence.configuration.endpoint,api:'openai-completions',apiKey:'local',models:[{
        id:modelId,name:modelId,reasoning:true,input:['text'],contextWindow:32768,maxTokens:4096,
        compat:{supportsDeveloperRole:false,supportsReasoningEffort:false,thinkingFormat:'qwen-chat-template',maxTokensField:'max_tokens'},cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]});
      return createPiSessionRunner({project,agentDir,sdk:tracedSdk,model:runtime.getModel('case-value-local',modelId),modelRuntime:runtime,maxTurns:12,thinkingLevel:'medium'});
    };
    evidence.status='running';save();
    for(const [i,name] of ['simple','multi-source','resume'].entries())for(const mode of (i%2?['case','single']:['single','case'])){
      for(const f of files)if(hash(f)!==codeHashes[path.relative(kit,f).replaceAll('\\','/')])throw new Error('Code changed during fixed-version comparison');
      const index=evidence.results.length;console.log(`START ${name} ${mode}`);
      const result=await evaluateArm({spec:fixture(name),mode,project:fs.mkdtempSync(path.join(os.tmpdir(),`case-value-${name}-${mode}-`)),createRunner,
        onUpdate:r=>{evidence.results[index]=r;save();}});
      console.log(`${name} ${mode}: ${result.status} ${result.elapsedMs}ms ${result.sdkTotalTokens} tokens`);
    }
    evidence.status='completed';
  }catch(e){evidence.status='interrupted';evidence.error=errorInfo(e);process.exitCode=1;}
  evidence.finishedAt=new Date().toISOString();save();console.log(output);
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)await main();
