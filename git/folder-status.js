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
