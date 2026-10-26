export const pad = (value, width = 2) => String(value).padStart(width, '0');
export function toJdn(year, month, day) {
  const a = Math.floor((14-month)/12), y = year+4800-a, m = month+12*a-3;
  return day + Math.floor((153*m+2)/5) + 365*y + Math.floor(y/4) - Math.floor(y/100) + Math.floor(y/400) - 32045;
}
export function fromJdn(jdn) {
  const a = jdn+32044, b = Math.floor((4*a+3)/146097), c = a-Math.floor(146097*b/4), d = Math.floor((4*c+3)/1461), e = c-Math.floor(1461*d/4), m = Math.floor((5*e+2)/153);
  return { year:100*b+d-4800+Math.floor(m/10), month:m+3-12*Math.floor(m/10), day:e-Math.floor((153*m+2)/5)+1 };
}
export function localParts(date) { return { year:date.getFullYear(), month:date.getMonth()+1, day:date.getDate(), hour:date.getHours(), minute:date.getMinutes(), second:date.getSeconds(), millisecond:date.getMilliseconds() }; }
export function utcParts(date) { return { year:date.getUTCFullYear(), month:date.getUTCMonth()+1, day:date.getUTCDate(), hour:date.getUTCHours(), minute:date.getUTCMinutes(), second:date.getUTCSeconds(), millisecond:date.getUTCMilliseconds() }; }
export const dateText = p => `${p.year < 0 ? '-'+pad(-p.year,4) : pad(p.year,4)}-${pad(p.month)}-${pad(p.day)}`;
export const timeText = p => `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
export const civilText = (p, ms = false) => `${dateText(p)} ${timeText(p)}${ms ? '.'+pad(p.millisecond,3) : ''}`;
function validYmd(y,m,d) {
  if (!Number.isInteger(y) || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const back = fromJdn(toJdn(y,m,d)); return back.year === y && back.month === m && back.day === d;
}
export function localDate(p) {
  if (!validYmd(p.year,p.month,p.day)) throw new Error('Invalid Gregorian calendar date.');
  const date = new Date(0);
  date.setHours(12,0,0,0); date.setFullYear(p.year,p.month-1,p.day);
  date.setHours(p.hour || 0,p.minute || 0,p.second || 0,p.millisecond || 0);
  return date;
}
export function parseAny(input) {
  let text = input.trim(), kind = '', note = '';
  const wrapper = /^(?:TIMESTAMP(?:TZ)?\s*'([^']+)'|\{\s*ts\s*'([^']+)'\s*\})$/i.exec(text);
  if (wrapper) text = wrapper[1] || wrapper[2];
  let date;
  if (/^\d{8}$/.test(text)) {
    date = localDate({ year:+text.slice(0,4),month:+text.slice(4,6),day:+text.slice(6,8) }); kind = 'SQL Server style 112 · local midnight';
  } else if (/^[+-]?\d+$/.test(text)) {
    const n = Number(text);
    if (!Number.isSafeInteger(n)) throw new Error('Integer exceeds safe precision.');
    if (Math.abs(n) >= 1e11) { date = new Date(n); kind = 'Unix milliseconds'; }
    else if (Math.abs(n) >= 1e9) { date = new Date(n*1000); kind = 'Unix seconds'; }
    else if (n > 0 && n < 4e6) { date = localDate(fromJdn(n)); kind = 'Integer JDN · local midnight'; }
    else throw new Error('Integer is outside the Unix/JDN heuristics. Use ISO for dates near the Unix epoch.');
  } else {
    const civil = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(text);
    if (civil) {
      const [,y,m,d,h='0',min='0',s='0',f='',zone] = civil;
      const p = { year:+y,month:+m,day:+d,hour:+h,minute:+min,second:+s,millisecond:+(f+'000').slice(0,3) };
      if (!validYmd(p.year,p.month,p.day) || p.hour > 23 || p.minute > 59 || p.second > 59) throw new Error('Invalid calendar date or clock time.');
      if (zone) {
        if (zone !== 'Z' && zone !== 'z') { const z = zone.slice(1).replace(':',''); if (+z.slice(0,2) > 23 || +z.slice(2) > 59) throw new Error('Invalid UTC offset.'); }
        date = new Date(`${dateText(p)}T${timeText(p)}.${pad(p.millisecond,3)}${zone.toUpperCase()}`); kind = 'ISO / SQL datetime with explicit offset';
      } else {
        date = localDate(p); kind = civil[4] === undefined ? 'Date-only · local midnight' : 'Local civil datetime';
        if (civilText(localParts(date),true) !== civilText(p,true)) note = 'This local time falls in a clock-change gap and was moved forward by the browser.';
        else note = 'No offset supplied: interpreted in the browser time zone. Repeated DST times use the earlier occurrence.';
      }
      if (f.length > 3) note += ' Fractional seconds beyond milliseconds were truncated.';
    } else {
      date = new Date(Date.parse(text)); kind = 'Browser Date.parse fallback';
      note = 'Free-text parsing is browser-dependent. Prefer ISO with an explicit offset for verification.';
    }
  }
  if (!date || !Number.isFinite(date.getTime())) throw new Error('Could not parse this date/time, or it is outside the JavaScript Date range.');
  return { date, kind, note };
}
export function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', { timeZone, era:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23' }).formatToParts(date);
  const obj = Object.fromEntries(parts.map(p => [p.type,p.value]));
  return { year:obj.era === 'BC' ? 1-Number(obj.year) : Number(obj.year),month:+obj.month,day:+obj.day,hour:+obj.hour,minute:+obj.minute,second:+obj.second,millisecond:date.getUTCMilliseconds() };
}
export function offsetMinutes(date, zone) {
  const p = zonedParts(date,zone), utc = new Date(0);
  utc.setUTCFullYear(p.year,p.month-1,p.day); utc.setUTCHours(p.hour,p.minute,p.second,0);
  return Math.round((utc.getTime() - (date.getTime()-date.getUTCMilliseconds()))/60000);
}
export function offsetText(minutes, colon = true) { return `${minutes < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(minutes)/60))}${colon ? ':' : ''}${pad(Math.abs(minutes)%60)}`; }
export function sqlRows(date,dialect) {
  const p = localParts(date), u = utcParts(date), local = civilText(p), ms = civilText(p,true), iso = date.toISOString();
  const rows = [['Date (browser local)',dateText(p)],['Local datetime',local],['Local datetime · milliseconds',ms],['UTC datetime',civilText(u,true)],['Quoted local literal',`'${local}'`]];
  if (dialect === 'postgres') rows.push(['timestamptz ISO',iso],['TIMESTAMP literal',`TIMESTAMP '${ms}'`],['TIMESTAMPTZ literal',`TIMESTAMPTZ '${iso}'`]);
  else if (dialect === 'mssql') rows.push(['Style 112',dateText(p).replaceAll('-','')],['ISO · milliseconds',ms.replace(' ','T')],['ODBC timestamp',`{ts '${ms}'}`]);
  else if (dialect === 'oracle') rows.push(['DD-MON-YY',`${pad(p.day)}-${['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][p.month-1]}-${pad(p.year%100)}`],['TIMESTAMP literal',`TIMESTAMP '${ms}'`]);
  else rows.push(['ANSI TIMESTAMP',`TIMESTAMP '${ms}'`],['ISO SQL',ms.replace(' ','T')]);
  return rows;
}
export const tokenSheets = {
  datefns:[['yyyy / yy','Calendar year'],['MMMM / MMM / MM / M','Month name / number'],['dd / d','Day of month'],['EEEE / EEE / EEEEE','Weekday name'],['HH / H · hh / h','24-hour / 12-hour'],['mm / m · ss / s','Minute / second'],['SSS / SS / S','Fractional seconds'],['a','AM / PM'],['XXX / XX / X','UTC offset; Z for UTC'],['xxx / xx / x','UTC offset; numeric UTC'],["'literal' / ''",'Literal text / single quote'] ],
  dayjs:[['YYYY / YY','Calendar year'],['MMMM / MMM / MM / M','Month name / number'],['DD / D','Day of month'],['dddd / ddd / dd / d','Weekday name / number (Sunday 0)'],['HH / H · hh / h','24-hour / 12-hour'],['mm / m · ss / s','Minute / second'],['SSS','Milliseconds'],['A / a','AM / PM or am / pm'],['Z / ZZ','UTC offset'],['[literal] / \\x','Literal text / escape next character'] ]
};
export const defaults = { datefns:'yyyy-MM-dd HH:mm:ss.SSS XXX',dayjs:'YYYY-MM-DD HH:mm:ss.SSS Z' };
export const presets = {
  datefns:[defaults.datefns,'EEEE, d MMMM yyyy',"yyyy-MM-dd'T'HH:mm:ssXXX",'dd/MM/yyyy','MM/dd/yyyy',"h:mm a 'on' MMM d"],
  dayjs:[defaults.dayjs,'dddd, D MMMM YYYY','YYYY-MM-DD[T]HH:mm:ssZ','DD/MM/YYYY','MM/DD/YYYY','h:mm A [on] MMM D']
};
export function formatPattern(date, pattern, dialect, locale, zone) {
  const p = zonedParts(date,zone), off = offsetMinutes(date,zone);
  const name = options => new Intl.DateTimeFormat(locale,{...options,timeZone:zone,calendar:'gregory'}).format(date);
  const weekday = ((toJdn(p.year,p.month,p.day)+1)%7+7)%7;
  const common = { MM:pad(p.month), M:String(p.month), MMM:name({month:'short'}),MMMM:name({month:'long'}),HH:pad(p.hour),H:String(p.hour),hh:pad(p.hour%12||12),h:String(p.hour%12||12),mm:pad(p.minute),m:String(p.minute),ss:pad(p.second),s:String(p.second),SSS:pad(p.millisecond,3) };
  const map = dialect === 'datefns' ? { ...common,yyyy:pad(p.year,4),yy:pad(p.year%100),dd:pad(p.day),d:String(p.day),EEEE:name({weekday:'long'}),EEE:name({weekday:'short'}),EE:name({weekday:'short'}),E:name({weekday:'short'}),EEEEE:name({weekday:'narrow'}),a:p.hour<12?'AM':'PM',SS:pad(p.millisecond,3).slice(0,2),S:pad(p.millisecond,3).slice(0,1),XXX:off===0?'Z':offsetText(off),XX:off===0?'Z':offsetText(off,false),X:off===0?'Z':offsetText(off,false).replace(/00$/,''),xxx:offsetText(off),xx:offsetText(off,false),x:offsetText(off,false).replace(/00$/,'') }
    : { ...common,YYYY:pad(p.year,4),YY:pad(p.year%100),DD:pad(p.day),D:String(p.day),dddd:name({weekday:'long'}),ddd:name({weekday:'short'}),dd:name({weekday:'short'}).slice(0,2),d:String(weekday),A:p.hour<12?'AM':'PM',a:p.hour<12?'am':'pm',Z:offsetText(off),ZZ:offsetText(off,false) };
  const tokens = Object.keys(map).sort((a,b) => b.length-a.length);
  let output = '', i = 0;
  while (i < pattern.length) {
    if (dialect === 'datefns' && pattern[i] === "'") {
      if (pattern[i+1] === "'") { output += "'"; i+=2; continue; }
      i++; let closed = false;
      while (i < pattern.length) {
        if (pattern[i] === "'") { if (pattern[i+1] === "'") { output += "'"; i+=2; } else { i++; closed=true; break; } }
        else output += pattern[i++];
      }
      if (!closed) throw new Error('Unclosed literal: wrap literal text in single quotes.');
      continue;
    }
    if (dialect === 'dayjs' && pattern[i] === '[') {
      const end = pattern.indexOf(']',i+1); if (end < 0) throw new Error('Unclosed bracket literal.');
      output += pattern.slice(i+1,end); i=end+1; continue;
    }
    if (dialect === 'dayjs' && pattern[i] === '\\') { if (++i >= pattern.length) throw new Error('Escape needs a following character.'); output += pattern[i++]; continue; }
    if (/[A-Za-z]/.test(pattern[i])) {
      let end = i+1;
      while (pattern[end] === pattern[i]) end++;
      if (!Object.hasOwn(map,pattern.slice(i,end))) throw new Error(`Unsupported token “${pattern.slice(i,end)}”. See the supported token sheet.`);
    }
    const token = tokens.find(t => pattern.startsWith(t,i));
    if (token) { output += map[token]; i+=token.length; }
    else if (/[A-Za-z]/.test(pattern[i])) throw new Error(`Unsupported token at “${pattern.slice(i,i+8)}”. See the supported token sheet; quote literal text.`);
    else output += pattern[i++];
  }
  return output;
}
