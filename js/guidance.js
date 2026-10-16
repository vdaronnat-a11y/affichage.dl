/**
 * Module du Mode Guidage Terrain (voiture / smartphone)
 * Gestion étape par étape, deep-linking Google Maps / Waze, signaux sonores et boucle de retour
 */

import { checkIsMultiCityTour, formatPanelDisplayName } from "./utils.js?v=3.3";

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

    this.initElements();
  }

  initElements() {
    this.stepIndicatorEl = document.getElementById("guidance-step-indicator");
    this.progressBarEl = document.getElementById("guidance-progress-bar");
    this.addressEl = document.getElementById("guidance-address");
    this.notesEl = document.getElementById("guidance-notes");
    this.btnGmapsEl = document.getElementById("btn-nav-gmaps");
    this.btnWazeEl = document.getElementById("btn-nav-waze");
    this.btnPastedEl = document.getElementById("btn-pasted-giant");
    this.btnNotFoundEl = document.getElementById("btn-panel-not-found");
    this.btnExitEl = document.getElementById("btn-exit-guidance");

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

    // Liens profonds GPS
    // Google Maps Navigation URL universelle (ouvre directement l'appli sur Android/iOS)
    const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${targetLat.toFixed(6)},${targetLon.toFixed(6)}&travelmode=driving`;
    this.btnGmapsEl.href = gmapsUrl;

    // Waze Navigation URL universelle
    const wazeUrl = `https://waze.com/ul?ll=${targetLat.toFixed(6)},${targetLon.toFixed(6)}&navigate=yes`;
    this.btnWazeEl.href = wazeUrl;
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
    this.container.style.display = "none";

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

      this.container.style.display = "none";
      if (this.onExit) this.onExit();
    }
  }
}
