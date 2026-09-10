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
import {replayFirstVerdict} from './review-dispute-replay.mjs';

const [mode,sdkPath,output,variant]=process.argv.slice(2);
assert.ok(variant===undefined||['repaired-off','dispute-off'].includes(variant),'unknown diagnostic variant');
assert.ok(['prepare','run'].includes(mode)&&sdkPath&&output,'prepare|run SDK NEW_EVIDENCE');
const repo=fileURLToPath(new URL('../../',import.meta.url));
const priorPath=path.join(repo,'docs/evaluation/2026-09-08-worker-replay-evidence.json');
const planningPath=path.join(repo,'docs/evaluation/2026-09-08-planning-handoff-evidence.json');
const manifestPath=path.join(repo,'docs/evaluation/2026-09-08-planning-handoff-manifest.json');
const repairPath=path.join(repo,'docs/evaluation/2026-09-09-repair-thinking-evidence.json');
const verdictPath=path.join(repo,'docs/evaluation/2026-09-09-repaired-review-evidence.json');
const hashFile=f=>digest(fs.readFileSync(f));
let report;
if(mode==='prepare'){
  assert.ok(!fs.existsSync(output),'new evidence required');
  const prior=JSON.parse(fs.readFileSync(priorPath));
  const planning=JSON.parse(fs.readFileSync(planningPath)).results.find(r=>r.id==='B');
  const manifest=JSON.parse(fs.readFileSync(manifestPath));
  const spec=manifest.specs.main;
  const repaired=['repaired-off','dispute-off'].includes(variant);
  const repair=repaired?JSON.parse(fs.readFileSync(repairPath)):null;
  const arm=repair?.results.find(r=>r.mode==='off');
  if(repaired)assert.equal(arm.grade.artifactPassed,true);
  const artifactPath=path.join(repaired?repair.slots.off.project:prior.project,spec.output),artifact=fs.readFileSync(artifactPath);
  const receipt=(repaired?arm.session:prior.session).observations.filter(o=>o.toolName==='case_write'&&!o.isError).at(-1).result.details;
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
  for(const name of ['read-receipt-spec.mjs','real-task-spec.mjs']){const f=path.join(repo,'workflow-kit/evaluation',name);codeHashes[f]=hashFile(f);}
  if(repaired)codeHashes[repairPath]=hashFile(repairPath);
  codeHashes[fileURLToPath(new URL('./review-dispute-replay.mjs',import.meta.url))]=hashFile(fileURLToPath(new URL('./review-dispute-replay.mjs',import.meta.url)));
  if(variant==='dispute-off')codeHashes[verdictPath]=hashFile(verdictPath);
  report={kind:'synthetic-review-repair/1',status:'prepared',project,agentDir,caseId:state.id,spec,
    codeHashes,sdkPath:path.resolve(sdkPath),initialArtifactSha256:digest(artifact),transitions,initialState:state,
    priorWorkerElapsedMs:prior.elapsedMs,priorWorkerUsage:prior.session.usage,
    variant:variant??'original',priorRepair:repaired?{elapsedMs:arm.elapsedMs,usage:arm.session.usage}:null,
    configuration:{thinkingLevel:repaired?'off':'medium',contextWindow:32768,maxTokens:4096,maxTurns:16,continuationBudgetMs:600000},
    limitations:['Synthetic submitted state; not native resumption of worker-only history.','One continuation diagnostic, no causal comparison.','600-second continuation budget is additional to recorded prior worker cost; not original whole-task budget.','No oracle is supplied to sessions.','GGUF and complete SDK dependency tree not byte-frozen.'],sessions:[]};
  assert.equal(grade(project,spec).artifactPassed,repaired,'fixture must match selected evidence');
  if(variant==='dispute-off'){
    const historical=JSON.parse(fs.readFileSync(verdictPath));
    assert.equal(historical.initialArtifactSha256,report.initialArtifactSha256);
    assert.deepEqual(historical.spec,report.spec);
    report.historicalVerdict=JSON.parse(historical.sessions.find(s=>s.role==='integrator').text);
    report.limitations.push('First integrator reply is a labelled historical denial, not a live model result. Reviewer, planner and subsequent integrator use the live model.');
  }
  fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify({status:report.status,caseId:state.id,initialArtifactSha256:report.initialArtifactSha256}));
}else{
  report=JSON.parse(fs.readFileSync(output));assert.equal(report.status,'prepared');assert.equal(path.resolve(sdkPath),report.sdkPath);
  for(const [f,hash] of Object.entries(report.codeHashes))assert.equal(hashFile(f),hash,`changed ${f}`);
  assert.equal(hashFile(path.join(report.project,report.spec.output)),report.initialArtifactSha256);
  for(const [name,body] of Object.entries({...report.spec.sources,'requirements.md':report.spec.goal}))assert.equal(fs.readFileSync(path.join(report.project,name),'utf8'),body);
  assert.deepEqual(createStore(report.project).get(report.caseId),report.initialState);
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
    report.requests=[];
    const wrapped={...sdk,async createAgentSession(options){
      const created=await sdk.createAgentSession(options),previousPayload=created.session.agent.onPayload;
      created.session.agent.onPayload=async(payload,model)=>{
        const transformed=await previousPayload?.(payload,model),p=transformed??payload;
        assert.equal(p.chat_template_kwargs?.enable_thinking,report.configuration.thinkingLevel!=='off');
        report.requests.push({role:report.sessions.at(-1)?.role,kwargs:p.chat_template_kwargs,maxTokens:p.max_tokens});save();return transformed;
      };return created;
    }};
    const liveRun=await createPiSessionRunner({project:report.project,agentDir:report.agentDir,sdk:wrapped,model:runtime.getModel('review-repair',report.server.id),modelRuntime:runtime,thinkingLevel:report.configuration.thinkingLevel,maxTurns:16});
    const run=report.variant==='dispute-off'?replayFirstVerdict(liveRun,report.historicalVerdict,result=>{
      report.replayedVerdict={...result,source:verdictPath};save();
    }):liveRun;
    await runCase({store,caseId:report.caseId,signal:AbortSignal.timeout(600000),runSession:async request=>{
      const entry={role:request.role,prompt:request.prompt,startedAt:new Date().toISOString()};report.sessions.push(entry);save();console.log(`Started ${request.role}`);
      try{const result=await run(request);Object.assign(entry,result);return result;}
      catch(e){Object.assign(entry,e.sessionEvidence??{});entry.error={code:e.code??e.name,message:e.message};throw e;}
      finally{save();}
    }});report.status='completed';
  }catch(e){report.status='failed';report.error={code:e.code??e.name,message:e.message};}
  report.elapsedMs=performance.now()-start;report.grade=grade(report.project,report.spec);report.finalState=store.get(report.caseId);report.runs=store.listRuns(report.caseId);
  report.codeUnchanged=Object.entries(report.codeHashes).every(([f,h])=>hashFile(f)===h);save();
  if(report.variant==='dispute-off'){
    const disputes=report.runs.flatMap(r=>r.reviewDisputes??[]);
    report.disputeGrade={replayed:!!report.replayedVerdict,accepted:disputes.some(d=>d.status==='accepted'),artifactUnchanged:hashFile(path.join(report.project,report.spec.output))===report.initialArtifactSha256,noWorker:!report.sessions.some(s=>s.role==='worker')};
    report.disputeGrade.passed=report.status==='completed'&&report.grade.artifactPassed&&report.grade.sourcesPreserved&&report.codeUnchanged&&Object.values(report.disputeGrade).every(v=>v===true);save();
  }
  console.log(JSON.stringify({status:report.status,artifactPassed:report.grade.artifactPassed,roles:report.sessions.map(s=>s.role),elapsedMs:report.elapsedMs,error:report.error}));
}
