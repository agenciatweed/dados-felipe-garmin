import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime, timedelta, timezone

from catalog import CATALOG
from collector import plan, run_once, BudgetReached, ProcessLock, CollectorBusy, retry_after, config, finish_batch
from garmin_personal_api.errors import HttpError
from local_store import Store, NotCollected

class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(self.temp.name)
        self.cfg = config()
        self.now = datetime(2026, 10, 24, 10, tzinfo=timezone(timedelta(hours=-3)))

    def tearDown(self):
        self.temp.cleanup()

    def first_job(self, resource='activities'):
        with self.store.connect() as db:
            return dict(db.execute('SELECT * FROM jobs WHERE resource=? ORDER BY id LIMIT 1', (resource,)).fetchone())

    def test_plan_starts_october_and_resumes_same_month(self):
        a = plan(self.store, self.cfg, self.now)
        b = plan(self.store, self.cfg, self.now + timedelta(hours=1))
        self.assertEqual(a['id'], b['id'])
        self.assertEqual((a['start'], a['end']), ('2025-10-01','2025-10-31'))
        with self.store.connect() as db:
            used = {r[0] for r in db.execute('SELECT DISTINCT resource FROM jobs')}
        self.assertFalse(used & {'hrv','hrv_range','weight','food','spo2','cycle','hydration','wellness_activities'})

    def test_store_overlap_replaces_day_not_duplicate(self):
        plan(self.store, self.cfg, self.now)
        job = self.first_job('steps')
        self.store.save(job, [{'calendarDate':'2025-10-01','totalSteps':10}], CATALOG['steps'])
        self.store.save(job, [{'calendarDate':'2025-10-01','totalSteps':20}], CATALOG['steps'])
        result = self.store.read(CATALOG['steps'],'2025-10-01','2025-10-07','2025-10-01')
        self.assertEqual(len(result['data']),1)
        self.assertEqual(result['data'][0]['totalSteps'],20)
        self.assertTrue(result['coverage']['complete'])
        with self.assertRaises(NotCollected):
            self.store.read(CATALOG['heart_rate'],'2025-10-01','2025-10-01','2025-10-01')

    def test_activity_pagination_and_details_are_durable(self):
        plan(self.store, self.cfg, self.now)
        job = self.first_job()
        batch = [{'activityId': n+1,'startTimeLocal':'2025-10-01T10:00:00'} for n in range(99)]
        self.store.save(job,batch,CATALOG['activities'],self.cfg)
        with self.store.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM jobs WHERE resource='download'").fetchone()[0],99)
            next_job = dict(db.execute("SELECT * FROM jobs WHERE resource='activities' AND status='pending'").fetchone())
        self.assertEqual(json.loads(next_job['params'])['offset'],99)
        self.store.save(next_job,[],CATALOG['activities'],self.cfg)
        result=self.store.read(CATALOG['activities'],'2025-10-01','2025-10-31','2025-10-01')
        self.assertEqual(len(result['data']),99)
        self.assertTrue(result['coverage']['complete'])

    def test_limit_pauses_and_resume_does_not_skip_job(self):
        class API:
            def search_activities(self, **kw):
                raise HttpError(status_code=429,method='GET',url='https://personal.connectapi.garmin.com',response_text='')
            def close(self): pass
        self.assertEqual(run_once(self.store,self.cfg,api_factory=API),'cooldown')
        job=self.first_job()
        self.assertEqual(job['status'],'pending')
        self.assertEqual(self.store.get('next_month'),None)
        self.assertGreater(self.store.get('cooldown_until'),0)
        self.assertEqual(run_once(self.store,self.cfg,api_factory=lambda: self.fail('Unexpected second request')),'cooldown')

    def test_process_lock_prevents_concurrent_collectors(self):
        with ProcessLock(Path(self.temp.name)/'lock'):
            with self.assertRaises(CollectorBusy):
                with ProcessLock(Path(self.temp.name)/'lock'): pass

    def test_incremental_recovers_offline_days(self):
        self.store.set('mode','incremental')
        self.store.set('covered_until','2026-10-18')
        batch=plan(self.store,self.cfg,self.now)
        self.assertEqual(batch['start'],'2026-10-18')
        self.assertEqual(batch['end'],'2026-10-24')

    def test_incremental_window_covers_48_hour_cadence(self):
        self.store.set('mode','incremental')
        self.store.set('covered_until','2026-10-24')
        batch=plan(self.store,self.cfg,self.now)
        self.assertEqual(batch['start'],'2026-10-22')
        self.assertEqual(batch['end'],'2026-10-24')

    def test_history_transitions_only_after_finished(self):
        self.store.set('next_month','2026-10-01')
        batch=plan(self.store,self.cfg,self.now)
        self.assertFalse(finish_batch(self.store,batch,self.cfg,0))
        with self.store.connect() as db:
            db.execute("UPDATE jobs SET status='done'")
        self.assertTrue(finish_batch(self.store,batch,self.cfg,0))
        self.assertEqual(self.store.get('mode'),'incremental')

    def test_budget_keeps_job_pending(self):
        class API:
            def search_activities(self,**kw): raise BudgetReached()
            def close(self): pass
        self.assertEqual(run_once(self.store,self.cfg,api_factory=API),'budget_reached')
        self.assertEqual(self.first_job()['status'],'pending')

    def test_retry_after_seconds_and_http_date(self):
        self.assertEqual(retry_after('120',0),120)
        self.assertEqual(retry_after('Thu, 01 Jan 1970 00:02:00 GMT',0),120)
        self.assertEqual(retry_after('invalid',0),0)

    def test_phase_cadence_and_wait_guard(self):
        class API:
            def __getattr__(self, name):
                if name == 'close': return lambda: None
                def stop(**kw): raise BudgetReached()
                return stop
        for mode, interval in [('history',1800),('incremental',172800)]:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as root:
                store=Store(root);store.set('mode',mode)
                self.assertEqual(run_once(store,self.cfg,api_factory=API,wall=lambda:10000),'budget_reached')
                self.assertEqual(store.get('next_run_at'),10000+interval)
                self.assertEqual(run_once(store,self.cfg,api_factory=lambda:self.fail('Early request'),wall=lambda:10001),'waiting')

    def test_cadence_migration_keeps_cooldown(self):
        self.store.set('next_run_at',13600)
        self.assertEqual(run_once(self.store,self.cfg,api_factory=lambda:self.fail('Early request'),wall=lambda:11000),'waiting')
        self.assertEqual(self.store.get('next_run_at'),11800)
        self.store.set('cooldown_until',20000)
        self.assertEqual(run_once(self.store,self.cfg,api_factory=lambda:self.fail('Cooldown ignored'),wall=lambda:15000),'cooldown')
        self.assertEqual(self.store.get('cooldown_until'),20000)

if __name__=='__main__': unittest.main()
