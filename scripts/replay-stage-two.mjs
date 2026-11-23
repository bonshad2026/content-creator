// Reuse the private, already-recorded audit fixture. No API, render, or user DB writes.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {resolveEditTurn} from '../src/edit-turn.js';
import {dialogueSchema} from '../src/conversation.js';
const root=path.resolve('data/test-out/audit-2026-11-21'),file=path.join(root,'private-replay-fixture.json');
const bytes=fs.readFileSync(file),fixture=JSON.parse(bytes).edit;
const before=JSON.stringify(fixture.analysis),result=resolveEditTurn({previous:fixture.analysis,proposal:fixture.raw,assets:fixture.assets,turn:fixture.messages.findLast(m=>m.role==='user')});
const expected=dialogueSchema.parse(fixture.raw.dialogue).question;
assert.deepEqual(result.problems,[]);assert.equal(result.errorKind,undefined);assert.equal(result.blocked,true);
assert.deepEqual(result.dialogue.question,expected);assert.equal(JSON.stringify(result.analysis),before);assert.equal(result.execution.applied.length,0);
const report={at:new Date().toISOString(),mode:'offline stored-response replay, no model calls',fixtureSha256:createHash('sha256').update(bytes).digest('hex'),case:'clarification-destroyed',passed:true,checks:{originalQuestionPreserved:true,allOriginalChoicesPreserved:true,pendingFileDoesNotExecute:true,selectionUnchanged:true,notMisclassifiedAsExecutionError:true},limits:'Only the cached-response failure is replayed here; historical raw responses are unavailable and black-picture coverage is stage 3.'};
fs.writeFileSync(path.join(root,'stage-2.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
