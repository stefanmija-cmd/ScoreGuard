import {validateWatch} from '../scraper/model.mjs';
import {importPreview,monitorPresentation} from '../scraper/import-preview.mjs';
import {appendZipEntry} from '../auth/zip.mjs';
import {isPackagePath,isCloudPackagePath,loginDestination,loginPath,isBrowserNavigation} from '../auth/navigation.mjs';
import {cloudSecrets} from '../auth/cloud-secrets.mjs';
export function createWebApp({monitor,auth,html,loginHtml,sourceZip,productionGuide,readme,streamlitGuide=null,cloudGuide=null,cloudZip=null,publicOrigin=null,trustProxy=false}){
 function send(res,status,body,headers={}){res.writeHead(status,{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin',...headers});res.end(body);}
 const json=(res,status,body,headers={})=>send(res,status,JSON.stringify(body),{'Content-Type':'application/json; charset=utf-8',...headers});
 function sameOrigin(req){const expected=publicOrigin||(auth.secure?'https://':'http://')+req.headers.host;return req.headers.origin===expected;}
 async function readBody(req,max=256000){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>max)throw Error('Zahtev je prevelik.');chunks.push(chunk)}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
 return async function handle(req,res,url){
  if(url.pathname==='/healthz'||url.pathname.startsWith('/v1/'))return false;
  const session=await auth.fromCookie(req.headers.cookie),user=session?.user;
  if(req.method==='GET'&&url.pathname==='/downloads/cloud-uputstvo'&&cloudGuide){send(res,200,cloudGuide,{'Content-Type':'text/html; charset=utf-8'});return true;}
  if(req.method==='GET'&&url.pathname==='/downloads/streamlit-uputstvo'&&streamlitGuide){send(res,200,streamlitGuide,{'Content-Type':'text/html; charset=utf-8'});return true;}
  if(req.method==='GET'&&url.pathname==='/downloads/produkcija'){send(res,200,productionGuide,{'Content-Type':'text/plain; charset=utf-8'});return true;}
  if(req.method==='GET'&&url.pathname==='/login'){if(user){send(res,303,'',{Location:loginDestination(url.searchParams.get('next'))});}else send(res,200,loginHtml,{'Content-Type':'text/html; charset=utf-8'});return true;}
  if(url.pathname==='/api/me'&&req.method==='GET'){json(res,200,{...(user||{authenticated:false,authMode:'password'}),backgroundAvailable:true,intervalSeconds:300});return true;}
  if(url.pathname==='/api/auth/login'&&req.method==='POST'){
   if(!sameOrigin(req)){json(res,403,{error:'Nedozvoljen zahtev.'});return true;}
   try{const body=await readBody(req,4096);const result=await auth.login(body.username,body.password,{client:trustProxy?String(req.headers['x-real-ip']||req.socket.remoteAddress||'local'):req.socket.remoteAddress||'local'});if(!result.ok)json(res,result.status,{error:result.error},result.retryAfter?{'Retry-After':String(result.retryAfter)}:{});else json(res,200,{user:result.user,redirect:loginDestination(body.next)},{'Set-Cookie':result.cookie});}
   catch{json(res,400,{error:'Neispravan zahtev za prijavu.'});}return true;
  }
  if(!user){if(url.pathname.startsWith('/api/')||(isPackagePath(url.pathname)||isCloudPackagePath(url.pathname)||url.pathname==='/downloads/cloud-secrets.toml')&&!isBrowserNavigation(req.headers.accept,req.headers['sec-fetch-mode']))json(res,401,{error:'Prijavite se kao operater.'});else send(res,303,'',{Location:loginPath(url.pathname)});return true;}
  if(url.pathname.startsWith('/api/')){
   if(req.headers['x-scoreguard-operator']&&req.headers['x-scoreguard-operator']!==user.id){json(res,409,{code:'ACCOUNT_CHANGED',error:'Aktivan nalog je promenjen u drugoj kartici. Osvežite stranicu.'});return true;}
   if(req.method!=='GET'&&!sameOrigin(req)){json(res,403,{error:'Nedozvoljen zahtev.'});return true;}
   try{
    if(url.pathname==='/api/auth/logout'&&req.method==='POST'){json(res,200,{ok:true},{'Set-Cookie':await auth.logout(req.headers.cookie)});return true;}
    if(url.pathname==='/api/monitor'&&req.method==='GET'){json(res,200,{monitor:monitor.snapshot(user.id),view:monitorPresentation(monitor.snapshot(user.id)),background:true});return true;}
    if(url.pathname==='/api/import/preview'&&req.method==='POST'){const body=await readBody(req);json(res,200,importPreview(body));return true;}
    if(url.pathname==='/api/review'&&req.method==='POST'){const body=await readBody(req,8000);json(res,200,{review:await monitor.review(user.id,{matchId:body.matchId,note:body.note,actorName:user.name})});return true;}
    if(url.pathname==='/api/watch'&&req.method==='DELETE'){json(res,200,{monitor:await monitor.pause(user.id),background:true});return true;}
    if(url.pathname==='/api/watch'&&req.method==='PUT'){const raw=await readBody(req),watch=validateWatch(raw);json(res,200,{monitor:await monitor.configure(user.id,watch,{enabled:raw.enabled!==false}),background:true});return true;}
    if(url.pathname==='/api/compare'&&req.method==='POST'){const raw=await readBody(req),watch=validateWatch(raw);const snapshot=await monitor.configure(user.id,watch,{enabled:raw.enabled!==false});json(res,200,{...await monitor.check(user.id,{trigger:raw.trigger==='scheduled'?'scheduled':'manual',revision:snapshot.revision}),background:true});return true;}
    json(res,404,{error:'Nepoznata API putanja.'});
   }catch(e){json(res,400,{error:e.message||'Zahtev nije izvršen.'});}return true;
  }
  if(req.method==='GET'&&(isCloudPackagePath(url.pathname)||url.pathname==='/downloads/cloud-secrets.toml')){
   if(user.role!=='admin'){json(res,403,{error:'Cloud paket i konfiguraciju preuzima administrator.'});return true;}
   if(!cloudZip){json(res,404,{error:'Paket za postavljanje nije dostupan u testnom Cloud servisu.'});return true;}
   if(url.pathname==='/downloads/cloud-secrets.toml')send(res,200,cloudSecrets(auth.config),{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename=cloud-secrets.toml','Cache-Control':'private, no-store'});
   else send(res,200,cloudZip,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename=ScoreGuard-cloud-v0.7.zip','Cache-Control':'private, no-store'});
   return true;
  }
  if(req.method==='GET'&&isPackagePath(url.pathname)){
   if(user.role!=='admin'){json(res,403,{error:'Paket za postavljanje može preuzeti administrator.'});return true;}
   if(!sourceZip){json(res,404,{error:'Paket za postavljanje nije dostupan u testnom Cloud servisu.'});return true;}
   const zip=appendZipEntry(sourceZip,'scoreguard/secrets/operators.json',JSON.stringify(auth.config,null,2)+'\n');send(res,200,zip,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename=ScoreGuard-streamlit-v0.6.zip'});return true;
  }
  if(req.method==='GET'&&url.pathname==='/downloads/uputstvo'){send(res,200,readme,{'Content-Type':'text/plain; charset=utf-8'});return true;}
  if(req.method==='GET'&&url.pathname==='/'){send(res,200,html,{'Content-Type':'text/html; charset=utf-8'});return true;}
  json(res,404,{error:'Nepoznata putanja.'});return true;
 };
}
