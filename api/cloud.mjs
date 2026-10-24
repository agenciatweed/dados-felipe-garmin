import {get,put} from '@vercel/blob';
import {gunzipSync} from 'node:zlib';
import {timingSafeEqual} from 'node:crypto';
import catalog from '../cloud/catalog.json' with {type:'json'};

const cache=new Map();
const dayList=(a,b)=>{const out=[];for(let d=a;d<=b;){out.push(d);const t=new Date(d+'T12:00:00Z');t.setUTCDate(t.getUTCDate()+1);d=t.toISOString().slice(0,10);}return out;};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date());
const safeEqual=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&x.length>0&&timingSafeEqual(x,y);};
async function read(key){
 const cached=cache.get(key);if(cached&&Date.now()-cached.at<60000)return cached.data;
 const result=await get(`garmin/${key}.json.gz`,{access:'private',useCache:false});
 if(!result||result.statusCode!==200)return null;
 const bytes=Buffer.from(await new Response(result.stream).arrayBuffer());
 const data=JSON.parse(gunzipSync(bytes,{maxOutputLength:100_000_000}).toString('utf8'));
 if(cache.size>36)cache.delete(cache.keys().next().value);cache.set(key,{at:Date.now(),data});return data;
}
const json=(res,status,data)=>res.status(status).json(data);
function validDay(d){return /^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(new Date(d+'T12:00:00Z').getTime());}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
 const url=new URL(req.url,'https://local.invalid');const route=req.query?.route||url.searchParams.get('route')||url.pathname;
 try{
  if(route==='/api/ingest'){
   if(req.method!=='POST')return json(res,405,{error:'Método não permitido.'});
   if(!safeEqual(req.headers.authorization,'Bearer '+(process.env.GARMIN_SYNC_SECRET||''))||!process.env.GARMIN_SYNC_SECRET)return json(res,401,{error:'Acesso não autorizado.'});
   const key=req.headers['x-garmin-object'];if(typeof key!=='string'||!/^(index|\d{4}-(0[1-9]|1[0-2]))$/.test(key))return json(res,400,{error:'Arquivo inválido.'});
   let bytes;
   if(Buffer.isBuffer(req.body))bytes=req.body;else {const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>3_500_000)return json(res,413,{error:'Arquivo muito grande.'});chunks.push(chunk);}bytes=Buffer.concat(chunks);}
   if(bytes.length>3_500_000)return json(res,413,{error:'Arquivo muito grande.'});
   const parsed=JSON.parse(gunzipSync(bytes,{maxOutputLength:100_000_000}).toString('utf8'));
   if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return json(res,400,{error:'Conteúdo inválido.'});
   await put(`garmin/${key}.json.gz`,bytes,{access:'private',addRandomSuffix:false,allowOverwrite:true,contentType:'application/gzip',cacheControlMaxAge:60});cache.delete(key);
   return json(res,200,{ok:true});
  }
  if(req.method!=='GET')return json(res,405,{error:'Método não permitido.'});
  if(route==='/api/catalog')return json(res,200,{resources:catalog,today:today(),api_version:'1.0.0',endpoints:catalog.length,local_mode:true,remote_mode:true});
  const index=await read('index');
  if(route==='/api/sync/status')return json(res,200,index?.status||{mode:'history',state:'not_started',months_completed:0,activities:{n:0},jobs:{},errors:[]});
  if(!route.startsWith('/api/resource/'))return json(res,404,{error:'Recurso não encontrado.'});
  const id=route.split('/').at(-1),r=catalog.find(r=>r.id===id);if(!r)return json(res,404,{error:'Recurso removido ou desconhecido.'});
  if(!index)return json(res,409,{error:'O coletor ainda não enviou os primeiros dados privados.',not_collected:true});
  const q={...Object.fromEntries(url.searchParams),...req.query};
  const end=q.end||today(),start=q.start||end,day=q.day||end,aid=q.activity||'';
  if(![start,end,day].every(validDay)||start>end||(new Date(end)-new Date(start))/86400000>366)return json(res,400,{error:'Período inválido; selecione até 366 dias.'});
  if(['activity','download'].includes(r.scope)&&!/^\d{1,25}$/.test(aid))return json(res,400,{error:'Selecione uma atividade.'});
  let data, fetched=null, covered=new Set(),expected=[];
  if(r.scope==='static'){
   const found=index.static[id];if(!found)return json(res,409,{error:'Configurações ainda não coletadas.',not_collected:true});data=found.data;fetched=found.fetched_at;
  }else{
   const periods=r.scope==='day'?[day.slice(0,7)]:['activity','download'].includes(r.scope)?index.months:index.months.filter(m=>m>=start.slice(0,7)&&m<=end.slice(0,7));
   const docs=[];for(const month of periods){const doc=await read(month);if(doc)docs.push(doc);}
   fetched=docs.map(d=>d.fetched_at).filter(Boolean).sort().at(-1)||null;
   if(id==='activities')data=docs.flatMap(d=>d.activities||[]).filter(a=>a.startTimeLocal?.slice(0,10)>=start&&a.startTimeLocal.slice(0,10)<=end).sort((a,b)=>(b.startTimeLocal||'').localeCompare(a.startTimeLocal||''));
   else if(r.scope==='activity'||r.scope==='download'){
    data=docs.map(d=>d[id]?.[aid]).find(d=>d!==undefined);
    if(data===undefined)return json(res,409,{error:'Os detalhes desta atividade ainda não foram coletados.',not_collected:true});
    if(r.scope==='download'){res.setHeader('Content-Type','application/zip');res.setHeader('Content-Disposition',`attachment; filename="atividade-${aid}.zip"`);return res.status(200).send(Buffer.from(data,'base64'));}
   }else if(r.scope==='day'){data=docs.find(d=>Object.hasOwn(d.daily?.[id]||{},day))?.daily[id][day]??null;}
   else {data=[];for(const doc of docs)for(const [d,items]of Object.entries(doc.daily?.[id]||{}))if(d>=start&&d<=end)data.push(...items);if(id==='daily_range')data={data};}
   expected=r.scope==='day'?[day]:['range','activities'].includes(r.scope)?dayList(start,end):[];
   for(const doc of docs)for(const d of Object.keys(doc.coverage?.[id]||{}))if(expected.includes(d))covered.add(d);
   if(expected.length&&!covered.size&&!(id==='activities'&&data.length))return json(res,409,{error:'Este dia ou período ainda não foi coletado.',not_collected:true});
  }
  const missing=expected.filter(d=>!covered.has(d));
  return json(res,200,{data,fetched_at:fetched,local:true,source:'Arquivo privado · Garmin Personal API',empty:data===null||(Array.isArray(data)&&!data.length),coverage:{complete:!missing.length,collected_days:covered.size,requested_days:expected.length,missing_days:missing},warnings:[]});
 }catch{return json(res,503,{error:'Não foi possível ler o armazenamento privado. Os dados locais permanecem preservados.'});}
}
