# Personal Health Habit Tracker

PWA hors ligne : cigarettes, envies, cafés, patchs et sommeil. Données conservées localement (IndexedDB), synchronisation optionnelle sur Google Drive. Aucun dossier médical dans GitHub.

## Démarrer

```bash
npm install
npm run dev
```

## Synchronisation Google Drive

Configurer `VITE_GOOGLE_CLIENT_ID` (client OAuth Web Google Cloud) puis autoriser l'origine de l'application dans Google Cloud. Connexion explicite depuis l'application ; autorisation `drive.file`. Les données sont stockées dans le dossier Drive `Personal Health Habit Tracker`.

## Architecture

- `src/domain` : événements immuables, calculs, objectifs
- `src/storage` : IndexedDB, corrections et sauvegardes
- `src/sync` : adaptateur Google Drive, fusion par identifiant et fichier par appareil/jour
- `src/import` : import JSON Declic historique et sauvegarde locale
- `src/ai` : moteur d'analyse local, passerelle IA optionnelle
- `src/App.tsx` : interface PWA et actions utilisateur

Patterns : Hexagonal, Event Sourcing, CQRS léger, Repository, Transactional Outbox implicite (événements locaux avant upload), Adapter, Idempotency, Eventual Consistency, Strategy, State Machine.

`npm run build` ; `npm run test`. Déploiement GitHub Pages via Actions, après activation de Pages et configuration facultative de la variable `GOOGLE_CLIENT_ID`.

Important : les informations personnelles ne doivent jamais être commitées dans GitHub.
