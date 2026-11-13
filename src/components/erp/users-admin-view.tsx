"use client"
import {useEffect,useMemo,useState} from "react"
import {ShieldCheck,UserPlus,RefreshCcw,Save} from "lucide-react"
import {Button} from "@/components/ui/button"
import {Input} from "@/components/ui/input"
import {Checkbox} from "@/components/ui/checkbox"

type Account={username:string;roles:string[];permissions:Record<string,boolean>;active:boolean;isRoot:boolean;mustChangePassword:boolean;createdAt:string}
type Directory={users:Account[];audit:{id:number;at:string;actor:string;action:string;target:string}[];roles:string[];rights:Record<string,string[]>}
const LABELS:Record<string,string>={admin:"Administrateur",director:"Directeur",buyer:"Acheteur",sales:"Commercial",approver:"Approbateur",receiver:"Réceptionnaire",inventory:"Magasinier",quality:"Qualité",finance:"Finance"}
const RIGHTS_LABELS:Record<string,string>={
 "users.read":"Consulter les utilisateurs","users.manage":"Créer et modifier les utilisateurs",
 "purchases.create":"Créer des demandes d'achat","purchases.approve":"Approuver les demandes d'achat",
 "supplier-orders.create":"Créer des BC fournisseurs","supplier-orders.approve":"Approuver les BC fournisseurs",
 "suppliers.manage":"Gérer les fournisseurs","materials.manage":"Gérer les matières premières",
 "receipts.create":"Enregistrer les réceptions","quality.manage":"Gérer les contrôles qualité et retours",
 "stock.read":"Consulter les dépôts, emplacements et inventaires",
 "p2p.overview.read":"Consulter les indicateurs achats et fournisseurs",
 "stock.move":"Enregistrer des mouvements de stock","stock.count":"Saisir les inventaires","stock.count.approve":"Valider les inventaires",
 "products.create":"Proposer des produits","products.manage":"Gérer les produits",
 "sales.quotes":"Gérer les devis clients","sales.orders":"Gérer les commandes clients","sales.approve":"Approuver les commandes clients","sales.deliveries":"Gérer les livraisons clients",
 "sales.invoices":"Émettre les factures clients","sales.payments":"Enregistrer les règlements clients","sales.credits":"Gérer les avoirs clients",
 "director.prices":"Approuver les prix spéciaux (directeur uniquement)",
 "finance.purchases":"Gérer les factures fournisseurs","finance.export":"Exporter la comptabilité",
 "costs.read":"Consulter les coûts matière","clients.read":"Consulter les données clients",
}
const emptyForm={username:"",password:"",roles:[] as string[],permissions:{} as Record<string,boolean>,active:true}
export function UsersAdminView({isRoot=false}:{isRoot?:boolean}){
 const [data,setData]=useState<Directory|null>(null)
 const [selected,setSelected]=useState<string|null>(null)
 const [form,setForm]=useState({...emptyForm})
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState("")
 const [success,setSuccess]=useState("")
 async function load(){const res=await fetch("/api/admin/users",{cache:"no-store"});const result=await res.json();if(!res.ok)throw Error(result.error||"Chargement impossible");setData(result)}
 useEffect(()=>{load().catch(e=>setError(String(e.message)))},[])
 const target=data?.users.find(x=>x.username===selected)
 const isLocked=Boolean(target?.isRoot)
 const sensitiveAllowed=isRoot
 const rights=useMemo(()=>Object.entries(data?.rights||{}),[data])
 function choose(user:Account|null){setSelected(user?.username||null);setForm(user?{username:user.username,password:"",roles:[...user.roles],permissions:{...user.permissions},active:user.active}:{...emptyForm});setError("");setSuccess("")}
 function toggleRole(role:string,value:boolean){setForm(f=>{const roles=value?[...f.roles,role]:f.roles.filter(x=>x!==role);const permissions={...f.permissions};for(const [key,parents] of Object.entries(data?.rights||{})){if(permissions[key]===true && !parents.some(r=>roles.includes(r)))delete permissions[key]}return {...f,roles,permissions}})}
 function enabled(key:string,parents:string[]){return Boolean(parents.some(p=>form.roles.includes(p)))&&form.permissions[key]!==false && (key!=="director.prices"||form.roles.includes("director"))}
 async function save(){setBusy(true);setError("");setSuccess("");try{
   if(!form.roles.length)throw Error("Sélectionner au moins un rôle")
   if(!selected && form.password.length<16)throw Error("Mot de passe provisoire : 16 caractères minimum")
   const body:any={username:form.username.toLowerCase().trim(),roles:form.roles,permissions:form.permissions,active:form.active}
   if(form.password)body.password=form.password
   const res=await fetch("/api/admin/users",{method:selected?"PATCH":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
   const payload=await res.json();if(!res.ok)throw Error(payload.error||"Enregistrement refusé")
   setSuccess(selected?"Compte mis à jour. Les changements s'appliquent dès la prochaine requête.":"Compte créé. Communiquez son mot de passe provisoire de façon sécurisée.")
   setForm(f=>({...f,password:""}));await load()
 }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 return <div className="grid gap-5 xl:grid-cols-[minmax(240px,360px)_minmax(0,1fr)]">
   <section className="rounded-xl border border-slate-200 bg-white p-4">
     <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-bold">Employés</h2><Button size="sm" variant="outline" onClick={()=>load().catch(e=>setError(e.message))} aria-label="Actualiser les utilisateurs"><RefreshCcw className="size-4"/></Button></div>
     <Button className="mb-3 w-full" onClick={()=>choose(null)}><UserPlus className="mr-2 size-4"/>Créer un utilisateur</Button>
     <ul className="space-y-2">{data?.users.map(user=><li key={user.username}><button type="button" onClick={()=>choose(user)} className={`w-full rounded-lg border p-3 text-left focus-visible:outline-2 focus-visible:outline-emerald-700 ${selected===user.username?"border-emerald-500 bg-emerald-50":"border-slate-200 hover:bg-slate-50"}`}><span className="block font-semibold">{user.username} {user.isRoot?"★":""}</span><span className="text-xs text-slate-600">{user.roles.map(r=>LABELS[r]||r).join(" · ")}</span><span className={`mt-1 block text-xs ${user.active?"text-emerald-700":"text-rose-700"}`}>{user.active?"Actif":"Désactivé"}{user.mustChangePassword?" · Mot de passe à changer":""}</span></button></li>)}</ul>
   </section>
   <section className="min-w-0 space-y-5 rounded-xl border border-slate-200 bg-white p-4">
     <h2 className="flex items-center gap-2 text-lg font-bold"><ShieldCheck className="size-5"/>{selected?`Modifier : ${selected}`:"Nouvel employé"}</h2>
     <p className="text-sm text-slate-600">Un compte peut cumuler plusieurs rôles. Les permissions cochées affinent les actions permises par ces rôles ; elles ne créent jamais un rôle supplémentaire.</p>
     {error&&<p role="alert" className="rounded-md border border-rose-300 bg-rose-50 p-2 text-sm text-rose-800">{error}</p>}
     {success&&<p role="status" className="rounded-md border border-emerald-300 bg-emerald-50 p-2 text-sm text-emerald-900">{success}</p>}
     <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Identifiant<Input autoComplete="off" disabled={Boolean(selected)} value={form.username} onChange={e=>setForm(f=>({...f,username:e.target.value}))} placeholder="ex. youssef"/></label><label className="text-sm font-medium">{selected?"Nouveau mot de passe (facultatif)":"Mot de passe provisoire"}<Input type="password" autoComplete="new-password" value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))} placeholder="16 caractères minimum"/></label></div>
     <fieldset className="space-y-2"><legend className="mb-2 font-semibold">Fonctions / rôles</legend><div className="grid gap-2 sm:grid-cols-3">{data?.roles.map(role=><label key={role} className="flex min-h-10 items-center gap-2 rounded-md border p-2 text-sm"><Checkbox disabled={isLocked||(!sensitiveAllowed&&["admin","director","finance"].includes(role))} checked={form.roles.includes(role)} onCheckedChange={v=>toggleRole(role,v===true)}/>{LABELS[role]||role}</label>)}</div></fieldset>
     <fieldset className="space-y-2"><legend className="mb-2 font-semibold">Permissions détaillées</legend><div className="grid gap-2 lg:grid-cols-2">{rights.map(([key,parents])=><label key={key} className="flex min-h-10 items-center gap-2 rounded-md border border-slate-200 p-2 text-sm"><Checkbox disabled={isLocked||!(parents.some(r=>form.roles.includes(r)))||(key==="director.prices"&&!form.roles.includes("director"))} checked={enabled(key,parents)} onCheckedChange={v=>setForm(f=>({...f,permissions:{...f.permissions,[key]:v===true}}))}/>{RIGHTS_LABELS[key]||key}</label>)}</div></fieldset>
     {selected&&<label className="flex items-center gap-2 text-sm"><Checkbox disabled={isLocked} checked={form.active} onCheckedChange={v=>setForm(f=>({...f,active:v===true}))}/>Compte actif</label>}
     <Button onClick={save} disabled={busy||isLocked||(!selected&&form.password.length<16)}><Save className="mr-2 size-4"/>{busy?"Enregistrement…":selected?"Enregistrer les modifications":"Créer le compte"}</Button>
     {isLocked&&<p className="text-xs text-amber-700">Le compte principal est protégé contre la désactivation et le retrait de rôles.</p>}
     <div className="border-t pt-4"><h3 className="mb-2 font-semibold">Historique des changements</h3><div className="max-h-60 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">Date</th><th className="p-2">Acteur</th><th className="p-2">Action</th><th className="p-2">Cible</th></tr></thead><tbody>{data?.audit.map(x=><tr key={x.id} className="border-t"><td className="p-2">{x.at}</td><td className="p-2">{x.actor}</td><td className="p-2">{x.action}</td><td className="p-2">{x.target}</td></tr>)}</tbody></table></div></div>
   </section>
 </div>
}
