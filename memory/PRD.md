# PRD — Météo iPad (Application Météo Française)

## Objectif
Application météo en français optimisée pour un vieil iPad, avec affichage de l'heure en grand format et grandes typographies pour une lecture facile.

## Public cible
Utilisateur senior sur iPad ancien — priorité absolue : lisibilité et simplicité.

## Stack technique
- **Frontend** : Expo (SDK 54) / React Native, expo-router (file-based)
- **Backend** : Aucun backend utilisé (API publique appelée directement)
- **API météo** : Open-Meteo (gratuite, sans clé) — `https://api.open-meteo.com`
- **API géocodage** : Open-Meteo Geocoding — `https://geocoding-api.open-meteo.com`
- **Localisation** : `expo-location` (avec permissions iOS/Android déclarées)
- **Persistance** : `@/src/utils/storage` (AsyncStorage wrapper)

## Fonctionnalités livrées (MVP)
1. **Horloge géante** (HH:MM, 140pt, mise à jour chaque seconde) avec date longue française
2. **Météo actuelle** : icône grande, température 150pt, condition, ressenti, humidité, vent
3. **Prévisions horaires** sur 24h en scroll horizontal
4. **Prévisions 7 jours** avec barres min/max colorées
5. **Recherche de ville** avec autocomplétion (Open-Meteo geocoding, fr)
6. **Bouton géolocalisation** (avec gestion permissions + fallback Paris)
7. **Toggle °C / °F** persisté localement
8. **Layout adaptatif** : iPad paysage = 2 colonnes (≥900px), portrait/téléphone = empilé
9. **Arrière-plan gradient** dynamique selon condition météo et jour/nuit

## Permissions
- iOS : `NSLocationWhenInUseUsageDescription` — « Afficher la météo de votre position »
- Android : `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`

## Tests
- Tests frontend automatisés via testing_agent : 11/11 PASS
- Rapport : `/app/test_reports/iteration_1.json`

## Limitations connues
- Sur écrans < 600px de large, le header est un peu serré (l'app cible un iPad, donc acceptable)
- La géolocalisation web nécessite HTTPS + permission navigateur ; sur iPad natif elle fonctionne pleinement
