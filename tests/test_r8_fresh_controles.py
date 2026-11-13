"""Contre-audit R8 indépendant : contrats applicatifs et SQL isolé.

Les contrôles de code ci-dessous sont STATIC CONTRACTS, pas des tests HTTP.
Les requêtes SQLite utilisent uniquement une copie en mémoire de la démo.
"""
from pathlib import Path
import sqlite3
import unittest

ROOT=Path(__file__).resolve().parents[1]

def source(name):
    return (ROOT/name).read_text(encoding='utf-8')

class FreshR8(unittest.TestCase):
    def test_clients_pagination_validation_server(self):
        api=source('src/app/api/clients/route.ts')
        for token in ('Number.isSafeInteger(take)','Number.isSafeInteger(skip)',
                      'db.client.count({where})','db.client.findMany({where,orderBy:',
                      'skip,take','name:{contains:q}','city:{contains:q}',
                      '"Cache-Control":"private, no-store"', 'hasPermission(req,"clients.read")'):
            with self.subTest(token=token): self.assertIn(token,api)

    def test_clients_selection_preserved_in_interfaces(self):
        hooks=source('src/components/erp/hooks.ts')
        order=source('src/components/erp/new-order-dialog.tsx')
        state=source('src/components/erp/client-statement-panel.tsx')
        self.assertIn('useClients(q="",page=1,pageSize=50)',hooks)
        self.assertIn('queryKey: ["clients",q,page,pageSize]',hooks)
        for ui in (order,state):
            self.assertIn('useClients(clientQuery,clientPage,40)',ui)
            self.assertIn('setClientPage(1)',ui)
            self.assertIn('selectedClientLabel',ui)
            self.assertIn('pagination.pages',ui)
            self.assertIn('aria-',ui)

    def test_supplier_reference_not_disclosed_without_cost_rights(self):
        api=source('src/app/api/suppliers/route.ts')
        self.assertIn('supplierSku:pricing?l.supplierSku:null',api)
        self.assertIn('unitPrice:pricing?l.unitPrice:null',api)

    def test_mts_pagination_rejects_decimal_and_invalid_cursors(self):
        api=source('src/app/api/production-stock/route.ts')
        self.assertIn('Number.isSafeInteger(n)',api)
        self.assertIn('Number.isSafeInteger(cursor)',api)
        self.assertIn("bad('Pagination production invalide',400)",api)

    def test_demo_integrity_and_250_clients_paginated_sql(self):
        # Rouvrir en mémoire, jamais de mutation de la base incluse au ZIP.
        src=sqlite3.connect(f'file:{ROOT}/db/custom.db?mode=ro',uri=True)
        dst=sqlite3.connect(':memory:');src.backup(dst);src.close()
        self.assertEqual(dst.execute('PRAGMA integrity_check').fetchone()[0],'ok')
        self.assertEqual(len(dst.execute('PRAGMA foreign_key_check').fetchall()),0)
        dst.executemany('INSERT INTO Client(name,city,phone) VALUES (?,?,?)',
                        [(f'Client recette R8 {i:04d}', 'Casablanca', None) for i in range(250)])
        total=dst.execute('SELECT COUNT(*) FROM Client WHERE name LIKE ?',('%recette R8%',)).fetchone()[0]
        self.assertEqual(total,250)
        pages=[]
        for offset in range(0,total,40):
            rows=dst.execute('SELECT id FROM Client WHERE name LIKE ? ORDER BY name,id LIMIT ? OFFSET ?',('%recette R8%',40,offset)).fetchall()
            self.assertLessEqual(len(rows),40)
            pages.extend(x[0] for x in rows)
        self.assertEqual(len(pages),250)
        self.assertEqual(len(set(pages)),250)
        dst.close()

if __name__=='__main__':
    unittest.main(verbosity=2)
