import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, toOKLCH } from '../color/colors.js';
import { harmony } from '../color/harmony.js';
test('harmony angles, alpha and gamut mapping', () => {
  const base = parse('oklch(.6 .05 40 / .5)');
  const expected = {complementary:[220,220],analogous:[10,70],split:[190,250],triadic:[160,280],tetradic:[70,250],square:[130,310]};
  for (const [mode,hues] of Object.entries(expected)) {
    harmony(base,mode).forEach((color,i) => {
      const [L,,H] = toOKLCH(color);
      assert.ok(Math.abs(L-.6)<1e-6); assert.ok(Math.abs(H-hues[i])<1e-3); assert.equal(color.a,.5);
      assert.ok(color.rgb.every(n => n >= -1e-7 && n <= 1+1e-7));
    });
  }
  assert.deepEqual(harmony(base,'reset'),[base,base]);
  const [top,bottom] = harmony(base,'monochromatic',30,.2,.5);
  assert.ok(Math.abs(toOKLCH(top)[0]-.8)<1e-6);
  assert.ok(Math.abs(toOKLCH(bottom)[0]-.4)<1e-6);
  for (const color of harmony(parse('#FF000080'),'triadic')) {
    assert.ok(color.rgb.every(n => n >= -1e-7 && n <= 1+1e-7));
    assert.equal(color.a,128/255);
  }
});
