import {normalizeName,dateKey,timeKey} from './model.mjs';

export const AUTO_MATCH_THRESHOLD=0.8;
export const AUTO_MATCH_MARGIN=0.05;
// Deterministic abbreviations are safe only inside a unique fixture candidate.
export function teamIdentityKey(name){return normalizeName(String(name||'').replace(/\butd\b/gi,'United'));}
function category(name){
 const text=String(name||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
 const age=text.match(/\b(?:u|under)[\s-]?(\d{1,2})\b/)?.[1]||'';
 const women=/\b(women|womens|woman|ladies|female|feminine|femenin[oa]|feminin|fem|f|w|zene|zenska|zenski)\b/.test(text);
 const reserves=/\b(iii|c team)\b|\bc\s*\)?$/.test(text)?'third':/\b(reserves?|rezerva|ii|b team)\b|\bb\s*\)?$/.test(text)?'reserve':'';
 return [age,women,reserves].join('|');
}
// Reuse only name-derived data; no operator aliases or decisions enter this cache.
const clubProfileCache=new Map();
function clubProfile(name){
 const text=String(name||'');if(clubProfileCache.has(text))return clubProfileCache.get(text);
 const key=teamIdentityKey(text),grams=new Map();
 for(let i=0;i<key.length-1;i++){const gram=key.slice(i,i+2);grams.set(gram,(grams.get(gram)||0)+1);}
 const profile={key,normalized:normalizeName(text),category:category(text),grams};
 clubProfileCache.set(text,profile);if(clubProfileCache.size>4096)clubProfileCache.delete(clubProfileCache.keys().next().value);
 return profile;
}
function nameSimilarity(left,right){
 const a=clubProfile(left),b=clubProfile(right);if(!a.key||!b.key)return 0;
 if(a.key===b.key)return 1;
 let shared=0;for(const [g,count]of a.grams)shared+=Math.min(count,b.grams.get(g)||0);
 return 2*shared/Math.max(1,a.key.length+b.key.length-2);
}
export function teamSimilarity(left,right){return clubProfile(left).category===clubProfile(right).category?nameSimilarity(left,right):0;}
function scoredClubCandidates(internal,events,date,aliases={},preFiltered=false){
 const teams=String(internal.match||'').split(/\s+[–—-]\s+/);if(teams.length!==2)return [];
 const canonical=name=>{const key=clubProfile(name).normalized;return Object.hasOwn(aliases.teams||{},key)?aliases.teams[key]:name;};
 const homeCategory=clubProfile(teams[0]).category,awayCategory=clubProfile(teams[1]).category,homeName=canonical(teams[0]),awayName=canonical(teams[1]);
 return events.filter(e=>preFiltered||Number.isFinite(e.startTimestamp)&&dateKey(e.startTimestamp*1000)===date&&timeKey(e.startTimestamp*1000)===internal.time).map(e=>{
  if(homeCategory!==clubProfile(e.home).category||awayCategory!==clubProfile(e.away).category)return null;
  const homeSimilarity=nameSimilarity(homeName,canonical(e.home));if(homeSimilarity<0.55)return null;
  const awaySimilarity=nameSimilarity(awayName,canonical(e.away));if(awaySimilarity<0.55)return null;
  return {event:e,homeSimilarity,awaySimilarity,rank:homeSimilarity+awaySimilarity};
 }).filter(Boolean).sort((a,b)=>b.rank-a.rank||String(a.event.id).localeCompare(String(b.event.id)));
}
export function similarityMatch(internal,events,date,aliases={},preFiltered=false){
 const ranked=scoredClubCandidates(internal,events,date,aliases,preFiltered);
 const best=ranked.find(candidate=>candidate.homeSimilarity>=AUTO_MATCH_THRESHOLD&&candidate.awaySimilarity>=AUTO_MATCH_THRESHOLD);
 if(!best)return {reason:'Nema poklapanja oba kluba od najmanje 80% uz isti datum i vreme početka. Naziv takmičenja nije uslov. Proverite predloge ili povežite nazive klubova.'};
 // Check all candidates in this kickoff slot, including a rival just below 80%.
 // Similarity is a name score, not a probability that the fixture is correct.
 if(ranked.some(candidate=>candidate!==best&&best.rank-candidate.rank<2*AUTO_MATCH_MARGIN-1e-12))return {reason:'Više bliskih kandidata: razlika u prosečnoj sličnosti oba kluba manja je od 5 procentnih poena. Potrebna je ručna potvrda meča.'};
 return {event:best.event,matching:{method:'similarity',homeSimilarity:best.homeSimilarity,awaySimilarity:best.awaySimilarity,threshold:AUTO_MATCH_THRESHOLD}};
}
export function candidateMatches(internal,events,date,aliases={},limit=3,preFiltered=false){
 return scoredClubCandidates(internal,events,date,aliases,preFiltered).filter(c=>c.rank>=1.55||Math.max(c.homeSimilarity,c.awaySimilarity)>=0.95).slice(0,limit).map(c=>({eventId:c.event.id,home:c.event.home,away:c.event.away,league:c.event.fullLeague||c.event.league||'',startTimestamp:c.event.startTimestamp,rank:c.rank,homeSimilarity:c.homeSimilarity,awaySimilarity:c.awaySimilarity,url:c.event.url||null}));
}
