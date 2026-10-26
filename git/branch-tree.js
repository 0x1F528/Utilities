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
