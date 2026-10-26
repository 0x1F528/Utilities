import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanConfiguredPath,hostPath,windowsAccessiblePath,windowsPath } from '../lib/git-api.js';

test('configured Beyond Compare paths drop pasted shell quotes',()=>{
  assert.equal(cleanConfiguredPath(`/mnt/c/'Program Files'/'Beyond Compare 4'/BCompare.exe`),'/mnt/c/Program Files/Beyond Compare 4/BCompare.exe');
  assert.equal(cleanConfiguredPath('  "C:\\Program Files\\Beyond Compare 4\\BCompare.exe"  '),'C:\\Program Files\\Beyond Compare 4\\BCompare.exe');
});

test('hostPath converts /mnt paths to Windows form',()=>{
  assert.equal(hostPath('/mnt/c/Users/you/repo','win32'),'C:\\Users\\you\\repo');
  assert.equal(hostPath('/mnt/d/Projects/app','win32'),'D:\\Projects\\app');
  assert.equal(windowsPath('/mnt/c/Program Files/Beyond Compare 4/BCompare.exe'),'C:\\Program Files\\Beyond Compare 4\\BCompare.exe');
});

test('hostPath converts Windows drive paths to WSL /mnt form',()=>{
  assert.equal(hostPath('C:\\Users\\you\\repo','linux'),'/mnt/c/Users/you/repo');
  assert.equal(hostPath('C:/Users/you/repo','linux'),'/mnt/c/Users/you/repo');
  assert.equal(hostPath('D:\\Program Files\\Beyond Compare 4\\BCompare.exe','linux'),'/mnt/d/Program Files/Beyond Compare 4/BCompare.exe');
});

test('hostPath leaves URLs, UNC, and native paths unchanged',()=>{
  assert.equal(hostPath('https://github.com/owner/repo.git','linux'),'https://github.com/owner/repo.git');
  assert.equal(hostPath('git@github.com:owner/repo.git','win32'),'git@github.com:owner/repo.git');
  assert.equal(hostPath('/home/krispy/projects/app','linux'),'/home/krispy/projects/app');
  assert.equal(hostPath('C:\\Users\\you\\repo','win32'),'C:\\Users\\you\\repo');
  assert.equal(hostPath('\\\\wsl$\\Ubuntu\\home\\krispy','linux'),'\\\\wsl$\\Ubuntu\\home\\krispy');
  assert.equal(hostPath('/mnt/c/Users/you','linux'),'/mnt/c/Users/you');
});

test('WSL paths convert to Windows-visible paths for Beyond Compare args',()=>{
  if(process.platform==='win32')return;
  assert.equal(windowsAccessiblePath(`/mnt/c/'Program Files'/Beyond Compare 4/BCompare.exe`),'C:\\Program Files\\Beyond Compare 4\\BCompare.exe');
  const home=windowsAccessiblePath(process.cwd());
  assert.match(home,/^\\\\wsl(\.localhost)?\\|^[A-Z]:\\/i);
});
