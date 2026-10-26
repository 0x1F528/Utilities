import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pairBranches,pairState} from '../git/branch-tree.js';
const local={name:'A/B/C',ref:'refs/heads/A/B/C',oid:'one',remote:false,paired:'origin/A/B/C',relation:'ahead'};
const remote={name:'origin/A/B/C',ref:'refs/remotes/origin/A/B/C',oid:'two',remote:true};
test('origin pairs with slash-delimited local branches; other remotes stay separate',()=>{
 const pairs=pairBranches([local,remote,{...remote,name:'upstream/A/B/C'}]);
 assert.equal(pairs.length,2);assert.equal(pairs[0].name,'A/B/C');assert.equal(pairs[0].local,local);assert.equal(pairs[0].remote,remote);assert.equal(pairs[1].name,'upstream/A/B/C');
});
test('paired boxes represent all six relationship states',()=>{
 for(const relation of ['ahead','behind','diverged'])assert.equal(pairState({local:{...local,relation},remote}),relation);
 assert.equal(pairState({local,remote:{...remote,oid:'one'}}),'same');
 assert.equal(pairState({local,remote:null}),'local-only');assert.equal(pairState({local:null,remote}),'remote-only');
});
