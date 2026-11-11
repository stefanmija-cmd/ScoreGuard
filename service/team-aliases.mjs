import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {normalizeTeamLink,teamLinkKey} from '../scraper/team-aliases.mjs';
export class TeamAliasStore{
 constructor(directory,{clock=()=>Date.now(),limit=500}={}){this.directory=directory;this.filename=path.join(directory,'team-aliases.json');this.clock=clock;this.limit=limit;this.operators={};this.queue=Promise.resolve();}
 async init(){
  try{const saved=JSON.parse(await fs.readFile(this.filename,'utf8'));if(saved.version!==1||!saved.operators||typeof saved.operators!=='object'||Array.isArray(saved.operators))throw Error('Neispravna sačuvana povezivanja klubova.');
   for(const [operator,value]of Object.entries(saved.operators)){if(!/^operator-[a-z0-9._-]{2,40}$/.test(operator)||!Array.isArray(value.links)||value.links.length>this.limit||!Array.isArray(value.events))throw Error('Neispravna sačuvana povezivanja klubova.');for(const link of value.links){normalizeTeamLink({...link,confirmed:true});if(typeof link.id!=='string')throw Error('Neispravno povezivanje kluba.');}}
   this.operators=saved.operators;
  }catch(error){if(error.code!=='ENOENT')throw error;}
 }
 list(operator){return structuredClone(this.operators[operator]?.links||[]);}
 history(operator){return structuredClone((this.operators[operator]?.events||[]).slice(0,100));}
 revision(operator){return createHash('sha256').update(JSON.stringify(this.list(operator).map(teamLinkKey).sort())).digest('hex');}
 _mutate(change){
  const job=this.queue.catch(()=>{}).then(async()=>{const next=structuredClone(this.operators),result=change(next);await fs.mkdir(this.directory,{recursive:true,mode:0o700});await fs.writeFile(this.filename+'.tmp',JSON.stringify({version:1,operators:next}),{mode:0o600});await fs.rename(this.filename+'.tmp',this.filename);this.operators=next;return result;});this.queue=job;return job;
 }
 add(operator,raw,actorName){return this.addMany(operator,[raw],actorName);}
 addMany(operator,rawLinks,actorName){
  if(!Array.isArray(rawLinks)||!rawLinks.length||rawLinks.length>this.limit)throw Error('Jedan unos podržava od 1 do '+this.limit+' povezivanja.');
  const links=rawLinks.map(normalizeTeamLink);
  return this._mutate(next=>{
   if(!next[operator]&&Object.keys(next).length>=100)throw Error('Dostignut je broj operatera sa povezivanjima.');
   const data=next[operator]||(next[operator]={links:[],events:[]}),keys=new Set(data.links.map(teamLinkKey)),saved=[];let changed=false;
   for(const link of links){const key=teamLinkKey(link);if(keys.has(key)){saved.push(data.links.find(item=>teamLinkKey(item)===key));continue;}
    if(data.links.length>=this.limit)throw Error('Maksimalno '+this.limit+' povezivanja po operateru.');
    const at=new Date(this.clock()).toISOString(),record={id:randomUUID(),...link,createdBy:operator,createdName:actorName,createdAt:at};data.links.push(record);keys.add(key);saved.push(record);changed=true;
    data.events.unshift({action:'added',...record,at,operator,name:actorName});
   }
   data.events=data.events.slice(0,500);return {changed,saved:structuredClone(saved)};
  });
 }
 remove(operator,id,actorName){return this._mutate(next=>{const data=next[operator],index=data?.links.findIndex(link=>link.id===id)??-1;if(index<0){const error=Error('Povezivanje nije pronađeno na vašem nalogu.');error.status=404;throw error;}const [link]=data.links.splice(index,1);data.events.unshift({action:'removed',...link,at:new Date(this.clock()).toISOString(),operator,name:actorName});data.events=data.events.slice(0,500);return {changed:true,removed:link};});}
}
