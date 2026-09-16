#!/usr/bin/env python3
"""
Mise à jour de la base du Grand Lyon depuis le jeu de données officiel complet de DataGrandLyon :
metropole-de-lyon:com_donnees_communales.companneauaffichage_1_0_0 (275 panneaux)
"""

import urllib.request
import json
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
PANELS_DIR = os.path.join(DATA_DIR, "panels")

URL = "https://data.grandlyon.com/geoserver/metropole-de-lyon/wfs?SERVICE=WFS&REQUEST=GetFeature&TYPENAME=metropole-de-lyon:com_donnees_communales.companneauaffichage_1_0_0&OUTPUTFORMAT=JSON"

def update():
    print(f"[1/3] Téléchargement depuis DataGrandLyon...")
    req = urllib.request.Request(URL, headers={"User-Agent": "TourneeAffiches/1.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw_data = json.loads(resp.read().decode("utf-8"))

    raw_features = raw_data.get("features", [])
    print(f"      {len(raw_features)} entités brutes reçues.")

    features = []
    for feat in raw_features:
        coords = feat.get("geometry", {}).get("coordinates", [])
        if len(coords) < 2:
            continue
        lon = float(coords[0])
        lat = float(coords[1])
        props = feat.get("properties", {})

        gid = props.get("gid", "")
        uid = props.get("uid") or f"gl_{gid}"
        adresse = props.get("adresse") or "Panneau affichage libre"
        commune = props.get("commune") or "Grand Lyon"
        cp = str(props.get("codepost") or "").strip()
        dim = props.get("dimension_m") or ""
        support = props.get("support") or ""
        infoloc = props.get("infoloc") or ""

        notes_parts = []
        if support:
            notes_parts.append(support)
        if dim:
            notes_parts.append(f"({dim})")
        if infoloc:
            notes_parts.append(infoloc)
        notes = " ".join(notes_parts).strip()

        name = f"{adresse}, {cp} {commune}".replace("  ", " ").strip(" ,")

        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [lon, lat]
            },
            "properties": {
                "id": uid,
                "name": name,
                "city": commune,
                "postal_code": cp,
                "type": "Affichage libre",
                "notes": notes,
                "street_view": f"https://www.google.com/maps/@{lat},{lon},3a,75y,0h,90t/data=!3m4!1e1!3m2!1s!2e0"
            }
        })

    print(f"[2/3] {len(features)} panneaux normalisés avec succès.")

    # 1. Sauvegarde du fichier GeoJSON
    os.makedirs(PANELS_DIR, exist_ok=True)
    gl_file = os.path.join(PANELS_DIR, "grand_lyon.geojson")
    grand_lyon_geojson = {
        "type": "FeatureCollection",
        "metadata": {
            "city": "Métropole de Lyon (Grand Lyon)",
            "count": len(features),
            "source": "https://data.grandlyon.com/portail/fr/jeux-de-donnees/panneaux-affichage-libre-metropole-lyon/telechargements"
        },
        "features": features
    }
    with open(gl_file, "w", encoding="utf-8") as f:
        json.dump(grand_lyon_geojson, f, ensure_ascii=False, indent=2)
    print(f"      Fichier écrit : {gl_file}")

    # 2. Mise à jour de data/cities.json
    cities_file = os.path.join(DATA_DIR, "cities.json")
    with open(cities_file, "r", encoding="utf-8") as f:
        cities = json.load(f)

    for c in cities:
        if c["id"] == "grand_lyon":
            c["count"] = len(features)
            c["name"] = "Métropole de Lyon (Grand Lyon)"
            break

    with open(cities_file, "w", encoding="utf-8") as f:
        json.dump(cities, f, ensure_ascii=False, indent=2)
    print(f"[3/3] Index {cities_file} mis à jour : 275 panneaux pour le Grand Lyon !")

if __name__ == "__main__":
    update()
