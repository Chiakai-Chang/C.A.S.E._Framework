import { digest } from '../../skills/case-workflow/scripts/core/io.mjs';

const fail = (code,message) => { throw Object.assign(new Error(message),{code}); };
export const receiptEvidenceSchema = {
  type:'object',additionalProperties:false,required:['assessment','receiptIds'],
  properties:{assessment:{type:'string',minLength:1,maxLength:12000},
    receiptIds:{type:'array',maxItems:16,uniqueItems:true,items:{type:'string',minLength:1}}},
};
export const receiptEvidenceGuidance = 'For every evidence field, submit exactly {"assessment":"your judgment and limitations","receiptIds":["receiptId from case_read in this session"]}. Do not retype hashes, line numbers or other provenance in prose. CASE resolves IDs to actual source metadata; that does not verify your judgment. A passing claim requires at least one citation; a failed claim may use [] when evidence is unavailable. Use at most 16 distinct IDs per evidence field. Search locates material, but only successful in-range case_read receipts (including empty files) can be cited. Unknown or stale IDs are rejected; read the relevant current source if needed. Never fabricate an ID.';

/** Session-local provenance only; neither source relevance nor model judgment is certified. */
export function createReviewEvidence(project) {
  const receipts=new Map();
  return {
    record(receipt) {
      if(receipt?.receiptVersion===1 && receipt.receiptId && !receipt.outOfRange && (receipt.range || receipt.empty))
        receipts.set(receipt.receiptId,structuredClone(receipt));
    },
    resolve(reply,role) {
      const resolved=structuredClone(reply);
      const claims=role==='reviewer'?[resolved]:resolved.results;
      if(!Array.isArray(claims)||!claims.length)fail('INVALID_CITATION','Review must contain evidence-bearing claims');
      for(const claim of claims){
        const e=claim?.evidence;
        if(typeof claim?.passed!=='boolean' || !e || typeof e!=='object' || Array.isArray(e) || Object.keys(e).length!==2 || !Object.hasOwn(e,'assessment') || !Object.hasOwn(e,'receiptIds') || typeof e.assessment!=='string' || !e.assessment.trim() || e.assessment.length>12000 || !Array.isArray(e.receiptIds) || e.receiptIds.length>16 || e.receiptIds.some(id=>typeof id!=='string'||!id) || new Set(e.receiptIds).size!==e.receiptIds.length || (claim.passed && !e.receiptIds.length))
          fail('INVALID_CITATION','Evidence requires only a nonempty assessment (at most 12000 characters) and up to 16 unique receiptIds; a passing claim requires at least one');
        const citations=e.receiptIds.map(id=>{
          const receipt=receipts.get(id);
          if(!receipt)fail('INVALID_CITATION',`Unknown or unusable current-session read receipt: ${JSON.stringify(id)}`);
          let current;
          try{current=digest(project,{path:receipt.path,required:true});}catch{ /* Missing or inaccessible sources are stale. */ }
          if(current!==receipt.sourceSha256)fail('STALE_CITATION',`Cited source changed or is unavailable: ${JSON.stringify(receipt.path)}. Read the current source before citing it.`);
          return structuredClone(receipt);
        });
        claim.evidence={assessment:e.assessment,citations};
      }
      return resolved;
    },
  };
}
