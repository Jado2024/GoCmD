"""R4 targeted static contracts and SQLite invariants; never writes into DEMO."""
from pathlib import Path
import sqlite3
import unittest

ROOT=Path(__file__).resolve().parents[1]
read=lambda file:(ROOT/file).read_text(encoding='utf-8')

class R4Regression(unittest.TestCase):
 def test_generic_quote_allowed_in_ui(self):
  s=read('src/components/erp/new-order-dialog.tsx')
  self.assertNotIn('!(launchMode==="quote" && lines.some(l=>l.generic))',s)
  self.assertNotIn("Le devis générique n'est pas encore intégré",s)
  self.assertIn('if(asQuote)',s)
 def test_quote_plan_freeze_and_visible_validation_state(self):
  s=read('src/app/api/sales/route.ts')
  self.assertIn('priceReviewPlanJson:JSON.stringify(plan)',s)
  self.assertIn('quoteReviewPlan(current.priceReviewPlanJson,payload.lines)',s)
  self.assertIn('approvalPlanValid=false',s)
  self.assertIn('priceReviewPlanJson:internalPlan',s)
  ui=read('src/components/erp/sales-view.tsx')
  self.assertIn('approvalPlanValid===false',ui)
  self.assertIn('lineIndex:quotePriceApproval.lineIndex',ui)
 def test_generic_quote_no_catalogue_write(self):
  s=read('src/app/api/sales/route.ts')
  self.assertIn('if(line.generic)continue // GEN : snapshot autonome',s)
  self.assertIn('genericVirtualProduct',s)
  self.assertIn('productsSnapshotJson',s)
 def test_supplier_four_eyes_exception(self):
  s=read('src/app/api/suppliers/route.ts')
  self.assertIn('if(request.actor===actor)',s)
  self.assertIn('SUPPLIER_SKU_EXCEPTION_REQUESTED',s)
  self.assertIn('SUPPLIER_SKU_EXCEPTION_APPROVED',s)
  self.assertIn('approvedSupplierExceptionKey',s)
  self.assertIn('normalizeSupplierSku(x.supplierSku)===normalizeSupplierSku(nextSku)',s)
 def test_pf_revision_separate_approval(self):
  s=read('src/app/api/products/[id]/revision/route.ts')
  self.assertIn('original.revisionRequestedBy===actor',s)
  self.assertIn('PF_TECHNICAL_REVISION_PROPOSED',s)
  self.assertIn('PF_TECHNICAL_REVISION_APPROVED',s)
  self.assertIn('canonicalIdentity:coded.identity',s)
 def test_new_schema_fields_in_actual_demo(self):
  c=sqlite3.connect(ROOT/'db/custom.db')
  with c:
   for tab,cols in [('Product',('revisionOfId','revisionNumber','revisionRequestedBy','revisionApprovedBy')),
                    ('SalesQuote',('priceApprovalsJson','priceReviewPlanJson')),
                    ('SupplierMaterial',('supplierSkuExceptionApprovedBy','supplierSkuExceptionReason'))]:
    actual={r[1] for r in c.execute(f'PRAGMA table_info("{tab}")')}
    for col in cols:self.assertIn(col,actual)
   self.assertEqual(c.execute('pragma integrity_check').fetchone()[0],'ok')
   self.assertEqual(c.execute('select count(*) from SalesQuote').fetchone()[0],0)
   self.assertEqual(c.execute('select count(*) from "Order"').fetchone()[0],0)
 def test_r4_migrations_not_retrofit_into_real_db(self):
  s=read('scripts/recreer_demo_sodepi_p51523.py')
  self.assertIn('DEMO_ONLY',s)
  self.assertIn('Refus',s)

if __name__=='__main__':unittest.main(verbosity=2)
