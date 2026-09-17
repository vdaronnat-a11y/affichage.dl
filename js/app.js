/**
 * Contrôleur principal de l'application Tournée Affiches
 */

import { TourMap } from "./map.js?v=3.3";
import { TourRouter } from "./router.js?v=3.2";
import { TourGuidance } from "./guidance.js?v=3.3";
import { TourAdmin } from "./admin.js?v=3.2";
import { TourTracker } from "./tracker.js?v=3.2";
import { checkIsMultiCityTour, formatPanelDisplayName } from "./utils.js?v=3.3";

class TourApp {
  constructor() {
    this.cities = [];
    this.activeCity = null;
    this.activePanelsData = null; // Collection GeoJSON complète de la ville
    this.selectedPanels = []; // Panneaux retenus pour la tournée
    this.orderedPanels = []; // Panneaux ordonnés dans la boucle
    this.startCoord = null; // [lon, lat]
    this.startAddress = "";
    this.targetCount = 10;

    this.map = null;
    this.router = null;
    this.guidance = null;
    this.admin = null;
    this.tracker = null;

    this.debounceTimer = null;
  }

  async init() {
    this.initMapAndServices();
    this.initDOM();
    await this.loadCities();
    this.setupEventListeners();
  }

  initMapAndServices() {
    this.tracker = new TourTracker();
    window.tourTracker = this.tracker;

    this.map = new TourMap(
      "map-container",
      (panelToAdd) => this.handleAddPanel(panelToAdd),
      (panelToRemove) => this.handleRemovePanel(panelToRemove)
    );

    this.router = new TourRouter();

    this.guidance = new TourGuidance({
      container: document.getElementById("guidance-overlay"),
      map: this.map,
      tracker: this.tracker,
      onFinish: (stats) => this.showFinishedModal(stats),
      onExit: () => this.exitGuidance()
    });

    this.admin = new TourAdmin({
      onCityAdded: (newCity, geojsonData) => {
        this.cities.unshift(newCity);
        this.renderCitiesDropdown();
        this.selectCity(newCity.id);
      }
    });
  }

  initDOM() {
    this.citySelectEl = document.getElementById("city-select");
    this.activeCityBadgeEl = document.getElementById("active-city-badge");
    this.addressInputEl = document.getElementById("start-address");
    this.btnClearAddressEl = document.getElementById("btn-clear-address");
    this.suggestionsEl = document.getElementById("address-suggestions");
    this.btnGpsEl = document.getElementById("btn-gps");
    this.btnCalculateEl = document.getElementById("btn-calculate-tour");
    
    this.configStepEl = document.getElementById("step-config");
    this.reviewStepEl = document.getElementById("step-review");
    this.sidePanelEl = document.getElementById("side-panel");
    this.bottomSheetHandleEl = document.getElementById("bottom-sheet-handle");
    
    this.panelsListEl = document.getElementById("panels-list");
    this.summaryCountEl = document.getElementById("summary-count");
    this.summaryDistanceEl = document.getElementById("summary-distance");
    this.summaryTimeEl = document.getElementById("summary-time");

    this.btnStartGuidanceEl = document.getElementById("btn-start-guidance");
    this.btnRecalculateEl = document.getElementById("btn-recalculate");
    this.btnModifyConfigEl = document.getElementById("btn-modify-config");
    this.btnAdminEl = document.getElementById("btn-admin");
    
    // N'afficher le bouton Admin QUE si l'application tourne en local (localhost / 192.168... / .local)
    // Dès publication sur GitHub Pages (*.github.io), le bouton est invisible pour les utilisateurs
    const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname) || 
                    window.location.hostname.startsWith("192.168.") || 
                    window.location.hostname.endsWith(".local");
    if (this.btnAdminEl) {
      this.btnAdminEl.style.display = isLocal ? "flex" : "none";
    }

    this.congratsModalEl = document.getElementById("congrats-modal");
    this.btnCloseCongratsEl = document.getElementById("btn-close-congrats");
  }

  async loadCities() {
    try {
      const resp = await fetch("data/cities.json");
      if (resp.ok) {
        this.cities = await resp.json();
      }
    } catch (e) {
      console.warn("Impossible de charger data/cities.json:", e);
    }

    // Charger les éventuelles villes ajoutées par l'administrateur dans le localStorage
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith("city_custom_")) {
        try {
          const item = JSON.parse(localStorage.getItem(key));
          if (item && item.meta) {
            this.cities.unshift(item.meta);
          }
        } catch (e) {}
      }
    }

    this.renderCitiesDropdown();

    // Sélectionner la première ville (Lyon si disponible, ou Nantes)
    const defaultCity = this.cities.find(c => c.id === "lyon") || this.cities[0];
    if (defaultCity) {
      this.selectCity(defaultCity.id);
    }
  }

  renderCitiesDropdown() {
    this.citySelectEl.innerHTML = "";
    this.cities.forEach(city => {
      const opt = document.createElement("option");
      opt.value = city.id;
      opt.textContent = `${city.name} (${city.count} panneaux)`;
      this.citySelectEl.appendChild(opt);
    });
  }

  async selectCity(cityId) {
    const city = this.cities.find(c => c.id === cityId);
    if (!city) return;

    this.activeCity = city;
    this.citySelectEl.value = city.id;
    this.activeCityBadgeEl.innerHTML = `📍 ${city.name} (${city.count} panneaux)`;

    // Recentrer la carte
    this.map.focusCity(city.center, 13);

    // Charger les panneaux GeoJSON de la ville
    await this.loadPanelsData(city);

    // Initialiser par défaut le point de départ au centre de la ville si aucun point n'est défini
    if (!this.startCoord) {
      this.startCoord = city.center;
      this.startAddress = `Centre-ville de ${city.name}`;
      this.addressInputEl.value = this.startAddress;
      this.updateClearBtnVisibility();
      this.map.setStartPoint(this.startCoord, this.startAddress);
    }
  }

  updateClearBtnVisibility() {
    if (this.btnClearAddressEl) {
      this.btnClearAddressEl.style.display = this.addressInputEl && this.addressInputEl.value.trim().length > 0 ? "flex" : "none";
    }
  }

  async loadPanelsData(city) {
    // Vérifier d'abord le localStorage pour une ville personnalisée
    const customKey = `city_${city.id}`;
    const customItem = localStorage.getItem(customKey);
    if (customItem) {
      try {
        const parsed = JSON.parse(customItem);
        this.activePanelsData = parsed.geojson;
        this.map.setUnusedPanels(this.activePanelsData.features);
        return;
      } catch (e) {}
    }

    // Sinon charger le fichier statique data/panels/...
    try {
      const resp = await fetch(`data/${city.file}`);
      if (resp.ok) {
        this.activePanelsData = await resp.json();
        this.map.setUnusedPanels(this.activePanelsData.features);
      }
    } catch (e) {
      console.error("Erreur chargement des panneaux de la ville:", e);
    }
  }

  setupEventListeners() {
    // Changement de ville
    this.citySelectEl.addEventListener("change", (e) => {
      this.startCoord = null;
      this.selectCity(e.target.value);
    });

    // Clic sur le badge de ville pour ouvrir le sélecteur
    this.activeCityBadgeEl.addEventListener("click", () => {
      this.citySelectEl.focus();
    });

    // Boutons de quantité de panneaux (5, 10, 15, 20)
    document.querySelectorAll(".count-pill-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        document.querySelectorAll(".count-pill-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this.targetCount = parseInt(btn.dataset.count, 10);
      });
    });

    // Géolocalisation par GPS
    this.btnGpsEl.addEventListener("click", () => this.geolocateUser());

    // Effacer l'adresse de départ
    if (this.btnClearAddressEl) {
      this.btnClearAddressEl.addEventListener("click", () => {
        this.addressInputEl.value = "";
        this.startCoord = null;
        this.startAddress = "";
        this.suggestionsEl.style.display = "none";
        this.btnGpsEl.innerHTML = `📍 GPS`;
        this.addressInputEl.focus();
        this.updateClearBtnVisibility();
      });
    }

    // Recherche d'adresse BAN avec autocomplétion
    this.addressInputEl.addEventListener("input", (e) => {
      this.updateClearBtnVisibility();
      clearTimeout(this.debounceTimer);
      const query = e.target.value.trim();
      if (query.length < 3) {
        this.suggestionsEl.style.display = "none";
        return;
      }
      this.debounceTimer = setTimeout(() => this.searchAddressBAN(query), 250);
    });

    // Clic en dehors pour fermer les suggestions
    document.addEventListener("click", (e) => {
      if (!this.addressInputEl.contains(e.target) && !this.suggestionsEl.contains(e.target)) {
        this.suggestionsEl.style.display = "none";
      }
    });

    // Bouton de calcul de tournée
    this.btnCalculateEl.addEventListener("click", () => this.generateTour());

    // Bouton Abandonner la tournée et recommencer
    this.btnModifyConfigEl.addEventListener("click", () => {
      this.reviewStepEl.style.display = "none";
      this.configStepEl.style.display = "flex";
      this.selectedPanels = [];
      this.orderedPanels = [];
      if (this.map) {
        this.map.setRoutePolyline([]);
        this.map.setActivePanels([]);
        if (this.activePanelsData) {
          this.map.setUnusedPanels(this.activePanelsData.features);
        }
      }
    });

    // Tirette centrale de rabattement (barre de 50%)
    const pullHandle = document.querySelector(".sheet-pull-handle");
    if (pullHandle) {
      pullHandle.addEventListener("click", () => {
        this.sidePanelEl.classList.add("collapsed");
      });
      let pullStartY = null;
      pullHandle.addEventListener("touchstart", (e) => {
        pullStartY = e.touches[0].clientY;
      }, { passive: true });
      pullHandle.addEventListener("touchmove", (e) => {
        if (pullStartY === null) return;
        const diff = e.touches[0].clientY - pullStartY;
        if (diff > 15) {
          this.sidePanelEl.classList.add("collapsed");
          pullStartY = null;
        }
      }, { passive: true });
      pullHandle.addEventListener("touchend", () => {
        pullStartY = null;
      }, { passive: true });
    }

    // Bouton recalculer
    this.btnRecalculateEl.addEventListener("click", () => this.recomputeRoute());

    // Bouton lancement du guidage
    this.btnStartGuidanceEl.addEventListener("click", () => this.startGuidance());

    // Poignée tactile flottante basse (▲ Détails tournée ▲)
    if (this.bottomSheetHandleEl) {
      // Clic ou tap simple
      this.bottomSheetHandleEl.addEventListener("click", () => {
        this.sidePanelEl.classList.remove("collapsed");
      });

      // Glissement (Swipe vers le haut) sur la poignée
      let touchStartY = null;
      this.bottomSheetHandleEl.addEventListener("touchstart", (e) => {
        touchStartY = e.touches[0].clientY;
      }, { passive: true });

      this.bottomSheetHandleEl.addEventListener("touchmove", (e) => {
        if (touchStartY === null) return;
        const currentY = e.touches[0].clientY;
        const diff = touchStartY - currentY; // Positif si vers le haut
        if (diff > 20) {
          this.sidePanelEl.classList.remove("collapsed");
          touchStartY = null;
        }
      }, { passive: true });

      this.bottomSheetHandleEl.addEventListener("touchend", () => {
        touchStartY = null;
      }, { passive: true });
    }

    // Glissement vers le bas sur l'en-tête du volet pour le replier facilement
    document.querySelectorAll(".panel-header").forEach(header => {
      let headerStartY = null;
      header.addEventListener("touchstart", (e) => {
        headerStartY = e.touches[0].clientY;
      }, { passive: true });

      header.addEventListener("touchmove", (e) => {
        if (headerStartY === null) return;
        const currentY = e.touches[0].clientY;
        const diff = currentY - headerStartY; // Positif si vers le bas
        if (diff > 35) {
          this.sidePanelEl.classList.add("collapsed");
          headerStartY = null;
        }
      }, { passive: true });

      header.addEventListener("touchend", () => {
        headerStartY = null;
      }, { passive: true });
    });

    // Administration
    this.btnAdminEl.addEventListener("click", () => {
      this.admin.open();
    });

    // Export Google My Maps
    const exportBtn = document.getElementById("btn-export-mymaps");
    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        if (this.activeCity && this.activePanelsData) {
          this.admin.exportToGoogleMyMapsCSV(this.activeCity.name, this.activePanelsData.features);
        }
      });
    }

    // Fermeture de la modale félicitations
    if (this.btnCloseCongratsEl) {
      this.btnCloseCongratsEl.addEventListener("click", () => {
        this.congratsModalEl.classList.remove("active");
        this.reviewStepEl.style.display = "none";
        this.configStepEl.style.display = "flex";
        this.sidePanelEl.classList.remove("collapsed");
      });
    }
  }

  async geolocateUser() {
    this.btnGpsEl.innerHTML = `⏳ Détection...`;

    // 1. Vérification du contexte sécurisé (requis par tous les navigateurs modernes)
    const isSecure = window.isSecureContext || location.hostname === "localhost" || location.hostname === "127.0.0.1";
    
    if (!isSecure && !navigator.geolocation) {
      this.handleGpsInsecureFallback();
      return;
    }

    if (!navigator.geolocation) {
      alert("La géolocalisation n'est pas supportée par votre navigateur.");
      this.btnGpsEl.innerHTML = `📍 Ma position`;
      return;
    }

    // Fonction d'application de la position
    const applyCoords = (lon, lat, label = "📍 Ma position") => {
      this.startCoord = [lon, lat];
      this.startAddress = label;
      this.addressInputEl.value = label;
      this.updateClearBtnVisibility();
      this.btnGpsEl.innerHTML = `📍 GPS Actif`;
      this.map.setStartPoint(this.startCoord, this.startAddress);
      this.map.map.setView([lat, lon], 15);
    };

    // 2. Tentative avec options souples (maximumAge permet d'utiliser le cache récent sans bloquer)
    const tryGeolocation = (highAccuracy, timeoutMs) => {
      return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos),
          (err) => reject(err),
          { enableHighAccuracy: highAccuracy, timeout: timeoutMs, maximumAge: 300000 }
        );
      });
    };

    try {
      // Premier essai rapide (précision standard, rapide)
      const pos = await tryGeolocation(false, 5000);
      applyCoords(pos.coords.longitude, pos.coords.latitude, "📍 Ma position actuelle");
      return;
    } catch (err1) {
      console.warn("Premier essai GPS échoué, deuxième essai haute précision:", err1);
      try {
        // Deuxième essai avec haute précision
        const pos2 = await tryGeolocation(true, 8000);
        applyCoords(pos2.coords.longitude, pos2.coords.latitude, "📍 Ma position actuelle (GPS)");
        return;
      } catch (err2) {
        console.warn("Échec géolocalisation navigateur:", err2);
        
        // Explication précise selon l'erreur
        if (!isSecure && err2.code === 1) {
          // Erreur typique : HTTP au lieu de HTTPS sur IP réseau (ex: 192.168.x.x)
          alert(
            "🔒 Sécurité navigateur :\n\n" +
            "Google Chrome et Safari interdisent l'accès au GPS sur une adresse IP non chiffrée (http://192.168...).\n\n" +
            "Solutions :\n" +
            "1. Sur votre Mac, ouvrez 'http://localhost:8000' (le GPS y est autorisé).\n" +
            "2. Ou saisissez le nom de votre rue dans le champ d'adresse (autocomplétion instantanée).\n" +
            "3. En ligne sur GitHub Pages, le HTTPS est automatique et le GPS fonctionne directement sur smartphone !"
          );
        } else if (err2.code === 1) {
          alert("L'accès à la localisation a été refusé par le système ou le navigateur. Veuillez autoriser la localisation dans les réglages ou taper votre adresse de départ.");
        } else {
          alert("Signal GPS indisponible ou délai dépassé. Vous pouvez taper directement le nom de votre rue dans le champ d'adresse.");
        }

        // Repli automatique par géolocalisation IP approximative
        await this.fallbackIpLocation(applyCoords);
      }
    }
  }

  async fallbackIpLocation(applyCoords) {
    try {
      this.btnGpsEl.innerHTML = `🌐 Détection IP...`;
      const resp = await fetch("https://ipapi.co/json/");
      if (resp.ok) {
        const data = await resp.json();
        if (data.latitude && data.longitude) {
          const label = `📍 Position estimée (${data.city || 'Votre ville'})`;
          applyCoords(data.longitude, data.latitude, label);
          return;
        }
      }
    } catch (e) {
      console.warn("Erreur repli IP:", e);
    }
    this.btnGpsEl.innerHTML = `📍 Ma position`;
  }

  async searchAddressBAN(query) {
    try {
      // API Adresse Nationale BAN (officielle, gratuite et rapide)
      // On privilégie la zone géographique de la ville active si connue
      let url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=5`;
      if (this.activeCity && this.activeCity.center) {
        url += `&lat=${this.activeCity.center[1]}&lon=${this.activeCity.center[0]}`;
      }

      const resp = await fetch(url);
      const data = await resp.json();

      this.suggestionsEl.innerHTML = "";
      if (data.features && data.features.length > 0) {
        data.features.forEach(f => {
          const item = document.createElement("div");
          item.className = "suggestion-item";
          item.innerHTML = `
            <strong>${f.properties.name}</strong>
            <small>${f.properties.postcode} ${f.properties.city} (${f.properties.context || ''})</small>
          `;
          item.addEventListener("click", () => {
            this.startCoord = f.geometry.coordinates; // [lon, lat]
            this.startAddress = f.properties.label;
            this.addressInputEl.value = this.startAddress;
            this.updateClearBtnVisibility();
            this.suggestionsEl.style.display = "none";
            this.map.setStartPoint(this.startCoord, this.startAddress);
            this.map.map.setView([this.startCoord[1], this.startCoord[0]], 15);
          });
          this.suggestionsEl.appendChild(item);
        });
        this.suggestionsEl.style.display = "block";
      } else {
        this.suggestionsEl.style.display = "none";
      }
    } catch (e) {
      console.warn("Erreur autocomplétion BAN:", e);
    }
  }

  async generateTour() {
    if (!this.activePanelsData || !this.activePanelsData.features.length) {
      alert("Aucun panneau disponible pour cette ville.");
      return;
    }

    if (!this.startCoord) {
      alert("Veuillez indiquer votre point de départ (via GPS ou en tapant une adresse).");
      return;
    }

    this.btnCalculateEl.innerHTML = `⏳ Calcul du trajet en boucle...`;
    this.btnCalculateEl.disabled = true;

    try {
      // 1. Sélection des N panneaux les plus proches / denses
      this.selectedPanels = this.router.selectBestPanels(
        this.startCoord,
        this.activePanelsData.features,
        this.targetCount
      );

      // 2. Calcul et optimisation de la boucle fermée (départ -> panneaux -> retour au départ)
      await this.recomputeRoute();

      // 3. Bascule d'écran vers le détail de la tournée
      this.configStepEl.style.display = "none";
      this.reviewStepEl.style.display = "flex";
      this.sidePanelEl.classList.remove("collapsed");

      // 4. Temporisation brève pour que l'utilisateur visualise le détail de la tournée dans le volet,
      // puis abaissement rapide (300ms) du volet pour révéler la carte
      await new Promise(resolve => setTimeout(resolve, 400));
      this.sidePanelEl.classList.add("collapsed");
    } catch (e) {
      console.error(e);
      alert("Erreur lors de l'optimisation de la tournée.");
    } finally {
      this.btnCalculateEl.innerHTML = `🚀 Générer la proposition de tournée`;
      this.btnCalculateEl.disabled = false;
    }
  }

  async recomputeRoute() {
    const result = await this.router.optimizeRoute(this.startCoord, this.selectedPanels);

    this.orderedPanels = result.orderedPanels;

    // Mise à jour de la carte
    this.map.setRoutePolyline(result.polylineCoordinates);
    this.map.setActivePanels(this.orderedPanels);

    // Panneaux inutilisés de la ville
    const activeIds = new Set(this.orderedPanels.map(p => p.properties.id));
    const unusedPanels = this.activePanelsData.features.filter(p => !activeIds.has(p.properties.id));
    this.map.setUnusedPanels(unusedPanels);

    // Mise à jour des statistiques
    this.summaryCountEl.textContent = this.orderedPanels.length;
    this.summaryDistanceEl.textContent = `${result.distanceKm} km`;

    // Formatage du temps en heures et minutes si >= 60 min
    const totalMin = result.durationMinutes;
    let formattedTime = `${totalMin} min`;
    if (totalMin >= 60) {
      const hours = Math.floor(totalMin / 60);
      const mins = totalMin % 60;
      formattedTime = mins > 0 ? `${hours}h${mins.toString().padStart(2, '0')}` : `${hours}h`;
    }
    this.summaryTimeEl.textContent = formattedTime;
    this.summaryTimeEl.title = `Dont ${result.drivingMinutes || 0} min de trajet et ${this.orderedPanels.length * 8} min de collage (8 min/panneau)`;

    // Rendu de la liste
    this.renderPanelsList();
  }

  renderPanelsList() {
    this.panelsListEl.innerHTML = "";
    const isMultiCity = checkIsMultiCityTour(this.orderedPanels);

    this.orderedPanels.forEach((panel, idx) => {
      const notes = (panel.properties.notes || '').trim();
      const subHtml = notes ? `<span class="panel-info-sub">${notes}</span>` : '';
      const displayName = formatPanelDisplayName(panel, isMultiCity);

      const item = document.createElement("div");
      item.className = "panel-item";
      item.innerHTML = `
        <div class="panel-item-left">
          <div class="panel-num-badge">${idx + 1}</div>
          <div class="panel-info">
            <span class="panel-info-name">${displayName}</span>
            ${subHtml}
          </div>
        </div>
        <button class="btn-remove-panel" title="Retirer ce panneau">✕</button>
      `;

      // Clic sur l'élément pour centrer la carte sur ce panneau
      item.addEventListener("click", (e) => {
        if (!e.target.classList.contains("btn-remove-panel")) {
          this.map.focusPanel(panel);
        }
      });

      // Bouton supprimer
      const btnRemove = item.querySelector(".btn-remove-panel");
      btnRemove.addEventListener("click", (e) => {
        e.stopPropagation();
        this.handleRemovePanel(panel);
      });

      this.panelsListEl.appendChild(item);
    });
  }

  handleAddPanel(panel) {
    if (this.selectedPanels.some(p => p.properties.id === panel.properties.id)) {
      return;
    }
    this.selectedPanels.push(panel);
    this.recomputeRoute();
  }

  handleRemovePanel(panel) {
    this.selectedPanels = this.selectedPanels.filter(p => p.properties.id !== panel.properties.id);
    if (this.selectedPanels.length === 0) {
      alert("Votre tournée doit comporter au moins un panneau.");
      return;
    }
    this.recomputeRoute();
  }

  startGuidance() {
    if (this.orderedPanels.length === 0) {
      alert("Aucun panneau dans la tournée.");
      return;
    }

    // Réduire le volet latéral pour laisser toute la place à la carte et au HUD
    this.sidePanelEl.classList.add("collapsed");
    if (this.bottomSheetHandleEl) {
      this.bottomSheetHandleEl.style.display = "none";
    }

    // Lancer le module de guidage pas à pas
    this.guidance.start(this.startCoord, this.startAddress, this.orderedPanels, {
      city: this.activeCity ? this.activeCity.name : "",
      distanceKm: this.summaryDistanceEl ? this.summaryDistanceEl.textContent : "",
      durationMin: this.summaryDurationEl ? this.summaryDurationEl.textContent : ""
    });
  }

  exitGuidance() {
    this.sidePanelEl.classList.remove("collapsed");
    if (this.bottomSheetHandleEl) {
      this.bottomSheetHandleEl.style.display = "";
    }
    this.map.setActivePanels(this.orderedPanels);
  }

  showFinishedModal(stats) {
    if (this.bottomSheetHandleEl) {
      this.bottomSheetHandleEl.style.display = "";
    }
    const statsEl = document.getElementById("congrats-stats-box");
    if (statsEl) {
      statsEl.innerHTML = `
        <div class="stat-box"><span class="stat-val">${stats.totalPanels}</span><span class="stat-label">Affiches collées</span></div>
        <div class="stat-box"><span class="stat-val">${this.summaryDistanceEl.textContent}</span><span class="stat-label">Parcourus</span></div>
        <div class="stat-box"><span class="stat-val">100%</span><span class="stat-label">Objectif atteint</span></div>
      `;
    }
    this.congratsModalEl.classList.add("active");
  }
}

// Initialisation au chargement du DOM
document.addEventListener("DOMContentLoaded", () => {
  const app = new TourApp();
  app.init();
  window.tourApp = app;
});
