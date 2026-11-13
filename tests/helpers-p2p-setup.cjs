#!/usr/bin/env node
/* P5.15.8 — Aide de mise en place du circuit de sourcing moderne pour les
 * recettes HTTP. Le schéma actuel exige qu'un BC référence un justificatif
 * tarifaire (sourceType/sourceId) : devis écrit confirmé avec PDF, attribué
 * par un compte DISTINCT du créateur de la consultation (AUTO_ATTRIBUTION
 * interdite). Les recettes V18.x historiques créaient les BC directement ;
 * elles utilisent désormais cet aide pour conserver leurs assertions métier.
 * Aucune règle métier n'est contournée : chaque étape suit l'API réelle. */
'use strict';
const fetch=require('./qa-authenticated-fetch.cjs');

/** Téléverseur PDF minimal vers /api/p2p/offer-documents (Basic auth). */
function pdfUploader(baseUrl, credentialsOf) {
  return async function upload(role, offerId, filename) {
    const u = credentialsOf(role);
    const form = new FormData();
    form.set('offerId', String(offerId));
    form.set('file', new Blob(['%PDF-1.4\n%Recette HTTP GoCmd — piece justificative de devis\n'], { type: 'application/pdf' }), filename);
    const r = await fetch(new URL('/api/p2p/offer-documents', baseUrl), {
      method: 'POST',
      headers: { authorization: 'Basic ' + Buffer.from(`${u.name}:${u.password}`).toString('base64') },
      body: form,
    });
    const value = await r.json().catch(() => null);
    if (r.status !== 201) throw Error(`offer document upload ${r.status}: ${JSON.stringify(value).slice(0, 300)}`);
    return value;
  };
}

/** Circuit complet pour une ligne DA validée :
 * consultation (créateur) → devis écrit + PDF → attribution (compte distinct)
 * → BC référençant le devis. `call` est la fonction api() de la recette
 * (rôle, méthode, chemin, corps, statuts autorisés). Retourne le BC créé et
 * l'offre attribuée. */
async function sourcedOrder({ call, upload, creator, awarder, supplierId, requestLineId, qty, unitPrice, token, note }) {
  const consultation = (await call(creator, 'POST', '/api/p2p/consultations', {
    lines: [{ requestLineId, qty }], supplierIds: [supplierId],
  })).data.consultation;
  if (!consultation?.id) throw Error('consultation non créée');
  const sourcing = (await call(creator, 'GET', '/api/p2p/sourcing?pageSize=150')).data;
  const rfq = sourcing.rfqs.find(r => r.requestLineId === requestLineId && r.status === 'open');
  if (!rfq) throw Error('RFQ ouverte introuvable pour la ligne DA');
  const offer = (await call(creator, 'POST', '/api/p2p/sourcing', {
    action: 'offer', rfqId: rfq.id, supplierId, unitPrice, priceBasis: 'STOCK',
    qty, leadTimeDays: 5, quoteRef: `DEV-${token}`, validUntil: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
    documentRef: `PDF-DEV-${token}`,
  })).data.result;
  if (!offer?.id) throw Error('offre non enregistrée');
  await upload(creator, offer.id, `dev-${token}.pdf`);
  const awarded = await approveOfferPlan({call,creator,awarder,rfqId:rfq.id,offerId:offer.id,qty});
  if (!awarded.data.result?.next) throw Error('attribution non confirmée');
  const order = (await call(creator, 'POST', '/api/supplier-orders', {
    supplierId, note,
    lines: [{ requestLineId, qty, unitPrice, sourceType: 'QUOTE', sourceId: offer.id }],
  })).data.order;
  if (!order?.id) throw Error('BC non créé');
  return { order, offer, consultation };
}

async function approveOfferPlan({call,creator,awarder,rfqId,offerId,qty}) {
  const plan=(await call(creator,'POST','/api/p2p/awards',{
    action:'propose',rfqId,reason:'Attribution documentée pour la recette HTTP isolée',
    allocations:[{offerId,qty}],
  })).data.result;
  return call(awarder,'POST','/api/p2p/awards',{action:'approve',planId:plan.planId});
}
module.exports = { pdfUploader, sourcedOrder, approveOfferPlan };
