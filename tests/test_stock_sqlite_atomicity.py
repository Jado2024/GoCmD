"""Vérifie l'invariant SQL d'atomicité; ne remplace PAS un test API Prisma."""
import tempfile,sqlite3,threading,os
with tempfile.TemporaryDirectory() as tmp:
    path=os.path.join(tmp,'test.db')
    db=sqlite3.connect(path)
    db.execute('CREATE TABLE Material(id INTEGER PRIMARY KEY,stockQty REAL)')
    db.execute('INSERT INTO Material VALUES(1,10)')
    db.execute('CREATE TABLE Purchase(id INTEGER PRIMARY KEY,status TEXT)')
    db.execute('INSERT INTO Purchase VALUES(1,"ordered")')
    db.commit();db.close()
    changes=[]
    def withdraw():
        conn=sqlite3.connect(path,timeout=5)
        conn.execute('BEGIN IMMEDIATE')
        result=conn.execute('UPDATE Material SET stockQty=stockQty-7 WHERE id=1 AND stockQty>=7')
        changes.append(result.rowcount)
        conn.commit();conn.close()
    t1=threading.Thread(target=withdraw);t2=threading.Thread(target=withdraw)
    t1.start();t2.start();t1.join();t2.join()
    db=sqlite3.connect(path)
    assert sorted(changes)==[0,1],changes
    assert db.execute('SELECT stockQty FROM Material').fetchone()[0]==3
    # Compare-and-swap on purchase receipt (the first status change wins).
    a=db.execute('UPDATE Purchase SET status="received" WHERE id=1 AND status="ordered"').rowcount
    b=db.execute('UPDATE Purchase SET status="received" WHERE id=1 AND status="ordered"').rowcount
    assert (a,b)==(1,0)
    db.close()
print('PASS: concurrence SQLite simulée, pas de stock négatif ni de double réception.')
