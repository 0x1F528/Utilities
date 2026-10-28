/** Status-dot fingerprint for file-folder chain elision (same dots → one run). */
export function fileMarkerKey(status={},workingTree=true){
  if(!status)return '';
  if(workingTree){
    if(status.conflicted)return 'conflicted';
    return ['unstaged','staged'].filter(key=>status[key]).join('\0');
  }
  return ['added','modified','deleted'].filter(key=>status[key]).join('\0');
}

/**
 * Single-child folder chain from a named child through the tip that holds files or branches.
 * Intermediate nodes have no files and exactly one child folder.
 */
export function collectFileChain(startName,startNode,parentPrefix=''){
  const chain=[];
  let name=startName,node=startNode,prefix=parentPrefix+startName+'/';
  for(;;){
    chain.push({name,prefix,node});
    if(!node||node.files.length>0||node.folders.size!==1)break;
    const [nextName,nextNode]=[...node.folders.entries()][0];
    name=nextName;node=nextNode;prefix+=nextName+'/';
  }
  return chain;
}

// Classify a historical / name-status path as insert, update, or delete.
export function historicalKind(file){
  const code=String(file.code||'').trim();
  if(file.stashUntracked||code==='?'||/^A/.test(code))return 'added';
  if(/^D/.test(code))return 'deleted';
  if(code)return 'modified';
  return '';
}

// Aggregate the filtered tree, so collapsed folders retain their descendants' status.
export function summarizeFolders(node,workingTree=true){
  const status={changed:false,staged:false,unstaged:false,conflicted:false,added:false,deleted:false,modified:false};
  for(const file of node.files){
    if(file.ignored)continue;
    if(!workingTree){
      const kind=historicalKind(file);
      status.added||=kind==='added';
      status.deleted||=kind==='deleted';
      status.modified||=kind==='modified';
      status.changed||=!!kind;
      continue;
    }
    status.conflicted||=!!file.conflicted;
    status.staged||=!!file.staged&&!file.conflicted;
    status.unstaged||=!!file.unstaged||!!file.untracked||!!file.conflicted;
  }
  for(const child of node.folders.values()){
    const descendant=summarizeFolders(child,workingTree);
    for(const key of Object.keys(status))status[key]||=descendant[key];
  }
  status.changed||=status.staged||status.unstaged||status.conflicted||status.added||status.deleted||status.modified;
  node.status=status;
  return status;
}
