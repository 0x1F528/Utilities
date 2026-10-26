import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {createGitService,parseCommand,safePath} from '../lib/git-api.js';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
test('Git cockpit operates only on disposable repositories: registry, staging, history, stashes and remotes',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'utilities-git-')),repo=path.join(temp,'repo'),remote=path.join(temp,'remote.git'),other=path.join(temp,'other');
  fs.mkdirSync(repo);git(repo,'init','-b','main');git(repo,'config','core.autocrlf','false');git(repo,'config','user.name','Utility Test');git(repo,'config','user.email','utility-test@example.invalid');
  const service=createGitService({stateDir:path.join(temp,'state')}),q=object=>new URLSearchParams(object);
  const registration=service.dispatch('POST','/add',q({}),{path:repo}),id=registration.id;
  const get=(op,query={})=>service.dispatch('GET',`/${id}/${op}`,q(query)),post=(op,body={})=>service.dispatch('POST',`/${id}/${op}`,q({}),body);
  try{
    assert.equal(get('summary').head,'');fs.writeFileSync(path.join(repo,'hello.txt'),'hello\n');
    assert.equal(get('status')[0].untracked,true);
    const fingerprintBefore=get('fingerprint').fingerprint;assert.equal(get('fingerprint').fingerprint,fingerprintBefore);
    fs.appendFileSync(path.join(repo,'hello.txt'),'extra\n');assert.notEqual(get('fingerprint').fingerprint,fingerprintBefore);
    fs.writeFileSync(path.join(repo,'hello.txt'),'hello\n');
    post('stage',{paths:['hello.txt']});assert.equal(get('status')[0].staged,true);
    post('unstage',{paths:['hello.txt']});assert.equal(get('status')[0].untracked,true);
    post('stage',{paths:['hello.txt']});post('commit',{message:'First commit'});
    const first=get('summary').head;assert.ok(first);assert.equal(get('graph').length,1);
    post('checkout',{ref:first,detach:true});assert.equal(get('summary').branch,'(detached)');assert.equal(get('summary').head,first);
    post('checkout',{ref:first,create:'time-travel-test'});assert.equal(get('summary').branch,'time-travel-test');
    post('checkout',{ref:'main'});post('delete-branch',{branch:'time-travel-test'});
    assert.equal(get('files',{mode:'commit',ref:first})[0].path,'hello.txt');
    assert.equal(get('files',{mode:'wip'}).length,0);
    assert.equal(get('files',{mode:'wip',tracked:'1'})[0].code,'  ');
    assert.match(get('diff',{mode:'commit',ref:first,path:'hello.txt'}).text,/\+hello/);
    fs.writeFileSync(path.join(repo,'brand-new.txt'),'fresh\n');post('stage',{paths:['brand-new.txt']});post('commit',{message:'Add brand-new'});
    const added=get('summary').head;assert.match(get('diff',{mode:'commit',ref:added,path:'brand-new.txt'}).text,/\+fresh/);
    assert.ok(get('files',{mode:'commit',ref:added,tracked:'1'}).some(file=>file.path==='hello.txt'&&file.code==='  '));
    assert.match(get('diff',{mode:'commit',ref:added,path:'hello.txt',tracked:'1'}).text,/hello/);
    assert.equal(get('diff',{mode:'wip',path:'hello.txt',tracked:'1'}).text,'hello\n');
    fs.writeFileSync(path.join(repo,'empty-new.txt'),'');post('stage',{paths:['empty-new.txt']});post('commit',{message:'Add empty'});
    assert.match(get('diff',{mode:'commit',ref:get('summary').head,path:'empty-new.txt'}).text,/\(empty file\)|\+/);
    fs.writeFileSync(path.join(repo,'hello.txt'),'hello\nchanged\n');
    assert.match(get('diff',{path:'hello.txt'}).text,/\+changed/);
    post('stage',{paths:['hello.txt']});assert.match(get('diff',{path:'hello.txt',staged:'1'}).text,/\+changed/);
    post('discard',{paths:['hello.txt']});assert.equal(fs.readFileSync(path.join(repo,'hello.txt'),'utf8'),'hello\n');
    fs.writeFileSync(path.join(repo,'new file.txt'),'new\n');post('stash',{action:'push',message:'Partial stash',paths:['new file.txt']});
    let stashes=get('stashes');assert.equal(stashes.length,1);assert.ok(get('files',{mode:'stash',ref:stashes[0].ref}).some(f=>f.path==='new file.txt'));
    assert.match(get('diff',{mode:'stash',ref:stashes[0].ref,path:'new file.txt'}).text,/\+new/);
    post('stash',{action:'rename',ref:stashes[0].ref,message:'Renamed stash'});stashes=get('stashes');assert.equal(stashes.length,1);assert.equal(stashes[0].message,'Renamed stash');
    post('stash',{action:'pop',ref:stashes[0].ref});assert.equal(get('stashes').length,0);assert.ok(fs.existsSync(path.join(repo,'new file.txt')));
    post('discard',{paths:['new file.txt']});assert.equal(fs.existsSync(path.join(repo,'new file.txt')),false);
    fs.writeFileSync(path.join(repo,'staged-new.txt'),'new');post('stage',{paths:['staged-new.txt']});post('discard',{paths:['staged-new.txt']});assert.equal(fs.existsSync(path.join(repo,'staged-new.txt')),false);
    fs.writeFileSync(path.join(repo,'hello.txt'),'indexed\n');post('stage',{paths:['hello.txt']});post('stash',{action:'push',message:'Indexed stash'});post('stash',{action:'apply',ref:get('stashes')[0].ref});assert.equal(get('status').find(f=>f.path==='hello.txt').staged,true);post('discard',{paths:['hello.txt']});post('stash',{action:'drop',ref:get('stashes')[0].ref});
    post('checkout',{create:'feature',ref:first});assert.equal(get('summary').branch,'feature');
    post('checkout',{ref:'main'});post('delete-branch',{branch:'feature'});
    git(temp,'init','--bare',remote);git(repo,'remote','add','origin',remote);post('push');
    git(temp,'clone',remote,other);git(other,'switch','main');git(other,'config','user.name','Other Test');git(other,'config','user.email','other@example.invalid');
    fs.writeFileSync(path.join(other,'remote.txt'),'remote\n');git(other,'add','.');git(other,'commit','-m','Remote change');git(other,'push','origin','main');
    post('fetch');assert.equal(get('branches').find(b=>b.name==='main').relation,'behind');
    post('catch-up',{branch:'main'});assert.ok(fs.existsSync(path.join(repo,'remote.txt')));
    const second=get('summary').head;assert.match(get('diff',{mode:'range',from:first,to:second}).text,/remote/);
    fs.writeFileSync(path.join(repo,'ahead.txt'),'ahead');post('stage',{paths:['ahead.txt']});post('commit',{message:'Local only'});
    const ahead=get('summary').head;assert.equal(get('branches').find(b=>b.name==='main').relation,'ahead');post('catch-up',{branch:'main'});assert.equal(get('summary').head,ahead);
    fs.writeFileSync(path.join(other,'remote2.txt'),'remote2');git(other,'add','.');git(other,'commit','-m','Another remote change');git(other,'push','origin','main');post('fetch');assert.equal(get('branches').find(b=>b.name==='main').relation,'diverged');
    assert.throws(()=>post('catch-up',{branch:'main'}),/confirm/);
    fs.writeFileSync(path.join(repo,'dirty.txt'),'dirty');assert.throws(()=>post('catch-up',{branch:'main',hard:true}),/clean/);post('discard',{paths:['dirty.txt']});post('catch-up',{branch:'main',hard:true});assert.equal(fs.existsSync(path.join(repo,'ahead.txt')),false);
    git(other,'switch','-c','remote-feature');git(other,'push','-u','origin','remote-feature');post('fetch');post('checkout',{ref:'origin/remote-feature'});assert.equal(get('summary').branch,'remote-feature');post('checkout',{ref:'main'});post('delete-branch',{branch:'origin/remote-feature',remote:true});
    fs.writeFileSync(path.join(repo,'large.txt'),'x'.repeat(210000));assert.equal(get('diff',{path:'large.txt'}).truncated,true);post('discard',{paths:['large.txt']});
    fs.writeFileSync(path.join(repo,'.gitignore'),'ignored.log\n');fs.writeFileSync(path.join(repo,'ignored.log'),'ignore');
    assert.ok(get('status',{ignored:'1'}).some(f=>f.ignored));
    assert.throws(()=>post('stage',{paths:['../outside']}),/relative/);
    assert.throws(()=>post('stage',{paths:['.git/config']}),/relative/);
    assert.match(post('command',{command:'git status --short'}).output,/gitignore/);
    assert.ok(service.dispatch('GET','/commands',q({repo:id})).entries.some(e=>e.command.includes('stash store')));
    assert.equal(service.dispatch('GET','/registry').repos.length,1);
    service.dispatch('POST','/forget',q({}),{id});assert.ok(fs.existsSync(path.join(repo,'.git')));assert.equal(service.dispatch('GET','/registry').repos.length,0);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('manual Git parser preserves quoted paths and blocks shell operators / cwd escapes',()=>{
  assert.deepEqual(parseCommand('git add "a b.txt"'),['add','a b.txt']);
  assert.deepEqual(parseCommand("git log --format='%h %s'"),['log','--format=%h %s']);
  for(const text of ['git status && whoami','git -C ../x status','git add ../outside','git add C:\\outside','git status | more',"git log 'broken"])assert.throws(()=>parseCommand(text));
  assert.throws(()=>safePath(process.cwd(),'../outside'));
});
test('create keeps existing files and clone refuses nonempty destinations; both auto-register',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'utilities-git-create-'));
  const service=createGitService({stateDir:path.join(temp,'state')}),post=(action,body)=>service.dispatch('POST','/'+action,new URLSearchParams(),body);
  try{
    const source=path.join(temp,'created'),created=post('create',{path:source,branch:'trunk',name:'Created test'});
    assert.equal(created.name,'Created test');assert.equal(git(source,'branch','--show-current'),'trunk');
    git(source,'config','user.name','Utility Test');git(source,'config','user.email','utility-test@example.invalid');
    fs.writeFileSync(path.join(source,'README.md'),'# Test\n');git(source,'add','.');git(source,'commit','-m','Seed clone source');
    const destination=path.join(temp,'cloned'),cloned=post('clone',{url:source,path:destination,name:'Cloned test'});
    assert.equal(cloned.name,'Cloned test');assert.equal(git(destination,'rev-parse','HEAD'),git(source,'rev-parse','HEAD'));
    assert.equal(service.dispatch('GET','/registry').repos.length,2);
    assert.equal(post('create',{path:source}).id,created.id);assert.equal(git(source,'branch','--show-current'),'trunk');
    assert.throws(()=>post('clone',{url:source,path:destination}),/empty/);
    assert.match(fs.readFileSync(path.join(source,'README.md'),'utf8'),/# Test/);
    assert.throws(()=>post('clone',{url:path.join(temp,'missing-source'),path:path.join(temp,'failed')}));
    assert.equal(service.dispatch('GET','/registry').repos.length,2);
    const existing=path.join(temp,'existing-files');fs.mkdirSync(existing);fs.writeFileSync(path.join(existing,'keep.txt'),'Keep my files');
    post('create',{path:existing});assert.equal(fs.readFileSync(path.join(existing,'keep.txt'),'utf8'),'Keep my files');assert.equal(git(existing,'branch','--show-current'),'main');
    assert.throws(()=>post('create',{path:'relative-folder'}),/absolute/);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('path-scoped graph follows renames and returns path-at-revision',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'utilities-git-follow-')),repo=path.join(temp,'repo');
  fs.mkdirSync(repo);git(repo,'init','-b','main');git(repo,'config','core.autocrlf','false');git(repo,'config','user.name','Utility Test');git(repo,'config','user.email','utility-test@example.invalid');
  const service=createGitService({stateDir:path.join(temp,'state')}),q=object=>new URLSearchParams(object);
  const registration=service.dispatch('POST','/add',q({}),{path:repo}),id=registration.id;
  const get=(op,query={})=>service.dispatch('GET',`/${id}/${op}`,q(query)),post=(op,body={})=>service.dispatch('POST',`/${id}/${op}`,q({}),body);
  try{
    fs.mkdirSync(path.join(repo,'old'));fs.writeFileSync(path.join(repo,'old','name.txt'),'one\n');
    post('stage',{paths:['old/name.txt']});post('commit',{message:'Add old name'});
    fs.mkdirSync(path.join(repo,'new'));git(repo,'mv','old/name.txt','new/name.txt');
    post('commit',{message:'Rename to new'});
    fs.appendFileSync(path.join(repo,'new','name.txt'),'two\n');post('stage',{paths:['new/name.txt']});post('commit',{message:'Edit after rename'});
    const rows=get('graph',{refs:'main',path:'new/name.txt'});
    assert.equal(rows.length,3);
    assert.equal(rows[0].path,'new/name.txt');
    assert.match(rows[0].subject,/Edit after rename/);
    const rename=rows.find(row=>/^[RC]/.test(row.code||''));
    assert.ok(rename);assert.equal(rename.path,'new/name.txt');assert.equal(rename.oldPath,'old/name.txt');
    assert.ok(rows.some(row=>row.path==='old/name.txt'&&row.code.trim()==='A'));
    assert.match(get('diff',{mode:'commit',ref:rows[0].oid,path:'new/name.txt'}).text,/\+two/);
    // Projected parents stay inside the follow set so the UI draws one lineage, not orphans.
    const oids=new Set(rows.map(row=>row.oid));
    for(const row of rows)for(const parent of row.parents)assert.ok(oids.has(parent));
    assert.deepEqual(rows[0].parents,[rows[1].oid]);
    assert.deepEqual(rows[1].parents,[rows[2].oid]);
    assert.deepEqual(rows[2].parents,[]);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('rename updates the session display name without touching the repository path',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'utilities-git-rename-'));
  const service=createGitService({stateDir:path.join(temp,'state')}),post=(action,body)=>service.dispatch('POST','/'+action,new URLSearchParams(),body);
  try{
    const source=path.join(temp,'project');fs.mkdirSync(source);git(source,'init','-b','main');
    const registered=post('add',{path:source,name:'Original'});
    assert.equal(registered.name,'Original');
    const renamed=post('rename',{id:registered.id,name:'  Friendly name  '});
    assert.equal(renamed.name,'Friendly name');assert.equal(renamed.path,registered.path);
    assert.equal(service.dispatch('GET','/registry').repos.find(r=>r.id===registered.id).name,'Friendly name');
    assert.equal(service.dispatch('GET',`/${registered.id}/summary`).name,'Friendly name');
    assert.throws(()=>post('rename',{id:registered.id,name:'   '}),/display name/);
    assert.throws(()=>post('rename',{id:'missing',name:'Nope'}),/not registered/);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('status summarizes browser-supplied repository paths',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'utilities-git-status-'));
  const service=createGitService({stateDir:path.join(temp,'state')}),post=(action,body)=>service.dispatch('POST','/'+action,new URLSearchParams(),body);
  try{
    const source=path.join(temp,'project');fs.mkdirSync(source);git(source,'init','-b','main');
    const registered=post('add',{path:source,name:'Status demo'});
    service.dispatch('POST','/forget',new URLSearchParams(),{id:registered.id});
    const {repos}=post('status',{repos:[{id:registered.id,path:source,name:'Status demo'},{id:'missing',path:path.join(temp,'nope'),name:'Gone'}]});
    assert.equal(repos[0].available,true);assert.equal(repos[0].name,'Status demo');
    assert.equal(repos[1].available,false);
    assert.equal(service.dispatch('GET','/legacy-registry').repos.length,0);
    const legacySettings=service.dispatch('GET','/legacy-settings');
    assert.equal(legacySettings.defaultRemote,'origin');
    assert.equal(legacySettings.beyondComparePath,'');
    service.dispatch('POST','/settings',new URLSearchParams(),{beyondComparePath:'',defaultRemote:'upstream'});
    const branches=service.dispatch('GET',`/${registered.id}/branches`,new URLSearchParams({defaultRemote:'upstream',repoPath:source}));
    assert.ok(Array.isArray(branches));
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
