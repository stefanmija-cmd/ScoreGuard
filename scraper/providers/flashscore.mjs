import {scorePair,dateKey,shiftDate} from '../model.mjs';
import {fetchText,SourceError} from '../http.mjs';
const FLASH_PHASES={1:'scheduled',2:'unknown',3:'finished',4:'postponed',5:'cancelled',6:'extra_time',7:'penalties',10:'finished_extra_time',11:'finished_penalties',12:'first_half',13:'second_half',36:'interrupted',37:'interrupted',38:'half_time',40:'extra_time',41:'extra_time',42:'unknown',43:'postponed',44:'interrupted',45:'interrupted',54:'awarded'};
export function parseFlashscore(text) {
 if (!text.includes('SA÷1') || !text.includes('ZA÷')) throw new SourceError('FORMAT_CHANGED','Flashscore feed nema očekivanu fudbalsku strukturu.');
 const events=[];let league=null;
 for (const segment of text.split('~')) {
  const f={};for(const token of segment.split('¬')){const at=token.indexOf('÷');if(at>0)f[token.slice(0,at)]=token.slice(at+1);}
  if (f.ZA) { const at=f.ZA.indexOf(': ');league={fullLeague:f.ZA,league:at<0?f.ZA:f.ZA.slice(at+2),leagueId:f.ZEE||f.ZE||'',country:f.ZY||''}; }
  if (!f.AA) continue;
  if (!league||!f.AE||!f.AF||!/^\d+$/.test(f.AD||'')||!/^[a-zA-Z0-9]{6,12}$/.test(f.AA)) continue;
  const phase=FLASH_PHASES[f.AC]||'unknown';
  const state=['first_half','half_time','second_half','extra_time','penalties'].includes(phase)?'live':['finished','finished_extra_time','finished_penalties'].includes(phase)?'finished':phase==='scheduled'?'scheduled':'other';
  const current=scorePair(f.AG,f.AH),regularTime=scorePair(f.AT,f.AU)||(phase==='finished'?current:null);
  let halfTime=phase==='first_half'?null:scorePair(f.BA,f.BB);
  if (!halfTime && phase==='half_time')halfTime=current;
  // The public feed often omits period 1. BC/BD are period 2, not half-time scores.
  if (!halfTime&&['second_half','finished','extra_time','penalties','finished_extra_time','finished_penalties'].includes(phase)) {
   const base=regularTime||(['second_half','finished'].includes(phase)?current:null);
   const second=scorePair(f.BC,f.BD);
   if(base&&second) { const b=base.split(':').map(Number),s=second.split(':').map(Number);halfTime=scorePair(b[0]-s[0],b[1]-s[1]); }
  }
  events.push({provider:'flash',id:f.AA,home:f.AE,away:f.AF,...league,startTimestamp:Number(f.AD),phase,state,current,regularTime,halfTime,url:'https://www.flashscore.com/match/'+f.AA+'/#/match-summary',note:f.AM||null});
 }
 return events;
}
export async function scrapeFlashscore({date,now=Date.now(),fetcher,fetchTextImpl=fetchText,feedBase='https://global.flashscore.ninja/2/x/feed',feedSign='SW9D1eZo'}={}) {
 const offset=Math.round((Date.parse(date+'T12:00:00Z')-Date.parse(dateKey(now)+'T12:00:00Z'))/86400000);
 if (offset < -7 || offset > 1) throw new SourceError('DATE_RANGE','Flashscore dnevni feed podržava poslednjih 7 dana i naredni dan.');
 const events=[];let sourceAgeMs=0;
 // Flashscore's rolling day boundary differs from the Belgrade calendar. Read adjacent feed windows and filter actual kickoff dates.
 for (const day of [offset-1,offset]) {
  const url=feedBase.replace(/\/$/,'')+'/f_1_'+day+'_3_en_1';
  const response=await fetchTextImpl(url,{fetcher,headers:{'x-fsign':feedSign}}),{text}=response;sourceAgeMs=Math.max(sourceAgeMs,response.sourceAgeMs||0);
  events.push(...parseFlashscore(text).map(event=>({...event,sourceAgeMs:response.sourceAgeMs||0})));
 }
 const dedup=new Map();for (const event of events) if(dateKey(event.startTimestamp*1000)===date)dedup.set(event.id,event);
 const selected=[...dedup.values()];return Object.defineProperty(selected,'sourceAgeMs',{value:selected.length?Math.max(...selected.map(e=>e.sourceAgeMs)):sourceAgeMs});
}
