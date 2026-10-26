import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseFolder } from '../lib/folder-picker.js';
test('Windows picker passes paths as data, accepts Unicode selections, and handles cancellation',async()=>{
  const start=process.cwd();let captured;
  const picked=await chooseFolder({platform:'win32',initialPath:start,run:async(executable,args,options)=>{captured={executable,args,options};return {code:0,stdout:'C:\\Projects\\été\r\n',stderr:''};}});
  assert.equal(picked.path,'C:\\Projects\\été');assert.equal(captured.options.env.UTILITIES_PICKER_START,start);assert.ok(captured.args.includes('-STA'));assert.ok(captured.args.includes('-EncodedCommand'));
  assert.deepEqual(await chooseFolder({platform:'win32',run:async()=>({code:0,stdout:'',stderr:''})}),{path:null});
  await assert.rejects(()=>chooseFolder({initialPath:'bad\0path'}),/Invalid/);
});
test('Linux picker falls back to kdialog and treats cancellation as no change',async()=>{
  const calls=[];const result=await chooseFolder({platform:'linux',run:async(executable)=>{calls.push(executable);if(executable==='zenity'){const error=new Error('missing');error.code='ENOENT';throw error;}return {code:1,stdout:'',stderr:''};}});
  assert.deepEqual(calls,['zenity','kdialog']);assert.equal(result.path,null);
});
