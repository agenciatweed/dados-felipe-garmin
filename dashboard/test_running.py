import json,tempfile,unittest
from pathlib import Path
from running_data import normalize,garmin_data
class RunningTests(unittest.TestCase):
 def activity(self,id,**kw):
  return dict(activityId=id,activityName='Corrida',activityType={'typeKey':'running'},distance=5000,duration=1800,startTimeLocal='2026-01-10 07:00:00',**kw)
 def test_outdoor_and_pace(self):
  a=self.activity(1,averageSpeed=2.5);self.assertEqual(normalize(a)['pace'],400)
  a['activityType']['typeKey']='treadmill_running';self.assertIsNone(normalize(a))
  a['activityType']['typeKey']='running';a['activityName']='Corrida virtual';self.assertIsNone(normalize(a))
 def test_weighted_month_and_coverage(self):
  with tempfile.TemporaryDirectory() as tmp:
   f=Path(tmp)/'dados_locais/raw/activities';f.mkdir(parents=True)
   a=self.activity(1,averageHR=150);b=self.activity(2,averageHR=180)
   b.update(distance=10000,duration=3000)
   (f/'2026-01-01_2026-01-31_0.json').write_text(json.dumps([a,b]))
   runs,months,coverage=garmin_data(Path(tmp));m=months[0]
   self.assertEqual(len(runs),2);self.assertTrue(m['complete']);self.assertEqual(m['avgKm'],7.5)
   self.assertAlmostEqual(m['pace'],320);self.assertAlmostEqual(m['hr'],168.75)
   self.assertEqual(len(coverage['days']),31)
if __name__=='__main__':unittest.main()
