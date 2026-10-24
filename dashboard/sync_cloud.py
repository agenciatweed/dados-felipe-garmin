"""Send monthly archives to private Vercel Blob through the protected ingestion API."""
from __future__ import annotations
import argparse
import base64
import gzip
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit
import requests
from catalog import CATALOG
from local_store import Store, DEFAULT_DATA, atomic_write, local_now

PROJECT = Path(__file__).resolve().parent.parent

def archives(store):
    months = {}
    static = {}
    with store.connect() as db:
        activities = [dict(r) for r in db.execute('SELECT * FROM activities ORDER BY day,id')]
        daily = [dict(r) for r in db.execute('SELECT * FROM daily_rows ORDER BY day') if r['resource'] in CATALOG]
        coverage = [dict(r) for r in db.execute('SELECT * FROM coverage ORDER BY day') if r['resource'] in CATALOG]
        snapshots = [dict(r) for r in db.execute('SELECT * FROM snapshots ORDER BY fetched') if r['resource'] in CATALOG]
    def month(key):
        return months.setdefault(key, {'activities':[], 'daily':{}, 'coverage':{}, 'activity':{}, 'workouts':{}, 'download':{}, 'fetched_at':None})
    activity_month = {}
    for row in activities:
        if len(row['day']) != 10:
            continue
        key=row['day'][:7]
        month(key)['activities'].append(json.loads(row['payload']))
        activity_month[row['id']]=key
    for row in daily:
        m=month(row['day'][:7])
        m['daily'].setdefault(row['resource'], {})[row['day']]=json.loads(row['payload'])
        m['fetched_at']=max(m['fetched_at'] or '',row['fetched'])
    for row in coverage:
        m=month(row['day'][:7])
        m['coverage'].setdefault(row['resource'], {})[row['day']]=row['fetched']
        m['fetched_at']=max(m['fetched_at'] or '',row['fetched'])
    for row in snapshots:
        rid=row['resource']
        if CATALOG[rid]['scope']=='static':
            static[rid]={'data':json.loads((store.root/row['path']).read_text(encoding='utf-8')),'fetched_at':row['fetched']}
        elif rid in ('activity','workouts','download') and row['activity'] in activity_month:
            m=month(activity_month[row['activity']])
            content=(store.root/row['path']).read_bytes()
            m[rid][row['activity']]=base64.b64encode(content).decode() if rid=='download' else json.loads(content)
            m['fetched_at']=max(m['fetched_at'] or '',row['fetched'])
    status=store.status()
    status['root']='Armazenamento privado'
    return months,dict(version=1,months=sorted(months),static=static,status=status,published_at=local_now().isoformat())

def sync(store, credentials_path=None):
    credentials_path=Path(credentials_path or PROJECT/'tokens'/'cloud-sync.json')
    credentials=json.loads(credentials_path.read_text(encoding='utf-8'))
    origin=credentials['url'].rstrip('/')
    url=urlsplit(origin)
    if url.scheme!='https' or not url.hostname or not url.hostname.endswith('.vercel.app') or url.path not in ('','/'):
        raise ValueError('Destino remoto inválido; somente o domínio HTTPS Vercel configurado é permitido.')
    months,index=archives(store)
    manifest_path=store.root/'cloud-manifest.json'
    manifest=json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else {}
    sent=0
    def upload(key,payload):
        nonlocal sent
        encoded=gzip.compress(json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode(),mtime=0)
        if len(encoded)>3_500_000:
            raise ValueError('Arquivo mensal excede o limite de envio. Os dados locais foram preservados.')
        digest=hashlib.sha256(encoded).hexdigest()
        if manifest.get(key)==digest:
            return
        headers={'Authorization':'Bearer '+credentials['sync_secret'],'x-vercel-protection-bypass':credentials['bypass'],'Content-Type':'application/octet-stream','x-garmin-object':key}
        response=requests.post(origin+'/api/ingest',data=encoded,headers=headers,timeout=90,allow_redirects=False)
        if response.status_code!=200:
            raise RuntimeError(f'Sincronização privada recusada: HTTP {response.status_code}. Não foram enviados dados ao Git público.')
        manifest[key]=digest
        atomic_write(manifest_path,json.dumps(manifest).encode())
        sent+=1
    for key,payload in months.items():
        upload(key,payload)
    upload('index',index)
    store.set('cloud_last_success_at',local_now().isoformat())
    store.set('cloud_last_error',None)
    return sent

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir',type=Path,default=DEFAULT_DATA)
    args=parser.parse_args()
    store=Store(args.data_dir)
    try:
        print('Arquivos atualizados no armazenamento privado:',sync(store))
    except (OSError,ValueError,RuntimeError,requests.RequestException) as exc:
        # Never emit request objects, headers, or credentials.
        store.set('cloud_last_error','Sincronização privada pendente. Dados locais preservados.')
        print('Sincronização privada pendente. Dados locais preservados. Verifique acesso e configuração.')
        raise SystemExit(1)
