import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createGitService} from '../lib/git-api.js';
test('merge supports fast forward, conflicts, abort, completion and guards',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'utilities-merge-')),repo=path.join(temp,'repo');fs.mkdirSync(repo);
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true,stdio:'pipe'}).trim();
 const write=value=>fs.writeFileSync(path.join(repo,'noun.txt'),value+'\n');
 try{
 git('init','-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid');git('config','commit.gpgsign','false');
 write('base');git('add','.');git('commit','-m','base');
 const service=createGitService({stateDir:path.join(temp,'state')}),q=new URLSearchParams();
 const {id}=service.dispatch('POST','/add',q,{path:repo});
 const get=op=>service.dispatch('GET',`/${id}/${op}`,q),post=(op,body={})=>service.dispatch('POST',`/${id}/${op}`,q,body);
 git('switch','-c','willow');write('willow');git('commit','-am','willow');git('switch','main');
 post('merge',{ref:git('rev-parse','willow')});assert.equal(git('rev-parse','HEAD'),git('rev-parse','willow'));assert.equal(get('summary').merge.active,false);
 assert.match(post('merge',{ref:'willow'}).message,/up.to.date/i);
 git('switch','-c','raven');write('raven');git('commit','-am','raven');git('switch','main');write('main');git('commit','-am','main');
 write('dirty');assert.throws(()=>post('merge',{ref:'raven'}),/Commit or stash/);git('restore','noun.txt');
 post('merge',{ref:'raven'});assert.equal(get('summary').merge.active,true);assert.equal(get('summary').merge.conflicts,1);
 assert.equal(get('status')[0].conflicted,true);assert.throws(()=>post('commit',{message:'merge'}),/Resolve and stage/);
 post('abort-merge');assert.equal(get('summary').merge.active,false);assert.equal(fs.readFileSync(path.join(repo,'noun.txt'),'utf8').trim(),'main');
 post('merge',{ref:'raven'});write('resolved');post('stage',{paths:['noun.txt']});assert.equal(get('summary').merge.conflicts,0);
 post('commit',{message:'Merge raven'});assert.equal(get('summary').merge.active,false);assert.equal(git('rev-list','--parents','-n','1','HEAD').split(' ').length,3);
 post('checkout',{ref:'HEAD',detach:true});assert.throws(()=>post('merge',{ref:'raven'}),/Create or check out/);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
