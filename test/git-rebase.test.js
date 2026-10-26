import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createGitService} from '../lib/git-api.js';
test('rebase onto commit: clean replay, conflict, abort, continue and guards',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'utilities-rebase-')),repo=path.join(temp,'repo');fs.mkdirSync(repo);
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true,stdio:'pipe'}).trim();
 const write=(file,text)=>fs.writeFileSync(path.join(repo,file),text+'\n');
 try{
 git('init','-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid');git('config','commit.gpgsign','false');
 write('noun.txt','base');git('add','.');git('commit','-m','base');git('branch','willow');
 write('noun.txt','main');git('commit','-am','main');const main=git('rev-parse','HEAD');
 git('switch','willow');write('leaf.txt','leaf');git('add','.');git('commit','-m','leaf');
 const service=createGitService({stateDir:path.join(temp,'state')}),q=new URLSearchParams(),{id}=service.dispatch('POST','/add',q,{path:repo});
 const get=op=>service.dispatch('GET',`/${id}/${op}`,q),post=(op,body={})=>service.dispatch('POST',`/${id}/${op}`,q,body);
 assert.equal(post('rebase',{ref:main}).rebaseFinished,true);assert.equal(git('rev-parse','HEAD^'),main);
 const old=get('summary').head;
 git('switch','main');write('leaf.txt','other');git('add','.');git('commit','-m','other leaf');git('switch','willow');
 write('dirty.txt','dirty');assert.throws(()=>post('rebase',{ref:'main'}),/Commit or stash/);fs.unlinkSync(path.join(repo,'dirty.txt'));
 assert.equal(post('rebase',{ref:'main'}).rebasePaused,true);assert.equal(get('summary').rebase.branch,'willow');assert.equal(get('summary').rebase.conflicts,1);
 assert.throws(()=>post('continue-rebase'),/Resolve and stage/);assert.throws(()=>post('commit',{message:'bad'}),/Continue rebase/);
 post('abort-rebase');assert.equal(get('summary').head,old);assert.equal(get('summary').branch,'willow');
 post('rebase',{ref:'main'});write('leaf.txt','resolved');post('stage',{paths:['leaf.txt']});
 const result=post('continue-rebase');assert.equal(result.rebaseFinished,true);assert.equal(result.rewritten,true);assert.equal(get('summary').rebase.active,false);assert.equal(get('summary').branch,'willow');
 post('checkout',{ref:'HEAD',detach:true});assert.throws(()=>post('rebase',{ref:'main'}),/Create or check out/);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
