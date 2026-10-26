// Aggregate the filtered tree, so collapsed folders retain their descendants' status.
export function summarizeFolders(node,workingTree=true){
  const status={changed:false,staged:false,unstaged:false,conflicted:false};
  for(const file of node.files){
    if(file.ignored)continue;
    if(!workingTree){status.changed||=!!file.code?.trim();continue;}
    status.conflicted||=!!file.conflicted;
    status.staged||=!!file.staged&&!file.conflicted;
    status.unstaged||=!!file.unstaged||!!file.untracked||!!file.conflicted;
  }
  for(const child of node.folders.values()){
    const descendant=summarizeFolders(child,workingTree);
    for(const key of Object.keys(status))status[key]||=descendant[key];
  }
  status.changed||=status.staged||status.unstaged||status.conflicted;
  node.status=status;
  return status;
}
