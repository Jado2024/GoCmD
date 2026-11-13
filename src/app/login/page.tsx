"use client"

import {useState, type FormEvent} from "react"
import {Eye, EyeOff, Layers3, LockKeyhole, ShieldCheck, UserRound, UsersRound} from "lucide-react"
import styles from "./login.module.css"
import { SodepiLogo, SodepiSymbol } from "@/components/branding/sodepi-logo"

export default function LoginPage(){
  const [username,setUsername]=useState("")
  const [password,setPassword]=useState("")
  const [showPassword,setShowPassword]=useState(false)
  const [showPasswordHelp,setShowPasswordHelp]=useState(false)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState("")

  async function signIn(e:FormEvent<HTMLFormElement>){
    e.preventDefault()
    if(busy)return
    setBusy(true)
    setError("")
    setShowPasswordHelp(false)
    try{
      const res=await fetch("/api/auth/login",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        credentials:"same-origin",
        body:JSON.stringify({username,password}),
        cache:"no-store"
      })
      if(!res.ok){
        const body=await res.json().catch(()=>null)
        throw Error(typeof body?.error==="string"?body.error:"Connexion impossible")
      }
      setPassword("")
      window.location.replace("/")
    }catch(e){
      setPassword("")
      setError(e instanceof Error?e.message:"Connexion impossible")
      setBusy(false)
    }
  }

  return <main className={styles.screen}>
    <div className={styles.waves} aria-hidden="true"><span/><span/></div>
    <div className={styles.layout}>
      <section className={styles.intro} aria-label="Présentation de GoCmd">
        <div className={styles.brand}>
          <div className={styles.brandIcon}><SodepiSymbol size={80} /></div>
          <div>
            <p className={styles.brandName}>GoCmd</p>
            <p className={styles.brandSubtitle}>ERP SODEPI</p>
          </div>
        </div>
        <div className={styles.brandRule} aria-hidden="true"/>
        <p className={styles.tagline}>La solution de gestion intégrée pour piloter votre activité en toute simplicité.</p>

        <ul className={styles.features}>
          <li className={styles.feature}>
            <span className={`${styles.featureIcon} ${styles.featureIconGreen}`}><LockKeyhole aria-hidden="true"/></span>
            <div><h2>Accès sécurisé</h2><p>Vos données sont protégées et confidentielles.</p></div>
          </li>
          <li className={styles.feature}>
            <span className={`${styles.featureIcon} ${styles.featureIconPurple}`}><UsersRound aria-hidden="true"/></span>
            <div><h2>Permissions par rôle</h2><p>Des accès adaptés aux responsabilités de chacun.</p></div>
          </li>
          <li className={styles.feature}>
            <span className={`${styles.featureIcon} ${styles.featureIconAmber}`}><Layers3 aria-hidden="true"/></span>
            <div><h2>Utilisateurs multi-rôles</h2><p>Un même compte peut avoir plusieurs rôles selon vos besoins.</p></div>
          </li>
        </ul>
      </section>

      <section className={styles.loginCard} aria-labelledby="login-title">
        <div className={styles.cardTop}>
          <SodepiLogo className={styles.cardLogo} priority />
          <h1 id="login-title">Connexion GoCmd</h1>
          <p>Accédez à votre espace de travail</p>
        </div>

        <form onSubmit={signIn} className={styles.form}>
          <div className={styles.formField}>
            <label htmlFor="gocmd-username">Nom d&apos;utilisateur</label>
            <div className={styles.inputWrap}>
              <UserRound aria-hidden="true" className={styles.inputIcon}/>
              <input id="gocmd-username" name="username" type="text" required autoFocus
                autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                maxLength={50} placeholder="Saisissez votre nom d'utilisateur"
                value={username} onChange={e=>setUsername(e.target.value)}
                disabled={busy} aria-invalid={Boolean(error)} aria-describedby={error?"gocmd-login-error":undefined}/>
            </div>
          </div>

          <div className={styles.formField}>
            <label htmlFor="gocmd-password">Mot de passe</label>
            <div className={styles.inputWrap}>
              <LockKeyhole aria-hidden="true" className={styles.inputIcon}/>
              <input id="gocmd-password" name="password" required
                type={showPassword?"text":"password"} autoComplete="current-password"
                placeholder="Saisissez votre mot de passe" value={password}
                onChange={e=>setPassword(e.target.value)}
                disabled={busy} aria-invalid={Boolean(error)} aria-describedby={error?"gocmd-login-error":undefined}/>
              <button type="button" className={styles.visibilityButton}
                onClick={()=>setShowPassword(v=>!v)}
                aria-label={showPassword?"Masquer le mot de passe":"Afficher le mot de passe"}
                aria-pressed={showPassword} disabled={busy}>
                {showPassword?<EyeOff aria-hidden="true"/>:<Eye aria-hidden="true"/>}
              </button>
            </div>
          </div>

          {error&&<div role="alert" id="gocmd-login-error" className={styles.alert}>{error}</div>}

          <button className={styles.submit} type="submit" disabled={busy}>
            {busy?"Connexion en cours…":"Se connecter"}
          </button>
          <button className={styles.forgotButton} type="button"
            onClick={()=>setShowPasswordHelp(v=>!v)} aria-expanded={showPasswordHelp}
            aria-controls="gocmd-password-help">Mot de passe oublié ?</button>
          {showPasswordHelp&&<p id="gocmd-password-help" role="status" className={styles.helpText}>
            Contactez votre administrateur GoCmd pour demander une réinitialisation de votre mot de passe.
          </p>}
        </form>

        <div className={styles.cardFooter}>
          <ShieldCheck aria-hidden="true"/>
          <span>Accès réservé aux utilisateurs autorisés</span>
        </div>
      </section>
    </div>
  </main>
}
