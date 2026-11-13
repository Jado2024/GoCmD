declare const registry: {
  ROLES: readonly string[];
  RIGHTS: Readonly<Record<string, readonly string[]>>;
  dbFilename(): string | null;
  managed(): boolean;
  recordLoginFailure(username:string,reason?:string):boolean;
  /** Reauthentification nominative limitée et auditée pour les décisions tarifaires sensibles. */
  verifySensitivePassword(username:string,password:string,scope:"director.prices"):"ok"|"invalid"|"limited"|"unavailable";
  readUser(username: string): {username:string;roles:string[];permissions:Record<string,boolean>;active:boolean;isRoot:boolean;mustChangePassword:boolean;salt:string;hash:string;createdAt:string}|null;
  checkPassword(password:string,salt:string,hash:string):boolean;
  prepareSchema():boolean;
  bootstrap(username:string,password:string):{username:string;roles:string[]};
  listUsers(): Array<{username:string;roles:string[];permissions:Record<string,boolean>;active:boolean;isRoot:boolean;mustChangePassword:boolean;createdAt:string}>;
  createUser(actor:string,username:string,password:string,roles:string[],permissions:Record<string,boolean>):{username:string};
  updateUser(actor:string,username:string,changes:{roles?:string[];permissions?:Record<string,boolean>;active?:boolean;password?:string}):{username:string};
  changeOwnPassword(username:string,oldPassword:string,newPassword:string):{ok:boolean};
  recentAudit(limit?:number):Array<{id:number;at:string;actor:string;action:string;target:string;details:object}>;
  allowed(roles:string[],permissions:Record<string,boolean>,key:string,isRoot?:boolean):boolean;
  /** Ouvre une session persistante pour un compte actif. */
  createSession(username:string):{token:string;maxAge:number};
  /** Lit une session valide, retourne null si expirée/révoquée. */
  readSession(token:string):{username:string;roles:string[];permissions:Record<string,boolean>;active:boolean;isRoot:boolean;mustChangePassword:boolean;salt:string;hash:string;createdAt:string}|null;
  /** Révoque immédiatement une session. */
  revokeSession(token:string):boolean;
  /** Mise à niveau SQLite explicite des sessions/root. */
  migrateRootAndSessions():{username:string};
  /** R13.3 (CORR-01) : helpers purs partagés avec src/lib/identity-writes.ts. */
  validateIdentity(username:string):void;
  cleanRoles(roles:string[]):string[];
  cleanPermissions(perms:Record<string,boolean>,roles:string[]):Record<string,boolean>;
  hashPassword(password:string):{salt:string;hash:string};
  /** Vrai lorsque le module tourne dans le serveur Next.js (écritures interdites ici). */
  isServerRuntime():boolean;
};
export = registry;
