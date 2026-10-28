import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeFolders,collectFileChain,fileMarkerKey,historicalKind} from '../git/folder-status.js';
import {elisionRuns} from '../git/branch-tree.js';
test('historical kinds map name-status codes',()=>{
 assert.equal(historicalKind({code:'A'}),'added');
 assert.equal(historicalKind({code:'D'}),'deleted');
 assert.equal(historicalKind({code:'M'}),'modified');
 assert.equal(historicalKind({stashUntracked:true}),'added');
});
test('fileMarkerKey distinguishes WIP and historical dots',()=>{
 assert.equal(fileMarkerKey({unstaged:true,staged:true},true),'unstaged\0staged');
 assert.equal(fileMarkerKey({conflicted:true,unstaged:true},true),'conflicted');
 assert.equal(fileMarkerKey({added:true,modified:true},false),'added\0modified');
});
test('collectFileChain includes tip folder that holds the file',()=>{
 const deep={files:[{path:'A/B/C/D/file.txt',unstaged:true}],folders:new Map()};
 const c={files:[],folders:new Map([['D',deep]])};
 const b={files:[],folders:new Map([['C',c]])};
 const a={files:[],folders:new Map([['B',b]])};
 summarizeFolders(a,true);
 const chain=collectFileChain('A',a,'');
 assert.deepEqual(chain.map(item=>item.name),['A','B','C','D']);
 assert.equal(chain.at(-1).prefix,'A/B/C/D/');
 assert.equal(elisionRuns(chain,item=>fileMarkerKey(item.node.status,true)).length,1);
 assert.equal(elisionRuns(chain,item=>fileMarkerKey(item.node.status,true))[0].length,4);
});
