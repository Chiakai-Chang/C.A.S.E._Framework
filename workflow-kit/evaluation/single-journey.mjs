#!/usr/bin/env node
// One normal main task from blank output; no verdict or answer injection.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {freeze,verifyFrozen,executeArm} from './read-receipt-comparison.mjs';
import {digest} from './read-receipt-spec.mjs';

export async function runSingle({manifestPath,output,sdk:providedSdk,execute=executeArm}){
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  verifyFrozen(manifest);
  if(fs.existsSync(output))throw new Error('Evidence output must be a new file');
  fs.writeFileSync(path.join(manifest.batchRoot,'generation.claim'),JSON.stringify({manifestSha256:digest(fs.readFileSync(manifestPath)),at:new Date().toISOString(),mode:'single-B'}),{flag:'wx'});
  const evidence={format:'case-single-journey/1',manifestId:manifest.id,createdAt:new Date().toISOString(),configuration:manifest.configuration,status:'starting',result:null,
    limitations:['One normal task, not a success-rate or comparative quality claim.','No oracle or synthetic verdict supplied to sessions.','GGUF bytes, peak context, hardware cost and preparation cost are not measured.']};
  fs.writeFileSync(output,JSON.stringify(evidence,null,2),{flag:'wx'});
  const save=()=>fs.writeFileSync(output,JSON.stringify(evidence,null,2));
  try{
    const sdk=providedSdk??await import(pathToFileURL(manifest.sdkPath).href);
    evidence.result=await execute({manifest,id:'B',sdk,onUpdate:result=>{evidence.status='running';evidence.result=result;save();}});
    evidence.status=evidence.result.status;
    evidence.finishedAt=new Date().toISOString();save();return evidence;
  }catch(e){
    evidence.status='interrupted';evidence.error={code:e.code??e.name??'ERROR',message:e.message};evidence.finishedAt=new Date().toISOString();
    try{save();}catch(saveError){e.evidence=evidence;e.saveError=saveError;}throw e;
  }
}

async function main(){
  const [action,...args]=process.argv.slice(2),options={};
  if(action==='--help'){console.log('prepare --sdk PATH --output NEW_MANIFEST [--thinking off|medium] | run --manifest PATH --output NEW_EVIDENCE\nOne normal CASE task, 600 seconds, one generation claim. Default thinking: medium.');return;}
  for(let i=0;i<args.length;i+=2){
    if(!['--sdk','--output','--manifest','--thinking'].includes(args[i])||!args[i+1]||options[args[i]])throw new Error('Use --help');
    options[args[i]]=args[i+1];
  }
  if(action==='prepare'&&options['--sdk']&&options['--output']&&!options['--manifest']){
    const manifest=await freeze({sdkPath:options['--sdk'],output:options['--output'],thinkingLevel:options['--thinking']??'medium'});
    console.log(JSON.stringify({status:'prepared',manifestId:manifest.id,thinkingLevel:manifest.configuration.thinkingLevel}));
  }else if(action==='run'&&options['--manifest']&&options['--output']&&!options['--sdk']&&!options['--thinking']){
    const evidence=await runSingle({manifestPath:options['--manifest'],output:options['--output']});
    console.log(JSON.stringify({status:evidence.status,elapsedMs:evidence.result.elapsedMs,roles:evidence.result.sessions.map(s=>s.role),artifactPassed:evidence.result.artifactPassed}));
  }else throw new Error('Use --help');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)await main();
