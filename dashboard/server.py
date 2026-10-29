"""Dashboard local independente, usando exclusivamente Garmin Personal API."""
from __future__ import annotations
import argparse
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import threading
import time
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from catalog import CATALOG
from local_store import Store, NotCollected, local_now

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent
STORE = Store()

def today():
    return local_now().date()


def arguments(query):
    end = date.fromisoformat(query.get('end', [str(today())])[0])
    start = date.fromisoformat(query.get('start', [str(end - timedelta(days=29))])[0])
    day = date.fromisoformat(query.get('day', [str(end)])[0])
    if start > end or (end - start).days > 366:
        raise ValueError('Selecione um intervalo de até 366 dias, com início anterior ao fim.')
    return str(start), str(end), str(day)

def fetch_resource(resource, query):
    start, end, day = arguments(query)
    aid = query.get('activity', [''])[0]
    if resource['scope'] in ('activity', 'download') and not re.fullmatch(r'[1-9][0-9]{0,24}', aid):
        raise ValueError('Selecione uma atividade para consultar este recurso.')
    return STORE.read(resource, start, end, day, aid)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, data, status=200, content_type='application/json; charset=utf-8', filename=None):
        body = data if isinstance(data, bytes) else json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'strict-origin-when-cross-origin')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' https://maps.googleapis.com https://maps.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.googleusercontent.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://*.googleapis.com https://*.gstatic.com https://*.google.com; frame-src https://*.google.com; worker-src blob:; frame-ancestors 'none'")
        if filename:
            self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        allowed = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
        if self.headers.get('Host') not in allowed or self.headers.get('Sec-Fetch-Site') == 'cross-site':
            self.reply({'error': 'Acesso permitido apenas pela interface local.'}, 403)
            return
        parsed = urlsplit(self.path)
        query = parse_qs(parsed.query)
        try:
            if parsed.path == '/api/catalog':
                self.reply(dict(resources=list(CATALOG.values()), today=str(today()), api_version='1.0.0', endpoints=len(CATALOG), local_mode=True))
            elif parsed.path == '/api/maps/config':
                path=PROJECT/'tokens'/'google-maps.json'
                config=json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
                self.reply({'mapsKey':config.get('mapsKey','')})
            elif parsed.path == '/api/running':
                from running_data import running_data
                self.reply(running_data())
            elif parsed.path == '/api/running/route':
                from running_data import running_route
                aid=query.get('activity',[''])[0]
                if not re.fullmatch(r'[1-9][0-9]{0,24}',aid):raise ValueError('Selecione uma corrida válida.')
                self.reply(running_route(aid))
            elif parsed.path == '/api/sync/status':
                self.reply(STORE.status())
            elif parsed.path.startswith('/api/resource/'):
                name = parsed.path.rsplit('/', 1)[-1]
                resource = CATALOG.get(name)
                if not resource:
                    self.reply({'error': 'Recurso desconhecido.'}, 404)
                    return
                result = fetch_resource(resource, query)
                if isinstance(result, bytes):
                    self.reply(result, content_type='application/zip', filename='atividade-' + query['activity'][0] + '.zip')
                else:
                    self.reply(result)
            elif parsed.path.startswith('/assets/'):
                name = parsed.path.removeprefix('/assets/')
                if name not in ('inter-regular.ttf','inter-medium.ttf','inter-bold.ttf','tweed.svg'):
                    self.reply({'error':'Arquivo não encontrado.'},404)
                    return
                mime = 'image/svg+xml' if name.endswith('.svg') else 'font/ttf'
                self.reply((ROOT / 'assets' / name).read_bytes(), content_type=mime)
            elif parsed.path in ('/', '/app.js', '/style.css', '/tweed.css', '/running.js', '/running.css'):
                name = {'/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/tweed.css':'tweed.css', '/running.js':'running.js', '/running.css':'running.css'}[parsed.path]
                mime = {'index.html': 'text/html; charset=utf-8', 'app.js': 'text/javascript; charset=utf-8', 'style.css': 'text/css; charset=utf-8', 'tweed.css':'text/css; charset=utf-8', 'running.js':'text/javascript; charset=utf-8', 'running.css':'text/css; charset=utf-8'}[name]
                self.reply((ROOT / name).read_bytes(), content_type=mime)
            else:
                self.reply({'error': 'Página não encontrada.'}, 404)
        except NotCollected as exc:
            self.reply({'error': str(exc), 'not_collected': True}, 409)
        except (ValueError, KeyError) as exc:
            self.reply({'error': str(exc)}, 400)
        except Exception:
            self.reply({'error': 'Não foi possível ler os dados locais. Confira o status do coletor.'}, 502)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8791)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'Dashboard Garmin: http://127.0.0.1:{args.port}', flush=True)
    server.serve_forever()
