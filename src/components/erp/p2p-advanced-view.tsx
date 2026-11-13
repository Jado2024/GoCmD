"use client";
import {useCallback,useEffect,useMemo,useState} from 'react';
import {hasRole,hasPermission,type SessionActor} from '@/lib/role-navigation';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AwardPlanPanel } from "./award-plan-panel";
import { OfferDocuments } from "./offer-documents";
import { ConsultationDialog } from "./consultation-dialog";
import { SupplierResponseFlow, type SupplierResponseOffer, type ResponseAction } from "./supplier-response-flow";
import {riskLabel} from "@/lib/consultation-priority";
import {consultationStatusLabels,type ConsultationPage} from "@/lib/consultation-summary";
import {useQuery} from "@tanstack/react-query";
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from "@/components/ui/dialog";
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from "@/components/ui/table";
import {DocumentPager} from "./document-pager";
import {fmtDate} from "@/lib/erp-types";

type Entry={id:number;category?:string;name?:string;ref?:string;code?:string;invoiceNumber?:string;lotCode?:string;qty?:number;status?:string;rfqId?:number;confirmationStatus?:string;responseChannel?:string;chosen?:boolean;lines?:{id:number;qty:number;unitPrice:number;material?:{name:string}}[];receipts?:{id:number}[]};
type Field={key:string;label:string;kind?:'number'|'date'|'datetime-local'|'select'|'textarea';source?:string;options?:string[];optional?:boolean};
type Action={id:string;title:string;area:'sourcing'|'finance'|'warehouse';fields:Field[]};
// V18.9.10 (UX-029) : libellés français des valeurs brutes d'API (les
// valeurs envoyées au serveur restent inchangées — traduction présentation).
const OPTION_LABELS: Record<string,string> = {
 written:"Devis PDF",email:"Offre e-mail",
  approved:"Approuvé", suspended:"Suspendu", rejected:"Rejeté",
  price:"Prix", quantity:"Quantité", quality:"Qualité", delivery:"Livraison", tax:"Taxe", other:"Autre",
  true:"Oui", false:"Non", STOCK:"Par unité de stock", PURCHASE:"Par unité d’achat (rouleau, carton, lot…)",
  SupplierInvoice:"Facture fournisseur", SupplierOrder:"Bon de commande", GoodsReceipt:"Réception fournisseur", SupplierReturn:"Retour fournisseur",
};
const optionLabel=(v:string)=>OPTION_LABELS[v] ?? v;
const actions:Action[]=[
 {id:'qualify',title:'Qualifier / suspendre un fournisseur',area:'sourcing',fields:[{key:'supplierId',label:'Fournisseur',source:'suppliers',kind:'select'},{key:'status',label:'Décision',kind:'select',options:['approved','suspended','rejected']},{key:'score',label:'Note / 100',kind:'number'},{key:'note',label:'Justification',kind:'textarea'},{key:'expiresAt',label:'Fin de qualification',kind:'date',optional:true}]},
 {id:'rfq',title:'Créer une consultation RFQ',area:'sourcing',fields:[{key:'materialId',label:'Matière',source:'materials',kind:'select'},{key:'requestLineId',label:'Ligne DA approuvée (lier la consultation au besoin)',source:'requestLines',kind:'select'},{key:'qty',label:'Quantité en unité stock',kind:'number'},{key:'deadline',label:'Date limite réponse',kind:'date',optional:true},{key:'targetDate',label:'Date souhaitée',kind:'date',optional:true}]},
 {id:'offer',title:'Saisir une offre fournisseur',area:'sourcing',fields:[{key:'evidenceChannel',label:'Justificatif',kind:'select',options:['written','email'],optional:true},{key:'rfqId',label:'RFQ',source:'rfqs',kind:'select'},{key:'supplierId',label:'Fournisseur',source:'suppliers',kind:'select'},{key:'unitPrice',label:'Prix annoncé (MAD)',kind:'number'},{key:'priceBasis',label:'Ce prix correspond à',kind:'select',options:['STOCK','PURCHASE']},{key:'qty',label:'Quantité proposée',kind:'number'},{key:'leadTimeDays',label:'Délai (jours)',kind:'number'},{key:'paymentTerms',label:'Conditions de paiement',optional:true},{key:'quoteRef',label:'Référence du devis fournisseur'},{key:'validUntil',label:'Offre valable jusqu’au',kind:'date'},{key:'documentRef',label:'Référence du message (obligatoire pour e-mail) ou du PDF',optional:true}]},
 {id:'oralOffer',title:'Enregistrer une offre reçue par téléphone',area:'sourcing',fields:[{key:'calledAt',label:'Date et heure de l’appel (heure locale)',kind:'datetime-local'},{key:'rfqId',label:'RFQ',source:'rfqs',kind:'select'},{key:'supplierId',label:'Fournisseur',source:'suppliers',kind:'select'},{key:'unitPrice',label:'Prix annoncé (MAD)',kind:'number'},{key:'priceBasis',label:'Ce prix correspond à',kind:'select',options:['STOCK','PURCHASE']},{key:'qty',label:'Quantité annoncée',kind:'number'},{key:'leadTimeDays',label:'Délai annoncé (jours)',kind:'number'},{key:'contactName',label:'Interlocuteur du fournisseur'},{key:'callSummary',label:'Compte rendu de l’appel (min. 10 caractères)',kind:'textarea'},{key:'paymentTerms',label:'Conditions annoncées',optional:true}]},
 {id:'validatePhoneOffer',title:'Valider une offre téléphonique sans PDF',area:'sourcing',fields:[{key:'offerId',label:'Offre téléphonique',source:'offers',kind:'select'},{key:'validUntil',label:'Validité annoncée par le fournisseur',kind:'date'},{key:'validationNote',label:'Justification de la validation (10 caractères minimum)',kind:'textarea'}]},
 {id:'confirmOffer',title:'Confirmer par écrit une offre téléphonique',area:'sourcing',fields:[{key:'offerId',label:'Offre orale à confirmer',source:'offers',kind:'select'},{key:'quoteRef',label:'Référence écrite du devis'},{key:'validUntil',label:'Validité du devis',kind:'date'},{key:'documentRef',label:'Référence écrite (facultatif)',optional:true}]},
 {id:'agreement',title:'Proposer un prix contractuel (accord formalisé)',area:'sourcing',fields:[{key:'supplierId',label:'Fournisseur',source:'suppliers',kind:'select'},{key:'materialId',label:'Matière',source:'materials',kind:'select'},{key:'contractRef',label:'Référence du contrat'},{key:'documentRef',label:'Référence du justificatif contractuel'},{key:'unitPrice',label:'Prix contractuel annoncé (MAD)',kind:'number'},{key:'priceBasis',label:'Ce prix correspond à',kind:'select',options:['STOCK','PURCHASE']},{key:'validFrom',label:'Début de validité',kind:'date'},{key:'validUntil',label:'Fin de validité',kind:'date'}]},
 {id:'approveAgreement',title:'Approuver un contrat (autre responsable)',area:'sourcing',fields:[{key:'agreementId',label:'Accord en attente',source:'pendingAgreements',kind:'select'}]},
 {id:'revokeAgreement',title:'Révoquer un tarif contractuel',area:'sourcing',fields:[{key:'agreementId',label:'Accord approuvé',source:'approvedAgreements',kind:'select'},{key:'reason',label:'Motif (10 caractères minimum)',kind:'textarea'}]},
 {id:'reviseOffer',title:'Réviser un devis (nouvelle version, nouvelles preuves)',area:'sourcing',fields:[{key:'calledAt',label:'Date et heure du nouvel appel (si oral)',kind:'datetime-local',optional:true},{key:'documentRef',label:'Référence du nouveau message (offre e-mail)',optional:true},{key:'offerId',label:'Offre à réviser',source:'offers',kind:'select'},{key:'reason',label:'Justification de la révision',kind:'textarea'},{key:'unitPrice',label:'Nouveau prix annoncé',kind:'number'},{key:'priceBasis',label:'Base du prix',kind:'select',options:['STOCK','PURCHASE']},{key:'qty',label:'Quantité nouvelle',kind:'number'},{key:'leadTimeDays',label:'Délai',kind:'number'},{key:'paymentTerms',label:'Conditions de paiement',optional:true},{key:'quoteRef',label:'Référence devis écrit (si écrit)',optional:true},{key:'validUntil',label:'Valable jusqu’au (si écrit)',kind:'date',optional:true},{key:'contactName',label:'Interlocuteur (si oral)',optional:true},{key:'callSummary',label:'Nouveau compte rendu (si oral)',kind:'textarea',optional:true}]},
 {id:'schedule',title:'Planifier une livraison fournisseur',area:'sourcing',fields:[{key:'orderId',label:'Bon de commande',source:'orders',kind:'select'},{key:'targetDate',label:'Date attendue',kind:'date'},{key:'plannedQty',label:'Quantité prévue',kind:'number',optional:true},{key:'note',label:'Note',optional:true}]},
 {id:'revision',title:'Réviser un BC (réapprobation obligatoire)',area:'sourcing',fields:[{key:'orderId',label:'BC sans BR',source:'orders',kind:'select'},{key:'reason',label:'Motif',kind:'textarea'},{key:'lines',label:'Lignes du bon de commande (grille éditable)'}]},
 {id:'warehouse',title:'Créer un dépôt',area:'warehouse',fields:[{key:'code',label:'Code majuscules'},{key:'name',label:'Nom'}]},
 {id:'location',title:'Créer un emplacement',area:'warehouse',fields:[{key:'warehouseId',label:'Dépôt',source:'warehouses',kind:'select'},{key:'code',label:'Code emplacement'},{key:'name',label:'Nom'}]},
 {id:'transfer',title:'Transférer physiquement un lot',area:'warehouse',fields:[{key:'lotId',label:'Lot',source:'lots',kind:'select'},{key:'fromId',label:'Emplacement source',source:'locations',kind:'select'},{key:'toId',label:'Destination',source:'locations',kind:'select'},{key:'qty',label:'Quantité',kind:'number'},{key:'reason',label:'Motif'}]},
 {id:'count',title:'Constater un écart inventaire (ne modifie pas le stock)',area:'warehouse',fields:[{key:'lotId',label:'Lot',source:'lots',kind:'select'},{key:'locationId',label:'Emplacement',source:'locations',kind:'select'},{key:'observedQty',label:'Quantité comptée',kind:'number'},{key:'reason',label:'Motif',kind:'textarea'}]},
 {id:'approveCount',title:'Approuver / refuser un comptage (autre responsable)',area:'warehouse',fields:[{key:'countId',label:'Comptage en attente',source:'counts',kind:'select'},{key:'approved',label:'Approuver ?',kind:'select',options:['true','false']},{key:'reason',label:'Motif de décision',kind:'textarea'}]},
 {id:'credit',title:'Enregistrer un avoir fournisseur',area:'finance',fields:[{key:'invoiceId',label:'Facture approuvée',source:'invoices',kind:'select'},{key:'returnId',label:'Retour fournisseur (optionnel)',kind:'number',optional:true},{key:'amount',label:'Montant avoir MAD',kind:'number'},{key:'reason',label:'Motif',kind:'textarea'}]},
 {id:'dispute',title:'Ouvrir un litige fournisseur',area:'finance',fields:[{key:'supplierId',label:'Fournisseur',source:'suppliers',kind:'select'},{key:'entityType',label:'Type document',kind:'select',options:['SupplierInvoice','SupplierOrder','GoodsReceipt','SupplierReturn']},{key:'entityId',label:'Identifiant document',kind:'number'},{key:'category',label:'Cause',kind:'select',options:['price','quantity','quality','delivery','tax','other']},{key:'reason',label:'Description',kind:'textarea'}]},
 {id:'resolve',title:'Clôturer un litige',area:'finance',fields:[{key:'disputeId',label:'Litige',source:'disputes',kind:'select'},{key:'resolution',label:'Décision et justificatif',kind:'textarea'}]}
];
const urlFor={sourcing:'/api/p2p/sourcing',warehouse:'/api/p2p/warehouse',finance:'/api/p2p/finance'};
async function json(url:string,signal?:AbortSignal){const r=await fetch(url,{cache:'no-store',signal});const d=await r.json();if(!r.ok)throw Error(d.error||`HTTP ${r.status}`);return d}
const AREA_LABELS: Record<Action['area'],string>={sourcing:'Consultations & fournisseurs',warehouse:'Dépôts & stock',finance:'Avoirs & litiges'};
export function P2PAdvancedView(){
 const [consultationPage,setConsultationPage]=useState(1);
 const defaultFilters={search:'',category:'all',supplierId:'all',status:'all',contractStatus:'all',priority:'all',sort:'urgency',from:'',to:''};
 const [draftFilters,setDraftFilters]=useState(defaultFilters);
 const [appliedFilters,setAppliedFilters]=useState(defaultFilters);
 const [selectedConsultation,setSelectedConsultation]=useState<number|null>(null);
 const filterParams=useMemo(()=>{const params=new URLSearchParams();for(const [key,value] of Object.entries(appliedFilters))if(value&&value!=='all')params.set(key,value);return params.toString()},[appliedFilters]);
 const [rfqPage,setRfqPage]=useState(1);
 const [warehousePage,setWarehousePage]=useState(1); // premières 100 DA; pour les anciennes, utiliser le filtre/pagination de la vue DA
 const [multiDAOpen,setMultiDAOpen]=useState(false);
 const [showAdvanced,setShowAdvanced]=useState(false);
 const [current,setCurrent]=useState<Action>(actions[0]);
 const sessionQ=useQuery<SessionActor>({queryKey:['me'],queryFn:({signal})=>json('/api/me',signal)});
 const session=sessionQ.data??null;
 const [contextOptions,setContextOptions]=useState<Record<string,Entry[]>>({});const [loading,setLoading]=useState(true);const [loadErrors,setLoadErrors]=useState<string[]>([]);const [revisionLines,setRevisionLines]=useState<{id:number;name:string;qty:string;unitPrice:string}[]>([]);const [values,setValues]=useState<Record<string,string>>({});const [data,setData]=useState<Record<string,Entry[]>>({});const [summary,setSummary]=useState<Record<string,unknown>>({});const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [success,setSuccess]=useState('');
 const allowed=(area:Action['area'],id?:string,actor:SessionActor|null=session)=>{
  if(area==='finance')return hasRole(actor,'finance');
  if(area==='warehouse')return id==='approveCount'?hasRole(actor,'approver'):hasRole(actor,'inventory');
  return ['qualify','revision','approveAgreement','revokeAgreement'].includes(id??'')?hasRole(actor,'approver'):hasRole(actor,'buyer');
 };
 // Récupération pure des données : aucun setState ici, la règle
 // react-hooks/set-state-in-effect impose d'appliquer l'état dans la suite
 // asynchrone (.then) et non dans un appel synchrone depuis l'effet.
 const load=useCallback(async():Promise<{identity:SessionActor|null;mapped:Record<string,any>;warnings:string[]}>=>{
  const identity=session;
  const urls:[string,string][]=[['overview','/api/p2p/overview?view=summary']];
  if(current.area==='sourcing'||showAdvanced)urls.push(['suppliers','/api/suppliers']);
  if(showAdvanced&&current.area==='sourcing')urls.push(
    ['rfq',`${urlFor.sourcing}?page=${rfqPage}&pageSize=30`],['orders','/api/supplier-orders']);
  if(current.area==='warehouse')urls.push(
    ['warehouse',`${urlFor.warehouse}?page=${warehousePage}&pageSize=100`],['lots','/api/stock-lots']);
  if(current.area==='finance')urls.push(['finance',urlFor.finance],['suppliers','/api/suppliers']);
  const responses=await Promise.allSettled(urls.map(([,u])=>json(u)));
  const mapped:Record<string,any>={};
  const warnings:string[]=[];
  responses.forEach((r,i)=>{if(r.status==='fulfilled')mapped[urls[i][0]]=r.value;else warnings.push(`${urls[i][0]} : ${r.reason instanceof Error?r.reason.message:'chargement impossible'}`)});
  return{identity,mapped,warnings};
 },[rfqPage,warehousePage,session,current.area,showAdvanced]);
 const applyLoaded=useCallback((s:{identity:SessionActor|null;mapped:Record<string,any>;warnings:string[]})=>{
  setCurrent(previous=>{const permitted=(a:Action)=>a.area==='finance'?hasRole(s.identity,'finance'):a.area==='warehouse'?(a.id==='approveCount'?hasRole(s.identity,'approver'):hasRole(s.identity,'inventory')):['qualify','revision','approveAgreement','revokeAgreement'].includes(a.id)?hasRole(s.identity,'approver'):hasRole(s.identity,'buyer');return permitted(previous)?previous:actions.find(permitted)??previous});
  const su=s.mapped.suppliers??{},r=s.mapped.rfq??{},w=s.mapped.warehouse??{},o=s.mapped.orders??{},l=s.mapped.lots??{},fi=s.mapped.finance??{};
  setData({suppliers:su.items??[],materials:su.materials??[],offers:(r.rfqs??[]).flatMap((rfq:{id:number;ref:string;offers?:{id:number;rfqId:number;confirmationStatus?:string;responseChannel?:string;chosen:boolean;supplier?:{name:string};unitPrice:unknown;quoteRef?:string|null}[]})=>(rfq.offers??[]).map(o=>({id:o.id,rfqId:rfq.id,confirmationStatus:o.confirmationStatus,responseChannel:o.responseChannel,chosen:o.chosen,name:`${rfq.ref} · ${o.supplier?.name??"Fournisseur"} · ${o.unitPrice} MAD · ${o.quoteRef??"Offre orale"}`}))),rfqs:(r.rfqs??[]).map((v:{id:number;ref:string})=>({...v,name:v.ref})),requestLines:(o.candidates??[]).map((c:{requestLineId:number;requestRef:string;materialName:string;available:number;unit:string})=>({id:c.requestLineId,name:`${c.requestRef} — ${c.materialName} (${c.available} ${c.unit})`})),pendingAgreements:(r.agreements??[]).filter((a:{status:string})=>a.status==='pending').map((a:{id:number;contractRef:string;supplier:{name:string}})=>({...a,name:`${a.contractRef} — ${a.supplier.name}`})),approvedAgreements:(r.agreements??[]).filter((a:{status:string})=>a.status==='approved').map((a:{id:number;contractRef:string;supplier:{name:string}})=>({...a,name:`${a.contractRef} — ${a.supplier.name}`})),warehouses:w.warehouses??[],locations:(w.warehouses??[]).flatMap((x:{locations?:Entry[]})=>x.locations??[]),lots:l.items??[],orders:o.items??[],invoices:(fi.balances??[]).map((v:{invoiceId:number})=>({id:v.invoiceId,ref:`Facture #${v.invoiceId}`})),disputes:fi.disputes??[],counts:(w.counts??[]).filter((c:{status:string})=>c.status==='pending')});
  setSummary(s.mapped);setLoadErrors(s.warnings);setLoading(false);
 },[]);
 useEffect(()=>{
  if(!session)return;
  let active=true;
  load().then(s=>{if(active)applyLoaded(s)}).catch(()=>{});
  return()=>{active=false};
 },[load,applyLoaded,session]);
 const options=useMemo(()=>current.fields.map(f=>{
  const context=f.source?contextOptions[f.source]??[]:[];
  const available=f.source?data[f.source]??[]:[];
  return {key:f.key,values:[...context,...available.filter(x=>!context.some(p=>p.id===x.id))]};
 }),[current,data,contextOptions]);
 async function submit(e:React.FormEvent){e.preventDefault();setError('');setSuccess('');setBusy(true);
  try{if(!allowed(current.area,current.id))throw Error('Action réservée à un autre rôle');const payload:Record<string,unknown>={action:current.id};for(const field of current.fields){if(field.key==='lines'&&current.id==='revision'){if(!revisionLines.length)throw Error('Choisir un BC avec des lignes');const lines=revisionLines.map(l=>({id:l.id,qty:Number(l.qty),unitPrice:Number(l.unitPrice)}));if(lines.some(l=>!Number.isFinite(l.qty)||l.qty<=0||!Number.isFinite(l.unitPrice)||l.unitPrice<0))throw Error('Quantité positive et prix valide obligatoires');payload.lines=lines;continue}const raw=(values[field.key]||'').trim();if(!raw){if(field.optional)continue;throw Error(`${field.label} obligatoire`)}if(field.key==='lines'){payload[field.key]=JSON.parse(raw)}else if(field.key==='approved')payload[field.key]=raw==='true';else if(field.kind==='datetime-local')payload[field.key]=new Date(raw).toISOString();else if(field.kind==='number'||field.source)payload[field.key]=Number(raw);else payload[field.key]=raw}
   const r=await fetch(urlFor[current.area],{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const out=await r.json();if(!r.ok)throw Error(out.error||'Action refusée');setSuccess(`Action ${current.title} enregistrée`);setValues({});setRevisionLines([]);await load().then(applyLoaded);void consultationList.refetch();
  }catch(e){setError(e instanceof Error?e.message:'Erreur')}finally{setBusy(false)}
 }
 // Ajustement pendant le rendu (pattern React officiel) : la grille de
 // révision se recalcule quand l'action, le BC choisi ou les données serveur
 // changent — sans effet ni setState synchrone dans un effet.
 const [gridKey,setGridKey]=useState('')
 const [gridOrders,setGridOrders]=useState<Entry[]|undefined>(undefined)
 if(current.id!=='revision'?gridKey!=='':gridKey!==(values.orderId||'')||data.orders!==gridOrders){
  setGridKey(current.id==='revision'?(values.orderId||''):'')
  setGridOrders(data.orders)
  const selected=current.id==='revision'?data.orders?.find(o=>o.id===Number(values.orderId)):undefined;
  setRevisionLines((selected?.lines??[]).map(l=>({id:l.id,name:l.material?.name??`Ligne #${l.id}`,qty:String(l.qty),unitPrice:String(l.unitPrice)})))
 }
 const overview=summary.overview as {overdue?:{ref:string;supplier:string;remaining:number}[];openSupplierOrders?:number;overdueCount?:number;openDisputes?:number;openRFQs?:number;legacyLotsToCount?:number;quarantine?:number}|undefined;
 const sourceSummary=summary.rfq as {rfqs?:{id:number;ref:string;status:string;offers?:{id:number;supplier?:{name:string};unitPrice:string;leadTimeDays:number;quoteRef?:string|null;validUntil?:string|null;chosen:boolean;confirmationStatus?:string;responseChannel?:string;attachments?:{id:number;originalName:string;bytes:number}[]}[]}[];agreements?:{id:number;contractRef:string;documentRef:string;status:string;createdBy:string;approvedBy?:string|null;supplier:{name:string};material:{name:string};unitPrice:string;validFrom:string;validUntil:string}[]}|undefined;
 type ConsultationDetail = {id:number;ref:string;createdAt:string;deadline:string|null;lines:{rfqId:number;ref:string;materialId:number;material:{name:string;ref:string;category:string;unit:string;stockQty:number;minStock:number};qty:number;status:string;targetDate:string|null;awardPlans:{id:number;status:string;proposedBy:string;decidedBy:string|null;reason:string|null;decisionNote:string|null;lines:{sourceType?:'QUOTE'|'CONTRACT';sourceId?:number;offerId:number|null;supplierId:number;qty:number;unitPrice:string|null;ref?:string|null}[]}[];contracts:{id:number;supplierName:string;contractRef:string;documentRef:string;unitPrice:string;validFrom:string;validUntil:string;leadTimeDays:number|null;purchaseUnit:string|null;paymentTerms:string|null;status:string}[];offers:SupplierResponseOffer[]}[];recipients:{supplierId:number;name:string;active:boolean;email:string|null;phone:string|null;materialIds:number[];responses:{rfqId:number;status:string;reminderCount:number;lastReminderAt:string|null;declineReason:string|null}[]}[]};
 const consultationList=useQuery<ConsultationPage>({
  queryKey:['p2p-consultations',consultationPage,filterParams],
  queryFn:({signal})=>json(`/api/p2p/consultations?view=summary&page=${consultationPage}&pageSize=40&${filterParams}`,signal),
  enabled:!!session&&current.area==='sourcing',
 });
 const consultationDetails=useQuery<{items:ConsultationDetail[];costVisible:boolean}>({
  queryKey:['p2p-consultation-detail',selectedConsultation],
  queryFn:({signal})=>json(`/api/p2p/consultations?id=${selectedConsultation}&pageSize=1&sort=recent`,signal),
  enabled:selectedConsultation!==null,
 });
 const consultations=consultationList.data?.items??[];
 const c=consultationDetails.data?.items[0];
 const categories=Array.from(new Set((data.materials??[]).map(m=>m.category).filter((x):x is string=>!!x))).sort((a,b)=>a.localeCompare(b,'fr'));
 const supplierOptions=(data.suppliers??[]).filter(s=>!!s.name).sort((a,b)=>(a.name??'').localeCompare(b.name??'','fr'));
 const consultationAlerts=consultations.filter(c=>c.risk==='rupture').length;
 const consultPaging=consultationList.data?.pagination;
 const rfqPaging=(summary.rfq as {pagination?:{total:number;hasMore:boolean}}|undefined)?.pagination;
 const warehousePaging=(summary.warehouse as {pagination?:{countTotal:number;hasMoreCounts:boolean}}|undefined)?.pagination;
 const consultationCostsVisible=consultationDetails.data?.costVisible===true;
 function openResponseAction(action:ResponseAction,prefill:Record<string,string>){
  const found=actions.find(a=>a.id===action);if(!found)return;
  setContextOptions({
    rfqs:c?.lines.map(l=>({id:l.rfqId,name:`${l.ref} · ${l.material.name}`}))??[],
    offers:c?.lines.flatMap(l=>l.offers.map(o=>({
      id:o.id,rfqId:l.rfqId,name:`${o.supplierName} · ${o.quoteRef??l.ref}`,
      confirmationStatus:o.confirmationStatus,responseChannel:o.responseChannel,chosen:o.chosen,
    })))??[],
    suppliers:c?.recipients.map(r=>({id:r.supplierId,name:r.name}))??[],
  });
  setSelectedConsultation(null);setShowAdvanced(true);setCurrent(found);setValues(prefill);setError('');setSuccess('');
  requestAnimationFrame(()=>requestAnimationFrame(()=>document.getElementById('p2p-action')?.scrollIntoView({behavior:'smooth',block:'center'})));
 }
 function reloadResponses(){void consultationList.refetch();if(selectedConsultation!==null)void consultationDetails.refetch();void load().then(applyLoaded).catch(()=>{});}
 const [consultationNotice,setConsultationNotice]=useState('');
 async function noteSupplier(rfqId:number,supplierId:number,action:'contacted'|'reminded'|'declined'){
  const reason=action==='declined'?window.prompt('Motif de refus fournisseur (au moins 10 caractères)')??'':undefined;
  if(action==='declined'&&(!reason||reason.length<10)){setConsultationNotice('Le refus doit être justifié (10 caractères minimum).');return;}
  try{const r=await fetch('/api/p2p/consultation-responses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rfqId,supplierId,action,reason})});const d=await r.json();if(!r.ok)throw Error(d.error);setConsultationNotice(action==='declined'?'Refus enregistré':action==='reminded'?'Relance consignée (aucun envoi automatique)':'Contact enregistré');reloadResponses();}catch(e){setConsultationNotice(e instanceof Error?e.message:'Erreur');}
 }
 const rfqs=sourceSummary?.rfqs||[];
 const agreements=sourceSummary?.agreements||[];
 return <div className="space-y-5">
  {/* V18.9.10 (UX-018) : squelettes de chargement (avant : texte brut). */}
  {loading&&<div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[0,1,2,3].map(i=><Skeleton key={i} className="h-24 rounded-lg"/>)}</div>}
  {!loading&&<div className="grid grid-cols-2 gap-3 md:grid-cols-4">{(hasRole(session,'buyer')&&!hasRole(session,'finance')&&!hasRole(session,'inventory') ? [['BC en retard',overview?.overdueCount??0],['RFQ ouvertes',overview?.openRFQs||0],['Consultations (page)',consultations.length],['BC à suivre',overview?.openSupplierOrders??'—']] : [['BC en retard',overview?.overdueCount??0],['RFQ ouvertes',overview?.openRFQs||0],['Litiges ouverts',overview?.openDisputes||0],['Lots historiques non vérifiés',overview?.legacyLotsToCount||0]]).map(([n,v])=><div key={String(n)} className="rounded-lg border bg-white p-4"><div className="text-xs text-slate-500">{n}</div><div className="text-2xl font-semibold">{summary.overview? v:'—'}</div></div>)}</div>}
  {loading&&<Skeleton className="h-64 rounded-lg"/>}
  {!loading&&<>{loadErrors.length>0&&<div role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">Certaines données sont indisponibles : {loadErrors.join(' ; ')}. Les indicateurs non chargés sont affichés « — ».</div>}
  {/* V18.9.10 (UX-030/UX-005) : onglets de domaine avec état actif visible +
      aria-current ; boutons du design system (avant : natifs bg-slate-800). */}
  <div className="flex flex-wrap gap-2" role="tablist" aria-label="Domaines du pilotage achats">
    {(['sourcing','warehouse','finance'] as const).filter(area=>(area==='sourcing'?(allowed(area,'rfq')||allowed(area,'qualify')):allowed(area,area==='warehouse'?'warehouse':'credit'))).map(area=>{
      const active=current.area===area
      return <Button key={area} variant={active?"primary":"outline"} aria-current={active?"page":undefined} onClick={()=>{setCurrent(actions.find(a=>a.area===area&&allowed(a.area,a.id))!);setValues({});setError('');setSuccess('')}}>{AREA_LABELS[area]}</Button>
    })}
    {hasRole(session,"finance")&&hasPermission(session,"finance.export")&&<Button variant="outline" asChild><a href="/api/p2p/overview?format=csv">Export factures CSV</a></Button>}
    <Button variant="outline" onClick={()=>{load().then(applyLoaded).catch(()=>{})}}>Actualiser</Button>
  </div>
  {current.area==='sourcing'&&<section className="space-y-4 rounded-lg border bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Dossiers de consultation</h2>
      <p className="text-sm text-slate-600">Pour chaque matière : comparer les prix, enregistrer les réponses et prioriser les ruptures. Une offre téléphonique est validable par l’acheteur sans PDF, puis attribuée par un autre responsable. Aucun email n’est envoyé automatiquement.</p></div>
      {hasRole(session,"buyer")&&<Button variant="primary" className="h-auto min-h-9 max-w-full whitespace-normal" onClick={()=>setMultiDAOpen(true)}>Nouvelle consultation multi-DA</Button>}</div>
    <form className="grid min-w-0 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={e=>{e.preventDefault();setConsultationPage(1);setAppliedFilters({...draftFilters})}} aria-label="Rechercher et prioriser les consultations">
      <label className="text-xs font-medium text-slate-700">Consultation, DA, matière ou fournisseur
        <Input className="mt-1 bg-white" value={draftFilters.search} maxLength={100} onChange={e=>setDraftFilters(f=>({...f,search:e.target.value}))} placeholder="CONS-…, DA-…, colle…"/></label>
      <label className="text-xs font-medium text-slate-700">Famille de matière
        <Select value={draftFilters.category} onValueChange={v=>setDraftFilters(f=>({...f,category:v}))}><SelectTrigger className="mt-1 bg-white"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">Toutes les familles</SelectItem>{categories.map(v=><SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></label>
      <label className="text-xs font-medium text-slate-700">Société / fournisseur
        <Select value={draftFilters.supplierId} onValueChange={v=>setDraftFilters(f=>({...f,supplierId:v}))}><SelectTrigger className="mt-1 bg-white"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">Tous les fournisseurs</SelectItem>{supplierOptions.map(v=><SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}</SelectContent></Select></label>
      <label className="text-xs font-medium text-slate-700">Couverture par contrat
        <Select value={draftFilters.contractStatus} onValueChange={v=>setDraftFilters(f=>({...f,contractStatus:v}))}><SelectTrigger className="mt-1 bg-white"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">Tous les articles</SelectItem><SelectItem value="contract">Au moins une matière sous contrat valide</SelectItem><SelectItem value="no_contract">Aucune matière sous contrat valide</SelectItem></SelectContent></Select></label>
      <label className="text-xs font-medium text-slate-700">Risque / rupture
        <Select value={draftFilters.priority} onValueChange={v=>setDraftFilters(f=>({...f,priority:v}))}><SelectTrigger className="mt-1 bg-white"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">Tous les niveaux</SelectItem><SelectItem value="rupture">Rupture de stock</SelectItem><SelectItem value="low_stock">Sous le stock minimum</SelectItem><SelectItem value="due_soon">Échéance ≤ 3 jours</SelectItem></SelectContent></Select></label>
      <label className="text-xs font-medium text-slate-700">État de la consultation
        <Select value={draftFilters.status} onValueChange={v=>setDraftFilters(f=>({...f,status:v}))}><SelectTrigger className="mt-1 bg-white"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">Tous les statuts</SelectItem><SelectItem value="no_response">Sans réponse</SelectItem><SelectItem value="pending_validation">Offre orale à valider</SelectItem><SelectItem value="pending_approval">Validation responsable attendue</SelectItem><SelectItem value="open">Ouverte</SelectItem><SelectItem value="awarded">Avec attribution</SelectItem><SelectItem value="closed">Clôturée</SelectItem></SelectContent></Select></label>
      <label className="text-xs font-medium text-slate-700">Trier les résultats
        <Select value={draftFilters.sort} onValueChange={v=>setDraftFilters(f=>({...f,sort:v}))}><SelectTrigger className="mt-1 bg-white"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="urgency">Urgence / rupture d’abord</SelectItem><SelectItem value="due_date">Date du besoin</SelectItem><SelectItem value="recent">Plus récentes</SelectItem><SelectItem value="stock_risk">Risque de stock uniquement</SelectItem><SelectItem value="material">Matière A–Z</SelectItem><SelectItem value="supplier">Fournisseur A–Z</SelectItem></SelectContent></Select></label>
      <label className="text-xs font-medium">Créée à partir du
        <Input type="date" className="mt-1 bg-white" value={draftFilters.from} max={draftFilters.to||undefined} onChange={e=>setDraftFilters(f=>({...f,from:e.target.value}))}/>
      </label>
      <label className="text-xs font-medium">Créée jusqu’au
        <Input type="date" className="mt-1 bg-white" value={draftFilters.to} min={draftFilters.from||undefined} onChange={e=>setDraftFilters(f=>({...f,to:e.target.value}))}/>
      </label>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3"><Button type="submit" variant="primary" size="sm">Appliquer les filtres</Button><Button type="button" size="sm" variant="outline" onClick={()=>{setDraftFilters({...defaultFilters});setAppliedFilters({...defaultFilters});setConsultationPage(1)}}>Réinitialiser</Button><span className="text-xs text-slate-600">{consultPaging?.total??0} dossier(s) correspondant(s) · {consultationAlerts} rupture(s) sur cette page</span></div>
    </form>
    {consultationList.isPending&&<Skeleton className="h-36 w-full" aria-label="Chargement des consultations"/>}
    {consultationList.isError&&<p role="alert" className="text-sm text-rose-800">{consultationList.error.message} <Button size="sm" variant="outline" onClick={()=>void consultationList.refetch()}>Réessayer</Button></p>}
    {consultationList.isSuccess&&consultations.length===0&&<p className="text-sm text-slate-500">Aucun dossier pour cette page et ces filtres.</p>}
    {consultationNotice&&<p role="status" className="rounded bg-slate-50 p-2 text-xs">{consultationNotice}</p>}
    {consultations.length>0&&<div className="min-w-0">
      <p className="mb-2 text-xs text-slate-600 lg:hidden">Faites défiler le tableau pour voir toutes les colonnes.</p>
      <div className="min-w-0 rounded-md border">
        <Table className="min-w-[760px]" scrollLabel="Liste des dossiers de consultation">
          <TableHeader><TableRow>{['Consultation','DA liées','Matières','Fournisseurs / offres','Date limite','État / priorité'].map(label=><TableHead key={label} scope="col">{label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{consultations.map(item=><TableRow key={item.id}>
            <TableCell><Button variant="link" className="h-8 p-0 font-mono" aria-label={`Ouvrir ${item.ref}`} onClick={()=>setSelectedConsultation(item.id)}>{item.ref}</Button><p className="text-xs text-slate-500">{fmtDate(item.createdAt)}</p></TableCell>
            <TableCell className="max-w-32 whitespace-normal">{item.requestRefs.slice(0,2).join(', ')||'—'}{item.requestRefs.length>2&&` +${item.requestRefs.length-2}`}</TableCell>
            <TableCell className="max-w-52 whitespace-normal">{item.materials.slice(0,2).join(', ')}{item.materials.length>2&&` +${item.materials.length-2}`}</TableCell>
            <TableCell className="tabular-nums">{item.supplierCount} fournisseur(s)<p className="text-xs text-slate-500">{item.offerCount} offre(s)</p></TableCell>
            <TableCell>{fmtDate(item.deadline)}</TableCell>
            <TableCell><strong className="text-xs">{consultationStatusLabels[item.status]}</strong><p className={item.risk==='rupture'?'text-xs text-rose-800':'text-xs text-slate-600'}>{riskLabel[item.risk]}</p></TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </div>
    </div>}
    <Dialog open={selectedConsultation!==null} onOpenChange={open=>{if(!open)setSelectedConsultation(null)}}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden sm:max-w-5xl">
       <DialogHeader><DialogTitle>{c?.ref??'Dossier de consultation'}</DialogTitle><DialogDescription>Comparer les offres, consulter les pièces et suivre les décisions.</DialogDescription></DialogHeader>
       {consultationDetails.isPending&&<Skeleton className="h-32 w-full"/>}
       {consultationDetails.isError&&<p role="alert" className="text-sm text-rose-800">{consultationDetails.error.message} <Button variant="outline" onClick={()=>void consultationDetails.refetch()}>Réessayer</Button></p>}
       {consultationDetails.isSuccess&&!c&&<p>Dossier introuvable.</p>}
       {c&&<div className="min-h-0 space-y-4 overflow-y-auto pr-1">
      {c.lines.map(l=><AwardPlanPanel key={`award-${l.rfqId}`} rfqId={l.rfqId} rfqStatus={l.status} material={l.material.name} unit={l.material.unit} qty={l.qty} offers={l.offers} contracts={l.contracts} plans={l.awardPlans} canPropose={allowed('sourcing','offer')} canApprove={hasRole(session,'approver')} canSeePrices={consultationCostsVisible} onUpdated={reloadResponses}/>)}
      {c.recipients.map(s=><div key={s.supplierId} className="rounded-lg border bg-white p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{s.name}</strong><div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm"><a target="_blank" rel="noopener noreferrer" href={`/api/p2p/consultations/${c.id}/pdf?supplierId=${s.supplierId}`}>Télécharger PDF</a></Button>
          {s.active&&s.email?<Button asChild variant="outline" size="sm"><a href={`mailto:${encodeURIComponent(s.email)}?subject=${encodeURIComponent('SODEPI — Demande de prix '+c.ref)}&body=${encodeURIComponent('Bonjour,\n\nVeuillez trouver ci-joint la demande de prix '+c.ref+'. Merci de nous adresser votre offre en précisant prix, délais et conditions.\n\nCordialement,\nService achats SODEPI')}`}>Préparer email</a></Button>:<span className="self-center text-xs text-amber-700">{s.active?'Email manquant':'Fournisseur suspendu'}</span>}
         </div></div>
        <div className="space-y-3">{c.lines.filter(l=>s.responses.some(r=>r.rfqId===l.rfqId)).map(l=><SupplierResponseFlow key={l.rfqId}
          rfqId={l.rfqId} rfqStatus={l.status} material={l.material.name} qty={l.qty} unit={l.material.unit}
          supplierId={s.supplierId} supplierName={s.name} supplierPhone={s.phone}
          offers={l.offers.filter(o=>o.supplierId===s.supplierId)} canRecord={allowed('sourcing','oralOffer')}
          canAward={hasRole(session,'approver')} canSeePrices={consultationCostsVisible}
          responseStatus={s.responses.find(r=>r.rfqId===l.rfqId)?.status??'invited'} reminderCount={s.responses.find(r=>r.rfqId===l.rfqId)?.reminderCount??0} onStatus={action=>void noteSupplier(l.rfqId,s.supplierId,action)} onAction={openResponseAction} onUpdated={reloadResponses}/>)}</div>
      </div>)}
      <p className="text-[11px] text-slate-500">Un PDF natif est téléchargeable par fournisseur. Joignez-le manuellement à l’email préparé ; aucun envoi automatique.</p>
       </div>}
      </DialogContent>
    </Dialog>
    <DocumentPager page={consultationPage} data={consultPaging} onPage={setConsultationPage} label="Consultations"/>
  </section>}
  {multiDAOpen&&<ConsultationDialog onClose={()=>{setMultiDAOpen(false);reloadResponses()}}/>}
  {current.area==='sourcing'&&<Button variant="outline" className="h-auto min-h-9 max-w-full whitespace-normal text-left" onClick={()=>setShowAdvanced(v=>!v)}>{showAdvanced?'Masquer les opérations avancées':'Afficher les opérations avancées (devis, contrats, qualification)'}</Button>}
  {(current.area!=='sourcing'||showAdvanced)&&  <section className="rounded-lg border bg-white p-4"><h2 className="text-lg font-semibold">Gestion avancée des achats et stocks</h2><p className="mb-4 text-sm text-slate-500">Chaque action est contrôlée par les permissions du compte. Les BC révisés doivent être approuvés à nouveau.</p>
    <label className="mb-3 block max-w-md text-sm font-medium" htmlFor="p2p-action">Opération
      <Select value={current.id} onValueChange={v=>{setCurrent(actions.find(a=>a.id===v)!);setValues({});setError('');setSuccess('')}}>
        <SelectTrigger id="p2p-action" className="mt-1 w-full"><SelectValue/></SelectTrigger>
        <SelectContent>{actions.filter(a=>allowed(a.area,a.id)).map(a=><SelectItem key={a.id} value={a.id}>{a.title}</SelectItem>)}</SelectContent>
      </Select></label>
  {current.area==='warehouse'&&<div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs" aria-label="Pages des inventaires"><span>Comptages : page {warehousePage} · {warehousePaging?.countTotal??'?'} au total</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={warehousePage<=1} onClick={()=>setWarehousePage(n=>Math.max(1,n-1))}>Précédent</Button><Button size="sm" variant="outline" disabled={!warehousePaging?.hasMoreCounts} onClick={()=>setWarehousePage(n=>n+1)}>Suivant</Button></div></div>}
  <form onSubmit={e=>void submit(e)} className="grid grid-cols-1 gap-3 md:grid-cols-2">{current.fields.filter(f=>!(f.key==='lines'&&current.id==='revision')).map(f=>{const allOptions=options.find(o=>o.key===f.key)?.values||[];const source=current.id==='revision'&&f.key==='orderId'?allOptions.filter(x=>['draft','confirmed'].includes(x.status??'')&&!(x.receipts?.length)):
   f.key==='offerId'&&current.id==='confirmOffer'?allOptions.filter(x=>x.confirmationStatus==='pending'):
   f.key==='offerId'&&current.id==='validatePhoneOffer'?allOptions.filter(x=>x.confirmationStatus==='pending'&&x.responseChannel==='phone'):
   f.key==='offerId'&&current.id==='award'?allOptions.filter(x=>x.rfqId===Number(values.rfqId)&&!x.chosen):allOptions;return <label key={f.key} className="text-sm font-medium">{f.label}
    {/* V18.9.10 (UX-005/UX-039) : champs du design system ; identifiants
        techniques masqués (le nom métier suffit, l'ID reste la valeur). */}
    {f.kind==='textarea'?<Textarea required={!f.optional} minLength={f.key==='reason'?10:undefined} className="mt-1" value={values[f.key]||''} onChange={e=>setValues(v=>({...v,[f.key]:e.target.value}))}/>
    :f.kind==='select'?
      <SearchableCombobox label={f.label} value={values[f.key]||''} onChange={v=>setValues(v2=>({...v2,[f.key]:v}))}
        options={f.options?f.options.map(x=>({value:x,label:optionLabel(x)})):source.map(x=>({value:String(x.id),label:x.name||x.ref||x.code||x.lotCode||`#${x.id}`}))}
        placeholder="Choisir ou rechercher…" />
    :<Input required={!f.optional} className="mt-1" type={f.kind==='date'||f.kind==='datetime-local'?f.kind:f.kind==='number'?'number':'text'} step={f.kind==='number'?'any':undefined} value={values[f.key]||''} onChange={e=>setValues(v=>({...v,[f.key]:e.target.value}))}/>}
    </label>})}
  {current.id==='revision'&&<div className="md:col-span-2 space-y-2"><h3 className="font-medium">Modifier toutes les lignes du BC</h3><p className="text-sm text-slate-600">La révision annule l’approbation précédente. Un autre responsable devra confirmer le BC.</p>{revisionLines.length===0?<p className="text-sm text-amber-700">Sélectionner un BC contenant des lignes, non réceptionné.</p>:<div className="space-y-2">{revisionLines.map((l,i)=><div key={l.id} className="grid grid-cols-1 gap-2 rounded border p-2 sm:grid-cols-3"><span className="text-sm font-medium">{l.name}<span className="mt-1 block text-xs text-slate-500">Total estimé : {(Number(l.qty)*Number(l.unitPrice)).toLocaleString("fr-MA",{maximumFractionDigits:2})} MAD</span></span><label className="text-sm">Quantité<Input aria-label={`Quantité ${l.name}`} type="number" min="0.001" step="any" className="mt-1" value={l.qty} onChange={e=>setRevisionLines(old=>old.map((v,j)=>j===i?{...v,qty:e.target.value}:v))}/></label><label className="text-sm">Prix MAD<Input aria-label={`Prix ${l.name}`} type="number" min="0" step="any" className="mt-1" value={l.unitPrice} onChange={e=>setRevisionLines(old=>old.map((v,j)=>j===i?{...v,unitPrice:e.target.value}:v))}/></label></div>)}</div>}</div>}
  <div className="md:col-span-2"><Button type="submit" variant="primary" disabled={busy||!allowed(current.area,current.id)||(current.id==='revision'&&!revisionLines.length)}>{busy?'Traitement…':'Enregistrer et contrôler'}</Button></div></form>
  {!allowed(current.area,current.id)&&<p className="text-sm text-amber-700">Cette opération nécessite un autre rôle. Choisissez une action autorisée.</p>}{error&&<p role="alert" className="mt-3 rounded bg-rose-50 p-2 text-sm text-rose-800">{error}</p>}{success&&<p className="mt-3 rounded bg-emerald-50 p-2 text-sm text-emerald-800">{success}</p>}</section>}
  {current.area==='sourcing'&&showAdvanced&&<><section className="rounded-lg border bg-white p-4"><h2 className="font-semibold">Offres attribuées et justificatifs</h2><p className="my-2 text-sm text-slate-600">Un devis PDF exige sa pièce jointe. Une offre e-mail exige une référence au message fournisseur. Une offre téléphonique nécessite un compte rendu, une validation de l’acheteur et l’approbation d’un responsable différent, sans PDF obligatoire. L’attribution ne crée pas automatiquement le BC. Les prix affichés sont normalisés par unité de stock.</p><div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-xs" aria-label="Pages des RFQ"><span>Page {rfqPage} · {rfqPaging?.total??'?'} RFQ</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={rfqPage<=1} onClick={()=>setRfqPage(n=>Math.max(1,n-1))}>Précédent</Button><Button size="sm" variant="outline" disabled={!rfqPaging?.hasMore} onClick={()=>setRfqPage(n=>n+1)}>Suivant</Button></div></div>{!rfqs.length?<p className="text-sm text-slate-500">Aucune consultation enregistrée</p>:rfqs.map(r=><div key={r.id} className="border-b py-2"><p className="font-medium">{r.ref}</p>{r.offers?.map(o=><div key={o.id} className="text-sm"><p>Offre #{o.id} · {o.quoteRef||'À confirmer'} · {o.supplier?.name} · {o.unitPrice} MAD / unité stock · {o.leadTimeDays} jours · {o.confirmationStatus==='pending'?'ORALE / À CONFIRMER':o.chosen?'Retenue':'Non retenue'} · valable jusqu’au {o.validUntil?new Date(o.validUntil).toLocaleDateString('fr-FR'):'non précisé'}</p><OfferDocuments offerId={o.id} items={o.attachments??[]} canUpload={hasRole(session,'buyer')} /></div>)}</div>)}</section>
  <section className="rounded-lg border bg-white p-4"><h2 className="font-semibold">Accords contractuels — validation à quatre yeux</h2>
    <p className="my-2 text-sm text-slate-600">Le tarif saisi dans la fiche fournisseur reste indicatif. Seul un accord avec référence, justificatif, période valide et approbation distincte autorise un BC direct.</p>
    {!agreements.length?<p className="text-sm text-slate-500">Aucun contrat tarifaire enregistré.</p>:<div className="space-y-2">{agreements.map(a=><div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm" key={a.id}><div><strong>{a.contractRef}</strong> · {a.supplier.name} · {a.material.name}<p className="text-xs text-slate-500">Pièce : {a.documentRef} · {new Date(a.validFrom).toLocaleDateString('fr-FR')} au {new Date(a.validUntil).toLocaleDateString('fr-FR')}</p></div><div className="text-right"><strong>{a.unitPrice} MAD / unité</strong><p className="text-xs">{a.status==='approved'?'Approuvé':a.status==='pending'?'En attente de validation':'Révoqué'}</p></div></div>)}</div>}
   </section></>}
  <section className="rounded-lg border bg-white p-4"><h2 className="font-semibold">Relances fournisseurs à traiter</h2>{!overview?<p className="text-sm text-amber-700">Données de relance indisponibles. Réessayer après rechargement.</p>:overview.overdue?.length?overview.overdue.slice(0,10).map(o=><p className="border-b py-2 text-sm" key={o.ref}>{o.ref} · {o.supplier} · solde {o.remaining}</p>):<p className="text-sm text-slate-500">Aucun BC en retard dans la base.</p>}</section>
  </>}
 </div>
}
