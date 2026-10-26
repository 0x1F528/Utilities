
const rad=Math.PI/180;
export const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export function mapPoint(x,y,width,height){return {lon:clamp(x/width*360-180,-179.9999,179.9999),lat:clamp(90-y/height*180,-89.9999,89.9999)};}
export function position(point){return {x:(point.lon+180)/360,y:(90-point.lat)/180};}
// Low-precision solar ephemeris: declination + Greenwich sidereal angle, adequate for a daylight map.
export function sunPosition(date){
  const days=date.getTime()/86400000+2440587.5-2451545;
  const mean=(280.46+.9856474*days)*rad,anomaly=(357.528+.9856003*days)*rad;
  const lambda=mean+(1.915*Math.sin(anomaly)+.02*Math.sin(2*anomaly))*rad;
  const obliquity=(23.439-.0000004*days)*rad;
  const rightAscension=Math.atan2(Math.cos(obliquity)*Math.sin(lambda),Math.cos(lambda))/rad;
  const latitude=Math.asin(Math.sin(obliquity)*Math.sin(lambda))/rad;
  const sidereal=280.46061837+360.98564736629*days;
  const longitude=((rightAscension-sidereal)%360+540)%360-180;
  return {lat:latitude,lon:longitude};
}
export function solarAltitude(lat,lon,sun){return Math.asin(clamp(Math.sin(lat*rad)*Math.sin(sun.lat*rad)+Math.cos(lat*rad)*Math.cos(sun.lat*rad)*Math.cos((lon-sun.lon)*rad),-1,1))/rad;}
export function validZone(zone){try{new Intl.DateTimeFormat('en',{timeZone:zone});return typeof zone==='string'&&zone.length>0;}catch{return false;}}
export function validPlace(point){return point&&Number.isFinite(point.lat)&&Math.abs(point.lat)<=90&&Number.isFinite(point.lon)&&Math.abs(point.lon)<=180&&validZone(point.zone);}
export function clockParts(date,zone){return {time:new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(date),date:new Intl.DateTimeFormat('en-GB',{timeZone:zone,weekday:'short',day:'numeric',month:'short',year:'numeric'}).format(date)};}
