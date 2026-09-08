#!/usr/bin/env node
// Development-only paired experiment. Both arms use CASE_READ; only the
// selected integration/core revision changes. Never installed with the kit.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {freeze,runFrozen,executeArm,verifyFrozen} from './read-receipt-comparison.mjs';
import {digest} from './read-receipt-spec.mjs';

export async function prepare({baselineKit,sdkPath,output}) {
  baselineKit=fs.realpathSync(baselineKit);
  const entry=path.join(baselineKit,'evaluation/read-receipt-comparison.mjs');
  if(!fs.existsSync(entry))throw new Error('Extract the 037966b workflow-kit snapshot first');
  const manifest=await freeze({sdkPath,output});
  manifest.experiment={kind:'planning-handoff/1',baselineRevision:'037966b',baselineEntry:entry,
    arms:{A:'baseline integration; new read receipt',B:'planning index and material-use guidance; new read receipt'},
    limits:'One probe, one A, one B, one holdout only if new-only. No replacement attempts.'};
  const collect=directory=>{for(const e of fs.readdirSync(directory,{withFileTypes:true})){
    const p=path.join(directory,e.name);
    if(e.isSymbolicLink())throw new Error('Baseline cannot contain symlinks');
    if(e.isDirectory())collect(p);else manifest.codeHashes[p]=digest(fs.readFileSync(p));
  }};
  collect(baselineKit);
  const thisFile=fileURLToPath(import.meta.url);
  manifest.codeHashes[thisFile]=digest(fs.readFileSync(thisFile));
  // Finalize before any generation claim; runFrozen then enforces every hash.
  fs.writeFileSync(output,JSON.stringify(manifest,null,2));
  return manifest;
}

export async function compare({manifestPath,output}) {
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  if(manifest.experiment?.kind!=='planning-handoff/1')throw new Error('Not a planning comparison manifest');
  verifyFrozen(manifest);
  const baseline=await import(pathToFileURL(manifest.experiment.baselineEntry).href);
  return runFrozen({manifestPath,output,execute:async ({manifest,id,sdk,onUpdate})=>{
    // Baseline evaluator's B path preserves the new receipt. Remap only its
    // isolated directory, never sources, oracle, permissions or generation settings.
    const invoke=id==='A'?baseline.executeArm:executeArm;
    const selected=id==='A'?{...manifest,slots:{...manifest.slots,B:manifest.slots.A}}:manifest;
    const label=record=>{record.id=id;record.treatment=id==='A'?'baseline':'planning-handoff';onUpdate(record);};
    const record=await invoke({manifest:selected,id:id==='A'?'B':id,sdk,onUpdate:label});
    record.id=id;return record;
  }});
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const [action,...args]=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i+=2){if(!['--baseline','--sdk','--output','--manifest'].includes(args[i])||!args[i+1]||options[args[i]])throw new Error('Invalid arguments');options[args[i]]=args[i+1];}
  if(action==='prepare'&&options['--baseline']&&options['--sdk']&&options['--output'])await prepare({baselineKit:options['--baseline'],sdkPath:options['--sdk'],output:options['--output']});
  else if(action==='run'&&options['--manifest']&&options['--output'])await compare({manifestPath:options['--manifest'],output:options['--output']});
  else throw new Error('prepare --baseline KIT --sdk PATH --output NEW_MANIFEST | run --manifest PATH --output NEW_EVIDENCE');
}
