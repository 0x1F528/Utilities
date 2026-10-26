
import {clamp,mapPoint,position,sunPosition,solarAltitude,validZone,validPlace,clockParts} from './clock.js';
const $=selector=>document.querySelector(selector),map=$('#map'),canvas=$('#world'),ctx=canvas.getContext('2d');
const storageKey='Hello:world-clock',W=1440,H=720;
let home=null,pins=[],land=null,homeMode=false,hoverPoint=null,edit=null,shadeMinute=-1,keyboard={lat:0,lon:0};
try{const stored=JSON.parse(localStorage.getItem(storageKey)||'{}');home=validPlace(stored.home)?stored.home:null;pins=Array.isArray(stored.pins)?stored.pins.filter(validPlace).slice(0,40).map((pin,index)=>({...pin,id:String(pin.id||index)})):[];}catch{$('#status').textContent='Saved clocks could not be read. You can still use the map.';}
const node=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
const coordinates=point=>Math.abs(point.lat).toFixed(1)+'°'+(point.lat<0?'S':'N')+' · '+Math.abs(point.lon).toFixed(1)+'°'+(point.lon<0?'W':'E');
function save(){try{localStorage.setItem(storageKey,JSON.stringify({home,pins}));$('#status').textContent='Clocks saved in this browser.';}catch{$('#status').textContent='Browser storage is unavailable; clocks will last for this session only.';}}
function zoneAt(point){try{const zone=window.tzlookup(point.lat,point.lon);return validZone(zone)?zone:'UTC';}catch{return 'UTC';}}
const base=document.createElement('canvas');base.width=W;base.height=H;const bc=base.getContext('2d');
const shade=document.createElement('canvas');shade.width=720;shade.height=360;const sc=shade.getContext('2d');
function buildMap(){
 bc.fillStyle='#b9d6e0';bc.fillRect(0,0,W,H);
 bc.strokeStyle='#8fb8c650';bc.lineWidth=1;
 for(let lon=-150;lon<180;lon+=30){const x=(lon+180)/360*W;bc.beginPath();bc.moveTo(x,0);bc.lineTo(x,H);bc.stroke();}
 for(let lat=-60;lat<=60;lat+=30){const y=(90-lat)/180*H;bc.beginPath();bc.moveTo(0,y);bc.lineTo(W,y);bc.stroke();}
 bc.fillStyle='#e2e8d6';bc.strokeStyle='#8eaba1';bc.lineWidth=.7;
 for(const feature of land.features){const geometry=feature.geometry,polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  for(const polygon of polygons){bc.beginPath();for(const ring of polygon){ring.forEach(([lon,lat],index)=>{const p=position({lon,lat});if(index)bc.lineTo(p.x*W,p.y*H);else bc.moveTo(p.x*W,p.y*H);});bc.closePath();}bc.fill('evenodd');bc.stroke();}
 }
 bc.fillStyle='#4a738680';bc.font='14px system-ui';bc.textAlign='center';for(let lon=-150;lon<180;lon+=30)bc.fillText(Math.abs(lon)+'°'+(lon<0?'W':lon>0?'E':''),(lon+180)/360*W,H-10);
}
function drawMap(now,force=false){
 if(!land)return;
 const minute=Math.floor(now.getTime()/60000);
 if(force||minute!==shadeMinute){
  shadeMinute=minute;const sun=sunPosition(now),pixels=sc.createImageData(shade.width,shade.height);
  for(let y=0;y<shade.height;y++)for(let x=0;x<shade.width;x++){
   const altitude=solarAltitude(90-(y+.5)/shade.height*180,(x+.5)/shade.width*360-180,sun),index=(y*shade.width+x)*4;
   pixels.data[index]=9;pixels.data[index+1]=25;pixels.data[index+2]=48;
   pixels.data[index+3]=Math.round(clamp((4-altitude)/16,0,1)*185);
  }sc.putImageData(pixels,0,0);
 }
 ctx.clearRect(0,0,W,H);ctx.drawImage(base,0,0);ctx.drawImage(shade,0,0,W,H);
 if(home){const x=position(home).x*W;ctx.strokeStyle='#d8444c';ctx.lineWidth=2.4;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
 const sun=sunPosition(now),p=position(sun);ctx.fillStyle='#fff1a0';ctx.strokeStyle='#ba965b';ctx.lineWidth=1;ctx.beginPath();ctx.arc(p.x*W,p.y*H,5,0,Math.PI*2);ctx.fill();ctx.stroke();
}
function setHomeMode(value){homeMode=value;$('#set-home').setAttribute('aria-pressed',String(value));$('#set-home').textContent=value?'Cancel':home?'Move home':'Set home';$('#map-instruction').textContent=value?'Click the map to set Home':'Hover for the time · Click to drop a pin';}
$('#set-home').onclick=()=>setHomeMode(!homeMode);
let dialogPoint;
function openPlace(point,type,id=null){
 if(type==='pin'&&!id&&pins.length>=40){$('#status').textContent='Remove a pin before adding another (40 maximum).';return;}
 dialogPoint={...point};edit={type,id};$('#remove-home').hidden=type!=='home'||!home;$('#place-title').textContent=type==='home'?'Set home':id?'Edit clock pin':'Add clock pin';$('#place-coordinates').textContent=coordinates(point);$('#place-zone').value=point.zone||zoneAt(point);$('#place-error').textContent='';previewZone();$('#place-dialog').showModal();$('#place-zone').focus();
}
function previewZone(){const zone=$('#place-zone').value.trim();$('#place-preview').textContent=validZone(zone)?clockParts(new Date(),zone).time+' · '+clockParts(new Date(),zone).date:'Enter a valid timezone.';}
$('#remove-home').onclick=()=>{home=null;$('#place-dialog').close();setHomeMode(false);save();renderPlaces();drawMap(new Date(),true);};
$('#place-zone').oninput=previewZone;$('#place-cancel').onclick=()=>$('#place-dialog').close();
$('#place-form').onsubmit=event=>{event.preventDefault();const zone=$('#place-zone').value.trim();if(!validZone(zone)){$('#place-error').textContent='Choose a valid timezone, such as Europe/Zurich or UTC.';return;}
 const point={lat:dialogPoint.lat,lon:dialogPoint.lon,zone};
 if(edit.type==='home')home=point;else if(edit.id){pins=pins.map(pin=>pin.id===edit.id?{...point,id:edit.id}:pin);}else pins.push({...point,id:crypto.randomUUID()});
 $('#place-dialog').close();setHomeMode(false);save();renderPlaces();drawMap(new Date(),true);
};
const zones=typeof Intl.supportedValuesOf==='function'?Intl.supportedValuesOf('timeZone'):['UTC',Intl.DateTimeFormat().resolvedOptions().timeZone,'Europe/London','Europe/Zurich','America/New_York','America/Los_Angeles','Asia/Tokyo','Asia/Kolkata','Australia/Sydney'];
for(const zone of new Set(['UTC',...zones])){const option=node('option');option.value=zone;$('#timezones').append(option);}
function renderPlaces(){
 $('#clocks').replaceChildren();$('#pin-layer').replaceChildren();$('#pin-count').textContent=pins.length;$('#empty').hidden=pins.length>0;
 function marker(point,index,isHome){const p=position(point),button=node('button','map-pin'+(isHome?' home':'')+(p.x>.8?' flip':''));button.style.left=(p.x*100)+'%';button.style.top=(clamp(p.y,.025,.975)*100)+'%';button.title=(isHome?'Home':point.zone)+' · '+coordinates(point);button.setAttribute('aria-label','Edit '+(isHome?'home':point.zone));const dot=node('span','dot'),label=node('span','pin-label');label.dataset.zone=point.zone;label.dataset.clock='time';if(!isHome)label.style.top=((index%3-1)*14-5)+'px';button.append(dot,label);button.onclick=event=>{event.stopPropagation();openPlace(point,isHome?'home':'pin',point.id);};$('#pin-layer').append(button);}
 if(home)marker(home,0,true);
 for(const [index,pin] of pins.entries()){
  marker(pin,index,false);const card=node('article','clock-card'),heading=node('div','clock-heading'),actions=node('div','clock-actions');
  heading.append(node('strong','',pin.zone));const change=node('button','','↗'),remove=node('button','','×');change.title='Edit timezone';change.setAttribute('aria-label','Edit '+pin.zone);remove.title='Remove pin';remove.setAttribute('aria-label','Remove '+pin.zone);change.onclick=()=>openPlace(pin,'pin',pin.id);remove.onclick=()=>{pins=pins.filter(item=>item.id!==pin.id);save();renderPlaces();};actions.append(change,remove);heading.append(actions);
  const time=node('div','clock-time'),date=node('div','clock-date');time.dataset.zone=date.dataset.zone=pin.zone;time.dataset.clock='time';date.dataset.clock='date';card.append(heading,time,date,node('div','clock-coords',coordinates(pin)));$('#clocks').append(card);
 }
 $('#home-zone').textContent=home?home.zone:'Choose your place on the map';$('#home-time').textContent='—';$('#home-date').textContent='Your red meridian starts here.';setHomeMode(homeMode);tick();
}
function tick(){
 const now=new Date(),utc=clockParts(now,'UTC');$('#utc').textContent=utc.time;$('#utc-date').textContent=utc.date;
 if(home){const clock=clockParts(now,home.zone);$('#home-time').textContent=clock.time;$('#home-date').textContent=clock.date+' · '+coordinates(home);}
 const cache=new Map();for(const el of document.querySelectorAll('[data-clock]')){const zone=el.dataset.zone;if(!cache.has(zone))cache.set(zone,clockParts(now,zone));el.textContent=cache.get(zone)[el.dataset.clock];}
 if(hoverPoint)updateHover(hoverPoint);drawMap(now);
}
function updateHover(point){const clock=clockParts(new Date(),point.zone);$('#hover-zone').textContent=point.zone;$('#hover-time').textContent=clock.time;$('#hover-date').textContent=clock.date;$('#hover-coordinates').textContent=coordinates(point);}
function hoverAt(point,x,y){point.zone=zoneAt(point);hoverPoint=point;keyboard={lat:point.lat,lon:point.lon};updateHover(point);const tooltip=$('#hover');tooltip.hidden=false;tooltip.style.left=clamp(x+15,6,map.clientWidth-tooltip.offsetWidth-6)+'px';tooltip.style.top=clamp(y+15,6,map.clientHeight-tooltip.offsetHeight-6)+'px';}
map.onpointermove=event=>{if(event.target.closest('.map-pin'))return;const r=map.getBoundingClientRect(),x=event.clientX-r.left,y=event.clientY-r.top;hoverAt(mapPoint(x,y,r.width,r.height),x,y);};
map.onpointerleave=()=>{hoverPoint=null;$('#hover').hidden=true;};
map.onclick=event=>{if(event.target.closest('.map-pin')||!land)return;const r=map.getBoundingClientRect(),point=mapPoint(event.clientX-r.left,event.clientY-r.top,r.width,r.height);openPlace(point,homeMode?'home':'pin');};
map.onkeydown=event=>{
 if(event.target!==map)return;
 if(event.key==='Escape'){setHomeMode(false);hoverPoint=null;$('#hover').hidden=true;return;}
 if(event.key.toLowerCase()==='h'){event.preventDefault();setHomeMode(!homeMode);return;}
 if(event.key==='Enter'&&land){event.preventDefault();openPlace(keyboard,homeMode?'home':'pin');return;}
 const steps={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]};if(!steps[event.key])return;
 event.preventDefault();const step=event.shiftKey?10:2;keyboard.lon=clamp(keyboard.lon+steps[event.key][0]*step,-179.99,179.99);keyboard.lat=clamp(keyboard.lat+steps[event.key][1]*step,-89.99,89.99);const p=position(keyboard);hoverAt({...keyboard},p.x*map.clientWidth,p.y*map.clientHeight);
};
try{const response=await fetch('vendor/land.json');if(!response.ok)throw new Error('Map asset unavailable');land=await response.json();buildMap();$('#loading').hidden=true;renderPlaces();}catch(error){$('#loading').textContent='Could not load the local map. Reload to try again.';$('#status').textContent=error.message;}
const timer=setInterval(tick,1000);window.addEventListener('pagehide',()=>clearInterval(timer));document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
