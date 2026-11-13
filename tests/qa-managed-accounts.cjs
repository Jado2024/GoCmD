'use strict';
const assert = require('node:assert/strict');
const {randomBytes} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const directory = require('../src/lib/user-directory.cjs');

function createAccounts(file, prefix, roles) {
  const db = new DatabaseSync(file, {readOnly:true});
  let admin;
  try {
    admin = db.prepare('SELECT username FROM GoCmdUser WHERE is_root=1').get()?.username;
  } finally {
    db.close();
  }
  assert(admin, 'Compte principal requis sur la copie de recette');
  const previous = process.env.GOCMD_DB_FILE;
  process.env.GOCMD_DB_FILE = file;
  try {
    return Object.fromEntries(Object.entries(roles).map(([alias, grants]) => {
      // C4 (contre-audit CASCADE4) : un alias peut décrire {roles, permissions,
      // fresh:true} — « fresh » conserve must_change_password=1 (garde initiale
      // testable) et « permissions » permet un refus explicite (ex. director.prices).
      const spec = Array.isArray(grants) ? {roles: grants} : grants;
      const username = prefix + '_' + alias.toLowerCase();
      const initial = randomBytes(24).toString('base64url');
      const password = randomBytes(24).toString('base64url');
      directory.createUser(admin, username, initial, spec.roles, spec.permissions ?? {});
      if (!spec.fresh) directory.changeOwnPassword(username, initial, password);
      // Compte « fresh » : le mot de passe effectif reste l'initial (le harnais
      // doit donc le renvoyer, pas le mot de passe post-changement).
      return [alias, {username, password: spec.fresh ? initial : password}];
    }));
  } finally {
    if (previous === undefined) delete process.env.GOCMD_DB_FILE;
    else process.env.GOCMD_DB_FILE = previous;
  }
}

async function loginAccounts(origin, accounts) {
  const cookies = {};
  for (const [role, credentials] of Object.entries(accounts)) {
    const response = await fetch(origin + '/api/auth/login', {
      method:'POST', headers:{origin,'content-type':'application/json'},
      body:JSON.stringify(credentials), signal:AbortSignal.timeout(9000),
    });
    assert.equal(response.status, 200, 'Connexion du compte de recette ' + role);
    const cookie = response.headers.get('set-cookie');
    assert(cookie?.startsWith('gocmd_session='), 'Cookie de session attendu');
    cookies[role] = cookie.split(';')[0];
  }
  return cookies;
}

module.exports = {createAccounts, loginAccounts};
