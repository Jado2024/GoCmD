# Sources historiques conservées sans prompts redondants

Les **rapports d'audit** et **grilles V3.1** sont conservés pour traçabilité et preuve de décisions anciennes. Les six anciens prompts dans `sources/prompts/` ont été supprimés **du livrable**, leurs exigences courantes étant intégrées aux skills FSNW. Les anciennes copies dans le projet ont été retirées également.

Les références historiques peuvent contenir des statuts anciens : suffixe C/S désormais facultatif ; GoProd (BOM, MRP, OF, consommation automatique MP) hors périmètre ; formule 51 à confirmer en atelier ; ancien PASS non transposable à une nouvelle archive. **Seul `../POLITIQUE_SODEPI_ACTUELLE.md` est prioritaire.**

`MANIFEST_SOURCES.json` décrit désormais **uniquement les sources réellement présentes** avec leurs empreintes originelles. Les vieux prompts supprimés restent identifiables par SHA/chemin dans `fsnw/NETTOYAGE_FS_NW.md`, sans réintroduire leurs copies.
