import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {OperatorAuth} from '../auth/core.mjs';
import {SessionFileStore} from '../service/auth-store.mjs';
import {FileStore,Monitor} from '../service/monitor.mjs';
import {createCollector} from '../scraper/collector.mjs';
import {createWebApp} from '../service/web-app.mjs';
import {createService} from '../service/server.mjs';

export async function startCloudService({directory,accounts,aliases={},collector=createCollector({aliases}),parentPid=null}){
 await fs.mkdir(directory,{recursive:true,mode:0o700});
 const keyPath=path.join(directory,'session-signing-key');let signingKey;
 try{signingKey=await fs.readFile(keyPath,'utf8')}catch(e){if(e.code!=='ENOENT')throw e;signingKey=randomBytes(48).toString('base64url');await fs.writeFile(keyPath,signingKey,{mode:0o600,flag:'wx'});}
 const sessions=new SessionFileStore(directory);await sessions.init();
 const auth=new OperatorAuth({accounts,signingKey,secure:false,sessionStore:sessions});
 const monitor=new Monitor({collector,store:new FileStore(directory)});await monitor.init();
 const origin='http://localhost';
 const webApp=createWebApp({monitor,auth,html:'',loginHtml:'',sourceZip:null,productionGuide:'Streamlit Cloud test',readme:'Streamlit Cloud test',publicOrigin:origin});
 // The API is reachable only inside this Cloud instance. It has no public port.
 // Requests are authenticated with each operator's own session cookie.
 const server=createService({monitor,token:randomBytes(32).toString('hex'),webApp});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 server.requestTimeout=20000;server.headersTimeout=10000;
 monitor.start();let closing=false,parentTimer;
 async function close(){if(closing)return;closing=true;clearInterval(parentTimer);const stopped=new Promise(resolve=>server.close(resolve));await monitor.stop();await sessions.save();await stopped;}
 if(parentPid)parentTimer=setInterval(()=>{if(process.ppid!==parentPid)close().then(()=>process.exit(0));},3000).unref();
 return {server,monitor,auth,origin,baseUrl:'http://127.0.0.1:'+server.address().port,close};
}

async function main(){
 const directory=process.env.SCOREGUARD_CLOUD_DATA_DIR;
 if(!directory||!process.env.SCOREGUARD_CLOUD_BOOT_ID)throw Error('Missing Cloud configuration');
 const accounts=JSON.parse(await fs.readFile(path.join(directory,'operators.json'),'utf8'));
 const aliases=JSON.parse(await fs.readFile(path.join(directory,'aliases.json'),'utf8'));
 const runtime=await startCloudService({directory,accounts,aliases,parentPid:Number(process.env.SCOREGUARD_CLOUD_PARENT_PID)});
 const ready=path.join(directory,'ready.json');
 await fs.writeFile(ready,JSON.stringify({bootId:process.env.SCOREGUARD_CLOUD_BOOT_ID,baseUrl:runtime.baseUrl,origin:runtime.origin,pid:process.pid,startedAt:new Date().toISOString()}),{mode:0o600});
 const stop=()=>runtime.close().then(()=>process.exit(0));process.once('SIGTERM',stop);process.once('SIGINT',stop);
 console.log('ScoreGuard Cloud services ready; interval=300s; local operator sessions enabled.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error('Cloud service startup failed:',error.code||'INVALID_CONFIGURATION');process.exit(1)});
