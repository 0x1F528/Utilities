export const $=selector=>document.querySelector(selector);
export function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
export async function api(route,{method='GET',body,repoPath,settings}={}){
  const [pathname,search='']=String(route).split('?');
  const query=new URLSearchParams(search);
  if(repoPath)query.set('repoPath',repoPath);
  if(settings){
    if(typeof settings.beyondComparePath==='string')query.set('beyondComparePath',settings.beyondComparePath);
    if(typeof settings.defaultRemote==='string'&&settings.defaultRemote)query.set('defaultRemote',settings.defaultRemote);
  }
  const suffix=query.toString()?`?${query}`:'';
  const response=await fetch('/api/git/'+pathname+suffix,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  const value=await response.json();if(!response.ok)throw new Error(value.error||'Request failed.');return value;
}
export const post=(route,body={},repoPath,settings)=>api(route,{method:'POST',body,repoPath,settings});
export function preferences(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
export function savePreferences(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
export async function ask(title,{message='',label='Value',value='',confirm=false,multiline=false}={}){
  const dialog=element('dialog'),heading=element('h2','',title);dialog.append(heading);
  if(message)dialog.append(element('p','',message));
  let input;if(!confirm){const wrapper=element('label','',label);input=element(multiline?'textarea':'input');input.value=value;wrapper.append(input);dialog.append(wrapper);}
  const controls=element('div','row'),cancel=element('button','','Cancel'),submit=element('button',confirm?'danger':'primary',confirm?'Confirm':'OK');controls.append(cancel,submit);dialog.append(controls);document.body.append(dialog);
  return new Promise(resolve=>{let result=null;cancel.onclick=()=>dialog.close();submit.onclick=()=>{result=confirm?true:input.value;dialog.close();};dialog.addEventListener('close',()=>{dialog.remove();resolve(result);},{once:true});if(input)input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!multiline){event.preventDefault();submit.click();}});dialog.showModal();input?.focus();input?.select();});
}
