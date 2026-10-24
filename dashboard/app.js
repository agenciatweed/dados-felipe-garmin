'use strict';
const $ = (s, parent=document) => parent.querySelector(s);
const $$ = (s, parent=document) => [...parent.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = (v, d=0) => typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('pt-BR',{maximumFractionDigits:d,minimumFractionDigits:d}) : '—';
const duration = v => typeof v === 'number' ? `${Math.floor(v/3600)}h ${String(Math.floor(v%3600/60)).padStart(2,'0')}min` : '—';
const pace = speed => {const seconds=Math.round(1000/speed);return speed>0?`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`:'—';};
const dateBR = d => /^\d{4}-\d{2}-\d{2}/.test(d || '') ? d.slice(0,10).split('-').reverse().join('/') : '—';
const isoShift = (d, offset) => {const dt=new Date(d+'T12:00:00Z');dt.setUTCDate(dt.getUTCDate()+offset);return dt.toISOString().slice(0,10);};
const state={catalog:[],activities:[],previous:[],view:'treinos',selected:null,day:'',today:'',generation:0,loaded:new Set(),payloads:new Map(),loading:0};
const labels={
 distance:'Distância',duration:'Duração',movingDuration:'Tempo em movimento',elapsedDuration:'Tempo total',averageHR:'FC média',maxHR:'FC máxima',minHR:'FC mínima',restingHeartRate:'FC de repouso',maxHeartRate:'FC máxima',minHeartRate:'FC mínima',lastSevenDaysAvgRestingHeartRate:'Repouso · média de 7 dias',sleepTimeSeconds:'Tempo de sono',deepSleepSeconds:'Sono profundo',lightSleepSeconds:'Sono leve',remSleepSeconds:'Sono REM',awakeSleepSeconds:'Tempo acordado',napTimeSeconds:'Sonecas',averageRespirationValue:'Respiração média',lowestRespirationValue:'Respiração mínima',highestRespirationValue:'Respiração máxima',charged:'Carga recuperada',drained:'Carga consumida',totalSteps:'Passos',stepGoal:'Meta de passos',totalDistance:'Distância diária',totalKilocalories:'Calorias totais',activeKilocalories:'Calorias ativas',wellnessKilocalories:'Calorias de bem-estar',totalStressDuration:'Duração do estresse',averageStressLevel:'Estresse médio',maxStressLevel:'Estresse máximo',bodyBatteryHighestValue:'Body Battery máxima',bodyBatteryLowestValue:'Body Battery mínima',bodyBatteryChargedValue:'Body Battery recuperada',bodyBatteryDrainedValue:'Body Battery consumida',weight:'Peso',bmi:'IMC',bodyFat:'Gordura corporal',bodyWater:'Água corporal',muscleMass:'Massa muscular',boneMass:'Massa óssea',metabolicAge:'Idade metabólica',fitnessAge:'Idade de condicionamento',chronologicalAge:'Idade cronológica',averageSpo2:'SpO₂ média',lowestSpo2:'SpO₂ mínima',latestSpo2:'SpO₂ mais recente',vo2Max:'VO₂ máx.',calendarDate:'Data',date:'Data',activityName:'Nome da atividade',activityId:'ID da atividade',elevationGain:'Ganho de elevação',elevationLoss:'Perda de elevação',averageSpeed:'Velocidade média',maxSpeed:'Velocidade máxima',calories:'Calorias',averageRunCadence:'Cadência média',strideLength:'Comprimento da passada',directWorkoutRpe:'Esforço percebido',directWorkoutFeel:'Sensação do treino',startTimeLocal:'Início local',startTimeGMT:'Início UTC',heartRateValues:'Medições de frequência cardíaca',bodyBatteryValuesArray:'Medições de Body Battery',data:'Registros',dailySleepDTO:'Sono',sleepScores:'Pontuações do sono',hrvSummary:'Resumo HRV',hrvReadings:'Medições HRV',userData:'Dados do usuário',userSleep:'Sono do usuário',userProfile:'Perfil',profileId:'ID do perfil',gender:'Gênero',height:'Altura',birthDate:'Data de nascimento',displayName:'Nome de exibição',hydration:'Hidratação',valueInML:'Volume em mL',goalInML:'Meta em mL',consumedInML:'Consumido em mL',totalAverage:'Médias do período',dateWeightList:'Medições de peso',allMetrics:'Métricas completas',summaryDTO:'Resumo da atividade',metadataDTO:'Metadados',splitSummaries:'Resumos de parciais',activityTypeDTO:'Modalidade',zone1Floor:'Limite inferior da zona 1',zone2Floor:'Limite inferior da zona 2',zone3Floor:'Limite inferior da zona 3',zone4Floor:'Limite inferior da zona 4',zone5Floor:'Limite inferior da zona 5',maxHeartRateUsed:'FC máxima usada',restingHeartRateUsed:'FC de repouso usada'};
const label = key => labels[key] || key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ');
function fmt(key,v){
 if(v===null||v===undefined)return 'Sem registro';
 if(typeof v==='boolean')return v?'Sim':'Não';
 if(typeof v==='number'){
  if(/Seconds$/.test(key)||['duration','movingDuration','elapsedDuration','totalStressDuration'].includes(key))return duration(v);
  if(['averageHR','maxHR','minHR','restingHeartRate','maxHeartRate','minHeartRate','lastSevenDaysAvgRestingHeartRate'].includes(key))return num(v)+' bpm';
  if(['weight','muscleMass','boneMass'].includes(key))return num(v/1000,1)+' kg';
  if(['distance','totalDistance'].includes(key))return num(v/1000,2)+' km';
  return num(v,Number.isInteger(v)?0:2);
 }
 return String(v);
}
async function request(id, params={}){
 const active=state.loadedRange||{start:$('#start').value,end:$('#end').value};
 const q=new URLSearchParams({...active,day:state.day,...params});
 const response=await fetch(`/api/resource/${id}?${q}`);
 const d=await response.json();if(!response.ok){const error=new Error(d.error || 'Não foi possível consultar este recurso.');error.notCollected=!!d.not_collected;throw error;}return {...d,query:Object.fromEntries(q)};
}
function showError(message,neutral=false){$('#global-error').textContent=message;$('#global-error').className='notice'+(neutral?'':' error');$('#global-error').hidden=!message;}
function loading(value){state.loading+=value;$('#sync-state').textContent=state.loading>0?'Lendo arquivo local…':'Arquivo local · sem chamadas à Garmin';}
function filtered(items){return items.filter(a=>!$('#sport').value||a.activityType?.typeKey===$('#sport').value);}
function running(a){return /running|run|treadmill|trail/i.test(a.activityType?.typeKey||'');}
const sportNames={running:'Corrida',cycling:'Ciclismo',walking:'Caminhada',strength_training:'Musculação',treadmill_running:'Corrida em esteira',trail_running:'Corrida em trilha',hiking:'Trilha',swimming:'Natação',lap_swimming:'Natação em piscina',indoor_cycling:'Ciclismo indoor',other:'Outra atividade'};
const sportName=a=>sportNames[a.activityType?.typeKey] || label(a.activityType?.typeKey||'Atividade');
function totals(items){
 const distance=items.reduce((s,a)=>s+(a.distance||0),0), seconds=items.reduce((s,a)=>s+(a.duration||0),0);
 const runs=items.filter(running), rd=runs.reduce((s,a)=>s+(a.distance||0),0), rt=runs.reduce((s,a)=>s+(a.duration||0),0);
 return {count:items.length,distance,seconds,speed:rt>0?rd/rt:0};
}
function delta(current,previous){if(!state.previousAvailable)return 'Comparação indisponível';if(!previous)return current?'Sem base no período anterior':'Sem variação';const p=(current-previous)/previous*100;return `${p>0?'+':''}${num(p,0)}% em relação ao período anterior`;}
function metric(name,value,unit,note){return `<div class="metric"><div class="metric-label">${esc(name)}</div><div class="metric-value">${esc(value)} <small>${esc(unit)}</small></div><div class="metric-note">${esc(note)}</div></div>`;}
function renderTraining(){
 if(!state.loadedRange||!state.trainingValid)return;
 const items=filtered(state.activities), previous=filtered(state.previous), t=totals(items), p=totals(previous);
 $('#range-label').textContent=`${dateBR(state.loadedRange.start)} — ${dateBR(state.loadedRange.end)}`;
 $('#metrics').innerHTML=metric('Distância acumulada',num(t.distance/1000,1),'km',delta(t.distance,p.distance))+metric('Tempo de treino',duration(t.seconds),'',delta(t.seconds,p.seconds))+metric('Atividades',num(t.count),'treinos',delta(t.count,p.count))+metric('Ritmo médio · corridas',pace(t.speed),t.speed?'/km':'',t.speed?'Ponderado pela distância e duração':'Sem corridas no período');
 renderVolume(items);
 $('#comparison').innerHTML=[['Distância',t.distance/1000,p.distance/1000,'km'],['Tempo de treino',t.seconds/3600,p.seconds/3600,'h']].map(([name,a,b,unit])=>{const m=Math.max(a,b,1);return `<div class="compare-row"><div class="compare-label"><span>${name}</span><strong>${num(a,1)} ${unit}</strong></div><svg class="compare-track" viewBox="0 0 100 5" preserveAspectRatio="none" aria-hidden="true"><rect class="compare-fill" width="${a/m*100}" height="5"/></svg><svg class="compare-track previous" viewBox="0 0 100 5" preserveAspectRatio="none" aria-hidden="true"><rect class="compare-fill" width="${b/m*100}" height="5"/></svg><div class="compare-caption">Anterior: ${state.previousAvailable?num(b,1)+' '+unit:'indisponível'}</div></div>`;}).join('');
 const search=$('#activity-search').value.toLocaleLowerCase('pt-BR');
 const visible=items.filter(a=>(a.activityName||'').toLocaleLowerCase('pt-BR').includes(search));
 $('#activity-count').textContent=`${visible.length}`;
 $('#activities').innerHTML=visible.map(a=>`<tr><td><button class="activity-link" data-activity="${esc(a.activityId)}">${esc(a.activityName||'Atividade sem título')}</button><div class="activity-sport"><span class="sport-mark"></span>${esc(sportName(a))}</div></td><td>${dateBR(a.startTimeLocal)}<div class="activity-sport">${esc((a.startTimeLocal||'').slice(11,16))}</div></td><td>${num((a.distance||0)/1000,2)} km</td><td>${duration(a.duration)}</td><td>${running(a)?pace(a.averageSpeed)+' /km':num((a.averageSpeed||0)*3.6,1)+' km/h'}</td><td>${a.averageHR>0?num(a.averageHR)+' bpm':'—'}</td><td>${typeof a.elevationGain==='number'?num(a.elevationGain)+' m':'—'}</td></tr>`).join('');
 $('#activity-empty').hidden=visible.length>0;$('#activity-empty').textContent=search?'Nenhuma atividade corresponde à busca.':'Nenhuma atividade registrada nesta modalidade e período.';
 $$('[data-activity]',$('#activities')).forEach(b=>b.addEventListener('click',()=>openActivity(b.dataset.activity)));
}
function renderVolume(items){
 const groups=new Map();let day=state.loadedRange.start, end=state.loadedRange.end;
 const monday=d=>{const dt=new Date(d+'T12:00:00Z');return isoShift(d,-((dt.getUTCDay()+6)%7));};
 for(let d=monday(day);d<=end;d=isoShift(d,7))groups.set(d,0);
 for(const a of items){const d=monday((a.startTimeLocal||'').slice(0,10));if(groups.has(d))groups.set(d,groups.get(d)+(a.distance||0)/1000);}
 if(!items.length){$('#volume-chart').innerHTML='<div class="empty">O volume semanal aparecerá quando houver atividades neste período.</div>';return;}
 const values=[...groups], width=Math.max(260,$('#volume-chart').clientWidth),height=210,left=35,right=10,top=12,bottom=30,plotW=width-left-right,plotH=height-top-bottom,max=Math.max(...values.map(([,v])=>v),1)*1.15,step=plotW/values.length;
 let svg=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Gráfico de distância em quilômetros por semana"><title>Distância semanal: ${esc(values.map(([d,v])=>dateBR(d)+': '+num(v,1)+' km').join('; '))}</title>`;
 for(let i=0;i<=4;i++){const y=top+plotH-i/4*plotH;svg+=`<line x1="${left}" x2="${width-right}" y1="${y}" y2="${y}" stroke="#303442"/><text x="${left-8}" y="${y+3}" text-anchor="end">${num(max*i/4)}</text>`;}
 const maxTicks=width<450?4:8;
 values.forEach(([d,v],i)=>{const w=Math.min(step*.55,55),x=left+i*step+(step-w)/2,h=v/max*plotH;svg+=`<rect class="bar" x="${x}" y="${top+plotH-h}" width="${w}" height="${h}" rx="2"><title>Semana de ${dateBR(d)}: ${num(v,2)} km</title></rect>`;if(i%Math.max(1,Math.ceil(values.length/maxTicks))===0)svg+=`<text x="${left+i*step+step/2}" y="${height-8}" text-anchor="middle">${dateBR(d).slice(0,5)}</text>`;});
 $('#volume-chart').innerHTML=svg+'</svg>';
}
function tree(data,key='',depth=0){
 if(data===null||typeof data!=='object')return `<div class="leaf"><span title="${esc(key)}">${esc(label(key))}</span><strong>${esc(fmt(key,data))}</strong></div>`;
 const entries=Object.entries(data);if(!entries.length)return '<p class="nested-hint">Sem registros.</p>';
 return entries.map(([k,v])=>{if(v!==null&&typeof v==='object'){const count=Object.keys(v).length;return `<details ${depth<1?'open':''}><summary>${esc(label(k))} <span class="meta">(${count} ${Array.isArray(v)?'itens':'campos'})</span></summary>${tree(v,k,depth+1)}</details>`;}return tree(v,k,depth+1);}).join('');
}
function flatten(data,prefix='',out=[]){if(data&&typeof data==='object'){for(const [k,v]of Object.entries(data))flatten(v,prefix?prefix+'.'+k:k,out);}else out.push([prefix,data]);return out;}
function mountTree(container,data){
 container.replaceChildren();
 function append(parent,obj,key){
  if(obj===null||typeof obj!=='object'){const row=document.createElement('div');row.className='leaf';row.innerHTML=`<span title="${esc(key)}">${esc(label(key))}</span><strong>${esc(fmt(key,obj))}</strong>`;parent.append(row);return;}
  const entries=Object.entries(obj);let offset=0;
  function chunk(){const end=Math.min(offset+100,entries.length);for(;offset<end;offset++){const [k,v]=entries[offset];if(v!==null&&typeof v==='object'){const d=document.createElement('details'),s=document.createElement('summary');s.textContent=label(k)+` (${Object.keys(v).length} ${Array.isArray(v)?'itens':'campos'})`;d.append(s);let loaded=false;d.addEventListener('toggle',()=>{if(d.open&&!loaded){loaded=true;append(d,v,k);}});parent.append(d);}else append(parent,v,k);}if(offset<entries.length){const b=document.createElement('button');b.className='button secondary';b.textContent=`Mostrar mais registros (${entries.length-offset} restantes)`;b.addEventListener('click',()=>{b.remove();chunk();});parent.append(b);}}
  if(!entries.length){const p=document.createElement('p');p.className='nested-hint';p.textContent='Sem registros.';parent.append(p);}else chunk();
 }
 append(container,data,'Valor');
}
function dataViewer(container,data,title){
 container.innerHTML=`<div class="data-toolbar"><input type="search" placeholder="Buscar campo ou valor…" aria-label="Buscar campo ou valor"><button class="button secondary" data-export>Exportar JSON</button><button class="button secondary" data-raw>Ver JSON</button></div><p class="nested-hint">Os nomes originais dos campos são preservados no JSON. Expanda os grupos para ver cada registro.</p><div class="data-tree"></div><pre class="raw" hidden></pre>`;
 const input=$('input',container), view=$('.data-tree',container), raw=$('.raw',container);
 let leaves=null;mountTree(view,data);
 input.addEventListener('input',()=>{const q=input.value.toLowerCase();if(!q){mountTree(view,data);return;}leaves ||= flatten(data);const found=leaves.filter(([k,v])=>(k+' '+label(k.split('.').pop())+' '+String(v)).toLowerCase().includes(q));view.innerHTML=found.length?found.slice(0,500).map(([k,v])=>`<div class="leaf"><span>${esc(k)}</span><strong>${esc(v===null?'Sem registro':v)}</strong></div>`).join(''):'<p>Nenhum campo encontrado.</p>';if(found.length>500)view.insertAdjacentHTML('beforeend','<p>Mostrando 500 resultados. Refine a busca.</p>');});
 $('[data-export]',container).addEventListener('click',()=>downloadJSON(data,title));
 $('[data-raw]',container).addEventListener('click',e=>{raw.hidden=!raw.hidden;view.hidden=!raw.hidden;input.disabled=!raw.hidden;raw.textContent=raw.hidden?'':JSON.stringify(data,null,2);e.target.textContent=raw.hidden?'Ver JSON':'Ver campos';});
}
function downloadJSON(data,title){const u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download=`garmin-${title.replace(/[^a-z0-9-]/gi,'-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
async function openActivity(id){
 const dialog=$('#detail'), a=state.activities.find(a=>String(a.activityId)===String(id));$('#detail-title').textContent=a?.activityName||'Detalhes da atividade';$('#detail-body').innerHTML='<div class="empty">Lendo os detalhes salvos…</div>';if(!dialog.open)dialog.showModal();
 try{const res=await request('activity',{activity:id}), d=res.data, s=d?.summaryDTO||{};
 $('#detail-body').innerHTML=`<p>${esc(sportName(a||{}))} · ${dateBR(s.startTimeLocal)} · ${esc((s.startTimeLocal||'').slice(11,16))}</p><div class="detail-metrics">${[['Distância',fmt('distance',s.distance)],['Duração',duration(s.duration)],['FC média',fmt('averageHR',s.averageHR)],['Ganho de elevação',typeof s.elevationGain==='number'?num(s.elevationGain)+' m':'—']].map(([l,v])=>`<div class="measure"><label>${l}</label><strong>${esc(v)}</strong></div>`).join('')}</div><div class="detail-actions"><a class="button" href="/api/resource/download?activity=${encodeURIComponent(id)}">Baixar arquivo original</a><button class="button secondary" id="workout-query">Ver treinos associados</button></div><div id="workout-output"></div><h3>Todos os dados desta atividade</h3><div id="activity-data"></div>`;
 dataViewer($('#activity-data'),d,'atividade-'+id);
 $('#workout-query').addEventListener('click',async e=>{e.target.disabled=true;const out=$('#workout-output');out.innerHTML='<p>Consultando treinos associados…</p>';try{const w=await request('workouts',{activity:id});out.innerHTML=w.empty?'<p class="notice">Nenhum treino associado a esta atividade.</p>':'<h3>Treinos associados</h3>';if(!w.empty){const c=document.createElement('div');out.append(c);dataViewer(c,w.data,'treinos-'+id);}}catch(err){out.innerHTML=`<p class="notice error">${esc(err.message)}</p>`;}finally{e.target.disabled=false;}});
 }catch(e){$('#detail-body').innerHTML=`<div class="notice error">${esc(e.message)}</div>`;}
}
const recoveryIds=['sleep','sleep_range','body_battery','stress'];
const healthIds=['heart_rate','steps','daily','daily_range','zones'];
function meaningful(id,data){
 if(data===null||data===undefined)return false;
 if(id==='spo2')return Object.entries(data).some(([k,v])=>/spo2/i.test(k)&&typeof v==='number'&&v>0);
 if(['weight','weight_all'].includes(id))return Array.isArray(data)?data.length>0:(data.dateWeightList||data.dailyWeightSummaries||[]).length>0;
 if(id==='food')return (data.mealDetails||[]).length>0||(data.loggedFoodsWithServingSizes||[]).length>0;
 if(id==='sleep')return (data.sleepTimeSeconds||data.dailySleepDTO?.sleepTimeSeconds||0)>0;
 if(Array.isArray(data))return data.length>0;
 if(data&&typeof data==='object')return Object.values(data).some(v=>v!==null&&v!==undefined&&(!Array.isArray(v)||v.length>0));
 return true;
}
const summaryKeys={sleep:['sleepTimeSeconds','deepSleepSeconds','remSleepSeconds','averageRespirationValue'],heart_rate:['restingHeartRate','minHeartRate','maxHeartRate'],daily:['totalSteps','activeKilocalories','restingHeartRate','averageStressLevel'],zones:['zone1Floor','zone2Floor','zone3Floor','zone4Floor','zone5Floor','maxHeartRateUsed'],body_battery:['charged','drained'],fitness_age:['fitnessAge','chronologicalAge'],spo2:['averageSpo2','lowestSpo2'],weight:['weight','bmi','bodyFat'],hydration:['valueInML','goalInML']};
function collectMeasures(id,data){
 let obj=Array.isArray(data)?data.at(-1):data;if(!obj||typeof obj!=='object')return [];
 if(id==='sleep'&&obj.dailySleepDTO)obj=obj.dailySleepDTO;
 if(id==='weight')obj=obj.dateWeightList?.at(-1)||obj.dailyWeightSummaries?.at(-1)||{};
 if(id==='steps'&&Array.isArray(data))return [['Passos no período',num(data.reduce((s,d)=>s+(d.totalSteps||0),0))],['Dias retornados',num(data.length)]];
 if(id==='sleep_range'&&Array.isArray(data)){const nights=data.filter(d=>d.sleepTimeSeconds>0);return [['Sono médio por noite',nights.length?duration(nights.reduce((s,d)=>s+d.sleepTimeSeconds,0)/nights.length):'—'],['Noites com registro',num(nights.length)]];}
 if(id==='body_battery'&&Array.isArray(data)){const avg=k=>{const valid=data.filter(d=>typeof d[k]==='number');return valid.length?num(valid.reduce((s,d)=>s+d[k],0)/valid.length):'—';};return [['Carga média recuperada / dia',avg('charged')],['Carga média consumida / dia',avg('drained')]];}
 if(id==='stress'&&Array.isArray(data)){const days=data.filter(d=>typeof d.values?.overallStressLevel==='number'&&d.values.overallStressLevel>=0);return [['Estresse médio diário',days.length?num(days.reduce((s,d)=>s+d.values.overallStressLevel,0)/days.length):'—'],['Dias com medição',num(days.length)]];}
 const keys=summaryKeys[id]||Object.keys(obj).filter(k=>!/(id|timestamp|pk|version|type)/i.test(k)&&typeof obj[k]==='number').slice(0,4);
 return keys.filter(k=>obj[k]!==null&&obj[k]!==undefined).slice(0,6).map(k=>[label(k),fmt(k,obj[k])]);
}
function spark(id,data){
 let pairs=[];
 if(id==='heart_rate')pairs=(data?.heartRateValues||[]).filter(p=>p[1]>0).map(p=>[p[0],p[1]]);
 if(id==='body_battery')pairs=(data?.at?.(-1)?.bodyBatteryValuesArray||[]).filter(p=>p[1]>=0).map(p=>[p[0],p[1]]);
 if(id==='steps')pairs=(data||[]).map(p=>[p.calendarDate,p.totalSteps]);
 if(id==='sleep_range')pairs=(data||[]).filter(p=>p.sleepTimeSeconds>0).sort((a,b)=>a.calendarDate.localeCompare(b.calendarDate)).map(p=>[p.calendarDate,p.sleepTimeSeconds/3600]);
 if(id==='stress')pairs=(data||[]).filter(p=>typeof p.values?.overallStressLevel==='number'&&p.values.overallStressLevel>=0).map(p=>[p.calendarDate,p.values.overallStressLevel]);
 if(!pairs.length)return '';
 const points=pairs.filter((_,i)=>i%Math.max(1,Math.floor(pairs.length/200))===0), vals=points.map(p=>p[1]),min=Math.min(...vals),max=Math.max(...vals),w=480,h=100;
 const ps=points.map((p,i)=>`${25+i/Math.max(points.length-1,1)*(w-35)},${h-20-(p[1]-min)/Math.max(max-min,1)*(h-35)}`).join(' ');
 const range=['steps','sleep_range','stress'].includes(id);const caption=id==='body_battery'?`Curva do último dia retornado: ${dateBR(data.at(-1)?.date)}`:id==='sleep_range'?'Duração do sono em horas, por noite.':id==='stress'?'Estresse médio por dia · escala Garmin.':'';
 return `${caption?'<p class="nested-hint">'+esc(caption)+'</p>':''}<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label(id))}: variação entre ${num(min)} e ${num(max)}"><line x1="25" x2="470" y1="80" y2="80" stroke="#303442"/><polyline fill="none" stroke="#08ffb1" stroke-width="2" points="${ps}"/><text x="25" y="98" fill="#b4b9c8" font-size="12">${range?'Início do período':'Início do dia'}</text><text x="470" y="98" text-anchor="end" fill="#b4b9c8" font-size="12">${range?'Fim do período':'Fim do dia'}</text></svg>`;
}
async function loadCards(view){
 const target=$(view==='recuperacao'?'#recovery-content':'#health-content'), ids=view==='recuperacao'?recoveryIds:healthIds;
 const generation=state.generation;state.cardBatches ||= new Map();const batch=Symbol();state.cardBatches.set(view,batch);state.loaded.add(view);
 target.innerHTML=ids.map(id=>{const r=state.catalog.find(r=>r.id===id);return `<section class="panel resource-card" id="card-${id}"><div class="resource-top"><div><h3>${esc(r.label)}</h3><span class="meta">${r.scope==='day'?'Dia '+dateBR(state.day):'Período selecionado'}</span></div><span class="status">Consultando…</span></div><div class="card-body"><p class="empty">Lendo dados salvos…</p></div></section>`;}).join('');
 let cursor=0;
 async function worker(){while(cursor<ids.length){const id=ids[cursor++], card=$('#card-'+id);try{loading(1);const res=await request(id);if(generation!==state.generation||state.cardBatches.get(view)!==batch)return;state.payloads.set(id,res);const has=meaningful(id,res.data);$('.status',card).className='status'+(has?'':' empty-status');$('.status',card).textContent=has?(res.coverage?.complete===false?'Dados parciais':'Dados locais'):'Sem medições';const m=collectMeasures(id,res.data);$('.card-body',card).innerHTML=(has?(m.length?`<div class="resource-measures">${m.map(([k,v])=>`<div class="measure"><label>${esc(k)}</label><strong>${esc(v)}</strong></div>`).join('')}</div>`:'<p class="nested-hint">Registros recebidos. Abra os detalhes para consultar os campos.</p>')+spark(id,res.data):'<p class="empty">Nenhuma medição disponível neste dia ou período. Pode depender do dispositivo ou de registros manuais.</p>')+`<button class="button secondary" data-inspect="${id}">Explorar dados completos</button>`;$('[data-inspect]',card).addEventListener('click',()=>{switchView('explorar');selectResource(id);renderExplorer(res,id);});}catch(e){if(generation!==state.generation||state.cardBatches.get(view)!==batch)return;$('.status',card).className='status error-status';$('.status',card).textContent='Indisponível';$('.card-body',card).innerHTML=`<p class="notice error">${esc(e.message)}</p><button class="button secondary" data-retry>Consultar novamente</button>`;$('[data-retry]',card).addEventListener('click',()=>{switchView('explorar');selectResource(id);queryExplorer();});}finally{loading(-1);}}}
 await Promise.all([worker(),worker(),worker()]);if(generation===state.generation&&state.cardBatches.get(view)===batch)state.loaded.add(view);
}
function renderCatalog(){const q=$('#resource-search').value.toLowerCase();$('#resource-list').innerHTML=state.catalog.filter(r=>(r.label+' '+r.group).toLowerCase().includes(q)).map(r=>`<button class="resource-item ${state.selected===r.id?'selected':''}" data-resource="${r.id}">${esc(r.label)}<small>${esc(r.group)} · ${r.scope==='day'?'por dia':r.scope==='range'?'por período':r.scope==='static'?'configurações':r.scope==='activities'?'por período':'por atividade'}</small></button>`).join('');$$('[data-resource]').forEach(b=>b.addEventListener('click',()=>selectResource(b.dataset.resource)));}
function selectResource(id){state.selected=id;renderCatalog();const r=state.catalog.find(r=>r.id===id);const needsActivity=['activity','download'].includes(r.scope);$('#explorer-activity').disabled=!needsActivity;$('#explorer-output').innerHTML=`<h3>${esc(r.label)}</h3><p class="endpoint">GET ${esc(r.path)}</p><p class="notice">${r.scope==='day'?'Esta consulta usa o dia em detalhe.':needsActivity?'Selecione uma atividade e consulte o recurso.':r.scope==='static'?'Esta consulta retorna as configurações atuais da conta.':'Esta consulta usa o período selecionado no topo.'}</p>`;}
function renderExplorer(res,id){const r=state.catalog.find(r=>r.id===id);$('#explorer-output').innerHTML=`<h3>${esc(r.label)}</h3><p class="endpoint">GET ${esc(r.path)}</p><p class="meta">${res.empty?'Sem registros no arquivo':'Arquivo local carregado'} · ${r.scope==='day'?'Dia '+dateBR(res.query?.day||state.day):r.scope==='range'||r.scope==='activities'?dateBR(res.query?.start)+' — '+dateBR(res.query?.end):'Dados atuais'} · consulta em ${esc(new Date(res.fetched_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}))}</p><div id="resource-data"></div>`;dataViewer($('#resource-data'),res.data,id);}
async function queryExplorer(){if(!state.selected)return;const id=state.selected,r=state.catalog.find(r=>r.id===id), aid=$('#explorer-activity').value;if(['activity','download'].includes(r.scope)&&!aid){$('#explorer-output').insertAdjacentHTML('afterbegin','<p class="notice error">Selecione uma atividade acima.</p>');return;}if(r.scope==='download'){window.location.href='/api/resource/download?activity='+encodeURIComponent(aid);return;}$('#query-resource').disabled=true;$('#explorer-output').innerHTML='<div class="empty">Lendo o arquivo deste recurso…</div>';loading(1);try{const res=await request(id,{activity:aid});if(state.selected===id)renderExplorer(res,id);}catch(e){if(state.selected===id)$('#explorer-output').innerHTML=`<h3>${esc(r.label)}</h3><p class="notice error">${esc(e.message)}</p>`;}finally{$('#query-resource').disabled=false;loading(-1);}}
function switchView(view){state.view=view;$$('.view').forEach(s=>s.hidden=s.id!=='view-'+view);$$('.nav').forEach(b=>b.classList.toggle('active',b.dataset.view===view));const copy={treinos:['Treinos e evolução','Observe a consistência. Entenda seu progresso.'],recuperacao:['Recuperação','Sono, estresse e energia em contexto.'],saude:['Saúde e rotina','Um olhar completo sobre seus registros.'],explorar:['Explorar todos os dados','Cada recurso. Cada campo. Seus dados por inteiro.']};$('#page-title').textContent=copy[view][0];$('#page-description').textContent=copy[view][1];if(['recuperacao','saude'].includes(view)&&!state.loaded.has(view))loadCards(view);history.replaceState(null,'','#'+view);}
async function loadTraining(){
 const gen=++state.generation;state.trainingValid=false;state.loaded.clear();state.payloads.clear();showError('');$('#reload').disabled=true;$('#metrics').innerHTML='<div class="empty">Carregando seus treinos…</div>';$('#activities').innerHTML='';$('#volume-chart').innerHTML='<div class="empty">Consultando atividades…</div>';
 const start=$('#start').value,end=$('#end').value,days=Math.round((new Date(end)-new Date(start))/86400000)+1;
 if(days<1||days>367){showError('Selecione um período válido de até 366 dias de intervalo.');$('#reload').disabled=false;return;}
 loading(1);try{
 const results=await Promise.allSettled([request('activities',{start,end}),request('activities',{start:isoShift(start,-days),end:isoShift(start,-1)})]);if(gen!==state.generation)return;
 if(results[0].status==='rejected')throw results[0].reason;
 state.loadedRange={start,end};state.trainingValid=true;state.activities=results[0].value.data||[];const currentPartial=results[0].value.coverage?.complete===false;state.previousAvailable=results[1].status==='fulfilled'&&results[1].value.coverage?.complete!==false&&results[0].value.coverage?.complete!==false;state.previous=state.previousAvailable?(results[1].value.data||[]):[];
 if(currentPartial)showError('Importação em andamento: este período contém apenas os dados já salvos. Totais e comparação estão incompletos.',true);else if(!state.previousAvailable)showError('Os treinos foram carregados; o período anterior ainda não está disponível para comparação.',true);
 const selectedSport=$('#sport').value;const sports=[...new Map([...state.activities,...state.previous].map(a=>[a.activityType?.typeKey,sportName(a)])).entries()].filter(([k])=>k);
 $('#sport').innerHTML='<option value="">Todas as modalidades</option>'+sports.map(([k,v])=>`<option value="${esc(k)}">${esc(v)}</option>`).join('');if(sports.some(([k])=>k===selectedSport))$('#sport').value=selectedSport;
 $('#explorer-activity').innerHTML='<option value="">Selecione uma atividade</option>'+state.activities.map(a=>`<option value="${esc(a.activityId)}">${dateBR(a.startTimeLocal)} · ${esc(a.activityName||'Atividade')}</option>`).join('');
 renderTraining();if(['saude','recuperacao'].includes(state.view))loadCards(state.view);if(state.view==='explorar'&&state.selected)selectResource(state.selected);
 }catch(e){state.trainingValid=false;state.loadedRange=null;state.previous=[];state.previousAvailable=false;showError(e.message,e.notCollected);$('#metrics').innerHTML=e.notCollected?'<div class="empty">Este período está na fila de importação. Você pode consultar o período já salvo no progresso da coleta.</div>':'<div class="empty">Não foi possível carregar o período. Tente atualizar a tela.</div>';$('#volume-chart').innerHTML='<div class="empty">Dados indisponíveis.</div>';$('#comparison').innerHTML='';state.activities=[];$('#activities').innerHTML='';$('#activity-count').textContent='—';}finally{loading(-1);$('#reload').disabled=false;}
}
function applyPreset(){const n=Number($('#preset').value);if(n){$('#end').value=state.today;$('#start').value=isoShift(state.today,-n+1);}}
async function init(){
 try{const r=await fetch('/api/catalog');if(!r.ok)throw Error('Acesso ao painel indisponível. Entre na conta Vercel autorizada.');const cat=await r.json();state.catalog=cat.resources;state.today=cat.today;state.day=isoShift(cat.today,-1);$$('.day-input').forEach(i=>i.value=state.day);applyPreset();$('#catalog-count').textContent=cat.endpoints+' recursos ativos';$('#coverage').textContent=cat.endpoints+' recursos ativos';renderCatalog();
 $('.brand').addEventListener('click',e=>{e.preventDefault();switchView('treinos');});$$('.nav').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));$('#preset').addEventListener('change',applyPreset);['start','end'].forEach(id=>$('#'+id).addEventListener('change',()=>$('#preset').value='custom'));$('#sport').addEventListener('change',renderTraining);$('#activity-search').addEventListener('input',renderTraining);$('#resource-search').addEventListener('input',renderCatalog);$('#filters').addEventListener('submit',e=>{e.preventDefault();loadTraining();});$('#reload').addEventListener('click',loadTraining);$('#query-resource').addEventListener('click',queryExplorer);$('#close-detail').addEventListener('click',()=>$('#detail').close());$$('.day-input').forEach(i=>i.addEventListener('change',()=>{if(!i.value)return;state.day=i.value;$$('.day-input').forEach(other=>other.value=i.value);state.loaded.clear();if(['saude','recuperacao'].includes(state.view))loadCards(state.view);if(state.view==='explorar'&&state.selected)selectResource(state.selected);}));
 const view=location.hash.slice(1);if(['treinos','saude','recuperacao','explorar'].includes(view))state.view=view;
 await refreshSync();if(state.sync?.activities?.last&&state.sync.activities.last<$('#start').value){$('#start').value=state.sync.activities.last.slice(0,8)+'01';$('#end').value=state.sync.activities.last;$('#preset').value='custom';}await loadTraining();switchView(state.view);setInterval(refreshSync,30000);
 }catch(e){showError(e.message);$('#sync-state').textContent='Conexão indisponível';}
}
new ResizeObserver(()=>{if(state.trainingValid&&state.loadedRange&&state.view==='treinos')renderVolume(filtered(state.activities));}).observe($('#volume-chart'));
init();

async function refreshSync(){
 try{
  const response=await fetch('/api/sync/status');if(!response.ok)return;const info=await response.json();state.sync=info;
  const names={running:'Coletando aos poucos',not_started:'Fila preparada',waiting:'Aguardando próxima execução',cooldown:'Pausa de segurança da Garmin',budget_reached:'Etapa salva; continua na próxima hora',waiting_retry:'Retomada pendente',auth_required:'Acesso à Garmin precisa de revisão',paused:'Coleta pausada',connection_error:'Aguardando conexão'};
  $('#collection-state').textContent=info.mode==='incremental'?'Últimas 24 horas':'Histórico desde out/2025';
  const batch=info.current_batch;const progress=info.jobs||{};const total=Object.values(progress).reduce((a,b)=>a+b,0);
  $('#collection-message').textContent=(names[info.state]||info.state)+(batch?' · '+dateBR(batch.start)+' a '+dateBR(batch.end):'')+(total?' · '+(progress.done||0)+' de '+total+' consultas concluídas':'')+'.';
  const when=t=>t?new Date(t*1000).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'Aguardando primeira execução';
  $('#collection-details').innerHTML='<p>Modo: '+(info.mode==='incremental'?'atualização das últimas 24 horas, com recuperação de intervalos perdidos':'importação mensal, com retomada automática')+'</p><p>Meses concluídos: '+esc(info.months_completed)+' · Atividades salvas: '+esc(info.activities?.n||0)+'</p><p>Próxima execução elegível: '+esc(when(Math.max(info.next_run_at||0,info.cooldown_until||0)))+'</p>'+(info.errors?.length?'<p class="error">Consultas com pendências: '+info.errors.map(e=>esc(e.resource)+' ('+esc(e.http_status)+')').join(', ')+'</p>':'');
  $('#show-imported').hidden=!info.activities?.first;
 }catch{ $('#collection-message').textContent='Não foi possível ler o progresso do coletor.'; }
}
$('#show-imported').addEventListener('click',()=>{const a=state.sync?.activities;if(!a?.first)return;$('#start').value=a.first;$('#end').value=a.last;$('#preset').value='custom';loadTraining();});
