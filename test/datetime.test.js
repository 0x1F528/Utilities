import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { toJdn, fromJdn, parseAny, localParts, civilText, zonedParts, offsetMinutes, formatPattern, sqlRows } from '../datetime/dates.js';

test('Gregorian JDN anchors, leap years, and round trips', () => {
  assert.equal(toJdn(2000,1,1),2451545);
  assert.equal(toJdn(1970,1,1),2440588);
  for (const ymd of [[1,1,1],[0,1,1],[-4713,11,25],[1900,2,28],[2000,2,29],[2026,10,17],[6000,12,31]]) {
    const [year,month,day] = ymd; assert.deepEqual(fromJdn(toJdn(year,month,day)),{year,month,day});
  }
  assert.equal(toJdn(1900,3,1)-toJdn(1900,2,28),1);
  assert.equal(toJdn(2000,3,1)-toJdn(2000,2,28),2);
});
test('parsing uses strict calendar checks, wrapper removal, precision and magnitude rules', () => {
  for (const input of ['2000-01-01','20000101','2451545']) {
    const p = localParts(parseAny(input).date); assert.equal(civilText(p,true),'2000-01-01 00:00:00.000');
  }
  for (const text of ["TIMESTAMP '2026-10-17 12:34:56.123456'", "{ts '2026-10-17 12:34:56.123456'}"]) assert.equal(civilText(localParts(parseAny(text).date),true),'2026-10-17 12:34:56.123');
  assert.equal(parseAny("TIMESTAMPTZ '2026-10-17T12:34:56+02:00'").date.toISOString(),'2026-10-17T10:34:56.000Z');
  assert.equal(parseAny('1700000000').date.getTime(),1700000000000);
  assert.equal(parseAny('1700000000000').date.getTime(),1700000000000);
  assert.equal(parseAny('-1700000000').date.getTime(),-1700000000000);
  assert.equal(parseAny('0001-01-01').date.getFullYear(),1);
  for (const text of ['2026-02-29','1900-02-29','20260230','2026-01-01 24:00:00','2026-01-01T12:00:00+25:00','invalid','2451545.5','0','999999999999999999']) assert.throws(() => parseAny(text),text);
});
test('display zone projection, offsets, token dialects and SQL are independent', () => {
  const date = new Date('2026-01-01T23:04:05.067Z');
  assert.equal(civilText(zonedParts(date,'Asia/Tokyo'),true),'2026-01-02 08:04:05.067');
  assert.equal(offsetMinutes(date,'Asia/Kolkata'),330);
  assert.equal(formatPattern(date,"yyyy-MM-dd'T'HH:mm:ss.SSS XXX",'datefns','en-GB','Asia/Kolkata'),'2026-01-02T04:34:05.067 +05:30');
  assert.equal(formatPattern(date,'YYYY-MM-DD[T]HH:mm:ss.SSS Z','dayjs','en-GB','UTC'),'2026-01-01T23:04:05.067 +00:00');
  assert.equal(formatPattern(date,"'it''s' EEEE",'datefns','en-GB','UTC'),"it's Thursday");
  assert.equal(formatPattern(date,'[day] d \\Y','dayjs','en-GB','UTC'),'day 4 Y');
  assert.equal(formatPattern(date,'MMMM','datefns','fr-FR','UTC'),'janvier');
  assert.throws(() => formatPattern(date,'YYYY-MM-DD','datefns','en-GB','UTC'));
  assert.throws(() => formatPattern(date,'DDDD','dayjs','en-GB','UTC'));
  assert.throws(() => formatPattern(date,"'unterminated",'datefns','en-GB','UTC'));
  assert.throws(() => formatPattern(date,'[unterminated','dayjs','en-GB','UTC'));
  assert.ok(sqlRows(date,'mssql').some(([label,value]) => label === 'ODBC timestamp' && value.startsWith("{ts '")));
  assert.ok(sqlRows(date,'postgres').some(([label]) => label === 'TIMESTAMPTZ literal'));
  assert.ok(sqlRows(date,'oracle').some(([label]) => label === 'DD-MON-YY'));
  assert.equal(date.toISOString(),'2026-01-01T23:04:05.067Z');
});
test('browser-local semantics across DST gaps, repeated times, and UTC date boundaries', () => {
  const url = new URL('../datetime/dates.js',import.meta.url).href;
  const script = `import assert from 'node:assert/strict';
    import { parseAny, localParts, toJdn } from ${JSON.stringify(url)};
    const gap = parseAny('2026-03-08 02:30:00');
    assert.equal(gap.date.toISOString(), '2026-03-08T07:30:00.000Z');
    assert.match(gap.note, /gap/);
    assert.equal(parseAny('2026-11-01 01:30:00').date.toISOString(),'2026-11-01T05:30:00.000Z');
    const midnight = parseAny('2451545').date;
    assert.equal(midnight.toISOString(),'2000-01-01T05:00:00.000Z');
    const local = localParts(new Date('2026-01-01T01:00:00Z'));
    assert.equal(toJdn(local.year,local.month,local.day),toJdn(2025,12,31));`;
  execFileSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,TZ:'America/New_York'},windowsHide:true});
});
