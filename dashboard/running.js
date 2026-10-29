(()=>{
'use strict';
const $=s=>document.querySelector(s);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=(n,d=1)=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('pt-BR',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
const pace=s=>{if(!Number.isFinite(s)||s<=0)return '—';const n=Math.round(s);return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;};
const duration=s=>{const n=Math.round(s||0);return n>=3600?`${Math.floor(n/3600)}h ${String(Math.floor(n%3600/60)).padStart(2,'0')}min`:`${Math.floor(n/60)}min ${String(n%60).padStart(2,'0')}s`;};
const date=s=>s?new Date(s.slice(0,10)+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'}):'—';
const updated=s=>s?new Date(s).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'}):'sem atualização';
const month=s=>new Date(s+'-01T12:00:00').toLocaleDateString('pt-BR',{month:'short',year:'2-digit'}).replace('.','');

const arrow='<svg class="arrow-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg>';
let data,shown=10;const reduceMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
function chartSnapshot(root){
 return new Map([...root.querySelectorAll('[data-motion-key]')].map(el=>[el.dataset.motionKey,Object.fromEntries(['x','y','width','height','cx','cy','d'].filter(k=>el.hasAttribute(k)).map(k=>[k,el.getAttribute(k)]))]));
}
function animateCharts(root,previous){
 if(reduceMotion()||!previous.size)return;
 for(const el of root.querySelectorAll('[data-motion-key]')){
  const old=previous.get(el.dataset.motionKey);if(!old)continue;
  const from={},to={};
  for(const [key,value]of Object.entries(old)){
   const next=el.getAttribute(key);if(next===value||next===null)continue;
   if(key==='d'){if(CSS.supports('d',`path("${next}")`)){from.d=`path("${value}")`;to.d=`path("${next}")`;}}
   else{from[key]=value+'px';to[key]=next+'px';}
  }
  if(Object.keys(from).length)el.animate([from,to],{duration:360,easing:'cubic-bezier(.16,1,.3,1)'});
 }
}
function renderRuns(){
 const runs=data.runs;$('#running-run-count').textContent=runs.length;
 $('#running-run-coverage').textContent=runs.length?`Dados disponíveis: ${date(data.coverage.firstRun)} a ${date(data.coverage.lastRun)}. Somente corridas ao ar livre.`:'Histórico ainda não coletado.';
 $('#running-runs').innerHTML=runs.slice(0,shown).map(r=>`<button class="run" data-run="${escape(r.id)}"><span class="run-top"><span>${escape(date(r.date))}</span><span>${escape(r.date.slice(11,16))}</span></span><div class="run-name">${escape(r.name)}</div><div class="run-metrics"><div><strong>${num(r.km)}</strong><small>quilômetros</small></div><div><strong>${pace(r.pace)}</strong><small>min/km</small></div><div><strong>${num(r.hr,0)}</strong><small>bpm</small></div><span class="run-arrow">${arrow}</span></div></button>`).join('')||'<p class="empty">Nenhuma corrida ao ar livre disponível.</p>';
 $('#running-more-runs').hidden=runs.length<=shown;
 document.querySelectorAll('[data-run]').forEach(el=>el.addEventListener('click',()=>openRun(el.dataset.run)));
}
function chartMonths(){
 if(!data.monthly.length)return [];
 const source=new Map(data.monthly.map(m=>[m.month,m]));const last=data.monthly.at(-1).month;
 let cursor=data.monthly[0].month,values=[];
 while(cursor<=last){values.push(source.get(cursor)||{month:cursor,missing:true});const d=new Date(cursor+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);cursor=d.toISOString().slice(0,7);}
 const count=Number($('#running-months').value);return count?values.slice(-count):values;
}
function renderCharts(){
 const previous=chartSnapshot($('#running-charts'));
 const values=chartMonths();
 if(!values.length){$('#running-charts').innerHTML='<p class="empty">A evolução aparecerá após a primeira coleta Garmin.</p>';return;}
 $('#running-chart-coverage').textContent=`${month(values[0].month)} a ${month(values.at(-1).month)} · pontos atenuados indicam mês incompleto. Lacunas indicam ausência de coleta.`;
 $('#running-charts').innerHTML=[['volume','Distância','km','totalKm',v=>num(v)+' km'],['pace','Pace médio','min/km','pace',v=>pace(v)+'/km'],['hr','FC média','bpm','hr',v=>num(v,0)+' bpm']].map(([id,title,unit,key,fmt])=>{
  const width=Math.max(300,Math.round($('#running-charts').clientWidth)),height=156,left=34,right=8,top=10,bottom=28,plot=width-left-right,ph=height-top-bottom;
  const actual=values.filter(v=>!v.missing&&Number.isFinite(v[key]));
  if(!actual.length)return `<section class="chart-block"><div class="chart-title"><h3>${title}</h3><span>${unit}</span></div><p class="empty">Sem dados coletados.</p></section>`;
  const max=Math.max(...actual.map(v=>v[key]),id==='volume'?1:0),min=id==='volume'?0:Math.min(...actual.map(v=>v[key]));
  const lo=id==='volume'?0:Math.max(0,min-(max-min||max*.08)*.2),hi=max+(max-min||max*.08)*.18;
  const y=v=>top+ph-(v-lo)/(hi-lo||1)*ph;
  const step=plot/values.length,x=i=>left+step*(i+.5);
  let shapes='',path='';
  values.forEach((v,i)=>{
   if(v.missing||!Number.isFinite(v[key])){path='';return;}
   const tip=`${month(v.month)} · ${fmt(v[key])}${id==='volume'?` · média ${num(v.avgKm)} km/treino`:''}${v.complete?'':' · coleta parcial'}`;
   if(id==='volume'){
    shapes+=`<rect data-motion-key="${id}-${v.month}" data-point="${v.month}" class="bar ${v.complete?'':'partial'}" x="${x(i)-step*.26}" y="${y(v[key])}" width="${step*.52}" height="${top+ph-y(v[key])}" rx="2"><title>${escape(tip)}</title></rect>`;
   }else{
    if(path)shapes+=`<path data-motion-key="${id}-line-${v.month}" class="trend" d="M${path} L${x(i)},${y(v[key])}"/>`;
    path=`${x(i)},${y(v[key])}`;
    shapes+=`<circle data-motion-key="${id}-${v.month}" data-point="${v.month}" class="dot ${v.complete?'':'partial'}" cx="${x(i)}" cy="${y(v[key])}" r="3.5"><title>${escape(tip)}</title></circle>`;
   }
  });
  const hits=values.map((v,i)=>v.missing||!Number.isFinite(v[key])?'':`<rect class="chart-hit" x="${left+i*step}" y="${top}" width="${step}" height="${ph}" tabindex="0" role="img" data-month="${v.month}" aria-label="${escape(month(v.month)+' · '+fmt(v[key])+(id==='volume'?' · média '+num(v.avgKm)+' km/treino':'')+(v.complete?'':' · coleta parcial'))}" data-tip="${escape(month(v.month)+' · '+fmt(v[key])+(id==='volume'?' · média '+num(v.avgKm)+' km/treino':'')+(v.complete?'':' · coleta parcial'))}"></rect>`).join('');
  // Average distance shares the km axis, so both series keep their real units.
  if(id==='volume'){
   let prev;
   values.forEach((v,i)=>{if(v.missing||!Number.isFinite(v.avgKm)){prev=null;return;}const point=`${x(i)},${y(v.avgKm ?? 0)}`;if(prev)shapes+=`<path d="M${prev} L${point}" fill="none" stroke="#f6f7fa" stroke-width="1.6"/>`;shapes+=`<circle cx="${x(i)}" cy="${y(v.avgKm ?? 0)}" r="2.5" fill="#f6f7fa"/>`;prev=point;});
  }
  const grid=[0,.5,1].map(t=>{const v=lo+(hi-lo)*t,yy=y(v);return `<line class="grid" x1="${left}" y1="${yy}" x2="${width-right}" y2="${yy}"/><text x="${left-6}" y="${yy+3}" text-anchor="end">${id==='pace'?pace(v):num(v,0)}</text>`;}).join('');
  const labelIndices=new Set([0,Math.round((values.length-1)/3),Math.round(2*(values.length-1)/3),values.length-1]);
  const labels=values.map((v,i)=>labelIndices.has(i)?`<text x="${x(i)}" y="${height-6}" text-anchor="middle">${escape(month(v.month))}</text>`:'').join('');
  const table=values.map(v=>`<tr><th scope="row">${escape(month(v.month))}${v.missing?'':v.complete?'':' *'}</th><td>${v.missing?'Sem coleta':fmt(v[key])}</td>${id==='volume'?`<td>${v.missing?'—':num(v.avgKm)+' km'}</td>`:''}</tr>`).join('');
  const latest=actual.at(-1);
  return `<section class="chart-block"><div class="chart-title"><h3>${title}</h3><span>${unit}</span></div><svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="group" aria-label="${title} por mês">${grid}${shapes}${labels}${hits}</svg>${id==='volume'?'<div class="legend"><span><i></i>Total mensal</span><span><i class="line"></i>Média por treino</span></div>':''}<p class="chart-tooltip" id="tip-${id}" aria-live="polite">${escape(month(latest.month)+' · '+fmt(latest[key])+(latest.complete?'':' · coleta parcial'))}</p><details class="chart-table"><summary>Ver valores mensais</summary><table><thead><tr><th>Mês</th><th>${title}</th>${id==='volume'?'<th>Média/treino</th>':''}</tr></thead><tbody>${table}</tbody></table></details></section>`;
 }).join('');
 $('#running-charts').querySelectorAll('[data-tip]').forEach(el=>{const show=()=>{const block=el.closest('.chart-block');block.querySelector('.chart-tooltip').textContent=el.dataset.tip;block.querySelectorAll('.data-active').forEach(p=>p.classList.remove('data-active'));block.querySelector(`[data-point="${el.dataset.month}"]`)?.classList.add('data-active');};el.addEventListener('pointerenter',show);el.addEventListener('focus',show);el.addEventListener('click',show);});
 animateCharts($('#running-charts'),previous);
}

// User-supplied dark map style, tinted to the Tweed palette.
const runningMapStyles=[
 {
  "featureType": "all",
  "elementType": "all",
  "stylers": [
   {
    "visibility": "on"
   }
  ]
 },
 {
  "featureType": "all",
  "elementType": "labels",
  "stylers": [
   {
    "visibility": "off"
   },
   {
    "saturation": -100
   }
  ]
 },
 {
  "featureType": "all",
  "elementType": "labels.text.fill",
  "stylers": [
   {
    "saturation": 36
   },
   {
    "color": "#0b0c13"
   },
   {
    "lightness": 40
   },
   {
    "visibility": "off"
   }
  ]
 },
 {
  "featureType": "all",
  "elementType": "labels.text.stroke",
  "stylers": [
   {
    "visibility": "off"
   },
   {
    "color": "#0b0c13"
   },
   {
    "lightness": 16
   }
  ]
 },
 {
  "featureType": "all",
  "elementType": "labels.icon",
  "stylers": [
   {
    "visibility": "off"
   }
  ]
 },
 {
  "featureType": "administrative",
  "elementType": "geometry.fill",
  "stylers": [
   {
    "color": "#0b0c13"
   },
   {
    "lightness": 20
   }
  ]
 },
 {
  "featureType": "administrative",
  "elementType": "geometry.stroke",
  "stylers": [
   {
    "color": "#0b0c13"
   },
   {
    "lightness": 17
   },
   {
    "weight": 1.2
   }
  ]
 },
 {
  "featureType": "landscape",
  "elementType": "geometry",
  "stylers": [
   {
    "color": "#0b0c13"
   },
   {
    "lightness": 20
   }
  ]
 },
 {
  "featureType": "landscape",
  "elementType": "geometry.fill",
  "stylers": [
   {
    "color": "#253c36"
   }
  ]
 },
 {
  "featureType": "landscape",
  "elementType": "geometry.stroke",
  "stylers": [
   {
    "color": "#253c36"
   }
  ]
 },
 {
  "featureType": "landscape.natural",
  "elementType": "geometry.fill",
  "stylers": [
   {
    "color": "#253c36"
   }
  ]
 },
 {
  "featureType": "poi",
  "elementType": "geometry",
  "stylers": [
   {
    "lightness": 21
   }
  ]
 },
 {
  "featureType": "poi",
  "elementType": "geometry.fill",
  "stylers": [
   {
    "color": "#253c36"
   }
  ]
 },
 {
  "featureType": "poi",
  "elementType": "geometry.stroke",
  "stylers": [
   {
    "color": "#253c36"
   }
  ]
 },
 {
  "featureType": "road",
  "elementType": "geometry",
  "stylers": [
   {
    "visibility": "on"
   },
   {
    "color": "#627a72"
   }
  ]
 },
 {
  "featureType": "road",
  "elementType": "geometry.fill",
  "stylers": [
   {
    "color": "#627a72"
   }
  ]
 },
 {
  "featureType": "road.highway",
  "elementType": "geometry.fill",
  "stylers": [
   {
    "color": "#627a72"
   },
   {
    "lightness": 17
   }
  ]
 },
 {
  "featureType": "road.highway",
  "elementType": "geometry.stroke",
  "stylers": [
   {
    "color": "#627a72"
   },
   {
    "lightness": 29
   },
   {
    "weight": 0.2
   }
  ]
 },
 {
  "featureType": "road.arterial",
  "elementType": "geometry",
  "stylers": [
   {
    "color": "#0b0c13"
   },
   {
    "lightness": 18
   }
  ]
 },
 {
  "featureType": "road.arterial",
  "elementType": "geometry.fill",
  "stylers": [
   {
    "color": "#627a72"
   }
  ]
 },
 {
  "featureType": "road.arterial",
  "elementType": "geometry.stroke",
  "stylers": [
   {
    "color": "#627a72"
   }
  ]
 },
 {
  "featureType": "road.local",
  "elementType": "geometry",
  "stylers": [
   {
    "color": "#0b0c13"
   },
   {
    "lightness": 16
   }
  ]
 },
 {
  "featureType": "road.local",
  "elementType": "geometry.fill",
  "stylers": [
   {
    "color": "#627a72"
   }
  ]
 },
 {
  "featureType": "road.local",
  "elementType": "geometry.stroke",
  "stylers": [
   {
    "color": "#627a72"
   }
  ]
 },
 {
  "featureType": "transit",
  "elementType": "geometry",
  "stylers": [
   {
    "color": "#0b0c13"
   },
   {
    "lightness": 19
   }
  ]
 },
 {
  "featureType": "water",
  "elementType": "all",
  "stylers": [
   {
    "color": "#111b24"
   },
   {
    "visibility": "on"
   }
  ]
 },
 {
  "featureType": "water",
  "elementType": "geometry",
  "stylers": [
   {
    "color": "#111b24"
   },
   {
    "lightness": 17
   }
  ]
 },
 {
  "featureType": "water",
  "elementType": "geometry.fill",
  "stylers": [
   {
    "color": "#101820"
   }
  ]
 },
 {
  "featureType": "water",
  "elementType": "geometry.stroke",
  "stylers": [
   {
    "color": "#101820"
   }
  ]
 },
 {
  "featureType": "water",
  "elementType": "labels",
  "stylers": [
   {
    "visibility": "off"
   }
  ]
 },
 {
  "featureType": "water",
  "elementType": "labels.text",
  "stylers": [
   {
    "visibility": "off"
   }
  ]
 },
 {
  "featureType": "water",
  "elementType": "labels.text.fill",
  "stylers": [
   {
    "visibility": "off"
   }
  ]
 },
 {
  "featureType": "water",
  "elementType": "labels.text.stroke",
  "stylers": [
   {
    "visibility": "off"
   }
  ]
 },
 {
  "featureType": "water",
  "elementType": "labels.icon",
  "stylers": [
   {
    "visibility": "off"
   }
  ]
 }
];
let loading=false,selectedRun=null,mapsPromise,activeMap,activePolyline,mapAuthFailed=false;
async function loadMaps(){
 if(window.google?.maps?.Map&&!mapAuthFailed)return window.google.maps;
 if(!mapsPromise)mapsPromise=(async()=>{
  const response=await fetch('/api/maps/config');if(!response.ok)throw Error('Configuração do Google Maps indisponível.');
  const {mapsKey}=await response.json();if(!mapsKey)throw Error('Configure a chave do Google Maps neste computador.');
  await new Promise((resolve,reject)=>{
   let script=document.createElement('script');
   const timer=setTimeout(()=>{script.remove();reject(Error('O Google Maps demorou a responder. Feche e abra a corrida para tentar novamente.'));},15000);
   window.garminMapsReady=()=>{clearTimeout(timer);resolve();};
   window.gm_authFailure=()=>{mapAuthFailed=true;clearTimeout(timer);const error=Error('O Google Maps recusou a chave. Verifique a API, o faturamento e a autorização para localhost no Google Cloud.');$('#running-map-status').textContent=error.message;$('#running-map').hidden=true;reject(error);};
   script.src='https://maps.googleapis.com/maps/api/js?'+new URLSearchParams({key:mapsKey,callback:'garminMapsReady',loading:'async',v:'quarterly',language:'pt-BR'});
   script.async=true;script.onerror=()=>{clearTimeout(timer);script.remove();reject(Error('Não foi possível carregar o Google Maps. Verifique a conexão e abra a corrida novamente.'));};document.head.append(script);
  });return window.google.maps;
 })().catch(error=>{mapsPromise=null;throw error;});
 return mapsPromise;
}
async function showMap(route,id){
 $('#running-map-status').textContent='Carregando Google Maps…';
 try{
  const maps=await loadMaps();if(selectedRun!==id||!$('#running-dialog').open)return;
  if(mapAuthFailed)throw Error('O Google Maps recusou a chave. Verifique a configuração no Google Cloud.');
  $('#running-map').hidden=false;
  if(!activeMap)activeMap=new maps.Map($('#running-map'),{mapTypeId:'roadmap',styles:runningMapStyles,backgroundColor:'#0b0c13',mapTypeControl:false,streetViewControl:false,fullscreenControl:true,gestureHandling:'cooperative',center:{lat:route[0][0],lng:route[0][1]},zoom:14});
  if(activePolyline)activePolyline.setMap(null);
  const path=route.map(([lat,lng])=>({lat,lng}));
  activePolyline=new maps.Polyline({path,geodesic:true,strokeColor:'#08ffb1',strokeOpacity:1,strokeWeight:5,map:activeMap});
  const bounds=new maps.LatLngBounds();path.forEach(p=>bounds.extend(p));activeMap.fitBounds(bounds,35);
  $('#running-route').hidden=true;
  $('#running-map-status').textContent='Trajeto GPS sobre Google Maps. Use dois dedos para mover o mapa no celular.';
 }catch(error){if(selectedRun===id&&$('#running-dialog').open){$('#running-map').hidden=true;$('#running-route').hidden=false;$('#running-map-status').textContent=error.message+' O traçado local continua disponível abaixo.';}}
}
async function load(){
 if(loading)return;loading=true;$('#running-refresh').disabled=true;
 try{
  const response=await fetch('/api/running');if(!response.ok)throw Error();data=await response.json();
  renderRuns();renderCharts();$('#running-error').hidden=true;
 }catch{$('#running-error').hidden=false;$('#running-error').textContent='Não foi possível ler as corridas locais. Use Recarregar dados para tentar novamente.';}
 finally{loading=false;$('#running-refresh').disabled=false;}
}
async function openRun(id){
 const r=data.runs.find(x=>x.id===id);if(!r)return;selectedRun=id;
 $('#running-detail-title').textContent=r.name;
 $('#running-detail-date').textContent=date(r.date)+' · '+r.date.slice(11,16);
 $('#running-detail-metrics').innerHTML=[['Distância',num(r.km,2)+' km'],['Duração',duration(r.duration)],['Pace médio',pace(r.pace)+'/km'],['FC média',num(r.hr,0)+' bpm'],['FC máxima',num(r.maxHr,0)+' bpm'],['Cadência',num(r.cadence,0)+' ppm'],['Elevação',num(r.elevation,0)+' m'],['Energia',num(r.calories,0)+' kcal']].map(([k,v])=>`<div><dt>${k}</dt><dd>${escape(v)}</dd></div>`).join('');
 $('#running-map').hidden=true;$('#running-route').hidden=false;
 $('#running-route').replaceChildren();$('#running-map-status').textContent='Lendo percurso GPS do arquivo local…';
 $('#running-dialog').showModal();
 try{
  const response=await fetch('/api/running/route?activity='+encodeURIComponent(id));if(!response.ok)throw Error();
  const {route}=await response.json();if(selectedRun!==id||!$('#running-dialog').open)return;
  if(!route.length){$('#running-map-status').textContent='Esta corrida não tem trajeto GPS nos arquivos coletados.';return;}
  // Local trace stays available if Google Maps cannot load.
  const lat=route.map(p=>p[0]),lng=route.map(p=>p[1]);
  const minLat=Math.min(...lat),maxLat=Math.max(...lat),minLng=Math.min(...lng),maxLng=Math.max(...lng);
  const cos=Math.cos((minLat+maxLat)/2*Math.PI/180),sx=(maxLng-minLng)*cos,sy=maxLat-minLat;
  const scale=Math.min(640/(sx||.00001),300/(sy||.00001));
  const points=route.map(([a,b])=>[30+(640-sx*scale)/2+(b-minLng)*cos*scale,25+(300-sy*scale)/2+(maxLat-a)*scale]);
  $('#running-route').innerHTML=`<svg viewBox="0 0 700 350" role="img" aria-label="Traçado GPS real da corrida, início em branco e chegada em verde"><path d="${points.map((p,i)=>(i?'L':'M')+p.join(',')).join(' ')}"/><circle cx="${points[0][0]}" cy="${points[0][1]}" r="5" class="route-start"/><circle cx="${points.at(-1)[0]}" cy="${points.at(-1)[1]}" r="5"/></svg>`;
  await showMap(route,id);
 }catch{if(selectedRun===id)$('#running-map-status').textContent='Não foi possível ler o percurso local. Feche e abra a corrida para tentar novamente.';}
}
$('#running-close').addEventListener('click',()=>$('#running-dialog').close());
$('#running-dialog').addEventListener('close',()=>{selectedRun=null;});
$('#running-months').addEventListener('change',()=>data&&renderCharts());
$('#running-more-runs').addEventListener('click',()=>{shown+=10;renderRuns();});
$('#running-refresh').addEventListener('click',load);
let timer,lastChartWidth=0;new ResizeObserver(()=>{const width=$('#running-charts').clientWidth;if(!width||width===lastChartWidth)return;lastChartWidth=width;clearTimeout(timer);timer=setTimeout(()=>{if(data&&!$('#view-corridas').hidden)renderCharts();},150);}).observe($('#view-corridas'));
document.addEventListener('running:open',()=>{if(!data)load();else renderCharts();});
})();
