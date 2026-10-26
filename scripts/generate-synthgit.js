import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

// Usage: node scripts/generate-synthgit.js <empty destination folder>
const destination=path.resolve(process.argv[2]||'');
if(!process.argv[2])throw new Error('Supply an empty destination folder.');
if(fs.existsSync(destination)&&fs.readdirSync(destination).length)throw new Error('Destination must be empty; no existing files will be replaced.');
fs.mkdirSync(destination,{recursive:true});
const git=(...args)=>execFileSync('git',args,{cwd:destination,encoding:'utf8',windowsHide:true,env:{...process.env,...dates},stdio:['ignore','pipe','pipe']}).trim();
let dates={},sequence=0;
const folders=['orchard','harbor','meadow'];
const nouns=['lantern','badger','willow','compass','otter','marble','raven','basket','cedar','pebble','falcon','ribbon'];
const write=(file,text)=>{const full=path.join(destination,file);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,text+'\n');};
const commit=(message,merge)=>{
  const stamp=new Date(Date.UTC(2026,8,1,9)+sequence++*3600000).toISOString();
  dates={GIT_AUTHOR_DATE:stamp,GIT_COMMITTER_DATE:stamp};
  git('add','--all');
  if(merge)git('merge','--no-ff',merge,'-m',message);
  else git('commit','-m',message);
};
git('init','-b','main');
// Identity and behavior are local to this disposable demonstration repository.
git('config','user.name','Synthetic Gardener');
git('config','user.email','synthgit@example.invalid');
git('config','core.autocrlf','false');
git('config','commit.gpgsign','false');
git('config','tag.gpgsign','false');
for(const [index,folder] of folders.entries())write(`${folder}/${nouns[index]}.txt`,`${folder}\n${nouns.join(' ')}`);
write('README.md','# Lantern orchard\n\nSynthetic Git history for exploring a browser Git cockpit.\n\nFolders: orchard, harbor, meadow. Branches are noun names.');
commit('Plant the orchard, harbor, and meadow');
for(let index=0;index<3;index++){
  write(`${folders[index]}/${nouns[index]}.txt`,`${nouns[index]}\n${nouns.slice(index,index+6).join('\n')}`);
  commit(`Arrange ${nouns[index]} in ${folders[index]}`);
}
const branchNames=['willow','otter','compass','raven','cedar','falcon'];
for(const [index,branch] of branchNames.entries()){
  git('switch','main');
  git('switch','-c',branch);
  const folder=folders[index%3],file=`${folder}/${branch}.txt`,temporary=`${folder}/${branch}-basket.txt`;
  write(file,`${branch}\n${nouns.slice(index,index+4).join(' ')}`);commit(`Add ${branch} collection`);
  write(file,`${branch}\n${nouns.slice().reverse().join('\n')}`);commit(`Rearrange ${branch} collection`);
  write(temporary,`basket ${branch} pebble ribbon`);commit(`Add ${branch} basket`);
  fs.unlinkSync(path.join(destination,temporary));
  write(file,`${branch}\n${nouns.join(' / ')}\n${folder}`);commit(`Remove basket and polish ${branch}`);
  git('switch','main');
  if(index%2===0)commit(`Merge ${branch} into main`,branch);
}
for(let index=0;index<9;index++){
  const folder=folders[index%3],file=`${folder}/ribbon.txt`;
  if(index<3)write(file,`${nouns[index]} ribbon`);
  else if(index<6)write(file,`${nouns[index]}\n${nouns.join('\n')}`);
  else fs.unlinkSync(path.join(destination,file));
  commit(`${index<3?'Add':index<6?'Modify':'Remove'} ${folder} ribbon`);
}
git('tag','seedling',git('rev-list','--max-parents=0','HEAD'));
git('tag','harvest');
console.log(JSON.stringify({destination,commits:Number(git('rev-list','--all','--count')),branches:git('branch','--format=%(refname:short)').split('\n'),merges:Number(git('rev-list','--all','--merges','--count')),status:git('status','--porcelain')},null,2));
