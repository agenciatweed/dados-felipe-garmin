"""Hourly, sequential, resumable collector. The dashboard never uses this client."""
from __future__ import annotations
import argparse
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import json
from pathlib import Path
import random
import time

import requests
from garmin_personal_api import GarminPersonalApiClient, PersonalApiAuthenticator
from garmin_personal_api.errors import HttpError

from catalog import CATALOG
from local_store import Store, DEFAULT_DATA, days, local_now

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent

class BudgetReached(Exception):
    pass

class CollectorBusy(Exception):
    pass

class ProcessLock:
    def __init__(self, path):
        self.path = Path(path)
        self.stream = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.stream = self.path.open('a+b')
        self.stream.seek(0, 2)
        if self.stream.tell() == 0:
            self.stream.write(b'0')
            self.stream.flush()
        self.stream.seek(0)
        try:
            if __import__('os').name == 'nt':
                import msvcrt
                msvcrt.locking(self.stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.stream.close()
            raise CollectorBusy('Já existe uma coleta em execução.') from None
        return self

    def __exit__(self, *_):
        self.stream.close()

def next_month(day):
    d = date.fromisoformat(day)
    return str(date(d.year + (d.month == 12), 1 if d.month == 12 else d.month + 1, 1))

def config():
    c = json.loads((ROOT / 'sync-config.json').read_text(encoding='utf-8'))
    date.fromisoformat(c['history_start'])
    if c['request_interval_seconds'] < 1 or c['max_requests_per_run'] < 1 or c['max_run_minutes'] < 1:
        raise ValueError('Configuração de coleta inválida.')
    return c

def run_interval(store, cfg):
    key = 'incremental_interval_seconds' if store.get('mode', 'history') == 'incremental' else 'history_interval_seconds'
    return cfg.get(key, cfg.get('run_interval_seconds', 3600))

def plan(store, cfg, now=None):
    now = now or local_now()
    today = str(now.date())
    with store.connect() as db:
        pending = db.execute("SELECT * FROM batches WHERE status='pending' ORDER BY created LIMIT 1").fetchone()
        if pending:
            return dict(pending)
    store.set('history_start', cfg['history_start'])
    cursor = store.get('next_month', cfg['history_start'])
    mode = store.get('mode', 'history')
    if mode == 'history' and cursor > today:
        mode = 'incremental'
        store.set('mode', mode)
    if mode == 'history':
        start = cursor
        end = min(today, str(date.fromisoformat(next_month(start)) - timedelta(days=1)))
        batch_id = f'history:{start}:{end}'
    else:
        # The API accepts calendar dates. Refresh both days touched by the last
        # 24h, and backfill from the last completed coverage after a PC outage.
        rolling_start = str((now - timedelta(hours=24)).date())
        start = min(rolling_start, store.get('covered_until', rolling_start))
        end = today
        batch_id = f'incremental:{now.strftime("%Y-%m-%dT%H")}'
    with store.connect() as db:
        db.execute("INSERT OR IGNORE INTO batches VALUES (?,?,?,?, 'pending',?,NULL)", (batch_id, mode, start, end, now.isoformat()))
        for resource in CATALOG.values():
            rid, scope = resource['id'], resource['scope']
            if scope in ('activity', 'download'):
                continue  # Created durably as activity pages arrive.
            if scope == 'activities':
                store.add_job(db, batch_id, rid, f'{start}_{end}_0', dict(start=start, end=end, offset=0))
            elif scope == 'static':
                existing = db.execute('SELECT 1 FROM snapshots WHERE resource=?', (rid,)).fetchone()
                # Current settings are not historical; fetch once in history,
                # and once per local day thereafter.
                checked = db.execute('SELECT fetched FROM snapshots WHERE resource=? ORDER BY fetched DESC LIMIT 1', (rid,)).fetchone()
                if not existing or (mode == 'incremental' and checked[0][:10] != today):
                    store.add_job(db, batch_id, rid, 'latest', {})
            elif scope == 'day':
                for day in days(start, end):
                    store.add_job(db, batch_id, rid, day, dict(day=day))
            else:
                cursor_day = date.fromisoformat(start)
                last = date.fromisoformat(end)
                while cursor_day <= last:
                    stop = min(cursor_day + timedelta(days=6), last)
                    a, b = str(cursor_day), str(stop)
                    store.add_job(db, batch_id, rid, f'{a}_{b}', dict(start=a, end=b))
                    cursor_day = stop + timedelta(days=1)
    store.set('mode', mode)
    return dict(id=batch_id, mode=mode, start=start, end=end)

def retry_after(header, now):
    if not header:
        return 0
    try:
        return max(0, float(header))
    except ValueError:
        try:
            parsed = parsedate_to_datetime(header)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return max(0, parsed.timestamp() - now)
        except (ValueError, TypeError, OverflowError):
            return 0

class PacedSession(requests.Session):
    def __init__(self, store, cfg, wall=time.time, sleep=time.sleep):
        super().__init__()
        self.store, self.cfg, self.wall, self.sleep = store, cfg, wall, sleep
        self.started = wall()
        self.count = 0
        self.retry_delay = 0

    def send(self, request, **kwargs):
        if self.count >= self.cfg['max_requests_per_run'] or self.wall() - self.started >= self.cfg['max_run_minutes'] * 60:
            raise BudgetReached()
        remaining = self.store.get('last_request_at', 0) + self.cfg['request_interval_seconds'] + random.uniform(0, self.cfg.get('jitter_seconds', 0)) - self.wall()
        if remaining > 0:
            self.sleep(remaining)
        if self.store.get('paused', False):
            raise BudgetReached()
        self.count += 1
        self.store.set('last_request_at', self.wall())
        self.store.set('heartbeat', local_now().isoformat())
        response = super().send(request, **kwargs)
        self.retry_delay = retry_after(response.headers.get('Retry-After'), self.wall())
        return response

def execute(api, resource, params):
    rid = resource['id']
    if rid == 'activities':
        return api.search_activities(start=params['offset'], limit=99, start_date=params['start'], end_date=params['end'])
    if rid == 'download':
        return api.download_activity(params['activity'])
    values = dict(startDate=params.get('start'), endDate=params.get('end'), fromDate=params.get('start'), untilDate=params.get('end'), calendarDate=params.get('day'), activityId=params.get('activity'))
    query = {}
    if rid in ('sleep', 'heart_rate'):
        query['date'] = params['day']
    if rid == 'daily':
        query['calendarDate'] = params['day']
    if rid in ('sleep_range', 'body_battery', 'daily_range'):
        query.update(startDate=params['start'], endDate=params['end'])
    return api.get(resource['path'].format(**values), params=query or None)

def finish_batch(store, batch, cfg, now):
    with store.connect() as db:
        remaining = db.execute("SELECT COUNT(*) FROM jobs WHERE batch=? AND status='pending'", (batch['id'],)).fetchone()[0]
        if remaining:
            return False
        warnings = db.execute("SELECT COUNT(*) FROM jobs WHERE batch=? AND status='unavailable'", (batch['id'],)).fetchone()[0]
        db.execute('UPDATE batches SET status=?,finished=? WHERE id=?', ('completed_with_warnings' if warnings else 'completed', local_now().isoformat(), batch['id']))
    store.set('last_success_at', local_now().isoformat())
    store.set('covered_until', batch['end'])
    if batch['mode'] == 'history':
        cursor = next_month(batch['start'])
        store.set('next_month', cursor)
        if cursor > str(local_now().date()):
            store.set('mode', 'incremental')
    store.set('state', 'waiting')
    return True

def run_once(store, cfg, api_factory=None, wall=time.time):
    with ProcessLock(store.root / 'coletor.lock'):
        now = wall()
        if store.get('paused', False):
            return 'paused'
        if store.get('cooldown_until', 0) > now:
            return 'cooldown'
        interval = run_interval(store, cfg)
        due = store.get('next_run_at', 0)
        previous_interval = store.get('scheduled_interval_seconds', 3600)
        # Recalculate cadence after a configuration change without shortening
        # the separate Garmin cooldown or a pending job's Retry-After.
        if due and previous_interval != interval:
            due += interval - previous_interval
            store.set('next_run_at', due)
            store.set('scheduled_interval_seconds', interval)
        if due > now:
            return 'waiting'
        if store.get('auth_required', False):
            return 'auth_required'
        store.set('next_run_at', now + interval)
        store.set('scheduled_interval_seconds', interval)
        store.set('state', 'running')
        store.set('heartbeat', local_now().isoformat())
        batch = plan(store, cfg)
        interval = run_interval(store, cfg)
        store.set('next_run_at', now + interval)
        store.set('scheduled_interval_seconds', interval)
        paced = PacedSession(store, cfg, wall=wall)
        api = None
        try:
            if api_factory:
                api = api_factory()
            else:
                # Refuse accidental alternate hosts from process environment.
                import os
                os.environ.pop('GARMIN_PERSONAL_API_BASE_URL', None)
                key = (PROJECT / 'api.md').read_text(encoding='utf-8-sig').strip()
                with PersonalApiAuthenticator(session=paced, bearer_token_cache_file=PROJECT / 'tokens' / 'personal-api-bearer-token.json', timeout=30) as auth:
                    token = auth.obtain_token(key)
                # Auth context closes its session; Session.close does not disable
                # subsequent sends, but use a fresh paced session with the same budget.
                api = GarminPersonalApiClient(token.access_token, session=paced, timeout=30)
            while True:
                if store.get('paused', False):
                    store.set('state', 'paused')
                    return 'paused'
                with store.connect() as db:
                    job = db.execute("SELECT * FROM jobs WHERE batch=? AND status='pending' AND retry_at<=? ORDER BY id LIMIT 1", (batch['id'], wall())).fetchone()
                if not job:
                    finish_batch(store, batch, cfg, wall())
                    interval = run_interval(store, cfg)
                    store.set('next_run_at', now + interval)
                    store.set('scheduled_interval_seconds', interval)
                    if store.get('state') == 'running':
                        store.set('state', 'waiting_retry')
                    break
                job = dict(job)
                resource = CATALOG.get(job['resource'])
                if not resource:
                    store.fail(job, 0, 'Recurso removido da coleta pelo usuário.', terminal=True)
                    continue
                params = json.loads(job['params'])
                try:
                    data = execute(api, resource, params)
                    if resource['id'] == 'activities' and not isinstance(data, list):
                        raise ValueError('Formato de atividades inesperado.')
                    store.save(job, data, resource, cfg)
                    store.set('consecutive_limits', 0)
                    store.set('heartbeat', local_now().isoformat())
                except HttpError as exc:
                    status = exc.status_code
                    if status == 429 or status >= 500:
                        n = store.get('consecutive_limits', 0) + 1
                        wait = max(paced.retry_delay, min(86400, cfg['retry_cooldown_seconds'] * 2 ** min(n-1, 6)))
                        store.set('consecutive_limits', n)
                        store.set('cooldown_until', wall() + wait)
                        store.set('state', 'cooldown')
                        store.fail(job, status, f'Garmin HTTP {status}. Coleta pausada, com retomada após o intervalo de segurança.', retry_at=wall()+wait)
                        return 'cooldown'
                    if status == 401:
                        store.set('auth_required', True)
                        store.set('state', 'auth_required')
                        store.fail(job, status, 'Token recusado. Confira a chave e execute --resume após corrigir o acesso.')
                        return 'auth_required'
                    terminal = status == 403 or job['attempts'] + 1 >= cfg['max_job_attempts']
                    store.fail(job, status, f'Garmin HTTP {status}. '+('Consulta indisponível; registrada sem substituir dados locais válidos.' if terminal else 'Consulta será tentada na próxima execução.'), terminal=terminal, retry_at=wall()+interval)
                except (requests.RequestException, ValueError):
                    store.fail(job, 0, 'Falha de conexão ou resposta inválida; coleta interrompida para evitar novas tentativas em sequência.', retry_at=wall()+interval)
                    store.set('state', 'waiting_retry')
                    return 'waiting_retry'
        except BudgetReached:
            store.set('state', 'budget_reached')
        except HttpError as exc:
            if exc.status_code == 429 or exc.status_code >= 500:
                delay = max(paced.retry_delay, cfg['retry_cooldown_seconds'])
                store.set('cooldown_until', wall()+delay)
                store.set('state', 'cooldown')
            else:
                store.set('auth_required', True)
                store.set('state', 'auth_required')
        except (OSError, requests.RequestException, ValueError):
            store.set('state', 'connection_error')
        finally:
            if api is not None:
                api.close()
            paced.close()
            store.set('last_run_requests', paced.count)
            store.set('last_run_ended_at', local_now().isoformat())
        return store.get('state')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--once', action='store_true', help='Executa até um mês, respeitando limites e checkpoints.')
    parser.add_argument('--plan', action='store_true', help='Prepara a fila sem acessar a Garmin.')
    parser.add_argument('--status', action='store_true')
    parser.add_argument('--pause', action='store_true')
    parser.add_argument('--resume', action='store_true')
    parser.add_argument('--data-dir', type=Path, default=DEFAULT_DATA)
    parser.add_argument('--max-requests', type=int)
    args = parser.parse_args()
    store = Store(args.data_dir)
    cfg = config()
    if args.max_requests is not None:
        if args.max_requests < 1:
            parser.error('--max-requests deve ser positivo')
        cfg['max_requests_per_run'] = args.max_requests
    if args.pause:
        store.set('paused', True)
        store.set('state', 'paused')
    if args.resume:
        store.set('paused', False)
        store.set('auth_required', False)
        store.set('state', 'waiting')
    if args.plan:
        print(json.dumps(plan(store, cfg), ensure_ascii=False))
    if args.once:
        try:
            print(run_once(store, cfg))
        except CollectorBusy:
            print('Já existe uma coleta em execução; esta instância foi encerrada.')
    if args.status or not any((args.once, args.plan, args.pause, args.resume)):
        print(json.dumps(store.status(), ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
