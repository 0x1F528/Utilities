import {preferences,savePreferences} from './shared.js';

const STORAGE_KEY='git-settings';
const MIGRATED_KEY='git-settings-migrated';
const defaults={beyondComparePath:'',defaultRemote:'origin'};

export function loadSettings(){
  const stored=preferences(STORAGE_KEY,defaults);
  const defaultRemote=typeof stored.defaultRemote==='string'&&stored.defaultRemote.trim()&&!stored.defaultRemote.trim().startsWith('-')?stored.defaultRemote.trim():'origin';
  const beyondComparePath=typeof stored.beyondComparePath==='string'?stored.beyondComparePath:'';
  return {beyondComparePath,defaultRemote};
}

export function saveSettings(settings){
  const defaultRemote=typeof settings.defaultRemote==='string'?settings.defaultRemote.trim():'';
  if(!defaultRemote||defaultRemote.startsWith('-'))throw new Error('Enter a default remote name.');
  savePreferences(STORAGE_KEY,{
    beyondComparePath:typeof settings.beyondComparePath==='string'?settings.beyondComparePath:'',
    defaultRemote
  });
  return loadSettings();
}

/** Import legacy `.run/git-settings.json` once when browser settings were never migrated. */
export async function migrateLegacySettings(fetchLegacy){
  if(localStorage.getItem(MIGRATED_KEY)==='1')return loadSettings();
  const current=preferences(STORAGE_KEY,null);
  if(current&&(current.beyondComparePath||(current.defaultRemote&&current.defaultRemote!=='origin'))){
    localStorage.setItem(MIGRATED_KEY,'1');
    return loadSettings();
  }
  try{
    const legacy=await fetchLegacy();
    if(legacy&&typeof legacy==='object'){
      savePreferences(STORAGE_KEY,{
        beyondComparePath:typeof legacy.beyondComparePath==='string'?legacy.beyondComparePath:'',
        defaultRemote:typeof legacy.defaultRemote==='string'&&legacy.defaultRemote.trim()?legacy.defaultRemote.trim():'origin'
      });
    }
  }catch{/* Migration is best-effort. */}
  localStorage.setItem(MIGRATED_KEY,'1');
  return loadSettings();
}
