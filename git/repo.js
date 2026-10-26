import {summarizeFolders} from './folder-status.js';
import {StageQueue} from './stage-queue.js';
import {pairBranches,pairState} from './branch-tree.js';
import {$,api,post,element,ask,preferences,savePreferences} from './shared.js';
import {layoutGraph,colorGraph,graphSVG} from './graph-layout.js';
const id=new URLSearchParams(location.search).get('id'),prefKey='git-repo-'+id;
const prefs=preferences(prefKey,{refs:null,folders:{},colors:{},filter:'changed',force:false});prefs.folders||={};prefs.colors||={};
let summary,tagRows=[],branchRows=[],stashRows=[],commits=[],fileRows=[],selection={mode:'wip'},beforeStash=null,selectedFiles=new Set(),activeFile='',viewRevision=0,busy=false,logCursor=0,history=[],historyIndex=0;
let workToken=null,historyToken=null,activeDiffToken=null,lastHistoryCheck=0,refreshTask=null;
const stageOverrides=new Map();
const stageQueue=new StageQueue({
  send:({op,paths})=>post(route(op),{paths}),
  reconcile:()=>reconcileWorking(true),
  onState:()=>updateStageControls(),
  onError:error=>{stageOverrides.clear();workToken=null;feedback('Staging failed: '+error.message,true);}
});
const route=op=>`${id}/${op}`,remember=()=>savePreferences(prefKey,prefs);
const feedback=(message,error=false)=>{$('#feedback').textContent=message;$('#feedback').classList.toggle('error',error);};
const queryForSelection=()=>new URLSearchParams({...selection,staged:$('#diff-kind').value==='staged'?'1':'0',ignored:$('#filter-ignored').checked?'1':'0',tracked:$('#filter-tracked').checked?'1':'0'});
function setBusy(value,label='') {busy=value;$('#busy').textContent=value?label:'';document.body.classList.toggle('spinner',value);for(const button of document.querySelectorAll('#commit,#fetch,#push,#new-branch,#stash-all,#stage-all,#unstage-all,#discard,#stash-paths,#bc,#refresh,#command-form button:not([type="button"])'))button.disabled=value;updateTimeTravel();updateMerge();updateStageControls();}
async function action(op,body={},message=op){
  if(busy){feedback('Wait for the current Git operation to finish.');return;}setBusy(true,stageQueue.running?'Finishing staging…':`${message}…`);feedback(`${message}…`);
  try{if(!await stageQueue.whenIdle())return;const result=await post(route(op),body);feedback(result.message||`${message} completed.`);if((result.rebaseFinished&&result.rewritten)||result.historyChanged){prefs.force=true;$('#force').checked=true;remember();}await refresh();if(result.cherryPrepared){$('#message').value=result.commitMessage||'';$('#amend').checked=false;}return result;}
  catch(error){feedback(error.message,true);await refresh().catch(()=>{});}
  finally{setBusy(false);await pollLog();}
}
function appendCommand(entry){
  const log=$('#command-log'),atBottom=log.scrollHeight-log.scrollTop-log.clientHeight<40;
  let row=log.querySelector(`[data-command-id="${entry.id}"]`);if(!row){row=element('div','command');row.dataset.commandId=entry.id;log.append(row);}row.replaceChildren();
  const display=value=>String(value).replaceAll('\0','␀').replaceAll('\x1f',' │ ').replaceAll('\x1e','');
  row.append(element('div','cmd',`$ ${display(entry.command)}`),element('div','cwd',`${entry.time.slice(11,19)} · ${entry.cwd} · ${entry.phase==='dispatch'?'running…':`exit ${entry.status} · ${entry.duration} ms`}`));
  if(entry.stdout)row.append(element('div','',display(entry.stdout)));if(entry.stderr)row.append(element('div',entry.status?'bad':'',display(entry.stderr)));
  while(log.children.length>250)log.firstChild.remove();if(atBottom)log.scrollTop=log.scrollHeight;
}
async function pollLog(){
  if(!id)return;
  try{const result=await api(`commands?repo=${encodeURIComponent(id)}&since=${logCursor}`);logCursor=result.cursor;
    for(const entry of result.entries)appendCommand(entry);
  }catch{}
}
const menu=element('div','popover');menu.setAttribute('popover','auto');document.body.append(menu);
function showMenu(anchor,items,title){menu.replaceChildren();if(title)menu.append(element('p','',title));for(const item of items){const button=element('button',item.danger?'danger':'',item.label);button.disabled=!!item.disabled;button.onclick=()=>{menu.hidePopover();Promise.resolve().then(item.run).catch(error=>feedback(error.message,true));};menu.append(button);}if(!menu.matches(':popover-open'))menu.showPopover();const r=anchor.getBoundingClientRect();menu.style.left=`${Math.max(8,Math.min(r.left,innerWidth-menu.offsetWidth-8))}px`;menu.style.top=`${Math.max(8,Math.min(r.bottom+4,innerHeight-menu.offsetHeight-8))}px`;}
async function createBranch(ref='HEAD'){const name=await ask('Create and check out branch',{label:'Branch name',message:`Start at ${ref.slice(0,30)}.`,value:''});if(name?.trim())await action('checkout',{create:name.trim(),ref},'Create branch');}
function branchMenu(branch,anchor){
  const items=[{label:'Check out',run:()=>action('checkout',{ref:branch.ref},'Checkout')},{label:'Create branch here…',run:()=>createBranch(branch.oid)}];
  items.push({label:`Merge into ${summary?.branch==='(detached)'?'current branch':summary?.branch}`,disabled:busy||summary?.branch==='(detached)'||summary?.merge?.active||summary?.rebase?.active||branch.current,run:async()=>{const result=await action('merge',{ref:branch.ref},'Merge branch');if(result)await choose({mode:'wip'});}});
  items.push({label:'Rebase onto '+branch.name,disabled:busy||summary?.branch==='(detached)'||summary?.merge?.active||summary?.rebase?.active||branch.current,run:()=>startRebase(branch.ref)});
  if(!branch.remote&&branch.paired)items.push({label:`Catch up to ${branch.paired} (${branch.relation})`,run:async()=>{
    const hard=branch.relation==='diverged';if(hard&&!await ask('Replace diverged local branch?',{confirm:true,message:`Reset ${branch.name} to ${branch.paired}? Local-only commits will no longer belong to this branch. Current working tree must be clean.`}))return;
    await action('catch-up',{branch:branch.name,hard},'Catch up branch');
  }});
  items.push({label:branch.remote?'Delete remote branch…':'Delete local branch…',danger:true,run:async()=>{if(!await ask('Delete branch?',{confirm:true,message:`Delete ${branch.name}${branch.remote?' from the remote server':''}?`}))return;await action('delete-branch',{branch:branch.name,remote:branch.remote},'Delete branch');}});
  if(!branch.remote)items.push({label:'Force-delete local branch…',danger:true,run:async()=>{if(await ask('Force-delete local branch?',{confirm:true,message:`Delete ${branch.name} even if unmerged?`}))await action('delete-branch',{branch:branch.name,force:true},'Delete branch');}});
  showMenu(anchor,items,branch.name);
}
function branchColor(branch){
  if(branch.current||prefs.lockedBranchRefs?.includes(branch.ref))return '#0969da';
  if(prefs.colors[branch.ref]==='#0969da')delete prefs.colors[branch.ref];
  if(!prefs.colors[branch.ref]){const index=prefs.nextBranchColor||0;prefs.nextBranchColor=index+1;const palette=['#d32f2f','#2e7d32','#7b1fa2','#c65d00','#007f80','#c93285','#328bbd','#48a329','#967000','#ac7bce','#65402b'];prefs.colors[branch.ref]=palette[index%palette.length];}
  return prefs.colors[branch.ref];
}
function renderBranches(){
  const list=$('#branches');list.replaceChildren();if(prefs.branchColorVersion!==3){prefs.colors={};prefs.nextBranchColor=0;prefs.branchColorVersion=3;}
  if(prefs.refs!==null){const before=prefs.refs.length;prefs.refs=prefs.refs.filter(ref=>ref==='HEAD'||branchRows.some(branch=>branch.ref===ref));if(before&&!prefs.refs.length)prefs.refs=branchRows.filter(branch=>branch.current).map(branch=>branch.ref);}
  if(prefs.refs===null)prefs.refs=branchRows.filter(b=>b.current).map(b=>b.ref);if(!prefs.refs.length&&!branchRows.length)prefs.refs=['HEAD'];
  prefs.refs=[...new Set([...prefs.refs,...branchRows.filter(branch=>branch.current).map(branch=>branch.ref)])];
  const current=branchRows.find(branch=>branch.current);
  const currentPair=pairBranches(branchRows).find(pair=>pair.local?.current);
  const lockedRefs=current?[current.ref,...(currentPair&&pairState(currentPair)==='same'?[currentPair.remote.ref]:[])]:[];
  const oldLocked=new Set([...(prefs.lockedBranchRefs||[]),...Object.keys(prefs.colors).filter(ref=>prefs.colors[ref]==='#0969da')]);
  for(const ref of oldLocked)if(!lockedRefs.includes(ref)){prefs.refs=prefs.refs.filter(selected=>selected!==ref);delete prefs.colors[ref];}
  prefs.lockedBranchRefs=lockedRefs;
  for(const ref of prefs.refs){const branch=branchRows.find(branch=>branch.ref===ref);if(branch)branchColor(branch);}

  const pairs=pairBranches(branchRows);
  // Equal tips are one selectable entity, with a single shared color.
  for(const pair of pairs)if(pairState(pair)==='same'){
    const {local,remote}=pair;
    if(local.current||prefs.refs.includes(local.ref)||prefs.refs.includes(remote.ref)){
      prefs.refs=[...new Set([...prefs.refs,local.ref,remote.ref])];
      const color=local.current?'#0969da':prefs.colors[local.ref]||prefs.colors[remote.ref]||branchColor(local);
      prefs.colors[local.ref]=prefs.colors[remote.ref]=color;
    }
  }
  function addPair(pair,parent){
    const state=pairState(pair),primary=pair.local||pair.remote;
    const row=element('div','branch'+(pair.local?.current?' current':'')),boxes=element('div','branch-boxes');
    function control(branches,symbol,label){
      const present=branches.filter(Boolean),button=element('button','branch-box',symbol);
      const checked=present.length>0&&present.every(branch=>prefs.refs.includes(branch.ref));
      const locked=present.some(branch=>branch.current);
      button.disabled=!present.length||locked;button.setAttribute('aria-label',label);button.setAttribute('aria-pressed',String(checked));button.title=label+(locked?' · checked out':'');
      if(checked){button.style.background=branchColor(present.find(branch=>branch.current)||present[0]);button.style.color='#fff';}
      button.onclick=async()=>{
        const refs=new Set(prefs.refs);
        if(checked)for(const branch of present)refs.delete(branch.ref);
        else {for(const branch of present)delete prefs.colors[branch.ref];const color=branchColor(present[0]);for(const branch of present){refs.add(branch.ref);prefs.colors[branch.ref]=color;}}
        prefs.refs=[...refs];remember();renderBranches();await loadGraph();
      };
      boxes.append(button);
    }
    if(state==='same'){boxes.classList.add('equal');control([pair.remote,pair.local],'=','Show local and origin '+pair.name);}
    else {
      control([pair.remote],pair.remote?'x':'','Show remote '+pair.name);
      control([pair.local],pair.local?(state==='ahead'?'v':state==='behind'?'^':'x'):'','Show local '+pair.name);
    }
    const name=element('button','name',pair.name.split('/').at(-1)),more=element('button','menu-trigger','⋯');
    name.title=pair.name+' · '+state;name.onclick=()=>branchMenu(primary,name);name.oncontextmenu=event=>{event.preventDefault();branchMenu(primary,name);};
    if(prefs.refs.includes(primary.ref))name.style.color=branchColor(primary);
    more.setAttribute('aria-label','Actions for '+pair.name);more.onclick=()=>showMenu(more,[...(pair.local?[{label:'Local branch actions',run:()=>branchMenu(pair.local,more)}]:[]),...(pair.remote?[{label:'Remote branch actions',run:()=>branchMenu(pair.remote,more)}]:[])],pair.name);
    row.append(boxes,name,more);parent.append(row);
  }
  const folders=new Map();
  for(const pair of pairs){let parent=list,prefix='';for(const part of pair.name.split('/').slice(0,-1)){
    prefix+=part+'/';if(!folders.has(prefix)){const folder=element('details','branch-folder'),label=element('summary','',part);folder.open=prefs.branchFolders?.[prefix]!==false;folder.append(label);const key=prefix;folder.ontoggle=()=>{prefs.branchFolders||={};prefs.branchFolders[key]=folder.open;remember();};parent.append(folder);folders.set(prefix,folder);}parent=folders.get(prefix);
  }addPair(pair,parent);}

  remember();
}
function renderStashes(){
  $('#stashes').replaceChildren();
  for(const stash of stashRows){const wrap=element('div','row'),button=element('button','stash-item'+(selection.mode==='stash'&&selection.ref===stash.ref?' active':''),`${stash.ref} · ${stash.message}`),more=element('button','menu-trigger','⋯');button.style.flex='1';button.onclick=()=>{beforeStash=selection.mode==='stash'?beforeStash:{...selection};choose({mode:'stash',ref:stash.ref});};more.setAttribute('aria-label',`Actions for ${stash.ref}`);more.onclick=()=>showMenu(more,[...['apply','pop','drop'].map(op=>({label:op[0].toUpperCase()+op.slice(1),danger:op==='drop',run:async()=>{if(op==='drop'&&!await ask('Drop stash?',{confirm:true,message:`Permanently drop ${stash.ref}?`}))return;await action('stash',{action:op,ref:stash.ref},`Stash ${op}`);if(op==='pop'||op==='drop')await choose({mode:'wip'});}})),{label:'Rename…',run:async()=>{const message=await ask('Rename stash',{value:stash.message});if(message)await action('stash',{action:'rename',ref:stash.ref,message},'Rename stash');}}],stash.ref);wrap.append(button,more);$('#stashes').append(wrap);}
  if(!stashRows.length)$('#stashes').append(element('div','hint','No stashes.'));
}
async function loadGraph(){
  const refs=summary?.branch==='(detached)'?[...new Set([...prefs.refs,'HEAD'])]:prefs.refs;commits=refs.length?await api(route('graph')+'?refs='+encodeURIComponent(refs.join(','))):[];renderGraph();
}
function renderGraph(){
  const graph=$('#graph'),scroll=graph.scrollTop,hadFocus=graph.contains(document.activeElement);graph.replaceChildren();
  const seeds=[];if(summary?.branch==='(detached)'&&summary.head)seeds.push({oid:summary.head,color:'#0969da'});for(const pair of pairBranches(branchRows)){const selected=[pair.local,pair.remote].filter(branch=>branch&&prefs.refs.includes(branch.ref));if(pairState(pair)==='same'&&selected.length){const branch=selected.find(branch=>branch.current)||selected[0];seeds.push({oid:branch.oid,color:branchColor(branch)});}else for(const branch of selected)seeds.push({oid:branch.oid,color:branchColor(branch)});}if(summary)seeds.push({oid:'@working-tree',color:'#0969da'});remember();
  for(const rowData of colorGraph(layoutGraph(commits,{head:summary?.head,workingTree:!!summary}),seeds)){
    if(rowData.commit.virtual){const row=element('div','graph-row working-tree-row'+(selection.mode==='wip'?' active':''));const subject=element('div','subject working-tree-subject');subject.append(element('strong','',`Working tree · ${summary.files} files`),element('small','working-tree-branch',summary.rebase?.active?'Rebasing '+summary.rebase.branch:summary.branch==='(detached)'?'Detached head':summary.branch));row.append(graphSVG(rowData,summary?.head),subject);row.onclick=()=>choose({mode:'wip'});graph.append(row);continue;}
    const commit=rowData.commit,row=element('div','graph-row'+(selection.mode==='commit'&&selection.ref===commit.oid?' active':'')+(selection.mode==='range'&&[selection.from,selection.to].includes(commit.oid)?' range':''));row.append(graphSVG(rowData,summary?.head));
    const subject=element('div','subject');subject.title=commit.subject;
    for(const branch of branchRows.filter(b=>b.oid===commit.oid)){const label=element('span','refs'+(branch.current?'':' other'),branch.name);if(prefs.refs.includes(branch.ref)){label.style.color=branchColor(branch);label.style.border='1px solid '+branchColor(branch);}subject.append(label);}for(const tag of tagRows.filter(tag=>tag.oid===commit.oid)){const badge=element('span','refs tag-ref',tag.name);badge.title=(tag.annotated?'Annotated tag: ':'Tag: ')+tag.name;subject.append(badge);}subject.append(document.createTextNode(commit.subject));
    row.append(subject,element('span','hash',commit.oid.slice(0,8)),element('span','author',commit.author),element('span','date',commit.date.slice(0,10)));row.title=`${commit.oid}\n${commit.author} · ${commit.date}`;
    row.onclick=event=>{if((event.shiftKey||event.ctrlKey||event.metaKey)&&['commit','range'].includes(selection.mode)){const from=selection.ref||selection.from;choose(from===commit.oid?{mode:'commit',ref:commit.oid}:{mode:'range',from,to:commit.oid});}else choose(selection.mode==='commit'&&selection.ref===commit.oid?{mode:'wip'}:{mode:'commit',ref:commit.oid});};
    row.oncontextmenu=event=>{event.preventDefault();showMenu(row,[{label:'Create Branch',run:()=>createBranch(commit.oid)},{label:'Tag',disabled:busy,run:()=>tagCommit(commit.oid)},{label:'Check out',run:()=>checkoutCommit(commit.oid)},{label:`Merge into ${summary?.branch==='(detached)'?'current branch':summary?.branch}`,disabled:busy||summary?.branch==='(detached)'||summary?.merge?.active||summary?.rebase?.active||commit.oid===summary?.head,run:async()=>{const result=await action('merge',{ref:commit.oid},'Merge commit');if(result)await choose({mode:'wip'});}},{label:'Rebase onto this commit',disabled:busy||summary?.branch==='(detached)'||summary?.merge?.active||summary?.rebase?.active||commit.oid===summary?.head,run:()=>startRebase(commit.oid)},{label:'Cherry-pick',disabled:busy||summary?.branch==='(detached)'||summary?.merge?.active||summary?.rebase?.active||summary?.cherry?.active||commit.parents.length>1,run:()=>pickChanges(commit.oid)},{label:'Restore working tree from here',disabled:busy||summary?.branch==='(detached)'||summary?.merge?.active||summary?.rebase?.active,run:()=>restoreSnapshot(commit.oid)},...['soft','hard'].map(mode=>({label:mode==='soft'?'Squash since here':'Reset to here',danger:true,disabled:busy||summary?.branch==='(detached)'||summary?.merge?.active||summary?.rebase?.active,run:()=>resetCommit(commit.oid,mode)}))],commit.oid.slice(0,10));};graph.append(row);
  }
  if(!commits.length)graph.append(element('div','empty',summary?.head?'No graph refs selected. Check branches on the left.':'No commits yet. Stage files and create your first commit.'));
  graph.scrollTop=scroll;if(hadFocus){const active=graph.querySelector('.graph-row.active,.graph-row.range');if(active){active.tabIndex=0;active.focus({preventScroll:true});}}
}
async function choose(next){selection=next;activeFile='';selectedFiles.clear();renderGraph();renderStashes();await loadFiles();}
async function loadFiles(){
  const rev=++viewRevision,q=queryForSelection();
  const result=selection.mode==='wip'?await fetchWorking(false):await api(route('files')+'?'+q);if(rev!==viewRevision)return;const files=Array.isArray(result)?result:result.files;if(!Array.isArray(result)&&!stageQueue.running)acceptWorking(result);fileRows=files;applyStageOverrides();renderFiles();
  const wip=selection.mode==='wip';$('#compose-editor').hidden=!wip;$('#file-actions').hidden=!wip;$('#historical-message').hidden=wip;$('#diff-kind').hidden=!wip;
  const label=wip?'Working tree':selection.mode==='commit'?`Commit ${selection.ref.slice(0,8)}`:selection.mode==='stash'?selection.ref:`${selection.from.slice(0,8)} → ${selection.to.slice(0,8)}`;$('#selection-meta').textContent=label;$('#files-title').textContent=label;
  if(!wip){const ref=selection.ref||selection.to;const message=await api(route('commit-message')+'?ref='+encodeURIComponent(ref));if(rev===viewRevision)$('#historical-message').textContent=message.message;}
  if(activeFile&&files.some(f=>f.path===activeFile))await showDiff(activeFile,{auto:true});else clearFileDiff();
}
function renderFiles(){
  const root=$('#files'),focused=document.activeElement.closest?.('.file'),focusPath=focused?.querySelector('.path')?.title;root.replaceChildren();let files=fileRows;
  if(selection.mode==='wip'){
    files=files.filter(f=>f.ignored?$('#filter-ignored').checked:f.untracked?$('#filter-untracked').checked:$('#filter-tracked').checked);
  }
  const search=$('#path-filter').value.toLowerCase();files=files.filter(f=>f.path.toLowerCase().includes(search));
  const tree={files:[],folders:new Map()};
  for(const file of files){const parts=file.path.split('/');let node=tree;for(const name of parts.slice(0,-1)){if(!node.folders.has(name))node.folders.set(name,{files:[],folders:new Map()});node=node.folders.get(name);}node.files.push(file);}
  summarizeFolders(tree,selection.mode==='wip');
  function walk(node,container,prefix=''){
    for(const [name,child] of [...node.folders].sort(([a],[b])=>a.localeCompare(b))){const full=prefix+name+'/',details=element('details','folder'),label=element('summary','',name);
      const status=child.status,markers=element('span','folder-markers'),descriptions=[];
      label.classList.toggle('has-changes',status.changed);
      function dot(kind,description){const mark=element('span','folder-dot '+kind);mark.setAttribute('aria-hidden','true');markers.append(mark);descriptions.push(description);}
      if(status.conflicted)dot('conflicted','Unresolved conflicts');
      else {if(status.unstaged)dot('unstaged','Unstaged changes');if(status.staged)dot('staged','Staged changes');}
      if(markers.children.length)label.append(markers);
      label.title=name+(descriptions.length?' · '+descriptions.join(' · '):status.changed?' · Changed files':' · No changes');
      label.setAttribute('aria-label',label.title);
      details.open=prefs.folders[full]!==false;details.append(label);details.addEventListener('toggle',()=>{prefs.folders[full]=details.open;remember();});walk(child,details,full);container.append(details);}
    for(const file of node.files.sort((a,b)=>a.path.localeCompare(b.path))){const row=element('div','file file-'+fileCategory(file)+(file.path===activeFile?' active':'')+(selectedFiles.has(file.path)?' selected':'')),name=element('button','path',file.path.split('/').at(-1));name.title=file.path+' · '+fileStatus(file);row.dataset.path=file.path;row.title=name.title;name.onclick=async event=>{
      if(event.ctrlKey||event.metaKey){if(selectedFiles.has(file.path))selectedFiles.delete(file.path);else selectedFiles.add(file.path);renderFiles();feedback(`${selectedFiles.size} paths selected.`);return;}
      if(activeFile===file.path)clearFileDiff();else await showDiff(file.path,{auto:true});

    };row.append(name);
      if(selection.mode==='wip'&&!file.ignored){const stage=element('button','stage stage-toggle'+(file.staged?' staged':''),'s');stage.disabled=busy||(!stageOverrides.has(file.path)&&!file.staged&&!file.unstaged&&!file.untracked);stage.setAttribute('aria-pressed',String(!!file.staged));stage.title=stage.disabled?'Unchanged tracked file':file.staged&&!file.conflicted?'Unstage':'Stage';stage.setAttribute('aria-label',`${file.staged?'Unstage':'Stage'} ${file.path}`);stage.onclick=()=>queueStage([file.path],file.staged&&!file.conflicted?'unstage':'stage');row.prepend(stage);}row.onclick=event=>{if(event.target.closest('button'))return;name.dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:event.ctrlKey,metaKey:event.metaKey}));};row.oncontextmenu=event=>{event.preventDefault();fileMenu(file,row);};container.append(row);
    }
  }
  walk(tree,root);if(focusPath){const target=[...root.querySelectorAll('.path')].find(button=>button.title===focusPath);target?.focus({preventScroll:true});}if(!files.length)root.append(element('div','empty','No matching files.'));$('#files-title').title=`${files.length} files · Ctrl/Cmd+click selects paths`;
}
async function showDiff(file,{auto=false}={}){
  if(auto&&selection.mode==='wip'){const entry=fileRows.find(row=>row.path===file);if(entry?.staged&&!entry.unstaged)$('#diff-kind').value='staged';else if(entry&&!entry.staged)$('#diff-kind').value='unstaged';}
  activeFile=file;document.querySelector('.center-pane').classList.add('show-file-diff');renderFiles();const q=queryForSelection();q.set('path',file);
  const result=await api(route('diff')+'?'+q);if(activeFile!==file)return;
  $('#diff-title').textContent=file;$('#diff').replaceChildren();
  for(const text of result.text.split('\n'))$('#diff').append(element('span','diff-line'+(text.startsWith('+')&&!text.startsWith('+++')?' add':text.startsWith('-')&&!text.startsWith('---')?' remove':text.startsWith('@@')?' hunk':''),text||' '));
  if(!result.text)$('#diff').textContent='No diff in this mode. Try staged / unstaged.';
  if(result.truncated)$('#diff').append(element('span','diff-line hunk',`Preview capped at 200 KB (${result.bytes.toLocaleString()} bytes). Open Beyond Compare for full snapshots.`));
}
async function refresh(){
  if(refreshTask)return refreshTask;
  refreshTask=(async()=>{await stageQueue.whenIdle();await refreshAll();})().finally(()=>{refreshTask=null;});
  return refreshTask;
}
async function refreshAll(){
  if(!id)throw new Error('No repository id. Open a repository from the registry.');
  summary=await api(route('summary'));branchRows=await api(route('branches'));tagRows=await api(route('tags'));stashRows=await api(route('stashes'));
  $('#repo-title').textContent=summary.name;document.title=`${summary.name} · Git`;$('#repo-meta').textContent=`${summary.branch} · ${summary.head.slice(0,8)||'unborn'} · ${summary.path} · ↑${summary.ahead} ↓${summary.behind}`;
  updateTimeTravel();updateMerge();renderBranches();renderStashes();await loadGraph();if(selection.mode==='stash'&&!stashRows.some(s=>s.ref===selection.ref))selection={mode:'wip'};await loadFiles();await pollLog();const baseline=await api(route('watch-history')+'?fresh=1');historyToken=baseline.token;lastHistoryCheck=Date.now();
}
$('#refresh').onclick=()=>refresh().catch(e=>feedback(e.message,true));

$('#fetch').onclick=()=>action('fetch',{},'Fetch');
$('#force').checked=!!prefs.force;$('#force').onchange=()=>{prefs.force=$('#force').checked;remember();};
$('#push').onclick=async()=>{const force=$('#force').checked;const result=await action('push',{force},'Push current branch');if(result){prefs.force=false;$('#force').checked=false;remember();}};

async function stash(paths=[]){const message=await ask('Stash working changes',{label:'Stash message',message:paths.length?`${paths.length} selected paths. Includes untracked files.`:'All working changes, including untracked files.',value:'Git cockpit stash'});if(message!==null){await action('stash',{action:'push',paths,message},'Create stash');selectedFiles.clear();}}
$('#stash-all').onclick=()=>stash();$('#stash-paths').onclick=()=>{if(!selectedFiles.size)return feedback('Ctrl/Cmd+click paths to select files first.');stash([...selectedFiles]);};
$('#discard').onclick=()=>discardFiles([...selectedFiles]);
$('#stage-all').onclick=()=>{const paths=fileRows.filter(f=>!f.ignored&&(f.untracked||f.unstaged||f.conflicted)).map(f=>f.path);if(paths.length)queueStage(paths,'stage');};
$('#unstage-all').onclick=()=>{const paths=fileRows.filter(f=>f.staged).map(f=>f.path);if(paths.length)queueStage(paths,'unstage');};
$('#amend').onchange=async()=>{if($('#amend').checked){try{$('#message').value=(await api(route('commit-message'))).message.trim();}catch(e){feedback(e.message,true);}}};
$('#commit').onclick=async()=>{const amend=$('#amend').checked,result=await action('commit',{message:$('#message').value,amend},amend?'Amend commit':summary?.merge?.active?'Complete merge':'Commit');if(result){$('#message').value='';$('#amend').checked=false;if(amend){prefs.force=true;$('#force').checked=true;remember();}}};
for(const category of ['tracked','untracked','ignored']){const check=$('#filter-'+category);check.checked=prefs.fileFilters?.[category]??(category!=='ignored');check.onchange=()=>{prefs.fileFilters=Object.fromEntries(['tracked','untracked','ignored'].map(name=>[name,$('#filter-'+name).checked]));remember();clearFileDiff();loadFiles().catch(e=>feedback(e.message,true));};}$('#path-filter').oninput=()=>{clearFileDiff();renderFiles();};
$('#diff-kind').value=prefs.staged?'staged':'unstaged';$('#diff-kind').onchange=()=>{prefs.staged=$('#diff-kind').value==='staged';remember();if(activeFile)showDiff(activeFile).catch(e=>feedback(e.message,true));};
$('#sort-tree').onclick=()=>{const close=[...$('#files').querySelectorAll('details')].some(d=>d.open);for(const detail of $('#files').querySelectorAll('details'))detail.open=!close;};
$('#bc').onclick=async()=>{if(!activeFile)return feedback('Select a file first.');await action('bc',Object.fromEntries(new URLSearchParams({...Object.fromEntries(queryForSelection()),path:activeFile})),'Launch Beyond Compare');};
$('#command-form').onsubmit=async event=>{event.preventDefault();const command=$('#command').value.trim();if(!command||busy)return;history.push(command);historyIndex=history.length;$('#command').value='';await action('command',{command},'Run Git command');};
$('#command').onkeydown=event=>{if(['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();historyIndex=Math.max(0,Math.min(history.length,historyIndex+(event.key==='ArrowUp'?-1:1)));$('#command').value=history[historyIndex]||'';}};
$('#clear-log').onclick=()=>$('#command-log').replaceChildren();
document.addEventListener('keydown',event=>{if(event.key!=='Escape'||['INPUT','TEXTAREA'].includes(document.activeElement.tagName)||document.querySelector('dialog[open]'))return;if(selectedFiles.size){selectedFiles.clear();renderFiles();return;}if(selection.mode==='stash'&&beforeStash){const previous=beforeStash;beforeStash=null;choose(previous);}else choose({mode:'wip'});});
const events=id?new EventSource('/api/git/'+route('events')):null;
events?.addEventListener('command',event=>{try{appendCommand(JSON.parse(event.data));}catch{}});
try{await refresh();}catch(error){feedback(error.message,true);}
const timer=setInterval(()=>{if(!document.hidden&&!busy&&!stageQueue.running)pollLog();},15000);window.addEventListener('pagehide',()=>{clearInterval(timer);events?.close();});

// Resizable panes; keep each repository's preferred sizes.
const layout=document.querySelector('.repo-layout');
function applyPanelSizes(){
  layout.style.setProperty('--left-width',Math.max(130,Math.min(innerWidth*.4,prefs.leftWidth||220))+'px');
  layout.style.setProperty('--right-width',Math.max(230,Math.min(innerWidth*.45,prefs.rightWidth||320))+'px');
  document.body.style.setProperty('--console-height',(prefs.consoleHeight||230)+'px');
}
function consoleVisible(visible){prefs.consoleClosed=!visible;$('#console').hidden=!visible;$('#resize-console').hidden=!visible;$('#open-console').hidden=visible;remember();}
$('#close-console').onclick=()=>consoleVisible(false);
$('#open-console').onclick=()=>{consoleVisible(true);$('#command').focus();};
function divider(selector,axis,resize){
  const handle=$(selector);
  handle.onpointerdown=event=>{
    if(event.button!==0)return;event.preventDefault();handle.setPointerCapture(event.pointerId);document.body.classList.add('resizing');
    let last=axis==='x'?event.clientX:event.clientY;
    handle.onpointermove=move=>{const next=axis==='x'?move.clientX:move.clientY;resize(next-last);last=next;};
    const finish=()=>{handle.onpointermove=null;document.body.classList.remove('resizing');remember();};
    handle.onpointerup=finish;handle.onpointercancel=finish;handle.onlostpointercapture=finish;
  };
  handle.onkeydown=event=>{const negative=axis==='x'?'ArrowLeft':'ArrowUp',positive=axis==='x'?'ArrowRight':'ArrowDown';if(event.key===negative||event.key===positive){event.preventDefault();resize((event.key===negative?-1:1)*(event.shiftKey?40:10));remember();}};
}
divider('#resize-left','x',delta=>{const max=Math.max(130,layout.clientWidth-document.querySelector('.files-pane').clientWidth-234);prefs.leftWidth=Math.max(130,Math.min(max,document.querySelector('.sidebar').clientWidth+delta));applyPanelSizes();});
divider('#resize-right','x',delta=>{const max=Math.max(230,layout.clientWidth-document.querySelector('.sidebar').clientWidth-234);prefs.rightWidth=Math.max(230,Math.min(max,document.querySelector('.files-pane').clientWidth-delta));applyPanelSizes();});
divider('#resize-console','y',delta=>{prefs.consoleHeight=Math.max(110,Math.min(innerHeight*.6,$('#console').clientHeight-delta));applyPanelSizes();});
applyPanelSizes();consoleVisible(!prefs.consoleClosed);window.addEventListener('resize',applyPanelSizes);

function fileCategory(file){if(file.conflicted)return 'conflict';if(file.ignored)return 'ignored';if(file.untracked||file.stashUntracked)return 'untracked';if(file.code.includes('D'))return 'deleted';if(file.index==='A'||file.code.trim()==='A')return 'added';if(file.code.trim())return 'changed';return 'tracked';}
function fileStatus(file){return {conflict:'Conflict — resolve and stage',ignored:'Ignored',untracked:'New',deleted:'Deleted',changed:'Changed',added:'Added',tracked:'Tracked'}[fileCategory(file)];}
function clearFileDiff(){activeFile='';document.querySelector('.center-pane').classList.remove('show-file-diff');$('#diff').replaceChildren();$('#diff-title').textContent='Select a file';renderFiles();}
document.addEventListener('click',event=>{if(!activeFile||event.target.closest('.file, .diff-header, .diff-view'))return;clearFileDiff();});

// Keyboard navigation follows the visible rows in each tree/list.
function visibleRows(root,selector){return [...root.querySelectorAll(selector)].filter(node=>{for(let parent=node.parentElement;parent&&parent!==root;parent=parent.parentElement){if(parent.tagName==='DETAILS'&&!parent.open&&!(node.tagName==='SUMMARY'&&node.parentElement===parent))return false;}return node.getClientRects().length>0;});}
function navigateList(root,selector,activate){
  root.addEventListener('keydown',event=>{
    if(!['ArrowUp','ArrowDown'].includes(event.key)||event.target.matches('input,textarea,select'))return;
    const rows=visibleRows(root,selector);if(!rows.length)return;
    const current=event.target.closest(selector),index=rows.indexOf(current);
    const next=rows[Math.max(0,Math.min(rows.length-1,index<0?0:index+(event.key==='ArrowDown'?1:-1)))];
    event.preventDefault();next.focus();next.scrollIntoView({block:'nearest'});if(activate&&next.tagName!=='SUMMARY'){const selected=next.classList.contains('graph-row')?next.classList.contains('active'):next.closest('.file')?.classList.contains('active');if(!selected)next.click();}
  });
}
navigateList($('#branches'),'summary, .branch .name',false);
navigateList($('#graph'),'.graph-row',true);
navigateList($('#files'),'summary, .file .path',true);
const keyboardRows=new MutationObserver(()=>{
  for(const row of $('#graph').querySelectorAll('.graph-row')){row.tabIndex=0;row.setAttribute('role','button');}
});
keyboardRows.observe($('#graph'),{childList:true});
for(const row of $('#graph').querySelectorAll('.graph-row')){row.tabIndex=0;row.setAttribute('role','button');}
$('#graph').addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.matches('.graph-row')){event.preventDefault();event.target.click();}});

// Working status is cheap and shared by the server; refs are checked less frequently.
let watchTimer,watchStopped=false,watchRunning=false;
function watchQuery(fresh=false){const q=new URLSearchParams({ignored:$('#filter-ignored').checked?'1':'0',tracked:$('#filter-tracked').checked?'1':'0'});if(fresh)q.set('fresh','1');if(activeFile&&selection.mode==='wip')q.set('path',activeFile);return q;}
function fetchWorking(fresh){return api(route('watch')+'?'+watchQuery(fresh));}
function acceptWorking(data){
  workToken=data.token;activeDiffToken=data.activeToken;
  if(summary){Object.assign(summary,{dirty:data.dirty,files:data.count,staged:data.staged,merge:data.merge,rebase:data.rebase,cherry:data.cherry});}
  updateTimeTravel();updateMerge();updateStageControls();
  const label=document.querySelector('.working-tree-subject strong');if(label)label.textContent='Working tree · '+data.count+' files';
}
async function reconcileWorking(fresh=false){
  const revision=stageQueue.revision,view=viewRevision,wasActive=activeFile,data=await fetchWorking(fresh);
  if(revision!==stageQueue.revision)return;
  const changed=workToken!==data.token,diffChanged=activeDiffToken!==data.activeToken;
  stageOverrides.clear();acceptWorking(data);
  if(view===viewRevision&&selection.mode==='wip'){
    fileRows=data.files;renderFiles();
    if(wasActive&&activeFile===wasActive&&(changed||diffChanged||fresh))await showDiff(wasActive,{auto:true});
  }
}
function applyStageOverrides(){for(const file of fileRows){if(!stageOverrides.has(file.path))continue;const staged=stageOverrides.get(file.path);file.staged=staged;if(staged){file.conflicted=false;file.index=file.untracked?'A':(file.index===' '?'M':file.index);file.untracked=false;file.unstaged=false;file.worktree=' ';file.code=file.index+' ';}else{file.unstaged=true;if(file.index==='A'){file.untracked=true;file.code='??';}else file.code=' M';file.index=' ';}}}
function queueStage(paths,op){
  if(busy||selection.mode!=='wip')return;
  for(const path of paths)stageOverrides.set(path,op==='stage');
  applyStageOverrides();renderFiles();stageQueue.enqueue({op,paths});
}
function updateStageControls(){
  const pending=stageQueue.running||stageQueue.pending>0;
  if(!busy)$('#busy').textContent=pending?'Staging '+(stageQueue.pending||'')+'…':'';
  if(pending)for(const selector of ['#commit','#amend'])$(selector).disabled=true;
  else if(!busy&&summary){$('#commit').disabled=summary.branch==='(detached)'||summary.rebase?.active||summary.cherry?.active||!!summary.merge?.conflicts;$('#amend').disabled=summary.branch==='(detached)'||summary.merge?.active||summary.rebase?.active||summary.cherry?.active;}
}
async function checkWorkingTree(){
  if(watchStopped||watchRunning)return;watchRunning=true;
  try{
    if(!document.hidden&&!busy&&!stageQueue.running&&!refreshTask){
      const revision=stageQueue.revision,view=viewRevision,data=await fetchWorking(false);
      if(!busy&&!stageQueue.running&&!refreshTask&&revision===stageQueue.revision&&view===viewRevision){
        if(workToken!==data.token){acceptWorking(data);if(selection.mode==='wip'){fileRows=data.files;renderFiles();if(activeFile)await showDiff(activeFile,{auto:true});}}
        else if(activeFile&&selection.mode==='wip'&&activeDiffToken!==data.activeToken){activeDiffToken=data.activeToken;await showDiff(activeFile,{auto:true});}
        if(Date.now()-lastHistoryCheck>15000&&!busy&&!stageQueue.running){
          const result=await api(route('watch-history'));lastHistoryCheck=Date.now();
          if(!busy&&!stageQueue.running&&!refreshTask&&revision===stageQueue.revision){if(historyToken!==null&&historyToken!==result.token)await refresh();else historyToken=result.token;}
        }
      }
    }
  }catch{/* Retry transient errors on the next poll. */}
  finally{watchRunning=false;if(!watchStopped)watchTimer=setTimeout(checkWorkingTree,2500);}
}
checkWorkingTree();
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!watchRunning){clearTimeout(watchTimer);checkWorkingTree();}});
window.addEventListener('pagehide',()=>{watchStopped=true;clearTimeout(watchTimer);});

async function checkoutCommit(ref){
  const result=await action('checkout',{ref,detach:true},'Checkout commit');
  if(result)await choose({mode:'wip'});
}
function updateTimeTravel(){
  const detached=summary?.branch==='(detached)';
  for(const selector of ['#commit','#amend','#message'])$(selector).disabled=busy||detached;
  $('#push').disabled=busy||detached;
}

var loadedMergeHead,loadedMergeMessage;
function updateMerge(){
  const merge=summary?.merge,active=!!merge?.active;
  let banner=$('#merge-status');
  if(!banner){banner=element('div','notice merge-status');banner.id='merge-status';document.querySelector('.compose').prepend(banner);}
  banner.hidden=!active;banner.replaceChildren();
  if(active){
    banner.append(element('div','',merge.conflicts?`Merge in progress · ${merge.conflicts} unresolved files. Resolve and stage them.`:'Merge ready to complete.'));
    const abort=element('button','danger','Abort merge');abort.disabled=busy;abort.onclick=()=>action('abort-merge',{},'Abort merge');banner.append(abort);
    if(loadedMergeHead!==merge.head){$('#message').value=merge.message;$('#amend').checked=false;loadedMergeHead=merge.head;loadedMergeMessage=merge.message;}
  }else {if(loadedMergeHead&&$('#message').value===loadedMergeMessage)$('#message').value='';loadedMergeHead=null;}
  $('#commit').textContent=active?'Complete merge':'Commit';
  $('#commit').disabled=busy||summary?.branch==='(detached)'||(active&&merge.conflicts>0);
  $('#amend').disabled=busy||active||summary?.branch==='(detached)';
  updateRebase();updateCherryPick();
}

async function startRebase(ref){const result=await action('rebase',{ref},'Rebase');if(result)await choose({mode:'wip'});}
function updateRebase(){
  const rebase=summary?.rebase,active=!!rebase?.active;
  let panel=$('#rebase-status');
  if(!panel){panel=element('div','notice merge-status');panel.id='rebase-status';document.querySelector('.compose').prepend(panel);}
  panel.hidden=!active;panel.replaceChildren();
  if(!active)return;
  panel.append(element('div','',`Rebasing ${rebase.branch}${rebase.step?' · '+rebase.step+'/'+rebase.total:''} · ${rebase.conflicts?rebase.conflicts+' unresolved files':'Ready to continue'}`));
  const next=element('button','primary','Continue rebase'),abort=element('button','danger','Abort rebase');
  next.disabled=busy||rebase.conflicts>0;abort.disabled=busy;
  next.onclick=()=>action('continue-rebase',{},'Continue rebase');abort.onclick=()=>action('abort-rebase',{},'Abort rebase');
  panel.append(next,abort);$('#commit').disabled=$('#amend').disabled=$('#message').disabled=true;
}

async function discardFiles(paths){
  if(!paths.length)return feedback('Ctrl/Cmd+click paths to select files first.');
  if(await ask('Discard changes?',{confirm:true,message:'Discard staged and unstaged changes in these files? Untracked files will be deleted.\n\n'+paths.join('\n')})){
    const result=await action('discard',{paths},'Discard changes');if(result){selectedFiles.clear();renderFiles();}
  }
}
function fileMenu(file,anchor){
  if(!selectedFiles.has(file.path)){selectedFiles.clear();selectedFiles.add(file.path);}
  const paths=[...selectedFiles],mode=selection.mode,ref=selection.ref;
  const items=[];
  if(mode==='wip')items.push({label:'Discard changes',danger:true,disabled:busy,run:()=>discardFiles(paths)});
  if(mode==='commit')items.push({label:'Restore this version',disabled:busy||summary?.merge?.active||summary?.rebase?.active,run:async()=>{
    if(!await ask('Restore this version?',{confirm:true,message:'Replace these files with their version at '+ref.slice(0,8)+'? Existing staged and unstaged edits will be replaced. The result will be left unstaged. A file deleted in that commit will be removed.\n\n'+paths.join('\n')}))return;
    const result=await action('restore-version',{ref,paths},'Restore file version');if(result)await choose({mode:'wip'});
  }});
  if(mode==='commit')items.push({label:'Cherry-pick',disabled:busy||summary?.branch==='(detached)'||summary?.merge?.active||summary?.rebase?.active||summary?.cherry?.active,run:()=>pickChanges(ref,paths)});
  if(items.length)showMenu(anchor,items,paths.length===1?paths[0]:paths.length+' selected files');
  // Keep the anchor mounted until the popover has been positioned.
  for(const row of $('#files').querySelectorAll('.file'))row.classList.toggle('selected',selectedFiles.has(row.dataset.path));
}

async function resetCommit(ref,mode){
  const soft=mode==='soft',title=soft?'Squash since here':'Reset to here';
  const message=soft
    ?'Move '+summary.branch+' to '+ref.slice(0,8)+'? Keep this commit; combine all later changes into your next commit. Working files and existing staging are preserved. No new commit is created yet.'
    :'Reset '+summary.branch+' to '+ref.slice(0,8)+'? Later commits will no longer belong to this branch. Staged and unstaged tracked-file changes will be discarded. Untracked files obstructing restored paths may also be deleted.';
  if(!await ask(title+'?',{confirm:true,message}))return;
  const result=await action('reset',{ref,mode},title);if(result){$('#amend').checked=false;await choose({mode:'wip'});}
}

async function restoreSnapshot(ref){
  if(!await ask('Restore working tree from here?',{confirm:true,message:'Replace the working-tree snapshot with '+ref.slice(0,8)+'? Files added after that commit will be removed; earlier files will be restored. HEAD and history stay unchanged. Changes remain unstaged for you to review and commit. A clean working tree is required.'}))return;
  const result=await action('restore-snapshot',{ref},'Restore working tree');
  if(result){$('#amend').checked=false;$('#message').value='Restore snapshot '+ref.slice(0,8);await choose({mode:'wip'});}
}

async function pickChanges(ref,paths){const result=await action('cherry-pick',{ref,...(paths?{paths}:{})},'Cherry-pick');if(result)await choose({mode:'wip'});}
function updateCherryPick(){
  const cherry=summary?.cherry,active=!!cherry?.active;
  let panel=$('#cherry-status');if(!panel){panel=element('div','notice merge-status');panel.id='cherry-status';document.querySelector('.compose').prepend(panel);}
  panel.hidden=!active;panel.replaceChildren();if(!active)return;
  panel.append(element('div','',cherry.conflicts?'Cherry-pick · '+cherry.conflicts+' unresolved files. Resolve and stage them.':'Cherry-pick ready to complete without committing.'));
  const next=element('button','primary','Complete cherry-pick'),abort=element('button','danger','Abort cherry-pick');
  next.disabled=busy||cherry.conflicts>0;abort.disabled=busy;
  next.onclick=()=>action('continue-cherry-pick',{},'Complete cherry-pick');abort.onclick=()=>action('abort-cherry-pick',{},'Abort cherry-pick');panel.append(next,abort);
  $('#commit').disabled=$('#amend').disabled=true;
}

function tagCommit(ref){
  const dialog=element('dialog'),form=element('form');form.append(element('h2','','Tag commit'),element('p','hint',ref.slice(0,12)+' · Created locally; not pushed automatically.'));
  const nameLabel=element('label','','Name'),name=element('input');name.required=true;name.placeholder='v1.0.0';nameLabel.append(name);
  const messageLabel=element('label','','Message (optional)'),message=element('textarea');message.placeholder='Leave empty for a lightweight tag';messageLabel.append(message);
  const status=element('p','error'),buttons=element('div','row'),cancel=element('button','','Cancel'),submit=element('button','primary','Create tag');cancel.type='button';submit.type='submit';buttons.append(cancel,submit);form.append(nameLabel,messageLabel,status,buttons);dialog.append(form);document.body.append(dialog);
  let running=false;cancel.onclick=()=>dialog.close();dialog.addEventListener('cancel',event=>{if(running)event.preventDefault();});dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  form.onsubmit=async event=>{event.preventDefault();if(running||busy)return;running=true;submit.disabled=cancel.disabled=true;
    const result=await action('tag',{ref,name:name.value.trim(),message:message.value},'Create tag');
    if(result)dialog.close();else status.textContent=$('#feedback').textContent;
    running=false;submit.disabled=cancel.disabled=false;
  };dialog.showModal();name.focus();
}
