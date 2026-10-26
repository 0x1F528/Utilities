import { clamp, fromOKLCH, toOKLCH } from './colors.js';

// Reduce chroma rather than clipping RGB channels, preserving lightness and hue.
export function gamutColor(L, C, H, alpha) {
  L = clamp(L); C = Math.max(0,C); H = (H%360+360)%360;
  const fits = color => color.rgb.every(n => n >= -1e-7 && n <= 1+1e-7);
  let color = fromOKLCH(L,C,H,alpha);
  if (fits(color)) return color;
  let low = 0, high = C;
  for (let i=0;i<28;i++) {
    const mid = (low+high)/2;
    if (fits(fromOKLCH(L,mid,H,alpha))) low = mid; else high = mid;
  }
  return fromOKLCH(L,low,H,alpha);
}
export function harmony(color, mode, theta = 30, delta = .15, chroma = 1) {
  const [L,C,H] = toOKLCH(color);
  const rotate = degrees => gamutColor(L,C,H+degrees,color.a);
  switch (mode) {
    case 'complementary': return [rotate(180),rotate(180)];
    case 'analogous': return [rotate(-theta),rotate(theta)];
    case 'split': return [rotate(180-theta),rotate(180+theta)];
    case 'triadic': return [rotate(120),rotate(240)];
    case 'tetradic': return [rotate(theta),rotate(180+theta)];
    case 'square': return [rotate(90),rotate(270)];
    case 'monochromatic': return [gamutColor(L+delta,C*chroma,H,color.a),gamutColor(L-delta,C*chroma,H,color.a)];
    default: return [color,color];
  }
}
