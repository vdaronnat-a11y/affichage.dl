# Directives Antigravity pour le projet Tournée Affiches

## Règles sur les jeux de données (GeoJSON)
- **Zéro mention « Affichage libre »** : Ne jamais ajouter « Affichage libre », « Expression libre », « Panneau libre » dans les champs `notes` ou `name`. L'application entière est déjà dédiée à cela.
- **Zéro résidu administratif** : Nettoyer systématiquement « Emplacement 1 », « Emplacement 2 », « Panneau X », etc.
- **Champ `notes` épuré** : Doit contenir uniquement la nature du support (`Colonne Morris`) ou une indication d'angle/repère utile (`Angle rue...`).
- **Champ `name` sans nom de ville** : Le nom de la commune ne doit JAMAIS figurer dans le champ `name` (pas de virgule ni de ville à la fin), car la commune est déjà stockée dans le champ `city`. L'application se charge d'afficher l'adresse seule (si tournée mono-commune) ou l'adresse avec la commune (si tournée multi-communes).
