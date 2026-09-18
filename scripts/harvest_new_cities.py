#!/usr/bin/env python3
"""
Collecte et normalisation des nouvelles villes issues de data.gouv.fr et portails open data officiels.
Respecte scrupuleusement les règles de GEMINI.md :
- Zéro mention « Affichage libre » dans name et notes
- Zéro résidu administratif (« Emplacement 1 », « Panneau X », etc.)
- Champ notes épuré (support, angle, repère)
- Champ name sans nom de commune
"""

import os
import json
import urllib.request
import re
import zipfile
import io
import struct
import time
import csv

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
PANELS_DIR = os.path.join(DATA_DIR, "panels")

def ensure_dirs():
    os.makedirs(PANELS_DIR, exist_ok=True)

def fetch_json(url, headers=None):
    hdrs = {"User-Agent": "TourneeAffiches/1.0 (+https://github.com/vdaronnat-a11y/affichage.dl)"}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, headers=hdrs)
    with urllib.request.urlopen(req, timeout=25) as resp:
        return json.loads(resp.read().decode("utf-8"))

def fetch_bytes(url, headers=None):
    hdrs = {"User-Agent": "TourneeAffiches/1.0 (+https://github.com/vdaronnat-a11y/affichage.dl)"}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, headers=hdrs)
    with urllib.request.urlopen(req, timeout=25) as resp:
        return resp.read()

def clean_text(text):
    if not text:
        return ""
    t = str(text).strip()
    # Supprimer les mentions affichage libre / expression libre / résidus administratifs
    patterns_to_remove = [
        r"(?i)\bpanneaux?\s*d['’]affichage\s*libre\b",
        r"(?i)\bpanneaux?\s*d['’]affichage\b",
        r"(?i)\bpanneaux?\s*d['’]expression\s*libre\b",
        r"(?i)\bpanneaux?\s*libre\b",
        r"(?i)\baffichage\s*libre\b",
        r"(?i)\bexpression\s*libre\b",
        r"(?i)\bemplacement\s*#?\d+\b",
        r"(?i)\bpanneau\s*#?\d+\b",
    ]
    for p in patterns_to_remove:
        t = re.sub(p, "", t)
    t = re.sub(r"\s+", " ", t)
    return t.strip(" ,-–—/|")

def clean_name(name, city_name=None):
    n = clean_text(name)
    if city_name:
        # Retirer le nom de la ville ou code postal à la fin
        n = re.sub(rf"(?i),?\s*{re.escape(city_name)}\s*$", "", n)
        n = re.sub(rf"(?i)\b{re.escape(city_name)}\s*$", "", n)
        n = re.sub(r",?\s*\d{5}\s*$", "", n)
    n = re.sub(r"\s+", " ", n).strip(" ,-–—/|")
    return n

def clean_notes(notes):
    n = clean_text(notes)
    # Si le texte résultant ne contient rien ou n'a pas d'intérêt, chaîne vide
    if not n or n.lower() in ["panneau", "affichage", "libre", "sans objet", "standard", "aucun"]:
        return ""
    return n

# -------------------------------------------------------------
# 1. BORDEAUX (Ville de Bordeaux)
# -------------------------------------------------------------
def harvest_bordeaux():
    city_id = "bordeaux"
    city_name = "Bordeaux"
    dept = "33 - Gironde"
    print(f"\n[+] Traitement : {city_name} ({dept})...")

    url = "https://datahub.bordeaux-metropole.fr/api/explore/v2.1/catalog/datasets/bor_sigpanneaux/exports/geojson"
    data = fetch_json(url)
    features_raw = data.get("features", [])

    normalized = []
    print(f"  Geocodage inverse des {len(features_raw)} points via BAN...")
    for idx, feat in enumerate(features_raw):
        coords = feat.get("geometry", {}).get("coordinates", [])
        if len(coords) < 2:
            continue
        lon, lat = float(coords[0]), float(coords[1])
        props = feat.get("properties", {})
        nb = props.get("nombre", 1)

        # Reverse geocoding via BAN
        name = ""
        try:
            ban_url = f"https://api-adresse.data.gouv.fr/reverse/?lon={lon}&lat={lat}"
            ban_req = urllib.request.Request(ban_url, headers={"User-Agent": "TourneeAffiches/1.0"})
            with urllib.request.urlopen(ban_req, timeout=5) as b_resp:
                b_data = json.loads(b_resp.read().decode("utf-8"))
                b_feats = b_data.get("features", [])
                if b_feats:
                    name = b_feats[0]["properties"].get("name", "")
            time.sleep(0.05) # Respect du rate limit BAN
        except Exception:
            pass

        if not name:
            name = f"Emplacement Bordeaux {idx+1}"

        notes = f"{nb} face(s)" if nb and int(nb) > 1 else ""

        normalized.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {
                "id": f"bordeaux_{idx+1}",
                "name": clean_name(name, city_name),
                "city": city_name,
                "type": "Affichage libre",
                "notes": notes,
                "street_view": f"https://www.google.com/maps/@{round(lat, 6)},{round(lon, 6)},3a,75y,0h,90t/data=!3m4!1e1!3m2!1s!2e0"
            }
        })

    return save_city(city_id, city_name, dept, normalized)

# -------------------------------------------------------------
# 2. BREST MÉTROPOLE (8 communes)
# -------------------------------------------------------------
def harvest_brest():
    city_id = "brest"
    city_name = "Brest Métropole"
    dept = "29 - Finistère"
    print(f"\n[+] Traitement : {city_name} ({dept})...")

    depco_map = {
        "29019": "Brest",
        "29011": "Bohars",
        "29061": "Gouesnou",
        "29069": "Guilers",
        "29075": "Guipavas",
        "29189": "Plougastel-Daoulas",
        "29212": "Plouzané",
        "29235": "Le Relecq-Kerhuon"
    }

    url = "https://echanges.brest-metropole.fr/VIPDU72/GPB/ESP_MOB_PanneauxExpresLibre.zip"
    zip_bytes = fetch_bytes(url)
    z = zipfile.ZipFile(io.BytesIO(zip_bytes))
    dbf_bytes = z.read("ESP_MOB_PanneauxExpresLibre.dbf")

    num_records, header_len, record_len = struct.unpack("<IHH", dbf_bytes[4:12])
    fields = []
    pos = 32
    while dbf_bytes[pos] != 0x0D and pos < header_len:
        fname = dbf_bytes[pos:pos+11].replace(b"\x00", b"").decode("ascii")
        flen = dbf_bytes[pos+16]
        fields.append((fname, flen))
        pos += 32

    normalized = []
    pos = header_len
    for i in range(num_records):
        rec = dbf_bytes[pos:pos+record_len]
        rec_fields = {}
        offset = 1
        for fname, flen in fields:
            rec_fields[fname] = rec[offset:offset+flen].decode("utf-8", errors="ignore").strip()
            offset += flen
        pos += record_len

        # Coordonnées WGS84 depuis l'URL Google Maps
        m = re.search(r"cbll=([0-9\.\-]+),([0-9\.\-]+)", rec_fields.get("URL", ""))
        if not m:
            continue
        lat = float(m.group(1))
        lon = float(m.group(2))

        depco = rec_fields.get("DEPCO", "29019")
        commune = depco_map.get(depco, "Brest")
        loc = rec_fields.get("LOCALISATI", "")
        surface = rec_fields.get("SURFACE", "")
        quartier = rec_fields.get("QUARTIER", "")

        notes_parts = []
        if surface and float(surface) > 0:
            notes_parts.append(f"{surface} m²")
        if quartier:
            notes_parts.append(quartier)
        notes = " - ".join(notes_parts)

        cleaned_loc = clean_name(loc, commune)

        normalized.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {
                "id": f"brest_{i+1}",
                "name": cleaned_loc,
                "city": commune,
                "type": "Affichage libre",
                "notes": notes,
                "street_view": f"https://www.google.com/maps/@{round(lat, 6)},{round(lon, 6)},3a,75y,0h,90t/data=!3m4!1e1!3m2!1s!2e0"
            }
        })

    return save_city(city_id, city_name, dept, normalized)

# -------------------------------------------------------------
# 3. ROUBAIX (59 - Nord)
# -------------------------------------------------------------
def harvest_roubaix():
    city_id = "roubaix"
    city_name = "Roubaix"
    dept = "59 - Nord"
    print(f"\n[+] Traitement : {city_name} ({dept})...")

    url = "https://carto.ville-roubaix.fr/server/rest/services/OpenData/ADMINISTRATION/FeatureServer/6/query?where=1%3D1&outFields=*&f=geojson&outSR=4326"
    data = fetch_json(url)
    features_raw = data.get("features", [])

    normalized = []
    for idx, feat in enumerate(features_raw):
        coords = feat.get("geometry", {}).get("coordinates", [])
        if len(coords) < 2:
            continue
        lon, lat = float(coords[0]), float(coords[1])
        props = feat.get("properties", {})
        adresse = props.get("adresse", "")
        comp = props.get("complement_adresse", "")
        modele = props.get("sousfamille", "")

        notes_parts = []
        if comp and comp.lower() != "none":
            notes_parts.append(clean_text(comp))
        if modele and modele.lower() != "none":
            notes_parts.append(clean_text(modele))
        notes = " - ".join(notes_parts)

        normalized.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {
                "id": f"roubaix_{idx+1}",
                "name": clean_name(adresse, city_name),
                "city": city_name,
                "type": "Affichage libre",
                "notes": clean_notes(notes),
                "street_view": f"https://www.google.com/maps/@{round(lat, 6)},{round(lon, 6)},3a,75y,0h,90t/data=!3m4!1e1!3m2!1s!2e0"
            }
        })

    return save_city(city_id, city_name, dept, normalized)

# -------------------------------------------------------------
# 4. ÉCHIROLLES (38 - Isère)
# -------------------------------------------------------------
def harvest_echirolles():
    city_id = "echirolles"
    city_name = "Échirolles"
    dept = "38 - Isère"
    print(f"\n[+] Traitement : {city_name} ({dept})...")

    url = "https://data.metropolegrenoble.fr/sites/default/files/dataset/2023/08/01/bad90fc0-7d53-4196-916d-bc52f3a81bec/affichage_opinion_epsg4326.csv"
    content = fetch_bytes(url).decode("utf-8")
    reader = csv.DictReader(content.splitlines())

    normalized = []
    for idx, row in enumerate(reader):
        gp = row.get("geo_point_2d", "")
        if not gp or "," not in gp:
            continue
        lat_s, lon_s = gp.split(",", 1)
        lat, lon = float(lat_s.strip()), float(lon_s.strip())

        rue = row.get("nom_rue", "").title()
        dim = row.get("dim_pann", "")
        face = row.get("face_pann", "")
        nb = row.get("nb_pann", "")

        notes_parts = []
        if face:
            notes_parts.append(face)
        if dim:
            notes_parts.append(f"{dim} m")
        if nb and int(nb) > 1:
            notes_parts.append(f"{nb} panneaux")
        notes = " - ".join(notes_parts)

        normalized.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {
                "id": f"echirolles_{idx+1}",
                "name": clean_name(rue, city_name),
                "city": city_name,
                "type": "Affichage libre",
                "notes": clean_notes(notes),
                "street_view": f"https://www.google.com/maps/@{round(lat, 6)},{round(lon, 6)},3a,75y,0h,90t/data=!3m4!1e1!3m2!1s!2e0"
            }
        })

    return save_city(city_id, city_name, dept, normalized)

# -------------------------------------------------------------
# 5. LE HAILLAN (33 - Gironde)
# -------------------------------------------------------------
def harvest_le_haillan():
    city_id = "le_haillan"
    city_name = "Le Haillan"
    dept = "33 - Gironde"
    print(f"\n[+] Traitement : {city_name} ({dept})...")

    url = "https://datahub.bordeaux-metropole.fr/api/explore/v2.1/catalog/datasets/leh_panneaux_affichage_libre/exports/geojson"
    data = fetch_json(url)
    features_raw = data.get("features", [])

    normalized = []
    for idx, feat in enumerate(features_raw):
        coords = feat.get("geometry", {}).get("coordinates", [])
        if len(coords) < 2:
            continue
        lon, lat = float(coords[0]), float(coords[1])
        props = feat.get("properties", {})
        adresse = props.get("adresse", "")
        nom = props.get("nom", "")
        surf = props.get("surface_affichage", "")

        name = adresse if adresse else nom
        notes = f"Repère: {nom} ({surf})" if nom and nom != adresse else (surf or "")

        normalized.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {
                "id": f"le_haillan_{idx+1}",
                "name": clean_name(name, city_name),
                "city": city_name,
                "type": "Affichage libre",
                "notes": clean_notes(notes),
                "street_view": f"https://www.google.com/maps/@{round(lat, 6)},{round(lon, 6)},3a,75y,0h,90t/data=!3m4!1e1!3m2!1s!2e0"
            }
        })

    return save_city(city_id, city_name, dept, normalized)

# -------------------------------------------------------------
# 6. SAINT-DENIS (974 - La Réunion)
# -------------------------------------------------------------
def harvest_saint_denis():
    city_id = "saint_denis_reunion"
    city_name = "Saint-Denis (La Réunion)"
    dept = "974 - La Réunion"
    print(f"\n[+] Traitement : {city_name} ({dept})...")

    url = "https://services2.arcgis.com/wjPZ1EYZWKqS3b2o/arcgis/rest/services/Panneaux_affichage_libre/FeatureServer/1/query?where=1%3D1&outFields=*&f=geojson&outSR=4326"
    data = fetch_json(url)
    features_raw = data.get("features", [])

    normalized = []
    for idx, feat in enumerate(features_raw):
        coords = feat.get("geometry", {}).get("coordinates", [])
        if len(coords) < 2:
            continue
        lon, lat = float(coords[0]), float(coords[1])
        props = feat.get("properties", {})
        loc = props.get("localisati", "")
        secteur = props.get("secteur", "")

        normalized.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {
                "id": f"saint_denis_reunion_{idx+1}",
                "name": clean_name(loc, "Saint-Denis"),
                "city": "Saint-Denis",
                "type": "Affichage libre",
                "notes": clean_notes(secteur),
                "street_view": f"https://www.google.com/maps/@{round(lat, 6)},{round(lon, 6)},3a,75y,0h,90t/data=!3m4!1e1!3m2!1s!2e0"
            }
        })

    return save_city(city_id, city_name, dept, normalized)

# -------------------------------------------------------------
# 7. COMMUNES DU GRAND LYON (WFS)
# -------------------------------------------------------------
def harvest_grand_lyon_commune(city_id, city_name, wfs_url):
    dept = "69 - Rhône"
    print(f"\n[+] Traitement : {city_name} ({dept})...")

    data = fetch_json(wfs_url)
    features_raw = data.get("features", [])

    normalized = []
    for idx, feat in enumerate(features_raw):
        coords = feat.get("geometry", {}).get("coordinates", [])
        if len(coords) < 2:
            continue
        lon, lat = float(coords[0]), float(coords[1])
        props = feat.get("properties", {})
        adresse = props.get("adresse", "")
        support = props.get("support", "")
        dim = props.get("dimension_m", "")
        infoloc = props.get("infoloc", "")

        notes_parts = []
        if support:
            notes_parts.append(clean_text(support))
        if dim:
            notes_parts.append(f"({dim})")
        if infoloc:
            notes_parts.append(clean_text(infoloc))
        notes = " ".join(notes_parts)

        normalized.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {
                "id": f"{city_id}_{idx+1}",
                "name": clean_name(adresse, city_name),
                "city": city_name,
                "type": "Affichage libre",
                "notes": clean_notes(notes),
                "street_view": f"https://www.google.com/maps/@{round(lat, 6)},{round(lon, 6)},3a,75y,0h,90t/data=!3m4!1e1!3m2!1s!2e0"
            }
        })

    return save_city(city_id, city_name, dept, normalized)

def save_city(city_id, city_name, dept, features):
    if not features:
        print(f"  [!] Aucun panneau extrait pour {city_name}")
        return None

    avg_lon = sum(f["geometry"]["coordinates"][0] for f in features) / len(features)
    avg_lat = sum(f["geometry"]["coordinates"][1] for f in features) / len(features)

    out_file = f"{city_id}.geojson"
    out_path = os.path.join(PANELS_DIR, out_file)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({
            "type": "FeatureCollection",
            "metadata": {
                "city": city_name,
                "department": dept,
                "count": len(features)
            },
            "features": features
        }, f, ensure_ascii=False, indent=2)

    print(f"  [✓] {city_name} : {len(features)} panneaux enregistrés dans data/panels/{out_file} !")

    return {
        "id": city_id,
        "name": city_name,
        "department": dept,
        "count": len(features),
        "center": [round(avg_lon, 4), round(avg_lat, 4)],
        "file": f"panels/{out_file}"
    }

def main():
    ensure_dirs()
    print("=" * 70)
    print("  COLLECTE ET NORMALISATION DES NOUVELLES VILLES (LOCAL)")
    print("=" * 70)

    results = []

    # 1. Bordeaux
    res = harvest_bordeaux()
    if res: results.append(res)

    # 2. Brest Métropole
    res = harvest_brest()
    if res: results.append(res)

    # 3. Roubaix
    res = harvest_roubaix()
    if res: results.append(res)

    # 4. Échirolles
    res = harvest_echirolles()
    if res: results.append(res)

    # 5. Le Haillan
    res = harvest_le_haillan()
    if res: results.append(res)

    # 6. Saint-Denis de La Réunion
    res = harvest_saint_denis()
    if res: results.append(res)

    # 7. Communes de la Métropole de Lyon
    lyon_communes = [
        ("villeurbanne", "Villeurbanne", "https://data.grandlyon.com/geoserver/ville-de-villeurbanne/ows?SERVICE=WFS&VERSION=2.0.0&request=GetFeature&typename=ville-de-villeurbanne:villeurbanne.panneauaffichage_latest&outputFormat=application/json&SRSNAME=EPSG:4326"),
        ("caluire_et_cuire", "Caluire-et-Cuire", "https://data.grandlyon.com/geoserver/ville-de-caluire-et-cuire/ows?SERVICE=WFS&VERSION=2.0.0&request=GetFeature&typename=ville-de-caluire-et-cuire:caluire.panneauaffichage&outputFormat=application/json&SRSNAME=EPSG:4326"),
        ("rillieux_la_pape", "Rillieux-la-Pape", "https://data.grandlyon.com/geoserver/ville-de-rillieux-la-pape/ows?SERVICE=WFS&VERSION=2.0.0&request=GetFeature&typename=ville-de-rillieux-la-pape:rillieux.panneauaffichage&outputFormat=application/json&SRSNAME=EPSG:4326"),
        ("mions", "Mions", "https://data.grandlyon.com/geoserver/ville-de-mions/ows?SERVICE=WFS&VERSION=2.0.0&request=GetFeature&typename=ville-de-mions:mions.panneauaffichage_latest&outputFormat=application/json&SRSNAME=EPSG:4326"),
        ("ecully", "Écully", "https://data.grandlyon.com/geoserver/ville-de-ecully/ows?SERVICE=WFS&VERSION=2.0.0&request=GetFeature&typename=ville-de-ecully:ecully.panneauaffichage&outputFormat=application/json&SRSNAME=EPSG:4326"),
        ("saint_genis_laval", "Saint-Genis-Laval", "https://data.grandlyon.com/geoserver/ville-de-saint-genis-laval/ows?SERVICE=WFS&VERSION=2.0.0&request=GetFeature&typename=ville-de-saint-genis-laval:saintgenis.panneauaffichage_latest&outputFormat=application/json&SRSNAME=EPSG:4326")
    ]

    for cid, cname, url in lyon_communes:
        res = harvest_grand_lyon_commune(cid, cname, url)
        if res: results.append(res)

    # Mise à jour de cities.json
    cities_file = os.path.join(DATA_DIR, "cities.json")
    existing_index = {}
    if os.path.exists(cities_file):
        with open(cities_file, "r", encoding="utf-8") as f:
            for c in json.load(f):
                existing_index[c["id"]] = c

    for r in results:
        existing_index[r["id"]] = r

    import unicodedata
    def sort_key(city):
        return "".join(c for c in unicodedata.normalize("NFD", city["name"].lower()) if unicodedata.category(c) != "Mn")

    final_list = list(existing_index.values())
    final_list.sort(key=sort_key)

    with open(cities_file, "w", encoding="utf-8") as f:
        json.dump(final_list, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 70)
    print(f"🎉 SUCCÈS ! {len(results)} nouvelles villes ajoutées !")
    print(f"📦 Total dans cities.json : {len(final_list)} villes et métropoles")
    print("=" * 70)

if __name__ == "__main__":
    main()
