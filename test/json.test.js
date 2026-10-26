import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument,deepEqual,stringifyWithLineMap,diffDocuments,mappedLine,diffLine,differenceHighlights,childPath,parentPath,remapPathLines } from '../json/core.js';
test('JSONC normalization quotes only keys outside strings and comments',()=>{
  const text=`{\n // fred: is a comment\n fred: 'it\\'s fine',\n url: 'https://example.com/a/*b*/',\n nested: { empty: [], },\n list: [true, null, 2,], /* tail */\n}`;
  const result=parseDocument(text);assert.equal(result.ok,true,result.error);
  assert.deepEqual(result.data,{fred:"it's fine",url:'https://example.com/a/*b*/',nested:{empty:[]},list:[true,null,2]});
  assert.match(result.quotedText,/\/\/ fred: is a comment/);assert.match(result.quotedText,/"fred": 'it/);
  assert.equal(result.map.get('$.nested.empty'),5);assert.equal(result.map.get('$.list[2]'),6);
  assert.deepEqual(parseDocument(`{'escaped': '\\u0061\\n', bare_key$: "text: stays"}`).data,{escaped:'a\n',bare_key$:'text: stays'});
});
test('parse errors map to original lines and leave source available',()=>{
  for(const [text,line] of [ ['{\n fred: 1,\n bad: @\n}',3],['{\n /* unterminated',2],["{\n key: 'unterminated",2],['{\n key: "bad\\q"\n}',2],['{\n a: 1\n b: 2\n}',3] ]){
    const result=parseDocument(text);assert.equal(result.ok,false);assert.equal(result.line,line,result.error);
  }
  assert.equal(parseDocument('// just a comment').ok,false);
});
test('deep comparison ignores object order, preserves array order and signed zero',()=>{
  assert.ok(deepEqual({a:1,b:[2,null]},{b:[2,null],a:1}));assert.ok(!deepEqual([1,2],[2,1]));assert.ok(!deepEqual(-0,0));assert.ok(!deepEqual(null,{}));
  assert.deepEqual(diffDocuments({a:1,b:[true]},{b:[true],a:1}),[]);
  const diffs=diffDocuments({a:1,b:[1],old:null},{a:'1',b:[2,3],next:true});
  assert.ok(diffs.some(d=>d.path==='$.a'&&d.kind==='type'));
  assert.ok(diffs.some(d=>d.path==='$.b'&&d.kind==='length'));
  assert.ok(diffs.some(d=>d.path==='$.b[0]'&&d.kind==='value'));
  assert.ok(diffs.some(d=>d.path==='$.b[1]'&&d.missing==='a'));
  assert.ok(diffs.some(d=>d.path==='$.old'&&d.missing==='b'));
});
test('pretty printer sorts recursively, maps paths, and preserves prototype-like keys',()=>{
  const value=JSON.parse('{"z":{"b":2,"a":1},"a":[{"d":4,"c":3}],"__proto__":5,"2":2,"10":10}');
  const result=stringifyWithLineMap(value,true);
  assert.equal(result.text.endsWith('\n'),true);assert.ok(result.text.indexOf('"10"')<result.text.indexOf('"2"'));
  assert.ok(deepEqual(JSON.parse(result.text),value));
  assert.ok(Object.is(JSON.parse(stringifyWithLineMap(-0).text),-0));
  assert.equal(JSON.parse(stringifyWithLineMap(Infinity).text),Infinity);
  assert.match(result.text.split('\n')[result.map.get('$.a[0].c')-1],/"c": 3/);
  const compact='// lead\n{ "b": 2, "a": { "unusual.key": [1,2] }, }';
  const map=remapPathLines(parseDocument(compact).data,compact);
  assert.equal(map.get('$.a["unusual.key"][1]'),2);
  assert.equal(mappedLine(map,'$.a["unusual.key"][3]'),2);
  assert.equal(parentPath('$.a["unusual.key"][3]'),'$.a["unusual.key"]');
  assert.equal(childPath('$','a"b'),'$["a\\"b"]');
});
test('missing top-level keys do not mark the root brace as a difference',()=>{
  const map=parseDocument('{\n "items": [1]\n}').map;
  assert.equal(diffLine(map,'$.missing'),null);
  assert.equal(mappedLine(map,'$.missing'),1);
  assert.equal(diffLine(map,'$.items[1]'),2);
  assert.equal(diffLine(map,'$'),1);
});
test('difference colors cover additional blocks only on their side and shared value changes on both',()=>{
  const a=parseDocument('{\n "value": 1,\n "items": []\n}');
  const b=parseDocument('{\n "value": 2,\n "items": [\n  {\n   "extra": true\n  }\n ],\n "added": {\n  "nested": [1,2]\n }\n}');
  const diffs=diffDocuments(a.data,b.data),left=differenceHighlights(diffs,a.ranges,'a'),right=differenceHighlights(diffs,b.ranges,'b');
  assert.equal(left.get(2),'changed');assert.equal(right.get(2),'changed');
  assert.equal(left.has(1),false);assert.equal(left.has(3),false);
  for(const line of [4,5,6,8,9,10])assert.equal(right.get(line),'additional');
  assert.equal(right.has(3),false);assert.equal(right.has(7),false);
  const changed=diffDocuments({value:{}},{value:1});
  assert.equal(differenceHighlights(changed,parseDocument('{\n "value": {\n }\n}').ranges,'a').get(3),'changed');
});
