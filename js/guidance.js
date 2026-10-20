/**
 * Module du Mode Guidage Terrain (voiture / smartphone)
 * Gestion étape par étape, deep-linking Google Maps / Waze, signaux sonores et boucle de retour
 */

import { checkIsMultiCityTour, formatPanelDisplayName, getDeviceInfo } from "./utils.js?v=3.3";

export const NAV_APPS = {
  gmaps: {
    id: "gmaps",
    name: "Google Maps",
    shortName: "Google Maps",
    icon: "🗺️",
    desc: "Itinéraire & trafic en temps réel",
    gradient: "linear-gradient(135deg, #1a73e8, #4285f4)",
    isAvailable: () => true,
    getUrl: (lat, lon, dev) => `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lon.toFixed(6)}&travelmode=driving`
  },
  waze: {
    id: "waze",
    name: "Waze",
    shortName: "Waze",
    icon: "🚙",
    desc: "Alertes communautaires et trafic",
    gradient: "linear-gradient(135deg, #00b0ff, #0088cc)",
    isAvailable: () => true,
    getUrl: (lat, lon, dev) => {
      if (dev && dev.isMobile) {
        return `https://waze.com/ul?ll=${lat.toFixed(6)},${lon.toFixed(6)}&navigate=yes`;
      }
      return `https://www.waze.com/live-map/directions?to=ll.${lat.toFixed(6)}%2C${lon.toFixed(6)}`;
    }
  },
  apple: {
    id: "apple",
    name: "Apple Plans",
    shortName: "Apple Plans",
    icon: "🍎",
    desc: "Application intégrée Apple",
    gradient: "linear-gradient(135deg, #a855f7, #6366f1)",
    isAvailable: (dev) => dev && (dev.isIOS || dev.isMac),
    getUrl: (lat, lon, dev) => `https://maps.apple.com/?daddr=${lat.toFixed(6)},${lon.toFixed(6)}&dirflg=d`
  },
  roote: {
    id: "roote",
    name: "Roote",
    shortName: "Roote",
    icon: "🏍️",
    desc: "GPS communautaire spécial motards",
    gradient: "linear-gradient(135deg, #f97316, #ea580c)",
    isAvailable: (dev) => dev && dev.isMobile,
    isCustomScheme: true,
    getUrl: (lat, lon, dev) => `roote://navigate?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`
  },
  system: {
    id: "system",
    name: "GPS Système (au choix)",
    shortName: "GPS Système",
    icon: "🧭",
    desc: "Sélecteur d'applications Android",
    gradient: "linear-gradient(135deg, #64748b, #475569)",
    isAvailable: (dev) => dev && dev.isAndroid,
    isCustomScheme: true,
    getUrl: (lat, lon, dev) => `geo:${lat.toFixed(6)},${lon.toFixed(6)}?q=${lat.toFixed(6)},${lon.toFixed(6)}`
  }
};

export class TourGuidance {
  constructor(options) {
    this.container = options.container;
    this.map = options.map;
    this.onFinish = options.onFinish;
    this.onExit = options.onExit;
    this.tracker = options.tracker || null;

    this.startCoord = null;
    this.startAddress = "";
    this.panels = [];
    this.currentIndex = 0; // 0 à N-1 pour les panneaux, N pour le retour au départ
    this.totalSteps = 0;
    this.panelStatuses = []; // Historique des statuts { panel, status: 'pasted' | 'not_found', comment, reason }
    this.audioCtx = null;

    this.currentTargetLat = null;
    this.currentTargetLon = null;

    this.initElements();
  }

  initElements() {
    this.stepIndicatorEl = document.getElementById("guidance-step-indicator");
    this.progressBarEl = document.getElementById("guidance-progress-bar");
    this.addressEl = document.getElementById("guidance-address");
    this.notesEl = document.getElementById("guidance-notes");

    // Boutons de navigation GPS
    this.btnNavMainEl = document.getElementById("btn-nav-main");
    this.btnNavIconEl = document.getElementById("btn-nav-icon");
    this.btnNavLabelEl = document.getElementById("btn-nav-label");
    this.btnNavSettingsEl = document.getElementById("btn-nav-settings");

    // Modale choix GPS
    this.gpsModalEl = document.getElementById("gps-choice-modal");
    this.btnCloseGpsModalEl = document.getElementById("btn-close-gps-modal");
    this.gpsOptionsListEl = document.getElementById("gps-options-list");
    this.chkRememberGpsEl = document.getElementById("chk-remember-gps");

    this.btnPastedEl = document.getElementById("btn-pasted-giant");
    this.btnNotFoundEl = document.getElementById("btn-panel-not-found");
    this.btnExitEl = document.getElementById("btn-exit-guidance");
    this.btnMinimizeGuidanceEl = document.getElementById("btn-minimize-guidance");
    this.guidancePullHandleEl = document.getElementById("guidance-pull-handle");
    this.guidanceSheetHandleEl = document.getElementById("guidance-sheet-handle");

    // Éléments de la modale Pas Trouvé
    this.notFoundModalEl = document.getElementById("not-found-modal");
    this.notFoundPanelTitleEl = document.getElementById("not-found-panel-title");
    this.notFoundCommentEl = document.getElementById("not-found-comment");
    this.btnConfirmNotFoundEl = document.getElementById("btn-confirm-not-found");
    this.btnCancelNotFoundEl = document.getElementById("btn-cancel-not-found");
    this.btnCloseNotFoundEl = document.getElementById("btn-close-not-found");
    this.quickReasonChips = document.querySelectorAll("#quick-reasons-chips .chip-reason");

    if (this.btnPastedEl) {
      this.btnPastedEl.addEventListener("click", () => this.nextStep());
    }
    if (this.btnNotFoundEl) {
      this.btnNotFoundEl.addEventListener("click", () => this.openNotFoundModal());
    }
    if (this.btnExitEl) {
      this.btnExitEl.addEventListener("click", () => this.exit());
    }

    // Gestion du clic sur le bouton de navigation principal
    if (this.btnNavMainEl) {
      this.btnNavMainEl.addEventListener("click", (e) => {
        const currentAppId = this.getPreferredNavAppId();
        if (!currentAppId) {
          e.preventDefault();
          this.openGpsModal();
          return;
        }
        const app = NAV_APPS[currentAppId];
        if (app && app.isCustomScheme) {
          e.preventDefault();
          if (this.currentTargetLat != null && this.currentTargetLon != null) {
            const dev = getDeviceInfo();
            const url = app.getUrl(this.currentTargetLat, this.currentTargetLon, dev);
            window.location.href = url;
          }
        }
      });
    }

    // Bouton de configuration du GPS
    if (this.btnNavSettingsEl) {
      this.btnNavSettingsEl.addEventListener("click", () => this.openGpsModal());
    }

    // Fermeture de la modale GPS
    if (this.btnCloseGpsModalEl) {
      this.btnCloseGpsModalEl.addEventListener("click", () => this.closeGpsModal());
    }
    if (this.gpsModalEl) {
      this.gpsModalEl.addEventListener("click", (e) => {
        if (e.target === this.gpsModalEl) {
          this.closeGpsModal();
        }
      });
    }

    // Réduction du guidage via le bouton '▼ Réduire'
    if (this.btnMinimizeGuidanceEl) {
      this.btnMinimizeGuidanceEl.addEventListener("click", () => this.collapse());
    }

    // Réduction du guidage via la tirette / barre supérieure
    if (this.guidancePullHandleEl) {
      this.guidancePullHandleEl.addEventListener("click", () => this.collapse());

      let pullStartY = null;
      this.guidancePullHandleEl.addEventListener("touchstart", (e) => {
        pullStartY = e.touches[0].clientY;
      }, { passive: true });

      this.guidancePullHandleEl.addEventListener("touchmove", (e) => {
        if (pullStartY === null) return;
        const diff = e.touches[0].clientY - pullStartY;
        if (diff > 15) {
          this.collapse();
          pullStartY = null;
        }
      }, { passive: true });

      this.guidancePullHandleEl.addEventListener("touchend", () => {
        pullStartY = null;
      }, { passive: true });
    }

    // Réouverture du guidage via la poignée flottante basse
    if (this.guidanceSheetHandleEl) {
      this.guidanceSheetHandleEl.addEventListener("click", () => this.expand());

      let touchStartY = null;
      this.guidanceSheetHandleEl.addEventListener("touchstart", (e) => {
        touchStartY = e.touches[0].clientY;
      }, { passive: true });

      this.guidanceSheetHandleEl.addEventListener("touchmove", (e) => {
        if (touchStartY === null) return;
        const currentY = e.touches[0].clientY;
        const diff = touchStartY - currentY;
        if (diff > 15) {
          this.expand();
          touchStartY = null;
        }
      }, { passive: true });

      this.guidanceSheetHandleEl.addEventListener("touchend", () => {
        touchStartY = null;
      }, { passive: true });
    }

    // Gestion des événements de la modale Pas Trouvé
    if (this.btnConfirmNotFoundEl) {
      this.btnConfirmNotFoundEl.addEventListener("click", () => this.confirmNotFound());
    }
    if (this.btnCancelNotFoundEl) {
      this.btnCancelNotFoundEl.addEventListener("click", () => this.closeNotFoundModal());
    }
    if (this.btnCloseNotFoundEl) {
      this.btnCloseNotFoundEl.addEventListener("click", () => this.closeNotFoundModal());
    }
    if (this.notFoundModalEl) {
      this.notFoundModalEl.addEventListener("click", (e) => {
        if (e.target === this.notFoundModalEl) {
          this.closeNotFoundModal();
        }
      });
    }

    // Puces de motifs rapides
    if (this.quickReasonChips) {
      this.quickReasonChips.forEach(chip => {
        chip.addEventListener("click", () => {
          const wasActive = chip.classList.contains("active");
          this.quickReasonChips.forEach(c => c.classList.remove("active"));
          if (!wasActive) {
            chip.classList.add("active");
          }
        });
      });
    }
  }

  /**
   * Réduit la popup de guidage pour dégager la carte
   */
  collapse() {
    if (this.container) {
      this.container.classList.add("collapsed");
    }
    this.updateCollapsedHandleText();
    if (this.guidanceSheetHandleEl) {
      this.guidanceSheetHandleEl.style.display = "flex";
    }
  }

  /**
   * Ré-affiche la popup de guidage au premier plan
   */
  expand() {
    if (this.container) {
      this.container.classList.remove("collapsed");
    }
    if (this.guidanceSheetHandleEl) {
      this.guidanceSheetHandleEl.style.display = "none";
    }
  }

  /**
   * Met à jour le libellé de la poignée basse quand le guidage est replié
   */
  updateCollapsedHandleText() {
    if (!this.guidanceSheetHandleEl) return;
    const isReturnStep = this.currentIndex === this.panels.length;
    if (isReturnStep) {
      this.guidanceSheetHandleEl.innerHTML = `▲ Retour au départ ▲`;
    } else {
      const stepNum = this.currentIndex + 1;
      this.guidanceSheetHandleEl.innerHTML = `▲ Panneau ${stepNum}/${this.panels.length} ▲`;
    }
  }

  /**
   * Ouvre la modale de signalement pour le panneau courant
   */
  openNotFoundModal() {
    if (this.currentIndex >= this.panels.length) return;
    const currentPanel = this.panels[this.currentIndex];
    const targetTitle = formatPanelDisplayName(currentPanel, this.isMultiCity);

    if (this.notFoundPanelTitleEl) {
      this.notFoundPanelTitleEl.textContent = `📍 Panneau ${this.currentIndex + 1} : ${targetTitle}`;
    }
    if (this.notFoundCommentEl) {
      this.notFoundCommentEl.value = "";
    }
    if (this.quickReasonChips) {
      this.quickReasonChips.forEach(c => c.classList.remove("active"));
    }
    if (this.notFoundModalEl) {
      this.notFoundModalEl.classList.add("active");
    }
  }

  closeNotFoundModal() {
    if (this.notFoundModalEl) {
      this.notFoundModalEl.classList.remove("active");
    }
  }

  /**
   * Valide le fait que le panneau est non collé / non trouvé avec son commentaire
   */
  confirmNotFound() {
    if (this.currentIndex >= this.panels.length) return;
    const currentPanel = this.panels[this.currentIndex];

    // Récupération du motif sélectionné
    let activeReason = "";
    const activeChip = document.querySelector("#quick-reasons-chips .chip-reason.active");
    if (activeChip && activeChip.dataset.reason) {
      activeReason = activeChip.dataset.reason;
    }

    // Récupération du commentaire saisi
    const userComment = this.notFoundCommentEl ? this.notFoundCommentEl.value.trim() : "";

    // Télémétrie silencieuse vers Google Apps Script
    if (this.tracker) {
      try {
        this.tracker.logPanelNotPasted(
          this.currentIndex + 1,
          this.panels.length,
          currentPanel,
          userComment,
          activeReason
        );
      } catch (e) {
        console.warn("Tracker not found log error:", e);
      }
    }

    // Mémorisation dans l'historique de la session
    this.panelStatuses.push({
      panel: currentPanel,
      status: "not_found",
      reason: activeReason,
      comment: userComment
    });

    // Retour sonore et haptique doux
    this.playNeutralSound();

    // Fermeture de la modale
    this.closeNotFoundModal();

    // Passage immédiat à l'étape suivante
    this.currentIndex++;
    this.renderCurrentStep();
  }

  /**
   * Démarre une session de guidage
   */
  start(startCoord, startAddress, orderedPanels, meta = {}) {
    this.startCoord = startCoord;
    this.startAddress = startAddress || "Point de départ";
    this.panels = orderedPanels;
    this.currentIndex = 0;
    this.panelStatuses = [];
    // Total steps = panneaux + 1 étape pour le retour au départ
    this.totalSteps = orderedPanels.length + 1;
    this.isMultiCity = checkIsMultiCityTour(orderedPanels);

    // Télémétrie silencieuse : démarrage de tournée
    if (this.tracker) {
      try {
        this.tracker.logTourStart({
          startCoords: startCoord,
          startAddress: startAddress,
          totalPanels: orderedPanels.length,
          city: meta.city || "",
          distanceKm: meta.distanceKm || "",
          durationMin: meta.durationMin || ""
        });
      } catch (e) {}
    }

    this.container.style.display = "flex";
    this.expand();
    this.renderCurrentStep();
  }

  /**
   * Joue un petit bip sonore positif (synthèse Web Audio, sans fichier externe)
   */
  playSuccessSound() {
    try {
      if (!this.audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AudioContext();
      }
      if (this.audioCtx.state === "suspended") {
        this.audioCtx.resume();
      }

      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = "sine";
      
      // Deux notes joyeuses montantes
      osc.frequency.setValueAtTime(587.33, this.audioCtx.currentTime); // Ré5
      osc.frequency.setValueAtTime(880.00, this.audioCtx.currentTime + 0.1); // La5

      gain.gain.setValueAtTime(0.3, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.35);
    } catch (e) {
      console.warn("Audio feedback error:", e);
    }

    // Retour tactile haptique sur smartphone
    if ("vibrate" in navigator) {
      try {
        navigator.vibrate([100, 50, 150]);
      } catch (e) {}
    }
  }

  /**
   * Joue un son neutre/doux lors d'un panneau ignoré ou introuvable
   */
  playNeutralSound() {
    try {
      if (!this.audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AudioContext();
      }
      if (this.audioCtx.state === "suspended") {
        this.audioCtx.resume();
      }

      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = "sine";

      osc.frequency.setValueAtTime(440.00, this.audioCtx.currentTime); // La4
      osc.frequency.setValueAtTime(369.99, this.audioCtx.currentTime + 0.08); // Fa#4

      gain.gain.setValueAtTime(0.2, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.25);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.25);
    } catch (e) {}

    if ("vibrate" in navigator) {
      try {
        navigator.vibrate(80);
      } catch (e) {}
    }
  }

  renderCurrentStep() {
    const isReturnStep = this.currentIndex === this.panels.length;

    // Calcul de la progression
    const percent = Math.round((this.currentIndex / (this.totalSteps - 1)) * 100);
    this.progressBarEl.style.width = `${Math.min(100, Math.max(5, percent))}%`;

    let targetLat, targetLon, targetTitle, targetNotes;

    if (isReturnStep) {
      // Étape finale : Retour au point de départ
      this.stepIndicatorEl.innerHTML = `🏁 RETOUR AU DÉPART (Étape ${this.currentIndex + 1}/${this.totalSteps})`;
      targetLat = this.startCoord[1];
      targetLon = this.startCoord[0];
      targetTitle = `Retour à : ${this.startAddress}`;
      targetNotes = "Boucle bouclée ! Direction votre point de départ.";

      this.btnPastedEl.innerHTML = `🏁 Terminer la tournée`;
      this.btnPastedEl.style.background = "linear-gradient(135deg, #38bdf8, #2563eb)";
      
      // Masquage du bouton Pas trouvé sur l'étape de retour
      if (this.btnNotFoundEl) {
        this.btnNotFoundEl.style.display = "none";
      }
    } else {
      // Panneau intermédiaire
      const panel = this.panels[this.currentIndex];
      const stepNum = this.currentIndex + 1;
      const coords = panel.geometry.coordinates;
      targetLat = coords[1];
      targetLon = coords[0];
      targetTitle = formatPanelDisplayName(panel, this.isMultiCity);
      targetNotes = (panel.properties.notes || '').trim();

      this.stepIndicatorEl.innerHTML = `📍 Panneau ${stepNum} sur ${this.panels.length}`;
      this.btnPastedEl.innerHTML = `✅ C'est collé ! Panneau suivant ➡️`;
      this.btnPastedEl.style.background = "linear-gradient(135deg, #10b981, #059669)";

      // Affichage du bouton Pas trouvé
      if (this.btnNotFoundEl) {
        this.btnNotFoundEl.style.display = "flex";
      }

      // Centrage de la carte sur le panneau actif
      this.map.setActivePanels(this.panels, this.currentIndex);
      this.map.focusPanel(panel);
    }

    this.addressEl.textContent = targetTitle;
    this.notesEl.textContent = targetNotes;

    // Mise à jour de la cible courante pour la navigation GPS
    this.currentTargetLat = targetLat;
    this.currentTargetLon = targetLon;
    this.updateNavButton();

    // Mise à jour du texte de la poignée repliée
    this.updateCollapsedHandleText();
  }

  /**
   * Retourne l'identifiant de l'application GPS préférée
   * @returns {string|null}
   */
  getPreferredNavAppId() {
    const dev = getDeviceInfo();
    const saved = localStorage.getItem("preferred_nav_app");
    if (saved && NAV_APPS[saved] && NAV_APPS[saved].isAvailable(dev)) {
      return saved;
    }
    // Sur desktop (PC / Mac), Google Maps est présélectionné par défaut si aucun choix n'a été fait
    if (dev && dev.isDesktop) {
      return "gmaps";
    }
    return null;
  }

  /**
   * Met à jour le bouton principal de navigation selon l'application préférée et l'étape courante
   */
  updateNavButton() {
    if (!this.btnNavMainEl) return;
    const dev = getDeviceInfo();
    const currentAppId = this.getPreferredNavAppId();
    const app = NAV_APPS[currentAppId];

    if (app && this.currentTargetLat != null && this.currentTargetLon != null) {
      const url = app.getUrl(this.currentTargetLat, this.currentTargetLon, dev);
      this.btnNavMainEl.href = url;
      if (this.btnNavIconEl) this.btnNavIconEl.textContent = app.icon;
      if (this.btnNavLabelEl) this.btnNavLabelEl.textContent = `Naviguer avec ${app.shortName}`;
      this.btnNavMainEl.style.background = app.gradient;
      this.btnNavMainEl.title = `Ouvrir l'itinéraire dans ${app.name}`;
    } else {
      this.btnNavMainEl.href = "#";
      if (this.btnNavIconEl) this.btnNavIconEl.textContent = "🧭";
      if (this.btnNavLabelEl) this.btnNavLabelEl.textContent = "Choisir mon GPS...";
      this.btnNavMainEl.style.background = "linear-gradient(135deg, #0284c7, #2563eb)";
      this.btnNavMainEl.title = "Sélectionner une application GPS";
    }
  }

  /**
   * Ouvre la modale de sélection de l'application GPS
   */
  openGpsModal() {
    if (!this.gpsModalEl || !this.gpsOptionsListEl) return;
    const dev = getDeviceInfo();
    const currentAppId = this.getPreferredNavAppId();

    this.gpsOptionsListEl.innerHTML = "";

    Object.values(NAV_APPS).forEach(app => {
      if (!app.isAvailable(dev)) return;

      const isCurrent = (currentAppId === app.id);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `gps-option-btn ${isCurrent ? "selected" : ""}`;
      btn.innerHTML = `
        <span class="gps-option-icon">${app.icon}</span>
        <div class="gps-option-info">
          <div class="gps-option-title-row">
            <span class="gps-option-title">${app.name}</span>
            ${isCurrent ? '<span class="gps-option-badge current">Actif</span>' : ''}
          </div>
          <span class="gps-option-desc">${app.desc}</span>
        </div>
      `;

      btn.addEventListener("click", () => {
        this.selectNavApp(app.id, true);
      });

      this.gpsOptionsListEl.appendChild(btn);
    });

    this.gpsModalEl.classList.add("active");
  }

  /**
   * Ferme la modale de sélection GPS
   */
  closeGpsModal() {
    if (this.gpsModalEl) {
      this.gpsModalEl.classList.remove("active");
    }
  }

  /**
   * Sélectionne une application GPS (avec ou sans mémorisation) et lance éventuellement la navigation
   * @param {string} appId
   * @param {boolean} openNow
   */
  selectNavApp(appId, openNow = false) {
    const app = NAV_APPS[appId];
    if (!app) return;

    const shouldRemember = this.chkRememberGpsEl ? this.chkRememberGpsEl.checked : true;
    if (shouldRemember) {
      try {
        localStorage.setItem("preferred_nav_app", appId);
      } catch (e) {}
    } else {
      try {
        localStorage.removeItem("preferred_nav_app");
      } catch (e) {}
    }

    this.closeGpsModal();
    this.updateNavButton();

    if (openNow && this.currentTargetLat != null && this.currentTargetLon != null) {
      const dev = getDeviceInfo();
      const url = app.getUrl(this.currentTargetLat, this.currentTargetLon, dev);
      if (app.isCustomScheme) {
        window.location.href = url;
      } else {
        window.open(url, "_blank");
      }
    }
  }

  nextStep() {
    this.playSuccessSound();

    if (this.currentIndex < this.panels.length) {
      const currentPanel = this.panels[this.currentIndex];

      // Mémorisation dans l'historique de la session
      this.panelStatuses.push({
        panel: currentPanel,
        status: "pasted"
      });

      // Télémétrie silencieuse : panneau collé avec succès
      if (this.tracker) {
        try {
          this.tracker.logPanelDone(this.currentIndex + 1, this.panels.length, currentPanel);
        } catch (e) {}
      }

      // Passage au panneau suivant
      this.currentIndex++;
      this.renderCurrentStep();
    } else {
      // Tournée terminée (départ regagné)
      this.finish();
    }
  }

  finish() {
    this.expand();
    this.container.style.display = "none";
    if (this.guidanceSheetHandleEl) {
      this.guidanceSheetHandleEl.style.display = "none";
    }

    const pastedCount = this.panelStatuses.filter(s => s.status === "pasted").length;
    const notFoundCount = this.panelStatuses.filter(s => s.status === "not_found").length;

    // Télémétrie silencieuse : fin de tournée
    if (this.tracker) {
      try {
        this.tracker.logTourCompleted(this.panels.length, {
          endCoords: this.startCoord,
          pastedCount: pastedCount,
          notFoundCount: notFoundCount
        });
      } catch (e) {}
    }

    if (this.onFinish) {
      this.onFinish({
        totalPanels: this.panels.length,
        pastedCount: pastedCount,
        notFoundCount: notFoundCount,
        isCompleted: true
      });
    }
  }

  exit() {
    if (confirm("Quitter le mode guidage et revenir à la carte de la tournée ?")) {
      // Télémétrie silencieuse : abandon si la tournée n'était pas terminée
      if (this.tracker && this.currentIndex < this.panels.length) {
        try {
          this.tracker.logTourAbandoned(this.currentIndex + 1, this.panels.length);
        } catch (e) {}
      }

      this.expand();
      this.container.style.display = "none";
      if (this.guidanceSheetHandleEl) {
        this.guidanceSheetHandleEl.style.display = "none";
      }
      if (this.onExit) this.onExit();
    }
  }
}
