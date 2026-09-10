#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {specs,digest,grade,decision,oldReadResult} from './read-receipt-spec.mjs';
import {createStore} from '../skills/case-workflow/scripts/core/index.mjs';
import {createPiSessionRunner} from '../integrations/pi/sdk-session.mjs';
import {runCase,callSession} from '../integrations/pi/runner.mjs';

const kit=fileURLToPath(new URL('../',import.meta.url));
const errorInfo=e=>({code:e.code??e.name??'ERROR',message:e.message});
export const configuration=Object.freeze({endpoint:'http://127.0.0.1:8080/v1',thinkingLevel:'medium',contextWindow:32768,maxTokens:4096,maxTurns:16,maxAttempts:5,maxDurationMs:600000});
const hashFile=f=>digest(fs.readFileSync(f));
const diagnosticLimit=2*1024*1024;
export function retain(record,collection,value,key){
  const bytes=Buffer.byteLength(JSON.stringify(value));
  record.diagnostics??={bytes:0,dropped:0,complete:true,limit:diagnosticLimit};
  if(bytes>256*1024||record.diagnostics.bytes+bytes>diagnosticLimit||(Array.isArray(record[collection])&&record[collection].length>=2048)){
    record.diagnostics.dropped++;record.diagnostics.complete=false;return false;
  }
  record.diagnostics.bytes+=bytes;
  if(key===undefined)(record[collection]??=[]).push(value);else(record[collection]??={})[key]=value;
  return true;
}
function bodyReference(record,content){
  const body=JSON.stringify(content??''),sha256=digest(body);
  if(!Object.hasOwn(record.toolBodies,sha256))retain(record,'toolBodies',body,sha256);
  return {sha256,retained:Object.hasOwn(record.toolBodies,sha256)};
}
function codeInventory(sdkPath){
  const result={};
  const collect=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,e.name);if(e.isSymbolicLink())throw new Error('Cannot freeze symlinked runtime');
    if(e.isDirectory())collect(p);else if(/\.(mjs|cjs|js|ts|json)$/.test(e.name))result[p]=hashFile(p);
  }};
  collect(path.join(kit,'integrations/pi'));collect(path.join(kit,'skills/case-workflow/scripts/core'));
  collect(path.join(kit,'tests'));result[path.join(kit,'package.json')]=hashFile(path.join(kit,'package.json'));
  for(const name of ['read-receipt-comparison.mjs','read-receipt-spec.mjs','real-task-spec.mjs','single-journey.mjs']){const p=path.join(kit,'evaluation',name);result[p]=hashFile(p);}
  // Freeze the selected SDK installation, including nested runtime dependencies.
  const sdkRoot=path.dirname(path.dirname(sdkPath));
  if(!fs.existsSync(path.join(sdkRoot,'package.json')))throw new Error('--sdk must select a package dist/index.js');
  collect(sdkRoot);return result;
}
function policySnapshot(loader,project,agentDir){
  const files=loader.getAgentsFiles?.()?.agentsFiles;
  if(!Array.isArray(files)||typeof loader.getSystemPrompt!=='function')throw new Error('Cannot inspect loaded policies');
  const within=(base,f)=>{const r=path.relative(base,f);return r===''||(!r.startsWith('..')&&!path.isAbsolute(r));};
  return {files:files.map(f=>({scope:within(agentDir,f.path)?'agent-config':within(project,f.path)?'project':'ancestor',sha256:digest(f.content)})),
    systemPromptSha256:digest(loader.getSystemPrompt()??'')};
}
async function loadPolicy(sdk,slot){
  const settingsManager=sdk.SettingsManager.inMemory({compaction:{enabled:true},retry:{enabled:false}});
  const loader=new sdk.DefaultResourceLoader({cwd:slot.project,agentDir:slot.agentDir,settingsManager,noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:false});
  await loader.reload();return policySnapshot(loader,slot.project,slot.agentDir);
}
async function serverSnapshot(){
  const get=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(5000),redirect:'error'});if(!r.ok)throw new Error(`Local inventory failed: ${r.status}`);return r.json();};
  const inventory=await get(`${configuration.endpoint}/models`),props=await get('http://127.0.0.1:8080/props');
  const modelId=inventory.data?.[0]?.id;if(!modelId)throw new Error('No local model');
  return {modelId,buildInfo:props.build_info??null,defaultGenerationSettings:props.default_generation_settings??null};
}

export async function freeze({sdkPath,output,thinkingLevel='medium',sdk:providedSdk,inspectServer=serverSnapshot,inventory=codeInventory}){
  if(!['off','medium'].includes(thinkingLevel))throw new Error('thinkingLevel must be off or medium');
  const selectedConfiguration={...configuration,thinkingLevel};
  sdkPath=path.resolve(sdkPath);output=path.resolve(output);
  if(fs.existsSync(output))throw new Error('Manifest must be a new file');
  const sdk=providedSdk??await import(pathToFileURL(sdkPath).href),frozenSpecs=specs();
  const batchRoot=fs.mkdtempSync(path.join(os.tmpdir(),'case-read-receipt-'));
  const slots={};
  for(const id of ['probe','A','B','holdout']){
    const project=path.join(batchRoot,id),agentDir=path.join(batchRoot,`${id}-config`);
    fs.mkdirSync(project);fs.mkdirSync(agentDir);const spec=frozenSpecs[id==='probe'?'probe':id==='holdout'?'holdout':'main'];
    for(const [name,text] of Object.entries({...spec.sources,'requirements.md':spec.goal}))fs.writeFileSync(path.join(project,name),text,{flag:'wx'});
    slots[id]={project,agentDir};slots[id].policy=await loadPolicy(sdk,slots[id]);
  }
  if(JSON.stringify(slots.A.policy)!==JSON.stringify(slots.B.policy))throw new Error('A/B loaded policies differ');
  // Inputs are small enough that the receipt must not reduce available source text.
  for(const spec of Object.values(frozenSpecs))for(const [f,text] of Object.entries(spec.sources))
    if(text.length+2048>24000)throw new Error(`Source needs a different frozen fixture: ${f}`);
  const manifest={format:'case-read-receipt/1',id:randomUUID(),createdAt:new Date().toISOString(),sdkPath,batchRoot,configuration:selectedConfiguration,configurationSha256:digest(JSON.stringify(selectedConfiguration)),
    server:await inspectServer(),specs:frozenSpecs,slots,codeHashes:inventory(sdkPath),
    specSha256:digest(JSON.stringify(frozenSpecs)),order:['probe','A','B','holdout-if-new-only'],
    unknowns:{seed:'not requested; support unknown',cache:'not reset; warm-cache and order effects unknown',hardwareCost:'unknown',preparationCost:'unknown'},
    limits:{probeMs:90000,armMs:600000,maxArms:4},limitations:['One engineering pair; no causal or success-rate claim.','Holdout has no old-version control.','H1 contract adoption is separate from model quality.']};
  fs.writeFileSync(output,JSON.stringify(manifest,null,2),{flag:'wx'});return manifest;
}

export function verifyFrozen(manifest){
  const selected=manifest.configuration,level=selected?.thinkingLevel;
  const validConfiguration=['off','medium'].includes(level)&&JSON.stringify(selected)===JSON.stringify({...configuration,thinkingLevel:level})&&
    (manifest.configurationSha256?manifest.configurationSha256===digest(JSON.stringify(selected)):level==='medium');
  if(manifest.format!=='case-read-receipt/1'||!Object.keys(manifest.codeHashes??{}).length||!validConfiguration||digest(JSON.stringify(manifest.specs))!==manifest.specSha256)
    throw new Error('Invalid or changed manifest');
  for(const [file,hash] of Object.entries(manifest.codeHashes))if(hashFile(file)!==hash)throw new Error(`Frozen code changed: ${file}`);
}

// Injectable orchestration permits exhaustive decision tests without model generation.
export async function runBatch(manifest,executeArm,onUpdate=()=>{}){
  const evidence={format:'case-read-receipt-results/1',manifestId:manifest.id,status:'running',results:[],decision:null};
  const save=()=>onUpdate(evidence);
  for(const id of ['probe','A','B','holdout']){
    if(id==='holdout'&&!evidence.decision?.holdout)break;
    const record=await executeArm(id,r=>{const index=evidence.results.findIndex(x=>x.id===id);if(index<0)evidence.results.push(r);else evidence.results[index]=r;save();});
    const index=evidence.results.findIndex(x=>x.id===id);if(index<0)evidence.results.push(record);else evidence.results[index]=record;
    if(record.safetyStop||(id!=='probe'&&(!record.traceComplete||Object.values(record.constraints??{}).includes('unknown')))){
      evidence.status='stopped';evidence.decision={kind:'inconclusive',holdout:false};save();return evidence;
    }
    if(id==='B')evidence.decision=decision(evidence.results.find(r=>r.id==='A'),record);
    save();
  }
  evidence.status='completed';save();return evidence;
}

export function audit(record,spec){
  const traces=record.sessions.map(s=>s.trace);
  const traceComplete=record.diagnostics?.complete!==false&&traces.length>0&&traces.every(t=>t?.traceVersion===1&&t.traceComplete===true&&t.policyComplete===true);
  const allowedRead=new Set([...Object.keys(spec.sources),'requirements.md',spec.output]);
  let paths=record.toolPolicyViolation?'violated':'verified';
  for(const event of record.toolAudit??[]){
    if(event.kind!=='start')continue;
    if(['case_read','case_search','case_write','case_edit','case_list'].includes(event.toolName)){
      if(typeof event.path!=='string'&&paths!=='violated')paths='unknown';
      else if(['case_read','case_search'].includes(event.toolName)&&!allowedRead.has(event.path)||['case_write','case_edit'].includes(event.toolName)&&event.path!==spec.output||event.toolName==='case_list'&&event.path!=='.')paths='violated';
    }else if(!['case_result','case_discover','case_discovery_read'].includes(event.toolName))paths='violated';
  }
  const g=record.grade;
  const constraints={sourceIntegrity:g.sourcesPreserved?'verified':'violated',finalScope:g.extraPaths.length?'violated':'verified',toolPaths:paths,
    evidence:traceComplete?'verified':'unknown',policy:record.policyDrift?'violated':'verified'};
  return {artifactPassed:g.artifactPassed,traceComplete,constraints};
}

export function probeRoundtrip(record){
  let stage=0;
  const starts=new Map();
  for(const e of record.toolAudit??[]){
    if(e.kind==='start')starts.set(e.toolCallId,e);
    if(e.kind!=='end'||e.isError)continue;
    const s=starts.get(e.toolCallId);if(!s)continue;
    if(stage===0&&s.toolName==='case_read'&&s.path==='sample.json')stage=1;
    else if(stage===1&&s.toolName==='case_write'&&s.path==='copied.json')stage=2;
    else if(stage===2&&s.toolName==='case_read'&&s.path==='copied.json')stage=3;
  }
  return stage===3;
}

export async function executeArm({manifest,id,sdk,onUpdate=()=>{}}){
  const slot=manifest.slots[id],spec=manifest.specs[id==='probe'?'probe':id==='holdout'?'holdout':'main'];
  const record={id,scenario:spec.name,format:id==='A'?'old':'new',project:slot.project,status:'running',sessions:[],payloads:[],toolAudit:[],toolBodies:{},stopReasons:[],humanInterventions:0,saveMs:0};
  const start=performance.now(),controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(id==='probe'?90000:600000)]);
  const save=()=>{
    record.elapsedMs=Math.round(performance.now()-start);const saving=performance.now();
    try{onUpdate(record);}catch(e){record.safetyStop=true;record.evidenceSaveError=errorInfo(e);controller.abort(e);throw e;}
    finally{record.saveMs+=performance.now()-saving;}
  };save();
  let store,state,initialized=false;
  try{
    verifyFrozen(manifest);
    if(JSON.stringify(await serverSnapshot())!==JSON.stringify(manifest.server))throw Object.assign(new Error('Model/server settings drifted'),{code:'CONFIG_DRIFT'});
    if(JSON.stringify(await loadPolicy(sdk,slot))!==JSON.stringify(slot.policy))throw Object.assign(new Error('Loaded policy changed'),{code:'POLICY_DRIFT'});
    for(const [f,text] of Object.entries({...spec.sources,'requirements.md':spec.goal}))if(fs.readFileSync(path.join(slot.project,f),'utf8')!==text)throw new Error('Frozen input changed');
    const initial=new Set([...Object.keys(spec.sources),'requirements.md']);
    if(fs.readdirSync(slot.project).some(f=>!initial.has(f)))throw new Error('Unexpected initial project content');
    const runtime=await sdk.ModelRuntime.create({authPath:path.join(slot.agentDir,'auth.json'),modelsPath:null,modelsStorePath:path.join(slot.agentDir,'models.json'),allowModelNetwork:false});
    runtime.registerProvider('case-read-receipt-local',{baseUrl:configuration.endpoint,api:'openai-completions',apiKey:'local',models:[{
      id:manifest.server.modelId,name:manifest.server.modelId,reasoning:true,input:['text'],contextWindow:configuration.contextWindow,maxTokens:configuration.maxTokens,
      compat:{supportsDeveloperRole:false,supportsReasoningEffort:false,thinkingFormat:'qwen-chat-template',maxTokensField:'max_tokens'},cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]});
    const wrapped={...sdk,async createAgentSession(options){
      if(JSON.stringify(policySnapshot(options.resourceLoader,slot.project,slot.agentDir))!==JSON.stringify(slot.policy)){
        record.policyDrift=true;throw Object.assign(new Error('Session policy changed'),{code:'POLICY_DRIFT'});
      }
      options={...options,customTools:options.customTools.map(tool=>({...tool,async execute(callId,args,...rest){
        const p=typeof args?.path==='string'?args.path.replaceAll('\\','/').replace(/^(\.\/)+/,''):null;
        const permitted=['case_read','case_search'].includes(tool.name)?[...Object.keys(spec.sources),'requirements.md',spec.output].includes(p):['case_write','case_edit'].includes(tool.name)?p===spec.output:tool.name==='case_list'?p==='.':['case_result','case_discover','case_discovery_read'].includes(tool.name);
        if(!permitted)record.toolPolicyViolation=true;
        retain(record,'toolAudit',{kind:'start',toolCallId:callId,toolName:tool.name,path:p});save();
        try{const result=await tool.execute(callId,args,...rest);retain(record,'toolAudit',{kind:'end',toolCallId:callId,toolName:tool.name,isError:result.isError===true});
          return tool.name==='case_read'&&id==='A'?oldReadResult(result):result;
        }catch(e){retain(record,'toolAudit',{kind:'end',toolCallId:callId,toolName:tool.name,isError:true,error:errorInfo(e)});throw e;}
        finally{save();}
      }}))};
      const created=await sdk.createAgentSession(options),previous=created.session.agent.onPayload;
      const unsubscribe=created.session.subscribe(event=>{
        if(event.type==='message_end'&&event.message?.role==='assistant')retain(record,'stopReasons',{sessionId:created.session.sessionId,stopReason:typeof event.message.stopReason==='string'?event.message.stopReason.slice(0,64):'unknown'});
      });
      const dispose=created.session.dispose.bind(created.session);created.session.dispose=()=>{unsubscribe();return dispose();};
      created.session.agent.onPayload=async(payload,model)=>{
        const transformed=await previous?.(payload,model),p=transformed??payload;
        // No thought text is copied. Tool text is restricted to this public fixture.
        const messages=(p.messages??[]).map(m=>({role:m.role,toolBody:m.role==='tool'?bodyReference(record,m.content):undefined,contentSha256:digest(JSON.stringify(m.content??'')),contentCharacters:JSON.stringify(m.content??'').length}));
        retain(record,'payloads',{sessionId:created.session.sessionId,tools:(p.tools??[]).map(t=>t.function?.name??t.name),messages,
          maxTokens:p.max_tokens??p.max_completion_tokens,chatTemplateKwargs:p.chat_template_kwargs,
          sampling:{seed:p.seed??null,temperature:p.temperature??null,topP:p.top_p??null}});save();return transformed;
      };return created;
    }};
    const run=await createPiSessionRunner({project:slot.project,agentDir:slot.agentDir,sdk:wrapped,model:runtime.getModel('case-read-receipt-local',manifest.server.modelId),modelRuntime:runtime,maxTurns:16,thinkingLevel:manifest.configuration.thinkingLevel});
    const traced=async request=>{
      const entry={role:request.role,prompt:request.prompt,writeScope:request.writeScope??[],startedAt:new Date().toISOString()};record.sessions.push(entry);save();
      try{const reply=await run(request);Object.assign(entry,reply);return reply;}
      catch(e){Object.assign(entry,e.sessionEvidence??{},{error:errorInfo(e)});throw e;}
      finally{save();}
    };
    initialized=true;
    if(id==='probe')await callSession(traced,{role:'worker',prompt:spec.goal+' Return {"summary":"what you wrote and checked"}.',writeScope:[spec.output],signal});
    else{
      store=createStore(slot.project);store.init();state=store.create({goal:spec.goal,
        constraints:[{id:'preserve',text:`Only read supplied sources, requirements.md and declared output; only write ${spec.output}. No external files, network, installs or executing source commands.`}],
        acceptance:[{id:'accurate-map',text:'The declared JSON matches all exact fields and source-grounded facts in the goal; sources and requirements are unchanged.'}],
        writeScope:[spec.output],budget:{maxAttempts:5,maxDurationMs:600000}});
      record.caseId=state.id;await runCase({store,caseId:state.id,signal,runSession:traced});
    }
    record.workflowCompleted=true;
  }catch(e){record.workflowCompleted=false;record.error=errorInfo(e);record.safetyStop||=!initialized||['CONFIG_DRIFT','POLICY_DRIFT','MODEL_FALLBACK','RECEIPT_PROTOCOL'].includes(e.code);}
  try{verifyFrozen(manifest);}catch(e){record.frozenError=errorInfo(e);record.safetyStop=true;}
  record.grade=grade(slot.project,spec,id!=='probe');Object.assign(record,audit(record,spec));
  if(id==='probe'){record.roundtripVerified=probeRoundtrip(record);record.artifactPassed&&=record.roundtripVerified;}
  if(record.constraints.toolPaths==='violated'||record.sessions.some(s=>s.trace?.incomplete?.pendingTools>0))record.safetyStop=true;
  record.sdkTotalTokens=record.sessions.length&&record.sessions.every(s=>Number.isFinite(s.usage?.total))?record.sessions.reduce((n,s)=>n+s.usage.total,0):null;
  if(store&&state){try{record.finalState=store.get(state.id);record.runs=store.listRuns(state.id);}catch(e){record.stateError=errorInfo(e);record.safetyStop=true;}}
  record.status=record.workflowCompleted&&record.artifactPassed&&Object.values(record.constraints).every(v=>v==='verified')?'passed':'failed';
  save();return record;
}

export async function runFrozen({manifestPath,output,sdk:providedSdk,execute=executeArm}){
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));verifyFrozen(manifest);
  if(fs.existsSync(output))throw new Error('Evidence output must be a new file');
  // The claim lives in the frozen batch directory, so copying its manifest cannot rerun it.
  fs.writeFileSync(path.join(manifest.batchRoot,'generation.claim'),JSON.stringify({manifestSha256:hashFile(manifestPath),at:new Date().toISOString()}),{flag:'wx'});
  const sdk=providedSdk??await import(pathToFileURL(manifest.sdkPath).href);
  let latest={manifestId:manifest.id,status:'starting',results:[]};
  fs.writeFileSync(output,JSON.stringify(latest,null,2),{flag:'wx'});
  const save=r=>{latest=r;fs.writeFileSync(output,JSON.stringify(r,null,2));};
  try{return await runBatch(manifest,(id,onUpdate)=>execute({manifest,id,sdk,onUpdate}),save);}
  catch(e){latest.status='interrupted';latest.error=errorInfo(e);try{save(latest);}catch(s){e.evidence=latest;e.saveError=errorInfo(s);}throw e;}
}

async function main(){
  const [action,...args]=process.argv.slice(2),options={};
  if(action==='--help'){console.log('freeze --sdk PATH --output NEW_MANIFEST | run --manifest PATH --output NEW_EVIDENCE\nfreeze never generates; run consumes the batch once. Complete kit verification before run.');return;}
  for(let i=0;i<args.length;i+=2){if(!['--sdk','--output','--manifest'].includes(args[i])||!args[i+1]||options[args[i]])throw new Error('Use --help');options[args[i]]=args[i+1];}
  if(action==='freeze'&&options['--sdk']&&options['--output'])await freeze({sdkPath:options['--sdk'],output:options['--output']});
  else if(action==='run'&&options['--manifest']&&options['--output'])await runFrozen({manifestPath:options['--manifest'],output:options['--output']});
  else throw new Error('Use --help');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)await main();
