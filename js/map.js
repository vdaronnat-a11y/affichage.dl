/**
 * Module de gestion de la carte Leaflet
 * Affichage des panneaux, des tracés d'itinéraire et des interactions
 */

export class TourMap {
  constructor(containerId, onAddPanelCallback, onRemovePanelCallback) {
    this.containerId = containerId;
    this.onAddPanel = onAddPanelCallback;
    this.onRemovePanel = onRemovePanelCallback;
    this.map = null;
    
    // Groupes de couches
    this.startMarker = null;
    this.activePanelsGroup = null;
    this.unusedPanelsGroup = null;
    this.routePolyline = null;
    this.targetMarker = null;

    this.initMap();
  }

  initMap() {
    // Initialisation centrée sur Lyon par défaut
    this.map = L.map(this.containerId, {
      zoomControl: false
    }).setView([45.7640, 4.8357], 13);

    // Repositionner le contrôle de zoom en haut à droite
    L.control.zoom({ position: "topright" }).addTo(this.map);

    // Fond de carte OpenStreetMap clair/standard haute lisibilité
    L.tileLayer("https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19
    }).addTo(this.map);

    this.activePanelsGroup = L.layerGroup().addTo(this.map);
    this.unusedPanelsGroup = L.layerGroup().addTo(this.map);
  }

  /**
   * Définit le point de départ avec un marqueur spécial vert
   */
  setStartPoint(coords, label = "Point de départ") {
    if (this.startMarker) {
      this.map.removeLayer(this.startMarker);
    }

    const icon = L.divIcon({
      className: "custom-div-icon",
      html: `<div class="marker-start" title="${label}">🚗</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    this.startMarker = L.marker([coords[1], coords[0]], { icon }).addTo(this.map);
    this.startMarker.bindPopup(`<b>${label}</b><br><small>Coordonnées: ${coords[1].toFixed(4)}, ${coords[0].toFixed(4)}</small>`);
  }

  /**
   * Met à jour les panneaux de la ville non sélectionnés dans la tournée actuelle
   */
  setUnusedPanels(panels) {
    this.unusedPanelsGroup.clearLayers();

    panels.forEach(panel => {
      const coords = panel.geometry.coordinates;
      const props = panel.properties;

      const icon = L.divIcon({
        className: "custom-div-icon",
        html: `<div class="marker-panel-unused" title="${props.name}"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });

      const marker = L.marker([coords[1], coords[0]], { icon });
      
      const notes = (props.notes || '').trim();
      const notesHtml = notes ? `<small style="color: #64748b;">${notes}</small><br>` : '';

      const popupContent = `
        <div style="font-size: 0.9rem; min-width: 180px;">
          <b>${props.name}</b><br>
          ${notesHtml}
          <button id="btn-add-${props.id}" style="margin-top: 8px; width: 100%; background: #0284c7; color: white; border: none; padding: 6px; border-radius: 6px; font-weight: bold; cursor: pointer;">
            ➕ Ajouter à ma tournée
          </button>
        </div>
      `;

      marker.bindPopup(popupContent);
      marker.on("popupopen", () => {
        const btn = document.getElementById(`btn-add-${props.id}`);
        if (btn) {
          btn.addEventListener("click", () => {
            this.map.closePopup();
            if (this.onAddPanel) this.onAddPanel(panel);
          });
        }
      });

      this.unusedPanelsGroup.addLayer(marker);
    });
  }

  /**
   * Met à jour la liste des panneaux retenus avec leurs numéros d'étape (1..N)
   */
  setActivePanels(orderedPanels, currentTargetIndex = -1) {
    this.activePanelsGroup.clearLayers();

    orderedPanels.forEach((panel, idx) => {
      const coords = panel.geometry.coordinates;
      const props = panel.properties;
      const stepNum = idx + 1;

      let markerClass = "marker-panel-active";
      if (currentTargetIndex === idx) {
        markerClass += " marker-panel-target";
      } else if (currentTargetIndex > idx) {
        markerClass += " marker-panel-completed";
      }

      const icon = L.divIcon({
        className: "custom-div-icon",
        html: `<div class="${markerClass}">${currentTargetIndex > idx ? "✓" : stepNum}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });

      const marker = L.marker([coords[1], coords[0]], { icon });
      
      const notes = (props.notes || '').trim();
      const notesHtml = notes ? `<small style="color: #64748b;">${notes}</small><br>` : '';

      const popupContent = `
        <div style="font-size: 0.9rem; min-width: 180px;">
          <b style="color: #0284c7;">Étape #${stepNum}</b><br>
          <b>${props.name}</b><br>
          ${notesHtml}
          <button id="btn-remove-${props.id}" style="margin-top: 8px; width: 100%; background: #ef4444; color: white; border: none; padding: 6px; border-radius: 6px; font-weight: bold; cursor: pointer;">
            ❌ Retirer de la tournée
          </button>
        </div>
      `;

      marker.bindPopup(popupContent);
      marker.on("popupopen", () => {
        const btn = document.getElementById(`btn-remove-${props.id}`);
        if (btn) {
          btn.addEventListener("click", () => {
            this.map.closePopup();
            if (this.onRemovePanel) this.onRemovePanel(panel);
          });
        }
      });

      this.activePanelsGroup.addLayer(marker);
    });
  }

  /**
   * Dessine la polyline de l'itinéraire sur la route
   */
  setRoutePolyline(polylineCoords) {
    if (this.routePolyline) {
      this.map.removeLayer(this.routePolyline);
      this.routePolyline = null;
    }

    if (!polylineCoords || polylineCoords.length === 0) return;

    // Convertir [lon, lat] en [lat, lon] pour Leaflet
    const latLngs = polylineCoords.map(c => [c[1], c[0]]);

    this.routePolyline = L.polyline(latLngs, {
      color: "#2563eb",
      weight: 5,
      opacity: 0.85,
      lineCap: "round",
      lineJoin: "round"
    }).addTo(this.map);

    // Ajuster le zoom pour englober tout le tracé
    this.map.fitBounds(this.routePolyline.getBounds(), {
      padding: [40, 40],
      maxZoom: 16
    });
  }

  /**
   * Centre la carte sur un panneau spécifique
   */
  focusPanel(panel) {
    const coords = panel.geometry.coordinates;
    this.map.setView([coords[1], coords[0]], 16, { animate: true });
  }

  /**
   * Recentrer sur la ville entière
   */
  focusCity(centerCoords, zoom = 13) {
    this.map.setView([centerCoords[1], centerCoords[0]], zoom, { animate: true });
  }
}
