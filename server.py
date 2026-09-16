#!/usr/bin/env python3
"""
Serveur HTTP local léger pour Tournée Affiches
- Distribue l'application web statique
- Sauvegarde les nouvelles villes ajoutées dans data/cities.json et data/panels/
- Affiche l'adresse IP locale pour tester sur smartphone en Wi-Fi
"""

import http.server
import socketserver
import os
import json
import socket

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

class TourneeHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Empêcher la mise en cache agressive des scripts JS par les navigateurs mobiles
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_POST(self):
        if self.path == "/api/cities/add":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length)
                data = json.loads(body.decode("utf-8"))

                city_meta = data.get("city")
                geojson_data = data.get("geojson")

                if not city_meta or not geojson_data:
                    self.send_error(400, "Données invalides")
                    return

                # 1. Sauvegarde du fichier geojson dans data/panels/
                panels_dir = os.path.join(DIRECTORY, "data", "panels")
                os.makedirs(panels_dir, exist_ok=True)
                filename = f"{city_meta['id']}.geojson"
                file_path = os.path.join(panels_dir, filename)

                with open(file_path, "w", encoding="utf-8") as f:
                    json.dump(geojson_data, f, ensure_ascii=False, indent=2)

                # 2. Mise à jour de data/cities.json
                cities_path = os.path.join(DIRECTORY, "data", "cities.json")
                cities = []
                if os.path.exists(cities_path):
                    with open(cities_path, "r", encoding="utf-8") as f:
                        try:
                            cities = json.load(f)
                        except Exception:
                            cities = []

                city_meta["file"] = f"panels/{filename}"
                cities.insert(0, city_meta)

                with open(cities_path, "w", encoding="utf-8") as f:
                    json.dump(cities, f, ensure_ascii=False, indent=2)

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "city": city_meta}).encode("utf-8"))
                print(f"[+] Nouvelle ville enregistrée sur disque : {city_meta['name']} ({city_meta['count']} panneaux)")
                return

            except Exception as e:
                print(f"[X] Erreur /api/cities/add: {e}")
                self.send_error(500, str(e))
                return

        self.send_error(404, "Endpoint non trouvé")

def run_server():
    local_ip = get_local_ip()
    print("=" * 60)
    print("  🪧  APPLICATION TOURNÉE AFFICHES DÉMARRÉE !")
    print("=" * 60)
    print(f"  Sur votre Mac :        http://localhost:{PORT}")
    print(f"  Depuis votre smartphone: http://{local_ip}:{PORT}")
    print("=" * 60)
    print("  Appuyez sur Ctrl+C pour arrêter le serveur.")
    print("=" * 60)

    # Réutilisation du port pour éviter Address already in use
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), TourneeHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nArrêt du serveur.")

if __name__ == "__main__":
    run_server()
