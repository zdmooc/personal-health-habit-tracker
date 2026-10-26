# Architecture

```text
React PWA (PC / mobile)
  ├─ Saisie → commandes → événements immuables
  ├─ Lecture ← projections quotidiennes ← IndexedDB (source locale)
  ├─ Import / Export JSON ← archives utilisateur
  ├─ DriveAdapter ← OAuth drive.file → Google Drive
  │   └─ events-<date>-<device>.json (partition par appareil et journée)
  └─ CoachStrategy
      ├─ règles déterministes locales, sans réseau
      └─ endpoint IA facultatif, statistiques agrégées, consentement explicite
```

| Pattern | Code | Invariant |
|---|---|---|
| Local-First / Offline-First | `storage/db.ts`, PWA | écriture locale avant tout réseau |
| Event Sourcing | `domain/model.ts` | événements immuables; annulation `retract` |
| CQRS léger | `domain/metrics.ts` | écritures séparées des projections |
| Repository | `storage/db.ts` | stockage abstrait derrière les opérations |
| Hexagonal / Adapter | `sync/drive.ts`, `import/journal.ts` | dépendance Drive hors du domaine |
| Transactional Outbox (journal local) | `sync/drive.ts` | données hors ligne retransmises après reconnexion |
| Idempotency | identifiant d'événement | import/sync répétés sans double comptage |
| Eventual Consistency | `sync/drive.ts` | union des événements, partitions par appareil |
| Strategy / AI Gateway | `ai/coach.ts` | conseils locaux ou IA distante facultative |
| State Machine simple | `domain/metrics.ts` | dernier état de pose/retrait du patch |

## Synchronisation

1. Chaque événement reçoit un UUID unique (l'historique importé reçoit un identifiant stable).
2. Écriture dans IndexedDB immédiatement ; aucune connexion requise.
3. OAuth Google au clic de l'utilisateur, portée `drive.file` uniquement.
4. Lecture des partitions Drive, fusion par identifiant, sauvegarde locale.
5. Envoi des seules partitions de l'appareil courant. Un autre appareil ne réécrit pas ces fichiers.
6. Les annulations sont des nouveaux événements, jamais des suppressions silencieuses.

**Limite :** le service Google Drive n'est pas une base transactionnelle. Deux onglets sur le même appareil sont sérialisés via Web Locks lorsque disponibles. La connexion Drive doit être autorisée sur chaque appareil et renouvelée après expiration. Le navigateur mobile ne garantit pas une synchronisation continue en arrière-plan.

## Données historiques

Importer le JSON `declic-historique-migration-source` ou une sauvegarde native de cette application depuis l'interface. Conserver `null` pour les heures non connues. Ne pas fusionner automatiquement les saisies distinctes de Declic avec le journal historique. Les données personnelles sont exclues du code GitHub.

## IA

Les calculs de temps et compteurs ne dépendent jamais d'une IA. Le moteur local propose des observations déterministes. Un service IA facultatif ne reçoit que les agrégats du jour et les catégories de déclencheurs, après consentement ; jamais le contenu du journal, notes, sauvegardes ou informations médicales.

## Démarrage

```bash
npm install
npm run test
npm run dev
```

Pour Drive, configurer `VITE_GOOGLE_CLIENT_ID` et enregistrer les origines JS sur Google Cloud OAuth. Sur GitHub Pages définir la variable de dépôt `GOOGLE_CLIENT_ID`, activer Pages (source GitHub Actions) et relancer le workflow. Sans cette configuration, toute l'application fonctionne en local.
