export function deepEqual(a,b) {
  if (Object.is(a,b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(key => Object.hasOwn(b,key) && deepEqual(a[key],b[key]));
}
export const childPath = (parent,key) => /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
export function parentPath(path) {
  let parent = '$';
  const parts = path.match(/\.[A-Za-z_$][\w$]*|\[(?:\d+|"(?:\\.|[^"\\])*")\]/g) || [];
  for (const part of parts.slice(0,-1)) parent += part;
  return parent;
}
const lineAt = (text,index) => text.slice(0,index).split('\n').length;
function failure(message,index) { const error = new Error(message); error.index=index; throw error; }
export function tokenize(text) {
  const tokens = []; let i=0;
  while (i < text.length) {
    const start=i, c=text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c==='/' && text[i+1]==='/') { i+=2; while (i<text.length && text[i]!=='\n') i++; continue; }
    if (c==='/' && text[i+1]==='*') { const end=text.indexOf('*/',i+2); if (end<0) failure('Unterminated block comment',i); i=end+2; continue; }
    if (c==='"' || c==="'") {
      const quote=c; let value='', closed=false; i++;
      while (i<text.length) {
        const ch=text[i++];
        if (ch===quote) { closed=true; break; }
        if (ch<' ') failure('Unescaped control character in string',i-1);
        if (ch!=='\\') { value+=ch; continue; }
        if (i>=text.length) failure('Unterminated string escape',i-1);
        const escape=text[i++], replacements={'"':'"',"'":"'",'\\':'\\','/':'/','b':'\b','f':'\f','n':'\n','r':'\r','t':'\t'};
        if (escape==='u') { const hex=text.slice(i,i+4); if (!/^[\da-f]{4}$/i.test(hex)) failure('Invalid Unicode escape',i); value+=String.fromCharCode(parseInt(hex,16)); i+=4; }
        else if (Object.hasOwn(replacements,escape) && (escape!=="'" || quote==="'")) value+=replacements[escape];
        else failure('Invalid string escape',i-1);
      }
      if (!closed) failure('Unterminated string',start);
      tokens.push({type:'string',start,end:i,value,normalized:JSON.stringify(value),quote}); continue;
    }
    if (/[A-Za-z_$]/.test(c)) { i++; while (i<text.length && /[\w$]/.test(text[i])) i++; tokens.push({type:'identifier',start,end:i,value:text.slice(start,i)}); continue; }
    if ('{}[]:,'.includes(c)) { tokens.push({type:c,start,end:++i}); continue; }
    i++; while (i<text.length && !/[\s{}\[\]:,"'\/]/.test(text[i])) i++;
    tokens.push({type:'raw',start,end:i,value:text.slice(start,i)});
  }
  return tokens;
}
export function parseDocument(text) {
  try {
    const tokens=tokenize(text), origins=[], rewrites=[]; let normalized='', cursor=0;
    // V8 sometimes omits an error offset. Validate the grammar against original
    // tokens first so every browser can report the original failing line.
    let check=0;
    const current=()=>tokens[check];
    const expect=type=>{if(current()?.type!==type)failure(`Expected ${type}`,current()?.start??text.length);check++;};
    function validateValue(){
      const token=current();
      if(!token)failure('Expected a JSON value',text.length);
      if(token.type==='{'||token.type==='['){
        const object=token.type==='{',close=object?'}':']';check++;
        if(current()?.type===close){check++;return;}
        while(true){
          if(object){if(!['string','identifier'].includes(current()?.type))failure('Expected an object key',current()?.start??text.length);check++;expect(':');}
          validateValue();
          if(current()?.type===close){check++;break;}
          expect(',');
          if(current()?.type===close){check++;break;}
        }
      }else if(token.type==='string'||token.type==='identifier'&&['true','false','null'].includes(token.value)||token.type==='raw'&&/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token.value))check++;
      else failure('Expected a JSON value',token.start);
    }
    validateValue();if(check!==tokens.length)failure('Unexpected token after JSON value',current().start);
    const emit = (value,index) => { normalized+=value; for(let k=0;k<value.length;k++) origins.push(index+k); };
    for (let i=0;i<tokens.length;i++) {
      const token=tokens[i];
      // Preserve line breaks and source length while removing comments.
      const gap=text.slice(cursor,token.start).replace(/[^\r\n\t ]/g,' '); emit(gap,cursor);
      const bare=token.type==='identifier' && tokens[i+1]?.type===':';
      const trailing=token.type===',' && ['}',']'].includes(tokens[i+1]?.type);
      const value=trailing?' ':bare?JSON.stringify(token.value):token.type==='string'?token.normalized:text.slice(token.start,token.end);
      const base=normalized.length; emit(value,token.start);
      for (let k=base;k<origins.length;k++) origins[k]=Math.min(token.end-1,token.start+Math.max(0,k-base-(bare?1:0)));
      if (bare) rewrites.push({start:token.start,end:token.end,value});
      cursor=token.end;
    }
    emit(text.slice(cursor).replace(/[^\r\n\t ]/g,' '),cursor);
    let data;
    try { data=JSON.parse(normalized); }
    catch(error) {
      const pos=/position\s+(\d+)/i.exec(error.message), lc=/line\s+(\d+)\s+column\s+(\d+)/i.exec(error.message);
      let index=normalized.length;
      if (pos) index=+pos[1];
      else if(lc) { const lines=normalized.split('\n'); index=lines.slice(0,+lc[1]-1).reduce((sum,line)=>sum+line.length+1,0)+(+lc[2]-1); }
      const original=index>=origins.length?text.length:origins[Math.max(0,index)];
      return {ok:false,error:error.message,line:lineAt(text,original),index:original};
    }
    const map=new Map(),ranges=new Map(); let ti=0;
    function walk(path, keyStart) {
      const token=tokens[ti++]; map.set(path,lineAt(text,keyStart ?? token.start));
      if(token.type==='{') {
        while(tokens[ti]?.type!=='}') {
          const key=tokens[ti++]; ti++; walk(childPath(path,key.value),key.start);
          if(tokens[ti]?.type===',') ti++;
        }
        ti++;
      } else if(token.type==='[') {
        let index=0;
        while(tokens[ti]?.type!==']') { walk(`${path}[${index++}]`); if(tokens[ti]?.type===',')ti++; }
        ti++;
      }
      ranges.set(path,{start:map.get(path),end:lineAt(text,tokens[ti-1].end-1)});
    }
    walk('$');
    let quotedText=text;
    for(const rewrite of rewrites.reverse()) quotedText=quotedText.slice(0,rewrite.start)+rewrite.value+quotedText.slice(rewrite.end);
    return {ok:true,data,map,ranges,quotedText};
  } catch(error) { return {ok:false,error:error.message,line:lineAt(text,error.index??0),index:error.index??0}; }
}
export function stringifyWithLineMap(data, sort=false) {
  const lines=[],map=new Map();
  function walk(value,path,depth,prefix='',suffix='') {
    map.set(path,lines.length+1);
    const indent='  '.repeat(depth);
    if(value===null || typeof value!=='object') {
      const scalar=Object.is(value,-0)?'-0':value===Infinity?'1e999':value===-Infinity?'-1e999':JSON.stringify(value);
      lines.push(indent+prefix+scalar+suffix); return;
    }
    const array=Array.isArray(value), keys=Object.keys(value);
    if(sort && !array) keys.sort((a,b)=>a.localeCompare(b));
    if(!keys.length) { lines.push(indent+prefix+(array?'[]':'{}')+suffix); return; }
    lines.push(indent+prefix+(array?'[':'{'));
    keys.forEach((key,index)=>walk(value[key],array?`${path}[${key}]`:childPath(path,key),depth+1,array?'':JSON.stringify(key)+': ',index<keys.length-1?',':''));
    lines.push(indent+(array?']':'}')+suffix);
  }
  walk(data,'$',0);
  return {text:lines.join('\n')+'\n',map};
}
export function remapPathLines(data,text) {
  // Exact token offsets keep paths on the right lines even with comments, compact
  // objects, duplicate values, reordered keys, and unformatted JSONC.
  const parsed=parseDocument(text);
  return parsed.ok?parsed.map:stringifyWithLineMap(data).map;
}
const type = value => value===null?'null':Array.isArray(value)?'array':typeof value;
export function diffDocuments(a,b) {
  const result=[];
  function walk(left,right,path) {
    if(Object.is(left,right))return;
    if(type(left)!==type(right)) {result.push({path,kind:'type',a:left,b:right});return;}
    if(Array.isArray(left)) {
      if(left.length!==right.length)result.push({path,kind:'length',a:left.length,b:right.length});
      for(let i=0;i<Math.max(left.length,right.length);i++) {
        const p=`${path}[${i}]`;
        if(i>=left.length || i>=right.length)result.push({path:p,kind:'missing',a:left[i],b:right[i],missing:i>=left.length?'a':'b'});
        else walk(left[i],right[i],p);
      }
    } else if(left!==null && typeof left==='object') {
      const keys=[...new Set([...Object.keys(left),...Object.keys(right)])].sort((a,b)=>a.localeCompare(b));
      for(const key of keys) {
        const p=childPath(path,key);
        if(!Object.hasOwn(left,key)||!Object.hasOwn(right,key))result.push({path:p,kind:'missing',a:left[key],b:right[key],missing:!Object.hasOwn(left,key)?'a':'b'});
        else walk(left[key],right[key],p);
      }
    } else result.push({path,kind:'value',a:left,b:right});
  }
  walk(a,b,'$'); return result;
}
export function mappedLine(map,path) { while(!map.has(path)&&path!=='$')path=parentPath(path); return map.get(path)||1; }
export function diffLine(map,path) {
  if(map.has(path))return map.get(path);
  // A missing top-level key has no counterpart to mark. The root brace is
  // still a navigation anchor, but is not itself a changed value.
  while(path!=='$'){
    path=parentPath(path);
    if(path!=='$'&&map.has(path))return map.get(path);
  }
  return null;
}
export function differenceHighlights(differences,ranges,side) {
  const lines=new Map();
  for(const diff of differences){
    // Array length is explained by the additional elements, not its opener.
    if(diff.kind==='length'||diff.kind==='missing'&&diff.missing===side)continue;
    const range=ranges.get(diff.path);
    if(!range)continue;
    const kind=diff.kind==='missing'?'additional':'changed';
    for(let line=range.start;line<=range.end;line++){
      if(kind==='changed'||!lines.has(line))lines.set(line,kind);
    }
  }
  return lines;
}
export function preview(value) {
  if(value===undefined)return '〈missing〉';
  if(Object.is(value,-0))return '-0';
  if(value===Infinity||value===-Infinity)return String(value);
  const text=JSON.stringify(value),max=typeof value==='string'?120:160;
  return text.length>max?text.slice(0,max)+'…':text;
}
