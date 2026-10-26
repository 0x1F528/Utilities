import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, format, toOKLCH, gradient } from '../color/colors.js';
test('color formats, alpha and exact conversions', () => {
  assert.equal(format(parse('#abc')).hex,'#AABBCC');
  assert.equal(format(parse('#abcd')).hex,'#AABBCCDD');
  assert.equal(format(parse('#aabbcc80')).rgba,'rgba(170, 187, 204, 0.502)');
  assert.equal(format(parse('rgb(100% 0% 50% / 25%)')).hex,'#FF008040');
  assert.equal(format(parse('rgba(255, 0, 0, .5)')).hex,'#FF000080');
  assert.equal(format(parse('hsl(-120deg 100% 50%)')).hex,'#0000FF');
  assert.equal(format(parse('hsla(120, 1, .5, 40%)')).hex,'#00FF0066');
  assert.equal(format(parse('transparent')).named,'transparent');
  assert.equal(format(parse('rebeccapurple',{rebeccapurple:'#663399'})).hex,'#663399');
  assert.equal(format(parse('rgb(255 0 0)')).hsl,'hsl(0, 100%, 50%)');
  for (const hex of ['#FFFFFF','#000000','#0969DA','#FF6347','#663399']) {
    const color = parse(hex), [L,C,H] = toOKLCH(color);
    assert.equal(format(parse(`oklch(${L} ${C} ${H})`)).hex,hex);
  }
  assert.equal(format(parse('oklch(75% .12 230 / 20%)')).hex,format(parse('oklch(75 .12 230 / .2)')).hex);
  for (const input of ['#12','rgb(1 2)','hsl(no 20% 30%)','rgb(1,,2,3)','rgb(1 2 Infinity)','oklch(1e999 .2 30)']) assert.throws(() => parse(input));
});
test('gradient uses filled rows, alpha hex, sorted positions, and solid colors', () => {
  const colors = [parse('#ff000080'),null,parse('white',{white:'#FFFFFF'})];
  assert.equal(gradient(colors,[80,0,20],45),'linear-gradient(45deg, #FFFFFF 20%, #FF000080 80%)');
  assert.equal(gradient([null,parse('#abc')],[0,50],90),'#AABBCC');
  assert.equal(gradient([null],[0],90),'');
});
