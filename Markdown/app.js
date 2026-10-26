import { codeRenderer,clampSplit } from './render.js';
const editor=document.querySelector('#editor'),preview=document.querySelector('#preview'),status=document.querySelector('#status');
const workspace=document.querySelector('#workspace'),splitter=document.querySelector('#splitter');
const mobile=matchMedia('(max-width:700px)');
const storageKey='markdown-split-pct';
let split=50,diagramTimer,revision=0,queue=Promise.resolve(),mermaid;
try{const saved=localStorage.getItem(storageKey);if(saved!==null)split=clampSplit(Number(saved));}catch{}
function applySplit(value,persist=true){
  split=clampSplit(value);workspace.style.setProperty('--split',`${split}%`);
  splitter.setAttribute('aria-valuenow',String(Math.round(split)));
  splitter.setAttribute('aria-valuetext',`${Math.round(split)}% editor, ${100-Math.round(split)}% preview`);
  splitter.setAttribute('aria-orientation',mobile.matches?'horizontal':'vertical');
  if(persist)try{localStorage.setItem(storageKey,String(split));}catch{}
}
applySplit(split,false);
let dragging=false;
function move(event){
  if(!dragging)return;
  const rect=workspace.getBoundingClientRect(),position=mobile.matches?event.clientY-rect.top:event.clientX-rect.left,size=mobile.matches?rect.height:rect.width;
  applySplit((position-5)/(size-10)*100);
}
splitter.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();dragging=true;splitter.setPointerCapture(event.pointerId);document.body.classList.add('resizing');splitter.focus();move(event);});
splitter.addEventListener('pointermove',move);
function stopDrag(){dragging=false;document.body.classList.remove('resizing');}
splitter.addEventListener('pointerup',stopDrag);splitter.addEventListener('pointercancel',stopDrag);splitter.addEventListener('lostpointercapture',stopDrag);
splitter.addEventListener('dblclick',()=>applySplit(50));
splitter.addEventListener('keydown',event=>{
  const step=event.shiftKey?5:2;
  if(!['Home','End','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
  event.preventDefault();applySplit(event.key==='Home'?15:event.key==='End'?85:split+(['ArrowLeft','ArrowUp'].includes(event.key)?-step:step));
});
mobile.addEventListener('change',()=>applySplit(split,false));
window.addEventListener('resize',()=>applySplit(split,false));
const demo=['# A small Markdown workbench','','Write **Markdown** on the left and see the result here. Your text stays in this tab.','','## A tiny flow','','```mermaid','flowchart LR','  A[Write Markdown] --> B[Preview instantly]','  B --> C{Add a diagram?}','  C -->|Yes| D[Use a Mermaid fence]','  C -->|No| E[Keep writing]','','```','','## A quick checklist','','- [x] Local Markdown preview','- [x] Mermaid diagrams','- [ ] Your next idea','','> Drag the divider or use arrow keys to resize.','','## A little structure','','| Feature | Behavior |','| --- | --- |','| Preview | Updates as you type |','| Divider | Drag or use arrow keys |','| Storage | Split position only |','','```js','const greeting = "Hello, Markdown!";','console.log(greeting);','```',''].join('\n');
editor.value=demo;
function render(){
  const current=++revision;clearTimeout(diagramTimer);
  document.querySelector('#editor-meta').textContent=`${editor.value.split('\n').length} lines · ${editor.value.length.toLocaleString()} characters`;
  if(!window.marked||!window.DOMPurify){status.textContent='Local libraries unavailable. Run npm install inside Markdown/ and reload.';return;}
  try{
    // Markdown shares the manager's origin: sanitize raw HTML before inserting.
    preview.innerHTML=window.DOMPurify.sanitize(window.marked.parse(editor.value),{USE_PROFILES:{html:true},FORBID_TAGS:['style','form','button','textarea','select']});
    for(const input of preview.querySelectorAll('input')){if(input.type==='checkbox')input.disabled=true;else input.remove();}
    for(const anchor of preview.querySelectorAll('a')){anchor.target='_blank';anchor.rel='noopener noreferrer';}
    const nodes=[...preview.querySelectorAll('.mermaid')];
    status.textContent=nodes.length?'Markdown ready · rendering diagrams…':'Preview updated';
    if(!nodes.length)return;
    diagramTimer=setTimeout(()=>{
      queue=queue.catch(()=>{}).then(async()=>{
        if(current!==revision||!mermaid)return;
        try{
          await mermaid.run({nodes});
          if(current===revision)status.textContent=`Preview updated · ${nodes.length} diagram${nodes.length===1?'':'s'}`;
        }catch(error){
          console.warn('Mermaid diagram is incomplete or invalid:',error);
          if(current===revision)status.textContent='Markdown ready · a diagram is incomplete';
        }
      });
    },200);
  }catch(error){console.warn('Markdown preview could not render:',error);status.textContent='Preview unavailable for this edit.';}
}
editor.addEventListener('input',render);
async function initialize(){
  try{
    if(!window.marked||!window.DOMPurify)throw new Error('Local Markdown dependencies are missing');
    const renderer=new window.marked.Renderer();renderer.code=codeRenderer;window.marked.use({renderer,gfm:true});
    ({default:mermaid}=await import('./vendor/mermaid/mermaid.esm.min.mjs'));
    mermaid.initialize({startOnLoad:false,theme:'default',securityLevel:'strict',suppressErrorRendering:true});
    render();
  }catch(error){console.warn(error);status.textContent='Local libraries unavailable. Run npm install inside Markdown/ and reload.';}
}
initialize();

