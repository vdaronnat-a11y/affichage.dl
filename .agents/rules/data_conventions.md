# Conventions des jeux de données (Panneaux d'affichage)

Pour toute création, modification, moissonnage ou nettoyage de données de panneaux (fichiers `data/panels/*.geojson` et `data/cities.json`) :

1. **Interdiction formelle de la mention « Affichage libre »** :
   - Ne JAMAIS inclure « Affichage libre », « Expression libre », « Affichage d'opinion » ou variantes dans les champs `notes` ou `name`.
   - L'application étant exclusivement dédiée à l'affichage libre, cette répétition est un bruit inutile pour les utilisateurs sur le terrain.

2. **Suppression systématique des résidus administratifs et d'indexation** :
   - Ne JAMAIS laisser de mentions comme « Emplacement 1 », « Emplacement 2 », « Arrêt X », « Panneau X », « Lot Y ».
   - Utiliser des numéros de rue réels issus du géocodage BAN lorsque disponibles, ou des carrefours.

3. **Format du champ `notes`** :
   - Préciser uniquement la typologie physique du mobilier si spécifique (ex: `Colonne Morris`), ou un repère physique immédiat (ex: `Contre le mur du gymnase`, `Angle rue...`).
   - Ne pas surcharger avec des textes génériques.

4. **Précision des angles de rue** :
   - Lorsqu'un panneau est à une intersection sans numéro précis, toujours indiquer le croisement clairement (`Angle rue...`).

5. **Séparation stricte Adresse (`name`) et Ville (`city`)** :
   - Le champ `name` ne doit JAMAIS contenir la commune ni de virgule finale `, Commune`.
   - La commune appartient exclusivement au champ `city`.
   - L'affichage se charge d'afficher l'adresse seule (tournée mono-commune) ou d'accoler la commune (tournée multi-communes).
