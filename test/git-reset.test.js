import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createGitService} from '../lib/git-api.js';
test('squash preserves files and index; hard reset restores target; guards reject unsafe modes',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'utilities-reset-')),repo=path.join(temp,'repo');fs.mkdirSync(repo);
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true,stdio:'pipe'}).trim();
 const write=(name,value)=>fs.writeFileSync(path.join(repo,name),value+'\n');
 try{
 git('init','-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid');git('config','core.autocrlf','false');git('config','commit.gpgsign','false');
 write('noun.txt','first');git('add','.');git('commit','-m','first');const first=git('rev-parse','HEAD');
 write('noun.txt','second');git('commit','-am','second');const second=git('rev-parse','HEAD');
 const service=createGitService({stateDir:path.join(temp,'state')}),q=new URLSearchParams(),{id}=service.dispatch('POST','/add',q,{path:repo});
 const post=(op,body)=>service.dispatch('POST',`/${id}/${op}`,q,body);
 write('extra.txt','staged');git('add','extra.txt');write('noun.txt','unstaged');
 const indexBefore=git('write-tree');assert.equal(post('reset',{ref:first,mode:'soft'}).historyChanged,true);
 assert.equal(git('rev-parse','HEAD'),first);assert.equal(git('write-tree'),indexBefore);assert.equal(fs.readFileSync(path.join(repo,'noun.txt'),'utf8'),'unstaged\n');
 assert.match(git('diff','--cached','--name-only'),/noun.txt/);assert.match(git('diff','--name-only'),/noun.txt/);
 assert.throws(()=>post('reset',{ref:first,mode:'mixed'}),/Choose/);
 assert.throws(()=>post('reset',{ref:second,mode:'soft'}),/current branch history/);
 post('reset',{ref:first,mode:'hard'});assert.equal(fs.readFileSync(path.join(repo,'noun.txt'),'utf8'),'first\n');assert.equal(fs.existsSync(path.join(repo,'extra.txt')),false);assert.equal(git('status','--porcelain'),'');
 post('checkout',{ref:first,detach:true});assert.throws(()=>post('reset',{ref:first,mode:'hard'}),/Create or check out/);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
