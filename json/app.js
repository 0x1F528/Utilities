import { deepEqual,parseDocument,stringifyWithLineMap,remapPathLines,diffDocuments,mappedLine,differenceHighlights,preview } from './core.js';
const $=selector=>document.querySelector(selector), lineHeight=22, topPadding=12;
const panes={}; let differences=[],ignoreScrollSide=null,ignoreTimer,scrollFrame=0,pendingSide=null,toastTimer;
const measure=document.createElement('canvas').getContext('2d');
for(const id of ['a','b']) panes[id]={id,input:$(`#input-${id}`),gutter:$(`#gutter-${id}`),scroll:$(`#scroll-${id}`),stage:$(`#stage-${id}`),backdrop:$(`#backdrop-${id}`),meta:$(`#meta-${id}`),result:null,lastData:undefined,hasData:false,map:new Map(),diffLines:new Map(),anchor:null,timer:null,dirty:false};
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3500);}
function chrome(pane){
  const lines=pane.input.value.split('\n');
  measure.font=getComputedStyle(pane.input).font;
  const charWidth=measure.measureText('M').width;
  const longest=lines.reduce((max,line)=>Math.max(max,line.replace(/\t/g,'  ').length),0);
  pane.stage.style.width=`${Math.max(pane.scroll.clientWidth,Math.ceil(longest*charWidth)+34)}px`;
  pane.stage.style.height=`${Math.max(pane.scroll.clientHeight,lines.length*lineHeight+24)}px`;
  const gutter=document.createDocumentFragment(),backdrop=document.createDocumentFragment();
  lines.forEach((line,i)=>{
    const number=i+1,g=document.createElement('div'),b=document.createElement('div');g.textContent=number;b.textContent=line||' ';
    for(const element of [g,b]){if(pane.diffLines.has(number))element.classList.add('diff',pane.diffLines.get(number));if(pane.anchor===number)element.classList.add('anchor');if(pane.result&&!pane.result.ok&&pane.result.line===number)element.classList.add('error');}
    gutter.append(g);backdrop.append(b);
  });
  pane.gutter.replaceChildren(gutter);pane.backdrop.replaceChildren(backdrop);pane.gutter.scrollTop=pane.scroll.scrollTop;
}
function rewrite(pane,text){
  const input=pane.input,oldLength=input.value.length,start=input.selectionStart,end=input.selectionEnd,direction=input.selectionDirection,focused=document.activeElement===input;
  input.value=text;
  if(focused){const ratio=oldLength?text.length/oldLength:0;input.setSelectionRange(Math.min(text.length,Math.round(start*ratio)),Math.min(text.length,Math.round(end*ratio)),direction);}
}
function processPane(pane,{sort=false,initial=false}={}){
  clearTimeout(pane.timer);pane.dirty=false;
  let result=parseDocument(pane.input.value);
  if(result.ok){
    const changed=!pane.hasData||!deepEqual(result.data,pane.lastData);
    if(sort||(!initial&&changed)){
      rewrite(pane,stringifyWithLineMap(result.data,sort).text);
      result=parseDocument(pane.input.value);
    } else if(result.quotedText!==pane.input.value){rewrite(pane,result.quotedText);result=parseDocument(pane.input.value);}
    pane.lastData=result.data;pane.hasData=true;pane.map=remapPathLines(result.data,pane.input.value);
    pane.input.removeAttribute('aria-invalid');pane.meta.classList.remove('invalid');
    pane.meta.textContent=`Valid JSONC · ${pane.input.value.split('\n').length} lines · ${pane.map.size} path anchors${sort?' · keys sorted':''}`;
  }else{
    pane.map=new Map();pane.input.setAttribute('aria-invalid','true');pane.meta.classList.add('invalid');pane.meta.textContent=`Line ${result.line}: ${result.error}`;
  }
  pane.result=result;pane.anchor=null;chrome(pane);
}
function compare(){
  for(const pane of Object.values(panes))pane.diffLines.clear();
  const ready=Object.values(panes).every(p=>p.result?.ok&&!p.dirty);
  differences=ready?diffDocuments(panes.a.result.data,panes.b.result.data):[];
  if(ready){
    for(const pane of Object.values(panes))pane.diffLines=differenceHighlights(differences,pane.result.ranges,pane.id);
    $('#status').textContent=differences.length?`${differences.length} structural difference${differences.length===1?'':'s'}`:'Documents are equal — object key order is ignored.';
  } else $('#status').textContent=Object.values(panes).some(p=>p.dirty)?'Editing… comparison updates after a short pause.':'Comparison paused — fix the highlighted JSON error.';
  $('#diff-count').textContent=differences.length;
  const body=$('#diffs');body.replaceChildren();
  for(const diff of differences){
    const row=document.createElement('tr');row.className=`diff-row diff-${diff.kind}`;
    const path=document.createElement('td'),button=document.createElement('button');button.className='diff-path';button.textContent=diff.path;button.setAttribute('aria-label',`Jump to ${diff.path}, ${diff.kind}`);path.append(button);row.append(path);
    const kind=document.createElement('td'),badge=document.createElement('span');badge.className=`kind kind-${diff.kind}`;badge.textContent=diff.kind;kind.append(badge);row.append(kind);
    for(const id of ['a','b']){const cell=document.createElement('td');cell.textContent=preview(diff[id]);cell.title=preview(diff[id]);if(diff.kind==='missing'&&diff.missing!==id)cell.classList.add('additional');if(['value','type'].includes(diff.kind))cell.classList.add('changed');row.append(cell);}
    row.addEventListener('click',()=>jump(diff.path));body.append(row);
  }
  if(!differences.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=4;cell.className='empty';cell.textContent=ready?'No differences.':'Waiting for two valid documents.';row.append(cell);body.append(row);}
  for(const pane of Object.values(panes))chrome(pane);
  updateAnchorStatus();
}
function settle(){for(const pane of Object.values(panes))if(pane.dirty)processPane(pane);compare();}
function updateAnchorStatus(message){
  if(!$('#lock').checked){$('#anchor-status').textContent='Scroll independently · enable Lock scroll for path alignment';return;}
  const count=[...panes.a.map.keys()].filter(path=>panes.b.map.has(path)).length;
  $('#anchor-status').textContent=message||`Lock on · ${count} shared path anchors`;
}
function suppress(id){ignoreScrollSide=id;clearTimeout(ignoreTimer);ignoreTimer=setTimeout(()=>{ignoreScrollSide=null;},150);}
function center(pane,line){pane.scroll.scrollTop=Math.max(0,topPadding+(line-1)*lineHeight-pane.scroll.clientHeight/2+lineHeight/2);pane.gutter.scrollTop=pane.scroll.scrollTop;}
function jump(path){
  if(!$('#lock').checked)return toast('Enable Lock scroll to jump both editors to this difference.');
  settle();if(!panes.a.result?.ok||!panes.b.result?.ok)return;
  suppress('both');
  for(const pane of Object.values(panes)){pane.anchor=mappedLine(pane.map,path);center(pane,pane.anchor);chrome(pane);}
  updateAnchorStatus(`Path ${path} · A line ${panes.a.anchor} ↔ B line ${panes.b.anchor}`);
}
function align(id){
  if(!$('#lock').checked||Object.values(panes).some(p=>!p.result?.ok||p.dirty))return;
  const leader=panes[id],follower=panes[id==='a'?'b':'a'];
  const middle=Math.max(1,Math.round((leader.scroll.scrollTop+leader.scroll.clientHeight/2-topPadding)/lineHeight)+1);
  let nearest=null,distance=Infinity;
  for(const [path,line] of leader.map)if(follower.map.has(path)&&Math.abs(line-middle)<distance){nearest=path;distance=Math.abs(line-middle);}
  if(!nearest)return updateAnchorStatus('Lock on · no shared path anchors');
  leader.anchor=leader.map.get(nearest);follower.anchor=follower.map.get(nearest);suppress(follower.id);center(follower,follower.anchor);
  chrome(leader);chrome(follower);updateAnchorStatus(`Path ${nearest} · A line ${panes.a.anchor} ↔ B line ${panes.b.anchor}${distance?' · nearest anchor':''}`);
}
for(const pane of Object.values(panes)){
  pane.input.addEventListener('input',()=>{
    pane.dirty=true;pane.anchor=null;pane.diffLines.clear();pane.result=null;pane.input.removeAttribute('aria-invalid');pane.meta.classList.remove('invalid');pane.meta.textContent='Editing…';chrome(pane);compare();clearTimeout(pane.timer);pane.timer=setTimeout(()=>{processPane(pane);compare();},400);
  });
  pane.input.addEventListener('keydown',event=>{
    if(event.key==='Tab'){event.preventDefault();pane.input.setRangeText('  ',pane.input.selectionStart,pane.input.selectionEnd,'end');pane.input.dispatchEvent(new Event('input'));}
  });
  pane.scroll.addEventListener('scroll',()=>{
    pane.gutter.scrollTop=pane.scroll.scrollTop;
    if(ignoreScrollSide==='both'||ignoreScrollSide===pane.id)return;
    pendingSide=pane.id;if(!scrollFrame)scrollFrame=requestAnimationFrame(()=>{scrollFrame=0;align(pendingSide);});
  });
}
for(const button of document.querySelectorAll('[data-sort]'))button.addEventListener('click',()=>{
  const pane=panes[button.dataset.sort];processPane(pane,{sort:true});compare();if(!pane.result.ok)toast('Fix the JSON error before sorting.');
});
$('#sort-both').addEventListener('click',()=>{for(const pane of Object.values(panes))processPane(pane,{sort:true});compare();if($('#lock').checked)align('a');});
for(const button of document.querySelectorAll('[data-copy]'))button.addEventListener('click',async()=>{
  const input=panes[button.dataset.copy].input;
  try{await navigator.clipboard.writeText(input.value);toast('Copied document '+button.dataset.copy.toUpperCase()+'.');}catch{input.focus();input.select();toast('Clipboard unavailable. Text selected — press Ctrl+C (or ⌘C).');}
});
$('#lock').addEventListener('change',()=>{settle();for(const pane of Object.values(panes))pane.anchor=null;if($('#lock').checked)align('a');else{for(const pane of Object.values(panes))chrome(pane);updateAnchorStatus();}});
$('#swap').addEventListener('click',()=>{
  for(const pane of Object.values(panes))clearTimeout(pane.timer);
  const a=panes.a.input.value;panes.a.input.value=panes.b.input.value;panes.b.input.value=a;
  for(const pane of Object.values(panes)){pane.hasData=false;pane.scroll.scrollTop=0;processPane(pane,{initial:true});}compare();
});
function sample(){
  panes.a.input.value=`{\n  // Application configuration — comments are welcome\n  name: 'Workbench',\n  version: 1,\n  features: {\n    search: true,\n    themes: ['light', 'dark',],\n  },\n  users: [\n    { id: 1, name: 'Ada' },\n    { id: 2, name: 'Lin' },\n  ],\n  limits: { retries: 3, timeout: 1500 },\n  retired: null,\n}\n`;
  panes.b.input.value=stringifyWithLineMap({version:2,name:'Workbench',users:[{name:'Ada',id:1},{name:'Lin',id:2},{id:3,name:'Sam'}],features:{themes:['light','dark'],search:true},limits:{timeout:'1500',retries:3},region:'eu'}).text;
  for(const pane of Object.values(panes)){pane.hasData=false;pane.scroll.scrollTop=0;pane.scroll.scrollLeft=0;processPane(pane,{initial:true});}compare();
}
$('#sample').addEventListener('click',sample);
new ResizeObserver(()=>{for(const pane of Object.values(panes))chrome(pane);}).observe($('.editors'));
sample();

