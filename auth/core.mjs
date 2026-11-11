const authEncoder=new TextEncoder();
export const SESSION_SECONDS=8*60*60;
function toBase64url(bytes){let text='';for(const b of bytes)text+=String.fromCharCode(b);return btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function fromBase64url(value){const text=atob(value.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(text,c=>c.charCodeAt(0));}
function constantEqual(a,b){if(a.length!==b.length)return false;let difference=0;for(let i=0;i<a.length;i++)difference|=a[i]^b[i];return difference===0;}
export function validateAccounts(config){
 if(config?.version!==1||!Array.isArray(config.accounts)||!config.accounts.length)throw Error('Nedostaje konfiguracija naloga operatera.');
 const names=new Set(),ids=new Set();
 for(const a of config.accounts){
  if(!/^[a-z0-9._-]{2,40}$/.test(a.username||'')||names.has(a.username)||!/^operator-[a-z0-9._-]{2,40}$/.test(a.id||'')||ids.has(a.id)||typeof a.name!=='string'||a.name.length>80||!['admin','operator'].includes(a.role)||a.algorithm!=='PBKDF2-SHA256'||!Number.isInteger(a.iterations)||a.iterations<100000||a.iterations>1000000||typeof a.salt!=='string'||typeof a.passwordHash!=='string')throw Error('Neispravna konfiguracija naloga operatera.');
  try{if(fromBase64url(a.salt).length<16||fromBase64url(a.passwordHash).length!==32)throw Error('Invalid');}catch{throw Error('Neispravan heš naloga operatera.');}
  names.add(a.username);ids.add(a.id);
 }
 return config;
}
export async function hashPassword(password,salt,iterations=100000){
 const key=await crypto.subtle.importKey('raw',authEncoder.encode(password),'PBKDF2',false,['deriveBits']);
 return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:fromBase64url(salt),iterations,hash:'SHA-256'},key,256));
}
export async function createAccount({username,name,password,role='operator',iterations=100000}){
 if(typeof password!=='string'||password.length<10||password.length>256)throw Error('Lozinka mora imati od 10 do 256 znakova.');
 username=username.toLowerCase().trim();const salt=toBase64url(crypto.getRandomValues(new Uint8Array(16)));
 return{id:'operator-'+username,username,name,role,algorithm:'PBKDF2-SHA256',iterations,salt,passwordHash:toBase64url(await hashPassword(password,salt,iterations)),enabled:true};
}
async function accountVersion(account){return toBase64url(new Uint8Array(await crypto.subtle.digest('SHA-256',authEncoder.encode(account.passwordHash+'|'+account.salt+'|'+account.role)))).slice(0,24);}
export class LoginLimiter{
 constructor({clock=()=>Date.now(),limit=8,windowMs=15*60*1000}={}){this.clock=clock;this.limit=limit;this.windowMs=windowMs;this.entries=new Map();}
 check(key){const entry=this.entries.get(key);if(!entry||entry.until<=this.clock()){this.entries.delete(key);return 0;}return entry.count>=this.limit?Math.ceil((entry.until-this.clock())/1000):0;}
 fail(key){if(this.entries.size>2000){for(const [k,v]of this.entries)if(v.until<=this.clock())this.entries.delete(k);if(this.entries.size>2000)this.entries.delete(this.entries.keys().next().value);}const entry=this.entries.get(key);this.entries.set(key,!entry||entry.until<=this.clock()?{count:1,until:this.clock()+this.windowMs}:{...entry,count:entry.count+1});}
 clear(key){this.entries.delete(key);}
}
export class OperatorAuth{
 constructor({accounts,signingKey,secure=true,clock=()=>Date.now(),sessionStore=null,limiter=new LoginLimiter({clock})}){
  this.config=validateAccounts(accounts);if(typeof signingKey!=='string'||signingKey.length<32)throw Error('Nedostaje ključ za potpisivanje sesija.');this.signingKey=signingKey;this.secure=secure;this.clock=clock;this.sessionStore=sessionStore;this.limiter=limiter;
 }
 get cookieName(){return this.secure?'__Host-scoreguard_session':'scoreguard_session';}
 async signature(payload){const key=await crypto.subtle.importKey('raw',authEncoder.encode(this.signingKey),{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',key,authEncoder.encode(payload)));}
 publicUser(account){return{id:account.id,username:account.username,name:account.name,role:account.role,authenticated:true,authMode:'password'};}
 async login(username,password,{client='unknown',binding=''}={}){
  username=String(username||'').toLowerCase().trim();const nameKey='name:'+username,clientKey='client:'+client,retry=Math.max(this.limiter.check(nameKey),this.limiter.check(clientKey));
  if(retry)return {ok:false,status:429,retryAfter:retry,error:'Previše neuspešnih prijava. Pokušajte ponovo kasnije.'};
  this.limiter.fail(clientKey);
  if(typeof password!=='string'||password.length>256){this.limiter.fail(nameKey);return{ok:false,status:401,error:'Pogrešno korisničko ime ili lozinka.'};}
  const account=this.config.accounts.find(a=>a.username===username&&a.enabled!==false),target=account||this.config.accounts[0];
  const actual=await hashPassword(password,target.salt,target.iterations),valid=account&&constantEqual(actual,fromBase64url(account.passwordHash));
  if(!valid){this.limiter.fail(nameKey);return{ok:false,status:401,error:'Pogrešno korisničko ime ili lozinka.'};}
  this.limiter.clear(nameKey);this.limiter.clear(clientKey);
  const now=Math.floor(this.clock()/1000),payload={id:account.id,version:await accountVersion(account),iat:now,exp:now+SESSION_SECONDS,nonce:toBase64url(crypto.getRandomValues(new Uint8Array(24))),binding};
  const encoded=toBase64url(authEncoder.encode(JSON.stringify(payload))),token=encoded+'.'+toBase64url(await this.signature(encoded));
  if(this.sessionStore)await this.sessionStore.add(payload);
  return{ok:true,user:this.publicUser(account),token,cookie:this.cookie(token),payload};
 }
 cookie(value,{clear=false}={}){return this.cookieName+'='+value+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+(clear?0:SESSION_SECONDS)+(this.secure?'; Secure':'');}
 tokenFromCookie(header){if(typeof header!=='string')return null;return header.split(';').map(s=>s.trim()).find(s=>s.startsWith(this.cookieName+'='))?.slice(this.cookieName.length+1)||null;}
 async verify(token,{binding=''}={}){
  try{
   if(!token||token.length>4096)return null;const parts=token.split('.');if(parts.length!==2||!constantEqual(await this.signature(parts[0]),fromBase64url(parts[1])))return null;
   const payload=JSON.parse(new TextDecoder().decode(fromBase64url(parts[0]))),now=Math.floor(this.clock()/1000);
   if(!Number.isInteger(payload.exp)||payload.exp<=now||!Number.isInteger(payload.iat)||payload.iat>now+30||payload.exp-payload.iat!==SESSION_SECONDS||payload.binding!==binding||typeof payload.nonce!=='string')return null;
   const account=this.config.accounts.find(a=>a.id===payload.id&&a.enabled!==false);if(!account||payload.version!==await accountVersion(account))return null;
   if(this.sessionStore&&!await this.sessionStore.has(payload))return null;
   return{user:this.publicUser(account),payload};
  }catch{return null;}
 }
 async fromCookie(header,options){return this.verify(this.tokenFromCookie(header),options);}
 async logout(header){const token=this.tokenFromCookie(header);if(this.sessionStore&&token){const session=await this.verify(token);if(session)await this.sessionStore.remove(session.payload.nonce);}return this.cookie('',{clear:true});}
}
