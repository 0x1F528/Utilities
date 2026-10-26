import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createGitService} from '../lib/git-api.js';
test('tag selected commits, lightweight or annotated, without overwriting existing tags',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'utilities-tags-')),repo=path.join(temp,'repo');fs.mkdirSync(repo);
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true,stdio:'pipe'}).trim();
 try{
 git('init','-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid');git('config','commit.gpgsign','false');
 fs.writeFileSync(path.join(repo,'noun.txt'),'lantern');git('add','.');git('commit','-m','first');const first=git('rev-parse','HEAD');
 fs.writeFileSync(path.join(repo,'noun.txt'),'willow');git('commit','-am','second');const head=git('rev-parse','HEAD');
 const service=createGitService({stateDir:path.join(temp,'state')}),q=new URLSearchParams(),{id}=service.dispatch('POST','/add',q,{path:repo});
 const post=body=>service.dispatch('POST',`/${id}/tag`,q,body),get=()=>service.dispatch('GET',`/${id}/tags`,q);
 post({ref:first,name:'v1.0'});assert.equal(git('cat-file','-t','refs/tags/v1.0'),'commit');
 post({ref:head,name:'release/willow',message:'Willow release'});assert.equal(git('cat-file','-t','refs/tags/release/willow'),'tag');
 assert.deepEqual(get().map(tag=>[tag.name,tag.oid,tag.annotated]),[['release/willow',head,true],['v1.0',first,false]]);
 assert.throws(()=>post({ref:head,name:'v1.0'}));assert.equal(git('rev-parse','v1.0'),first);
 for(const name of ['-bad','bad name','../bad'])assert.throws(()=>post({ref:head,name}));
 assert.equal(git('rev-parse','HEAD'),head);assert.equal(git('status','--porcelain'),'');
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
