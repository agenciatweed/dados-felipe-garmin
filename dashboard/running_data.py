"""Local running projection adapted from Painel Infos Felipe; no network calls."""
import io,json,math,zipfile,threading
from collections import defaultdict
from datetime import date,datetime,timedelta,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def load(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))

def route_details(details):
    descriptors={x['key']:x['metricsIndex'] for x in details.get('metricDescriptors',[])}
    lat,lon=descriptors.get('directLatitude'),descriptors.get('directLongitude')
    if lat is None or lon is None:return []
    return [[row['metrics'][lat],row['metrics'][lon]] for row in details.get('activityDetailMetrics',[]) if valid_point(row['metrics'][lat],row['metrics'][lon])]

def valid_point(lat,lon):
    return isinstance(lat,(int,float)) and isinstance(lon,(int,float)) and math.isfinite(lat) and math.isfinite(lon) and abs(lat)<=90 and abs(lon)<=180 and (lat!=0 or lon!=0)

def route_fit(path):
    import fitdecode
    points=[]
    with zipfile.ZipFile(path) as z:
        names=[n for n in z.namelist() if n.lower().endswith('.fit')]
        if not names:return []
        with fitdecode.FitReader(io.BytesIO(z.read(names[0]))) as reader:
            for frame in reader:
                if isinstance(frame,fitdecode.FitDataMessage) and frame.name=='record':
                    lat=frame.get_value('position_lat',fallback=None);lon=frame.get_value('position_long',fallback=None)
                    if lat is not None and lon is not None:
                        lat,lon=lat*180/2**31,lon*180/2**31
                        if valid_point(lat,lon):points.append([lat,lon])
    return points

def normalize(a):
    kind=a.get('activityType',a.get('activityTypeDTO',{})).get('typeKey','').lower()
    name=a.get('activityName','Corrida')
    if kind not in {'running','trail_running','track_running','street_running','ultra_run'}:return None
    if any(word in name.casefold() for word in ('esteira','treadmill','virtual')):return None
    distance=a.get('distance',0) or 0
    duration=a.get('duration',0) or 0
    if distance<=0 or duration<=0:return None
    speed=a.get('averageSpeed',0) or 0
    return dict(id=str(a['activityId']),name=name,date=a.get('startTimeLocal',''),km=distance/1000,duration=duration,pace=1000/speed if speed>0 else duration/(distance/1000),hr=a.get('averageHR'),maxHr=a.get('maxHR'),cadence=a.get('averageRunningCadenceInStepsPerMinute'),elevation=a.get('elevationGain'),calories=a.get('calories'),route=[])

def garmin_data(folder):
    found={};routes={};covered=set();warnings=[];fetched=[]
    raw=folder/'dados_locais/raw'
    for path in sorted((raw/'activities').glob('*.json')):
        batch=load(path)
        if not isinstance(batch,list):raise ValueError(f'Formato Garmin inválido: {path.name}')
        for a in batch:found[str(a['activityId'])]=a
        fetched.append(path.stat().st_mtime)
        # The last page confirms that this entire collector range was read.
        parts=path.stem.split('_')
        if len(parts)>=2 and len(batch)<99:
            d=date.fromisoformat(parts[0]);end=date.fromisoformat(parts[1])
            while d<=end:covered.add(str(d));d+=timedelta(days=1)
    for path in sorted((folder/'raw/activities').glob('*.json')):
        doc=load(path);a=doc.get('resumo',{})
        if a.get('activityId'):
            found.setdefault(str(a['activityId']),a)
            routes[str(a['activityId'])]=route_details(doc.get('details',{}))
            fetched.append(path.stat().st_mtime)
    runs=[]
    for aid,a in found.items():
        run=normalize(a)
        if not run:continue
        detail=raw/'activity'/f'{aid}.json'
        if detail.exists():
            summary=load(detail).get('summaryDTO',{})
            for dest,source in [('cadence','averageRunCadence'),('calories','calories'),('elevation','elevationGain')]:
                if run.get(dest) is None:run[dest]=summary.get(source)
        points=routes.get(aid,[])
        # At most 1,200 real samples per run; always retain the last point.
        if len(points)>1200:
            points=points[::math.ceil(len(points)/1199)]+[points[-1]]
        run['route']=[[round(x,6),round(y,6)] for x,y in points]
        runs.append(run)
    runs.sort(key=lambda r:r['date'],reverse=True)
    buckets=defaultdict(list)
    for run in runs:buckets[run['date'][:7]].append(run)
    monthly=[]
    for month,items in sorted(buckets.items()):
        km=sum(r['km'] for r in items)
        hrs=[r for r in items if isinstance(r['hr'],(int,float)) and r['hr']>0]
        first=date.fromisoformat(month+'-01');last=(first.replace(day=28)+timedelta(days=4)).replace(day=1)-timedelta(days=1)
        complete=all(str(first+timedelta(days=n)) in covered for n in range((last-first).days+1))
        monthly.append(dict(month=month,totalKm=km,avgKm=km/len(items),count=len(items),pace=sum(r['pace']*r['km'] for r in items)/km,hr=sum(r['hr']*r['duration'] for r in hrs)/sum(r['duration'] for r in hrs) if hrs else None,complete=complete))
    return runs,monthly,dict(days=sorted(covered),firstRun=runs[-1]['date'][:10] if runs else None,lastRun=runs[0]['date'][:10] if runs else None,sourceUpdatedAt=datetime.fromtimestamp(max(fetched),timezone.utc).isoformat() if fetched else None,warnings=warnings)


_cache=None
_signature=None
_lock=threading.Lock()
def running_data():
    global _cache,_signature
    folders=[ROOT/'dados_locais/raw/activities',ROOT/'dados_locais/raw/activity',ROOT/'raw/activities']
    signature=tuple((str(p),p.stat().st_mtime_ns,p.stat().st_size) for f in folders for p in sorted(f.glob('*.json')))
    with _lock:
        if _cache is None or signature!=_signature:
            runs,monthly,coverage=garmin_data(ROOT)
            # A covered month with no runs is zero; missing collection is a gap.
            months={m['month']:m for m in monthly}
            for day in coverage['days']:
                key=day[:7]
                if key not in months:
                    first=date.fromisoformat(key+'-01')
                    last=(first.replace(day=28)+timedelta(days=4)).replace(day=1)-timedelta(days=1)
                    complete=all(str(first+timedelta(days=n)) in coverage['days'] for n in range((last-first).days+1))
                    if complete:months[key]=dict(month=key,totalKm=0,avgKm=None,count=0,pace=None,hr=None,complete=True)
            _cache=dict(runs=runs,monthly=sorted(months.values(),key=lambda m:m['month']),coverage=coverage)
            _signature=signature
        return _cache

def running_route(aid):
    data=running_data()
    run=next((r for r in data['runs'] if r['id']==aid),None)
    if run is None:raise ValueError('Corrida não encontrada.')
    points=run['route']
    fit=ROOT/'dados_locais/raw/download'/f'{aid}.zip'
    if not points and fit.exists():points=route_fit(fit)
    if len(points)>1200:points=points[::math.ceil(len(points)/1199)]+[points[-1]]
    return dict(route=[[round(x,6),round(y,6)] for x,y in points])
