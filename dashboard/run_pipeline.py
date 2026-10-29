"""Local collection cycle, followed by allowlisted public code backup."""
from pathlib import Path
import json
from collector import run_once, config, ProcessLock, CollectorBusy
from local_store import Store, DEFAULT_DATA, atomic_write, local_now

def main():
    store=Store()
    try:
        with ProcessLock(DEFAULT_DATA/'pipeline.lock'):
            status={'started_at':local_now().isoformat(),'state':'running','storage':'local'}
            path=DEFAULT_DATA/'pipeline-status.json'
            atomic_write(path,json.dumps(status).encode())
            try:
                status['collector']=run_once(store,config())
                # The dashboard reads Store directly; no cloud upload or build.
                from publish_public import publish
                status['git']=publish()
                status['state']='completed'
            except CollectorBusy:
                status['state']='collector_busy'
            except Exception:
                # Errors are deliberately generic; no headers, API keys, or raw
                # personal response values enter logs or the public repository.
                status['state']='needs_attention'
                status['message']='Dados locais preservados. Verifique o coletor local e a autenticação Git.'
            finally:
                status['finished_at']=local_now().isoformat()
                atomic_write(path,json.dumps(status,ensure_ascii=False,indent=2).encode())
            print(status['state'])
    except CollectorBusy:
        print('Ciclo anterior ainda em execução. Nenhuma execução duplicada foi iniciada.')

if __name__=='__main__': main()
