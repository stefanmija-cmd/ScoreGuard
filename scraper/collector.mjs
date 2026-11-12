import {SOURCE_NAMES,matchEvent,eventReference,validateWatch,dateKey,timeKey,INTERVAL_MS,FRESH_MS,canonicalClubKey} from './model.mjs';
import {scrapeFlashscore} from './providers/flashscore.mjs';
import {scrapeFutbol24} from './providers/futbol24.mjs';
import {compileTeamAliases} from './team-aliases.mjs';
import {candidateMatches} from './team-matching.mjs';
import {createApiFootballProvider} from './providers/api-football.mjs';
export function createCollector({fetcher=globalThis.fetch,clock=()=>Date.now(),providers={},aliases={},cacheMs=INTERVAL_MS,manualMinIntervalMs=15000,apiFootball={}}={}) {
 const implementations={flash:scrapeFlashscore,f24:scrapeFutbol24,api:createApiFootballProvider({...apiFootball,clock}),...providers},cooldowns=new Map(),cache=new Map(),inflight=new Map();
 const stats={requests:0,cacheHits:0,joinedRequests:0};
 async function feed(source,date,trigger){
  const key=source+':'+date,entry=cache.get(key),age=entry?clock()-entry.fetchedAt:Infinity;
  const reuse=trigger==='manual'?manualMinIntervalMs:cacheMs;
  if(entry&&age>=0&&age<reuse&&clock()-entry.dataFreshAt<FRESH_MS){stats.cacheHits++;return {...entry,cacheHit:true};}
  if(inflight.has(key)){stats.joinedRequests++;return {...await inflight.get(key),cacheHit:true};}
  const pending=(async()=>{
   const until=cooldowns.get(source)||0;
   if(until>clock()){const e=Error('Izvor je zatražio pauzu; novi zahtev tek posle '+new Date(until).toISOString()+'.');e.code='BACKOFF';e.retryAt=new Date(until).toISOString();throw e;}
   try{
    stats.requests++;
    const freshBaseAt=clock(),events=await implementations[source]({date,now:freshBaseAt,fetcher}),fetchedAt=clock(),slots=new Map();
    for(const e of events){if(!Number.isFinite(e.startTimestamp))continue;const slot=dateKey(e.startTimestamp*1000)+' '+timeKey(e.startTimestamp*1000);if(!slots.has(slot))slots.set(slot,[]);slots.get(slot).push(e);}
    const sourceAgeMs=Math.max(0,events.sourceAgeMs||0),fresh={events,slots,fetchedAt,freshBaseAt,sourceAgeMs,dataFreshAt:freshBaseAt-sourceAgeMs,cacheHit:false};cache.set(key,fresh);
    if(cache.size>32){const oldest=[...cache].sort((a,b)=>a[1].fetchedAt-b[1].fetchedAt)[0][0];cache.delete(oldest);}
    return fresh;
   }catch(error){
    const pause=error.code==='RATE_LIMIT'?Math.max(error.retryAfterMs||0,INTERVAL_MS):error.code==='BLOCKED'?INTERVAL_MS:15000;
    cooldowns.set(source,clock()+pause);error.retryAt=new Date(clock()+pause).toISOString();throw error;
   }
  })();
  inflight.set(key,pending);try{return await pending;}finally{inflight.delete(key);}
 }
 async function collect(config,{teamAliases=[],trigger='scheduled'}={}) {
  const effectiveAliases=compileTeamAliases(aliases,teamAliases);
  const watch=validateWatch(config),startedAt=new Date(clock()).toISOString(),feeds={},health={};
  const dates=[...new Set(watch.matches.map(m=>m.date||watch.date))];
  await Promise.all(watch.sources.map(async source=>{
   feeds[source]={};const failures=[],successes=[];
   await Promise.all(dates.map(async date=>{
    try {
     const data=await feed(source,date,trigger);
     feeds[source][date]=data;successes.push({date,eventCount:data.events.length,checkedAt:new Date(data.fetchedAt).toISOString(),cacheHit:data.cacheHit});
    }catch(error){
     failures.push({date,code:error.code||'SOURCE_ERROR',httpStatus:error.httpStatus||null,message:SOURCE_NAMES[source]+': '+(error.message||'Prikupljanje podataka nije uspelo.'),retryAt:error.retryAt||null});
    }
   }));
   const eventCount=successes.reduce((n,item)=>n+item.eventCount,0);
   health[source]={state:failures.length?(successes.length?'partial':'unavailable'):'available',code:failures[0]?.code||'OK',eventCount,checkedAt:new Date(clock()).toISOString(),message:failures.length?failures.map(f=>f.date+' · '+f.message).join(' '):SOURCE_NAMES[source]+': preuzeto '+eventCount+' fudbalskih mečeva za '+dates.length+' kalendarskih dana.',dates:successes,failures};
  }));
  const indexes={};
  for(const source of watch.sources){indexes[source]={};for(const date of dates){const data=feeds[source]?.[date];if(!data)continue;const pairs=new Map();for(const [slot,events]of data.slots)for(const event of events){const home=canonicalClubKey(event.home,effectiveAliases[source]),away=canonicalClubKey(event.away,effectiveAliases[source]),key=slot+'|'+home+'|'+away;if(!pairs.has(key))pairs.set(key,[]);pairs.get(key).push(event);}indexes[source][date]={pairs};}}
  const checkedAt=new Date(clock()).toISOString();
  const results=watch.matches.map(m=>{
   const date=m.date||watch.date,refs={};for(const source of watch.sources){
    const data=feeds[source]?.[date];
    if(!data){refs[source]={state:'unverified',reason:health[source].failures?.find(f=>f.date===date)?.message||health[source].message,checkedAt};continue;}
    const slot=date+' '+m.time,teams=m.match.split(/\s+[–—-]\s+/),index=indexes[source][date],home=canonicalClubKey(teams[0],effectiveAliases[source]),away=canonicalClubKey(teams[1],effectiveAliases[source]);
    const events=index.pairs.get(slot+'|'+home+'|'+away)||[],sourceCheckedAt=new Date(data.dataFreshAt).toISOString();
    const candidates=data.slots.get(slot)||[];
    const found=matchEvent(m,events.length?events:candidates,date,effectiveAliases[source],true);
    const eventAgeMs=found.event?.sourceAgeMs??data.sourceAgeMs;
    refs[source]=found.event?{...eventReference(found.event,new Date(data.freshBaseAt-eventAgeMs).toISOString()),matching:found.matching,fetchedAt:new Date(data.fetchedAt).toISOString(),sourceAgeMs:eventAgeMs}:{state:'unverified',reason:found.reason,checkedAt:sourceCheckedAt,fetchedAt:new Date(data.fetchedAt).toISOString(),suggestions:candidateMatches(m,candidates,date,effectiveAliases[source],3,true).map(candidate=>({...candidate,checkedAt:sourceCheckedAt}))};
   }return {id:m.id,refs};
  });
  return {results,health,startedAt,checkedAt,intervalSeconds:300};
 }
 return {collect,cooldowns,stats,configuredSources:{flash:true,f24:true,api:!!apiFootball.key||!!providers.api},configuredTeamAliasCount:Object.entries(aliases).filter(([source])=>source!=='sofa').reduce((count,[,source])=>count+Object.keys(source?.teams||{}).length,0)};
}
