import {$,api,post,element,ask} from './shared.js';
import {loadRegistry,upsertRepo,removeRepo,removeRepos,migrateLegacyRegistry} from './registry.js';
import {loadSettings,saveSettings,migrateLegacySettings} from './settings-store.js';

const notice=message=>$('#notice').textContent=message;
function browseButton(input,onError,onSelected=()=>{}){
  const button=element('button','','Browse…');button.type='button';button.setAttribute('aria-label','Browse '+(input.getAttribute('aria-label')||'folder'));
  button.onclick=async()=>{button.disabled=true;const oldText=button.textContent;button.textContent='Choosing…';try{const result=await post('browse',{initialPath:input.value});if(result.path){input.value=result.path;onSelected(result.path);input.dispatchEvent(new Event('input',{bubbles:true}));}}catch(error){onError(error.message);}finally{button.disabled=false;button.textContent=oldText;}};
  return button;
}
function rememberRepo(repo){return upsertRepo(repo);}
function repositoryModal(mode){
  const cloning=mode==='clone',dialog=element('dialog'),form=element('form'),title=element('h2','',cloning?'Clone repository':'Create repository');
  form.append(title,element('p','hint',cloning?'Clone an existing repository into a new or empty folder. It will be registered automatically.':'Initialize Git in the selected folder, keeping existing files, and register it automatically. An existing repository will simply be registered.'));
  const status=element('p','hint');status.setAttribute('role','status');
  const fields={};
  const addField=(key,label,placeholder,value='',required=true)=>{const wrapper=element('label','',label),input=element('input');input.placeholder=placeholder;input.value=value;input.required=required;input.setAttribute('aria-label',label);if(key==='path'||key==='url'){const row=element('span','folder-input');row.append(input,browseButton(input,message=>{status.classList.add('error');status.textContent=message;}));wrapper.append(row);}else wrapper.append(input);form.append(wrapper);fields[key]=input;};
  if(cloning)addField('url','Repository URL or local source path','https://github.com/owner/repo.git or C:\\Projects\\source or /mnt/c/Projects/source');
  addField('path','Destination folder','C:\\Projects\\my-repository or /mnt/c/Projects/my-repository',cloning?'':$('#repo-path').value);
  if(!cloning)addField('branch','Initial branch','main','main');
  addField('name','Display name (optional)','Defaults to the folder name','',false);
  form.append(status);
  const controls=element('div','row'),cancel=element('button','','Cancel'),submit=element('button','primary',cloning?'Clone repository':'Create repository');cancel.type='button';submit.type='submit';controls.append(cancel,submit);form.append(controls);dialog.append(form);document.body.append(dialog);
  let running=false;cancel.onclick=()=>dialog.close();dialog.addEventListener('cancel',event=>{if(running)event.preventDefault();});dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  form.onsubmit=async event=>{
    event.preventDefault();if(running)return;running=true;submit.disabled=cancel.disabled=true;status.classList.remove('error');status.textContent=cloning?'Cloning… using your existing Git credentials.':'Creating repository…';
    try{const body=Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,input.value.trim()])),repo=await post(mode,body);rememberRepo(repo);dialog.close();await refresh();notice(`${cloning?'Cloned':'Created'} and registered ${repo.name} at ${repo.path}.`);}
    catch(error){status.classList.add('error');status.textContent=error.message;}
    finally{running=false;submit.disabled=cancel.disabled=false;}
  };
  dialog.showModal();(fields.url||fields.path).focus();
}
$('#create-repo').onclick=()=>repositoryModal('create');
$('#clone-repo').onclick=()=>repositoryModal('clone');
async function refresh(){
  try{
    const local=loadRegistry();
    const {repos}=local.repos.length?await post('status',{repos:local.repos},undefined,loadSettings()):{repos:[]};
    $('#repos').replaceChildren();
    for(const repo of repos){
      if(repo.available)rememberRepo(repo);
      const card=element('article','repo-card'),heading=element('h3'),link=element('a','',repo.name||repo.path);link.href=`repo.html?id=${encodeURIComponent(repo.id)}`;heading.append(link);const details=element('div','repo-details');details.append(heading,element('p','repo-path',repo.path));
      const info=element('p');info.append(element('span',repo.available?'tag':'tag dirty',repo.available?repo.branch:'Unavailable'));if(repo.dirty)info.append(' ',element('span','tag dirty',`${repo.files} changed`));details.append(info);
      details.append(element('p','hint',repo.available?`${repo.head?.slice(0,9)||'No commits yet'}${repo.upstream?' · '+repo.upstream:''} · ↑${repo.ahead||0} ↓${repo.behind||0}`:repo.error));
      const controls=element('div','row repo-actions'),open=element('button','','Open cockpit'),forget=element('button','','Forget');open.disabled=!repo.available;open.onclick=()=>window.open(link.href,'_blank','noopener');forget.onclick=async()=>{if(await ask('Forget repository?',{confirm:true,message:`Remove ${repo.name} from this list? The repository and its files remain on disk.`})){removeRepo(repo.id);refresh();}};controls.append(open,forget);card.append(details,controls);$('#repos').append(card);
    }
    if(!repos.length)$('#repos').append(element('div','empty','No repositories registered. Add an existing working-tree folder above.'));
    notice(`${repos.length} registered repositor${repos.length===1?'y':'ies'} (saved in this browser).`);
  }catch(error){notice(error.message);}
}
$('#register').onsubmit=async event=>{event.preventDefault();try{const repo=await post('add',{path:$('#repo-path').value});rememberRepo(repo);notice(`Registered ${repo.name}.`);$('#repo-path').value='';await refresh();}catch(error){notice(error.message);}};
$('#browse-repo').replaceWith(browseButton($('#repo-path'),notice,()=>notice('Folder selected. Register an existing repository, or click Create to initialize Git here.')));
$('#refresh').onclick=refresh;
$('#forget-unavailable').onclick=async()=>{
  try{
    const local=loadRegistry();
    if(!local.repos.length)return refresh();
    const {repos}=await post('status',{repos:local.repos},undefined,loadSettings());
    removeRepos(repos.filter(repo=>!repo.available).map(repo=>repo.id));
    await refresh();
  }catch(error){notice(error.message);}
};
function fillSettingsForm(){
  const settings=loadSettings();
  $('#bc-path').value=settings.beyondComparePath;
  $('#default-remote').value=settings.defaultRemote;
}
$('#settings').onsubmit=event=>{
  event.preventDefault();
  try{saveSettings({beyondComparePath:$('#bc-path').value,defaultRemote:$('#default-remote').value});notice('Settings saved in this browser.');}
  catch(error){notice(error.message);}
};
Promise.all([
  migrateLegacyRegistry(()=>api('legacy-registry')),
  migrateLegacySettings(()=>api('legacy-settings'))
]).then(()=>{fillSettingsForm();return refresh();}).catch(error=>notice(error.message));
