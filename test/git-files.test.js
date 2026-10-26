import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createGitService} from '../lib/git-api.js';
test('selected historical files restore unstaged, discard restores HEAD, unrelated staging survives',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'utilities-files-')),repo=path.join(temp,'repo');fs.mkdirSync(repo);
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true,stdio:'pipe'}).trim();
 const write=(file,text)=>fs.writeFileSync(path.join(repo,file),text+'\n');
 try{
 git('init','-b','main');git('config','core.autocrlf','false');git('config','user.name','Test');git('config','user.email','test@example.invalid');git('config','commit.gpgsign','false');
 write('a.txt','old a');write('b.txt','old b');write('untouched.txt','base');git('add','.');git('commit','-m','old');const old=git('rev-parse','HEAD');
 write('a.txt','new a');write('b.txt','new b');git('commit','-am','new');const head=git('rev-parse','HEAD');
 const service=createGitService({stateDir:path.join(temp,'state')}),q=new URLSearchParams(),{id}=service.dispatch('POST','/add',q,{path:repo});
 const post=(op,body)=>service.dispatch('POST',`/${id}/${op}`,q,body);
 write('untouched.txt','staged other');write('a.txt','staged a');git('add','.');write('a.txt','unstaged a');
 post('restore-version',{ref:old,paths:['a.txt','b.txt']});assert.equal(git('rev-parse','HEAD'),head);
 assert.equal(fs.readFileSync(path.join(repo,'a.txt'),'utf8'),'old a\n');assert.equal(fs.readFileSync(path.join(repo,'b.txt'),'utf8'),'old b\n');
 assert.equal(git('diff','--cached','--name-only'),'untouched.txt');assert.match(git('diff','--name-only'),/a.txt/);
 post('discard',{paths:['a.txt','b.txt']});assert.equal(fs.readFileSync(path.join(repo,'a.txt'),'utf8'),'new a\n');
 write('untracked.txt','discard');post('discard',{paths:['untracked.txt']});assert.equal(fs.existsSync(path.join(repo,'untracked.txt')),false);
 // Restore a version where a currently tracked file had been deleted.
 git('reset','--hard','HEAD');git('rm','b.txt');git('commit','-m','remove b');const removed=git('rev-parse','HEAD');
 write('b.txt','returned');git('add','.');git('commit','-m','return b');
 post('restore-version',{ref:removed,paths:['b.txt']});assert.equal(fs.existsSync(path.join(repo,'b.txt')),false);assert.equal(git('diff','--cached','--name-only'),'');
 // A historical file absent from current HEAD is restored as untracked.
 git('reset','--hard',removed);post('restore-version',{ref:old,paths:['b.txt']});assert.equal(fs.readFileSync(path.join(repo,'b.txt'),'utf8'),'old b\n');
 assert.equal(git('status','--porcelain'),'?? b.txt');
 assert.throws(()=>post('restore-version',{ref:old,paths:['../outside']}),/path/i);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
