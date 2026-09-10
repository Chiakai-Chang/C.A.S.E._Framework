import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {searchMaterial as search} from '../integrations/pi/material-search.mjs';
function fixture(t, text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'case-search-'));
  t.after(() => fs.rmSync(dir, {recursive:true,force:true}));
  const file = path.join(dir, 'source.txt');
  fs.writeFileSync(file,text);
  return {file,relative:'source.txt',query:'MARKER'};
}

test('literal search returns full CRLF-normalized lines and hashes original bytes',t=>{
  const args=fixture(t,'ignore\r\nconst MARKER = ".*";\r\nMARKER again\r\n');
  const before=fs.readFileSync(args.file);
  const result=search(args);
  assert.deepEqual(result.matches,[{line:2,text:'const MARKER = ".*";'},{line:3,text:'MARKER again'}]);
  assert.equal(result.sourceSha256,createHash('sha256').update(before).digest('hex'));
  assert.equal(result.path,'source.txt');
  assert.equal(result.query,'MARKER');
  assert.equal(result.startLine,1);
  assert.equal(result.scope,'single-file-from-startLine');
  assert.equal(result.noMatches,false);
  assert.equal(result.truncated,false);
  assert.equal(result.nextStartLine,null);
  assert.deepEqual(search({...args,query:'.*'}).matches,[{line:2,text:'const MARKER = ".*";'}]);
  assert.deepEqual(fs.readFileSync(args.file),before);
});

test('pagination returns each matching line once and only advertises a real continuation',t=>{
  const args=fixture(t,'MARKER\nnone\nMARKER twice MARKER\nnone\nMARKER');
  const first=search({...args,maxMatches:1});
  assert.deepEqual(first.matches,[{line:1,text:'MARKER'}]);
  assert.equal(first.truncated,true);
  assert.equal(first.nextStartLine,3);
  const second=search({...args,maxMatches:1,startLine:first.nextStartLine});
  assert.deepEqual(second.matches,[{line:3,text:'MARKER twice MARKER'}]);
  assert.equal(second.nextStartLine,5);
  const third=search({...args,maxMatches:1,startLine:second.nextStartLine});
  assert.equal(third.matches[0].line,5);
  assert.equal(third.truncated,false);
  assert.equal(third.nextStartLine,null);
});

test('no-match receipts are restricted to the selected file and start line',t=>{
  const args=fixture(t,'MARKER\nnone');
  for(const startLine of [2,20]){
    const result=search({...args,startLine});
    assert.deepEqual(result.matches,[]);
    assert.equal(result.noMatches,true);
    assert.equal(result.scope,'single-file-from-startLine');
    assert.equal(result.startLine,startLine);
    assert.equal(result.path,'source.txt');
    assert.equal(result.nextStartLine,null);
  }
  fs.writeFileSync(args.file,'');
  assert.equal(search(args).noMatches,true);
});

test('rejects invalid query and pagination rather than doing an unbounded search',t=>{
  const args=fixture(t,'MARKER');
  for(const query of ['',null,3,'x'.repeat(257),'MARKER\nnone','MARKER\rnone'])assert.throws(()=>search({...args,query}),{code:'INVALID_ARGUMENT'});
  for(const startLine of [0,-1,1.5,'1',Infinity])assert.throws(()=>search({...args,startLine}),{code:'INVALID_ARGUMENT'});
  for(const maxMatches of [0,21,1.5,'1',Infinity])assert.throws(()=>search({...args,maxMatches}),{code:'INVALID_ARGUMENT'});
});

test('regular files are capped at 1 MiB and directories are rejected before reading',t=>{
  const args=fixture(t,'MARKER');
  assert.throws(()=>search({...args,file:path.dirname(args.file)}),{code:'UNSAFE_TOOL_PATH'});
  fs.writeFileSync(args.file,'x'.repeat(1024*1024+1));
  assert.throws(()=>search(args),{code:'UNSAFE_TOOL_PATH'});
  fs.writeFileSync(args.file,'x'.repeat(1024*1024));
  assert.equal(search(args).noMatches,true);
});

test('symbolic links are not followed even when their target is a regular material file',t=>{
  const args=fixture(t,'MARKER');
  const link=path.join(path.dirname(args.file),'linked.txt');
  try {fs.symlinkSync(args.file,link,'file');}
  catch(error){if(['EPERM','EACCES'].includes(error.code)){t.skip('Symbolic link creation is not permitted');return;}throw error;}
  assert.throws(()=>search({...args,file:link}),{code:'UNSAFE_TOOL_PATH'});
});

test('JSON escaping and aggregate matches remain bounded without shortening lines',t=>{
  const text='MARKER'+ '"'.repeat(6000);
  const args=fixture(t,[text,text,text].join('\n'));
  const result=search(args);
  assert.ok(JSON.stringify(result).length<=24000);
  assert.deepEqual(result.matches,[{line:1,text}]);
  assert.equal(result.truncated,true);
  assert.equal(result.nextStartLine,2);
  const next=search({...args,startLine:2});
  assert.deepEqual(next.matches,[{line:2,text}]);
});

test('oversized matched lines fail explicitly rather than producing misleading partial evidence',t=>{
  const args=fixture(t,'MARKER'+'😀'.repeat(12000));
  assert.throws(()=>search(args),{code:'LINE_TOO_LONG'});
  assert.throws(()=>search({...args,relative:'x'.repeat(24000)}),{code:'SEARCH_RECEIPT_TOO_LARGE'});
});

test('a final-page null continuation still fits the JSON budget at its exact boundary',t=>{
  const args=fixture(t,'');
  for(let size=23500;size<=24000;size++){
    fs.writeFileSync(args.file,'MARKER'+'x'.repeat(size));
    try {
      const result=search(args);
      assert.ok(JSON.stringify(result).length<=24000,`oversized final result at ${size}`);
    } catch(error) {
      assert.equal(error.code,'LINE_TOO_LONG');
    }
  }
});
