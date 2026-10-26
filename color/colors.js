export const clamp = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));
const linear = n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
const encoded = n => n <= .0031308 ? 12.92 * n : 1.055 * n ** (1 / 2.4) - .055;
export const fromRGB = (r, g, b, a = 1) => ({ rgb: [r, g, b].map(n => linear(clamp(n))), a: clamp(a) });
export const toRGB = color => color.rgb.map(n => clamp(encoded(n)));
const round = (n, digits) => Number(n.toFixed(digits));
const numeric = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
function number(token) { if (!numeric.test(token) || !Number.isFinite(Number(token))) throw new Error('Expected a finite number'); return Number(token); }
function fraction(token, scale = 1) { return token.endsWith('%') ? number(token.slice(0, -1)) / 100 : number(token) / scale; }
const hue = token => ((number(token.replace(/deg$/i, '')) % 360) + 360) % 360;
export function fromHSL(h, s, l, a = 1) {
  s = clamp(s); l = clamp(l);
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const channels = h < 60 ? [c,x,0] : h < 120 ? [x,c,0] : h < 180 ? [0,c,x] : h < 240 ? [0,x,c] : h < 300 ? [x,0,c] : [c,0,x];
  return fromRGB(...channels.map(n => n + m), a);
}
export function toHSL(color) {
  const [r,g,b] = toRGB(color), max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min, l = (max + min) / 2;
  let h = d === 0 ? 0 : max === r ? ((g-b)/d)%6 : max === g ? (b-r)/d+2 : (r-g)/d+4;
  h = (h * 60 + 360) % 360;
  return [h, d === 0 ? 0 : d / (1 - Math.abs(2*l - 1)), l];
}
export function fromOKLCH(L, C, H, a = 1) {
  const A = C * Math.cos(H * Math.PI / 180), B = C * Math.sin(H * Math.PI / 180);
  const l = (L + .3963377774*A + .2158037573*B)**3, m = (L - .1055613458*A - .0638541728*B)**3, s = (L - .0894841775*A - 1.291485548*B)**3;
  return { rgb: [4.0767416621*l - 3.3077115913*m + .2309699292*s, -1.2684380046*l + 2.6097574011*m - .3413193965*s, -.0041960863*l - .7034186147*m + 1.707614701*s], a: clamp(a) };
}
export function toOKLCH(color) {
  const [r,g,b] = color.rgb;
  const l = Math.cbrt(.4122214708*r + .5363325363*g + .0514459929*b), m = Math.cbrt(.2119034982*r + .6806995451*g + .1073969566*b), s = Math.cbrt(.0883024619*r + .2817188376*g + .6299787005*b);
  const L = .2104542553*l + .793617785*m - .0040720468*s, A = 1.9779984951*l - 2.428592205*m + .4505937099*s, B = .0259040371*l + .7827717662*m - .808675766*s;
  const C = Math.hypot(A,B);
  return [L, C, C < 1e-7 ? 0 : (Math.atan2(B,A)*180/Math.PI + 360)%360];
}
export function parse(text, names = {}) {
  text = text.trim().toLowerCase();
  if (text === 'transparent') return fromRGB(0,0,0,0);
  if (Object.hasOwn(names, text)) return parse(names[text]);
  if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/.test(text)) {
    let hex = text.slice(1); if (hex.length <= 4) hex = [...hex].map(c => c+c).join('');
    return fromRGB(...[0,2,4].map(i => parseInt(hex.slice(i,i+2),16)/255), hex.length === 8 ? parseInt(hex.slice(6),16)/255 : 1);
  }
  const match = /^(rgb|rgba|hsl|hsla|oklch)\((.*)\)$/.exec(text);
  if (!match) throw new Error('Use a CSS color name, hex, rgb(), hsl(), or oklch().');
  const [,type,body] = match;
  const tokens = body.trim().replace(/\s*([,/])\s*/g, '$1').split(/[,/\s]+/);
  if (!body.trim() || /[,/]$|^[,/]|[,/]{2}/.test(body.trim()) || tokens.length < 3 || tokens.length > 4) throw new Error('Expected three channels and optional alpha.');
  const a = tokens.length === 4 ? clamp(fraction(tokens[3])) : 1;
  if (type.startsWith('rgb')) return fromRGB(...tokens.slice(0,3).map(t => fraction(t,255)), a);
  if (type.startsWith('hsl')) return fromHSL(hue(tokens[0]), fraction(tokens[1]), fraction(tokens[2]), a);
  let L = fraction(tokens[0]); if (!tokens[0].endsWith('%') && L > 1) L /= 100;
  return fromOKLCH(clamp(L), Math.max(0,number(tokens[1])), hue(tokens[2]), a);
}
export function format(color, reverse = {}) {
  const rgb = toRGB(color).map(n => Math.round(n*255)), alpha = round(color.a,3);
  const opaque = '#' + rgb.map(n => n.toString(16).padStart(2,'0')).join('').toUpperCase();
  const hex = opaque + (color.a < 1 ? Math.round(color.a*255).toString(16).padStart(2,'0').toUpperCase() : '');
  const [h,s,l] = toHSL(color), [L,C,H] = toOKLCH(color);
  const hsl = `${round(h,1)}, ${round(s*100,1)}%, ${round(l*100,1)}%`;
  return { hex, rgb: `rgb(${rgb.join(', ')})`, rgba: `rgba(${rgb.join(', ')}, ${alpha})`, hsl: `hsl(${hsl})`, hsla: `hsla(${hsl}, ${alpha})`, oklch: `oklch(${round(L,3)} ${round(C,3)} ${round(H,1)}${color.a < 1 ? ' / '+alpha : ''})`, named: color.a === 0 ? 'transparent' : color.a === 1 ? reverse[opaque] || '' : '', opaque, css: color.a < 1 ? `rgba(${rgb.join(', ')}, ${alpha})` : opaque };
}
export function gradient(colors, positions, angle) {
  const stops = colors.flatMap((color,i) => color ? [{ index:i, hex:format(color).hex, position:positions[i] }] : []);
  if (!stops.length) return '';
  if (stops.length === 1) return stops[0].hex;
  stops.sort((a,b) => a.position-b.position);
  return `linear-gradient(${angle}deg, ${stops.map(s => `${s.hex} ${s.position}%`).join(', ')})`;
}
