'use strict';
// Contract checks for the GoCmd login redesign. These are source-level guards,
// not a replacement for HTTP or actual browser authentication tests.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const component=fs.readFileSync(path.join(root,'src/app/login/page.tsx'),'utf8');
const css=fs.readFileSync(path.join(root,'src/app/login/login.module.css'),'utf8');
const errors=ts.transpileModule(component,{
  fileName:'src/app/login/page.tsx',
  reportDiagnostics:true,
  compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}
}).diagnostics.filter(x=>x.category===ts.DiagnosticCategory.Error);
assert.deepEqual(errors.map(x=>ts.flattenDiagnosticMessageText(x.messageText,' ')),[],'TSX page must parse');
for(const text of [
  'Connexion GoCmd','GoCmd','ERP SODEPI','Accès sécurisé','Permissions par rôle',
  'Utilisateurs multi-rôles','Nom d&apos;utilisateur','Mot de passe',
  'Saisissez votre nom d\'utilisateur','Se connecter','Mot de passe oublié ?',
  'Contactez votre administrateur GoCmd',
  'Afficher le mot de passe','Masquer le mot de passe',
  'Accès réservé aux utilisateurs autorisés'
]) assert.ok(component.includes(text),'Missing expected label/content: '+text);
assert.ok(component.includes('fetch("/api/auth/login"'),'Must retain the real session login endpoint');
assert.ok(component.includes('credentials:"same-origin"'),'Must use first-party cookie session');
assert.ok(component.includes('window.location.replace("/")'),'Must redirect after login');
assert.ok(component.includes('type={showPassword?"text":"password"}'),'Password visibility must be toggleable');
assert.ok(component.includes('type="submit" disabled={busy}'),'Prevent duplicate submits');
assert.ok(component.includes('role="alert"'),'Accessible login errors required');
assert.ok(component.includes('type="button"') && component.includes('aria-expanded={showPasswordHelp}'),'Help must work without a fake recovery API');
assert.ok(!component.includes('window.location.href="http:'),'Do not hardcode an external/insecure login target');
for(const cssKey of ['.screen','.layout','.intro','.loginCard','.brand','.cardTop','.inputWrap','.submit','.forgotButton','.cardFooter','@media (max-width: 850px)','@media (max-width: 380px)'])
  assert.ok(css.includes(cssKey),'Missing responsive CSS rule: '+cssKey);
assert.ok(!css.includes('overflow-x: hidden !important'),'Do not mask an overflow bug globally');
console.log('PASS V18.9.13-p4 : TSX valide, login/session préservés, champs et actions de la maquette, accessibilité, CSS responsive');
