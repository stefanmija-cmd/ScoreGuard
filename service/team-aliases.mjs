import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {normalizeTeamLink,teamLinkKey} from '../scraper/team-aliases.mjs';
import {StateDocument} from './persistence.mjs';
export class TeamAliasStore{
 constructor(directory,{clock=()=>Date.now(),limit=2000}={}){this.directory=directory;this.document=new StateDocument(directory,'team-aliases');this.filename=this.document.filename;this.clock=clock;this.limit=limit;this.operators={};this.queue=Promise.resolve();}
 async init(){
  try{const saved=await this.document.load();if(!saved)return;if(saved.version!==1||!saved.operators||typeof saved.operators!=='object'||Array.isArray(saved.operators))throw Error('Neispravna sačuvana povezivanja klubova.');
   for(const [operator,value]of Object.entries(saved.operators)){if((operator!=='@shared'&&!/^operator-[a-z0-9._-]{2,40}$/.test(operator))||!Array.isArray(value.links)||value.links.length>this.limit||!Array.isArray(value.events))throw Error('Neispravna sačuvana povezivanja klubova.');for(const link of value.links){normalizeTeamLink({...link,confirmed:true},{allowLegacy:true});if(typeof link.id!=='string')throw Error('Neispravno povezivanje kluba.');}}
   this.operators=saved.operators;
  }catch(error){if(error.code!=='ENOENT')throw error;}
 }
 list(operator){return structuredClone(this.operators[operator]?.links||[]);}
 history(operator){return structuredClone((this.operators[operator]?.events||[]).slice(0,100));}
 effective(operator){return [...this.list('@shared'),...this.list(operator)].filter(link=>link.source!=='sofa');}
 revision(operator){return createHash('sha256').update(JSON.stringify(this.effective(operator).map(teamLinkKey).sort())).digest('hex');}
 _mutate(change){
  const job=this.queue.catch(()=>{}).then(async()=>{const next=structuredClone(this.operators),result=change(next);await this.document.save({version:1,operators:next});this.operators=next;return result;});this.queue=job;return job;
 }
 add(operator,raw,actorName,actorId=operator){return this.addMany(operator,[raw],actorName,actorId);}
 addMany(operator,rawLinks,actorName,actorId=operator,{allowLegacy=false}={}){
  if(!Array.isArray(rawLinks)||!rawLinks.length||rawLinks.length>this.limit)throw Error('Jedan unos podržava od 1 do '+this.limit+' povezivanja.');
  const links=rawLinks.map(link=>normalizeTeamLink(link,{allowLegacy}));
  return this._mutate(next=>{
   if(!next[operator]&&Object.keys(next).length>=100)throw Error('Dostignut je broj operatera sa povezivanjima.');
   const data=next[operator]||(next[operator]={links:[],events:[]}),keys=new Set(data.links.map(teamLinkKey)),saved=[];let changed=false;
   for(const link of links){const key=teamLinkKey(link);if(keys.has(key)){saved.push(data.links.find(item=>teamLinkKey(item)===key));continue;}
    if(data.links.length>=this.limit)throw Error('Maksimalno '+this.limit+' povezivanja po operateru.');
    const at=new Date(this.clock()).toISOString(),record={id:randomUUID(),...link,createdBy:actorId,createdName:actorName,createdAt:at};data.links.push(record);keys.add(key);saved.push(record);changed=true;
    data.events.unshift({action:'added',...record,at,operator:actorId,name:actorName});
   }
   data.events=data.events.slice(0,500);return {changed,saved:structuredClone(saved)};
  });
 }
 remove(operator,id,actorName,actorId=operator){return this._mutate(next=>{const data=next[operator],index=data?.links.findIndex(link=>link.id===id)??-1;if(index<0){const error=Error('Povezivanje nije pronađeno na vašem nalogu.');error.status=404;throw error;}const [link]=data.links.splice(index,1);data.events.unshift({action:'removed',...link,at:new Date(this.clock()).toISOString(),operator:actorId,name:actorName});data.events=data.events.slice(0,500);return {changed:true,removed:link};});}
}
