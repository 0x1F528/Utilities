import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeFolders} from '../git/folder-status.js';
const folder=(files=[],children=[])=>({files,folders:new Map(children)});
test('nested mixed changes propagate to every parent without counts',()=>{
 const leaf=folder([{staged:true,unstaged:true}]),root=folder([], [['nested',folder([], [['leaf',leaf]])]]);
 assert.deepEqual(summarizeFolders(root),{changed:true,staged:true,unstaged:true,conflicted:false});
 assert.equal(root.folders.get('nested').status.staged,true);assert.equal(leaf.status.unstaged,true);
});
test('untracked, deleted and conflict states propagate; ignored/clean files do not mark folders',()=>{
 const clean=folder([{code:'  ',staged:false,unstaged:false},{ignored:true,code:'!!'}]);
 assert.equal(summarizeFolders(clean).changed,false);
 assert.equal(summarizeFolders(folder([{untracked:true}])).unstaged,true);
 assert.equal(summarizeFolders(folder([{code:'D ',staged:true}])).staged,true);
 const root=folder([{conflicted:true,staged:true,unstaged:true}]);assert.equal(summarizeFolders(root).conflicted,true);assert.equal(root.status.staged,false);
});
test('historical folders show changes without inventing staging state; fresh filtered trees have no hidden status',()=>{
 assert.deepEqual(summarizeFolders(folder([{code:'M'}]),false),{changed:true,staged:false,unstaged:false,conflicted:false});
 assert.equal(summarizeFolders(folder()).changed,false);
});
