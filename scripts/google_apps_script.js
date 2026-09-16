/**
 * SCRIPT GOOGLE APPS SCRIPT POUR RÉCEPTION DES TOURNÉES D'AFFICHAGE LIBRE
 * 
 * Instructions d'installation en 2 minutes :
 * 1. Ouvrez votre Google Sheet (ou créez-en un nouveau sur sheets.new).
 * 2. Dans le menu, cliquez sur "Extensions" > "Apps Script".
 * 3. Effacez le code existant et collez TOUT le contenu de ce fichier.
 * 4. Cliquez sur "Déployer" (en haut à droite) > "Nouveau déploiement".
 * 5. Type : sélectionnez "Application Web" (via l'icône engrenage).
 * 6. Configuration :
 *    - Description : "Webhook Tournée Affiches"
 *    - Exécuter en tant que : "Moi (votre adresse email)"
 *    - Qui a accès : "Tout le monde" (IMPORTANT : permet aux téléphones d'envoyer les pings sans login)
 * 7. Cliquez sur "Déployer", autorisez les accès Google si demandé.
 * 8. Copiez "l'URL de l'application Web" (qui se termine par /exec) et collez-la dans la configuration de l'application.
 */

function doPost(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getActiveSheet();

    // Initialisation des en-têtes si la feuille est vide
    if (sheet.getLastRow() === 0) {
      var headers = [
        "Date / Heure",
        "Terminal ID",
        "Tournée ID",
        "Événement",
        "Étape",
        "Panneau / Emplacement",
        "Commune",
        "Coordonnées GPS",
        "Durée arrêt",
        "Détails tournée"
      ];
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
      sheet.setFrozenRows(1);
    }

    // Parsing du payload
    var data;
    if (e && e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Aucune donnée" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var nowFormatted = Utilities.formatDate(new Date(), "Europe/Paris", "dd/MM/yyyy HH:mm:ss");

    function safeText(v) {
      if (typeof v === "string" && (v.indexOf("+") === 0 || v.indexOf("=") === 0)) {
        return "'" + v;
      }
      return v;
    }

    var row = [
      nowFormatted,
      data.device_id || "Inconnu",
      data.tour_id || "N/A",
      data.event || "LOG",
      data.step || "",
      data.panel_name || "",
      data.city || "",
      data.coords ? (data.coords[1] + ", " + data.coords[0]) : "",
      safeText(data.elapsed_since_last || ""),
      data.details || ""
    ];

    sheet.appendRow(row);

    return ContentService.createTextOutput(JSON.stringify({ status: "success", row: sheet.getLastRow() }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput("OK - Webhook Tournée Affiches actif");
}
