#!/usr/bin/env python3
"""
Collecte et normalisation des panneaux d'affichage libre :
- Ville de Lyon (76 panneaux)
- Métropole de Lyon (132 panneaux au total)
- Nantes Métropole (490 panneaux)
- Issy-les-Moulineaux (21 panneaux)
- Fleury-sur-Orne (4 panneaux)
"""

import os
import json
import urllib.request

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
PANELS_DIR = os.path.join(DATA_DIR, "panels")

def ensure_dirs():
    os.makedirs(PANELS_DIR, exist_ok=True)

def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "TourneeAffiches/1.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))

def harvest():
    ensure_dirs()
    cities_index = []
    
    print("=== Récupération des données prioritaires (Lyon, Nantes, Issy, etc.) ===")

    # 1. VILLE DE LYON (76 panneaux intra-muros)
    print("\n[+] Récupération : Ville de Lyon...")
    try:
        url_lyon = "https://data.grandlyon.com/geoserver/ville-de-lyon/ows?SERVICE=WFS&VERSION=2.0.0&request=GetFeature&typename=ville-de-lyon:lyon.panneauaffichage_latest&outputFormat=application/json&SRSNAME=EPSG:4326"
        data_lyon = fetch_json(url_lyon)
        features_lyon = []
        for feat in data_lyon.get("features", []):
            coords = feat.get("geometry", {}).get("coordinates", [])
            if len(coords) < 2:
                continue
            props = feat.get("properties", {})
            adresse = props.get("adresse", "Panneau d'affichage libre")
            cp = props.get("codepost", "69000")
            support = props.get("support", "")
            dim = props.get("dimension_m", "")
            infoloc = props.get("infoloc", "")
            notes = f"{support} ({dim}) {infoloc}".strip()
            
            features_lyon.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [float(coords[0]), float(coords[1])]
                },
                "properties": {
                    "id": props.get("uid") or f"lyon_{props.get('gid')}",
                    "name": f"{adresse}, {cp} Lyon",
                    "city": "Lyon",
                    "postal_code": cp,
                    "type": "Affichage libre",
                    "notes": notes,
                    "street_view": f"https://www.google.com/maps/@{coords[1]},{coords[0]},3a,75y,0h,90t/data=!3m4!1e1!3m2!1s!2e0"
                }
            })

        lyon_geojson = {
            "type": "FeatureCollection",
            "metadata": { "city": "Lyon", "count": len(features_lyon) },
            "features": features_lyon
        }
        with open(os.path.join(PANELS_DIR, "lyon.geojson"), "w", encoding="utf-8") as f:
            json.dump(lyon_geojson, f, ensure_ascii=False, indent=2)

        cities_index.append({
            "id": "lyon",
            "name": "Lyon (Ville)",
            "department": "69 - Rhône",
            "count": len(features_lyon),
            "center": [4.8357, 45.7640],
            "file": "panels/lyon.geojson"
        })
        print(f"  [✓] Lyon : {len(features_lyon)} panneaux enregistrés !")

        # 2. GRAND LYON (Jeu complet officiel DataGrandLyon - 275 panneaux)
        print("\n[+] Récupération : Métropole de Lyon (jeu complet)...")
        try:
            url_gl = "https://data.grandlyon.com/geoserver/metropole-de-lyon/wfs?SERVICE=WFS&REQUEST=GetFeature&TYPENAME=metropole-de-lyon:com_donnees_communales.companneauaffichage_1_0_0&OUTPUTFORMAT=JSON"
            data_gl = fetch_json(url_gl)
            features_grand_lyon = []
            for feat in data_gl.get("features", []):
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

                features_grand_lyon.append({
                    "type": "Feature",
                    "geometry": { "type": "Point", "coordinates": [lon, lat] },
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

            with open(os.path.join(PANELS_DIR, "grand_lyon.geojson"), "w", encoding="utf-8") as f:
                json.dump({
                    "type": "FeatureCollection",
                    "metadata": { "city": "Métropole de Lyon", "count": len(features_grand_lyon) },
                    "features": features_grand_lyon
                }, f, ensure_ascii=False, indent=2)

            cities_index.append({
                "id": "grand_lyon",
                "name": "Lyon (Métropole)",
                "department": "69 - Rhône",
                "count": len(features_grand_lyon),
                "center": [4.8450, 45.7700],
                "file": "panels/grand_lyon.geojson"
            })
            print(f"  [✓] Grand Lyon : {len(features_grand_lyon)} panneaux enregistrés !")
        except Exception as e_gl:
            print(f"  [X] Erreur Grand Lyon: {e_gl}")

    except Exception as e:
        print(f"  [X] Erreur Lyon: {e}")

    # 3. NANTES MÉTROPOLE
    print("\n[+] Récupération : Nantes Métropole...")
    try:
        url_nantes = "https://data.nantesmetropole.fr/api/explore/v2.1/catalog/datasets/244400404_panneaux-affichage-libre-nantes-metropole/exports/json"
        data_nantes = fetch_json(url_nantes)
        features_nantes = []
        for idx, item in enumerate(data_nantes):
            gp = item.get("geo_point_2d")
            if not gp or not isinstance(gp, dict):
                continue
            lat = gp.get("lat")
            lon = gp.get("lon")
            if lat is None or lon is None:
                continue
            voie = item.get("nom_voie") or "Panneau affichage libre"
            comp = item.get("complement_adresse") or ""
            com = item.get("commune") or "Nantes"
            name = f"{voie} ({comp})".strip(" ()")
            features_nantes.append({
                "type": "Feature",
                "geometry": { "type": "Point", "coordinates": [float(lon), float(lat)] },
                "properties": {
                    "id": item.get("id_inventaire_nm") or f"nantes_{idx+1}",
                    "name": f"{name}, {com}",
                    "city": com,
                    "type": "Affichage libre",
                    "notes": item.get("statut") or "",
                    "street_view": f"https://www.google.com/maps/@{lat},{lon},3a,75y,0h,90t/data=!3m4!1e1!3m2!1s!2e0"
                }
            })
        with open(os.path.join(PANELS_DIR, "nantes.geojson"), "w", encoding="utf-8") as f:
            json.dump({"type": "FeatureCollection", "metadata": {"city": "Nantes Métropole", "count": len(features_nantes)}, "features": features_nantes}, f, ensure_ascii=False, indent=2)

        cities_index.append({
            "id": "nantes",
            "name": "Nantes Métropole",
            "department": "44 - Loire-Atlantique",
            "count": len(features_nantes),
            "center": [-1.5536, 47.2183],
            "file": "panels/nantes.geojson"
        })
        print(f"  [✓] Nantes : {len(features_nantes)} panneaux enregistrés !")
    except Exception as e:
        print(f"  [X] Erreur Nantes: {e}")

    # 4. ISSY-LES-MOULINEAUX
    print("\n[+] Récupération : Issy-les-Moulineaux...")
    try:
        url_issy = "https://data.issy.com/api/explore/v2.1/catalog/datasets/panneaux-daffichage-libre/exports/json"
        data_issy = fetch_json(url_issy)
        features_issy = []
        for idx, item in enumerate(data_issy):
            cg = item.get("coordonnees_geo")
            if not cg:
                continue
            lat = cg.get("lat")
            lon = cg.get("lon")
            if lat is None or lon is None:
                continue
            features_issy.append({
                "type": "Feature",
                "geometry": { "type": "Point", "coordinates": [float(lon), float(lat)] },
                "properties": {
                    "id": f"issy_{idx+1}",
                    "name": f"{item.get('adresse_emplacement')}, Issy-les-Moulineaux",
                    "city": "Issy-les-Moulineaux",
                    "type": "Affichage libre",
                    "notes": item.get("type_panneaux") or "",
                    "street_view": item.get("street_view") or f"https://www.google.com/maps/@{lat},{lon},3a,75y,0h,90t/data=!3m4!1e1!3m2!1s!2e0"
                }
            })
        with open(os.path.join(PANELS_DIR, "issy_les_moulineaux.geojson"), "w", encoding="utf-8") as f:
            json.dump({"type": "FeatureCollection", "metadata": {"city": "Issy-les-Moulineaux", "count": len(features_issy)}, "features": features_issy}, f, ensure_ascii=False, indent=2)

        cities_index.append({
            "id": "issy_les_moulineaux",
            "name": "Issy-les-Moulineaux",
            "department": "92 - Hauts-de-Seine",
            "count": len(features_issy),
            "center": [2.2740, 48.8208],
            "file": "panels/issy_les_moulineaux.geojson"
        })
        print(f"  [✓] Issy : {len(features_issy)} panneaux enregistrés !")
    except Exception as e:
        print(f"  [X] Erreur Issy: {e}")

    # 5. FLEURY-SUR-ORNE
    print("\n[+] Récupération : Fleury-sur-Orne...")
    try:
        url_fleury = "https://data.fleurysurorne.fr/api/explore/v2.1/catalog/datasets/panneaux-daffichage-libre/exports/json"
        data_fleury = fetch_json(url_fleury)
        features_fleury = []
        for idx, item in enumerate(data_fleury):
            gp = item.get("geo_point_2d")
            if not gp:
                continue
            lat = gp.get("lat")
            lon = gp.get("lon")
            if lat is None or lon is None:
                continue
            features_fleury.append({
                "type": "Feature",
                "geometry": { "type": "Point", "coordinates": [float(lon), float(lat)] },
                "properties": {
                    "id": f"fleury_{idx+1}",
                    "name": f"Panneau d'affichage libre #{idx+1}, Fleury-sur-Orne",
                    "city": "Fleury-sur-Orne",
                    "type": "Affichage libre",
                    "notes": item.get("remarks") or "",
                    "street_view": f"https://www.google.com/maps/@{lat},{lon},3a,75y,0h,90t/data=!3m4!1e1!3m2!1s!2e0"
                }
            })
        with open(os.path.join(PANELS_DIR, "fleury_sur_orne.geojson"), "w", encoding="utf-8") as f:
            json.dump({"type": "FeatureCollection", "metadata": {"city": "Fleury-sur-Orne", "count": len(features_fleury)}, "features": features_fleury}, f, ensure_ascii=False, indent=2)

        cities_index.append({
            "id": "fleury_sur_orne",
            "name": "Fleury-sur-Orne",
            "department": "14 - Calvados",
            "count": len(features_fleury),
            "center": [-0.3747, 49.1487],
            "file": "panels/fleury_sur_orne.geojson"
        })
        print(f"  [✓] Fleury : {len(features_fleury)} panneaux enregistrés !")
    except Exception as e:
        print(f"  [X] Erreur Fleury: {e}")

    # Enregistrement de l'index des villes dans data/cities.json
    cities_file = os.path.join(DATA_DIR, "cities.json")
    with open(cities_file, "w", encoding="utf-8") as f:
        json.dump(cities_index, f, ensure_ascii=False, indent=2)
    print(f"\n=== Terminé ! {len(cities_index)} villes prêtes dans data/cities.json ===")

if __name__ == "__main__":
    harvest()
