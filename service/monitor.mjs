import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {INTERVAL_MS,validateWatch} from '../scraper/model.mjs';
export function watchRevision(watch) { return createHash('sha256').update(JSON.stringify(watch)).digest('hex'); }
export class FileStore {
 constructor(directory) { this.directory=directory;this.filename=path.join(directory,'monitor.json');this.queue=Promise.resolve(); }
 async load() { try { const data=JSON.parse(await fs.readFile(this.filename,'utf8'));if(data.version!==1||!data.watches||typeof data.watches!=='object')throw Error('Neispravan format sačuvanih podataka.');return data.watches; }catch(e){if(e.code==='ENOENT')return {};throw e;} }
 async save(watches) { const snapshot=JSON.stringify({version:1,watches});const task=this.queue.catch(()=>{}).then(async()=>{await fs.mkdir(this.directory,{recursive:true,mode:0o700});const temp=this.filename+'.tmp';await fs.writeFile(temp,snapshot,{mode:0o600});await fs.rename(temp,this.filename);});this.queue=task;return task; }
}
export class Monitor {
 constructor({collector,store,clock=()=>Date.now(),intervalMs=INTERVAL_MS,maxOperators=100}) { this.collector=collector;this.store=store;this.clock=clock;this.intervalMs=intervalMs;this.maxOperators=maxOperators;this.watches={};this.inflight=new Map();this.generation=0;this.timer=null; }
 async init() {
  this.watches=await this.store.load();
  for(const record of Object.values(this.watches)) { validateWatch(record.watch);record.running=false;record.generation=++this.generation; }
 }
 async configure(operator,config,{enabled=true}={}) {
  const watch=validateWatch(config),revision=watchRevision(watch),old=this.watches[operator];
  if(!old&&Object.keys(this.watches).length>=this.maxOperators)throw Error('Dostignut je maksimalan broj operatera.');
  if(old?.revision===revision&&old.enabled===enabled)return this.snapshot(operator);
  this.watches[operator]={watch,revision,generation:++this.generation,enabled,lastResult:old?.revision===revision?old.lastResult:null,checks:old?.checks||[],reviews:Object.fromEntries(Object.entries(old?.reviews||{}).filter(([id])=>watch.matches.some(m=>m.id===id))),reviewEvents:old?.reviewEvents||[],running:false,nextCheckAt:enabled?this.clock():null,updatedAt:new Date(this.clock()).toISOString()};
  await this.store.save(this.watches);return this.snapshot(operator);
 }
 async pause(operator) { const record=this.watches[operator];if(!record)return null;record.enabled=false;record.nextCheckAt=null;record.generation=++this.generation;record.running=false;await this.store.save(this.watches);return this.snapshot(operator); }
 snapshot(operator) { const r=this.watches[operator];if(!r)return null;return {watch:r.watch,revision:r.revision,enabled:r.enabled,running:r.running,lastResult:r.lastResult,nextCheckAt:r.nextCheckAt?new Date(r.nextCheckAt).toISOString():null,checks:r.checks.slice(0,50),reviews:r.reviews||{},reviewEvents:r.reviewEvents||[],intervalSeconds:this.intervalMs/1000}; }
 async review(operator,{matchId,note,actorName}){
  const record=this.watches[operator];if(!record||!record.watch.matches.some(m=>m.id===matchId))throw Error('Meč više nije na aktivnom spisku. Osvežite pregled.');
  if(typeof note!=='string'||!note.trim()||note.length>1000)throw Error('Unesite napomenu od 1 do 1000 znakova.');
  const match=record.watch.matches.find(m=>m.id===matchId);
  const review={operator,name:actorName||operator,note:note.trim(),at:new Date(this.clock()).toISOString(),match:match.match,internalId:match.internalId||null};
  record.reviews={...(record.reviews||{}),[matchId]:review};record.reviewEvents=[{matchId,...review},...(record.reviewEvents||[])].slice(0,500);await this.store.save(this.watches);return review;
 }
 check(operator,{trigger='manual',revision}={}) {
  const record=this.watches[operator];if(!record)return Promise.reject(Error('Operater nema konfigurisan spisak mečeva.'));
  if(revision&&record.revision!==revision)return Promise.reject(Error('Spisak je promenjen. Osvežite pregled pre provere.'));
  if(this.inflight.has(operator))return this.inflight.get(operator);
  const generation=record.generation;
  const promise=(async()=>{
   record.running=true;const start=this.clock();record.nextCheckAt=record.enabled?start+this.intervalMs:null;
   let result;
   try {result=await this.collector.collect(record.watch);}
   catch(error) {const checkedAt=new Date(this.clock()).toISOString();result={checkedAt,startedAt:new Date(start).toISOString(),results:record.watch.matches.map(m=>({id:m.id,refs:Object.fromEntries(record.watch.sources.map(s=>[s,{state:'unverified',reason:'Provera nije uspela.',checkedAt}]))})),health:Object.fromEntries(record.watch.sources.map(s=>[s,{state:'unavailable',code:'CHECK_FAILED',message:'Provera nije uspela.'}]))};}
   if(this.watches[operator]?.generation!==generation)return {discarded:true,reason:'Spisak ili režim rada je promenjen tokom provere.'};
   record.lastResult={...result,operator,trigger,revision:record.revision};record.running=false;
   record.checks.unshift({at:new Date(this.clock()).toISOString(),operator,trigger,revision:record.revision,health:result.health});record.checks=record.checks.slice(0,500);
   await this.store.save(this.watches);return record.lastResult;
  })().finally(()=>{this.inflight.delete(operator);if(this.watches[operator]===record)record.running=false;});
  this.inflight.set(operator,promise);return promise;
 }
 async tick() { const due=Object.entries(this.watches).filter(([operator,r])=>r.enabled&&r.nextCheckAt<=this.clock()&&!this.inflight.has(operator));for(const [operator] of due){const current=this.watches[operator];if(current?.enabled&&current.nextCheckAt<=this.clock()&&!this.inflight.has(operator))await this.check(operator,{trigger:'scheduled'});} }
 start() { if(this.timer)return;const tick=()=>this.tick().catch(e=>console.error('Scheduler error:',e.message));this.timer=setInterval(tick,1000);tick(); }
 async stop() { clearInterval(this.timer);this.timer=null;await Promise.allSettled([...this.inflight.values()]);await this.store.save(this.watches); }
}
