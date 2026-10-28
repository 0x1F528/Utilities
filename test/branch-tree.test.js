import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pairBranches,pairState,buildBranchFolderTree,collectSpine,elisionRuns,chainExpandKey,markerKey} from '../git/branch-tree.js';
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
test('folder tree and spine collect single-child paths before a tip with pairs',()=>{
 const tree=buildBranchFolderTree([{name:'A/B/C/D/leaf',local:{},remote:null}]);
 const a=tree.children.get('A');
 const {spine,tip}=collectSpine(a);
 assert.deepEqual(spine.map(node=>node.name),['A','B','C']);
 assert.equal(tip.name,'D');
 assert.equal(tip.pairs[0].name,'A/B/C/D/leaf');
});
test('elision runs split when folder markers differ',()=>{
 const spine=[{name:'A',prefix:'A/'},{name:'B',prefix:'A/B/'},{name:'C',prefix:'A/B/C/'},{name:'D',prefix:'A/B/C/D/'}];
 const runs=elisionRuns(spine,item=>({ 'A/':'#f00', 'A/B/':'#f00', 'A/B/C/':'#0f0', 'A/B/C/D/':'#0f0' }[item.prefix]||''));
 assert.equal(runs.length,2);
 assert.deepEqual(runs[0].map(n=>n.name),['A','B']);
 assert.deepEqual(runs[1].map(n=>n.name),['C','D']);
 assert.equal(chainExpandKey(runs[0]),'A/→A/B/');
 assert.equal(markerKey(['#f00','#0f0']),'#f00\0#0f0');
});
