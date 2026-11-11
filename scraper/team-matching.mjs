import {normalizeName,dateKey,timeKey} from './model.mjs';

// Deterministic abbreviations are safe only inside a unique fixture candidate.
export function teamIdentityKey(name){return normalizeName(String(name||'').replace(/\butd\b/gi,'United'));}
function category(name){
 const text=String(name||'').toLowerCase();
 const age=text.match(/\b(?:u|under)[\s-]?(\d{1,2})\b/)?.[1]||'';
 const women=/\b(women|woman|ladies|feminine|femenino|feminin|f|w)\b|žene|zene/.test(text);
 const reserves=/\b(reserves?|rezerva|ii|iii|b team)\b|\bb\s*$/.test(text);
 return [age,women,reserves].join('|');
}
function similarity(left,right){
 const a=teamIdentityKey(left),b=teamIdentityKey(right);if(!a||!b||category(left)!==category(right))return 0;
 if(a===b)return 1;
 const grams=s=>{const counts=new Map();for(let i=0;i<s.length-1;i++){const g=s.slice(i,i+2);counts.set(g,(counts.get(g)||0)+1);}return counts;};
 const x=grams(a),y=grams(b);let shared=0;for(const [g,count]of x)shared+=Math.min(count,y.get(g)||0);
 return 2*shared/Math.max(1,a.length+b.length-2);
}
export function candidateMatches(internal,events,date,aliases={},limit=3,preFiltered=false){
 const teams=String(internal.match||'').split(/\s+[–—-]\s+/);if(teams.length!==2)return [];
 const canonical=name=>{const key=normalizeName(name);return aliases.teams?.[key]||name;};
 return events.filter(e=>preFiltered||Number.isFinite(e.startTimestamp)&&dateKey(e.startTimestamp*1000)===date&&timeKey(e.startTimestamp*1000)===internal.time).map(e=>{
  if(category(teams[0])!==category(e.home)||category(teams[1])!==category(e.away))return null;
  const home=similarity(canonical(teams[0]),canonical(e.home)),away=similarity(canonical(teams[1]),canonical(e.away));
  if(home<0.55||away<0.55||(home+away<1.55&&Math.max(home,away)<0.95))return null;
  return {eventId:e.id,home:e.home,away:e.away,league:e.fullLeague||e.league||'',startTimestamp:e.startTimestamp,rank:home+away,url:e.url||null};
 }).filter(Boolean).sort((a,b)=>b.rank-a.rank||String(a.eventId).localeCompare(String(b.eventId))).slice(0,limit);
}
