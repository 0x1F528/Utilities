import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createGitService} from '../lib/git-api.js';
test('no-commit cherry-pick: whole commit, selective patch, rename, atomic failure, conflict completion and abort',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'utilities-pick-')),repo=path.join(temp,'repo');fs.mkdirSync(repo);
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true,stdio:'pipe'}).trim();
 const write=(file,text)=>fs.writeFileSync(path.join(repo,file),text+'\n');
 try{
 git('init','-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid');git('config','core.autocrlf','false');git('config','commit.gpgsign','false');
 write('a.txt','base');write('b.txt','base');git('add','.');git('commit','-m','base');const base=git('rev-parse','HEAD');
 git('switch','-c','source');write('a.txt','source');write('b.txt','source');git('commit','-am','Source changes');const source=git('rev-parse','HEAD');
 git('switch','main');
 const service=createGitService({stateDir:path.join(temp,'state')}),q=new URLSearchParams(),{id}=service.dispatch('POST','/add',q,{path:repo});
 const get=op=>service.dispatch('GET',`/${id}/${op}`,q),post=(op,body={})=>service.dispatch('POST',`/${id}/${op}`,q,body);
 post('cherry-pick',{ref:source});assert.equal(git('rev-parse','HEAD'),base);assert.equal(git('diff','--cached','--name-only'),'a.txt\nb.txt');assert.equal(get('summary').cherry.active,false);
 assert.throws(()=>post('cherry-pick',{ref:source}),/Commit or stash/);git('reset','--hard','HEAD');
 post('cherry-pick',{ref:source,paths:['a.txt']});assert.equal(git('diff','--cached','--name-only'),'a.txt');assert.equal(fs.readFileSync(path.join(repo,'b.txt'),'utf8'),'base\n');git('reset','--hard','HEAD');
 write('a.txt','conflict');git('commit','-am','conflict');const current=git('rev-parse','HEAD'),index=git('write-tree');
 assert.throws(()=>post('cherry-pick',{ref:source,paths:['a.txt','b.txt']}));assert.equal(git('write-tree'),index);assert.equal(fs.readFileSync(path.join(repo,'b.txt'),'utf8'),'base\n');assert.equal(git('status','--porcelain'),'');
 post('cherry-pick',{ref:source});assert.equal(get('summary').cherry.active,true);assert.throws(()=>post('continue-cherry-pick'),/Resolve and stage/);
 post('abort-cherry-pick');assert.equal(git('rev-parse','HEAD'),current);assert.equal(git('status','--porcelain'),'');
 post('cherry-pick',{ref:source});write('a.txt','resolved');post('stage',{paths:['a.txt']});post('continue-cherry-pick');assert.equal(git('rev-parse','HEAD'),current);assert.equal(get('summary').cherry.active,false);assert.equal(git('diff','--cached','--name-only'),'a.txt\nb.txt');git('reset','--hard','HEAD');
 git('switch','source');git('mv','a.txt','renamed.txt');git('commit','-m','rename');const rename=git('rev-parse','HEAD');git('switch','main');git('reset','--hard',source);
 post('cherry-pick',{ref:rename,paths:['renamed.txt']});assert.equal(fs.existsSync(path.join(repo,'a.txt')),false);assert.equal(fs.readFileSync(path.join(repo,'renamed.txt'),'utf8'),'source\n');assert.equal(git('rev-parse','HEAD'),source);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
