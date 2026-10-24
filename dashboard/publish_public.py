"""Allowlisted code publication. Health files and credentials are never staged."""
from pathlib import Path
import shutil
import subprocess

PROJECT=Path(__file__).resolve().parent.parent
REPO=PROJECT/'repositorio'
FILES=['package.json','package-lock.json','vercel.json','README.md','iniciar-dashboard.ps1','abrir-dashboard.ps1','abrir-dashboard.cmd',
 'api/cloud.mjs','cloud/catalog.json','scripts/build.mjs',
 'dashboard/server.py','dashboard/catalog.py','dashboard/local_store.py','dashboard/collector.py','dashboard/sync_cloud.py','dashboard/run_pipeline.py','dashboard/publish_public.py','dashboard/test_collector.py','dashboard/sync-config.json','dashboard/requirements.txt','dashboard/index.html','dashboard/app.js','dashboard/style.css','dashboard/tweed.css','dashboard/assets/ORIGINS.json','dashboard/assets/tweed.svg']

def git(*args,check=True):
    # Prevent unattended credential prompts: notify instead of hanging a collector.
    import os
    env={**os.environ,'GIT_TERMINAL_PROMPT':'0','GCM_INTERACTIVE':'never'}
    return subprocess.run(['git','-C',str(REPO),*args],capture_output=True,text=True,check=check,env=env)

def prepare():
    if not (REPO/'.git').exists():
        raise RuntimeError('Clone local do repositório público não encontrado.')
    if git('remote','get-url','origin').stdout.strip()!='https://github.com/agenciatweed/dados-felipe-garmin.git':
        raise RuntimeError('Destino Git inesperado; publicação interrompida.')
    forbidden=[p for p in git('ls-files').stdout.splitlines() if p not in FILES+['.gitignore']]
    if forbidden:
        raise RuntimeError('O clone contém arquivos fora da lista permitida. Nenhum push foi realizado.')
    secrets=[]
    key_file=PROJECT/'api.md'
    if key_file.exists(): secrets.append(key_file.read_bytes().strip())
    cloud_file=PROJECT/'tokens'/'cloud-sync.json'
    if cloud_file.exists():
        import json
        secrets.extend(str(v).encode() for k,v in json.loads(cloud_file.read_text()).items() if k in ('bypass','sync_secret'))
    selected=[]
    for name in FILES:
        source=PROJECT/name
        if not source.exists(): continue
        content=source.read_bytes()
        if any(secret and secret in content for secret in secrets):
            raise RuntimeError('Um arquivo de código contém uma credencial. Publicação interrompida.')
        destination=REPO/name;destination.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(source,destination);selected.append(name)
    (REPO/'.gitignore').write_text('api.md\ntokens/\ndados_locais/\nraw/\nlogs/\n.venv/\n.env*\npublic/\nnode_modules/\n__pycache__/\n*.sqlite3*\n*.zip\n.impeccable/\n.vercel/\n',encoding='utf-8')
    git('add','--',*selected,'.gitignore')
    return selected

def publish():
    prepare()
    if git('diff','--cached','--quiet',check=False).returncode==0:
        return 'Código público já atualizado.'
    git('config','user.name','Agência Tweed')
    git('config','user.email','297122328+agenciatweed@users.noreply.github.com')
    git('commit','-m','Atualiza aplicação Garmin, identidade Tweed e coleta gradual')
    git('push','origin','HEAD:main')
    return 'Código atualizado no Git público; nenhum dado pessoal incluído.'

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--prepare-only',action='store_true');args=parser.parse_args()
    if args.prepare_only: print('Arquivos de código preparados:',len(prepare()))
    else:
        try: print(publish())
        except (RuntimeError,subprocess.CalledProcessError):
            print('Publicação de código pendente. Verifique autenticação Git ou alterações remotas. Nenhum dado pessoal foi incluído.');raise SystemExit(1)
