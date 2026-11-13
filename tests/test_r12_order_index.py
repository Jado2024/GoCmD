import pathlib,sqlite3,subprocess,sys,tempfile
root=pathlib.Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory() as d:
 p=pathlib.Path(d)/'test.db'; backup=pathlib.Path(d)/'backup.db'
 source=sqlite3.connect(f'file:{root / "db" / "custom.db"}?mode=ro',uri=True)
 with sqlite3.connect(p) as target:source.backup(target)
 source.close()
 # Reproduction sur copie, même si la base DEMO fournie est déjà migrée.
 with sqlite3.connect(p) as target:target.execute('DROP INDEX IF EXISTS Order_createdAt_id_idx')
 verify=[sys.executable,str(root/'scripts/verify_order_index_r12.py'),'--db',str(p)]
 assert subprocess.run(verify,capture_output=True).returncode==1,'Index must be absent before migration on R11 baseline'
 migrate=[sys.executable,str(root/'scripts/upgrade_order_list_index_r11.py'),'--db',str(p),'--backup',str(backup),'--apply']
 result=subprocess.run(migrate,capture_output=True,text=True); assert result.returncode==0,result.stderr
 result=subprocess.run(verify,capture_output=True,text=True);assert result.returncode==0,result.stderr
 assert backup.exists()
 with sqlite3.connect(backup) as old: assert old.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 print('PASS R12: migration sur copie et sauvegarde; refus pré-migration; contrôle post-migration')
