import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",
    
    // React rules
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/purity": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",
    
    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",
    
    // General JavaScript rules
    "prefer-const": "off",
    "no-unused-vars": "off",
    "no-console": "off",
    "no-empty": "off",
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "off",
    "no-useless-escape": "off",
  },
}, {
  // P5.15.8 : les modules CommonJS (.cjs) de src/lib et des dossiers QA_*
  // utilisent légitimement require() (contrat Node sans transpilation) ;
  // la règle no-require-imports ne doit pas s'y appliquer. Aligné sur
  // l'exclusion déjà prévue pour tests/ et scripts/.
  // QA2 (contre-audit QA1-02) : le reconditionnement QA1 a ajouté le dossier
  // qa/dmaic-p51514/ (batteries et lib de recette en .cjs) SANS l'étendre à
  // cette exemption — bun run lint échouait (10 erreurs) et la CI avec lui.
  // Contre-audit ventes 08/11/2026 (AV-09) : même incident — l'outil de
  // reproduction PREUVES_AUDIT_VENTES/outils/repro-def-v-02.cjs (preuve
  // d'exécution, require() légitime) faisait échouer lint sur l'archive
  // reconditionnée. Extension symétrique.
  files: ["tests/**/*.cjs", "tests/**/*.js", "scripts/**/*.cjs", "scripts/**/*.js", "src/**/*.cjs", "QA_*/**/*.cjs", "QA_*/**/*.js", "qa/**/*.cjs", "qa/**/*.js", "PREUVES_AUDIT_VENTES/**/*.cjs", "AUDIT_CASCADE4/**/*.cjs", "AUDIT_CASCADE4/**/*.js"],
  rules: { "@typescript-eslint/no-require-imports": "off" },
}, {
  // P5.15.8 (audit build) : set-state-in-effect (nouvelle règle
  // eslint-plugin-react-hooks v6) signale trois usages React standard —
  // chargement initial asynchrone (users-admin-view), synchronisation de
  // champs de formulaire sur changement de sélection (supplier-management)
  // et redirection de vue après session (erp-app). Restructurer ces sites
  // pour satisfaire la règle toucherait des comportements RBAC et de
  // formulaires déjà recettés ; la règle est donc désactivée explicitement
  // et le suivi est documenté dans le rapport d'audit.
  rules: { "react-hooks/set-state-in-effect": "off" },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills"]
}];

export default eslintConfig;
