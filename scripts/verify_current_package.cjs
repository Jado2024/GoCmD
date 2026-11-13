const fs=require('node:fs');const path=require('node:path');const root=path.join(__dirname,'..');
// P6 (2026-11-11) : README_P5_15_18.md et CORRECTIONS_P51529_P5_LIVRAISON.md
// sont des livrés historiques rangés dans docs/historique/ ; le paquet exige
// désormais la documentation active P6 et le kit de déploiement Windows.
for(const p of ['src/lib/materials-workbench-sort.ts','src/components/erp/materials-view.tsx','src/components/erp/purchase-dialog.tsx','src/components/erp/p2p-advanced-view.tsx','src/app/api/materials/da-presence/route.ts','src/lib/user-directory.cjs','src/lib/supplier-award-rules.ts','src/components/erp/award-plan-panel.tsx','src/app/api/p2p/awards/route.ts','scripts/upgrade_multi_awards_p51518.py','db/custom.db','prisma/schema.prisma','docs/historique/README_P5_15_18.md','LANCER_GOCMD_NEUF.cmd','README.md','ROLES_ET_PERMISSIONS.md','RUNBOOK.md','SECURITE.md','CHANGELOG.md','deploy/windows/verifier-sante.ps1','deploy/windows/installer-service.ps1','deploy/windows/gocmd-service.xml','scripts/health_metrics_p6.py','scripts/audit_seal_p5152.py','scripts/gocmd-instance-lock.cjs','tests/p6-single-instance-and-retries.test.cjs','tests/test_p6_audit_seal_chain.py','scripts/backup_gocmd_complete.py','scripts/restore_gocmd_complete.py']){
 if(!fs.existsSync(path.join(root,p)))throw Error('Fichier obligatoire absent '+p)
}
const head=Buffer.alloc(16),fd=fs.openSync(path.join(root,'db/custom.db'),'r');fs.readSync(fd,head,0,16,0);fs.closeSync(fd);
if(head.toString('utf8')!=='SQLite format 3\0')throw Error('Base SQLite illisible');
console.log('PASS fichiers indispensables et en-tête SQLite p6.15.30');
