import {scorePair,dateKey,shiftDate} from '../model.mjs';
import {fetchText,SourceError} from '../http.mjs';
export function parseSofascore(data) {
 if (!data || !Array.isArray(data.events)) throw new SourceError('FORMAT_CHANGED','Sofascore odgovor nema očekivanu listu mečeva.');
 return data.events.map(e=>{
  if (!Number.isSafeInteger(e.id)||!e.homeTeam?.name||!e.awayTeam?.name||!Number.isFinite(e.startTimestamp)||!e.tournament?.name) return null;
  const code=e.status?.code,type=e.status?.type;
  const phase=({6:'first_half',7:'second_half',31:'half_time',41:'extra_time',42:'extra_time',32:'extra_time',50:'penalties',100:'finished',110:'finished_extra_time',120:'finished_penalties',60:'postponed',70:'cancelled',80:'interrupted',90:'interrupted'})[code]||(type==='notstarted'?'scheduled':type==='canceled'?'cancelled':type==='postponed'?'postponed':type==='finished'?'unknown':'unknown');
  const state=['first_half','half_time','second_half','extra_time','penalties'].includes(phase)?'live':['finished','finished_extra_time','finished_penalties'].includes(phase)?'finished':phase==='scheduled'?'scheduled':'other';
  const h=e.homeScore||{},a=e.awayScore||{};
  const halfTime=phase==='first_half'?null:scorePair(h.period1,a.period1)||(phase==='half_time'?scorePair(h.current,a.current):null);
  const p1=scorePair(h.period1,a.period1),p2=scorePair(h.period2,a.period2);
  const regularTime=scorePair(h.normaltime,a.normaltime)||(p1&&p2?scorePair(Number(h.period1)+Number(h.period2),Number(a.period1)+Number(a.period2)):phase==='finished'?scorePair(h.current,a.current):null);
  const league=e.tournament.uniqueTournament?.name||e.tournament.name;
  return {provider:'sofa',id:String(e.id),home:e.homeTeam.name,away:e.awayTeam.name,league,fullLeague:e.tournament.name,leagueId:String(e.tournament.id||''),startTimestamp:e.startTimestamp,phase,state,current:scorePair(h.current,a.current),halfTime,regularTime,url:'https://www.sofascore.com/event/'+e.id};
 }).filter(Boolean);
}
export async function scrapeSofascore({date,now=Date.now(),fetcher,fetchTextImpl=fetchText}={}) {
 // The schedule is indexed by UTC day. Fetch both UTC dates intersecting a Belgrade calendar day.
 const days=[shiftDate(date,-1),date];const items=[];let latestError=null;
 for (const day of days) {
  try { const {text}=await fetchTextImpl('https://www.sofascore.com/api/v1/sport/football/scheduled-events/'+day,{fetcher,headers:{Accept:'application/json'}});let data;try{data=JSON.parse(text)}catch{throw new SourceError('FORMAT_CHANGED','Sofascore je vratio neprepoznatljiv format.')}items.push(...parseSofascore(data)); }
  catch(error) { if (['BLOCKED','RATE_LIMIT'].includes(error.code)) throw error;latestError=error; }
 }
 if (date===dateKey(now) && !latestError) {
  try { const {text}=await fetchTextImpl('https://www.sofascore.com/api/v1/sport/football/events/live',{fetcher,headers:{Accept:'application/json'}});items.push(...parseSofascore(JSON.parse(text))); }
  catch(error) { if (['BLOCKED','RATE_LIMIT'].includes(error.code)) throw error; /* Schedule feed still contains live scores; a live-only request is supplementary. */ }
 }
 if (latestError) throw latestError;
 const dedup=new Map();for(const e of items)if(dateKey(e.startTimestamp*1000)===date)dedup.set(e.id,e);
 return [...dedup.values()];
}
