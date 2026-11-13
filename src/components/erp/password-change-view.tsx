"use client"
import {useState,type FormEvent} from "react"
import {Input} from "@/components/ui/input"
import {Button} from "@/components/ui/button"
export function PasswordChangeView({username,forced=true}:{username:string;forced?:boolean}){
 const [oldPassword,setOldPassword]=useState("")
 const [newPassword,setNewPassword]=useState("")
 const [confirmation,setConfirmation]=useState("")
 const [status,setStatus]=useState("")
 const [done,setDone]=useState(false)
 async function logout(){
   try{const res=await fetch("/api/auth/logout",{method:"POST",credentials:"same-origin"});if(!res.ok)throw Error("Erreur");window.location.replace("/login")}
   catch{setStatus("Déconnexion impossible. Vérifiez la connexion et réessayez.")}
 }
 async function submit(e:FormEvent){e.preventDefault();setStatus("");if(newPassword!==confirmation){setStatus("Confirmation différente");return}if(newPassword.length<16){setStatus("16 caractères minimum");return}
 try{const res=await fetch("/api/me/password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({oldPassword,newPassword})});const data=await res.json();if(!res.ok)throw Error(data.error||"Échec");setDone(true);setStatus(data.message);window.location.replace("/login?password=changed")}catch(e){setStatus(e instanceof Error?e.message:String(e))}}
 return <main className="mx-auto mt-20 max-w-md rounded-xl border bg-white p-6"><h1 className="text-xl font-bold">{forced?"Premier accès : changement de mot de passe":"Changer mon mot de passe"}</h1><p className="my-3 text-sm text-slate-600">Compte {username}. {forced?"Vous devez changer le mot de passe provisoire avant d’accéder aux modules.":"Choisissez un nouveau mot de passe personnel. La prochaine connexion demandera ce nouveau secret."}</p><form onSubmit={submit} className="space-y-3"><label className="block text-sm">Mot de passe provisoire<Input type="password" autoComplete="current-password" required value={oldPassword} onChange={e=>setOldPassword(e.target.value)}/></label><label className="block text-sm">Nouveau mot de passe (16 caractères minimum)<Input type="password" autoComplete="new-password" required value={newPassword} onChange={e=>setNewPassword(e.target.value)}/></label><label className="block text-sm">Confirmer<Input type="password" autoComplete="new-password" required value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label><Button disabled={done}>Changer le mot de passe</Button></form><Button type="button" className="mt-3" variant="outline" onClick={logout}>Se déconnecter</Button>{status&&<p className="mt-4 text-sm" role="status">{status}</p>}{done&&<p className="mt-2 text-sm text-slate-600">Votre ancienne session est révoquée : reconnectez-vous avec votre nouveau mot de passe.</p>}</main>
}
