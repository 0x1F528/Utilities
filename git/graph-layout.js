const NS='http://www.w3.org/2000/svg';
export function layoutGraph(commits,{head,workingTree=false}={}){
  const lanes=[],rows=[];let nextPriority=1;
  const source=workingTree?[{oid:'@working-tree',parents:head?[head]:[],virtual:true},...commits]:commits;
  const freeLane=()=>{const index=lanes.findIndex(item=>item===null);return index<0?lanes.length:index;};
  for(const commit of source){
    let lane=lanes.findIndex(item=>item?.oid===commit.oid);
    if(lane<0){lane=freeLane();lanes[lane]={oid:commit.oid,priority:nextPriority++};}
    const lineage=lanes[lane],before=lanes.map(item=>item?.oid||null);
    lanes[lane]=null;
    for(const [index,parent] of commit.parents.entries()){
      const priority=index===0?lineage.priority:nextPriority++;
      const existing=lanes.findIndex(item=>item?.oid===parent);
      if(existing>=0){
        // The older priority keeps its physical lane; unrelated lanes never slide.
        if(priority<lanes[existing].priority){
          const target=index===0?lane:existing;
          lanes[existing]=null;lanes[target]={oid:parent,priority};
        }
      }else{
        const target=index===0?lane:freeLane();
        lanes[target]={oid:parent,priority};
      }
    }
    rows.push({commit,lane,priority:lineage.priority,before,after:lanes.map(item=>item?.oid||null)});
  }
  const laneCount=Math.max(5,...rows.map(row=>Math.max(row.before.length,row.after.length)));
  for(const row of rows)row.laneCount=laneCount;
  return rows;
}

export const BLUE='#0969da', GREY='#8c959f';
// Inputs must be in child-before-parent order, as supplied by git --date-order.
export function colorGraph(rows,seeds=[]){
  const nodes=new Map(rows.map(row=>[row.commit.oid,row.commit]));
  const order=new Map(rows.map((row,index)=>[row.commit.oid,index]));
  const ancestry=new Map();
  function ancestors(oid){
    if(ancestry.has(oid))return ancestry.get(oid);
    const found=new Set(),todo=[oid];
    while(todo.length){const next=todo.pop();if(found.has(next)||!nodes.has(next))continue;found.add(next);todo.push(...nodes.get(next).parents);}
    ancestry.set(oid,found);return found;
  }
  const reunions=new Map();
  for(const {commit} of rows)if(commit.parents.length>1){
    const sets=commit.parents.map(ancestors);
    const shared=[...sets[0]].filter(oid=>sets.every(set=>set.has(oid))).sort((a,b)=>order.get(a)-order.get(b));
    reunions.set(commit.oid,shared[0]||null);
  }
  const pending=new Map(),tips=new Map();
  for(const seed of seeds){if(!tips.has(seed.oid))tips.set(seed.oid,[]);tips.get(seed.oid).push(seed.color);}
  const shade=state=>{
    if(!state.shades.size)return state.base;
    const amount=Math.min(.32,state.shades.size*.16),hex=state.base.slice(1);
    return '#'+[0,2,4].map(i=>Math.round(parseInt(hex.slice(i,i+2),16)*(1-amount)+255*amount).toString(16).padStart(2,'0')).join('');
  };
  let tracks=[];
  return rows.map(row=>{
    const oid=row.commit.oid,incoming=pending.get(oid)||[],tipColors=tips.get(oid)||[];
    const contributions=[...incoming.map(state=>state.base),...tipColors];
    const nonGrey=[...new Set(contributions.filter(color=>color!==GREY))];
    const base=nonGrey.includes(BLUE)?BLUE:tipColors.length>1?GREY:nonGrey.length===1?nonGrey[0]:GREY;
    const shades=new Map();
    for(const state of incoming)if(state.base===base)for(const [split,end] of state.shades)if(end!==oid)shades.set(split,end);
    const state={base,shades},dotColor=shade(state);
    const parents=row.commit.parents.map(parent=>({parent,lane:row.after.indexOf(parent)})).sort((a,b)=>a.lane-b.lane);
    const edges=new Map();
    for(const [index,{parent}] of parents.entries()){
      const next={base,shades:new Map(shades)};
      if(index>0)next.shades.set(oid+':'+index,reunions.get(oid));
      if(!pending.has(parent))pending.set(parent,[]);pending.get(parent).push(next);
      edges.set(parent,{state:next,color:shade(next)});
    }
    const beforeColors=row.before.map((target,lane)=>tracks[lane]?.color||dotColor);
    const afterTracks=row.after.map((target,lane)=>{
      if(!target)return null;
      if(edges.has(target))return edges.get(target);
      const prior=row.before.indexOf(target);return prior>=0?tracks[prior]:null;
    });
    tracks=afterTracks;
    return {...row,hasIncoming:incoming.length>0,baseColor:base,dotColor,beforeColors,edgeColors:Object.fromEntries([...edges].map(([parent,edge])=>[parent,edge.color]))};
  });
}
export function graphSVG(row,currentHead){
  const svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox','0 0 105 36');svg.setAttribute('aria-hidden','true');
  const laneCount=(row.laneCount||Math.max(5,row.before.length,row.after.length));svg.setAttribute('viewBox','0 0 '+(laneCount*20+5)+' 36');svg.style&&(svg.style.width=(laneCount*20+5)+'px');const x=lane=>10+lane*20;
  function line(x1,y1,x2,y2,color){const p=document.createElementNS(NS,'path');p.setAttribute('d',`M${x1},${y1} C${x1},${(y1+y2)/2} ${x2},${(y1+y2)/2} ${x2},${y2}`);p.setAttribute('stroke',color);p.setAttribute('fill','none');p.setAttribute('stroke-width','1.6');svg.append(p);}
  row.before.forEach((oid,lane)=>{if(oid&&lane!==row.lane){const next=row.after.indexOf(oid);if(next>=0)line(x(lane),0,x(next),36,row.beforeColors[lane]);}});
  const color=row.dotColor;
  if(row.hasIncoming)line(x(row.lane),0,x(row.lane),18,row.beforeColors[row.lane]||color);
  for(const parent of row.commit.parents){const target=row.after.indexOf(parent);if(target>=0)line(x(row.lane),18,x(target),36,row.edgeColors[parent]);}
  const circle=document.createElementNS(NS,'circle');circle.setAttribute('cx',x(row.lane));circle.setAttribute('cy','18');circle.setAttribute('r',row.commit.oid===currentHead?'4.5':'3.5');circle.setAttribute('fill',color);svg.append(circle);return svg;
}
