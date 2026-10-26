import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {sunPosition,solarAltitude,mapPoint,position,validPlace,clockParts} from '../Hello/clock.js';
test('solar position follows equinox noon, midnight and solstice polar daylight',()=>{
 const spring=sunPosition(new Date('2026-03-20T12:00:00Z'));assert.ok(Math.abs(spring.lat)<1);assert.ok(Math.abs(spring.lon)<3);
 assert.ok(solarAltitude(0,spring.lon,spring)>89);assert.ok(solarAltitude(0,spring.lon+180,spring)<-89);
 const summer=sunPosition(new Date('2026-06-21T12:00:00Z'));assert.ok(summer.lat>23&&summer.lat<24);assert.ok(solarAltitude(89,180,summer)>0);
 const winter=sunPosition(new Date('2026-12-21T12:00:00Z'));assert.ok(winter.lat<-23&&winter.lat>-24);assert.ok(solarAltitude(89,0,winter)<0);
});
test('map coordinates, saved place validation and DST formatting',()=>{
 const p=mapPoint(540,135,720,360);assert.equal(p.lon,90);assert.equal(p.lat,22.5);assert.deepEqual(position(p),{x:.75,y:.375});
 assert.ok(validPlace({...p,zone:'Europe/Zurich'}));assert.ok(!validPlace({...p,zone:'Invalid/Zone'}));assert.ok(!validPlace({...p,lat:100,zone:'UTC'}));
 assert.equal(clockParts(new Date('2026-01-01T12:00:00Z'),'Europe/Zurich').time,'13:00:00');assert.equal(clockParts(new Date('2026-07-01T12:00:00Z'),'Europe/Zurich').time,'14:00:00');
});
test('bundled timezone lookup runs without network and map geometry is valid',()=>{
 const sandbox={};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(new URL('../Hello/vendor/tz.js',import.meta.url),'utf8'),sandbox);
 for(const [lat,lon,zone] of [[47.37,8.54,'Europe/Zurich'],[40.71,-74.01,'America/New_York'],[35.68,139.69,'Asia/Tokyo']])assert.equal(sandbox.tzlookup(lat,lon),zone);
 const map=JSON.parse(fs.readFileSync(new URL('../Hello/vendor/land.json',import.meta.url),'utf8'));assert.ok(map.features.length>50);
});
