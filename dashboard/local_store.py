"""Durable raw files and a SQLite index, shared by collector and offline dashboard."""
from __future__ import annotations
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import sqlite3

DEFAULT_DATA = Path(__file__).resolve().parent.parent / 'dados_locais'
SIMPLE_RANGES = {'stress', 'steps', 'hydration', 'sleep_range', 'body_battery', 'daily_range', 'wellness_activities'}

def local_now():
    # Sao Paulo has UTC-3; avoids an optional tzdata dependency on Windows.
    return datetime.now(timezone(timedelta(hours=-3)))

def days(start, end):
    cursor = date.fromisoformat(start)
    last = date.fromisoformat(end)
    while cursor <= last:
        yield str(cursor)
        cursor += timedelta(days=1)

def atomic_write(path, content):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + f'.{os.getpid()}.tmp')
    with temp.open('wb') as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)

class NotCollected(ValueError):
    pass

class Store:
    def __init__(self, root=DEFAULT_DATA):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.db = self.root / 'indice.sqlite3'
        with self.connect() as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY, mode TEXT, start TEXT, end TEXT, status TEXT, created TEXT, finished TEXT);
                CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY, batch TEXT, resource TEXT, job_key TEXT, params TEXT, status TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0, retry_at REAL DEFAULT 0, error TEXT, UNIQUE(batch,resource,job_key));
                CREATE TABLE IF NOT EXISTS snapshots(resource TEXT, record_key TEXT, start TEXT, end TEXT, day TEXT, activity TEXT, path TEXT, fetched TEXT, PRIMARY KEY(resource,record_key));
                CREATE TABLE IF NOT EXISTS daily_rows(resource TEXT, day TEXT, payload TEXT, fetched TEXT, PRIMARY KEY(resource,day));
                CREATE TABLE IF NOT EXISTS coverage(resource TEXT, day TEXT, fetched TEXT, PRIMARY KEY(resource,day));
                CREATE TABLE IF NOT EXISTS activities(id TEXT PRIMARY KEY, day TEXT, payload TEXT, fetched TEXT);
                CREATE TABLE IF NOT EXISTS failures(resource TEXT, record_key TEXT, http_status INTEGER, message TEXT, at TEXT, PRIMARY KEY(resource,record_key));
                CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(batch,status,retry_at,id);
                CREATE INDEX IF NOT EXISTS snapshots_period ON snapshots(resource,start,end);
                CREATE INDEX IF NOT EXISTS activities_day ON activities(day);
            ''')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.db, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def get(self, key, default=None):
        with self.connect() as db:
            row = db.execute('SELECT value FROM meta WHERE key=?', (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def set(self, key, value):
        with self.connect() as db:
            db.execute('INSERT OR REPLACE INTO meta VALUES (?,?)', (key, json.dumps(value)))

    def add_job(self, db, batch, resource, key, params):
        db.execute('INSERT OR IGNORE INTO jobs(batch,resource,job_key,params) VALUES (?,?,?,?)', (batch, resource, key, json.dumps(params)))

    def save(self, job, data, resource, extra=None):
        params = json.loads(job['params'])
        rid = resource['id']
        key = job['job_key']
        binary = isinstance(data, bytes)
        safe_key = re.sub(r'[^A-Za-z0-9_.-]', '_', key)
        path = self.root / 'raw' / rid / (safe_key + ('.zip' if binary else '.json'))
        now = local_now().isoformat()
        raw = data if binary else json.dumps(data, ensure_ascii=False).encode('utf-8')
        atomic_write(path, raw)
        start, end = params.get('start'), params.get('end')
        with self.connect() as db:
            db.execute('INSERT OR REPLACE INTO snapshots VALUES (?,?,?,?,?,?,?,?)', (rid, key, start, end, params.get('day'), params.get('activity'), str(path.relative_to(self.root)), now))
            db.execute('DELETE FROM failures WHERE resource=? AND record_key=?', (rid, key))
            if rid == 'activities':
                for activity in data or []:
                    activity_id = str(activity['activityId'])
                    day = activity.get('startTimeLocal', '')[:10]
                    db.execute('INSERT OR REPLACE INTO activities VALUES (?,?,?,?)', (activity_id, day, json.dumps(activity, ensure_ascii=False), now))
                    for detail in ('activity', 'workouts', 'download'):
                        if detail == 'download' and extra and not extra.get('download_originals', True):
                            continue
                        existing = db.execute('SELECT 1 FROM snapshots WHERE resource=? AND record_key=?', (detail, activity_id)).fetchone()
                        if detail == 'download' and existing:
                            continue
                        self.add_job(db, job['batch'], detail, activity_id, {'activity': activity_id, 'start': start, 'end': end})
                if len(data or []) >= 99:
                    offset = params.get('offset', 0) + 99
                    self.add_job(db, job['batch'], rid, f'{start}_{end}_{offset}', {**params, 'offset': offset})
                else:
                    for day in days(start, end):
                        db.execute('INSERT OR REPLACE INTO coverage VALUES (?,?,?)', (rid, day, now))
            elif resource['scope'] == 'day':
                day = params['day']
                db.execute('INSERT OR REPLACE INTO daily_rows VALUES (?,?,?,?)', (rid, day, json.dumps(data, ensure_ascii=False), now))
                db.execute('INSERT OR REPLACE INTO coverage VALUES (?,?,?)', (rid, day, now))
            elif rid in SIMPLE_RANGES:
                records = data.get('data', []) if isinstance(data, dict) and rid == 'daily_range' else data or []
                grouped = {d: [] for d in days(start, end)}
                if not isinstance(records, list):
                    raise ValueError('Formato de histórico não reconhecido.')
                unassigned = []
                for record in records:
                    d = record.get('calendarDate') or record.get('date') or record.get('startTimeLocal', '')[:10] if isinstance(record, dict) else None
                    if d in grouped:
                        grouped[d].append(record)
                    else:
                        unassigned.append(record)
                for day, items in grouped.items():
                    db.execute('INSERT OR REPLACE INTO daily_rows VALUES (?,?,?,?)', (rid, day, json.dumps(items, ensure_ascii=False), now))
                    db.execute('INSERT OR REPLACE INTO coverage VALUES (?,?,?)', (rid, day, now))
                if unassigned:
                    db.execute('INSERT OR REPLACE INTO failures VALUES (?,?,?,?,?)', (rid, key, 0, 'Alguns registros não têm data reconhecida; preservados no arquivo bruto.', now))
            elif resource['scope'] == 'range':
                for day in days(start, end):
                    db.execute('INSERT OR REPLACE INTO coverage VALUES (?,?,?)', (rid, day, now))
            db.execute("UPDATE jobs SET status='done', error=NULL WHERE id=?", (job['id'],))

    def fail(self, job, status, message, terminal=False, retry_at=0):
        with self.connect() as db:
            db.execute('INSERT OR REPLACE INTO failures VALUES (?,?,?,?,?)', (job['resource'], job['job_key'], status, message, local_now().isoformat()))
            db.execute('UPDATE jobs SET status=?, attempts=attempts+1, retry_at=?, error=? WHERE id=?', ('unavailable' if terminal else 'pending', retry_at, message, job['id']))

    def status(self):
        with self.connect() as db:
            current = db.execute("SELECT * FROM batches WHERE status='pending' ORDER BY created LIMIT 1").fetchone()
            counts = {r['status']: r['n'] for r in db.execute('SELECT status,COUNT(*) n FROM jobs WHERE batch=? GROUP BY status', (current['id'],))} if current else {}
            totals = db.execute('SELECT COUNT(*) n, MIN(day) first, MAX(day) last FROM activities').fetchone()
            errors = [dict(r) for r in db.execute('SELECT resource,http_status,message,at FROM failures ORDER BY at DESC LIMIT 8')]
            finished = db.execute("SELECT COUNT(*) FROM batches WHERE mode='history' AND status!='pending'").fetchone()[0]
        return dict(mode=self.get('mode', 'history'), state=self.get('state', 'not_started'), paused=self.get('paused', False), history_start=self.get('history_start'), next_month=self.get('next_month'), next_run_at=self.get('next_run_at'), cooldown_until=self.get('cooldown_until'), heartbeat=self.get('heartbeat'), last_success_at=self.get('last_success_at'), current_batch=dict(current) if current else None, jobs=counts, months_completed=finished, activities=dict(totals), errors=errors, root=str(self.root), disabled_resources=self.get('disabled_resources', {}))

    def read(self, resource, start, end, day, activity=''):
        rid, scope = resource['id'], resource['scope']
        with self.connect() as db:
            snapshots = [dict(r) for r in db.execute('SELECT * FROM snapshots WHERE resource=? ORDER BY fetched', (rid,))]
            if scope == 'activities':
                data = [json.loads(r[0]) for r in db.execute('SELECT payload FROM activities WHERE day BETWEEN ? AND ? ORDER BY day DESC,id DESC', (start, end))]
            elif scope == 'day':
                row = db.execute('SELECT payload FROM daily_rows WHERE resource=? AND day=?', (rid, day)).fetchone()
                data = json.loads(row[0]) if row else None
            elif rid in SIMPLE_RANGES:
                data = []
                for r in db.execute('SELECT payload FROM daily_rows WHERE resource=? AND day BETWEEN ? AND ? ORDER BY day', (rid, start, end)):
                    data.extend(json.loads(r[0]))
                if rid == 'daily_range':
                    data = {'data': data}
            elif scope in ('activity', 'download', 'static'):
                matches = [s for s in snapshots if scope == 'static' or s['activity'] == activity]
                if not matches:
                    raise NotCollected('Este recurso ainda não foi coletado. O coletor o salvará automaticamente quando chegar ao período correspondente.')
                snap = matches[-1]
                if scope == 'download':
                    return (self.root / snap['path']).read_bytes()
                data = json.loads((self.root / snap['path']).read_text(encoding='utf-8'))
            else:
                matches = [s for s in snapshots if s['start'] <= end and s['end'] >= start]
                if not matches:
                    raise NotCollected('O período ainda não foi coletado para este recurso.')
                # Preserve complete original payloads; do not invent period averages.
                windows = [{'start': s['start'], 'end': s['end'], 'data': json.loads((self.root / s['path']).read_text(encoding='utf-8'))} for s in matches]
                if len(windows) == 1 and windows[0]['start'] == start and windows[0]['end'] == end:
                    data = windows[0]['data']
                else:
                    data = {'localWindows': windows, 'note': 'Respostas originais por janela de coleta; podem incluir datas fora do filtro. Não representam médias recalculadas do período.'}
            expected = [day] if scope == 'day' else list(days(start, end)) if scope in ('range', 'activities') else []
            covered = {r[0] for r in db.execute('SELECT day FROM coverage WHERE resource=? AND day BETWEEN ? AND ?', (rid, min(expected), max(expected)))} if expected else set()
            missing = [d for d in expected if d not in covered]
            if expected and not covered and not (scope == 'activities' and data):
                raise NotCollected('Este dia ou período ainda não foi coletado. Consulte o progresso da importação.')
            relevant = [s for s in snapshots if scope == 'static' or (scope in ('activity', 'download') and s['activity'] == activity) or (s['start'] and s['start'] <= end and s['end'] >= start) or s['day'] == day]
            latest = max((s['fetched'] for s in relevant), default=None)
            warnings = [dict(r) for r in db.execute('SELECT resource,record_key,http_status,message FROM failures WHERE resource=? LIMIT 6', (rid,))]
        return dict(data=data, fetched_at=latest, source='Arquivo local · Garmin Personal API', empty=data is None or data == [] or data == {}, local=True, coverage=dict(complete=not missing, collected_days=len(covered), requested_days=len(expected), missing_days=missing), warnings=warnings)
