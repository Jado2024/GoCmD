"""Isolated SQLite counterexample showing a fixed 150-row cap hides older eligible OF.
This is a SQL/logic reproduction, not an HTTP test of the Prisma handler.
"""
import sqlite3
import unittest

class PaginationRegression(unittest.TestCase):
    def test_more_than_150_orders_are_reachable_with_pages(self):
        c=sqlite3.connect(':memory:')
        c.execute('CREATE TABLE WorkOrder(id INTEGER PRIMARY KEY, status TEXT NOT NULL)')
        c.executemany('INSERT INTO WorkOrder(id,status) VALUES (?,?)',[(i, 'completed' if i>10 else 'approved') for i in range(1,161)])
        original=c.execute('SELECT id,status FROM WorkOrder ORDER BY id DESC LIMIT 150').fetchall()
        self.assertEqual([x for x in original if x[1]=='approved'],[],'old cap masks older approved OF')
        pages=[]
        for skip in range(0,160,50):
            pages.extend(c.execute('SELECT id,status FROM WorkOrder ORDER BY id DESC LIMIT 50 OFFSET ?',(skip,)).fetchall())
        self.assertEqual(len(pages),160)
        self.assertEqual(len([x for x in pages if x[1]=='approved']),10)
        self.assertEqual(pages[-1][0],1)

if __name__=='__main__':unittest.main()
