/**
 * Module d'Administration :
 * - Ajout et importation de nouvelles villes (GeoJSON / CSV)
 * - Export vers Google My Maps (format KML et CSV)
 */

export class TourAdmin {
  constructor(options) {
    this.onCityAdded = options.onCityAdded;
    this.initModal();
  }

  initModal() {
    this.modalEl = document.getElementById("admin-modal");
    this.formEl = document.getElementById("admin-add-city-form");
    this.btnCloseEl = document.getElementById("btn-close-admin");
    this.fileInputEl = document.getElementById("admin-city-file");
    this.btnExportMyMapsEl = document.getElementById("btn-export-mymaps");

    if (this.btnCloseEl) {
      this.btnCloseEl.addEventListener("click", () => this.close());
    }

    if (this.formEl) {
      this.formEl.addEventListener("submit", (e) => this.handleSubmit(e));
    }

    if (this.btnExportMyMapsEl) {
      this.btnExportMyMapsEl.addEventListener("click", () => this.exportCurrentCityToMyMaps());
    }

    this.webhookInputEl = document.getElementById("admin-webhook-url");
    this.btnSaveWebhookEl = document.getElementById("btn-save-webhook");
    this.webhookStatusEl = document.getElementById("webhook-save-status");

    if (this.webhookInputEl) {
      this.webhookInputEl.value = localStorage.getItem("tour_tracker_webhook_url") || "";
    }

    if (this.btnSaveWebhookEl) {
      this.btnSaveWebhookEl.addEventListener("click", () => {
        const url = (this.webhookInputEl.value || "").trim();
        if (url) {
          localStorage.setItem("tour_tracker_webhook_url", url);
          if (window.tourTracker) window.tourTracker.setWebhookUrl(url);
          this.webhookStatusEl.textContent = "✅ URL enregistrée ! Vos tournées seront envoyées sur ce Google Sheet.";
        } else {
          localStorage.removeItem("tour_tracker_webhook_url");
          if (window.tourTracker) window.tourTracker.setWebhookUrl("");
          this.webhookStatusEl.textContent = "ℹ️ Webhook désactivé.";
        }
        setTimeout(() => { if (this.webhookStatusEl) this.webhookStatusEl.textContent = ""; }, 3500);
      });
    }
  }

  open() {
    this.modalEl.classList.add("active");
  }

  close() {
    this.modalEl.classList.remove("active");
  }

  async handleSubmit(e) {
    e.preventDefault();

    const cityName = document.getElementById("admin-city-name").value.trim();
    const department = document.getElementById("admin-city-dept").value.trim() || "France";
    const file = this.fileInputEl.files[0];

    if (!cityName) {
      alert("Veuillez renseigner le nom de la ville.");
      return;
    }

    if (!file) {
      alert("Veuillez sélectionner un fichier GeoJSON ou CSV contenant les panneaux.");
      return;
    }

    try {
      const text = await file.text();
      let features = [];

      if (file.name.endsWith(".geojson") || file.name.endsWith(".json")) {
        features = this.parseGeoJSON(text, cityName);
      } else if (file.name.endsWith(".csv")) {
        features = this.parseCSV(text, cityName);
      } else {
        alert("Format non supporté. Veuillez choisir un fichier .geojson, .json ou .csv");
        return;
      }

      if (features.length === 0) {
        alert("Aucun panneau avec coordonnées valides n'a pu être extrait de ce fichier.");
        return;
      }

      // Calcul du centre
      const avgLon = features.reduce((sum, f) => sum + f.geometry.coordinates[0], 0) / features.length;
      const avgLat = features.reduce((sum, f) => sum + f.geometry.coordinates[1], 0) / features.length;

      const cityId = "custom_" + cityName.toLowerCase().replace(/[^a-z0-9]/g, "_") + "_" + Date.now();
      const newCity = {
        id: cityId,
        name: cityName,
        department: department,
        count: features.length,
        center: [avgLon, avgLat],
        isCustom: true
      };

      const geojsonData = {
        type: "FeatureCollection",
        metadata: { city: cityName, count: features.length },
        features: features
      };

      // Sauvegarde dans le LocalStorage du navigateur (garantissant un fonctionnement même sur GitHub Pages)
      localStorage.setItem(`city_${cityId}`, JSON.stringify({ meta: newCity, geojson: geojsonData }));

      // Si le serveur local est actif, essayer aussi d'enregistrer sur disque
      try {
        await fetch("/api/cities/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ city: newCity, geojson: geojsonData })
        });
      } catch (err) {
        // Mode statique sans serveur Python, rien de grave
      }

      alert(`Succès ! La ville "${cityName}" avec ${features.length} panneaux a été ajoutée.`);
      this.close();

      if (this.onCityAdded) {
        this.onCityAdded(newCity, geojsonData);
      }
    } catch (err) {
      console.error(err);
      alert(`Erreur lors du traitement du fichier : ${err.message}`);
    }
  }

  parseGeoJSON(text, cityName) {
    const data = JSON.parse(text);
    const rawList = data.features || (Array.isArray(data) ? data : []);
    const features = [];

    rawList.forEach((item, idx) => {
      let coords = null;
      if (item.geometry && item.geometry.coordinates) {
        coords = item.geometry.coordinates;
      } else if (item.coordinates) {
        coords = item.coordinates;
      }

      if (coords && coords.length >= 2) {
        const props = item.properties || item;
        const name = props.name || props.adresse || props.libelle || `Panneau #${idx + 1}`;
        features.append({
          type: "Feature",
          geometry: { type: "Point", coordinates: [parseFloat(coords[0]), parseFloat(coords[1])] },
          properties: {
            id: String(props.id || idx + 1),
            name: `${name}, ${cityName}`,
            city: cityName,
            type: "Affichage libre",
            notes: props.notes || props.type || ""
          }
        });
      }
    });
    return features;
  }

  parseCSV(text, cityName) {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) return [];

    // Détection du séparateur (, ou ;)
    const sep = lines[0].includes(";") ? ";" : ",";
    const headers = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/"/g, ""));

    const latIdx = headers.findIndex(h => ["latitude", "lat", "y"].includes(h));
    const lonIdx = headers.findIndex(h => ["longitude", "lon", "lng", "x"].includes(h));
    const nameIdx = headers.findIndex(h => ["nom", "name", "adresse", "emplacement", "libelle"].includes(h));

    if (latIdx === -1 || lonIdx === -1) {
      alert("Le fichier CSV doit contenir des colonnes 'latitude' et 'longitude' (ou 'lat'/'lng').");
      return [];
    }

    const features = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(sep).map(p => p.trim().replace(/"/g, ""));
      if (parts.length <= Math.max(latIdx, lonIdx)) continue;

      const lat = parseFloat(parts[latIdx].replace(",", "."));
      const lon = parseFloat(parts[lonIdx].replace(",", "."));

      if (isNaN(lat) || isNaN(lon)) continue;

      const name = (nameIdx !== -1 && parts[nameIdx]) ? parts[nameIdx] : `Panneau #${i}`;

      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: {
          id: `csv_${i}`,
          name: `${name}, ${cityName}`,
          city: cityName,
          type: "Affichage libre",
          notes: ""
        }
      });
    }
    return features;
  }

  /**
   * Génère et télécharge un fichier CSV formaté spécialement pour Google My Maps
   */
  exportToGoogleMyMapsCSV(cityName, panels) {
    if (!panels || panels.length === 0) {
      alert("Aucun panneau à exporter pour cette ville.");
      return;
    }

    let csvContent = "Nom,Latitude,Longitude,Description,Ville\n";
    panels.forEach(p => {
      const coords = p.geometry.coordinates;
      const props = p.properties;
      const name = `"${(props.name || '').replace(/"/g, '""')}"`;
      const desc = `"${(props.notes || props.type || 'Panneau affichage libre').replace(/"/g, '""')}"`;
      const city = `"${(props.city || cityName).replace(/"/g, '""')}"`;
      csvContent += `${name},${coords[1]},${coords[0]},${desc},${city}\n`;
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `panneaux_affichage_libre_${cityName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_mymaps.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Génère et télécharge un fichier KML standard directement importable dans Google My Maps
   */
  exportToGoogleMyMapsKML(cityName, panels) {
    if (!panels || panels.length === 0) {
      alert("Aucun panneau à exporter pour cette ville.");
      return;
    }

    let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Panneaux d'affichage libre - ${cityName}</name>
    <description>Emplacements d'affichage libre pour collage d'affiches citoyen et associatif</description>
`;

    panels.forEach(p => {
      const coords = p.geometry.coordinates;
      const props = p.properties;
      kml += `    <Placemark>
      <name><![CDATA[${props.name || 'Panneau libre'}]]></name>
      <description><![CDATA[${props.notes || props.type || 'Affichage libre'}]]></description>
      <Point>
        <coordinates>${coords[0]},${coords[1]},0</coordinates>
      </Point>
    </Placemark>\n`;
    });

    kml += `  </Document>
</kml>`;

    const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `panneaux_${cityName.toLowerCase().replace(/[^a-z0-9]/g, '_')}.kml`;
    link.click();
    URL.revokeObjectURL(url);
  }
}
