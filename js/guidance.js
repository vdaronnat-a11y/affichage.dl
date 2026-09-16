/**
 * Module du Mode Guidage Terrain (voiture / smartphone)
 * Gestion étape par étape, deep-linking Google Maps / Waze, signaux sonores et boucle de retour
 */

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
    this.btnExitEl = document.getElementById("btn-exit-guidance");

    if (this.btnPastedEl) {
      this.btnPastedEl.addEventListener("click", () => this.nextStep());
    }
    if (this.btnExitEl) {
      this.btnExitEl.addEventListener("click", () => this.exit());
    }
  }

  /**
   * Démarre une session de guidage
   */
  start(startCoord, startAddress, orderedPanels, meta = {}) {
    this.startCoord = startCoord;
    this.startAddress = startAddress || "Point de départ";
    this.panels = orderedPanels;
    this.currentIndex = 0;
    // Total steps = panneaux + 1 étape pour le retour au départ
    this.totalSteps = orderedPanels.length + 1;

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
    } else {
      // Panneau intermédiaire
      const panel = this.panels[this.currentIndex];
      const stepNum = this.currentIndex + 1;
      const coords = panel.geometry.coordinates;
      targetLat = coords[1];
      targetLon = coords[0];
      targetTitle = panel.properties.name;
      targetNotes = panel.properties.notes || "Panneau d'affichage libre";

      this.stepIndicatorEl.innerHTML = `📍 Panneau ${stepNum} sur ${this.panels.length}`;
      this.btnPastedEl.innerHTML = `✅ C'est collé ! Panneau suivant ➡️`;
      this.btnPastedEl.style.background = "linear-gradient(135deg, #10b981, #059669)";

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
      // Télémétrie silencieuse : panneau collé avec succès
      if (this.tracker) {
        try {
          const currentPanel = this.panels[this.currentIndex];
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

    // Télémétrie silencieuse : fin de tournée
    if (this.tracker) {
      try {
        this.tracker.logTourCompleted(this.panels.length, {
          endCoords: this.startCoord
        });
      } catch (e) {}
    }

    if (this.onFinish) {
      this.onFinish({
        totalPanels: this.panels.length,
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
