// Development-only fixed worker repair pair. No product defaults are changed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createPiSessionRunner} from '../integrations/pi/sdk-session.mjs';
import {grade,digest} from './read-receipt-spec.mjs';
const [action,sdkPath,output]=process.argv.slice(2);
assert.ok(['prepare','run'].includes(action)&&sdkPath&&output);
const repo=fileURLToPath(new URL('../../',import.meta.url)),self=fileURLToPath(import.meta.url);
const previous=path.join(repo,'docs/evaluation/2026-09-09-review-repair-evidence.json');
const hash=f=>digest(fs.readFileSync(f));
const snapshot=async()=>{
  const get=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(5000)});assert.ok(r.ok);return r.json();};
  const m=await get('http://127.0.0.1:8080/v1/models'),p=await get('http://127.0.0.1:8080/props');
  return {id:m.data[0].id,build:p.build_info,defaults:p.default_generation_settings};
};
let record;
if(action==='prepare'){
  assert.ok(!fs.existsSync(output));
  const prior=JSON.parse(fs.readFileSync(previous)),prompt=prior.sessions.find(s=>s.role==='worker').prompt;
  const bytes=fs.readFileSync(path.join(prior.project,prior.spec.output));assert.equal(digest(bytes),prior.initialArtifactSha256);
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-thinking-pair-'))),slots={};
  for(const mode of ['off','medium']){
    const project=path.join(root,mode),agentDir=path.join(root,`${mode}-config`);fs.mkdirSync(project);fs.mkdirSync(agentDir);
    for(const [name,text] of Object.entries({...prior.spec.sources,'requirements.md':prior.spec.goal})){assert.equal(path.basename(name),name);fs.writeFileSync(path.join(project,name),text,{flag:'wx'});}
    assert.equal(path.basename(prior.spec.output),prior.spec.output);fs.writeFileSync(path.join(project,prior.spec.output),bytes,{flag:'wx'});
    slots[mode]={project,agentDir};
  }
  const codeHashes={};const collect=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);assert.ok(!e.isSymbolicLink());if(e.isDirectory())collect(f);else if(/\.(mjs|js|json)$/.test(e.name))codeHashes[f]=hash(f);}};
  collect(path.join(repo,'workflow-kit/integrations/pi'));collect(path.join(repo,'workflow-kit/skills/case-workflow/scripts/core'));
  for(const f of [self,previous,path.join(repo,'workflow-kit/evaluation/read-receipt-spec.mjs'),path.join(repo,'workflow-kit/evaluation/real-task-spec.mjs'),path.resolve(sdkPath)])codeHashes[f]=hash(f);
  record={kind:'repair-thinking-pair/1',status:'prepared',root,sdkPath:path.resolve(sdkPath),slots,spec:prior.spec,prompt,promptSha256:digest(prompt),initialArtifactSha256:digest(bytes),codeHashes,
    order:['off','medium'],limits:{eachMs:600000,maxTurns:16,maxTokens:4096,contextWindow:32768},results:[],
    limitations:['One fixed-order pair, not a success-rate estimate or causal proof.','Cache not reset, seed not fixed, order effects unknown.','Both arms receive the same prior model-generated review, including its proposed repair; no evaluator answer injected.','Worker repair only, not a full reviewer/integrator workflow.','New diagnostic budgets; prior workflow costs remain separate.','Complete SDK dependency tree and GGUF bytes not frozen.']};
  fs.writeFileSync(output,JSON.stringify(record,null,2),{flag:'wx'});console.log('Prepared both arms without generation');
}else{
  record=JSON.parse(fs.readFileSync(output));assert.equal(record.status,'prepared');assert.equal(record.sdkPath,path.resolve(sdkPath));
  const verify=()=>{for(const [f,h] of Object.entries(record.codeHashes))assert.equal(hash(f),h,`changed ${f}`);};verify();
  fs.writeFileSync(path.join(record.root,'generation.claim'),'one fixed pair',{flag:'wx'});
  const save=()=>fs.writeFileSync(output,JSON.stringify(record,null,2));record.status='running';save();
  try{
    const sdk=await import(pathToFileURL(record.sdkPath).href);record.server=await snapshot();assert.match(record.server.id,/orcarouter-STRIX_LEAN/);save();
    for(const mode of record.order){
      verify();assert.deepEqual(await snapshot(),record.server);
      const slot=record.slots[mode];assert.equal(hash(path.join(slot.project,record.spec.output)),record.initialArtifactSha256);
      for(const [name,text] of Object.entries({...record.spec.sources,'requirements.md':record.spec.goal}))assert.equal(fs.readFileSync(path.join(slot.project,name),'utf8'),text);
      const arm={mode,status:'running',requests:[],discoveries:[],startedAt:new Date().toISOString()};record.results.push(arm);save();console.log(`Started ${mode}`);
      const start=performance.now();
      try{
        const runtime=await sdk.ModelRuntime.create({authPath:path.join(slot.agentDir,'auth.json'),modelsPath:null,modelsStorePath:path.join(slot.agentDir,'models.json'),allowModelNetwork:false});
        runtime.registerProvider('repair-pair',{baseUrl:'http://127.0.0.1:8080/v1',api:'openai-completions',apiKey:'local',models:[{
          id:record.server.id,name:record.server.id,reasoning:true,input:['text'],contextWindow:32768,maxTokens:4096,
          compat:{supportsDeveloperRole:false,supportsReasoningEffort:false,thinkingFormat:'qwen-chat-template',maxTokensField:'max_tokens'},cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]});
        const wrapped={...sdk,async createAgentSession(options){
          const created=await sdk.createAgentSession(options),previousPayload=created.session.agent.onPayload;
          created.session.agent.onPayload=async(payload,model)=>{
            const transformed=await previousPayload?.(payload,model),p=transformed??payload;
            const firstText=p.messages.find(m=>m.role==='user')?.content;
            const text=typeof firstText==='string'?firstText:firstText?.map(c=>c.text??'').join('');assert.equal(digest(text),record.promptSha256);
            const kwargs=p.chat_template_kwargs;assert.equal(kwargs?.enable_thinking,mode!=='off');
            const ids=new Set();for(const m of p.messages){for(const c of m.tool_calls??[])ids.add(c.id);if(m.role==='tool')assert.ok(ids.has(m.tool_call_id));}
            arm.requests.push({atMs:performance.now()-start,kwargs,maxTokens:p.max_tokens,temperature:p.temperature??null,topP:p.top_p??null,roles:p.messages.map(m=>m.role),tools:p.tools.map(t=>t.function.name),toolSchemasSha256:digest(JSON.stringify(p.tools)),systemSha256:digest(JSON.stringify(p.messages.filter(m=>m.role==='system')))});save();return transformed;
          };return created;
        }};
        const run=await createPiSessionRunner({project:slot.project,agentDir:slot.agentDir,sdk:wrapped,model:runtime.getModel('repair-pair',record.server.id),modelRuntime:runtime,thinkingLevel:mode,maxTurns:16});
        arm.session=await run({role:'worker',prompt:record.prompt,writeScope:[record.spec.output],runId:`repair-${mode}`,onStart(){},signal:AbortSignal.timeout(600000),
          onDiscovery(args){const item={id:`repair-${mode}-${arm.discoveries.length+1}`,status:'pending',...args};arm.discoveries.push(item);save();return item;},
          validateResult(reply){if(reply.blocked||reply.changeRequest)return;assert.ok(fs.existsSync(path.join(slot.project,record.spec.output)),'Missing output');for(const [name,text] of Object.entries({...record.spec.sources,'requirements.md':record.spec.goal}))assert.equal(fs.readFileSync(path.join(slot.project,name),'utf8'),text,'source changed');}});
        arm.status='returned';
      }catch(e){arm.status='failed';arm.error={code:e.code??e.name,message:e.message};arm.session=e.sessionEvidence??null;}
      arm.elapsedMs=performance.now()-start;arm.grade=grade(slot.project,record.spec,false);verify();save();console.log(JSON.stringify({mode,status:arm.status,passed:arm.grade.artifactPassed,elapsedMs:arm.elapsedMs}));
      if(!arm.grade.sourcesPreserved||arm.grade.extraPaths.length||!arm.requests.length){record.status='stopped';break;}
    }
    if(record.status==='running')record.status='completed';
  }catch(e){record.status='interrupted';record.error={code:e.code??e.name,message:e.message};}
  save();console.log(record.status);
}
