// Origin shares the local hierarchy; other remotes keep their own folder.
export function pairBranches(branches){
  const pairs=new Map();
  for(const branch of branches){
    const name=branch.remote?branch.name.replace(/^origin\//,''):branch.name;
    const key=branch.remote&&!branch.name.startsWith('origin/')?'remote:'+name:'shared:'+name;
    if(!pairs.has(key))pairs.set(key,{name,local:null,remote:null});
    pairs.get(key)[branch.remote?'remote':'local']=branch;
  }
  return [...pairs.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
export function pairState(pair){
  if(!pair.local)return 'remote-only';
  if(!pair.remote)return 'local-only';
  if(pair.local.oid===pair.remote.oid)return 'same';
  return pair.local.paired===pair.remote.name?pair.local.relation||'diverged':'diverged';
}

/** Folder trie for slash-delimited branch names (last segment is the leaf name). */
export function buildBranchFolderTree(pairs){
  const root={name:'',prefix:'',children:new Map(),pairs:[]};
  for(const pair of pairs){
    const parts=pair.name.split('/').filter(Boolean);
    let node=root;
    for(let i=0;i<parts.length-1;i++){
      const part=parts[i],prefix=node.prefix+part+'/';
      if(!node.children.has(part))node.children.set(part,{name:part,prefix,children:new Map(),pairs:[]});
      node=node.children.get(part);
    }
    node.pairs.push(pair);
  }
  return root;
}

/**
 * From a folder node, walk the single-child spine (no local pairs).
 * Returns {spine, tip} where tip is the first node with pairs or ≠1 child (may equal start).
 */
export function collectSpine(start){
  const spine=[];
  let node=start;
  while(node&&node.pairs.length===0&&node.children.size===1){
    spine.push(node);
    node=[...node.children.values()][0];
  }
  return {spine,tip:node||null};
}

export function markerKey(colors=[]){return [...colors].join('\0');}

/** Split a chain into runs that share identical markers (`markerFor(item)` → comparable key). */
export function elisionRuns(chain,markerFor=()=>''){
  if(!chain.length)return [];
  const runs=[];
  let run=[chain[0]],key=markerFor(chain[0]);
  for(let i=1;i<chain.length;i++){
    const next=markerFor(chain[i]);
    if(next===key)run.push(chain[i]);
    else{runs.push(run);run=[chain[i]];key=next;}
  }
  runs.push(run);
  return runs;
}

export function chainExpandKey(run){return run[0].prefix+'→'+run.at(-1).prefix;}
