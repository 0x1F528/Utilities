import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await mkdir(path.join(root,'vendor'),{recursive:true});
for(const name of ['marked','mermaid','dompurify']){
  const folder=name==='marked'?'lib':'dist';
  await cp(path.join(root,'node_modules',name,folder),path.join(root,'vendor',name),{recursive:true,filter:source=>!source.endsWith('.map')});
  await cp(path.join(root,'node_modules',name,'LICENSE'),path.join(root,'vendor',name,'LICENSE')).catch(async()=>{
    await cp(path.join(root,'node_modules',name,'LICENSE.md'),path.join(root,'vendor',name,'LICENSE')).catch(()=>{});
  });
}
console.log('Local browser assets ready in Markdown/vendor.');
