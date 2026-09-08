// Diagnostic recovery from an existing artifact, not a native resume of worker-only history.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createStore} from '../skills/case-workflow/scripts/core/index.mjs';
import {createPiSessionRunner} from '../integrations/pi/sdk-session.mjs';
import {runCase} from '../integrations/pi/runner.mjs';
import {grade,digest} from './read-receipt-spec.mjs';

const [mode,sdkPath,output]=process.argv.slice(2);
assert.ok(['prepare','run'].includes(mode)&&sdkPath&&output,'prepare|run SDK NEW_EVIDENCE');
const repo=fileURLToPath(new URL('../../',import.meta.url));
const priorPath=path.join(repo,'docs/evaluation/2026-09-08-worker-replay-evidence.json');
const planningPath=path.join(repo,'docs/evaluation/2026-09-08-planning-handoff-evidence.json');
const manifestPath=path.join(repo,'docs/evaluation/2026-09-08-planning-handoff-manifest.json');
const hashFile=f=>digest(fs.readFileSync(f));
let report;
if(mode==='prepare'){
  assert.ok(!fs.existsSync(output),'new evidence required');
  const prior=JSON.parse(fs.readFileSync(priorPath));
  const planning=JSON.parse(fs.readFileSync(planningPath)).results.find(r=>r.id==='B');
  const manifest=JSON.parse(fs.readFileSync(manifestPath));
  const spec=manifest.specs.main;
  const artifactPath=path.join(prior.project,spec.output),artifact=fs.readFileSync(artifactPath);
  const receipt=prior.session.observations.find(o=>o.toolName==='case_write'&&!o.isError).result.details;
  assert.equal(digest(artifact),receipt.sourceSha256,'original artifact drift');
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-review-repair-')));
  const project=path.join(root,'project'),agentDir=path.join(root,'config');fs.mkdirSync(project);fs.mkdirSync(agentDir);
  for(const [name,body] of Object.entries({...spec.sources,'requirements.md':spec.goal})){assert.equal(path.basename(name),name);fs.writeFileSync(path.join(project,name),body,{flag:'wx'});}
  fs.writeFileSync(path.join(project,spec.output),artifact,{flag:'wx'});
  const store=createStore(project);store.init();let state=store.create(planning.finalState.contract);
  const transitions=[];
  const send=action=>{state=store.dispatch(state.id,action,{expectedRevision:state.revision,requestId:randomUUID()});transitions.push({action,revision:state.revision});};
  const p=planning.finalState.packets[0];
  const definition=Object.fromEntries(['id','purpose','constraintIds','inputs','dependsOn','writeScope','deliverables','checks','unknowns'].map(k=>[k,p[k]]));
  send({type:'plan',packets:[definition]});
  send({type:'start',packetId:p.id,sessionId:'synthetic-import-not-model'});
  send({type:'submit',packetId:p.id,attemptId:state.packets[0].attempts[0].id,summary:'Imported artifact for diagnostic independent review; original worker-only history is not resumed.'});
  const codeHashes={};
  const collect=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,entry.name);assert.ok(!entry.isSymbolicLink());if(entry.isDirectory())collect(f);else if(entry.name.endsWith('.mjs'))codeHashes[f]=hashFile(f);}};
  collect(path.join(repo,'workflow-kit/integrations/pi'));collect(path.join(repo,'workflow-kit/skills/case-workflow/scripts/core'));
  for(const f of [fileURLToPath(import.meta.url),priorPath,planningPath,manifestPath,path.resolve(sdkPath)])codeHashes[f]=hashFile(f);
  report={kind:'synthetic-review-repair/1',status:'prepared',project,agentDir,caseId:state.id,spec,
    codeHashes,sdkPath:path.resolve(sdkPath),initialArtifactSha256:digest(artifact),transitions,initialState:state,
    priorWorkerElapsedMs:prior.elapsedMs,priorWorkerUsage:prior.session.usage,
    configuration:{thinkingLevel:'medium',contextWindow:32768,maxTokens:4096,maxTurns:16,continuationBudgetMs:600000},
    limitations:['Synthetic submitted state; not native resumption of worker-only history.','One continuation diagnostic, no causal comparison.','600-second continuation budget is additional to recorded prior worker cost; not original whole-task budget.','No oracle is supplied to sessions.','GGUF and complete SDK dependency tree not byte-frozen.'],sessions:[]};
  assert.equal(grade(project,spec).artifactPassed,false,'fixture must retain known failure');
  fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify({status:report.status,caseId:state.id,initialArtifactSha256:report.initialArtifactSha256}));
}else{
  report=JSON.parse(fs.readFileSync(output));assert.equal(report.status,'prepared');assert.equal(path.resolve(sdkPath),report.sdkPath);
  for(const [f,hash] of Object.entries(report.codeHashes))assert.equal(hashFile(f),hash,`changed ${f}`);
  fs.writeFileSync(path.join(report.agentDir,'generation.claim'),'one continuation',{flag:'wx'});
  const save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2));
  const store=createStore(report.project),start=performance.now();report.status='running';save();
  try{
    const get=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(5000)});assert.ok(r.ok);return r.json();};
    const models=await get('http://127.0.0.1:8080/v1/models'),props=await get('http://127.0.0.1:8080/props');
    report.server={id:models.data[0].id,build:props.build_info,settings:props.default_generation_settings};assert.match(report.server.id,/orcarouter-STRIX_LEAN/);save();
    const sdk=await import(pathToFileURL(report.sdkPath).href);
    const runtime=await sdk.ModelRuntime.create({authPath:path.join(report.agentDir,'auth.json'),modelsPath:null,modelsStorePath:path.join(report.agentDir,'models.json'),allowModelNetwork:false});
    runtime.registerProvider('review-repair',{baseUrl:'http://127.0.0.1:8080/v1',api:'openai-completions',apiKey:'local',models:[{
      id:report.server.id,name:report.server.id,reasoning:true,input:['text'],contextWindow:32768,maxTokens:4096,
      compat:{supportsDeveloperRole:false,supportsReasoningEffort:false,thinkingFormat:'qwen-chat-template',maxTokensField:'max_tokens'},cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]});
    const run=await createPiSessionRunner({project:report.project,agentDir:report.agentDir,sdk,model:runtime.getModel('review-repair',report.server.id),modelRuntime:runtime,thinkingLevel:'medium',maxTurns:16});
    await runCase({store,caseId:report.caseId,signal:AbortSignal.timeout(600000),runSession:async request=>{
      const entry={role:request.role,prompt:request.prompt,startedAt:new Date().toISOString()};report.sessions.push(entry);save();console.log(`Started ${request.role}`);
      try{const result=await run(request);Object.assign(entry,result);return result;}
      catch(e){Object.assign(entry,e.sessionEvidence??{});entry.error={code:e.code??e.name,message:e.message};throw e;}
      finally{save();}
    }});report.status='completed';
  }catch(e){report.status='failed';report.error={code:e.code??e.name,message:e.message};}
  report.elapsedMs=performance.now()-start;report.grade=grade(report.project,report.spec);report.finalState=store.get(report.caseId);report.runs=store.listRuns(report.caseId);
  report.codeUnchanged=Object.entries(report.codeHashes).every(([f,h])=>hashFile(f)===h);save();
  console.log(JSON.stringify({status:report.status,artifactPassed:report.grade.artifactPassed,roles:report.sessions.map(s=>s.role),elapsedMs:report.elapsedMs,error:report.error}));
}
