import {teamIdentityKey} from './team-matching.mjs';
export const INTERVAL_MS = 5 * 60 * 1000;
export const MAX_MATCHES = 1000;
export const MAX_INPUT_BYTES = 2 * 1024 * 1024;
export const FRESH_MS = INTERVAL_MS + 30 * 1000;
export const SOURCE_NAMES = {flash: 'Flashscore', sofa: 'Sofascore', api: 'API-Football'};
export const LIVE_PHASES = new Set(['first_half', 'half_time', 'second_half', 'extra_time', 'penalties']);
export const PHASE_LABELS = {first_half:'Prvo poluvreme',half_time:'Poluvreme',second_half:'Drugo poluvreme',extra_time:'Produžeci',penalties:'Penali',finished:'Završeno',finished_extra_time:'Završeno posle produžetaka',finished_penalties:'Završeno posle penala',scheduled:'Nije počelo',postponed:'Odloženo',cancelled:'Otkazano',interrupted:'Prekinuto',awarded:'Službeni rezultat',unknown:'Nepoznat status'};
export function normalizeName(value) { return String(value ?? '').replace(/đ/g, 'dj').replace(/Đ/g, 'Dj').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); }
const dateFormatter=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Belgrade',year:'numeric',month:'2-digit',day:'2-digit'});
const timeFormatter=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Belgrade',hour:'2-digit',minute:'2-digit',hour12:false});
export function dateKey(value) { return dateFormatter.format(new Date(value)); }
export function timeKey(value) { return timeFormatter.format(new Date(value)); }
export function validDate(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false; const d = new Date(value + 'T12:00:00Z'); return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0,10) === value; }
export function shiftDate(date, days) { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); }
export function scorePair(home, away) { const valid = n => (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 99) || (typeof n === 'string' && /^\d{1,2}$/.test(n)); return valid(home) && valid(away) ? Number(home)+':'+Number(away) : null; }
export function normalizeScore(s) { if (typeof s !== 'string' || !/^\d{1,2}\s*[:-]\s*\d{1,2}$/.test(s)) return null; return s.split(/[:-]/).map(n=>String(Number(n.trim()))).join(':'); }
export function normalizeExpectedStatus(s) { return ({live:'live',uzivo:'live','uživo':'live',ft:'finished',finished:'finished',zavrseno:'finished','završeno':'finished',ht:'half_time',poluvreme:'half_time','1h':'first_half','2h':'second_half'})[String(s||'').toLowerCase()] ?? null; }
export function parseInput(text, idFactory=()=>globalThis.crypto.randomUUID()) {
 const errors=[],rows=[],seen=new Set(); const lines=String(text).split(/\r?\n/);
 for (let i=0;i<lines.length;i++) {
  const line=lines[i].trim(); if (!line) continue;
  const p=line.split(line.includes('\t')?'\t':'/').map(s=>s.trim());
  if (p.length < 6 || p.length > 7) { errors.push(`Red ${i+1}: potrebno je 6 polja, uz opcioni sedmi status LIVE ili FT.`); continue; }
  const [sp,t,l,rawMatch,h,r,rawStatus] = p;
  if (sp.toLowerCase()!=='fudbal') { errors.push(`Red ${i+1}: trenutno je podržan samo Fudbal.`); continue; }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) { errors.push(`Red ${i+1}: vreme mora biti HH:MM.`); continue; }
  if (!l || l.length>150 || rawMatch.length>200 || !/^.+\s+[–—-]\s+.+$/.test(rawMatch) || rawMatch.split(/\s+[–—-]\s+/).length!==2) { errors.push(`Red ${i+1}: unesite ligu i utakmicu kao „Tim A - Tim B“.`); continue; }
  const score=normalizeScore(r), ht=['-','—',''].includes(h)?null:normalizeScore(h);
  if (!score || (ht===null&&!['-','—',''].includes(h))) { errors.push(`Red ${i+1}: neispravan rezultat; primer 2:1.`); continue; }
  if (ht && ht.split(':').some((n,k)=>Number(n)>Number(score.split(':')[k]))) { errors.push(`Red ${i+1}: poluvreme ne može biti veće od ukupnog rezultata.`); continue; }
  const expectedStatus=normalizeExpectedStatus(rawStatus);
  if (rawStatus&&!expectedStatus) { errors.push(`Red ${i+1}: status mora biti LIVE, FT, HT, 1H ili 2H.`); continue; }
  const match=rawMatch.replace(/\s+[–—-]\s+/,' – '); const key=[t,normalizeName(l),normalizeName(match)].join('|');
  if (seen.has(key)) { errors.push(`Red ${i+1}: dupliran meč.`); continue; } seen.add(key);
  rows.push({id:idFactory(),sport:'Fudbal',time:t,league:l,match,ht,score,expectedStatus,scoreBasis:'regular',refs:{}});
 }
 if (rows.length>MAX_MATCHES) errors.push('Dozvoljeno je najviše '+MAX_MATCHES+' mečeva.');
 if (!rows.length&&!errors.length) errors.push('Unesite bar jedan meč.');
 return {rows,errors};
}
export function validateWatch(body) {
 if (!body || !validDate(body.date) || !Array.isArray(body.sources) || !body.sources.length || body.sources.length>3 || new Set(body.sources).size!==body.sources.length || body.sources.some(s=>!Object.hasOwn(SOURCE_NAMES,s))) throw new Error('Proverite datum i izbor izvora.');
 if (!Array.isArray(body.matches) || !body.matches.length || body.matches.length>MAX_MATCHES) throw new Error('Dozvoljeno je od 1 do '+MAX_MATCHES+' mečeva.');
 const ids=new Set(),dates=new Set();
 const matches=body.matches.map(m=>{
  if (!m || typeof m.id!=='string' || !m.id || m.id.length>100 || ids.has(m.id) || m.sport!=='Fudbal' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(m.time) || typeof m.league!=='string' || !m.league.trim() || m.league.length>150 || typeof m.match!=='string' || m.match.length>200 || m.match.split(/\s+[–—-]\s+/).length!==2 || (m.score!==null&&normalizeScore(m.score)!==m.score) || (m.ht!=null&&normalizeScore(m.ht)!==m.ht) || (m.scoreBasis!=null&&m.scoreBasis!=='regular') || (m.expectedStatus!=null&&!['live','finished','half_time','first_half','second_half'].includes(m.expectedStatus))) throw new Error('Neispravan zapis meča. Trenutno je podržan samo fudbal, sa rezultatom regularnog vremena.');
  if (m.ht&&m.score&&m.ht.split(':').some((n,k)=>Number(n)>Number(m.score.split(':')[k]))) throw new Error('Poluvreme ne može biti veće od ukupnog rezultata.');
  const date=m.date??body.date;if(!validDate(date))throw new Error('Meč ima neispravan kalendarski datum.');
  if(Date.parse(date+'T12:00:00Z')<Date.parse(body.date+'T12:00:00Z')||Date.parse(date+'T12:00:00Z')-Date.parse(body.date+'T12:00:00Z')>2*86400000)throw new Error('Datumi mečeva moraju biti u okviru tri uzastopna dana od osnovnog datuma.');
  dates.add(date);ids.add(m.id);
  if(m.internalId!=null&&(typeof m.internalId!=='string'||!/^\d{1,10}$/.test(m.internalId)))throw new Error('Neispravna interna šifra.');
  let native;
  if(m.native!=null){
   if(typeof m.native!=='object'||Array.isArray(m.native))throw new Error('Neispravne informacije internog unosa.');
   native={};for(const key of ['market','minute','phase','numbers','colon','schedule','resultColumn','halfTimeColumn']){const value=m.native[key];if(value!=null&&(typeof value!=='string'||value.length>100))throw new Error('Neispravne informacije internog unosa.');native[key]=value??null;}
  }
  return {id:m.id,sport:m.sport,time:m.time,league:m.league,match:m.match,ht:m.ht||null,score:m.score,expectedStatus:m.expectedStatus||null,scoreBasis:'regular',...(m.date?{date}:{}),...(m.internalId?{internalId:m.internalId}:{}),...(native?{inputFormat:'native',native}:{})};
 });
 if(dates.size>3)throw new Error('Jedan spisak podržava najviše tri kalendarska dana.');
 return {date:body.date,sources:[...body.sources],matches};
}
export function canonicalClubKey(name,aliases={}) {const key=normalizeName(name);return teamIdentityKey(Object.hasOwn(aliases.teams||{},key)?aliases.teams[key]:name);}
export function matchEvent(internal,events,date,aliases={},preFiltered=false) {
 const teams=String(internal.match||'').split(/\s+[–—-]\s+/);
 if(teams.length!==2)return {reason:'Timovi nisu jednoznačno razdvojeni.'};
 const [home,away]=teams;
 const canonical=s=>canonicalClubKey(s,aliases);
 const homeKey=canonical(home),awayKey=canonical(away);
 if(!homeKey||!awayKey)return {reason:'Nedostaje naziv domaćina ili gosta.'};
 if(homeKey===awayKey)return {reason:'Oba tima su povezana sa istim klubom. Proverite sačuvana povezivanja naziva.'};
 // Competition names are display metadata. Club pair, home/away order and kickoff identify the event.
 const candidates=events.filter(e=>(preFiltered||Number.isFinite(e.startTimestamp)&&dateKey(e.startTimestamp*1000)===date&&timeKey(e.startTimestamp*1000)===internal.time)&&canonical(e.home)===homeKey&&canonical(e.away)===awayKey);
 return candidates.length===1?{event:candidates[0]}:{reason:candidates.length?'Više mogućih mečeva sa istim klubovima, datumom i vremenom; potrebno je ručno uparivanje. Naziv takmičenja ne bira se kao kriterijum.':'Nema tačnog poklapanja domaćina, gosta, datuma i vremena početka. Naziv takmičenja nije uslov za povezivanje.'};
}
export function eventReference(event,checkedAt) {
 const base={eventId:event.id,phase:event.phase,eventState:event.state,phaseLabel:PHASE_LABELS[event.phase]||PHASE_LABELS.unknown,checkedAt,url:event.url,ht:event.halfTime,current:event.current,regularTime:event.regularTime,scoreBasis:'regular',sourceUpdatedAt:event.sourceUpdatedAt||null,sourceHome:event.home||null,sourceAway:event.away||null,sourceLeague:event.fullLeague||event.league||null};
 if (!['live','finished'].includes(event.state)) return {...base,state:'unverified',reason:'Status izvora: '+base.phaseLabel+'.'};
 const score=['extra_time','penalties','finished_extra_time','finished_penalties'].includes(event.phase)?event.regularTime:event.current;
 if (!score) return {...base,state:'unverified',reason:'Nedostaje rezultat regularnog vremena; penali i produžeci se ne porede sa rezultatom za 90 minuta.'};
 if (event.halfTime&&event.halfTime.split(':').some((n,i)=>Number(n)>Number(score.split(':')[i]))) return {...base,state:'unverified',reason:'Nelogičan odnos poluvremena i rezultata; potreban je pregled izvora.'};
 return {...base,state:'verified',score,htRequired:event.phase!=='first_half',reason:event.phase==='first_half'?'Poluvreme još nije završeno.':event.halfTime?'':'Poluvreme nije dostupno.'};
}
export function referenceFresh(ref,now=Date.now(),demo=false) { return !!ref&&(demo||Number.isFinite(Date.parse(ref.checkedAt))&&now-Date.parse(ref.checkedAt)<=FRESH_MS&&now-Date.parse(ref.checkedAt)>=-30000); }
function nativeSecondHalfFinished(m,ref) {
 // The backoffice FT / 2nd half marker can remain after the final whistle.
 // Only a source's state establishes completion; an explicit standard 2H stays strict.
 return !!(m.native||m.inputFormat==='native')&&m.expectedStatus==='second_half'&&ref.eventState==='finished';
}
function expectedStatusMatches(m,ref) {
 if(!m.expectedStatus||nativeSecondHalfFinished(m,ref))return true;
 return m.expectedStatus==='live'?ref.eventState==='live':m.expectedStatus==='finished'?ref.eventState==='finished':ref.phase===m.expectedStatus;
}
function comparisonPhaseLabel(ref) {
 return ref.phaseLabel||PHASE_LABELS[ref.phase]||({live:'Uživo',finished:'Završeno'})[ref.eventState]||PHASE_LABELS.unknown;
}
export function compareResult(m,sources,now=Date.now(),demo=false) {
 if(!m.score)return {status:'unverified',reason:'Nedostaje interni rezultat.'};
 const selected=sources.map(source=>({source,ref:m.refs?.[source],name:SOURCE_NAMES[source]||source}));
 if(!selected.length)return {status:'unverified',reason:'Nije izabran izvor za proveru.'};
 const fresh=selected.filter(({ref})=>ref?.state==='verified'&&referenceFresh(ref,now,demo));
 const differences=[];
 for(const {ref,name} of fresh){
  if(ref.score!==m.score)differences.push(`Rezultat: interno ${m.score}, ${name} ${ref.score||'—'}.`);
  if(m.ht&&ref.ht&&m.ht!==ref.ht)differences.push(`Poluvreme: interno ${m.ht}, ${name} ${ref.ht}.`);
  if(!expectedStatusMatches(m,ref))differences.push(`Status: interno ${PHASE_LABELS[m.expectedStatus]||(m.expectedStatus==='live'?'Uživo':m.expectedStatus)}, ${name} ${comparisonPhaseLabel(ref)}.`);
 }
 if(new Set(fresh.map(({ref})=>ref.eventState).filter(Boolean)).size>1)differences.push('Izvori se ne slažu da li je utakmica završena: '+fresh.map(({name,ref})=>name+' '+comparisonPhaseLabel(ref)).join(', ')+'.');
 if(differences.length)return {status:'mismatch',reason:differences.join(' ')};
 const incomplete=[];
 for(const {ref,name} of selected){
  if(ref?.state!=='verified')incomplete.push(name+': '+(ref?.reason||'Nema pouzdanih podataka za proveru.'));
  else if(!referenceFresh(ref,now,demo))incomplete.push(name+': Podaci su zastareli ili vreme provere nije pouzdano.');
  else if(ref.htRequired===false){if(m.ht)incomplete.push(name+': Prvo poluvreme još traje; uneti rezultat poluvremena nije potvrđen.');}
  else if(!m.ht||!ref.ht)incomplete.push(name+': '+(!m.ht&&!ref.ht?'Nedostaje interni rezultat poluvremena i rezultat poluvremena na izvoru.':!m.ht?'Nedostaje interni rezultat poluvremena.':'Poluvreme nije dostupno na izvoru.'));
 }
 if(incomplete.length)return {status:'unverified',reason:incomplete.join(' ')};
 const completed=fresh.filter(({ref})=>nativeSecondHalfFinished(m,ref));
 const reason=completed.length?'Rezultat i poluvreme se poklapaju sa svim izabranim izvorima. '+completed.map(({name,ref})=>name+': '+comparisonPhaseLabel(ref)+'.').join(' ')+' Interna oznaka „FT / 2nd half“ može ostati i posle završetka utakmice.':fresh.every(({ref})=>ref.htRequired===false)?'Svi izabrani izvori potvrđuju rezultat. Prvo poluvreme još traje.':'Rezultat i poluvreme se poklapaju sa svim izabranim izvorima.';
 return {status:'match',reason};
}
export function resultStatus(m,sources,now=Date.now(),demo=false) {
 return compareResult(m,sources,now,demo).status;
}
