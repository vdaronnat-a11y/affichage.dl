/**
 * Module de Télémétrie Invisible pour Tournées d'Affichage
 * 
 * - Génération d'identifiants uniques (Terminal DEV-XXXX et Tournée TRN-XXXX)
 * - Horodatage précis à la seconde de chaque panneau collé
 * - Envoi silencieux en arrière-plan (mode no-cors vers Google Apps Script)
 * - File d'attente hors-ligne (offline-first) dans localStorage
 * - ZÉRO alerte, ZÉRO message de traçage sur l'écran
 */

const STORAGE_KEYS = {
  DEVICE_ID: "app_device_uuid",
  WEBHOOK_URL: "tour_tracker_webhook_url",
  QUEUE: "tour_tracker_queue"
};

// URL de webhook Google Apps Script globale (à renseigner après déploiement du script)
export const CONFIG_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzjigIrOGEgpR7q0o_QidS9TUjfFf9FCArFuB8F0iAj3K6MnaixRM2GflSrGPSIigya/exec";

export class TourTracker {
  constructor(webhookUrl = null) {
    this.webhookUrl = webhookUrl || CONFIG_WEBHOOK_URL || localStorage.getItem(STORAGE_KEYS.WEBHOOK_URL) || "";
    this.deviceId = this.getOrCreateDeviceId();
    this.currentTourId = null;
    this.tourStartTime = null;
    this.lastStopTime = null;

    // Tentative de vidage de la file d'attente si le réseau est disponible
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.flushQueue());
      setTimeout(() => this.flushQueue(), 2000);
    }
  }

  /**
   * Récupère ou génère un identifiant unique et persistant pour ce terminal
   */
  getOrCreateDeviceId() {
    try {
      let id = localStorage.getItem(STORAGE_KEYS.DEVICE_ID);
      if (!id) {
        let randHex;
        if (typeof crypto !== "undefined" && crypto.randomUUID) {
          randHex = crypto.randomUUID().replace(/-/g, "").substring(0, 10).toUpperCase();
        } else {
          randHex = (Math.random().toString(36).substring(2, 8) + Math.random().toString(36).substring(2, 6)).toUpperCase();
        }
        id = `DEV-${randHex}`;
        localStorage.setItem(STORAGE_KEYS.DEVICE_ID, id);
      }
      return id;
    } catch (e) {
      return "DEV-TEMP-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    }
  }

  /**
   * Génère un identifiant unique pour une session de tournée (ex: TRN-0917-8F2B)
   */
  generateTourId() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    let rand;
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      rand = crypto.randomUUID().substring(0, 4).toUpperCase();
    } else {
      rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    }
    return `TRN-${mm}${dd}-${rand}`;
  }

  /**
   * Met à jour l'URL du webhook (sauvegardé dans localStorage)
   */
  setWebhookUrl(url) {
    this.webhookUrl = (url || "").trim();
    try {
      if (this.webhookUrl) {
        localStorage.setItem(STORAGE_KEYS.WEBHOOK_URL, this.webhookUrl);
      } else {
        localStorage.removeItem(STORAGE_KEYS.WEBHOOK_URL);
      }
    } catch (e) {}
  }

  getWebhookUrl() {
    return this.webhookUrl || localStorage.getItem(STORAGE_KEYS.WEBHOOK_URL) || "";
  }

  /**
   * Événement : Sauvegarde et planification d'une tournée (archivage d'équipe)
   */
  logTourSaved(tourData = {}) {
    const tourId = tourData.tour_id || this.currentTourId || this.generateTourId();
    this.currentTourId = tourId;
    const payload = {
      device_id: this.deviceId,
      tour_id: tourId,
      event: "SAVE_TOUR",
      step: "PLANIFICATION",
      panel_name: `${tourData.panel_count || 0} panneaux`,
      city: tourData.city || "",
      coords: tourData.start_coords || null,
      elapsed_since_last: "",
      details: JSON.stringify(tourData)
    };

    this.sendEvent(payload);
    return tourId;
  }

  /**
   * Événement : Restauration et ouverture d'une tournée sauvegardée via URL
   */
  logTourRestored(tourData = {}) {
    const tourId = tourData.tour_id || this.currentTourId || this.generateTourId();
    this.currentTourId = tourId;
    const payload = {
      device_id: this.deviceId,
      tour_id: tourId,
      event: "RESTORE_TOUR",
      step: "OUVERTURE",
      panel_name: `${tourData.panel_count || 0} panneaux`,
      city: tourData.city || "",
      coords: tourData.start_coords || null,
      elapsed_since_last: "",
      details: JSON.stringify(tourData)
    };

    this.sendEvent(payload);
    return tourId;
  }

  /**
   * 1. Événement : Lancement de la tournée
   */
  logTourStart(details = {}) {
    this.currentTourId = this.generateTourId();
    this.tourStartTime = Date.now();
    this.lastStopTime = this.tourStartTime;

    const payload = {
      device_id: this.deviceId,
      tour_id: this.currentTourId,
      event: "DÉPART",
      step: "0/" + (details.totalPanels || "?"),
      panel_name: "Départ : " + (details.startAddress || "Position sélectionnée"),
      city: details.city || "",
      coords: details.startCoords || null,
      elapsed_since_last: "0 min",
      details: `${details.totalPanels || 0} panneaux prévus | ${details.distanceKm || ''} | Est. ${details.durationMin || ''}`
    };

    this.sendEvent(payload);
    return this.currentTourId;
  }

  /**
   * 2. Événement : Panneau collé avec succès
   */
  logPanelDone(stepNumber, totalPanels, panel = {}) {
    if (!this.currentTourId) {
      this.currentTourId = this.generateTourId();
      this.tourStartTime = Date.now();
      this.lastStopTime = this.tourStartTime;
    }

    const now = Date.now();
    const elapsedMinutes = this.lastStopTime ? Math.round((now - this.lastStopTime) / 60000) : 0;
    this.lastStopTime = now;

    const props = panel.properties || {};
    const coords = panel.geometry && panel.geometry.coordinates ? panel.geometry.coordinates : null;

    const payload = {
      device_id: this.deviceId,
      tour_id: this.currentTourId,
      event: "COLLÉ",
      step: `${stepNumber}/${totalPanels}`,
      panel_name: props.name || `Panneau n°${stepNumber}`,
      city: props.commune || props.city || "",
      coords: coords,
      elapsed_since_last: elapsedMinutes > 0 ? `'+${elapsedMinutes} min` : "'< 1 min",
      details: props.notes || "Affichage libre validé"
    };

    this.sendEvent(payload);
  }

  /**
   * 3. Événement : Fin de tournée (retour au point de départ)
   */
  logTourCompleted(totalPanels, details = {}) {
    if (!this.currentTourId) return;

    const now = Date.now();
    const totalDurationMinutes = this.tourStartTime ? Math.round((now - this.tourStartTime) / 60000) : 0;
    const formatDuration = totalDurationMinutes >= 60 
      ? `${Math.floor(totalDurationMinutes / 60)}h${String(totalDurationMinutes % 60).padStart(2, "0")}`
      : `${totalDurationMinutes} min`;

    const payload = {
      device_id: this.deviceId,
      tour_id: this.currentTourId,
      event: "TERMINÉ",
      step: `${totalPanels}/${totalPanels}`,
      panel_name: "Boucle terminée - Retour au départ",
      city: details.city || "",
      coords: details.endCoords || null,
      elapsed_since_last: formatDuration + " total",
      details: `100% terminé (${totalPanels} panneaux collés) | Durée totale : ${formatDuration}`
    };

    this.sendEvent(payload);
  }

  /**
   * 4. Événement : Abandon ou arrêt prématuré
   */
  logTourAbandoned(currentStep, totalPanels) {
    if (!this.currentTourId) return;

    const payload = {
      device_id: this.deviceId,
      tour_id: this.currentTourId,
      event: "ABANDON",
      step: `${currentStep}/${totalPanels}`,
      panel_name: "Tournée interrompue par l'utilisateur",
      city: "",
      coords: null,
      elapsed_since_last: "Interrompu",
      details: `Interrompu à l'étape ${currentStep}/${totalPanels}`
    };

    this.sendEvent(payload);
  }

  /**
   * Envoi d'un événement vers le webhook de façon 100% silencieuse
   */
  async sendEvent(payload) {
    const url = this.getWebhookUrl();
    if (!url) {
      // Si pas encore de webhook configuré, on enregistre quand même en file locale au cas où
      this.enqueue(payload);
      return;
    }

    try {
      // Content-Type text/plain avec no-cors pour éviter les blocages de preflight CORS de Google Apps Script
      await fetch(url, {
        method: "POST",
        mode: "no-cors",
        headers: {
          "Content-Type": "text/plain;charset=utf-8"
        },
        body: JSON.stringify(payload)
      });
      // Succès silencieux
    } catch (err) {
      // En cas d'erreur réseau ou hors-ligne, mise en file d'attente locale
      this.enqueue(payload);
    }
  }

  /**
   * Stockage dans la file d'attente locale
   */
  enqueue(payload) {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.QUEUE);
      const queue = raw ? JSON.parse(raw) : [];
      queue.push({
        payload,
        queued_at: Date.now()
      });
      // Limitation à 200 événements max pour ne pas encombrer le localStorage
      if (queue.length > 200) queue.shift();
      localStorage.setItem(STORAGE_KEYS.QUEUE, JSON.stringify(queue));
    } catch (e) {}
  }

  /**
   * Vidage de la file d'attente dès que le réseau est disponible
   */
  async flushQueue() {
    const url = this.getWebhookUrl();
    if (!url || (typeof navigator !== "undefined" && !navigator.onLine)) return;

    try {
      const raw = localStorage.getItem(STORAGE_KEYS.QUEUE);
      if (!raw) return;
      const queue = JSON.parse(raw);
      if (!queue.length) return;

      const remaining = [];
      for (const item of queue) {
        try {
          await fetch(url, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(item.payload)
          });
        } catch (e) {
          remaining.push(item);
        }
      }

      if (remaining.length) {
        localStorage.setItem(STORAGE_KEYS.QUEUE, JSON.stringify(remaining));
      } else {
        localStorage.removeItem(STORAGE_KEYS.QUEUE);
      }
    } catch (e) {}
  }
}
