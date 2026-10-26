import {test} from 'node:test';
import assert from 'node:assert/strict';
import {layoutGraph,colorGraph,graphSVG,BLUE,GREY} from '../git/graph-layout.js';
const RED='#d32f2f',GREEN='#2e7d32';
const graph=(commits,seeds)=>new Map(colorGraph(layoutGraph(commits.map(([oid,...parents])=>({oid,parents}))),seeds.map(([oid,color])=>({oid,color}))).map(row=>[row.commit.oid,row]));
test('straight lineage inherits the selected tip color',()=>{
  const rows=graph([['a','b'],['b','c'],['c']],[['a',RED]]);
  for(const row of rows.values())assert.equal(row.dotColor,RED);
});
test('different colors become grey; a single later color overrides propagated grey',()=>{
  const rows=graph([['a','c'],['b','c'],['c','d'],['d','e'],['e']],[['a',RED],['b',GREEN],['d',RED]]);
  assert.equal(rows.get('c').dotColor,GREY);
  assert.equal(rows.get('d').dotColor,RED);
  assert.equal(rows.get('e').dotColor,RED);
});
test('blue overrides other colors, including co-located branch tips',()=>{
  const rows=graph([['a','c'],['b','c'],['c','d'],['d']],[['a',RED],['b',BLUE],['b',GREEN]]);
  assert.equal(rows.get('b').baseColor,BLUE);
  assert.equal(rows.get('c').baseColor,BLUE);
  assert.equal(rows.get('d').baseColor,BLUE);
});
test('co-located non-current tips make grey even when their palette colors match',()=>{
  assert.equal(graph([['a','b'],['b']],[['a',RED],['a',RED]]).get('a').dotColor,GREY);
});
test('diamond lightens the right path and restores base shade at reunion',()=>{
  const rows=graph([['a','b','c'],['b','d'],['c','d'],['d','e'],['e']],[['a',BLUE]]);
  assert.equal(rows.get('b').dotColor,BLUE);
  assert.notEqual(rows.get('c').dotColor,BLUE);
  assert.equal(rows.get('c').baseColor,BLUE);
  assert.equal(rows.get('d').dotColor,BLUE);
  assert.equal(rows.get('e').dotColor,BLUE);
});
test('nested split removes only its own shading at its reunion',()=>{
  const rows=graph([['a','b','c'],['b','z'],['c','d','e'],['d','f'],['e','f'],['f','z'],['z']],[['a',RED]]);
  assert.notEqual(rows.get('e').dotColor,rows.get('c').dotColor);
  assert.equal(rows.get('f').dotColor,rows.get('c').dotColor);
  assert.equal(rows.get('z').dotColor,RED);
});
test('a split outside the loaded history retains its shade',()=>{
  const rows=graph([['a','b','c'],['b','missing'],['c','missing']],[['a',RED]]);
  assert.notEqual(rows.get('c').dotColor,RED);
  assert.equal(rows.get('c').edgeColors.missing,rows.get('c').dotColor);
});

test('SVG uses inherited edge shades and does not recolor a line from its target dot',()=>{
  const previous=globalThis.document;
  globalThis.document={createElementNS:(_namespace,tag)=>({tag,attributes:{},children:[],setAttribute(key,value){this.attributes[key]=value;},append(child){this.children.push(child);}})};
  try{
    const rows=graph([['a','b','c'],['b','d'],['c','d'],['d']],[['a',RED]]);
    const svg=graphSVG(rows.get('a'),'a'),paths=svg.children.filter(child=>child.tag==='path');
    assert.equal(paths.length,2); // Head dot has no line above it.
    assert.equal(paths[0].attributes.stroke,RED);
    assert.notEqual(paths[1].attributes.stroke,RED);
    const childSVG=graphSVG(rows.get('b'),'a');
    assert.equal(childSVG.children.filter(child=>child.tag==='path').length,3); // Passing lane + incoming + outgoing.
    assert.equal(svg.children.at(-1).attributes.fill,RED);
  }finally{globalThis.document=previous;}
});

test('virtual working tree reserves lane one even when another head is newer',()=>{
  const commits=[{oid:'other',parents:['root']},{oid:'head',parents:['root']},{oid:'root',parents:[]}];
  const rows=layoutGraph(commits,{head:'head',workingTree:true});
  assert.equal(rows[0].commit.virtual,true);assert.equal(rows[0].lane,0);
  assert.equal(rows.find(row=>row.commit.oid==='other').lane,1);
  assert.equal(rows.find(row=>row.commit.oid==='head').lane,0);
  assert.equal(rows.find(row=>row.commit.oid==='root').lane,0);
});
test('retiring a lineage preserves other lanes and new heads fill the leftmost gap',()=>{
  const commits=[['one','a'],['two','b'],['three','c'],['b','a'],['four','d'],['a','root'],['c','root'],['d','root'],['root']].map(([oid,...parents])=>({oid,parents}));
  const rows=layoutGraph(commits),byId=new Map(rows.map(row=>[row.commit.oid,row]));
  assert.equal(byId.get('three').lane,2);
  assert.equal(byId.get('b').after[1],null);
  assert.equal(byId.get('b').after[2],'c');
  assert.equal(byId.get('four').lane,1);
  assert.equal(byId.get('c').lane,2);
  assert.equal(byId.get('root').lane,0);
});
