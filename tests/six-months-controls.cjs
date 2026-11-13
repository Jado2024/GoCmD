'use strict';
const assert = require('node:assert/strict');
const {randomBytes,randomUUID} = require('node:crypto');

async function accounts({api, cookies}) {
  const username='qa_permission_probe';
  const initial=randomBytes(24).toString('base64url');
  const changed=randomBytes(24).toString('base64url');
  const account={username,password:initial,roles:['sales','approver'],permissions:{'sales.orders':false}};
  await api('sales','POST','/api/admin/users',account,[403]);
  await api('root','POST','/api/admin/users',account,[201]);
  async function authenticate(password, accepted=[200]) {
    const {response}=await api('permissionProbe','POST','/api/auth/login',{username,password},accepted);
    if(response.ok) cookies.permissionProbe=response.headers.get('set-cookie').split(';')[0];
  }
  await authenticate(initial);
  await api('permissionProbe','GET','/api/clients',null,[403]);
  await api('permissionProbe','POST','/api/me/password',{oldPassword:initial,newPassword:changed});
  await api('permissionProbe','GET','/api/me',null,[401]);
  await authenticate(initial,[401]);
  await authenticate(changed);
  await api('permissionProbe','GET','/api/clients');
  await api('permissionProbe','POST','/api/orders',{},[403]);
  await api('root','GET','/api/orders',null,[403]);
  await api('root','PATCH','/api/admin/users',{username,permissions:{'clients.read':false}});
  await api('permissionProbe','GET','/api/me',null,[401]);
  await authenticate(changed);
  await api('permissionProbe','GET','/api/clients',null,[403]);
  await api('permissionProbe','POST','/api/auth/logout');
  await api('permissionProbe','GET','/api/me',null,[401]);
  await authenticate(changed);
  await api('root','PATCH','/api/admin/users',{username,active:false});
  await api('permissionProbe','GET','/api/me',null,[401]);
  await authenticate(changed,[401]);
}

async function stockCount({api,db}) {
  const path='/api/p2p/warehouse';
  const lot=db.prepare(`SELECT s.stockLotId lotId,s.locationId,s.qty,m.id materialId,m.stockQty
    FROM StockPlacement s JOIN StockLot l ON l.id=s.stockLotId JOIN Material m ON m.id=l.materialId
    WHERE l.status='available' AND m.unit='kg' AND s.qty>2 ORDER BY s.qty DESC,s.id LIMIT 1`).get();
  assert(lot,'Lot disponible en kg requis');
  const payload={action:'count',lotId:lot.lotId,locationId:lot.locationId,observedQty:lot.qty-1,reason:'Écart fictif constaté en inventaire'};
  const attempts=await Promise.all(['inventory','inventory2'].map(actor=>api(actor,'POST',path,payload,[201,409])));
  assert.deepEqual(attempts.map(x=>x.response.status).sort(),[201,409]);
  const count=attempts.find(x=>x.response.status===201).data.result;
  const decision={action:'approveCount',countId:count.id,approved:true,reason:'Contrôle indépendant du comptage fictif'};
  await api('inventory','POST',path,decision,[403]);
  await api('approver','POST',path,decision,[201]);
  await api('approver','POST',path,decision,[409]);
  assert.equal(db.prepare('SELECT qty FROM StockPlacement WHERE stockLotId=? AND locationId=?').get(lot.lotId,lot.locationId).qty,lot.qty-1);
  assert.equal(db.prepare('SELECT stockQty FROM Material WHERE id=?').get(lot.materialId).stockQty,lot.stockQty-1);
}

async function trade({api,db,date}) {
  const material=db.prepare(`SELECT m.id,m.isSellable,m.stockQty,m.ref FROM Material m
    WHERE m.foamNature='PURE' AND m.unit='bloc' AND m.isPurchasable=1 AND m.isInternalUse=1
    AND m.stockQty BETWEEN 2 AND 4 AND m.stockQty=(SELECT coalesce(sum(l.qty),0) FROM StockLot l
      WHERE l.materialId=m.id AND l.status='available' AND l.expiresAt IS NULL)
    ORDER BY m.id LIMIT 1`).get();
  assert(material,'Bloc de mousse pure achetable et disponible requis');
  if(material.isSellable){
    // AUDIT P5.15.27-B (AN-NEGOCE-01) : après reseed P5.15.23, le bloc PURE
    // sélectionné est DÉJÀ vendable : le PATCH direct du tarif est refusé
    // (DIRECTOR_SALES_PRICE_REQUIRED). Passage par le circuit réel :
    // proposition acheteur → visa directeur distinct, puis synchro catalogue.
    const prop=(await api('buyer','POST','/api/materials/'+material.id+'/sales-price',{
      action:'propose',price:250,reason:'Référence commune achat, atelier et négoce (recette six mois)',
    })).data;
    await api('director','POST','/api/materials/'+material.id+'/sales-price',{
      action:'approve',revision:prop.revision,reason:'Visa directeur : bloc de négoce à 250 MAD pour la recette six mois',
    });
  }else{
    await api('buyer','PATCH','/api/materials/'+material.id,{
      isSellable:true,salesUnit:'bloc',unitsPerSale:1,salesUnitPrice:250,reason:'Référence commune achat, atelier et négoce',
    });
  }
  const product=db.prepare('SELECT id,sku FROM Product WHERE materialId=?').get(material.id);
  assert.equal(product.sku,material.ref);
  assert.equal(db.prepare('SELECT count(*) n FROM Product WHERE materialId=?').get(material.id).n,1);
  const client=db.prepare("SELECT id FROM Client WHERE name='Client fictif six mois'").get();
  const input={clientId:client.id,dueDate:date.slice(0,7)+'-25T09:00:00Z',priority:'normale',
    lines:[{productId:product.id,qty:material.stockQty,unitPrice:250}]};
  await api('sales','POST','/api/orders',{...input,lines:[{...input.lines[0],qty:0.5}]},[400]);
  const orders=[];
  // P6 (2026-11-11) : deux commerciaux saisissent volontairement la même
  // commande (même client, même jour, même signature) — depuis P5.15.29-P5,
  // la seconde exigence passe par la confirmation justifiée documentée,
  // exactement comme l'interface le propose. La contention de RÉSERVATION
  // (cœur du contrôle) reste inchangée : 200/409, une seule unité allouée.
  const createOrder=async(actor,body)=>{
    let r=await api(actor,'POST','/api/orders',body,[200,201,409]);
    if(r.response.status===409&&r.data&&r.data.code==='DUPLICATE_ORDER_POTENTIAL'&&r.data.token)
      r=await api(actor,'POST','/api/orders',{...body,duplicateReview:{token:r.data.token,
        reason:'Commande équivalente confirmée par le second commercial — recette six mois P6'}},[200,201]);
    return r.data.order;
  };
  for(const actor of ['sales','sales2']){
    const order=await createOrder(actor,input);
    // CASCADE3 (11/11/2026) — P1FIX : toute commande négoce naît
    // pending_validation ; le visa commercial quatre-yeux d'un responsable
    // indépendant précède l'état « ready » et la réservation de stock.
    await api('approver','PATCH','/api/orders/'+order.id,{action:'approve',
      comment:'Validation quatre-yeux négoce — recette six mois P6U'});
    const status=db.prepare('SELECT status FROM "Order" WHERE id=?').get(order.id).status;
    assert.equal(status,'ready','Un article de négoce est disponible sans étape de production');
    orders.push({actor,order});
  }
  const simultaneous=await Promise.all(orders.map(({actor,order})=>api(actor,'POST','/api/sales',{
    action:'reserve-stock',orderId:order.id,orderLineId:order.lines[0].id,qty:material.stockQty,
  },[200,409])));
  assert.deepEqual(simultaneous.map(x=>x.response.status).sort(),[200,409]);
  const {actor,order}=orders[simultaneous.findIndex(x=>x.response.status===200)];
  const orderLineId=order.lines[0].id;
  // P5.15.21 (DEF-V-03, contre-audit 08/11/2026) : la commande négoce possède
  // un OF de préparation automatique en brouillon ; il doit être terminé
  // (quatre-yeux, disponibilité vérifiée) avant tout BL.
  const wos=(await api('sales','GET','/api/work-orders?orderId='+order.id)).data.items;
  assert.equal(wos.length,1,'un OF de préparation par ligne négoce');
  // AUDIT P5.15.27-B (AN-NEGOCE-01) : « prepare » est réservé au magasinier
  // (garde RBAC) — l'ancien appel saleschief datait de P5.15.21.
  await api('inventory','PATCH','/api/work-orders/'+wos[0].id,{action:'prepare'});
  const payload={action:'delivery',orderId:order.id,stockLines:[{orderLineId,qty:1}],requestKey:randomUUID()};
  const {delivery}=(await api(actor,'POST','/api/sales',payload)).data;
  const repeat=(await api(actor,'POST','/api/sales',payload,[200])).data;
  assert.equal(repeat.delivery.id,delivery.id);
  assert.equal(repeat.idempotent,true);
  assert.equal(db.prepare('SELECT stockQty FROM Material WHERE id=?').get(material.id).stockQty,material.stockQty-1);
  assert.equal(db.prepare('SELECT count(*) n FROM SalesStockAllocation a JOIN SalesDeliveryLine d ON d.id=a.deliveryLineId WHERE d.orderLineId=?').get(orderLineId).n,1);
  await api(actor,'PATCH','/api/orders/'+order.id,{action:'hold',reason:'Suspension fictive du reliquat de recette'});
  assert.equal(db.prepare('SELECT count(*) n FROM SalesStockReservation WHERE orderLineId=?').get(orderLineId).n,0);
  await api(actor,'POST','/api/sales',{...payload,requestKey:randomUUID()},[409]);
  await api(actor,'PATCH','/api/orders/'+order.id,{action:'resume',reason:'Reprise fictive du reliquat de recette'});
  await api(actor,'PATCH','/api/orders/'+order.id,{action:'close',reason:'Clôture fictive du reliquat de recette'});
  assert.equal(db.prepare('SELECT count(*) n FROM SalesDelivery WHERE orderId=?').get(order.id).n,1);
}

module.exports={accounts,stockCount,trade};
