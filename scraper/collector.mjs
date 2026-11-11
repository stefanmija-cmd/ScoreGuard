import {SOURCE_NAMES,matchEvent,eventReference,validateWatch} from './model.mjs';
import {scrapeFlashscore} from './providers/flashscore.mjs';
import {scrapeSofascore} from './providers/sofascore.mjs';
import {compileTeamAliases} from './team-aliases.mjs';
export function createCollector({fetcher=globalThis.fetch,clock=()=>Date.now(),providers={},aliases={}}={}) {
 const implementations={flash:scrapeFlashscore,sofa:scrapeSofascore,...providers},cooldowns=new Map();
 async function collect(config,{teamAliases=[]}={}) {
  const effectiveAliases=compileTeamAliases(aliases,teamAliases);
  const watch=validateWatch(config),startedAt=new Date(clock()).toISOString(),feeds={},health={};
  const dates=[...new Set(watch.matches.map(m=>m.date||watch.date))];
  await Promise.all(watch.sources.map(async source=>{
   feeds[source]={};const failures=[],successes=[];
   await Promise.all(dates.map(async date=>{
    const until=cooldowns.get(source)||0;
    if(until>clock()){failures.push({date,code:'BACKOFF',message:SOURCE_NAMES[source]+': izvor je zatražio pauzu; novi zahtev tek posle '+new Date(until).toISOString()+'.',retryAt:new Date(until).toISOString()});return;}
    try {
     const events=await implementations[source]({date,now:clock(),fetcher});
     feeds[source][date]=events;successes.push({date,eventCount:events.length});
    }catch(error){
     const backoff=error.code==='RATE_LIMIT'?Math.max(error.retryAfterMs||0,300000):error.code==='BLOCKED'?300000:0;
     if(backoff)cooldowns.set(source,clock()+backoff);
     failures.push({date,code:error.code||'SOURCE_ERROR',httpStatus:error.httpStatus||null,message:SOURCE_NAMES[source]+': '+(error.message||'Prikupljanje podataka nije uspelo.'),retryAt:backoff?new Date(clock()+backoff).toISOString():null});
    }
   }));
   const eventCount=successes.reduce((n,item)=>n+item.eventCount,0);
   health[source]={state:failures.length?(successes.length?'partial':'unavailable'):'available',code:failures[0]?.code||'OK',eventCount,checkedAt:new Date(clock()).toISOString(),message:failures.length?failures.map(f=>f.date+' · '+f.message).join(' '):SOURCE_NAMES[source]+': preuzeto '+eventCount+' fudbalskih mečeva za '+dates.length+' kalendarskih dana.',dates:successes,failures};
  }));
  const checkedAt=new Date(clock()).toISOString();
  const results=watch.matches.map(m=>{
   const date=m.date||watch.date,refs={};for(const source of watch.sources){
    const events=feeds[source]?.[date];
    if(!events){refs[source]={state:'unverified',reason:health[source].failures?.find(f=>f.date===date)?.message||health[source].message,checkedAt};continue;}
    const found=matchEvent(m,events,date,effectiveAliases[source]);refs[source]=found.event?eventReference(found.event,checkedAt):{state:'unverified',reason:found.reason,checkedAt};
   }return {id:m.id,refs};
  });
  return {results,health,startedAt,checkedAt,intervalSeconds:300};
 }
 return {collect,cooldowns,configuredTeamAliasCount:Object.values(aliases).reduce((count,source)=>count+Object.keys(source?.teams||{}).length,0)};
}
