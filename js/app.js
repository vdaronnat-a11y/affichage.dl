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
    await this.checkUrlTourParams();
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

    // Éléments du sélecteur de quantité de panneaux
    this.cityMaxPanelsHintEl = document.getElementById("city-max-panels-hint");
    this.inputTargetCountEl = document.getElementById("input-target-count");
    this.btnCountMinusEl = document.getElementById("btn-count-minus");
    this.btnCountPlusEl = document.getElementById("btn-count-plus");
    this.countPillBtns = document.querySelectorAll(".count-pill-btn");

    // Éléments de sauvegarde et partage de la tournée
    this.btnSaveTourEl = document.getElementById("btn-save-tour");
    this.modalShareEl = document.getElementById("modal-share-tour");
    this.btnCloseShareEl = document.getElementById("btn-close-share-modal");
    this.btnCloseShareFooterEl = document.getElementById("btn-close-share-modal-footer");
    this.shareTourSummaryEl = document.getElementById("share-tour-summary");
    this.shareQrcodeEl = document.getElementById("share-qrcode");
    this.shareTourUrlEl = document.getElementById("share-tour-url");
    this.btnCopyTourUrlEl = document.getElementById("btn-copy-tour-url");
    this.shareCopyStatusEl = document.getElementById("share-copy-status");
    this.btnNativeShareEl = document.getElementById("btn-native-share");
    this.btnGmailShareEl = document.getElementById("btn-gmail-share");
    this.btnEmailShareEl = document.getElementById("btn-email-share");
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

    // Tri alphabétique insensible aux accents (Dardilly -> Échirolles -> Écully -> Fleury...)
    this.cities.sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));

    this.renderCitiesDropdown();

    // Vérifier si un itinéraire est passé dans l'URL pour ne pas charger inutilement la ville par défaut
    const searchStr = window.location.search || (window.location.hash && window.location.hash.includes("?") ? window.location.hash.substring(window.location.hash.indexOf("?")) : "");
    const urlParams = new URLSearchParams(searchStr);
    const hasTourParam = urlParams.has("p");

    if (!hasTourParam) {
      const defaultCity = this.cities.find(c => c.id === "lyon") || this.cities[0];
      if (defaultCity) {
        await this.selectCity(defaultCity.id);
      }
    }
  }

  renderCitiesDropdown() {
    this.citySelectEl.innerHTML = "";
    this.cities.forEach(city => {
      const opt = document.createElement("option");
      opt.value = city.id;
      // Retirer la majuscule accentuée uniquement dans la liste déroulante pour faciliter la frappe et le tri au clavier
      const displayName = city.name.replace(/^É/, "E");
      opt.textContent = `${displayName} (${city.count} 🪧)`;
      this.citySelectEl.appendChild(opt);
    });
  }

  async selectCity(cityId) {
    const city = this.cities.find(c => c.id === cityId);
    if (!city) return;

    this.activeCity = city;
    this.citySelectEl.value = city.id;
    this.activeCityBadgeEl.innerHTML = `📍 ${city.name} (${city.count} 🪧)`;

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

  getMaxPanels() {
    if (this.activePanelsData && Array.isArray(this.activePanelsData.features)) {
      return this.activePanelsData.features.length;
    }
    if (this.activeCity && typeof this.activeCity.count === 'number') {
      return this.activeCity.count;
    }
    return 20;
  }

  updateCountControls() {
    const max = this.getMaxPanels();

    // Clamper la valeur cible
    if (this.targetCount > max) {
      this.targetCount = max;
    }
    if (this.targetCount < 1) {
      this.targetCount = Math.min(1, max);
    }

    // Affichage dans le stepper
    if (this.inputTargetCountEl) {
      this.inputTargetCountEl.value = this.targetCount;
      this.inputTargetCountEl.max = max;
    }

    // Indicateur max disponible
    if (this.cityMaxPanelsHintEl) {
      this.cityMaxPanelsHintEl.textContent = `/ ${max} disponible${max > 1 ? 's' : ''}`;
    }

    // Boutons + et -
    if (this.btnCountMinusEl) {
      this.btnCountMinusEl.disabled = this.targetCount <= 1;
    }
    if (this.btnCountPlusEl) {
      this.btnCountPlusEl.disabled = this.targetCount >= max;
    }

    // Paliers de boutons
    if (this.countPillBtns) {
      this.countPillBtns.forEach(btn => {
        const countAttr = btn.dataset.count;
        if (countAttr === "all") {
          btn.classList.toggle("active", this.targetCount === max);
          btn.disabled = max <= 0;
        } else {
          const val = parseInt(countAttr, 10);
          btn.disabled = val > max;
          btn.classList.toggle("active", this.targetCount === val);
        }
      });
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
        this.updateCountControls();
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
    this.updateCountControls();
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

    // Boutons de quantité de panneaux (10, 15, 20, Tous)
    if (this.countPillBtns) {
      this.countPillBtns.forEach(btn => {
        btn.addEventListener("click", () => {
          const max = this.getMaxPanels();
          if (btn.dataset.count === "all") {
            this.targetCount = max;
          } else {
            const val = parseInt(btn.dataset.count, 10);
            this.targetCount = Math.min(val, max);
          }
          this.updateCountControls();
        });
      });
    }

    // Stepper boutons + et -
    if (this.btnCountMinusEl) {
      this.btnCountMinusEl.addEventListener("click", () => {
        if (this.targetCount > 1) {
          this.targetCount--;
          this.updateCountControls();
        }
      });
    }
    if (this.btnCountPlusEl) {
      this.btnCountPlusEl.addEventListener("click", () => {
        const max = this.getMaxPanels();
        if (this.targetCount < max) {
          this.targetCount++;
          this.updateCountControls();
        }
      });
    }

    // Champ stepper saisie directe
    if (this.inputTargetCountEl) {
      const handleInputChange = () => {
        let val = parseInt(this.inputTargetCountEl.value, 10);
        const max = this.getMaxPanels();
        if (isNaN(val) || val < 1) val = 1;
        if (val > max) val = max;
        this.targetCount = val;
        this.updateCountControls();
      };
      this.inputTargetCountEl.addEventListener("change", handleInputChange);
      this.inputTargetCountEl.addEventListener("blur", handleInputChange);
    }

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
      this.sidePanelEl.classList.remove("review-active");
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
    document.querySelectorAll(".panel-header, .panel-header-review").forEach(header => {
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
        this.sidePanelEl.classList.remove("review-active");
        this.sidePanelEl.classList.remove("collapsed");
      });
    }

    // Clic sur le logo Nouvelle Énergie pour afficher la modale d'information
    const infoModal = document.getElementById("info-modal");
    const closeInfoBtns = [document.getElementById("btn-close-info"), document.getElementById("btn-ok-info")];

    document.querySelectorAll(".panel-header-logo").forEach(logo => {
      logo.addEventListener("click", () => {
        if (infoModal) infoModal.classList.add("active");
      });
      logo.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (infoModal) infoModal.classList.add("active");
        }
      });
    });

    closeInfoBtns.forEach(btn => {
      if (btn) {
        btn.addEventListener("click", () => {
          if (infoModal) infoModal.classList.remove("active");
        });
      }
    });

    if (infoModal) {
      infoModal.addEventListener("click", (e) => {
        if (e.target === infoModal) {
          infoModal.classList.remove("active");
        }
      });
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && infoModal && infoModal.classList.contains("active")) {
        infoModal.classList.remove("active");
      }
      if (e.key === "Escape" && this.modalShareEl && this.modalShareEl.classList.contains("active")) {
        this.closeShareModal();
      }
    });

    // Sauvegarde et Partage de la tournée
    if (this.btnSaveTourEl) {
      this.btnSaveTourEl.addEventListener("click", () => this.openShareModal());
    }
    if (this.btnCloseShareEl) {
      this.btnCloseShareEl.addEventListener("click", () => this.closeShareModal());
    }
    if (this.btnCloseShareFooterEl) {
      this.btnCloseShareFooterEl.addEventListener("click", () => this.closeShareModal());
    }
    if (this.modalShareEl) {
      this.modalShareEl.addEventListener("click", (e) => {
        if (e.target === this.modalShareEl) this.closeShareModal();
      });
    }
    if (this.btnCopyTourUrlEl) {
      this.btnCopyTourUrlEl.addEventListener("click", () => this.copyShareUrl());
    }
    if (this.btnNativeShareEl) {
      this.btnNativeShareEl.addEventListener("click", () => this.triggerNativeShare());
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
      this.sidePanelEl.classList.add("review-active");

      // 4. Animation d'affordance "Peek & Bounce" : le volet reste ouvert mais
      // effectue un bref rebond pour révéler la carte en arrière-plan et inviter au glissement
      this.triggerPeekBounce();
    } catch (e) {
      console.error(e);
      alert("Erreur lors de l'optimisation de la tournée.");
    } finally {
      this.btnCalculateEl.innerHTML = `🚀 Générer la proposition de tournée`;
      this.btnCalculateEl.disabled = false;
    }
  }

  triggerPeekBounce() {
    if (!this.sidePanelEl) return;
    this.sidePanelEl.classList.remove("peek-bounce");
    // Forcer le reflow du DOM pour relancer l'animation CSS proprement
    void this.sidePanelEl.offsetWidth;
    this.sidePanelEl.classList.add("peek-bounce");

    setTimeout(() => {
      if (this.sidePanelEl) {
        this.sidePanelEl.classList.remove("peek-bounce");
      }
    }, 1300);
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

  /**
   * Ouvre la modale de partage, prépare le lien, le QR code et notifie Google Sheets
   */
  openShareModal() {
    if (!this.orderedPanels || this.orderedPanels.length === 0) {
      alert("Veuillez d'abord générer une tournée avant de la sauvegarder.");
      return;
    }

    // 1. Construction de l'URL directe autonome
    const url = new URL(window.location.origin + window.location.pathname);
    const tourId = this.tracker ? this.tracker.generateTourId() : `TRN-${Date.now()}`;
    url.searchParams.set("tid", tourId);

    if (this.activeCity && this.activeCity.id) {
      url.searchParams.set("city", this.activeCity.id);
    }
    if (this.startCoord) {
      url.searchParams.set("start", `${this.startCoord[0].toFixed(5)},${this.startCoord[1].toFixed(5)}`);
    }
    if (this.startAddress && this.startAddress.trim()) {
      url.searchParams.set("addr", this.startAddress.trim());
    }
    const panelIds = this.orderedPanels.map(p => p.properties.id).join(",");
    url.searchParams.set("p", panelIds);

    const fullShareUrl = url.toString();

    // 2. Alimentation du champ d'URL
    if (this.shareTourUrlEl) {
      this.shareTourUrlEl.value = fullShareUrl;
    }
    if (this.shareCopyStatusEl) {
      this.shareCopyStatusEl.textContent = "";
    }

    // 3. Résumé visuel dans la modale
    if (this.shareTourSummaryEl) {
      this.shareTourSummaryEl.innerHTML = `
        <div class="share-summary-item">
          <span class="share-summary-val">${this.orderedPanels.length}</span>
          <span class="share-summary-lbl">Panneaux</span>
        </div>
        <div class="share-summary-item">
          <span class="share-summary-val">${this.summaryDistanceEl ? this.summaryDistanceEl.textContent : ''}</span>
          <span class="share-summary-lbl">Distance</span>
        </div>
        <div class="share-summary-item">
          <span class="share-summary-val">${this.summaryTimeEl ? this.summaryTimeEl.textContent : ''}</span>
          <span class="share-summary-lbl">Temps estimé</span>
        </div>
      `;
    }

    // 4. Génération du QR Code autonome
    if (this.shareQrcodeEl) {
      this.shareQrcodeEl.innerHTML = "";
      if (typeof QRCode !== "undefined") {
        try {
          new QRCode(this.shareQrcodeEl, {
            text: fullShareUrl,
            width: 140,
            height: 140,
            colorDark: "#0f172a",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.M
          });
        } catch (err) {
          console.warn("Erreur QRCode:", err);
        }
      }
    }

    // 5. Liens e-mail prêts à l'emploi (Gmail Web & Client natif)
    const cityName = this.activeCity ? this.activeCity.name : "d'affichage";
    const subject = `Tournée d'affichage - ${cityName}`;
    const dist = this.summaryDistanceEl ? this.summaryDistanceEl.textContent : "";
    const duration = this.summaryTimeEl ? this.summaryTimeEl.textContent : "";
    const body = `Bonjour,\n\nVoici l'itinéraire préparé pour la tournée d'affichage à ${cityName} :\n` +
                 `• ${this.orderedPanels.length} panneaux\n` +
                 (dist ? `• Distance : ${dist}\n` : "") +
                 (duration ? `• Durée estimée : ${duration}\n` : "") +
                 (this.startAddress ? `• Départ : ${this.startAddress}\n\n` : "\n") +
                 `Clique sur ce lien pour ouvrir la tournée et démarrer le guidage GPS :\n` +
                 `${fullShareUrl}\n\nBonne tournée !`;

    // 5. Liens e-mail prêts à l'emploi (Client natif & Gmail Web sur vrai PC)
    const isDesktopPC = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const emailContainer = this.modalShareEl ? this.modalShareEl.querySelector(".share-email-buttons") : null;

    if (this.btnGmailShareEl) {
      if (isDesktopPC) {
        const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        this.btnGmailShareEl.href = gmailUrl;
        this.btnGmailShareEl.style.display = "inline-flex";
        if (emailContainer) {
          emailContainer.style.display = "grid";
          emailContainer.style.gridTemplateColumns = "1fr 1fr";
        }
      } else {
        // Appareils tactiles (smartphones & tablettes) : bouton Gmail Web masqué
        this.btnGmailShareEl.style.display = "none";
        if (emailContainer) {
          emailContainer.style.display = "flex";
          emailContainer.style.flexDirection = "column";
        }
      }
    }

    if (this.btnEmailShareEl) {
      this.btnEmailShareEl.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      this.btnEmailShareEl.style.width = isDesktopPC ? "" : "100%";
    }

    // 6. Sauvegarde silencieuse en tâche de fond dans Google Sheets
    if (this.tracker) {
      try {
        const tourData = {
          tour_id: tourId,
          city: this.activeCity ? this.activeCity.name : "",
          city_id: this.activeCity ? this.activeCity.id : "",
          start_address: this.startAddress || "",
          start_coords: this.startCoord,
          panel_count: this.orderedPanels.length,
          distance_km: this.summaryDistanceEl ? this.summaryDistanceEl.textContent : "",
          duration_min: this.summaryTimeEl ? this.summaryTimeEl.textContent : "",
          tour_url: fullShareUrl,
          panels_summary: this.orderedPanels.map((p, i) => `${i + 1}. ${p.properties.name || p.properties.id}`).join(" | ")
        };
        this.tracker.logTourSaved(tourData);
      } catch (e) {
        console.warn("Erreur archivage sheet:", e);
      }
    }

    // 7. Affichage de la modale
    if (this.modalShareEl) {
      this.modalShareEl.classList.add("active");
    }
  }

  closeShareModal() {
    if (this.modalShareEl) {
      this.modalShareEl.classList.remove("active");
    }
  }

  copyShareUrl() {
    if (!this.shareTourUrlEl || !this.shareTourUrlEl.value) return;
    const url = this.shareTourUrlEl.value;

    const onSuccess = () => {
      if (this.shareCopyStatusEl) {
        this.shareCopyStatusEl.textContent = "✅ Lien copié dans le presse-papier !";
        setTimeout(() => {
          if (this.shareCopyStatusEl) this.shareCopyStatusEl.textContent = "";
        }, 3200);
      }
      this.showToast("📋 Lien copié !");
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(onSuccess).catch(() => {
        this.fallbackCopyText(url, onSuccess);
      });
    } else {
      this.fallbackCopyText(url, onSuccess);
    }
  }

  fallbackCopyText(text, callback) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "0";
    textArea.setAttribute("readonly", "");
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, 99999);
    try {
      const successful = document.execCommand("copy");
      if (successful && callback) callback();
    } catch (e) {
      console.warn("fallback copy failed:", e);
    }
    document.body.removeChild(textArea);
  }

  async triggerNativeShare() {
    const url = this.shareTourUrlEl ? this.shareTourUrlEl.value : window.location.href;
    const cityName = this.activeCity ? this.activeCity.name : "Affichage";
    const title = `Tournée d'affichage - ${cityName}`;
    const text = `Voici l'itinéraire préparé pour notre tournée d'affichage (${this.orderedPanels.length} panneaux) :`;

    // 1. Partage natif du système (ouvre la feuille Android/iOS permettant de choisir l'application)
    if (navigator.share) {
      try {
        const shareData = {
          title: title,
          text: `${text}\n${url}`,
          url: url
        };
        if (navigator.canShare && !navigator.canShare(shareData)) {
          delete shareData.title;
        }
        await navigator.share(shareData);
        return;
      } catch (err) {
        if (err.name === "AbortError") return; // Annulation normale par l'utilisateur
        console.warn("navigator.share a échoué :", err);
      }
    }

    // 2. Repli si le navigateur bloque l'API (ex: test local en HTTP Wi-Fi non sécurisé)
    this.copyShareUrl();
    this.showToast("📋 Lien copié ! (Le menu de choix d'application requiert HTTPS en ligne)");
  }

  showToast(message) {
    let toast = document.getElementById("app-toast-banner");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "app-toast-banner";
      toast.className = "toast-banner";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => {
      toast.classList.remove("show");
    }, 3800);
  }

  /**
   * Détecte et restaure une tournée si des paramètres d'URL sont présents
   */
  async checkUrlTourParams() {
    const searchStr = window.location.search || (window.location.hash && window.location.hash.includes("?") ? window.location.hash.substring(window.location.hash.indexOf("?")) : "");
    if (!searchStr) return;

    const urlParams = new URLSearchParams(searchStr);
    const tourIdParam = urlParams.get("tid") || urlParams.get("id");
    const cityId = urlParams.get("city");
    const panelsParam = urlParams.get("p");
    const startParam = urlParams.get("start");
    const addrParam = urlParams.get("addr");

    if (!panelsParam) return;

    const panelIds = panelsParam.split(",").map(id => id.trim()).filter(Boolean);
    if (panelIds.length === 0) return;

    try {
      // 1. Résolution de la commune ciblée
      let targetCity = null;
      if (cityId) {
        targetCity = this.cities.find(c => c.id === cityId);
      }
      // Repli intelligent si l'URL ne mentionnait pas city (déduction depuis le préfixe de l'ID panneau)
      if (!targetCity && panelIds.length > 0) {
        const firstId = panelIds[0];
        targetCity = this.cities.find(c => firstId.startsWith(c.id));
      }
      if (!targetCity) {
        targetCity = this.activeCity || this.cities[0];
      }
      if (!targetCity) return;

      // Charger proprement la commune et ses panneaux
      await this.selectCity(targetCity.id);

      // 2. Point de départ
      if (startParam) {
        const parts = startParam.split(",").map(s => parseFloat(s.trim()));
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          this.startCoord = [parts[0], parts[1]];
        }
      }
      if (!this.startCoord) {
        this.startCoord = targetCity.center;
      }

      // 3. Adresse de départ
      if (addrParam) {
        this.startAddress = decodeURIComponent(addrParam);
      } else {
        this.startAddress = `Centre-ville de ${targetCity.name}`;
      }
      if (this.addressInputEl) {
        this.addressInputEl.value = this.startAddress;
      }
      this.updateClearBtnVisibility();
      this.map.setStartPoint(this.startCoord, this.startAddress);

      // 4. Correspondance des panneaux selon les IDs ordonnés
      if (!this.activePanelsData || !this.activePanelsData.features) {
        console.warn("Données panneaux indisponibles pour la ville", targetCity);
        return;
      }

      const panelMap = new Map();
      this.activePanelsData.features.forEach(f => {
        if (f.properties && f.properties.id) {
          panelMap.set(String(f.properties.id).trim(), f);
        }
      });

      const restoredPanels = panelIds.map(id => panelMap.get(String(id).trim())).filter(Boolean);
      if (restoredPanels.length === 0) {
        console.warn("Aucun panneau correspondant trouvé pour les IDs de la tournée :", panelIds);
        return;
      }

      this.selectedPanels = [...restoredPanels];
      this.orderedPanels = [...restoredPanels];

      // 5. Calcul du tracé respectant rigoureusement cet ordre fixé
      const result = await this.router.computeFixedRoute(this.startCoord, this.orderedPanels);

      // Mise à jour de la carte (tracé et marqueurs actifs / inactifs)
      this.map.setRoutePolyline(result.polylineCoordinates);
      this.map.setActivePanels(this.orderedPanels);

      const activeIds = new Set(this.orderedPanels.map(p => p.properties.id));
      const unusedPanels = this.activePanelsData.features.filter(p => !activeIds.has(p.properties.id));
      this.map.setUnusedPanels(unusedPanels);

      // Statistiques de la tournée
      if (this.summaryCountEl) this.summaryCountEl.textContent = this.orderedPanels.length;
      if (this.summaryDistanceEl) this.summaryDistanceEl.textContent = `${result.distanceKm} km`;

      const totalMin = result.durationMinutes;
      let formattedTime = `${totalMin} min`;
      if (totalMin >= 60) {
        const hours = Math.floor(totalMin / 60);
        const mins = totalMin % 60;
        formattedTime = mins > 0 ? `${hours}h${mins.toString().padStart(2, '0')}` : `${hours}h`;
      }
      if (this.summaryTimeEl) {
        this.summaryTimeEl.textContent = formattedTime;
        this.summaryTimeEl.title = `Dont ${result.drivingMinutes || 0} min de trajet et ${this.orderedPanels.length * 8} min de collage`;
      }

      this.renderPanelsList();

      // Ajuster la vue de la carte sur l'ensemble du tracé
      if (result.polylineCoordinates && result.polylineCoordinates.length > 0) {
        const bounds = L.latLngBounds(result.polylineCoordinates.map(c => [c[1], c[0]]));
        this.map.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
      }

      // Bascule directe sur l'Étape 2 (Révision de la tournée)
      if (this.configStepEl) this.configStepEl.style.display = "none";
      if (this.reviewStepEl) this.reviewStepEl.style.display = "flex";
      if (this.sidePanelEl) {
        this.sidePanelEl.classList.remove("collapsed");
        this.sidePanelEl.classList.add("review-active");
      }
      this.triggerPeekBounce();

      this.showToast(`✨ Tournée de ${this.orderedPanels.length} panneaux chargée !`);

      // 6. Enregistrement silencieux de la restauration / ouverture de la tournée dans Google Sheets
      if (this.tracker) {
        try {
          const tourRestoreData = {
            tour_id: tourIdParam || "",
            city: targetCity ? targetCity.name : "",
            city_id: targetCity ? targetCity.id : "",
            start_address: this.startAddress || "",
            start_coords: this.startCoord,
            panel_count: this.orderedPanels.length,
            distance_km: `${result.distanceKm} km`,
            duration_min: formattedTime,
            tour_url: window.location.href,
            panels_summary: this.orderedPanels.map((p, i) => `${i + 1}. ${p.properties.name || p.properties.id}`).join(" | ")
          };
          this.tracker.logTourRestored(tourRestoreData);
        } catch (e) {
          console.warn("Erreur log restauration tournée:", e);
        }
      }
    } catch (e) {
      console.error("Erreur lors de la restauration de la tournée :", e);
    }
  }
}

// Initialisation au chargement du DOM
document.addEventListener("DOMContentLoaded", () => {
  const app = new TourApp();
  app.init();
  window.tourApp = app;
});
