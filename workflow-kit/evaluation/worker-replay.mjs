// One worker-only diagnostic; no planner/reviewer and no overall workflow claim.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createPiSessionRunner} from '../integrations/pi/sdk-session.mjs';
import {digest,grade} from './read-receipt-spec.mjs';
const [sdkPath,priorPath,manifestPath,outputPath]=process.argv.slice(2);
assert.ok(sdkPath&&priorPath&&manifestPath&&outputPath);
assert.ok(!fs.existsSync(outputPath),'new evidence required');
const prior=JSON.parse(fs.readFileSync(priorPath)),manifest=JSON.parse(fs.readFileSync(manifestPath));
const worker=prior.results.find(r=>r.id==='B').sessions.find(s=>s.role==='worker');
const spec=manifest.specs.main;
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'case-worker-replay-')));
const project=path.join(root,'project'),agentDir=path.join(root,'config');
fs.mkdirSync(project);fs.mkdirSync(agentDir);
for(const [name,body] of Object.entries({...spec.sources,'requirements.md':spec.goal})){
  assert.equal(path.basename(name),name);fs.writeFileSync(path.join(project,name),body,{flag:'wx'});
}
const report={kind:'worker-only-replay/1',startedAt:new Date().toISOString(),project,
  priorSha256:digest(fs.readFileSync(priorPath)),promptSha256:digest(worker.prompt),
  configuration:manifest.configuration,requests:[],discoveries:[],status:'running',limitations:[
    'Worker only; no planner, reviewer or integrator. No overall quality comparison.',
    'Preflight checks file existence and frozen sources, not oracle; oracle is graded after session.',
    'New server snapshot; not a paired experiment with the previous build.']};
const save=()=>fs.writeFileSync(outputPath,JSON.stringify(report,null,2));
fs.writeFileSync(outputPath,JSON.stringify(report,null,2),{flag:'wx'});
const start=performance.now();
try{
  const get=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(5000)});assert.ok(r.ok);return r.json();};
  const models=await get('http://127.0.0.1:8080/v1/models');
  const props=await get('http://127.0.0.1:8080/props');
  report.server={modelId:models.data[0].id,buildInfo:props.build_info,settings:props.default_generation_settings};
  assert.match(report.server.modelId,/orcarouter-STRIX_LEAN/);
  const sdk=await import(pathToFileURL(path.resolve(sdkPath)).href);
  const runtime=await sdk.ModelRuntime.create({authPath:path.join(agentDir,'auth.json'),modelsPath:null,modelsStorePath:path.join(agentDir,'models.json'),allowModelNetwork:false});
  runtime.registerProvider('worker-replay',{baseUrl:'http://127.0.0.1:8080/v1',api:'openai-completions',apiKey:'local',models:[{
    id:report.server.modelId,name:report.server.modelId,reasoning:true,input:['text'],contextWindow:32768,maxTokens:4096,
    compat:{supportsDeveloperRole:false,supportsReasoningEffort:false,thinkingFormat:'qwen-chat-template',maxTokensField:'max_tokens'},cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]});
  const wrapped={...sdk,async createAgentSession(options){
    const created=await sdk.createAgentSession(options),previous=created.session.agent.onPayload;
    created.session.agent.onPayload=async(payload,model)=>{
      const transformed=await previous?.(payload,model),p=transformed??payload;
      const known=new Set();let paired=true;
      const messages=p.messages.map(m=>{
        const calls=(m.tool_calls??[]).map(c=>{known.add(c.id);return {id:c.id,name:c.function?.name};});
        if(m.role==='tool'&&!known.has(m.tool_call_id))paired=false;
        return {role:m.role,calls,toolCallId:m.tool_call_id,contentSha256:digest(JSON.stringify(m.content??'')),
          ...(m.role==='tool'?{content:m.content}:{})};
      });
      report.requests.push({atMs:performance.now()-start,maxTokens:p.max_tokens,kwargs:p.chat_template_kwargs,
        sampling:{temperature:p.temperature??null,topP:p.top_p??null},messages,paired,
        tools:p.tools.map(t=>t.function)});save();assert.ok(paired,'unpaired tool result');return transformed;
    };return created;
  }};
  const run=await createPiSessionRunner({project,agentDir,sdk:wrapped,model:runtime.getModel('worker-replay',report.server.modelId),modelRuntime:runtime,thinkingLevel:'medium',maxTurns:16});
  report.session=await run({role:'worker',prompt:worker.prompt,writeScope:[spec.output],runId:'worker-replay',onStart(){},signal:AbortSignal.timeout(600000),
    onDiscovery(args){const item={id:`replay-discovery-${report.discoveries.length+1}`,status:'pending',...args};report.discoveries.push(item);save();return item;},
    validateResult(reply){
      if(reply.blocked||reply.changeRequest)return;
      if(!fs.existsSync(path.join(project,spec.output)))throw Object.assign(new Error(`Missing ${spec.output}`),{code:'MISSING_ARTIFACT'});
      for(const [name,body] of Object.entries({...spec.sources,'requirements.md':spec.goal}))assert.equal(fs.readFileSync(path.join(project,name),'utf8'),body,'source changed');
    }});
  report.status='returned';
}catch(e){report.status='failed';report.error={code:e.code??e.name,message:e.message};report.session=e.sessionEvidence??null;}
report.elapsedMs=performance.now()-start;report.grade=grade(project,spec,false);save();
console.log(JSON.stringify({status:report.status,grade:report.grade,elapsedMs:report.elapsedMs}));
