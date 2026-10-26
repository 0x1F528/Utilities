import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createGitService} from '../lib/git-api.js';
test('working watch shares checks, observes active edits, and staging avoids history commands',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'utilities-watch-')),repo=path.join(temp,'repo');fs.mkdirSync(repo);
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true,stdio:'pipe'}).trim();
 const write=text=>fs.writeFileSync(path.join(repo,'a.txt'),text+'\n');
 try{
 git('init','-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid');git('config','core.autocrlf','false');git('config','commit.gpgsign','false');write('base');git('add','.');git('commit','-m','base');
 const calls=[],service=createGitService({stateDir:path.join(temp,'state'),onGitCommand:(args,options)=>calls.push({args,options})});
 const q=obj=>new URLSearchParams(obj),{id}=service.dispatch('POST','/add',q({}),{path:repo});
 const get=(op,query={})=>service.dispatch('GET',`/${id}/${op}`,q(query)),post=(op,body)=>service.dispatch('POST',`/${id}/${op}`,q({}),body);
 const first=get('watch',{tracked:'1',path:'a.txt'});assert.equal(first.count,0);assert.equal(first.files[0].code,'  ');
 calls.length=0;assert.equal(get('watch',{tracked:'1'}).token,first.token);assert.equal(get('watch',{tracked:'1'}).token,first.token);assert.equal(calls.length,0);
 get('watch',{fresh:'1',tracked:'1'});assert.deepEqual(calls.map(call=>call.args[0]),['status']);assert.ok(calls[0].options.quiet);
 write('edit');const changed=get('watch',{fresh:'1',path:'a.txt'});assert.equal(changed.count,1);assert.notEqual(changed.token,first.token);
 write('edit again');const again=get('watch',{fresh:'1',path:'a.txt'});assert.equal(again.token,changed.token);assert.notEqual(again.activeToken,changed.activeToken);
 assert.throws(()=>get('watch',{path:'../outside'}),/path/i);
 calls.length=0;post('stage',{paths:['a.txt']});assert.deepEqual(calls.map(call=>call.args[0]),['add']);
 const staged=get('watch',{tracked:'1'});assert.equal(staged.files[0].staged,true);assert.equal(staged.staged,1);
 calls.length=0;get('watch-history',{fresh:'1'});get('watch-history');assert.deepEqual(calls.map(call=>call.args[0]),['show-ref']);
 assert.ok(!calls.some(call=>['log','for-each-ref','rev-list'].includes(call.args[0])));
 post('unstage',{paths:['a.txt']});assert.equal(get('watch',{fresh:'1'}).files[0].staged,false);
 // Working-tree Git metadata must be read from its own gitdir, not the main worktree.
 const worktree=path.join(temp,'other');git('worktree','add','-b','other',worktree);
 const other=service.dispatch('POST','/add',q({}),{path:worktree});
 const watched=service.dispatch('GET',`/${other.id}/watch`,q({fresh:'1'}));assert.match(watched.header,/other/);assert.equal(watched.rebase.active,false);
 service.dispatch('POST','/forget',q({}),{id:other.id});assert.throws(()=>service.dispatch('GET',`/${other.id}/watch`,q({})),/not registered/);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
