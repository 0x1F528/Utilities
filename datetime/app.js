import { pad, toJdn, localParts, utcParts, dateText, civilText, parseAny, zonedParts, offsetMinutes, offsetText, sqlRows, tokenSheets, defaults, presets, formatPattern } from './dates.js';

const $ = selector => document.querySelector(selector);
let instant = new Date(), locale = 'en-GB';
const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
let zone = browserZone;
let supportedZones;
try { supportedZones = Intl.supportedValuesOf('timeZone'); } catch { supportedZones = ['UTC','Europe/Zurich','Europe/London','America/New_York','America/Los_Angeles','Asia/Tokyo','Asia/Kolkata','Australia/Sydney']; }
for (const name of [...new Set([browserZone,'UTC',...supportedZones])]) { const option = document.createElement('option'); option.value = name; option.textContent = name === browserZone ? `${name} (browser)` : name; $('#zone').append(option); }
$('#zone').value = zone;
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'),3500); }
async function copy(value, source) {
  try { await navigator.clipboard.writeText(value); toast('Copied to clipboard.'); }
  catch {
    if (source instanceof HTMLTextAreaElement || source instanceof HTMLInputElement) { source.focus(); source.select(); }
    else { const selection = window.getSelection(), range = document.createRange(); range.selectNodeContents(source); selection.removeAllRanges(); selection.addRange(range); }
    toast('Clipboard unavailable. Text selected — press Ctrl+C (or ⌘C).');
  }
}
function table(target, entries) {
  const element = typeof target === 'string' ? $(target) : target, table = document.createElement('table'); table.className = 'values';
  const body = document.createElement('tbody');
  for (const [label,value] of entries) {
    const row = document.createElement('tr'), heading = document.createElement('th'), cell = document.createElement('td'), wrap = document.createElement('div'), code = document.createElement('code'), button = document.createElement('button');
    heading.scope = 'row'; heading.textContent = label; code.textContent = String(value); wrap.className = 'value'; button.className = 'copy'; button.textContent = '⧉'; button.title = `Copy ${label}`; button.setAttribute('aria-label',`Copy ${label}`); button.addEventListener('click',() => copy(String(value),code)); wrap.append(code,button); cell.append(wrap); row.append(heading,cell); body.append(row);
  }
  table.append(body); element.replaceChildren(table);
}
function setPicker() {
  const p = localParts(instant);
  $('#source').value = p.year > 0 && p.year <= 9999 ? civilText(p,true).replace(' ','T') : '';
}
function accept(date, message = '') {
  instant = date; setPicker(); $('#source').removeAttribute('aria-invalid'); $('#parse').removeAttribute('aria-invalid'); $('#parse-feedback').classList.remove('error'); $('#parse-feedback').textContent = message; render();
}
function relative() {
  const seconds = (instant.getTime()-Date.now())/1000, abs = Math.abs(seconds);
  const [unit,size] = abs < 60 ? ['second',1] : abs < 3600 ? ['minute',60] : abs < 86400 ? ['hour',3600] : abs < 604800 ? ['day',86400] : abs < 2629800 ? ['week',604800] : abs < 31557600 ? ['month',2629800] : ['year',31557600];
  return new Intl.RelativeTimeFormat(locale,{numeric:'auto'}).format(Math.round(seconds/size),unit);
}
function render() {
  const local = localParts(instant), utc = utcParts(instant), chosen = zonedParts(instant,zone), appJdn = toJdn(local.year,local.month,local.day), utcJdn = toJdn(utc.year,utc.month,utc.day);
  table('#instant',[
    ['ISO UTC',instant.toISOString()],['Browser-local string',instant.toString()],['Browser-local civil',civilText(local,true)],['Display-zone civil',`${civilText(chosen,true)} ${offsetText(offsetMinutes(instant,zone))}`],['Display time zone',zone],['Browser time zone',browserZone]
  ]);
  table('#julian',[
    ['App JDN · local date',appJdn],['Local Gregorian date',dateText(local)],['UTC date JDN',utcJdn],['UTC Gregorian date',dateText(utc)],['JDN same?',appJdn === utcJdn ? 'Yes' : 'No — local and UTC dates differ'],['Unix seconds',Math.floor(instant.getTime()/1000)],['Unix milliseconds',instant.getTime()]
  ]);
  $('#status').textContent = `${instant.toISOString()}  ·  App JDN ${appJdn}  ·  ${browserZone}`;
  renderSQL();
  const intl = options => new Intl.DateTimeFormat(locale,{...options,timeZone:zone}).format(instant);
  table('#locale-rows',[
    ['Resolved locale',new Intl.DateTimeFormat(locale).resolvedOptions().locale],['Full date & long time',intl({dateStyle:'full',timeStyle:'long'})],['Long date',intl({dateStyle:'long'})],['Medium date & time',intl({dateStyle:'medium',timeStyle:'medium'})],['Short date & time',intl({dateStyle:'short',timeStyle:'short'})],['24-hour time',intl({hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})],['12-hour time',intl({hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true})],['Relative to now',relative()]
  ]);
  const options = {timeZone:zone,dateStyle:'full',timeStyle:'long'};
  $('#intl-snippet').value = `const instant = new Date(${JSON.stringify(instant.toISOString())});\nnew Intl.DateTimeFormat(${JSON.stringify(locale)}, ${JSON.stringify(options,null,2)}).format(instant);`;
  renderFormat();
}
function renderSQL() { table('#sql',sqlRows(instant,$('#sql-dialect').value)); }
function renderFormat() {
  const dialect = $('#format-dialect').value, pattern = $('#pattern').value;
  try {
    const output = formatPattern(instant,pattern,dialect,locale,zone);
    $('#pattern').removeAttribute('aria-invalid'); $('#pattern-error').textContent = ''; table('#formatted',[['Formatted output',output]]);
    const escaped = dialect === 'dayjs' ? pattern.replace(/\\(.)/g,(_,character) => `[${character}]`) : pattern;
    const d = JSON.stringify(instant.toISOString()), z = JSON.stringify(zone), p = JSON.stringify(escaped);
    if (dialect === 'datefns') {
      const localeId = ({'en-gb':'enGB','en-us':'enUS','de-ch':'de','de':'de','de-de':'de','fr':'fr','fr-fr':'fr','fr-ch':'frCH','es':'es','es-es':'es','ja':'ja','ja-jp':'ja','it':'it','it-it':'it'})[locale.toLowerCase()];
      $('#library-snippet').value = `import { formatInTimeZone } from 'date-fns-tz';\n${localeId ? `import { ${localeId} } from 'date-fns/locale';\n` : '// Import a matching locale object from date-fns/locale to localize names.\n'}\nconst instant = new Date(${d});\nformatInTimeZone(instant, ${z}, ${p}${localeId ? `, { locale: ${localeId} }` : ''});`;
      $('#library-note').textContent = 'Requires date-fns and date-fns-tz in your application. This page uses Intl only. A BCP-47 locale string is not a date-fns locale object.';
    } else {
      const code = locale.toLowerCase() === 'en-us' ? 'en' : locale.toLowerCase();
      $('#library-snippet').value = `import dayjs from 'dayjs';\nimport utc from 'dayjs/plugin/utc';\nimport timezone from 'dayjs/plugin/timezone';\n${code === 'en' ? '' : `// Verify this locale module exists in your Day.js version.\nimport ${JSON.stringify('dayjs/locale/'+code)};\n`}dayjs.extend(utc);\ndayjs.extend(timezone);\n\ndayjs(${d}).tz(${z}).locale(${JSON.stringify(code)}).format(${p});\n\n// Moment + moment-timezone equivalent (load matching locale):\n// moment(${d}).tz(${z}).locale(${JSON.stringify(code)}).format(${p});`;
      $('#library-note').textContent = 'Requires Day.js with UTC/timezone plugins (or Moment with moment-timezone). Load matching locale data; locale file names vary. Backslash escapes are translated to bracket literals in the template.';
    }
  } catch (error) {
    $('#pattern').setAttribute('aria-invalid','true'); $('#pattern-error').textContent = error.message; table('#formatted',[['Formatted output','— Invalid or unsupported pattern']]); $('#library-snippet').value = '// Fix the pattern above to generate a library call.';
  }
}
function dialectChanged() {
  const dialect = $('#format-dialect').value; $('#pattern').value = defaults[dialect]; $('#preset').replaceChildren();
  for (const pattern of presets[dialect]) { const option = document.createElement('option'); option.value = pattern; option.textContent = pattern; $('#preset').append(option); }
  table('#cheats',tokenSheets[dialect]); renderFormat();
}
function debounce(fn) { let timer; const callback = () => { clearTimeout(timer); timer = setTimeout(fn,180); }; callback.cancel = () => clearTimeout(timer); return callback; }
function parseSource() {
  if (!$('#parse').value.trim()) { $('#parse').removeAttribute('aria-invalid'); $('#parse-feedback').textContent = ''; return; }
  try { const result = parseAny($('#parse').value); accept(result.date,`${result.kind}. ${result.note}`); }
  catch (error) { $('#parse').setAttribute('aria-invalid','true'); $('#parse-feedback').classList.add('error'); $('#parse-feedback').textContent = `${error.message} Last valid instant is still displayed.`; }
}
function applyLocale() {
  try {
    const value = $('#locale').value.trim();
    if (!value) throw new Error('Enter a BCP-47 locale, for example en-GB.');
    const canonical = Intl.getCanonicalLocales(value)[0]; new Intl.DateTimeFormat(canonical);
    locale = canonical; $('#locale').removeAttribute('aria-invalid');
    $('#settings-feedback').textContent = Intl.DateTimeFormat.supportedLocalesOf([canonical]).length ? '' : `Locale data for ${canonical} is unavailable; the browser uses its fallback locale.`;
    render();
  } catch (error) { $('#locale').setAttribute('aria-invalid','true'); $('#settings-feedback').textContent = `Invalid locale. ${error.message} Keeping ${locale}.`; }
}
const parseLater = debounce(parseSource), localeLater = debounce(applyLocale), patternLater = debounce(renderFormat);
$('#parse').addEventListener('input',parseLater);
$('#parse').addEventListener('keydown',event => { if (event.key === 'Enter') { parseLater.cancel(); parseSource(); } });
$('#parse-button').addEventListener('click',() => { parseLater.cancel(); parseSource(); });
$('#source').addEventListener('change',() => {
  parseLater.cancel();
  try { const result = parseAny($('#source').value); accept(result.date,result.note); }
  catch (error) { $('#source').setAttribute('aria-invalid','true'); $('#parse-feedback').classList.add('error'); $('#parse-feedback').textContent = error.message; }
});
for (const [id,today] of [['#now',false],['#today',true]]) $(id).addEventListener('click',() => {
  parseLater.cancel(); const date = new Date(); if (today) date.setHours(0,0,0,0); $('#parse').value = ''; accept(date,today?'Today at browser-local midnight.':'Current instant captured.');
});
$('#zone').addEventListener('change',() => { zone = $('#zone').value; render(); });
$('#locale').addEventListener('input',localeLater);
$('#locale').addEventListener('keydown',event => { if (event.key === 'Enter') { localeLater.cancel(); applyLocale(); } });
$('#sql-dialect').addEventListener('change',renderSQL);
$('#format-dialect').addEventListener('change',() => { patternLater.cancel(); dialectChanged(); });
$('#pattern').addEventListener('input',patternLater);
$('#pattern').addEventListener('keydown',event => { if (event.key === 'Enter') { patternLater.cancel(); renderFormat(); } });
$('#preset').addEventListener('change',() => { patternLater.cancel(); $('#pattern').value = $('#preset').value; renderFormat(); });
for (const button of document.querySelectorAll('[data-copy]')) button.addEventListener('click',() => { const source = document.getElementById(button.dataset.copy); copy(source.value,source); });
setPicker(); dialectChanged(); render();
