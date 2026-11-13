import assert from 'node:assert/strict';
import { salesInvoiceStatus } from '../src/lib/sales-invoice-status.ts';
const cases=[
  [100000,0,0,'issued'],
  [80000,0,20000,'partial'], // regression: part-credit without any payment
  [0,0,100000,'settled'],
  [80000,20000,0,'partial'],
  [0,100000,0,'paid'],
  [0,80000,20000,'settled'],
  [60000,20000,20000,'partial'],
];
for (const [rem,paid,credit,status] of cases) assert.equal(salesInvoiceStatus(rem,paid,credit),status);
for (const input of [[-1,0,0],[Infinity,0,0],[100.5,0,0]]) assert.throws(()=>salesInvoiceStatus(...input));
console.log('PASS V18.6: 10 real status cases (issued, partially credited, partially paid, paid, settled, invalid values)');
