"""Static contract for per-line decision. Does not count as an HTTP E2E test."""
import pathlib,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
class ApprovalV2(unittest.TestCase):
 def test_server_requires_line_id(self):
  source=(ROOT/'src/app/api/orders/[id]/route.ts').read_text()
  self.assertIn('const lineId=body?.lineId',source)
  self.assertIn('order.lines.filter(l=>l.id===lineId && l.priceApprovalStatus==="pending")',source)
  self.assertIn('pending.length!==1',source)
 def test_ui_uses_per_line_buttons(self):
  source=(ROOT/'src/components/erp/orders-view.tsx').read_text()
  self.assertIn('Autoriser cette ligne',source)
  self.assertIn('Refuser cette ligne',source)
  self.assertIn('lineId,reason:',source)
  self.assertNotIn('>Autoriser les prix</Button>',source)
 def test_pricing_mutation_recomputes_per_line_hash(self):
  source=(ROOT/'src/app/api/products/[id]/director-price/route.ts').read_text()
  self.assertIn('technicalSnapshotHash:revised.hash',source)
  self.assertIn('revisePendingPriceSnapshot',source)
  self.assertNotIn('orderLine.updateMany({where:{productId:id},data:{unitPrice:input.unitPrice}})',source)
if __name__=='__main__':unittest.main(verbosity=2)
