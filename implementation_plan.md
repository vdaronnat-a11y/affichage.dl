# Plan d'implémentation : Application de Tournée pour Colleurs d'Affiches Bénévoles

L'objectif est de concevoir une application web complète, esthétique et optimisée pour smartphone et ordinateur, permettant aux colleurs d'affiches bénévoles d'organiser et d'exécuter des tournées de collage sur les panneaux d'affichage libre des villes françaises, avec guidage GPS pas à pas (Google Maps / Waze).

L'application est conçue pour être :
- **100% Gratuite** (aucun coût de cloud ou d'API, 0 € garanti).
- **Hébergeable en local ou sur GitHub Pages** (fonctionne 24h/24 même si votre ordinateur personnel est éteint).
- **Mobile-first** : interface tactile ergonomique adaptée à une utilisation en voiture.

---

## 1. Architecture & Structure du Projet

```
Tournée affiches/
├── implementation_plan.md           # Plan de conception du projet
├── data/
│   ├── cities.json                  # Index des villes disponibles avec coordonnées et métadonnées
│   └── panels/                      # Fichiers GeoJSON normalisés par ville
│       ├── nantes.geojson
│       ├── grand_lyon.geojson
│       ├── issy_les_moulineaux.geojson
│       ├── angers.geojson
│       ├── la_rochelle.geojson
│       ├── rennes_metropole.geojson
│       ├── fleury_sur_orne.geojson
│       └── ...
├── scripts/
│   └── harvest_panneaux.py          # Script de collecte & mise à jour Open Data (data.gouv.fr)
├── css/
│   └── style.css                    # Design moderne, sombre/clair, boutons larges HUD pour voiture
├── js/
│   ├── app.js                       # Logique principale de navigation et d'état
│   ├── map.js                       # Gestion de la carte Leaflet, marqueurs numérotés et tracés
│   ├── router.js                    # Algorithme d'optimisation de tournée (OSRM respectant les sens interdits)
│   ├── guidance.js                  # Mode guidage pas-à-pas avec deep-links Google Maps / Waze
│   └── admin.js                     # Module admin (import CSV/GeoJSON, ajout de ville, export Google My Maps)
├── index.html                       # Application web unique (SPA)
├── server.py                        # Petit serveur local Python pour tester en local facilement
└── README.md                        # Documentation d'utilisation et guide de déploiement GitHub Pages
```

---

## 2. Fonctionnalités Détaillées

### A. Collecte et Normalisation Open Data (`scripts/harvest_panneaux.py`)
- Téléchargement et conversion des jeux de données d'affichage libre depuis `data.gouv.fr` et les portails open data municipaux.
- Nettoyage et normalisation dans un format GeoJSON universel avec adresse, quartier, statut et coordonnées géographiques (WGS84).

### B. Configuration de la Tournée
- **Sélection de la ville** (liste avec moteur de recherche instantané).
- **Nombre de panneaux souhaité** (boutons rapides 5, 10, 15, 20 ou personnalisé).
- **Point de départ** :
  - Détection automatique par GPS ("Ma position actuelle").
  - Ou saisie d'une adresse avec autocomplétion instantanée via l'API Adresse officielle de l'État (`api-adresse.data.gouv.fr`).

### C. Moteur d'Optimisation Routière (Respect des sens interdits)
- Filtrage des `N` panneaux les plus pertinents autour du point de départ.
- Calcul de l'ordre optimal de passage (résolution du TSP - Voyageur de commerce) en appelant le profil automobile de l'API publique OSRM.
- Prise en compte réelle du réseau routier : **sens interdits**, sens uniques, ronds-points, interdictions de tourner.
- Calcul de la distance totale et du temps estimé en voiture.

### D. Carte Interactive & Personnalisation de l'Itinéraire
- Affichage de la carte Leaflet plein écran.
- Repères visuels clairs :
  - 🟢 Point de départ.
  - 🔵 Panneaux retenus numérotés de 1 à N.
  - ⚪ Autres panneaux de la ville disponibles en arrière-plan.
  - 🛣️ Tracé bleu de la route calculée.
- **Interactivité totale** :
  - Retirer un panneau de la tournée (clic sur un bouton ou sur son marqueur).
  - Ajouter un panneau supplémentaire en cliquant dessus sur la carte.
  - Recalcul dynamique immédiat de l'itinéraire optimal.

### E. Mode Guidage Terrain (Spécial Voiture & Smartphone)
- Interface grand format inspirée des systèmes GPS embarqués :
  - Nom du panneau actuel, adresse précise et numéro d'étape (ex: "Panneau 1/10").
  - Gros bouton d'action : **"Ouvrir dans Google Maps"** (déclenche immédiatement l'application Google Maps native du smartphone avec navigation jusqu'aux coordonnées du panneau).
  - Bouton alternatif **"Waze"** / **"Apple Maps"**.
  - Gros bouton tactile : **"✅ C'est collé ! Suivant ➡️"** avec retour visuel, vibration haptique et confirmation sonore.
  - Barre de progression dynamique (ex: "30% de la tournée effectuée").
  - Écran de bilan final : nombre d'affiches posées, distance parcourue, temps écoulé et félicitations.

### F. Espace Administrateur & Export Google My Maps
- Ajout manuel ou import de nouvelles villes :
  - Import de fichiers GeoJSON ou CSV (détection automatique des colonnes `latitude`/`longitude` ou `lat`/`lng` ou `adresse`).
  - Ou saisie directe d'une URL de dataset `data.gouv.fr`.
- Export compatible **Google My Maps** (fichiers KML ou CSV prêts à l'import) pour ceux qui souhaitent créer une carte personnalisée permanente dans leur compte Google.
- Export et sauvegarde locale des tournées en format JSON/GPX.

---

## 3. Déploiement Gratuit à Vie
- Mode 1 : **Local sur votre Mac** en lançant `python3 server.py`.
- Mode 2 : **GitHub Pages** : l'ensemble des fichiers (`index.html`, CSS, JS, et dossier `data/`) peut être déposé sur un dépôt GitHub gratuit pour être accessible en ligne 24h/24 même quand votre ordinateur est éteint.
