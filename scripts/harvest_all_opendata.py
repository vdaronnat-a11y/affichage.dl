#!/usr/bin/env python3
"""
Collecteur exhaustif des panneaux d'affichage libre depuis data.gouv.fr et portails open data officiels.
Génère pour chaque ville un fichier GeoJSON normalisé dans data/panels/ et met à jour data/cities.json.
"""

import os
import json
import urllib.request
import re

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
PANELS_DIR = os.path.join(DATA_DIR, "panels")

def ensure_dirs():
    os.makedirs(PANELS_DIR, exist_ok=True)

def fetch_json(url):
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (TourneeAffiches/1.0; +https://github.com/vdaronnat-a11y/affichage.dl)"}
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))

def clean_coord(val):
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        v = val.strip().replace(",", ".")
        try:
            return float(v)
        except ValueError:
            return None
    return None

def extract_point(geom, item_props=None):
    if not geom and item_props:
        # Check geo_point_2d or similar
        gp = item_props.get("geo_point_2d") or item_props.get("coordonnees_geo") or item_props.get("geometry")
        if isinstance(gp, dict):
            lat = clean_coord(gp.get("lat"))
            lon = clean_coord(gp.get("lon"))
            if lat is not None and lon is not None:
                return [lon, lat]
        elif isinstance(gp, (list, tuple)) and len(gp) >= 2:
            return [clean_coord(gp[1]), clean_coord(gp[0])]

    if not geom:
        return None

    coords = geom.get("coordinates")
    if not coords:
        return None

    # Si MultiPoint ou LineString [[lon, lat], ...]
    if isinstance(coords, (list, tuple)) and len(coords) >= 1 and isinstance(coords[0], (list, tuple)) and len(coords[0]) >= 2:
        lon = clean_coord(coords[0][0])
        lat = clean_coord(coords[0][1])
        if lon is not None and lat is not None:
            return [lon, lat]

    # Si Point simple [lon, lat]
    if isinstance(coords, (list, tuple)) and len(coords) >= 2 and isinstance(coords[0], (int, float)):
        lon = clean_coord(coords[0])
        lat = clean_coord(coords[1])
        if lon is not None and lat is not None:
            return [lon, lat]

    return None

def process_source(config):
    city_name = config["name"]
    city_id = config["id"]
    dept = config["department"]
    url = config["url"]
    parser_type = config.get("parser", "generic_geojson")

    print(f"\n[+] Téléchargement : {city_name} ({dept})...")
    try:
        raw_data = fetch_json(url)
    except Exception as e:
        print(f"  [X] Erreur téléchargement pour {city_name}: {e}")
        return None

    features_raw = raw_data.get("features") if isinstance(raw_data, dict) else raw_data
    if not features_raw and isinstance(raw_data, list):
        features_raw = raw_data

    normalized_features = []

    for idx, item in enumerate(features_raw or []):
        geom = item.get("geometry") if isinstance(item, dict) else None
        props = item.get("properties") if isinstance(item, dict) else (item if isinstance(item, dict) else {})
        if props is None:
            props = {}

        pt = extract_point(geom, props)
        if not pt:
            continue

        lon, lat = pt
        # Vérification des bornes France métropolitaine (-5 à 10 lon, 41 à 52 lat)
        if not (-6.0 <= lon <= 11.0 and 41.0 <= lat <= 52.0):
            # Parfois lat et lon sont inversés
            if -6.0 <= lat <= 11.0 and 41.0 <= lon <= 52.0:
                lon, lat = lat, lon
            else:
                continue

        # Extraction du nom / adresse
        name = None
        notes = None

        if parser_type == "paris":
            loc = props.get("localisation") or "Panneau associatif"
            arr = props.get("arrondissement") or ""
            prec = props.get("precisions") or ""
            fmt = props.get("petit_format") or ""
            arr_str = f"Paris {arr}e" if arr else "Paris"
            name = f"{loc}, {arr_str}"
            notes_parts = [prec, f"Format: {fmt}" if fmt else ""]
            notes = " - ".join([p for p in notes_parts if p]) or "Affichage associatif et d'opinion"

        elif parser_type == "toulouse":
            addr = props.get("adresse_localisation") or "Panneau d'expression libre"
            ville = props.get("ville") or "Toulouse"
            name = f"{addr}, {ville}"
            notes = "Panneau d'expression libre"

        elif parser_type == "rennes":
            voie = props.get("nom_voie") or props.get("id_voie") or "Panneau d'affichage"
            num = props.get("numero_voie") or ""
            name = f"{num} {voie}, Rennes".strip()
            notes = props.get("observation") or "Affichage associatif"

        elif parser_type == "tours":
            addr = props.get("adresse") or "Panneau d'affichage libre"
            com = props.get("commune") or "Tours"
            typ = props.get("type") or ""
            name = f"{addr}, {com}"
            notes = f"Type: {typ}" if typ else "Affichage libre"

        elif parser_type == "angers":
            nom = props.get("nom") or "Panneau d'affichage libre"
            com = props.get("nom_com") or "Angers"
            name = f"{nom}, {com}"
            notes = "Affichage libre"

        elif parser_type == "clermont":
            addr = props.get("adresse") or "Panneau associatif"
            prec = props.get("adresse_precision") or ""
            ref = props.get("reference") or ""
            name = f"{addr}, Clermont-Ferrand"
            notes = f"{prec} (Réf: {ref})".strip()

        elif parser_type == "mulhouse":
            loc = props.get("localisati") or "Panneau d'affichage libre"
            com = props.get("com_nom") or "Mulhouse"
            name = f"{loc}, {com}"
            notes = props.get("type") or "Affichage libre"

        elif parser_type == "chambery":
            sect = props.get("Secteur") or ""
            com = props.get("Commune") or "Chambéry"
            nb = props.get("Nombre") or ""
            name = f"Panneau d'affichage - {sect}, {com}".strip(" -")
            notes = f"{nb} face(s)" if nb else "Affichage public"

        elif parser_type == "soissons":
            rue = props.get("rue_d_installation") or "Panneau de libre expression"
            name = f"{rue}, Soissons"
            notes = props.get("title") or "Libre expression"

        elif parser_type == "saint_nazaire":
            voie = props.get("voie")
            if not voie or voie == "Voie non dénommée":
                voie = "Chemin des Infirmières" if "15428" in str(props.get("identifiant")) else ("Allée Camille Muffat" if "15435" in str(props.get("identifiant")) else f"Voie #{idx+1}")
            name = str(voie).strip()
            notes = ""

        elif parser_type == "talence":
            addr = props.get("adresse") or props.get("nom") or f"Panneau #{idx+1}"
            name = f"{addr}, Talence"
            notes = props.get("type") or "Affichage libre"

        elif parser_type == "anglet":
            loc = props.get("emplacement") or props.get("adresse") or f"Panneau #{idx+1}"
            name = f"{loc}, Anglet"
            notes = props.get("observation") or "Affichage libre"

        elif parser_type == "rueil":
            voie = props.get("lib_voie") or "Panneau d'affichage"
            num = props.get("num_police") or ""
            typ = props.get("type_affichage") or ""
            name = f"{num} {voie}, Rueil-Malmaison".strip()
            notes = typ or "Panneau d'affichage"

        elif parser_type == "grand_lyon_wfs":
            addr = props.get("adresse") or "Panneau affichage libre"
            cp = str(props.get("codepost") or "").strip()
            com = props.get("commune") or city_name
            support = props.get("support") or ""
            dim = props.get("dimension_m") or ""
            infoloc = props.get("infoloc") or ""
            name = f"{addr}, {cp} {com}".replace("  ", " ").strip(" ,")
            notes = f"{support} ({dim}) {infoloc}".strip() or "Affichage libre"

        else:
            # Générique
            name_cand = (
                props.get("name") or props.get("nom") or props.get("adresse") or
                props.get("emplacement") or props.get("localisation") or props.get("libelle") or
                f"Panneau #{idx+1}"
            )
            name = f"{name_cand}, {city_name}"
            notes = props.get("notes") or props.get("type") or "Panneau d'affichage libre"

        # Nettoyage du nom
        name = re.sub(r"\s+", " ", str(name)).strip(" ,-")

        normalized_features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [round(lon, 6), round(lat, 6)]
            },
            "properties": {
                "id": f"{city_id}_{idx+1}",
                "name": name,
                "city": city_name,
                "type": "Affichage libre",
                "notes": str(notes or "Affichage libre").strip(),
                "street_view": f"https://www.google.com/maps/@{round(lat, 6)},{round(lon, 6)},3a,75y,0h,90t/data=!3m4!1e1!3m2!1s!2e0"
            }
        })

    if not normalized_features:
        print(f"  [!] Aucun panneau valide extrait pour {city_name}")
        return None

    # Calcul du barycentre
    avg_lon = sum(f["geometry"]["coordinates"][0] for f in normalized_features) / len(normalized_features)
    avg_lat = sum(f["geometry"]["coordinates"][1] for f in normalized_features) / len(normalized_features)

    # Sauvegarde du GeoJSON
    out_file = f"{city_id}.geojson"
    out_path = os.path.join(PANELS_DIR, out_file)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({
            "type": "FeatureCollection",
            "metadata": {
                "city": city_name,
                "department": dept,
                "count": len(normalized_features)
            },
            "features": normalized_features
        }, f, ensure_ascii=False, indent=2)

    print(f"  [✓] {city_name} : {len(normalized_features)} panneaux sauvegardés dans data/panels/{out_file} !")

    return {
        "id": city_id,
        "name": city_name,
        "department": dept,
        "count": len(normalized_features),
        "center": [round(avg_lon, 4), round(avg_lat, 4)],
        "file": f"panels/{out_file}"
    }

def main():
    ensure_dirs()
    print("=" * 70)
    print("  COLLECTE ET NORMALISATION DES VILLES D'AFFICHAGE LIBRE")
    print("=" * 70)

    sources = [
        # --- Grandes Métropoles Françaises ---
        {
            "id": "paris",
            "name": "Paris",
            "department": "75 - Paris",
            "url": "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/panneaux_d_affichage_associatifs/exports/geojson",
            "parser": "paris"
        },
        {
            "id": "toulouse",
            "name": "Toulouse Métropole",
            "department": "31 - Haute-Garonne",
            "url": "https://data.toulouse-metropole.fr/api/explore/v2.1/catalog/datasets/panneaux-dexpression-libre-toulouse/exports/geojson",
            "parser": "toulouse"
        },
        {
            "id": "rennes",
            "name": "Rennes Métropole",
            "department": "35 - Ille-et-Vilaine",
            "url": "https://data.rennesmetropole.fr/api/explore/v2.1/catalog/datasets/panneaux_associatifs/exports/geojson",
            "parser": "rennes"
        },
        {
            "id": "tours",
            "name": "Tours Métropole",
            "department": "37 - Indre-et-Loire",
            "url": "https://data.tours-metropole.fr/api/explore/v2.1/catalog/datasets/panneau-daffichage-libre-tours-metropole-val-de-loire/exports/geojson",
            "parser": "tours"
        },
        {
            "id": "angers",
            "name": "Angers Loire Métropole",
            "department": "49 - Maine-et-Loire",
            "url": "https://data.angers.fr/api/explore/v2.1/catalog/datasets/affichage_libre_angers/exports/geojson",
            "parser": "angers"
        },
        {
            "id": "clermont_ferrand",
            "name": "Clermont-Ferrand",
            "department": "63 - Puy-de-Dôme",
            "url": "https://opendata.clermontmetropole.eu/api/explore/v2.1/catalog/datasets/panneaux_d_affichages_associatifs_clermont-ferrand/exports/geojson",
            "parser": "clermont"
        },
        {
            "id": "mulhouse",
            "name": "Mulhouse",
            "department": "68 - Haut-Rhin",
            "url": "https://data.mulhouse-alsace.fr/api/explore/v2.1/catalog/datasets/68224-panneauaffichagelibre_mulhouse/exports/geojson",
            "parser": "mulhouse"
        },
        {
            "id": "chambery",
            "name": "Chambéry (Grand Chambéry)",
            "department": "73 - Savoie",
            "url": "https://static.data.gouv.fr/resources/panneaux-daffichage-publics-de-chambery/20211029-215058/panneaux-d-affichage-publics-grand-chamb-ry.geojson",
            "parser": "chambery"
        },
        {
            "id": "saint_nazaire",
            "name": "Saint-Nazaire",
            "department": "44 - Loire-Atlantique",
            "url": "https://data.agglo-carene.fr/api/explore/v2.1/catalog/datasets/214401846_panneaux_affichage/exports/geojson",
            "parser": "saint_nazaire"
        },
        {
            "id": "soissons",
            "name": "Soissons",
            "department": "02 - Aisne",
            "url": "https://static.data.gouv.fr/resources/localisation-des-panneaux-de-libre-expression-a-soissons/20250623-093440/panneaux-de-libre-expression.geojson",
            "parser": "soissons"
        },
        {
            "id": "talence",
            "name": "Talence (Bordeaux)",
            "department": "33 - Gironde",
            "url": "https://datahub.bordeaux-metropole.fr/api/explore/v2.1/catalog/datasets/tal_panneaux_affichage_libre/exports/geojson",
            "parser": "talence"
        },
        {
            "id": "anglet",
            "name": "Anglet (Pays Basque)",
            "department": "64 - Pyrénées-Atlantiques",
            "url": "https://anglet-opendatapaysbasque.opendatasoft.com/api/explore/v2.1/catalog/datasets/mobilier-urbain-panneaux-d-affichage-libre-de-la-ville-d-anglet/exports/geojson",
            "parser": "anglet"
        },
        {
            "id": "rueil_malmaison",
            "name": "Rueil-Malmaison",
            "department": "92 - Hauts-de-Seine",
            "url": "https://opendata.hauts-de-seine.fr/api/explore/v2.1/catalog/datasets/fr-219200631-panneaux-daffichage/exports/geojson",
            "parser": "rueil"
        },

        # --- Agglomération Lyonnaise (Communes individuelles de data.gouv.fr) ---
        {
            "id": "bron",
            "name": "Bron",
            "department": "69 - Rhône",
            "url": "https://data.grandlyon.com/geoserver/ville-de-bron/ows?SERVICE=WFS&VERSION=2.0.0&request=GetFeature&typename=ville-de-bron:bron.panneauaffichage_latest&outputFormat=application/json&SRSNAME=EPSG:4326",
            "parser": "grand_lyon_wfs"
        },
        {
            "id": "vaulx_en_velin",
            "name": "Vaulx-en-Velin",
            "department": "69 - Rhône",
            "url": "https://data.grandlyon.com/geoserver/ville-de-vaulx-en-velin/ows?SERVICE=WFS&VERSION=2.0.0&request=GetFeature&typename=ville-de-vaulx-en-velin:vaulx.panneauaffichage_latest&outputFormat=application/json&SRSNAME=EPSG:4326",
            "parser": "grand_lyon_wfs"
        },
        {
            "id": "givors",
            "name": "Givors",
            "department": "69 - Rhône",
            "url": "https://data.grandlyon.com/geoserver/ville-de-givors/ows?SERVICE=WFS&VERSION=2.0.0&request=GetFeature&typename=ville-de-givors:panneau-affichage-libre-givors&outputFormat=application/json&SRSNAME=EPSG:4326",
            "parser": "grand_lyon_wfs"
        },
        {
            "id": "dardilly",
            "name": "Dardilly",
            "department": "69 - Rhône",
            "url": "https://data.grandlyon.com/geoserver/ville-de-dardilly/ows?SERVICE=WFS&VERSION=2.0.0&request=GetFeature&typename=ville-de-dardilly:dardilly.panneauaffichage&outputFormat=application/json&SRSNAME=EPSG:4326",
            "parser": "grand_lyon_wfs"
        },
        {
            "id": "neuville_sur_saone",
            "name": "Neuville-sur-Saône",
            "department": "69 - Rhône",
            "url": "https://data.grandlyon.com/geoserver/neuville-sur-saone/ows?SERVICE=WFS&VERSION=2.0.0&request=GetFeature&typename=neuville-sur-saone:panneaux-d-affichage-libre-de-la-commune-de-neuville-sur-saone&outputFormat=application/json&SRSNAME=EPSG:4326",
            "parser": "grand_lyon_wfs"
        },
        {
            "id": "sathonay_camp",
            "name": "Sathonay-Camp",
            "department": "69 - Rhône",
            "url": "https://data.grandlyon.com/geoserver/ville-de-sathonay-camp/ows?SERVICE=WFS&VERSION=2.0.0&request=GetFeature&typename=ville-de-sathonay-camp:panneaux-d-affichage-libre-de-sathonay-camp&outputFormat=application/json&SRSNAME=EPSG:4326",
            "parser": "grand_lyon_wfs"
        },
        {
            "id": "saint_didier_au_mont_d_or",
            "name": "Saint-Didier-au-Mont-d'Or",
            "department": "69 - Rhône",
            "url": "https://data.grandlyon.com/geoserver/ville-de-saint-didier-au-mont-d-or/ows?SERVICE=WFS&VERSION=2.0.0&request=GetFeature&typename=ville-de-saint-didier-au-mont-d-or:saintdidier.panneauaffichage_latest&outputFormat=application/json&SRSNAME=EPSG:4326",
            "parser": "grand_lyon_wfs"
        },
        {
            "id": "champagne_au_mont_d_or",
            "name": "Champagne-au-Mont-d'Or",
            "department": "69 - Rhône",
            "url": "https://data.grandlyon.com/geoserver/ville-de-champagne-au-mont-d-or/ows?SERVICE=WFS&VERSION=2.0.0&request=GetFeature&typename=ville-de-champagne-au-mont-d-or:champagne.panneauaffichage_latest&outputFormat=application/json&SRSNAME=EPSG:4326",
            "parser": "grand_lyon_wfs"
        },
        {
            "id": "saint_cyr_au_mont_d_or",
            "name": "Saint-Cyr-au-Mont-d'Or",
            "department": "69 - Rhône",
            "url": "https://data.grandlyon.com/geoserver/ville-de-saint-cyr-au-mont-d-or/ows?SERVICE=WFS&VERSION=2.0.0&request=GetFeature&typename=ville-de-saint-cyr-au-mont-d-or:saintcyr.panneauaffichage_latest&outputFormat=application/json&SRSNAME=EPSG:4326",
            "parser": "grand_lyon_wfs"
        },
        {
            "id": "charbonnieres_les_bains",
            "name": "Charbonnières-les-Bains",
            "department": "69 - Rhône",
            "url": "https://data.grandlyon.com/geoserver/ville-de-charbonnieres-les-bains/ows?SERVICE=WFS&VERSION=2.0.0&request=GetFeature&typename=ville-de-charbonnieres-les-bains:panneaux-d-affichage-libre-de-la-commune-de-charbonnieres-les-bains&outputFormat=application/json&SRSNAME=EPSG:4326",
            "parser": "grand_lyon_wfs"
        }
    ]

    # Conserver les villes déjà existantes dans cities.json
    cities_file = os.path.join(DATA_DIR, "cities.json")
    existing_index = {}
    if os.path.exists(cities_file):
        try:
            with open(cities_file, "r", encoding="utf-8") as f:
                for c in json.load(f):
                    existing_index[c["id"]] = c
        except Exception:
            pass

    # Traitement de toutes les nouvelles sources
    for src in sources:
        res = process_source(src)
        if res:
            existing_index[res["id"]] = res

    # Tri alphabétique par nom de ville pour une navigation très fluide
    final_list = list(existing_index.values())
    final_list.sort(key=lambda x: x["name"].lower())

    with open(cities_file, "w", encoding="utf-8") as f:
        json.dump(final_list, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 70)
    print(f"🎉 SUCCÈS ! {len(final_list)} villes et métropoles indexées dans data/cities.json !")
    total_panneaux = sum(c.get("count", 0) for c in final_list)
    print(f"📦 Total de panneaux disponibles : {total_panneaux}")
    print("=" * 70)

if __name__ == "__main__":
    main()
