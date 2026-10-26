import { parse, format, gradient, clamp } from './colors.js';
import { harmony } from './harmony.js';

const namesList = `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen`.split(' ');
const names = {}, reverse = {};
const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
const context = canvas.getContext('2d', { willReadFrequently: true });
for (const name of namesList) {
  context.clearRect(0,0,1,1); context.fillStyle = name; context.fillRect(0,0,1,1);
  const [r,g,b] = context.getImageData(0,0,1,1).data;
  const hex = '#' + [r,g,b].map(n => n.toString(16).padStart(2,'0')).join('').toUpperCase();
  names[name] = hex;
  if (!reverse[hex] || !name.includes('grey')) reverse[hex] = name;
}
// Canonical spellings for CSS aliases.
for (const name of ['gray','darkgray','dimgray','lightgray','slategray','darkslategray','lightslategray','cyan','magenta']) reverse[names[name]] = name;
const datalist = document.querySelector('#color-names');
for (const name of [...namesList,'transparent']) { const option = document.createElement('option'); option.value = name; datalist.append(option); }
const formats = ['hex','rgb','rgba','hsl','hsla','oklch','named'];
const labels = { hex:'Hex',rgb:'RGB',rgba:'RGBA',hsl:'HSL',hsla:'HSLA',oklch:'OKLCH',named:'Named CSS color' };
let colors = Array(10).fill(null), positions = Array(10).fill(0), filledKey = '';
const rows = [], timers = new Map();
const tbody = document.querySelector('#rows');
const harmonies = Array.from({length:10},() => ({mode:'reset',theta:30,delta:.15,chroma:1}));
const modeNames = {reset:'Reset — original color',complementary:'Complementary',analogous:'Analogous',split:'Split-complementary',triadic:'Triadic',tetradic:'Tetradic',square:'Square tetradic',monochromatic:'Monochromatic'};
const menu = document.createElement('div');
menu.className = 'harmony-menu'; menu.id = 'harmony-menu'; menu.setAttribute('popover','auto'); menu.setAttribute('role','dialog'); menu.setAttribute('aria-label','Color harmony preview');
menu.innerHTML = `<div class="harmony-heading"><strong id="harmony-title"></strong><button type="button" id="harmony-close" aria-label="Close harmony preview">×</button></div><label>Preview relationship<select id="harmony-mode"></select></label><label id="theta-control">Angle θ (degrees)<input id="harmony-theta" type="number" min="0" max="180" step="1"></label><div id="mono-controls"><label>Lightness change ±<input id="harmony-delta" type="number" min="0" max="1" step="0.01"></label><label>Chroma multiplier<input id="harmony-chroma" type="number" min="0" max="2" step="0.1"></label></div><p id="harmony-description"></p><div id="harmony-values"></div><p class="hint">OKLCH hue relationships; lightness and alpha are kept unless adjusted. Chroma is reduced to fit sRGB. Picker, values and gradient stops keep the original color.</p>`;
document.body.append(menu);
for (const [value,name] of Object.entries(modeNames)) { const option = document.createElement('option'); option.value=value; option.textContent=name; menu.querySelector('select').append(option); }
let activeHarmony = null;
const descriptions = {
  reset:'Original color across both halves. Restores the normal color 1 / color 10 transparency backgrounds.',
  complementary:'Top and bottom: H + 180°.',analogous:'Top: H − θ. Bottom: H + θ.',split:'Top: H + 180° − θ. Bottom: H + 180° + θ.',triadic:'Top: H + 120°. Bottom: H + 240°.',
  tetradic:'Top: H + θ. Bottom: H + 180° + θ. These show the second complementary pair; the first pair is your original hue and H + 180°.',
  square:'Top: H + 90°. Bottom: H + 270°. The other pair is your original hue and H + 180°.',monochromatic:'Top: lighter by ΔL. Bottom: darker by ΔL. Lightness is limited to 0–1; the chroma multiplier applies to both.'
};
function updateMenu() {
  if (activeHarmony === null) return;
  const state = harmonies[activeHarmony];
  menu.querySelector('#theta-control').hidden = !['analogous','split','tetradic'].includes(state.mode);
  menu.querySelector('#mono-controls').hidden = state.mode !== 'monochromatic';
  menu.querySelector('#harmony-description').textContent = descriptions[state.mode];
  const values = colors[activeHarmony] ? harmony(colors[activeHarmony],state.mode,state.theta,state.delta,state.chroma).map(c => format(c).hex) : [];
  menu.querySelector('#harmony-values').textContent = values.length ? `Top ${values[0]} · Bottom ${values[1]}` : 'Fill this row to preview a harmony.';
  if (menu.matches(':popover-open')) positionMenu();
}
function positionMenu() {
  const rect = rows[activeHarmony].number.getBoundingClientRect();
  menu.style.left = `${Math.max(8,Math.min(rect.left,innerWidth-menu.offsetWidth-8))}px`;
  menu.style.top = `${Math.max(8,Math.min(rect.bottom+6,innerHeight-menu.offsetHeight-8))}px`;
}
function openHarmony(i) {
  if (menu.matches(':popover-open') && activeHarmony === i) { menu.hidePopover(); return; }
  activeHarmony = i;
  const state = harmonies[i];
  menu.querySelector('#harmony-title').textContent = `Row ${i+1} · Harmony preview`;
  for (const key of ['mode','theta','delta','chroma']) menu.querySelector(`#harmony-${key}`).value = state[key];
  updateMenu();
  if (!menu.matches(':popover-open')) menu.showPopover();
  positionMenu();
  rows.forEach((row,index) => row.number.setAttribute('aria-expanded',String(index === i)));
  menu.querySelector('select').focus();
}
menu.querySelector('#harmony-close').addEventListener('click',() => { menu.hidePopover(); if (activeHarmony !== null) rows[activeHarmony].number.focus(); });
menu.addEventListener('toggle',event => { if (event.newState === 'closed') rows.forEach(row => row.number.setAttribute('aria-expanded','false')); });
for (const key of ['mode','theta','delta','chroma']) menu.querySelector(`#harmony-${key}`).addEventListener(key === 'mode' ? 'change' : 'input',event => {
  if (activeHarmony === null) return;
  if (key === 'mode') harmonies[activeHarmony].mode = event.target.value;
  else {
    const input = event.target;
    if (input.value === '' || !input.validity.valid || !Number.isFinite(input.valueAsNumber)) return;
    harmonies[activeHarmony][key] = input.valueAsNumber;
  }
  renderPreviews();
});
let toastTimer;
function toast(message) {
  const element = document.querySelector('#toast'); element.textContent = message; element.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove('visible'), 3500);
}
async function copy(input) {
  if (!input.value) return toast('Nothing to copy in this field.');
  try { await navigator.clipboard.writeText(input.value); toast('Copied to clipboard.'); }
  catch { input.focus(); input.select(); toast('Clipboard unavailable. Text selected — press Ctrl+C (or ⌘C) to copy.'); }
}
function cancelPending(i) { for (const key of formats) { clearTimeout(timers.get(`${i}:${key}`)); timers.delete(`${i}:${key}`); } }
function apply(i, key) {
  const input = rows[i].inputs[key];
  if (!input.value.trim()) { input.removeAttribute('aria-invalid'); input.removeAttribute('title'); return; }
  try {
    const color = parse(input.value, names);
    if (key === 'rgb' || key === 'hsl') color.a = 1;
    colors[i] = color; cancelPending(i); renderRow(i); renderPreviews(); renderGradient();
  } catch (error) { input.setAttribute('aria-invalid','true'); input.title = error.message; }
}
for (let i = 0; i < 10; i++) {
  const row = document.createElement('tr');
  row.className = 'palette-row';
  const swatchCell = document.createElement('td');
  swatchCell.innerHTML = `<div class="swatch-wrap"><button type="button" class="row-number" aria-label="Row ${i+1} harmony preview" aria-haspopup="dialog" aria-expanded="false" aria-controls="harmony-menu" title="Choose a harmony preview">${i+1}</button><label class="swatch split-preview" title="Original color · top: color 1, bottom: color 10 (white / black for rows 1 and 10)"><span class="swatch-fill"></span><input type="color" aria-label="Row ${i+1} color picker"></label></div>`;
  row.append(swatchCell);
  const record = { row, inputs:{}, number:swatchCell.querySelector('.row-number'), picker:swatchCell.querySelector('input'), fill:swatchCell.querySelector('.swatch-fill') };
  record.number.addEventListener('click',() => openHarmony(i));
  for (const key of formats) {
    const td = document.createElement('td'), field = document.createElement('div'); field.className = 'field';
    const input = document.createElement('input'); input.type = 'text'; input.spellcheck = false; input.autocomplete = 'off'; input.setAttribute('aria-label', `Row ${i+1} ${labels[key]}`);
    if (key === 'named') input.setAttribute('list','color-names');
    const button = document.createElement('button'); button.textContent = '⧉'; button.className = 'copy'; button.title = `Copy ${labels[key]}`; button.setAttribute('aria-label',`Copy row ${i+1} ${labels[key]}`); button.addEventListener('click', () => copy(input));
    input.addEventListener('input', () => { const id = `${i}:${key}`; clearTimeout(timers.get(id)); timers.set(id,setTimeout(() => apply(i,key),180)); });
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { clearTimeout(timers.get(`${i}:${key}`)); apply(i,key); } });
    record.inputs[key] = input; field.append(input,button); td.append(field); row.append(td);
  }
  const td = document.createElement('td'), clear = document.createElement('button'); clear.textContent = '×'; clear.className = 'clear'; clear.setAttribute('aria-label',`Clear row ${i+1}`);
  clear.addEventListener('click', () => { cancelPending(i); colors[i] = null; harmonies[i].mode='reset'; renderRow(i); renderPreviews(); renderGradient(); });
  td.append(clear); row.append(td); rows.push(record); tbody.append(row);
  record.picker.addEventListener('input', () => { cancelPending(i); colors[i] = parse(record.picker.value); renderRow(i); renderPreviews(); renderGradient(); });
}
function renderRow(i) {
  const values = colors[i] ? format(colors[i],reverse) : null;
  for (const key of formats) { const input = rows[i].inputs[key]; input.value = values?.[key] || ''; input.removeAttribute('aria-invalid'); input.removeAttribute('title'); }
  rows[i].picker.value = values?.opaque || '#000000';
}
function renderPreviews() {
  const substrate = (index,fallback) => colors[index] ? format({...colors[index],a:1}).opaque : fallback;
  document.documentElement.style.setProperty('--check-a',substrate(0,'#FFFFFF'));
  document.documentElement.style.setProperty('--check-b',substrate(9,'#000000'));
  colors.forEach((color,i) => {
    const { row, fill } = rows[i];
    const edge = i === 0 || i === 9;
    row.style.setProperty('--swatch-top', !edge && colors[0] ? format(colors[0]).css : '#FFFFFF');
    row.style.setProperty('--swatch-bottom', !edge && colors[9] ? format(colors[9]).css : '#000000');
    row.style.setProperty('--row-color', color ? format(color).css : 'transparent');
    const state = harmonies[i];
    const pair = color ? harmony(color,state.mode,state.theta,state.delta,state.chroma) : [];
    row.style.setProperty('--row-top', pair.length ? format(pair[0]).css : 'transparent');
    row.style.setProperty('--row-bottom', pair.length ? format(pair[1]).css : 'transparent');
    rows[i].number.classList.toggle('harmony-active',state.mode !== 'reset');
    rows[i].number.title = `Row ${i+1}: ${modeNames[state.mode]}. Click to change.`;
    row.classList.toggle('empty-row', !color);
    fill.style.background = color ? format(color).css : 'transparent';
  });
  updateMenu();
}
const angle = document.querySelector('#angle'), css = document.querySelector('#gradient-css'), stopsElement = document.querySelector('#stops');
function even() {
  const indices = colors.flatMap((c,i) => c ? [i] : []);
  indices.forEach((index,j) => positions[index] = indices.length === 1 ? 0 : Number((j*100/(indices.length-1)).toFixed(1)));
}
function updateGradient() {
  const value = gradient(colors,positions,Number(angle.value));
  document.querySelector('#gradient-fill').style.background = value || 'transparent';
  document.querySelector('#preview').classList.toggle('checker', colors.some(c => c && c.a < 1) || colors.every(c => !c));
  css.value = value ? `background: ${value};` : '';
  document.querySelector('#angle-value').value = `${angle.value}°`;
  const count = colors.filter(Boolean).length;
  document.querySelector('#gradient-note').textContent = count === 0 ? 'Fill a row to start.' : count === 1 ? 'One color: a solid background. Add another color for a gradient.' : 'CSS stops are sorted by position. Editors follow the palette row order.';
}
function renderGradient() {
  const key = colors.map((c,i) => c ? i : '').filter(v => v !== '').join(',');
  if (key !== filledKey) { filledKey = key; even(); }
  stopsElement.replaceChildren();
  colors.forEach((color,i) => {
    if (!color) return;
    const label = document.createElement('label'); label.className = 'stop';
    const chip = document.createElement('span'); chip.className = 'stop-chip'; chip.style.background = format(color).css;
    const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.max = '100'; input.step = '.1'; input.value = positions[i]; input.setAttribute('aria-label',`Row ${i+1} gradient position percent`);
    input.addEventListener('input', () => { if (input.value !== '' && Number.isFinite(input.valueAsNumber)) { positions[i] = clamp(input.valueAsNumber,0,100); updateGradient(); } });
    input.addEventListener('change', () => input.value = positions[i]);
    label.append(chip,`Row ${i+1} `,input,'%'); stopsElement.append(label);
  });
  updateGradient();
}
function seed() {
  harmonies.forEach(state => Object.assign(state,{mode:'reset',theta:30,delta:.15,chroma:1}));
  if (menu.matches(':popover-open')) menu.hidePopover();
  rows.forEach((_,i) => cancelPending(i));
  colors = ['white','#0969DA','tomato','rgba(40, 180, 99, 0.55)','hsl(270, 65%, 60%)','oklch(0.78 0.14 85)','rebeccapurple','#F778BA88','steelblue','black'].map(text => parse(text,names));
  filledKey = ''; angle.value = '90'; colors.forEach((_,i) => renderRow(i)); renderPreviews(); renderGradient();
}
angle.addEventListener('input',updateGradient);
document.querySelector('#even').addEventListener('click', () => { even(); renderGradient(); });
document.querySelector('#reset').addEventListener('click',seed);
document.querySelector('#copy-gradient').addEventListener('click', () => copy(css));
seed();
