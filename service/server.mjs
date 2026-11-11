import {createServer} from 'node:http';
import {timingSafeEqual,createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createCollector} from '../scraper/collector.mjs';
import {OperationsStore} from './operations.mjs';
import {FileStore,Monitor} from './monitor.mjs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {OperatorAuth} from '../auth/core.mjs';
import {SessionFileStore} from './auth-store.mjs';
import {createWebApp} from './web-app.mjs';
import {TeamAliasStore} from './team-aliases.mjs';
function authorized(req,token) {const raw=req.headers.authorization||'';return timingSafeEqual(createHash('sha256').update(raw).digest(),createHash('sha256').update('Bearer '+token).digest());}
const validOperator=s=>typeof s==='string'&&/^[a-zA-Z0-9_.:@-]{1,200}$/.test(s);
export function createService({monitor,token,webApp=null}) {
 if(typeof token!=='string'||token.length<32)throw Error('Potreban je servisni token od najmanje 32 znaka.');
 return createServer(async(req,res)=>{
  const send=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
  const url=new URL(req.url,'http://service');
  if(req.method==='GET'&&url.pathname==='/healthz')return send(200,{ok:true,service:'scoreguard-scraper',intervalSeconds:300});
  if(webApp){try{if(await webApp(req,res,url))return;}catch{if(!res.headersSent)send(500,{error:'Aplikacija nije izvršila zahtev.'});else res.end();return;}}
  if(!authorized(req,token))return send(401,{error:'Neispravan servisni token.'});
  const operator=url.searchParams.get('operator');if(!validOperator(operator))return send(400,{error:'Nedostaje ispravan identitet operatera.'});
  try {
   if(req.method==='GET'&&url.pathname==='/v1/state')return send(200,{monitor:monitor.snapshot(operator)});
   if(req.method==='DELETE'&&url.pathname==='/v1/watch')return send(200,{monitor:await monitor.pause(operator)});
   if(req.method==='PUT'&&url.pathname==='/v1/watch'){
    let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024){send(413,{error:'Spisak je prevelik.'});req.destroy();return}chunks.push(chunk)}
    let body;try{body=JSON.parse(Buffer.concat(chunks).toString())}catch{return send(400,{error:'Neispravan JSON.'})}
    const result=await monitor.configure(operator,body,{enabled:body.enabled!==false});return send(200,{monitor:result});
   }
   if(req.method==='POST'&&url.pathname==='/v1/check')return send(200,await monitor.check(operator,{trigger:'manual',revision:url.searchParams.get('revision')||undefined}));
   return send(404,{error:'Nepoznata putanja.'});
  } catch(error) {console.error('Request failed:',error.message);return send(400,{error:'Zahtev nije izvršen. '+error.message});}
 });
}
async function main() {
 const directory=process.env.DATA_DIR||'/data';await fs.mkdir(directory,{recursive:true,mode:0o700});
 const token=process.env.SCRAPER_TOKEN_FILE?(await fs.readFile(process.env.SCRAPER_TOKEN_FILE,'utf8')).trim():process.env.SCRAPER_SERVICE_TOKEN||randomBytes(32).toString('hex');
 const accountFile=process.env.OPERATOR_ACCOUNTS_FILE||'/run/secrets/operators';
 const accounts=JSON.parse(await fs.readFile(accountFile,'utf8'));
 const keyPath=path.join(directory,'session-signing-key');let signingKey;
 try{signingKey=await fs.readFile(keyPath,'utf8')}catch(e){if(e.code!=='ENOENT')throw e;signingKey=randomBytes(48).toString('base64url');await fs.writeFile(keyPath,signingKey,{mode:0o600,flag:'wx'});}
 const sessions=new SessionFileStore(directory);await sessions.init();
 const publicOrigin=process.env.PUBLIC_ORIGIN||'http://localhost:8080';const origin=new URL(publicOrigin);if(origin.pathname!=='/'||!['http:','https:'].includes(origin.protocol))throw Error('PUBLIC_ORIGIN mora biti poreklo aplikacije, bez putanje.');
 const secure=origin.protocol==='https:';if(!secure&&!['localhost','127.0.0.1'].includes(origin.hostname))throw Error('Za javno postavljanje potreban je HTTPS PUBLIC_ORIGIN.');
 const auth=new OperatorAuth({accounts,signingKey,secure,sessionStore:sessions});
 let aliases={};if(process.env.ALIASES_FILE)aliases=JSON.parse(await fs.readFile(process.env.ALIASES_FILE,'utf8'));
 const teamAliases=new TeamAliasStore(directory);await teamAliases.init();
 const operations=new OperationsStore(directory);await operations.init();
 const monitor=new Monitor({collector:createCollector({aliases,apiFootball:{key:process.env.APIFOOTBALL_KEY||'',dailyLimit:process.env.APIFOOTBALL_DAILY_LIMIT||90}}),store:new FileStore(directory),teamAliases,operations});await monitor.init();
 const html=await fs.readFile(new URL('../dist/client/index.html',import.meta.url),'utf8'),loginHtml=await fs.readFile(new URL('../login.html',import.meta.url),'utf8'),sourceZip=new Uint8Array(await fs.readFile(new URL('../dist/source.zip',import.meta.url))),productionGuide=await fs.readFile(new URL('../PRODUCTION.md',import.meta.url),'utf8'),readme=await fs.readFile(new URL('../README.md',import.meta.url),'utf8');
 const streamlitGuide=await fs.readFile(new URL('../UPUTSTVO-POCETNICI.html',import.meta.url),'utf8');
 const cloudZip=new Uint8Array(await fs.readFile(new URL('../dist/cloud.zip',import.meta.url))),cloudGuide=await fs.readFile(new URL('../UPUTSTVO-CLOUD.html',import.meta.url),'utf8');
 const webApp=createWebApp({monitor,auth,html,loginHtml,sourceZip,productionGuide,readme,teamAliases,streamlitGuide,cloudZip,cloudGuide,publicOrigin:origin.origin,trustProxy:process.env.TRUST_PROXY==='1'});
 const server=createService({monitor,token,webApp});const port=Number(process.env.PORT||8080);server.listen(port,'0.0.0.0',()=>{monitor.start();console.log('ScoreGuard listening on port '+port+'; interval=300s; operator login enabled');});
 server.requestTimeout=20000;server.headersTimeout=10000;
 let stopping=false;async function stop(){if(stopping)return;stopping=true;server.close();await monitor.stop();await sessions.save();process.exit(0)}process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exit(1)});
