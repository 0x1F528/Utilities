import { spawnSync,spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { browseFolder } from './folder-picker.js';
import { historicalKind } from '../git/folder-status.js';

const MAX_DIFF=200*1024;
/** Clean tracked paths added to file lists; beyond this the browser OOMs on large trees (e.g. Core). */
const MAX_TRACKED_EXPAND=2500;
const fail=(message,status=400)=>{const error=new Error(message);error.status=status;throw error;};
/**
 * Normalize a filesystem path for the host Node process.
 * Windows: /mnt/c/foo → C:\foo. Linux/WSL: C:\foo or C:/foo → /mnt/c/foo.
 * Remote URLs, UNC paths, and already-native host paths are left unchanged.
 */
export function hostPath(value,platform=process.platform){
  if(typeof value!=='string'||!value)return value;
  // http(s)://…, git://…, ssh://…, and scp-like user@host:path — not drive letters
  if(/^[a-z][a-z0-9+.-]*:\/\//i.test(value)||(/^[^\\/]*@[^\\/]+:/.test(value)))return value;
  if(platform==='win32'){
    if(/^\/mnt\/[a-z]\//i.test(value)){
      return value.replace(/^\/mnt\/([a-z])\//i,(_,drive)=>drive.toUpperCase()+':\\').replaceAll('/','\\');
    }
    return value.replace(/^([a-z]):\//i,'$1:/');
  }
  if(value.startsWith('\\\\'))return value;
  const match=value.match(/^([a-zA-Z]):[\\/](.*)$/);
  if(match)return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\','/')}`;
  return value;
}
/** Convert /mnt/<drive>/… to a Windows path (same as hostPath on win32). */
export function windowsPath(value){return hostPath(value,'win32');}
/** Drop shell-style quotes people paste into path fields (`/mnt/c/'Program Files'/...`). */
export function cleanConfiguredPath(value){return String(value||'').trim().replaceAll("'",'').replaceAll('"','');}
const BC_CANDIDATES_WIN=['C:\\Program Files\\Beyond Compare 5\\BCompare.exe','C:\\Program Files\\Beyond Compare 4\\BCompare.exe','C:\\Program Files (x86)\\Beyond Compare 4\\BCompare.exe'];
const BC_CANDIDATES_WSL=['/mnt/c/Program Files/Beyond Compare 5/BCompare.exe','/mnt/c/Program Files/Beyond Compare 4/BCompare.exe','/mnt/c/Program Files (x86)/Beyond Compare 4/BCompare.exe'];
function isWindowsExecutable(file){return /\.exe$/i.test(file)||/^\/mnt\/[a-z]\//i.test(file)||/^[a-z]:[\\/]/i.test(file)||file.startsWith('\\\\');}
/** Convert a path for a Windows .exe launched from WSL (file args must be Windows-visible). */
export function windowsAccessiblePath(value){
  const cleaned=cleanConfiguredPath(value);if(!cleaned)return cleaned;
  if(process.platform==='win32')return hostPath(cleaned);
  if(/^[a-zA-Z]:[\\/]/.test(cleaned)||cleaned.startsWith('\\\\'))return cleaned;
  const result=spawnSync('wslpath',['-w',cleaned],{encoding:'utf8',windowsHide:true});
  if(result.status===0&&result.stdout.trim())return result.stdout.trim();
  return cleaned.replace(/^\/mnt\/([a-z])\//i,(_,drive)=>drive.toUpperCase()+':\\').replaceAll('/','\\');
}
export function parseCommand(text){
  const args=[];let word='',quote='',started=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='\\'&&['"',"'",'\\'].includes(text[i+1])&&(!quote||text[i+1]===quote||text[i+1]==='\\')){word+=text[++i];started=true;}
    else if(quote){if(c===quote)quote='';else word+=c;started=true;}
    else if(c==='"'||c==="'"){quote=c;started=true;}
    else if(/\s/.test(c)){if(started){args.push(word);word='';started=false;}}
    else{word+=c;started=true;}
  }
  if(quote)fail('Unclosed quote in command.');if(started)args.push(word);
  if(args[0]?.toLowerCase()==='git')args.shift();
  if(!args.length||args[0].startsWith('-'))fail('Enter a Git subcommand, for example git status. Global cwd overrides are not supported.');
  if(args.some(arg=>['&&','||','|',';','>','>>','<'].includes(arg)||arg==='-C'||/^--(?:git-dir|work-tree)(?:=|$)/.test(arg)))fail('Use one Git command in this repository; shell operators and cwd overrides are not supported.');
  if(args.some(arg=>arg.split(/[\\/]/).includes('..')||/^[a-z]:[\\/]/i.test(arg)||arg.startsWith('/')))fail('Manual paths must stay inside this repository. Use configured remote names for network operations.');
  return args;
}
export function safePath(cwd,value){
  if(typeof value!=='string'||!value||value.includes('\0')||value.split(/[\\/]/).some(part=>part==='..'||part.toLowerCase()==='.git')||path.isAbsolute(value)||/^[a-z]:/i.test(value)||value.startsWith(':'))fail('Use a relative repository path without .. or .git.');
  const absolute=path.resolve(cwd,value),relative=path.relative(cwd,absolute);
  if(relative.startsWith('..')||path.isAbsolute(relative))fail('Path is outside this repository.');
  let ancestor=absolute;
  while(!fs.existsSync(ancestor)&&ancestor!==cwd)ancestor=path.dirname(ancestor);
  const real=fs.realpathSync(ancestor),realRelative=path.relative(fs.realpathSync(cwd),real);
  if(realRelative.startsWith('..')||path.isAbsolute(realRelative))fail('Path resolves outside this repository.');
  return value.replaceAll('\\','/');
}
const str=(value,label='value')=>{if(typeof value!=='string'||!value||value.length>10000||value.includes('\0')||value.startsWith('-'))fail(`Invalid ${label}.`);return value;};
const SEP='\x1f';
function readJSON(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}}
export function createGitService({stateDir,onGitCommand=()=>{}}){
  fs.mkdirSync(stateDir,{recursive:true});
  const logFile=path.join(stateDir,'git-commands.jsonl');
  // Legacy files are read once for browser migration; live registry/settings live in localStorage.
  const legacyRepos=readJSON(path.join(stateDir,'git-registry.json'),{repos:[]}).repos||[];
  const legacySettings=readJSON(path.join(stateDir,'git-settings.json'),{});
  let settings={beyondComparePath:'',defaultRemote:'origin',...legacySettings};
  /** Per-request override from the browser; falls back to in-memory defaults (tests). */
  let activeSettings=settings;
  let logs=[];
  try{logs=fs.readFileSync(logFile,'utf8').trim().split('\n').filter(Boolean).slice(-600).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});}catch{}
  let sequence=logs.at(-1)?.id||0;
  const listeners=new Set();
  const publish=entry=>{for(const listener of listeners)try{listener(entry);}catch{}};
  const save=(file,value)=>{const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n');fs.renameSync(temp,file);};
  function applyRequestSettings(query=new URLSearchParams(),body={}){
    const beyond=body.beyondComparePath??(query.has('beyondComparePath')?query.get('beyondComparePath'):null);
    const remote=body.defaultRemote??(query.has('defaultRemote')?query.get('defaultRemote'):null);
    activeSettings={
      beyondComparePath:beyond!=null?hostPath(cleanConfiguredPath(String(beyond))):settings.beyondComparePath,
      defaultRemote:typeof remote==='string'&&remote.trim()&&!remote.trim().startsWith('-')?remote.trim():settings.defaultRemote
    };
    return activeSettings;
  }
  function record(entry){logs.push(entry);logs=logs.slice(-600);fs.appendFileSync(logFile,JSON.stringify(entry)+'\n');if(fs.statSync(logFile).size>5*1024*1024)fs.writeFileSync(logFile,logs.map(row=>JSON.stringify(row)).join('\n')+'\n');}
  /** Session bindings (id → repo). Browser sends repoPath; tests may rely on add() alone. */
  const bindings=new Map(),gitDirectories=new Map(),validatedRepos=new Map(),watchCache=new Map(),historyCache=new Map(),trackedCache=new Map();
  const pathId=resolved=>createHash('sha1').update(process.platform==='win32'?resolved.toLowerCase():resolved).digest('hex').slice(0,12);
  function bind(repo){bindings.set(repo.id,{id:repo.id,path:repo.path,name:repo.name||path.basename(repo.path),addedAt:repo.addedAt||new Date().toISOString()});return bindings.get(repo.id);}
  function run(repo,args,{allow=false,binary=false,input,quiet=false,editor='false'}={}){
    onGitCommand(args,{quiet});
    const started=Date.now(),command='git '+args.map(arg=>/[\s"']/.test(arg)?JSON.stringify(arg):arg).join(' ');
    const entry={id:++sequence,repoId:repo.id||'',time:new Date().toISOString(),cwd:repo.path,command,status:null};
    if(!quiet)publish({...entry,phase:'dispatch'});
    const result=spawnSync('git',['--no-pager','-c','color.ui=false',...args],{cwd:repo.path,encoding:binary?null:'utf8',input,windowsHide:true,timeout:60000,maxBuffer:16*1024*1024,env:{...process.env,GIT_OPTIONAL_LOCKS:quiet?'0':'1',GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never',GIT_EDITOR:editor,GIT_SEQUENCE_EDITOR:'false',GIT_LITERAL_PATHSPECS:'1'}});
    entry.status=result.status??-1;entry.duration=Date.now()-started;entry.stdout=String(result.stdout||'').slice(0,8000);entry.stderr=(String(result.stderr||'')||result.error?.message||'').slice(0,8000);if(!quiet)record(entry);
    if(!quiet)publish({...entry,phase:'result'});
    if(result.error){
      const code=result.error.code;
      if(code==='ENOBUFS')fail('Git output exceeded the 16 MB buffer. Turn off the Tracked file filter or narrow the selection.',413);
      if(code==='ENOMEM')fail('Host ran out of memory running Git. Turn off Tracked files or select fewer graph branches.',507);
      fail(result.error.message||'Git process failed.',409);
    }
    if(entry.status!==0&&!allow)fail(entry.stderr.trim()||entry.stdout.trim()||`Git failed (${entry.status}).`,409);
    return binary?result.stdout||Buffer.alloc(0):String(result.stdout||'');
  }
  function verifyRepo(repo,quiet=false){
    if(!fs.existsSync(repo.path))fail('Repository path is unavailable.',404);
    const actual=fs.realpathSync(run(repo,['rev-parse','--show-toplevel'],{quiet}).trim()),expected=fs.realpathSync(repo.path),normalize=value=>process.platform==='win32'?value.toLowerCase():value;
    if(normalize(actual)!==normalize(expected))fail('Directory is no longer a repository root. Re-register the repository.',409);
    return repo;
  }
  function probe(value){
    const requested=path.resolve(hostPath(str(value,'repository path')));
    if(!fs.existsSync(requested)||!fs.statSync(requested).isDirectory())fail('Directory is unavailable.');
    const root=run({path:requested},['rev-parse','--show-toplevel']).trim();
    const resolved=fs.realpathSync(root);
    return {id:pathId(resolved),path:resolved,name:path.basename(resolved)};
  }
  function repoFor(id,quiet=false,repoPath=''){
    if(repoPath){
      const probed=probe(repoPath);
      if(id&&id!==probed.id)fail('Repository id does not match path.',409);
      return verifyRepo(bind(probed),quiet);
    }
    const repo=bindings.get(id);if(!repo)fail('Repository is not registered. Open it from the registry page (browser list) or pass repoPath.',404);
    return verifyRepo(repo,quiet);
  }
  const head=repo=>run(repo,['rev-parse','--verify','HEAD'],{allow:true}).trim();
  function parseStatus(raw){
    const fields=raw.split('\0'),files=[];let header='';
    for(let i=0;i<fields.length;i++){
      if(!fields[i])continue;if(fields[i].startsWith('## ')){header=fields[i].slice(3);continue;}
      const code=fields[i].slice(0,2),file={path:fields[i].slice(3),index:code[0],worktree:code[1],code,untracked:code==='??',ignored:code==='!!'};
      if(/[RC]/.test(code))file.oldPath=fields[++i];
      file.conflicted=['DD','AU','UD','UA','DU','AA','UU'].includes(code);file.staged=![' ','?','!'].includes(file.index);file.unstaged=file.worktree!==' '&&!file.ignored;files.push(file);
    }
    return {files,header};
  }
  function status(repo,ignored=false){return parseStatus(run(repo,['status','--porcelain=v1','-z','--untracked-files=all',...(ignored?['--ignored']:[])])).files;}
  function gitPath(repo,name){
    const marker=path.join(repo.path,'.git');let signature='';try{const stat=fs.statSync(marker);signature=stat.isFile()?fs.readFileSync(marker,'utf8'):fs.realpathSync(marker);}catch{}
    let cached=gitDirectories.get(repo.path);
    if(!cached||cached.signature!==signature){cached={signature,directory:run(repo,['rev-parse','--absolute-git-dir'],{quiet:true}).trim()};gitDirectories.set(repo.path,cached);}
    return path.join(cached.directory,name);
  }
  function cherryFile(repo){return gitPath(repo,'utilities-cherry-pick.json');}
  function cherryState(repo){try{return {...JSON.parse(fs.readFileSync(cherryFile(repo),'utf8')),active:true};}catch(error){if(error.code==='ENOENT')return {active:false};throw error;}}
  function clearCherry(repo){fs.rmSync(cherryFile(repo),{force:true});}
  function rebaseState(repo){
    for(const name of ['rebase-merge','rebase-apply']){
      const dir=gitPath(repo,name);if(!fs.existsSync(dir))continue;
      const read=file=>{try{return fs.readFileSync(path.join(dir,file),'utf8').trim();}catch(error){if(error.code==='ENOENT')return '';throw error;}};
      return {active:true,branch:read('head-name').replace(/^refs\/heads\//,''),originalHead:read('orig-head'),onto:read('onto'),step:read('msgnum')||read('next'),total:read('end')||read('last')};
    }
    return {active:false};
  }
  function mergeState(repo){
    try{return {active:true,head:fs.readFileSync(gitPath(repo,'MERGE_HEAD'),'utf8').trim(),message:fs.readFileSync(gitPath(repo,'MERGE_MSG'),'utf8')};}catch(error){if(error.code==='ENOENT')return {active:false};throw error;}
  }
  const hash=value=>createHash('sha256').update(value).digest('hex');
  function stamp(file){try{const stat=fs.lstatSync(file);return [stat.size,stat.mtimeMs,stat.ctimeMs];}catch(error){if(['ENOENT','ENOTDIR'].includes(error.code))return null;throw error;}}
  function readHead(repo){return fs.readFileSync(gitPath(repo,'HEAD'),'utf8');}
  function workingWatch(repo,q){
    const ignored=q.get('ignored')==='1',key=repo.id+':'+ignored,now=Date.now();
    let cached=watchCache.get(key);
    if(!cached||q.get('fresh')==='1'||now-cached.time>1500){
      const raw=run(repo,['status','--porcelain=v1','-z','--branch','--untracked-files=all',...(ignored?['--ignored']:[])],{quiet:true});
      const parsed=parseStatus(raw),changed=parsed.files.filter(file=>!file.ignored),conflicts=changed.filter(file=>file.conflicted).length;
      const operations={merge:{...mergeState(repo),conflicts},rebase:{...rebaseState(repo),conflicts},cherry:{...cherryState(repo),conflicts}};
      cached={time:now,raw,files:parsed.files,header:parsed.header,operations,headState:readHead(repo)};watchCache.set(key,cached);
    }
    const token=hash(cached.raw+cached.headState+JSON.stringify(cached.operations));
    let allFiles=cached.files,trackedOmitted=false,trackedTotal=0;
    if(q.get('tracked')==='1'){
      const indexStamp=JSON.stringify(stamp(gitPath(repo,'index'))),prior=trackedCache.get(repo.id);
      if(!prior||prior.stamp!==indexStamp)trackedCache.set(repo.id,{stamp:indexStamp,paths:run(repo,['ls-files','--cached','-z'],{quiet:true}).split('\0').filter(Boolean)});
      const paths=trackedCache.get(repo.id).paths,known=new Set(allFiles.map(file=>file.path)),clean=paths.filter(file=>!known.has(file));
      trackedTotal=paths.length;
      if(allFiles.length+clean.length>MAX_TRACKED_EXPAND){trackedOmitted=true;allFiles=[...allFiles];}
      else{allFiles=[...allFiles];for(const file of clean)allFiles.push({path:file,code:'  ',staged:false,unstaged:false,untracked:false,ignored:false});}
    }
    const active=q.get('path');let activeToken=null;
    if(active){safePath(repo.path,active);activeToken=hash(JSON.stringify(stamp(path.join(repo.path,active)))+JSON.stringify(stamp(gitPath(repo,'index'))));}
    const changes=cached.files.filter(file=>!file.ignored);
    return {token,activeToken,header:cached.header,files:allFiles,trackedOmitted,trackedTotal,dirty:changes.length>0,count:changes.length,staged:changes.filter(file=>file.staged).length,...cached.operations};
  }
  function historyWatch(repo,q){
    const now=Date.now(),cached=historyCache.get(repo.id);
    if(cached&&q.get('fresh')!=='1'&&now-cached.time<12000)return cached.result;
    const refs=run(repo,['show-ref','--head'],{quiet:true,allow:true}),result={token:hash(refs+readHead(repo))};historyCache.set(repo.id,{time:now,result});return result;
  }
  function summary(repo){
    const branch=run(repo,['symbolic-ref','--quiet','--short','HEAD'],{allow:true}).trim(),oid=head(repo),files=status(repo);
    const upstream=run(repo,['rev-parse','--abbrev-ref','--symbolic-full-name','@{upstream}'],{allow:true}).trim();
    const counts=upstream?run(repo,['rev-list','--left-right','--count','HEAD...'+upstream],{allow:true}).trim().split(/\s+/).map(Number):[0,0];
    return {...repo,cherry:{...cherryState(repo),conflicts:files.filter(file=>file.conflicted).length},rebase:{...rebaseState(repo),conflicts:files.filter(file=>file.conflicted).length},merge:{...mergeState(repo),conflicts:files.filter(file=>file.conflicted).length},branch:branch||'(detached)',head:oid,upstream,ahead:counts[0]||0,behind:counts[1]||0,dirty:files.length>0,files:files.length,staged:files.filter(f=>f.staged).length};
  }
  function commit(repo,ref){return run(repo,['rev-parse','--verify','--end-of-options',str(ref,'revision')+'^{commit}']).trim();}
  function parseUpstreamTrack(track=''){
    const ahead=Number(/ahead (\d+)/.exec(track)?.[1]||0),behind=Number(/behind (\d+)/.exec(track)?.[1]||0);
    if(/gone/i.test(track))return {ahead,behind,relation:'gone'};
    return {ahead,behind,relation:ahead&&behind?'diverged':ahead?'ahead':behind?'behind':'same'};
  }
  function branches(repo){
    // Prefer %(upstream:track) so large repos avoid one rev-list per local branch.
    const rows=run(repo,['for-each-ref',`--format=%(refname)${SEP}%(refname:short)${SEP}%(objectname)${SEP}%(HEAD)${SEP}%(upstream:short)${SEP}%(upstream:track)`,'refs/heads','refs/remotes']).trim().split('\n').filter(Boolean).map(line=>{
      const [ref,name,oid,current,upstream,track='']=line.split(SEP);
      return {ref,name,oid,current:current==='*',upstream,track,remote:ref.startsWith('refs/remotes/')};
    }).filter(row=>!row.name.endsWith('/HEAD'));
    for(const row of rows.filter(r=>!r.remote)){
      const target=row.upstream||`${activeSettings.defaultRemote}/${row.name}`;
      const remote=rows.find(r=>r.remote&&r.name===target);
      row.paired=remote?.name||'';
      if(!row.paired){delete row.track;continue;}
      if(row.upstream)Object.assign(row,parseUpstreamTrack(row.track));
      else if(row.oid===remote.oid)Object.assign(row,{ahead:0,behind:0,relation:'same'});
      else{
        const [ahead,behind]=run(repo,['rev-list','--left-right','--count',`${row.oid}...${remote.oid}`]).trim().split(/\s+/).map(Number);
        Object.assign(row,{ahead,behind,relation:ahead&&behind?'diverged':ahead?'ahead':behind?'behind':'same'});
      }
      delete row.track;
    }
    for(const row of rows.filter(r=>r.remote))delete row.track;
    return rows;
  }
  /** Append clean tracked paths, or omit them entirely when the tree is too large for the UI. */
  function expandCleanTracked(repo,files,listArgs,{quiet=true}={}){
    const known=new Set(files.map(file=>file.path));
    const paths=run(repo,listArgs,{quiet}).split('\0').filter(Boolean);
    const clean=paths.filter(file=>!known.has(file));
    if(files.length+clean.length>MAX_TRACKED_EXPAND)return {files,trackedOmitted:true,trackedTotal:paths.length};
    for(const file of clean)files.push({path:file,code:'  ',staged:false,unstaged:false,untracked:false,ignored:false});
    return {files,trackedOmitted:false,trackedTotal:paths.length};
  }
  function stashes(repo){return run(repo,['stash','list',`--format=%gd${SEP}%H${SEP}%gs${SEP}%aI`]).trim().split('\n').filter(Boolean).map(line=>{const [ref,oid,message,date]=line.split(SEP);return {ref,oid,message,date};});}
  function stashRef(repo,ref){str(ref,'stash');const found=stashes(repo).find(s=>s.ref===ref||s.oid===ref);if(!found)fail('Stash no longer exists. Refresh the list.');return found;}
  function parseFollowGraph(raw){
    // `git log --follow --name-status --format=…` interleaves one status block after each commit header.
    return raw.split('\x1e').filter(Boolean).map(chunk=>{
      const lines=chunk.split('\n'),[oid,parents,author,date,subject,decoration]=lines[0].split(SEP);
      let path,oldPath,code='M';
      for(const line of lines.slice(1)){
        if(!line.trim())continue;
        const parts=line.split('\t');if(parts.length<2)continue;
        code=parts[0];
        if(/^[RC]/.test(code)&&parts.length>=3){oldPath=parts[1];path=parts[2];}
        else path=parts[1];
        break;
      }
      return {oid,parents:parents?parents.split(' ').filter(Boolean):[],author,date,subject,decoration,path,oldPath,code};
    }).filter(row=>row.oid);
  }
  // Path history omits commits that did not touch the file; raw parents often point outside the
  // set and shatter the lane layout. Keep in-set parents (real merges); otherwise bridge to the
  // next follow entry so the projected DAG stays one coherent lineage per selected tip.
  function projectFollowParents(commits){
    const oids=new Set(commits.map(row=>row.oid));
    return commits.map((row,index)=>{
      const parents=row.parents.filter(oid=>oids.has(oid));
      if(parents.length)return {...row,parents};
      const fallback=commits[index+1]?.oid;
      return {...row,parents:fallback?[fallback]:[]};
    });
  }
  function graph(repo,refs,filePath){
    if(!head(repo))return [];
    const selected=refs?refs.split(',').filter(Boolean).map(ref=>commit(repo,ref)):['--all'];
    if(!selected.length)return [];
    if(filePath){
      const focus=safePath(repo.path,filePath);
      // --follow needs a single path and does not combine with --graph ASCII; layout uses parents.
      // Topo order keeps child-before-parent so the fallback bridge matches ancestry.
      return projectFollowParents(parseFollowGraph(run(repo,['log','--follow','--topo-order','--max-count=200','--name-status',`--format=%x1e%H${SEP}%P${SEP}%an${SEP}%aI${SEP}%s${SEP}%D`,...selected,'--',focus])));
    }
    return run(repo,['log','--graph','--date-order','--max-count=200',`--format=%x1e%H${SEP}%P${SEP}%an${SEP}%aI${SEP}%s${SEP}%D`,...selected,'--']).split('\n').filter(line=>line.includes('\x1e')).map(line=>{const [oid,parents,author,date,subject,decoration]=line.slice(line.indexOf('\x1e')+1).split(SEP);return {oid,parents:parents?parents.split(' '):[],author,date,subject,decoration};});
  }
  function nameStatus(repo,args){
    const fields=run(repo,args).split('\0'),files=[];
    for(let i=0;i<fields.length;i++){if(!fields[i])continue;const code=fields[i++];let file=fields[i];if(/^[RC]/.test(code)){const oldPath=file;file=fields[++i];files.push({path:file,oldPath,code});}else files.push({path:file,code});}
    return files;
  }
  function modeSpec(repo,q){
    const mode=q.get('mode')||'wip';
    if(mode==='commit'){const to=commit(repo,q.get('ref'));const parent=run(repo,['rev-parse','--verify',`${to}^`],{allow:true}).trim();return {mode,to,from:parent||null};}
    if(mode==='range')return {mode,from:commit(repo,q.get('from')),to:commit(repo,q.get('to'))};
    if(mode==='stash'){const stash=stashRef(repo,q.get('ref'));return {mode,from:commit(repo,stash.oid+'^1'),to:stash.oid,untracked:run(repo,['rev-parse','--verify',stash.oid+'^3'],{allow:true}).trim()};}
    if(mode!=='wip')fail('Unknown diff mode.');return {mode,staged:q.get('staged')==='1'};
  }
  function files(repo,q){
    const spec=modeSpec(repo,q);if(spec.mode==='wip'){
      const result=status(repo,q.get('ignored')==='1');
      if(q.get('tracked')!=='1')return result;
      const expanded=expandCleanTracked(repo,result,['ls-files','-z','--cached']);
      return expanded.trackedOmitted?{files:expanded.files,trackedOmitted:true,trackedTotal:expanded.trackedTotal}:expanded.files;
    }
    let result=spec.from?nameStatus(repo,['diff','--name-status','-z','-M',spec.from,spec.to,'--']):nameStatus(repo,['diff-tree','--root','--no-commit-id','--name-status','-r','-z',spec.to,'--']);
    if(spec.untracked){const extra=run(repo,['ls-tree','-r','--name-only','-z',spec.untracked]).split('\0').filter(Boolean).map(file=>({path:file,code:'?',stashUntracked:true}));result.push(...extra.filter(f=>!result.some(r=>r.path===f.path)));}
    // Include unchanged paths from the selected revision when Tracked is enabled (blue files).
    if(q.get('tracked')==='1'&&spec.to){
      const expanded=expandCleanTracked(repo,result,['ls-tree','-r','--name-only','-z',spec.to]);
      return expanded.trackedOmitted?{files:expanded.files,trackedOmitted:true,trackedTotal:expanded.trackedTotal}:expanded.files;
    }
    return result;
  }
  function blob(repo,ref,file){return run(repo,['show',`${ref}:${file}`],{allow:true,binary:true});}
  function workFile(repo,file){const safe=safePath(repo.path,file),full=path.join(repo.path,safe);try{if(!fs.statSync(full).isFile())return Buffer.alloc(0);if(fs.statSync(full).size>16*1024*1024)fail('File exceeds the 16 MB comparison limit.');return fs.readFileSync(full);}catch(error){if(error.code==='ENOENT')return Buffer.alloc(0);throw error;}}
  function patchHasBody(content){return String(content).split('\n').some(line=>(line.startsWith('+')&&!line.startsWith('+++'))||(line.startsWith('-')&&!line.startsWith('---'))||line.startsWith('@@'));}
  function bufferAsDiff(file,buffer,{added=true}={}){
    if(buffer.includes(0))return 'Binary file\n';
    const text=buffer.toString('utf8');
    if(added)return `--- /dev/null\n+++ b/${file}\n`+(text?text.split('\n').map(line=>'+'+line).join('\n'):'+(empty file)');
    return `--- a/${file}\n+++ /dev/null\n`+(text?text.split('\n').map(line=>'-'+line).join('\n'):'-(empty file)');
  }
  function bufferAsContent(buffer){
    if(buffer.includes(0))return 'Binary file\n';
    const text=buffer.toString('utf8');
    return text||'(empty file)';
  }
  function diff(repo,q,full=false){
    const spec=modeSpec(repo,q),file=q.get('path');if(file)safePath(repo.path,file);
    let content='';
    if(spec.mode==='wip'){
      const entry=file?status(repo,true).find(f=>f.path===file)||(q.get('tracked')==='1'?{path:file,code:'  ',staged:false,unstaged:false,untracked:false,ignored:false}:null):null;
      if(entry?.untracked||entry?.ignored)content=bufferAsDiff(file,workFile(repo,file));
      else {
        content=run(repo,['diff','--no-ext-diff','--no-textconv',...(spec.staged?['--cached']:[]),'--',...(file?[file]:[])]);
        // Staged-only new file has an empty unstaged patch; show the index blob instead.
        if(file&&!patchHasBody(content)&&entry&&!spec.staged&&entry.staged&&!entry.unstaged)content=run(repo,['diff','--no-ext-diff','--no-textconv','--cached','--',file]);
        if(file&&!patchHasBody(content)&&entry&&(entry.index==='A'||entry.untracked))content=bufferAsDiff(file,entry.staged?blob(repo,'',file):workFile(repo,file));
        // Unchanged tracked file: show working-tree content.
        if(file&&!patchHasBody(content)&&entry)content=bufferAsContent(workFile(repo,file));
      }
    }else if(spec.mode==='stash'&&spec.untracked&&file&&run(repo,['ls-tree','-r','--name-only','-z',spec.untracked]).split('\0').includes(file)){
      content=bufferAsDiff(file,blob(repo,spec.untracked,file));
    }else{
      content=spec.from?run(repo,['diff','--no-ext-diff','--no-textconv','-M',spec.from,spec.to,'--',...(file?[file]:[])]):run(repo,['show','--format=','--no-ext-diff','--no-textconv',spec.to,'--',...(file?[file]:[])]);
      // Added/deleted/unchanged paths may yield an empty or header-only patch; fall back to blob content.
      if(file&&!patchHasBody(content)){
        const entry=files(repo,q).find(row=>row.path===file);
        const kind=entry?historicalKind(entry):(spec.from?'':'added');
        if(kind==='added')content=bufferAsDiff(file,blob(repo,spec.untracked&&entry?.stashUntracked?spec.untracked:spec.to,file));
        else if(kind==='deleted'&&spec.from)content=bufferAsDiff(file,blob(repo,spec.from,entry.oldPath||file),{added:false});
        else if(kind==='modified')content=bufferAsDiff(file,blob(repo,spec.to,file));
        else content=bufferAsContent(blob(repo,spec.to,file));
      }
    }
    return {text:full?content:content.slice(0,MAX_DIFF),truncated:content.length>MAX_DIFF,bytes:Buffer.byteLength(content)};
  }
  function selectedPaths(repo,body){const paths=body.paths;if(!Array.isArray(paths)||!paths.length||paths.length>1000)fail('Select at least one path.');return [...new Set(paths.map(file=>safePath(repo.path,file)))];}
  function branchName(repo,name){str(name,'branch name');run(repo,['check-ref-format','--branch',name]);return name;}
  function remoteName(repo,value){const remote=value||activeSettings.defaultRemote;str(remote,'remote');if(!run(repo,['remote']).trim().split('\n').includes(remote))fail('Remote is not configured.');return remote;}
  function beyondCompare(repo,q){
    const file=str(q.get('path'),'file path');safePath(repo.path,file);const spec=modeSpec(repo,q);
    let executable=hostPath(cleanConfiguredPath(activeSettings.beyondComparePath||''));
    if(!executable)executable=(process.platform==='win32'?BC_CANDIDATES_WIN:BC_CANDIDATES_WSL).find(p=>fs.existsSync(p))||'';
    if(!executable||!fs.existsSync(executable))fail('Set the Beyond Compare executable path in Git settings. Use a host path or paste C:\\… / /mnt/c/… (no shell quotes).');
    let left,right;
    if(spec.mode==='wip'){const entry=status(repo,true).find(row=>row.path===file);left=spec.staged?blob(repo,'HEAD',entry?.oldPath||file):blob(repo,'',file);right=spec.staged?blob(repo,'',file):workFile(repo,file);}
    else{const entry=files(repo,q).find(row=>row.path===file);left=spec.from?blob(repo,spec.from,entry?.oldPath||file):Buffer.alloc(0);right=blob(repo,spec.untracked&&entry?.stashUntracked?spec.untracked:spec.to,file);}
    const temp=path.join(stateDir,'git-bc',randomUUID());fs.mkdirSync(temp,{recursive:true});const name=path.basename(file),a=path.join(temp,'left-'+name),b=path.join(temp,'right-'+name);fs.writeFileSync(a,left);fs.writeFileSync(b,right);
    // Windows BC cannot open Linux paths; convert snapshot args (and keep a WSL-visible exe path for spawn).
    const args=process.platform!=='win32'&&isWindowsExecutable(executable)?[windowsAccessiblePath(a),windowsAccessiblePath(b)]:[a,b];
    return new Promise((resolve,reject)=>{const child=spawn(executable,args,{cwd:repo.path,detached:true,windowsHide:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve({launched:true});});});
  }
  function register(body){
    const probed=probe(body.path),name=typeof body.name==='string'&&body.name.trim()?body.name.trim():probed.name;
    if(name.includes('\0')||name.length>200)fail('Enter a display name of at most 200 characters.');
    return bind({...probed,name,addedAt:new Date().toISOString()});
  }
  function dispatch(method,pathname,query=new URLSearchParams(),body={}){
    applyRequestSettings(query,body);
    const parts=pathname.split('/').filter(Boolean),action=parts[0];
    if(action==='commands'&&method==='GET')return {entries:logs.filter(entry=>entry.id>Number(query.get('since')||0)&&(!query.get('repo')||entry.repoId===query.get('repo'))),cursor:sequence};
    if(action==='settings'){
      if(method==='GET')return settings;
      if(method!=='POST')fail('Method not allowed.',405);
      if(typeof body.beyondComparePath!=='string'||typeof body.defaultRemote!=='string'||!body.defaultRemote.trim()||body.defaultRemote.trim().startsWith('-'))fail('Invalid settings.');
      // In-memory only (tests / session). Browser settings are localStorage.
      settings={beyondComparePath:hostPath(cleanConfiguredPath(body.beyondComparePath)),defaultRemote:body.defaultRemote.trim()};
      activeSettings=settings;
      return settings;
    }
    if(action==='legacy-settings'&&method==='GET')return {beyondComparePath:typeof legacySettings.beyondComparePath==='string'?legacySettings.beyondComparePath:'',defaultRemote:typeof legacySettings.defaultRemote==='string'&&legacySettings.defaultRemote?legacySettings.defaultRemote:'origin'};
    // Session bindings only (tests / in-process). Browser registry is localStorage.
    if(action==='registry'&&method==='GET')return {repos:[...bindings.values()]};
    if(action==='legacy-registry'&&method==='GET')return {repos:legacyRepos.map(repo=>({id:repo.id,path:repo.path,name:repo.name,addedAt:repo.addedAt}))};
    if(action==='status'&&method==='POST'){
      const list=Array.isArray(body.repos)?body.repos:[];
      if(list.length>200)fail('Too many repositories in one status request.');
      return {repos:list.map(entry=>{
        try{
          if(typeof entry!=='object'||!entry||typeof entry.path!=='string')fail('Each repository needs a path.');
          const repo=repoFor(typeof entry.id==='string'?entry.id:'',false,entry.path);
          const name=typeof entry.name==='string'&&entry.name.trim()?entry.name.trim():repo.name;
          return {...summary(repo),name,available:true};
        }catch(error){return {id:entry?.id,path:entry?.path,name:entry?.name,available:false,error:error.message};}
      })};
    }
    if(action==='probe'&&method==='POST')return probe(body.path);
    if(['create','clone'].includes(action)&&method==='POST'){
      const requested=hostPath(str(body.path,'destination folder').trim());
      if(!path.isAbsolute(requested))fail('Enter an absolute destination folder path.');
      const destination=path.resolve(requested);
      if(fs.existsSync(destination)&&!fs.statSync(destination).isDirectory())fail('Destination must be a folder.');
      if(action==='clone'&&fs.existsSync(destination)&&fs.readdirSync(destination).length)fail('Clone destination must be a new folder or an empty existing folder.');
      if(action==='create'&&fs.existsSync(path.join(destination,'.git')))return register({path:destination,name:body.name});
      const source=action==='clone'?str(body.url,'repository URL or source path').trim():null;
      const initialBranch=action==='create'?str(body.branch||'main','initial branch'):null;
      const parent=path.dirname(destination);fs.mkdirSync(parent,{recursive:true});
      const context={path:parent};
      if(action==='create'){
        run(context,['check-ref-format','--branch',initialBranch]);
        run(context,['init','--initial-branch',initialBranch,'--',destination]);
      }else run(context,['clone','--',hostPath(source),destination]);
      return register({path:destination,name:body.name});
    }
    if(action==='add'&&method==='POST')return register(body);
    if(action==='forget'&&method==='POST'){bindings.delete(body.id);validatedRepos.delete(body.id);return {ok:true};}
    if(action==='forget-unavailable'&&method==='POST'){
      for(const [id,repo] of [...bindings]){try{run(repo,['rev-parse','--git-dir']);}catch{bindings.delete(id);validatedRepos.delete(id);}}
      return {ok:true,repos:[...bindings.values()]};
    }
    if(action==='rename'&&method==='POST'){
      const id=str(body.id,'repository id'),name=typeof body.name==='string'?body.name.trim():'';
      if(!name||name.includes('\0')||name.length>200)fail('Enter a display name of at most 200 characters.');
      const repo=bindings.get(id);if(!repo)fail('Repository is not registered.',404);
      repo.name=name;return repo;
    }
    const op=parts[1],light=['watch','watch-history','stage','unstage'].includes(op),prior=validatedRepos.get(action);
    const repoPath=query.get('repoPath')||(typeof body.repoPath==='string'?body.repoPath:'');
    const repo=light&&prior&&prior.repo.id===action&&(repoPath||bindings.has(action))&&(!repoPath||prior.repo.path===path.resolve(hostPath(repoPath)))&&Date.now()-prior.time<30000&&fs.existsSync(path.join(prior.repo.path,'.git'))?prior.repo:repoFor(action,light||op==='fingerprint',repoPath);
    if(!prior||repo!==prior.repo||Date.now()-prior.time>=30000)validatedRepos.set(action,{repo,time:Date.now()});
    if(method==='POST'){for(const key of watchCache.keys())if(key.startsWith(repo.id+':'))watchCache.delete(key);historyCache.delete(repo.id);}

    if(method==='POST'&&cherryState(repo).active&&!['stage','unstage','continue-cherry-pick','abort-cherry-pick','bc','command'].includes(op))fail('Complete or abort the current cherry-pick first.');
    if(method==='GET'){
      if(op==='watch')return workingWatch(repo,query);
      if(op==='watch-history')return historyWatch(repo,query);
      if(op==='fingerprint'){
        const raw=run(repo,['status','--porcelain=v1','-z','--branch','--untracked-files=all',...(query.get('ignored')==='1'?['--ignored']:[])],{quiet:true});
        const stamps=[];const fields=raw.split('\0');
        for(let index=0;index<fields.length;index++){
          const field=fields[index];if(!field||field.startsWith('##'))continue;
          const file=field.slice(3);try{const stat=fs.lstatSync(path.join(repo.path,file));stamps.push([file,stat.size,stat.mtimeMs,stat.ctimeMs]);}catch{stamps.push([file,null]);}
          if(/[RC]/.test(field.slice(0,2)))index++;
        }
        const refs=run(repo,['show-ref','--head'],{quiet:true,allow:true});
        return {fingerprint:createHash('sha256').update(raw).update(refs).update(JSON.stringify(stamps)).update(JSON.stringify(mergeState(repo))).update(JSON.stringify(rebaseState(repo))).update(JSON.stringify(cherryState(repo))).digest('hex')};
      }
      if(op==='summary')return summary(repo);
      if(op==='branches')return branches(repo);
      if(op==='tags')return run(repo,['for-each-ref',`--format=%(refname:short)${SEP}%(objectname)${SEP}%(*objectname)${SEP}%(objecttype)${SEP}%(*objecttype)`,'refs/tags']).trim().split('\n').filter(Boolean).flatMap(line=>{const [name,oid,peeled,type,peeledType]=line.split(SEP);return (type==='commit'||peeledType==='commit')?[{name,oid:peeled||oid,annotated:type==='tag'}]:[];});
      if(op==='stashes')return stashes(repo);
      if(op==='graph')return graph(repo,query.get('refs'),query.get('path')||undefined);
      if(op==='status')return status(repo,query.get('ignored')==='1');
      if(op==='files')return files(repo,query);
      if(op==='diff')return diff(repo,query);
      if(op==='commit-message')return {message:run(repo,['show','-s','--format=%B',commit(repo,query.get('ref')||'HEAD')])};
      fail('Unknown endpoint.',404);
    }
    if(method!=='POST')fail('Method not allowed.',405);
    if(op==='tag'){
      const name=str(body.name,'tag name').trim();if(name.startsWith('-'))fail('Tag names cannot start with a dash.');run(repo,['check-ref-format','refs/tags/'+name]);
      const target=commit(repo,body.ref),message=typeof body.message==='string'?body.message.trim():'';
      run(repo,['tag','--no-sign',...(message?['-a','-m',message]:[]),'--',name,target]);
      return {ok:true,message:'Tag '+name+' created locally.'};
    }
    else if(op==='stage')run(repo,['add','--',...selectedPaths(repo,body)]);
    else if(op==='unstage'){const paths=selectedPaths(repo,body);if(head(repo))run(repo,['restore','--staged','--',...paths]);else run(repo,['rm','--cached','-r','--',...paths]);}
    else if(op==='continue-cherry-pick'||op==='abort-cherry-pick'){
      const state=cherryState(repo);if(!state.active)fail('No cherry-pick is in progress.');
      if(op==='abort-cherry-pick'){
        run(repo,['reset','--merge',state.originalHead]);run(repo,['cherry-pick','--quit'],{allow:true});clearCherry(repo);
        return {ok:true,message:'Cherry-pick aborted.'};
      }
      if(status(repo).some(file=>file.conflicted))fail('Resolve and stage conflicted files before completing the cherry-pick.');
      run(repo,['cherry-pick','--quit']);clearCherry(repo);
      return {ok:true,message:'Cherry-pick complete. Changes remain staged; no commit was created.'};
    }
    else if(op==='cherry-pick'){
      if(mergeState(repo).active||rebaseState(repo).active)fail('Complete or abort the current operation first.');
      if(summary(repo).branch==='(detached)')fail('Create or check out a branch before cherry-picking.');
      if(status(repo).length)fail('Commit or stash working-tree changes before cherry-picking.');
      const source=commit(repo,body.ref),parents=run(repo,['rev-list','--parents','-n','1',source]).trim().split(/\s+/).slice(1);
      if(parents.length>1)fail('Cherry-picking merge commits is not supported.');
      const message=run(repo,['show','-s','--format=%B',source]).trim();
      if(body.paths!==undefined){
        const paths=selectedPaths(repo,body),changed=nameStatus(repo,['diff-tree','--root','--no-commit-id','--name-status','-r','-z','-M',source,'--']);
        const expanded=new Set();
        for(const file of paths){const change=changed.find(change=>change.path===file||change.oldPath===file);if(!change)fail('Selected file has no change in this commit: '+file);expanded.add(change.path);if(change.oldPath)expanded.add(change.oldPath);}
        const patch=run(repo,['diff-tree','--root','--no-commit-id','-r','-p','--binary','--full-index','--no-ext-diff','--no-textconv','--no-renames',source,'--',...expanded],{binary:true});
        if(!patch.length)fail('No changes to apply.');
        run(repo,['apply','--check','--index','--binary','-'],{input:patch});
        run(repo,['apply','--index','--binary','-'],{input:patch});
        return {ok:true,cherryPrepared:true,commitMessage:message,message:'Selected changes applied and staged. No commit was created.'};
      }
      const state={originalHead:head(repo),source,message};save(cherryFile(repo),state);
      try{run(repo,['cherry-pick','--no-commit',source]);}
      catch(error){
        if(status(repo).some(file=>file.conflicted))return {ok:true,cherryPrepared:true,commitMessage:message,message:'Cherry-pick paused. Resolve and stage conflicts, then complete the cherry-pick without committing.'};
        clearCherry(repo);throw error;
      }
      clearCherry(repo);
      return {ok:true,cherryPrepared:true,commitMessage:message,message:'Changes applied and staged. No commit was created.'};
    }
    else if(op==='restore-snapshot'){
      if(mergeState(repo).active||rebaseState(repo).active)fail('Complete or abort the current operation before restoring a snapshot.');
      if(summary(repo).branch==='(detached)')fail('Create or check out a branch before restoring a snapshot.');
      if(status(repo).length)fail('Commit or stash working-tree changes, including untracked files, before restoring a snapshot.');
      const source=commit(repo,body.ref);
      const targets=run(repo,['ls-tree','-r','--name-only','-z',source]).split('\0').filter(Boolean);
      const ignored=run(repo,['ls-files','--others','--ignored','--exclude-standard','-z']).split('\0').filter(Boolean);
      const normalize=value=>process.platform==='win32'?value.toLowerCase():value;
      const targetSet=new Set(targets.map(normalize)),targetParents=new Set();
      for(const target of targetSet){const parts=target.split('/');while(parts.length>1){parts.pop();targetParents.add(parts.join('/'));}}
      for(const file of ignored){const normalized=normalize(file),parts=normalized.split('/');let collision=targetSet.has(normalized)||targetParents.has(normalized);while(parts.length>1){parts.pop();if(targetSet.has(parts.join('/')))collision=true;}if(collision)fail('An ignored file would be overwritten: '+file+'. Move it aside before restoring.');}
      run(repo,['restore','--source='+source,'--worktree','--','.']);
      return {ok:true,message:'Snapshot restored to the working tree, unstaged. Commit it to record the restoration.'};
    }
    else if(op==='restore-version'){
      if(mergeState(repo).active||rebaseState(repo).active)fail('Complete or abort the current operation before restoring historical files.');
      const source=commit(repo,body.ref),paths=selectedPaths(repo,body);
      if(!head(repo))fail('A current commit is required to restore historical files.');
      run(repo,['restore','--source='+source,'--staged','--worktree','--',...paths]);
      run(repo,['reset','--quiet','HEAD','--',...paths]);
      return {ok:true,message:'Historical files restored to the working tree, unstaged.'};
    }
    else if(op==='discard'){
      const paths=selectedPaths(repo,body),entries=status(repo);const tracked=[],untracked=[],added=[];
      for(const file of paths){const entry=entries.find(e=>e.path===file);if(!entry)fail('Selected file is no longer modified. Refresh.');if(entry.untracked)untracked.push(file);else if(entry.index==='A')added.push(file);else tracked.push(file);}
      if(added.length){run(repo,['rm','--cached','-f','--',...added]);untracked.push(...added);}
      if(tracked.length){if(head(repo))run(repo,['restore','--source=HEAD','--staged','--worktree','--',...tracked]);else fail('In an unborn repository, unstage files before discarding them.');}
      if(untracked.length)run(repo,['clean','-fd','--',...untracked]);
    }
    else if(op==='commit'){if(rebaseState(repo).active)fail('Use Continue rebase instead of committing during a rebase.');if(mergeState(repo).active){if(body.amend)fail('Cannot amend during a merge.');if(status(repo).some(file=>file.conflicted))fail('Resolve and stage conflicted files before completing the merge.');}if(typeof body.message!=='string'||!body.message.trim())fail('Commit message is required.');run(repo,['commit',...(body.amend?['--amend']:[]),'-m',body.message]);}
    else if(op==='reset'){
      if(!['soft','hard'].includes(body.mode))fail('Choose squash (soft) or reset (hard).');
      if(mergeState(repo).active||rebaseState(repo).active)fail('Complete or abort the current operation before resetting.');
      if(summary(repo).branch==='(detached)')fail('Create or check out a branch before resetting.');
      const target=commit(repo,body.ref),original=head(repo);
      if(body.mode==='soft'){
        const base=run(repo,['merge-base',target,original],{allow:true}).trim();
        if(base!==target)fail('Squash since here requires a commit in the current branch history.');
      }
      run(repo,['reset','--'+body.mode,target]);
      return {ok:true,historyChanged:original!==target,message:body.mode==='soft'?'Squash prepared. Later changes remain staged; commit to combine them.':'Branch and tracked files reset to the selected commit.'};
    }
    else if(op==='rebase'||op==='continue-rebase'||op==='abort-rebase'){
      const before=rebaseState(repo);
      if(op==='abort-rebase'){
        if(!before.active)fail('No rebase is in progress.');run(repo,['rebase','--abort']);return {ok:true,message:'Rebase aborted.'};
      }
      let args,original;
      if(op==='rebase'){
        if(before.active||mergeState(repo).active)fail('Complete or abort the current operation first.');
        if(summary(repo).branch==='(detached)')fail('Create or check out a branch before rebasing.');
        if(status(repo).length)fail('Commit or stash working-tree changes before rebasing.');
        original=head(repo);args=['rebase',commit(repo,body.ref)];
      }else{
        if(!before.active)fail('No rebase is in progress.');
        if(status(repo).some(file=>file.conflicted))fail('Resolve and stage conflicted files before continuing the rebase.');
        original=before.originalHead;args=['rebase','--continue'];
      }
      try{run(repo,args,{editor:'true'});}catch(error){
        if(!rebaseState(repo).active)throw error;
        return {ok:true,rebasePaused:true,message:'Rebase paused. Resolve and stage conflicts, then Continue rebase. '+error.message};
      }
      return {ok:true,rebaseFinished:true,rewritten:head(repo)!==original,message:'Rebase completed.'};
    }
    else if(op==='merge'){
      if(rebaseState(repo).active)fail('Complete or abort the current rebase first.');
      if(summary(repo).branch==='(detached)')fail('Create or check out a branch before merging.');
      if(mergeState(repo).active)fail('Complete or abort the current merge first.');
      if(status(repo).length)fail('Commit or stash working-tree changes before merging.');
      const source=commit(repo,body.ref);
      const output=run(repo,['merge','--no-edit',source],{allow:true});
      const merging=mergeState(repo);
      if(merging.active)return {ok:true,message:'Merge in progress. Resolve conflicts, stage the files, then complete the merge.'};
      // Verify ancestry independently of Git output wording.
      const ancestor=run(repo,['merge-base',source,'HEAD'],{allow:true}).trim();
      if(ancestor!==source)fail(output.trim()||'Merge did not complete.');
      return {ok:true,message:output.trim()||'Merge completed.'};
    }
    else if(op==='abort-merge'){if(!mergeState(repo).active)fail('No merge is in progress.');run(repo,['merge','--abort']);}
    else if(op==='checkout'){
      if(rebaseState(repo).active||mergeState(repo).active)fail('Complete or abort the current operation before checking out.');
      if(body.detach){run(repo,['switch','--detach',commit(repo,body.ref)]);}
      else if(body.create){const name=branchName(repo,body.create);run(repo,['switch','-c',name,commit(repo,body.ref||'HEAD')]);}
      else {const branch=branches(repo).find(b=>b.name===body.ref||b.ref===body.ref);if(!branch)fail('Select a branch.');if(branch.remote){const name=branch.name.slice(branch.name.indexOf('/')+1),local=branches(repo).find(b=>!b.remote&&b.name===name);run(repo,local?['switch','--',local.name]:['switch','--track','-c',name,branch.name]);}else run(repo,['switch','--',branch.name]);}
    }
    else if(op==='catch-up'){
      const branch=branches(repo).find(b=>!b.remote&&b.name===body.branch);if(!branch||!branch.paired)fail('This branch has no paired remote branch. Fetch first.');
      if(branch.relation==='ahead'||branch.relation==='same')return {ok:true,message:'Local branch already contains the remote tip.'};
      const target=commit(repo,branch.paired);
      if(branch.current){if(status(repo).length)fail('Current branch must have a clean working tree.');if(branch.relation==='behind')run(repo,['merge','--ff-only',target]);else {if(!body.hard)fail('Branch diverged. Explicitly confirm the hard reset.');run(repo,['reset','--hard',target]);}}
      else {if(branch.relation==='diverged'&&!body.hard)fail('Branch diverged. Explicitly confirm replacement.');const worktrees=run(repo,['worktree','list','--porcelain']);if(worktrees.split('\n').includes('branch '+branch.ref))fail('Branch is checked out in another worktree.');run(repo,['update-ref',branch.ref,target,branch.oid]);}
    }
    else if(op==='delete-branch'){
      if(body.remote){const full=str(body.branch,'remote branch'),remote=remoteName(repo,full.split('/')[0]),name=full.slice(remote.length+1);branchName(repo,name);run(repo,['push',remote,'--delete',name]);}
      else run(repo,['branch',body.force?'-D':'-d','--',branchName(repo,body.branch)]);
    }
    else if(op==='stash'){
      if(body.action==='push'){const paths=body.paths?.length?selectedPaths(repo,body):[];run(repo,['stash','push','-u','-m',typeof body.message==='string'?body.message:'Git cockpit stash',...(paths.length?['--',...paths]:[])]);}
      else {const stash=stashRef(repo,body.ref);if(['apply','pop'].includes(body.action))run(repo,['stash',body.action,'--index',stash.ref]);else if(body.action==='drop')run(repo,['stash','drop',stash.ref]);else if(body.action==='rename'){str(body.message,'stash message');const index=Number(/\{(\d+)\}/.exec(stash.ref)[1]),count=stashes(repo).length;run(repo,['stash','store','-m',body.message,stash.oid]);if(stashes(repo).length>count)run(repo,['stash','drop',`stash@{${index+1}}`]);else{run(repo,['stash','drop',stash.ref]);try{run(repo,['stash','store','-m',body.message,stash.oid]);}catch(error){run(repo,['stash','store','-m',stash.message,stash.oid],{allow:true});throw error;}}}else fail('Unknown stash action.');}
    }
    else if(op==='fetch')run(repo,['fetch','--prune',remoteName(repo,body.remote)]);
    else if(op==='push'){const branch=summary(repo).branch;if(branch==='(detached)')fail('Cannot push a detached HEAD.');const remote=remoteName(repo,body.remote);run(repo,['push',...(body.force?['--force-with-lease']:[]),'-u',remote,`HEAD:refs/heads/${branch}`]);}
    else if(op==='bc'){const q=new URLSearchParams(body);return beyondCompare(repo,q);}
    else if(op==='command'){const args=parseCommand(str(body.command,'Git command'));const output=run(repo,args);return {ok:true,output};}
    else fail('Unknown endpoint.',404);
    return {ok:true};
  }
  return {dispatch,run,authorize:repoFor,subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);}};
}
const services=new Map();
export async function handle(req,res,{root,pathname,json}){
  try{
    if(!services.has(root))services.set(root,createGitService({stateDir:path.join(root,'.run')}));
    const query=new URL(req.url||'/','http://127.0.0.1').searchParams;
    const eventRoute=/^\/([^/]+)\/events$/.exec(pathname);
    if(req.method==='GET'&&eventRoute){
      const service=services.get(root),id=eventRoute[1];service.authorize(id,false,query.get('repoPath')||'');
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});res.write(': connected\n\n');
      const unsubscribe=service.subscribe(entry=>{if(entry.repoId===id&&!res.destroyed)res.write(`event: command\ndata: ${JSON.stringify(entry)}\n\n`);});
      const timer=setInterval(()=>{if(!res.destroyed)res.write(': keepalive\n\n');},15000);timer.unref();
      await new Promise(resolve=>res.once('close',resolve));unsubscribe();clearInterval(timer);return;
    }
    let body={};
    if(req.method==='POST'){
      let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>1024*1024)fail('Request body exceeds 1 MB.',413);}
      try{body=JSON.parse(text||'{}');}catch{fail('Invalid JSON body.');}if(!body||typeof body!=='object'||Array.isArray(body))fail('Expected an object body.');
    }
    if(req.method==='POST'&&pathname==='/browse'){json(200,await browseFolder({initialPath:typeof body.initialPath==='string'?hostPath(body.initialPath):''}));return;}
    const result=await services.get(root).dispatch(req.method,pathname,query,body);json(200,result);
  }catch(error){json(error.status||500,{error:error.message});}
}

