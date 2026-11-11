import {parseInput,validDate,validateWatch,resultStatus,referenceFresh} from './model.mjs';
import {isNativeClipboard,parseNativeClipboard,mapNativeClipboard} from './native-import.mjs';
export function importPreview(body){
 if(!body||typeof body.text!=='string'||body.text.length>256000)return{format:'native',rows:[],errors:['Unos je prazan ili prevelik.'],warnings:[],preview:[]};
 const format=body.format||'auto';if(!['auto','native','standard'].includes(format))return{rows:[],errors:['Nepoznat format unosa.'],warnings:[],preview:[]};
 const native=format==='native'||format==='auto'&&isNativeClipboard(body.text);
 if(native){const parsed=parseNativeClipboard(body.text),mapped=mapNativeClipboard(parsed,{baseDate:body.date});return{...mapped,format:'native',preview:parsed.rows};}
 const result=parseInput(body.text);if(!validDate(body.date))result.errors.push('Izaberite datum spiska.');return{...result,format:'standard',warnings:[],preview:result.rows};
}
export function monitorPresentation(snapshot,now=Date.now()){
 if(!snapshot)return {matches:[],counts:{all:0,match:0,mismatch:0,unverified:0}};
 const byId=new Map((snapshot.lastResult?.results||[]).map(r=>[r.id,r.refs]));
 const counts={all:snapshot.watch.matches.length,match:0,mismatch:0,unverified:0};
 const matches=snapshot.watch.matches.map(m=>{const refs=byId.get(m.id)||{},status=resultStatus({...m,refs},snapshot.watch.sources,now);counts[status]++;return{...m,refs:Object.fromEntries(Object.entries(refs).map(([source,ref])=>[source,{...ref,stale:!referenceFresh(ref,now)}])),comparisonStatus:status,ack:snapshot.reviews?.[m.id]||null};});
 return{matches,counts};
}
