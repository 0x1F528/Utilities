import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function launch(executable,args,options={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],...options});let stdout='',stderr='';
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
    const timer=setTimeout(()=>child.kill(),5*60*1000);timer.unref();
    child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
  });
}
export async function chooseFolder({initialPath='',platform=process.platform,run=launch}={}){
  if(typeof initialPath!=='string'||initialPath.includes('\0')||initialPath.length>16000)throw new Error('Invalid starting folder.');
  let start=path.isAbsolute(initialPath)?path.resolve(initialPath):os.homedir();
  while(!fs.existsSync(start)&&path.dirname(start)!==start)start=path.dirname(start);
  if(!fs.statSync(start).isDirectory())start=path.dirname(start);
  let result;
  if(platform==='win32'){
    const script=fs.readFileSync(fileURLToPath(new URL('./folder-picker.ps1',import.meta.url)),'utf8');
    result=await run(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-STA','-WindowStyle','Hidden','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:false,env:{...process.env,UTILITIES_PICKER_START:start}});
  }else if(platform==='darwin'){
    result=await run('osascript',['-e','on run argv\ntry\nreturn POSIX path of (choose folder with prompt "Select a repository folder" default location (POSIX file (item 1 of argv)))\non error number -128\nreturn ""\nend try\nend run',start]);
  }else{
    try{result=await run('zenity',['--file-selection','--directory','--title=Select a repository folder','--filename='+start+path.sep]);}
    catch(error){if(error.code!=='ENOENT')throw error;try{result=await run('kdialog',['--getexistingdirectory',start,'--title','Select a repository folder']);}catch(fallback){if(fallback.code==='ENOENT')throw new Error('Install zenity or kdialog for native folder browsing, or enter the path manually.');throw fallback;}}
    if(result.code===1)return {path:null};
  }
  if(result.code!==0)throw new Error(result.stderr.trim()||'The folder picker could not open or timed out. Enter the path manually.');
  return {path:result.stdout.replace(/^\uFEFF/,'').trim()||null};
}
let pending=false;
export async function browseFolder(options){
  if(pending){const error=new Error('A folder picker is already open.');error.status=409;throw error;}
  pending=true;try{return await chooseFolder(options);}finally{pending=false;}
}
