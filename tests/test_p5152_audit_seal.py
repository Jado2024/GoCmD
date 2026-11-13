import os,sqlite3,tempfile,shutil,pathlib,subprocess,sys,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'scripts/audit_seal_p5152.py'
class AuditSealTests(unittest.TestCase):
 def test_hmac_seal_detects_tampering(self):
  with tempfile.TemporaryDirectory(prefix='gocmd-audit-') as t:
   tmp=pathlib.Path(t);work=tmp/'db';work.mkdir()
   dbpath=work/'custom.db';shutil.copy2(ROOT/'db/custom.db',dbpath)
   # P5.15.20 : la base démo livrée est vierge d'événements d'audit (référence
   # P5.15.17 : zéro transaction, donc zéro AuditEvent). Insérer un événement
   # bénin dans la COPIE temporaire AVANT le scellement afin que le sceau le
   # couvre et que la falsification ultérieure soit détectée pour la bonne
   # raison (modification d'une ligne scellée, non ajout de ligne).
   if sqlite3.connect(dbpath).execute('SELECT count(*) FROM AuditEvent').fetchone()[0]==0:
    con0=sqlite3.connect(dbpath)
    con0.execute("INSERT INTO AuditEvent (actor,action,entity,entityId,details) VALUES ('SYSTEM','TEST_P5152','AuditEvent','0','événement bénin de test du sceau')")
    con0.commit();con0.close()
   seal=tmp/'safe-elsewhere'/'checkpoint.json'; env={**os.environ,'GOCMD_AUDIT_SEAL_KEY':'test-only-do-not-deploy-xxxxxx-long-random-key-1234'}
   def run(act):return subprocess.run([sys.executable,str(SCRIPT),act,'--db',str(dbpath),'--out',str(seal)],capture_output=True,text=True,env=env)
   self.assertEqual(run('seal').returncode,0)
   self.assertEqual(run('verify').returncode,0)
   con=sqlite3.connect(dbpath)
   row=con.execute('SELECT id,details FROM AuditEvent ORDER BY id LIMIT 1').fetchone()
   self.assertIsNotNone(row)
   con.execute('UPDATE AuditEvent SET details=? WHERE id=?',(row[1]+' MODIFIE',row[0]));con.commit();con.close()
   v=run('verify')
   self.assertEqual(v.returncode,2,v.stdout+v.stderr)
if __name__=='__main__':unittest.main()
