import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createGitService} from '../lib/git-api.js';
test('restore snapshot changes files only, leaves index and history intact, protects dirty and ignored files',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'utilities-snapshot-')),repo=path.join(temp,'repo');fs.mkdirSync(repo);
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true,stdio:'pipe'}).trim();
 const write=(file,text)=>fs.writeFileSync(path.join(repo,file),text+'\n');
 try{
 git('init','-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid');git('config','core.autocrlf','false');git('config','commit.gpgsign','false');
 write('noun.txt','old');write('old.txt','old file');git('add','.');git('commit','-m','old');const old=git('rev-parse','HEAD');
 git('rm','old.txt');write('noun.txt','new');write('new.txt','new file');git('add','.');git('commit','-m','new');const head=git('rev-parse','HEAD'),index=git('write-tree');
 const service=createGitService({stateDir:path.join(temp,'state')}),q=new URLSearchParams(),{id}=service.dispatch('POST','/add',q,{path:repo});const post=(op,body)=>service.dispatch('POST',`/${id}/${op}`,q,body);
 write('dirty.txt','keep');assert.throws(()=>post('restore-snapshot',{ref:old}),/Commit or stash/);fs.unlinkSync(path.join(repo,'dirty.txt'));
 post('restore-snapshot',{ref:old});assert.equal(git('rev-parse','HEAD'),head);assert.equal(git('write-tree'),index);assert.equal(git('diff','--cached','--name-only'),'');
 assert.equal(fs.readFileSync(path.join(repo,'noun.txt'),'utf8'),'old\n');assert.equal(fs.readFileSync(path.join(repo,'old.txt'),'utf8'),'old file\n');assert.equal(fs.existsSync(path.join(repo,'new.txt')),false);
 git('add','-A');git('commit','-m','Restore snapshot');assert.equal(git('rev-parse','HEAD^'),head);assert.equal(git('rev-parse','HEAD^{tree}'),git('rev-parse',old+'^{tree}'));
 git('rm','old.txt');write('.gitignore','old.txt');git('add','.');git('commit','-m','ignore old');write('old.txt','ignored data');
 assert.throws(()=>post('restore-snapshot',{ref:old}),/ignored file would be overwritten/);assert.equal(fs.readFileSync(path.join(repo,'old.txt'),'utf8'),'ignored data\n');
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
