/* Contrat V18.9.13-p2 : compatibilité build Next 16 / node:sqlite.
 * Ce contrôle ne se substitue PAS à un vrai build en environnement Node 24. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname,"..");
const pkg = JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));
assert.match(pkg.scripts.build,/^next build --webpack$/);
assert.match(pkg.scripts.dev,/^next dev --webpack -p 3000$/);
assert.ok(fs.existsSync(path.join(root,"src/components/ui/checkbox.tsx")));
assert.ok(fs.readFileSync(path.join(root,"src/lib/user-directory.cjs"),"utf8").includes("require('node:sqlite')"));
console.log("PASS contrat build Webpack + composant Checkbox présent ; tests runtime Next encore nécessaires");
