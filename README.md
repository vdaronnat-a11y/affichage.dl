# 🪧 Tournée Affiches - Optimisation & Guidage pour Colleurs d'Affiches Bénévoles

Application web mobile-first conçue pour les équipes de collage d'affiches citoyennes et associatives. Elle calcule un itinéraire routier optimisé en boucle fermée (départ et retour au même endroit) pour coller sur les panneaux d'affichage libre d'une ville, en tenant compte des sens interdits et du code de la route, puis propose un mode guidage pas-à-pas vers Google Maps / Waze.

---

## 🚀 Caractéristiques Principales

- **Boucle fermée (Round-trip)** : Vous partez de votre domicile ou point de rendez-vous, traitez le nombre de panneaux choisis, et la tournée vous ramène automatiquement à votre point de départ.
- **Respect du réseau routier** : Moteur d'optimisation automobile (OSRM driving) respectant les sens uniques, sens interdits, ronds-points et tourne-à-gauche.
- **Données officielles Open Data préchargées** :
  - **Lyon (Ville intra-muros)** : 76 panneaux d'affichage d'opinion.
  - **Métropole de Lyon (Grand Lyon)** : 275 panneaux (Lyon, Bron, Villeurbanne, Vaulx-en-Velin, Givors, Rillieux, Caluire, etc.).
  - **Nantes Métropole** : 490 panneaux.
  - **Issy-les-Moulineaux** : 21 panneaux.
  - **Fleury-sur-Orne** : 4 panneaux.
- **Recherche d'adresse & GPS** : Autocomplétion ultra-rapide via l'API Adresse officielle française (`api-adresse.data.gouv.fr`) ou géolocalisation GPS en 1 clic.
- **Ajustement interactif** : Visualisez l'itinéraire sur la carte, retirez ou ajoutez des panneaux en 1 clic.
- **Mode Guidage HUD pour voiture** :
  - Interface à contraste élevé adaptée au tableau de bord.
  - Bouton **« 🚗 Ouvrir dans Google Maps »** : ouvre directement la destination vers les coordonnées exactes du panneau.
  - Option **« 🚙 Ouvrir Waze »**.
  - Gros bouton tactile **« ✅ C'est collé ! Suivant ➡️ »** avec retour sonore et vibration.
  - Écran récapitulatif avec félicitations en fin de tournée.
- **Administration & Export Google My Maps** :
  - Ajout direct de nouvelles villes via fichiers GeoJSON ou CSV.
  - Export instantané au format **Google My Maps** (CSV ou KML) pour créer vos propres calques cartographiques permanents dans votre compte Google.
- **100% Gratuit & Sans abonnement** : Aucun coût d'API, aucun service cloud payant (0 € garanti).

---

## 💻 1. Utilisation en Local sur votre Mac

Pour lancer l'application sur votre ordinateur :

```bash
python3 server.py
```

Le terminal affichera :
- L'adresse locale pour votre Mac : `http://localhost:8000`
- L'adresse réseau pour votre smartphone connecté au même Wi-Fi : `http://192.168.x.x:8000`

---

## 🌐 2. Déploiement Gratuit sur GitHub Pages (Accessible 24h/24 ordinateur éteint)

L'application étant développée en pur Web standard (HTML5, CSS3, JavaScript ES6) avec des données GeoJSON statiques et des calculs dans le navigateur, **elle peut être hébergée gratuitement sur GitHub Pages sans avoir besoin de laisser votre ordinateur allumé** :

1. Créez un compte ou connectez-vous sur [github.com](https://github.com).
2. Créez un nouveau dépôt public (ex: `tournee-affiches`).
3. Déposez-y les fichiers de ce dossier :
   - `index.html`
   - `css/`
   - `js/`
   - `data/`
4. Allez dans les réglages du dépôt (**Settings > Pages**), choisissez la branche `main` / dossier `/ (root)` et validez.
5. Votre application sera accessible 24h/24 et 7j/7 pour tous les bénévoles à l'adresse :  
   `https://<votre-compte>.github.io/tournee-affiches/`

---

## 📂 Structure des Fichiers

```
Tournée affiches/
├── index.html                       # Interface utilisateur SPA
├── css/
│   └── style.css                    # Design system sombre/clair, boutons larges HUD
├── js/
│   ├── app.js                       # Contrôleur principal
│   ├── map.js                       # Gestion Leaflet & marqueurs
│   ├── router.js                    # Moteur de routage OSRM en boucle fermée
│   ├── guidance.js                  # Mode guidage pas à pas et liens Google Maps / Waze
│   └── admin.js                     # Import de villes & export Google My Maps
├── data/
│   ├── cities.json                  # Index des villes configurées
│   └── panels/                      # Données géographiques normalisées
│       ├── lyon.geojson             # 76 panneaux
│       ├── grand_lyon.geojson       # 132 panneaux
│       ├── nantes.geojson           # 490 panneaux
│       ├── issy_les_moulineaux.geojson # 21 panneaux
│       └── fleury_sur_orne.geojson  # 4 panneaux
├── scripts/
│   └── harvest_panneaux.py          # Script de mise à jour des données Open Data
├── server.py                        # Serveur HTTP Python local
├── implementation_plan.md           # Plan d'implémentation détaillé
└── README.md                        # Ce guide
```

---

## 🔄 Mise à jour des Données Open Data

Pour relancer la collecte ou mettre à jour les données :

```bash
python3 scripts/harvest_panneaux.py
```
