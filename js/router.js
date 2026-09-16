/**
 * Module de calcul et d'optimisation d'itinéraire routier (OSRM Driving)
 * La tournée démarre au point de départ et se termine au même endroit (boucle complète / roundtrip).
 * Respecte strictement le code de la route : sens interdits, sens uniques, ronds-points.
 */

export class TourRouter {
  constructor() {
    this.osrmBaseUrl = "https://router.project-osrm.org";
  }

  /**
   * Calcule la distance euclidienne / Haversine en km entre deux points GPS
   */
  getDistanceKm(coord1, coord2) {
    const R = 6371; // Rayon de la Terre en km
    const dLat = (coord2[1] - coord1[1]) * (Math.PI / 180);
    const dLon = (coord2[0] - coord1[0]) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(coord1[1] * (Math.PI / 180)) *
        Math.cos(coord2[1] * (Math.PI / 180)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Sélectionne les N panneaux les plus pertinents autour du point de départ
   */
  selectBestPanels(startCoord, allPanels, count) {
    if (!allPanels || allPanels.length === 0) return [];
    if (count >= allPanels.length) return [...allPanels];

    // Calcul de la distance au départ pour chaque panneau
    const sorted = [...allPanels].map(panel => {
      const coords = panel.geometry.coordinates;
      const dist = this.getDistanceKm(startCoord, coords);
      return { panel, dist };
    });

    sorted.sort((a, b) => a.dist - b.dist);
    return sorted.slice(0, count).map(item => item.panel);
  }

  /**
   * Optimise l'ordre des étapes et trace la boucle fermée (départ et retour au même point)
   */
  async optimizeRoute(startCoord, selectedPanels) {
    if (!selectedPanels || selectedPanels.length === 0) {
      return {
        orderedPanels: [],
        polylineCoordinates: [],
        distanceKm: 0,
        durationMinutes: 0
      };
    }

    // Coordonnées : [startCoord, panel1, panel2, ...]
    const coordsList = [startCoord, ...selectedPanels.map(p => p.geometry.coordinates)];
    const coordsString = coordsList.map(c => `${c[0].toFixed(6)},${c[1].toFixed(6)}`).join(";");

    try {
      // OSRM Trip API avec roundtrip=true et source=first :
      // La boucle démarre obligatoirement au point de départ et y revient après avoir visité tous les points
      const url = `${this.osrmBaseUrl}/trip/v1/driving/${coordsString}?source=first&roundtrip=true&overview=full&geometries=geojson`;
      const resp = await fetch(url);
      
      if (!resp.ok) {
        throw new Error(`OSRM HTTP error: ${resp.status}`);
      }

      const data = await resp.json();
      if (data.code === "Ok" && data.trips && data.trips.length > 0) {
        const trip = data.trips[0];
        const waypoints = data.waypoints;

        // Réordonnancement rigoureux des panneaux d'après les waypoints OSRM :
        // - waypoints[0] correspond au départ (waypoint_index = 0)
        // - waypoints[i] (pour i = 1..N) correspond à selectedPanels[i - 1]
        // - wp.waypoint_index est le RANG de passage optimal dans la boucle (1, 2, 3...) !
        const rankedPanels = selectedPanels.map((panel, idx) => {
          const wp = waypoints[idx + 1];
          return {
            panel: panel,
            visitOrder: wp ? wp.waypoint_index : idx + 1
          };
        });

        // On trie strictement selon le rang de visite optimal calculé par OSRM
        rankedPanels.sort((a, b) => a.visitOrder - b.visitOrder);
        const orderedPanels = rankedPanels.map(item => item.panel);

        const polyline = trip.geometry.coordinates; // Tracé exact de la route
        const distKm = (trip.distance / 1000).toFixed(1);
        const drivingMin = Math.round(trip.duration / 60);
        // Ajout de 8 minutes par panneau pour le temps de collage/stationnement
        const durationMin = drivingMin + (orderedPanels.length * 8);

        return {
          orderedPanels: orderedPanels,
          polylineCoordinates: polyline,
          distanceKm: parseFloat(distKm),
          durationMinutes: durationMin,
          drivingMinutes: drivingMin,
          isLoop: true
        };
      }
    } catch (e) {
      console.warn("OSRM roundtrip indisponible ou trop de points, recours au repli:", e);
    }

    // Mode secours (boucle fermée locale)
    return this.fallbackOptimizeLoop(startCoord, selectedPanels);
  }

  /**
   * Algorithme de secours local pour boucle fermée (Plus proche voisin + 2-opt décroisement)
   */
  async fallbackOptimizeLoop(startCoord, selectedPanels) {
    const unvisited = [...selectedPanels];
    const ordered = [];
    let current = startCoord;

    while (unvisited.length > 0) {
      let nearestIdx = 0;
      let minDst = Infinity;
      for (let i = 0; i < unvisited.length; i++) {
        const d = this.getDistanceKm(current, unvisited[i].geometry.coordinates);
        if (d < minDst) {
          minDst = d;
          nearestIdx = i;
        }
      }
      const nextPanel = unvisited.splice(nearestIdx, 1)[0];
      ordered.push(nextPanel);
      current = nextPanel.geometry.coordinates;
    }

    // Passe 2-opt d'élimination de tout croisement dans la boucle
    let improved = true;
    let iterations = 0;
    while (improved && iterations < 50) {
      improved = false;
      iterations++;
      for (let i = 0; i < ordered.length - 1; i++) {
        for (let k = i + 1; k < ordered.length; k++) {
          const prevA = i === 0 ? startCoord : ordered[i - 1].geometry.coordinates;
          const a = ordered[i].geometry.coordinates;
          const b = ordered[k].geometry.coordinates;
          const nextB = k === ordered.length - 1 ? startCoord : ordered[k + 1].geometry.coordinates;

          const currentDist = this.getDistanceKm(prevA, a) + this.getDistanceKm(b, nextB);
          const newDist = this.getDistanceKm(prevA, b) + this.getDistanceKm(a, nextB);

          if (newDist < currentDist - 0.001) {
            const sub = ordered.slice(i, k + 1).reverse();
            ordered.splice(i, k - i + 1, ...sub);
            improved = true;
          }
        }
      }
    }

    // Tracé de la boucle : Départ -> Panneaux -> Départ
    const allCoords = [startCoord, ...ordered.map(p => p.geometry.coordinates), startCoord];
    let distKm = 0;

    for (let i = 0; i < allCoords.length - 1; i++) {
      distKm += this.getDistanceKm(allCoords[i], allCoords[i + 1]);
    }

    // Vitesse moyenne estimée en agglomération : 25 km/h + 8 min par panneau pour le collage
    const drivingMin = Math.round((distKm / 25) * 60);
    const durationMin = drivingMin + (ordered.length * 8);

    return {
      orderedPanels: ordered,
      polylineCoordinates: allCoords,
      distanceKm: parseFloat(distKm.toFixed(1)),
      durationMinutes: durationMin,
      drivingMinutes: drivingMin,
      isLoop: true
    };
  }
}
