import {normalizeName,normalizeScore,normalizeExpectedStatus,validDate,shiftDate} from './model.mjs';
const WEEKDAYS={ned:0,pon:1,uto:2,sre:3,cet:4,pet:5,sub:6};
const DAY_LABELS=['ned','pon','uto','sre','čet','pet','sub'];
export function cleanClipboard(text){return String(text).replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').replace(/\\[ \t]*(?=\n|$)/g,'');}
export function isNativeClipboard(text){const first=cleanClipboard(text).split('\n').find(line=>line.trim());if(!first)return false;const fields=first.split('\t').map(x=>x.trim());return /^[A-ZČĆĐŠŽ]$/i.test(fields[0])||(fields[0]==='Fudbal'&&(fields.length===1||/^\d+$/.test(fields[2]||'')));}
export function nativePhase(value){const s=String(value||'').trim().toLowerCase().replace(/\s+/g,' ');return ({'1st half':'first_half','first half':'first_half','1st':'first_half','2nd half':'second_half','second half':'second_half','2nd':'second_half','half time':'half_time','halftime':'half_time','half-time':'half_time','finished':'finished','full time':'finished','full-time':'finished','ended':'finished','not started':'scheduled','scheduled':'scheduled','postponed':'postponed','cancelled':'cancelled','canceled':'cancelled','suspended':'interrupted','interrupted':'interrupted','extra time':'extra_time','extra-time':'extra_time','penalties':'penalties'})[s]||null;}
function nativeSchedule(raw){const m=/^(?:(pon|uto|sre|čet|cet|pet|sub|ned)\.?\s+)?([01]\d|2[0-3]):([0-5]\d)$/i.exec(raw||'');return m?{weekday:m[1]?WEEKDAYS[normalizeName(m[1])]:null,time:m[2]+':'+m[3]}:null;}
export function parseNativeClipboard(text){
 const errors=[],rows=[];const clean=cleanClipboard(text);
 if(clean.length>256000)return {format:'native',rows,errors:['Spisak je prevelik. Dozvoljeno je najviše 1000 mečeva.']};
 const lines=clean.split('\n');let records=[];
 if(lines.some(line=>line.includes('\t'))){
  for(let i=0;i<lines.length;i++){if(!lines[i].trim())continue;const fields=lines[i].split('\t').map(s=>s.trim());if(fields.length<6){errors.push(`Red ${i+1}: nedostaju kolone kopirane tabele.`);continue;}records.push({fields,line:i+1,tabular:true});}
 }else{
  const tokens=lines.map((value,i)=>({value:value.trim(),line:i+1})).filter(t=>t.value);
  const starts=[];for(let i=0;i<tokens.length;i++)if(tokens[i].value==='F'||tokens[i].value==='Fudbal'||/^[A-ZČĆĐŠŽ]$/i.test(tokens[i].value)&&/^\d{1,10}$/.test(tokens[i+2]?.value||''))starts.push(i);
  if(!starts.length)return {format:'native',rows,errors:['Nije pronađen početak meča: F, liga, šifra, domaćin, gost, dan i vreme.']};
  if(starts[0]!==0)errors.push('Pre prvog meča postoje neprepoznata polja. Kopirajte kompletne redove bez zaglavlja.');
  for(let i=0;i<starts.length;i++){const start=starts[i],end=starts[i+1]??tokens.length;records.push({fields:tokens.slice(start,end).map(t=>t.value),line:tokens[start].line,tabular:false});}
 }
 const seen=new Set();
 for(const {fields:f,line,tabular} of records){
  const label=`Red ${line}`;if(f[0]!=='F'&&f[0]!=='Fudbal'){errors.push(`${label}: sport „${f[0]}“ nije podržan; potreban je F (fudbal).`);continue;}
  if(f.length<6||!f[1]||!/^\d{1,10}$/.test(f[2]||'')||!f[3]||!f[4]){errors.push(`${label}: nedostaju liga, šifra ili naziv tima.`);continue;}
  const schedule=nativeSchedule(f[5]);if(!schedule){errors.push(`${label}: neispravno vreme „${f[5]||''}“; primer sre 21:30.`);continue;}
  const key=f[2];if(seen.has(key)){errors.push(`${label}: duplirana interna šifra ${key}.`);continue;}seen.add(key);
  if(f[1].length>150||f[3].length+f[4].length>195){errors.push(`${label}: naziv lige ili timova je predugačak.`);continue;}
  const tail=f.slice(6),marketRaw=/^(FT|HT)$/i.test(tail[0]||'')?tail[0].toUpperCase():null;let after=tabular?tail.slice(1):marketRaw?tail.slice(1):tail;
  // Table cells preserve blank score columns; vertical copying has already removed empty lines.
  let numberHomeRaw='',numberAwayRaw='';
  if(tabular){numberHomeRaw=after[0]||'';numberAwayRaw=after[1]||'';}
  else if(/^\d{1,2}$/.test(after[0]||'')&&/^\d{1,2}$/.test(after[1]||'')){[numberHomeRaw,numberAwayRaw]=after;}
  const numericScore=/^\d{1,2}$/.test(numberHomeRaw)&&/^\d{1,2}$/.test(numberAwayRaw)?Number(numberHomeRaw)+':'+Number(numberAwayRaw):null;
  const colonScoreRaw=after.slice(0,4).find(t=>/^\s*\d{0,2}\s*:\s*\d{0,2}\s*$/.test(t))||'';
  const colonScore=normalizeScore(colonScoreRaw.replace(/\s/g,''));
  const phaseRaw=after.find(t=>nativePhase(t))||'',phase=nativePhase(phaseRaw);
  const minuteRaw=after.find(t=>/^\d{1,3}(?:\+\d{1,2})?['’′]$/.test(t))||'';
  rows.push({line,internalId:f[2],sport:'Fudbal',league:f[1],home:f[3],away:f[4],match:f[3]+' – '+f[4],scheduleRaw:f[5],...schedule,marketRaw,numberHomeRaw,numberAwayRaw,numericScore,colonScoreRaw,colonScore,minuteRaw,phaseRaw,phase});
 }
 if(rows.length>1000)errors.push('Dozvoljeno je najviše 1000 mečeva.');
 if(!rows.length&&!errors.length)errors.push('Unesite bar jedan kompletan meč.');
 return {format:'native',rows,errors};
}
export function nativeDates(rows,baseDate){
 const errors=[],dates=[];if(!validDate(baseDate))return {dates,errors:['Izaberite kalendarski datum prvog dana spiska. Samo naziv dana nije dovoljan.']};
 const baseWeekday=new Date(baseDate+'T12:00:00Z').getUTCDay();let previousOffset=0;const firstWeekday=rows.find(r=>r.weekday!==null)?.weekday;
 if(firstWeekday!==undefined&&firstWeekday!==baseWeekday)return {dates,errors:[`Prvi dan spiska je ${DAY_LABELS[firstWeekday]}, a izabrani datum ${baseDate} je ${DAY_LABELS[baseWeekday]}. Izaberite tačan datum prvog dana spiska.`]};
 for(const row of rows){const offset=row.weekday===null?previousOffset:(row.weekday-baseWeekday+7)%7;if(offset<previousOffset||offset>2){errors.push(`Meč ${row.internalId}: nejasan redosled dana. Uvoz podržava do tri uzastopna kalendarska dana u hronološkom redosledu.`);}dates.push(shiftDate(baseDate,offset));previousOffset=offset;}
 return {dates,errors};
}
export function mapNativeClipboard(parsed,{baseDate,idFactory=()=>globalThis.crypto.randomUUID()}={}){
 const resultColumn='numbers',halfTimeColumn='colon';
 const errors=[...parsed.errors],rows=[],warnings=[];const calendar=nativeDates(parsed.rows,baseDate);errors.push(...calendar.errors);
 if(errors.length)return {rows,errors,warnings};
 for(let i=0;i<parsed.rows.length;i++){
  const raw=parsed.rows[i],score=raw.numericScore;
  const ht=raw.colonScore;
  if(ht&&score&&ht.split(':').some((n,j)=>Number(n)>Number(score.split(':')[j]))){errors.push(`Meč ${raw.internalId}: izabrano poluvreme ${ht} veće je od rezultata ${score}. Proverite značenje kolona.`);continue;}
  if(!score)warnings.push(`Meč ${raw.internalId}: nema internog rezultata; meč će ostati neproveren.`);
  if(!ht&&raw.phase!=='first_half')warnings.push(`Meč ${raw.internalId}: poluvreme nije uneto i neće biti potvrđeno.`);
  const phase=raw.phase||(raw.marketRaw==='HT'?'first_half':raw.marketRaw==='FT'?'second_half':null);
  const expectedStatus=['first_half','half_time','second_half'].includes(phase)?phase:phase==='finished'?'finished':null;
  if(raw.marketRaw==='HT'&&raw.phase==='second_half'||raw.marketRaw==='FT'&&raw.phase==='first_half')warnings.push(`Meč ${raw.internalId}: oznaka ${raw.marketRaw} nije u skladu sa periodom „${raw.phaseRaw}“. Sačuvan je izričito naveden period utakmice.`);
  rows.push({id:idFactory(),internalId:raw.internalId,sport:'Fudbal',date:calendar.dates[i],time:raw.time,league:raw.league,match:raw.match,ht,score,expectedStatus,scoreBasis:'regular',inputFormat:'native',native:{market:raw.marketRaw||'',minute:raw.minuteRaw,phase:raw.phaseRaw,numbers:raw.numericScore,colon:raw.colonScore,schedule:raw.scheduleRaw,resultColumn,halfTimeColumn},refs:{}});
 }
 return {rows,errors,warnings};
}
