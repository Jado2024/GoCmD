#!/usr/bin/env node
console.error("Schéma SQLite GoCmd : prisma migrate dev n'est pas une procédure de mise à jour validée. Utiliser les scripts de migration versionnés, sauvegarder la base à froid et contrôler la restauration.");
process.exit(2);
