import {test} from 'node:test';
import assert from 'node:assert/strict';
import {StageQueue} from '../git/stage-queue.js';
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
test('rapid staging is serialized, keeps repeated toggles ordered and reconciles once after burst',async()=>{
 const gate=deferred(),calls=[];let active=0,max=0,reconciles=0;
 const queue=new StageQueue({send:async item=>{active++;max=Math.max(max,active);calls.push(item);if(calls.length===1)await gate.promise;active--;},reconcile:async()=>{reconciles++;}});
 queue.enqueue('stage a');queue.enqueue('stage b');queue.enqueue('unstage a');
 let commitStarted=false;const commit=queue.whenIdle().then(ok=>{assert.ok(ok);commitStarted=true;});
 assert.deepEqual(calls,['stage a']);assert.equal(commitStarted,false);gate.resolve();await commit;
 assert.equal(max,1);assert.deepEqual(calls,['stage a','stage b','unstage a']);assert.equal(reconciles,1);assert.equal(queue.running,false);
});
test('queue failure cancels remaining intentions, reconciles reality and blocks waiting commit',async()=>{
 const gate=deferred(),calls=[],errors=[];let reconciled=false;
 const queue=new StageQueue({send:async item=>{calls.push(item);await gate.promise;throw Error('index locked');},reconcile:async()=>{reconciled=true;},onError:error=>errors.push(error.message)});
 queue.enqueue('a');queue.enqueue('b');const waiting=queue.whenIdle();gate.resolve();assert.equal(await waiting,false);
 assert.deepEqual(calls,['a']);assert.deepEqual(errors,['index locked']);assert.ok(reconciled);assert.equal(queue.pending,0);
});
test('clicks during reconciliation are sent before a waiting action is released',async()=>{
 const settling=deferred(),entered=deferred(),calls=[];let rounds=0;
 const queue=new StageQueue({send:async item=>calls.push(item),reconcile:async()=>{if(++rounds===1){entered.resolve();await settling.promise;}}});
 queue.enqueue('a');await entered.promise;queue.enqueue('b');const waiting=queue.whenIdle();settling.resolve();assert.ok(await waiting);assert.deepEqual(calls,['a','b']);assert.equal(rounds,2);
});
