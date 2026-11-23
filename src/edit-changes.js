// Domain-independent transaction executor. Only declared targets may be written.
import {isDeepStrictEqual} from 'node:util';

export function executeChanges({before,proposal,operations,adapter}) {
  const original=structuredClone(before), applied=[],ignored=[],problems=[];
  let state=structuredClone(before);
  for(const [index,operation] of operations.entries()) {
    if(operations.slice(0,index).some(other=>other.target===operation.target||other.target.startsWith(operation.target+'/')||operation.target.startsWith(other.target+'/'))) {
      problems.push({code:'overlapping-operations',target:operation.target});continue;
    }
    let result;
    try {result=adapter(state,proposal,operation);}
    catch {problems.push({code:'invalid-change',target:operation.target});continue;}
    if(result.problem){problems.push({code:result.problem,target:operation.target});continue;}
    if(result.ignored){ignored.push({target:operation.target,reason:result.ignored});continue;}
    if(isDeepStrictEqual(state,result.state)){problems.push({code:'operation-not-applied',target:operation.target});continue;}
    state=result.state;applied.push(operation);
  }
  // A contract error rolls back the whole transaction. Unsupported bounded values
  // are explicitly ignored, so other valid changes can still commit.
  return {state:problems.length?original:state,applied:problems.length?[]:applied,ignored,problems,changed:!problems.length&&!isDeepStrictEqual(original,state)};
}
