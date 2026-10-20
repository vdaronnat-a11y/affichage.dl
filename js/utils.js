/**
 * Utilitaires pour le formatage et l'affichage des panneaux
 */

/**
 * Détermine si une liste de panneaux couvre plusieurs communes distinctes
 * @param {Array} panels
 * @returns {boolean}
 */
export function checkIsMultiCityTour(panels) {
  if (!panels || panels.length <= 1) return false;
  const cities = new Set(
    panels
      .map(p => (p.properties && p.properties.city || '').trim().toLowerCase())
      .filter(Boolean)
  );
  return cities.size > 1;
}

/**
 * Retourne le nom d'affichage d'un panneau
 * - Tournée mono-commune : adresse seule (ex: "42 Rue Ampère")
 * - Tournée multi-communes : adresse et commune (ex: "42 Rue Ampère, Colmar")
 * @param {Object} panel
 * @param {boolean} isMultiCity
 * @returns {string}
 */
export function formatPanelDisplayName(panel, isMultiCity) {
  if (!panel || !panel.properties) return '';
  const name = (panel.properties.name || '').trim();
  const city = (panel.properties.city || '').trim();
  if (isMultiCity && city) {
    return `${name}, ${city}`;
  }
  return name;
}

/**
 * Détecte les caractéristiques de l'appareil courant (Mobile / Tablette / Desktop, iOS, Android, Mac)
 * @returns {Object}
 */
export function getDeviceInfo() {
  const ua = (typeof navigator !== "undefined" ? navigator.userAgent : "") || "";
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || 
                (typeof navigator !== "undefined" && navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const hasTouch = (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches) || 
                   (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0);
  const isMobile = isIOS || isAndroid || (hasTouch && typeof window !== "undefined" && window.innerWidth < 1024);

  return {
    isMobile: isMobile,
    isDesktop: !isMobile,
    isIOS: isIOS,
    isAndroid: isAndroid,
    isMac: /Macintosh|Mac OS X/i.test(ua) && !isIOS
  };
}
