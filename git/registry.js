import {preferences,savePreferences} from './shared.js';

const STORAGE_KEY='git-registry';
const MIGRATED_KEY='git-registry-migrated';

export function loadRegistry(){
  const stored=preferences(STORAGE_KEY,{repos:[]});
  return {repos:Array.isArray(stored.repos)?stored.repos.filter(repo=>repo&&typeof repo.path==='string'&&typeof repo.id==='string'):[]};
}

export function saveRegistry(registry){
  savePreferences(STORAGE_KEY,{repos:registry.repos.map(repo=>({id:repo.id,path:repo.path,name:repo.name||repo.path,addedAt:repo.addedAt||new Date().toISOString()}))});
}

export function getRepo(id){
  return loadRegistry().repos.find(repo=>repo.id===id)||null;
}

export function upsertRepo(entry){
  const registry=loadRegistry();
  const repo={id:entry.id,path:entry.path,name:entry.name||entry.path,addedAt:entry.addedAt||new Date().toISOString()};
  const index=registry.repos.findIndex(item=>item.id===repo.id);
  if(index>=0)registry.repos[index]={...registry.repos[index],...repo};
  else registry.repos.push(repo);
  saveRegistry(registry);
  return registry.repos.find(item=>item.id===repo.id);
}

export function removeRepo(id){
  const registry=loadRegistry();
  registry.repos=registry.repos.filter(repo=>repo.id!==id);
  saveRegistry(registry);
}

export function removeRepos(ids){
  const drop=new Set(ids);
  const registry=loadRegistry();
  registry.repos=registry.repos.filter(repo=>!drop.has(repo.id));
  saveRegistry(registry);
}

export function renameRepo(id,name){
  const registry=loadRegistry();
  const repo=registry.repos.find(item=>item.id===id);
  if(!repo)throw new Error('Repository is not registered.');
  repo.name=name;
  saveRegistry(registry);
  return repo;
}

/** Import legacy `.run/git-registry.json` once into localStorage when the browser list is empty. */
export async function migrateLegacyRegistry(fetchLegacy){
  if(localStorage.getItem(MIGRATED_KEY)==='1')return loadRegistry();
  const current=loadRegistry();
  if(current.repos.length){localStorage.setItem(MIGRATED_KEY,'1');return current;}
  try{
    const legacy=await fetchLegacy();
    const repos=Array.isArray(legacy?.repos)?legacy.repos.filter(repo=>repo&&repo.id&&repo.path).map(repo=>({id:repo.id,path:repo.path,name:repo.name||repo.path,addedAt:repo.addedAt||new Date().toISOString()})):[];
    if(repos.length)saveRegistry({repos});
  }catch{/* Migration is best-effort. */}
  localStorage.setItem(MIGRATED_KEY,'1');
  return loadRegistry();
}
