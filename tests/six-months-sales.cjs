'use strict';
const assert = require('node:assert/strict');

module.exports = function salesCampaign({api, db}) {
  const sales = '/api/sales';
  const send = async (actor, body, accepted) => (await api(actor, 'POST', sales, body, accepted)).data;
  let order, firstDelivery, lastDelivery, invoice, unit;
  return {
    async open(date) {
      const {client} = (await api('sales','POST','/api/clients',{name:'Client fictif six mois',city:'Casablanca'})).data;
      const {items} = (await api('sales','GET','/api/products?family=MATELAS')).data;
      const product = items.find(item => item.status === 'active' && item.unit === 'u');
      assert(product, 'Matelas actif requis');
      // AUDIT P5.15.27-B (AN-O2C-01) : prix catalogue lu dynamiquement. La valeur
      // en dur (235) datait de la base P5.15.21 ; après reseed P5.15.23 le matelas
      // vaut 245 : un écart de prix basculait le devis en revue tarifaire et la
      // conversion échouait (409 Conflit de données). Le prix du jour fait partie
      // de la fixture, et les montants ultérieurs (facture, avoir, soldes) en
      // dérivent au lieu d'être codés en dur.
      unit = product.unitPrice;
      const {quote} = await send('sales',{action:'quote',payload:{
        clientId:client.id,dueDate:date.slice(0,7)+'-25T09:00:00Z',priority:'normale',
        lines:[{productId:product.id,qty:4,unitPrice:unit}],
      }});
      await send('sales',{action:'quote-state',id:quote.id,state:'sent'});
      await send('sales',{action:'quote-state',id:quote.id,state:'accepted',acceptanceRef:'ACCORD-SIM-O2C'});
      ({order} = await send('sales',{action:'convert',id:quote.id}));
      assert.equal(order.lines[0].pieces.length,4);
      await send('sales2',{action:'convert',id:quote.id},[409]);
      // CASCADE3 (11/11/2026) — P1FIX : la commande convertie naît
      // pending_validation ; aucun OF n'existe avant le visa commercial
      // quatre-yeux d'un responsable indépendant du créateur.
      assert.equal(order.status,'pending_validation','commande convertie en attente de validation');
      let wosBefore=(await api('sales','GET','/api/work-orders?orderId='+order.id)).data.items;
      assert.equal(wosBefore.length,0,'aucun OF avant approbation (P1FIX)');
      await api('approver','PATCH','/api/orders/'+order.id,{action:'approve',comment:'Validation quatre-yeux O2C six mois — responsable indépendant'});
      // AUDIT P5.15.27-B (AN-O2C-01, règle §7) : depuis P5.15.23, l'OF d'une
      // commande confirmée naît « approved » — plus d'approbation commerciale
      // supplémentaire ; l'atelier (magasinier) conduit start puis complete.
      const wos=(await api('sales','GET','/api/work-orders?orderId='+order.id)).data.items;
      assert.equal(wos.length,1,'un OF automatique par ligne commerciale');
      await api('sales','PATCH','/api/work-orders/'+wos[0].id,{action:'approve'},[403]);
      await api('inventory','PATCH','/api/work-orders/'+wos[0].id,{action:'start'});
      await api('inventory','PATCH','/api/work-orders/'+wos[0].id,{action:'complete'});
    },
    async partial() {
      for (let i = 0; i < 2; i++) await api('sales','PATCH','/api/orders/'+order.id,{action:'advance'});
      await api('sales','PATCH','/api/orders/'+order.id,{action:'advance'},[409]);
      ({delivery:firstDelivery}=await send('sales',{action:'delivery',orderId:order.id,pieceIds:order.lines[0].pieces.slice(0,2).map(p=>p.id)}));
      assert.equal(firstDelivery.orderId,order.id);
    },
    async complete() {
      const request = {action:'delivery',orderId:order.id,pieceIds:order.lines[0].pieces.slice(2).map(p=>p.id)};
      const attempts = await Promise.all(['sales','sales2'].map(actor=>api(actor,'POST',sales,request,[201,409])));
      assert.deepEqual(attempts.map(x=>x.response.status).sort(),[201,409]);
      lastDelivery=attempts.find(x=>x.response.status===201).data.delivery;
      assert.equal(db.prepare('SELECT count(*) n FROM SalesDelivery WHERE orderId=?').get(order.id).n,2);
    },
    async bill() {
      const request = {action:'invoice',orderId:order.id,deliveryIds:[firstDelivery.id,lastDelivery.id],taxRateBps:0};
      ({invoice}=await send('finance',request));
      assert.equal(invoice.totalCents,Math.round(4*unit*100));
      await send('finance2',request,[409]);
      await send('sales',{action:'payment',invoiceId:invoice.id,amountCents:30000,reference:'SIM-O2C-01',method:'virement'},[403]);
      // P5.15.21 (SEP-002) : quatre-yeux financiers — l'encaissement doit
      // provenir d'un compte DISTINCT de l'émetteur de la facture (finance).
      // L'auto-encaissement par l'émetteur est attendu en échec (403).
      await send('finance',{action:'payment',invoiceId:invoice.id,amountCents:30000,reference:'SIM-O2C-01',method:'virement'},[403]);
      await send('finance2',{action:'payment',invoiceId:invoice.id,amountCents:30000,reference:'SIM-O2C-01',method:'virement'});
    },
    async credit() {
      // AUDIT P5.15.27-B (AN-O2C-01) : avoir dérivé du total dynamique —
      // le solde (total − 80 000 payés) doit rester couvert par l'avoir.
      const creditAmt = Math.round(4*unit*100) - 80000;
      const {credit}=await send('finance',{action:'credit',invoiceId:invoice.id,amountCents:creditAmt,reason:'Avoir commercial fictif de recette'});
      assert.equal(credit.status,'draft');
      await send('finance',{action:'approve-credit',creditId:credit.id},[409]);
      await send('finance2',{action:'approve-credit',creditId:credit.id});
    },
    async settle() {
      const payment={action:'payment',invoiceId:invoice.id,amountCents:50000,reference:'SIM-O2C-02',method:'virement'};
      // Même règle quatre-yeux : l'émetteur (finance) est refusé, finance2 encaisse.
      await send('finance',payment,[403]);
      await send('finance2',payment);
      await send('finance2',{...payment,reference:'SIM-O2C-02b'},[409]);
      const {items}= (await api('finance','GET',sales+'?type=invoices')).data;
      const result=items.find(item=>item.id===invoice.id);
      assert.equal(result.status,'settled');
      const paid=result.payments.reduce((sum,p)=>sum+p.amountCents,0);
      const credited=result.credits.filter(c=>c.status==='approved').reduce((sum,c)=>sum+c.amountCents,0);
      assert.equal(result.totalCents-paid-credited,0);
    },
  };
};
