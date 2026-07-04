#!/usr/bin/env python3
"""
Webcomic server — auto-discovers comics from the filesystem.

Each folder under `comics/` is one comic; images inside are its pages (sorted
alphabetically).  The server rescans the filesystem on every API request, so new
comics dropped into the folder appear immediately — no restart needed.

Architecture:
  - dev:  `python server.py` — serves frontend, API, and images all-in-one
  - prod: run this on 127.0.0.1:8080 and put nginx in front (see nginx.conf).
          nginx serves static files + images; it proxies /api/ here so that the
          Python process is never exposed to the outside world.

Usage:
    python server.py              # 127.0.0.1:8080 (safe default for prod)
    python server.py 0.0.0.0 8080 # all interfaces (convenient for dev)
"""

import json
import sys
import os
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent
COMICS_DIR = ROOT / "comics"
STATIC_DIR = ROOT / "static"

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"}

# Track what we saw last scan so we can log new arrivals
_seen_comics = set()


def discover_comics():
    """Scan COMICS_DIR and return a sorted list of comic dicts.

    Called on every API request — new folders appear instantly.
    """
    global _seen_comics

    if not COMICS_DIR.exists():
        return []

    comics = []
    current = set()
    for d in sorted(COMICS_DIR.iterdir()):
        if not d.is_dir():
            continue
        pages = discover_pages(d)
        if pages:
            comics.append({"name": d.name, "pages": pages})
            current.add(d.name)

    # Log newly-discovered comics
    newcomers = current - _seen_comics
    if newcomers:
        for name in sorted(newcomers):
            print(f"[comic-server] + new comic detected: '{name}'")
    _seen_comics = current

    return comics


def discover_pages(comic_dir: Path):
    """Return sorted list of page filenames inside a comic directory."""
    return sorted(
        p.name
        for p in comic_dir.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
    )


class ComicHandler(SimpleHTTPRequestHandler):
    """Custom handler: static files + comic API + image serving."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR))

    def log_message(self, format, *args):
        print(f"[comic-server] {args[0]}")

    # ── routing ──────────────────────────────────────────────────

    def do_GET(self):
        path = unquote(self.path.split("?")[0])

        # Health check (useful for nginx upstream monitoring)
        if path == "/api/health":
            return self.serve_json({"status": "ok", "comics": len(discover_comics())})

        # API: list all comics
        if path == "/api/comics":
            return self.serve_json(discover_comics())

        # API: single comic detail
        if path.startswith("/api/comics/"):
            comic_name = path[len("/api/comics/"):].strip("/")
            comic_dir = COMICS_DIR / comic_name
            if not comic_dir.is_dir():
                return self.send_error(404, "Comic not found")
            pages = discover_pages(comic_dir)
            if not pages:
                return self.send_error(404, "No pages found")
            return self.serve_json({"name": comic_name, "pages": pages})

        # Serve comic images directly from the filesystem.
        # (In prod behind nginx this path is handled by nginx's alias and
        # never reaches Python — but keep it for the dev all-in-one mode.)
        if path.startswith("/comics/"):
            image_path = ROOT / path.lstrip("/")
            if not image_path.exists() or not image_path.is_file():
                return self.send_error(404, "Image not found")
            return self.serve_file(image_path)

        # Everything else: static files (fall through to SimpleHTTPRequestHandler)
        return super().do_GET()

    # ── helpers ──────────────────────────────────────────────────

    def serve_json(self, data):
        body = json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def serve_file(self, filepath: Path):
        ext = filepath.suffix.lower()
        mime_map = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".webp": "image/webp",
            ".bmp": "image/bmp",
            ".svg": "image/svg+xml",
            ".css": "text/css",
            ".js": "application/javascript",
            ".html": "text/html",
            ".json": "application/json",
        }
        mime = mime_map.get(ext, "application/octet-stream")

        body = filepath.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    host = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1"
    try:
        port = int(sys.argv[2]) if len(sys.argv) > 2 else 8080
    except ValueError:
        print(f"Invalid port: {sys.argv[2]}")
        sys.exit(1)

    COMICS_DIR.mkdir(exist_ok=True)
    STATIC_DIR.mkdir(exist_ok=True)

    server = HTTPServer((host, port), ComicHandler)
    print(f"webcomic server @ http://{host}:{port}")
    print(f"  comics dir : {COMICS_DIR}")
    print(f"  static dir : {STATIC_DIR}")
    print(f"  comics found: {len(discover_comics())}")
    if host == "127.0.0.1":
        print("  (localhost only — put nginx in front for public access)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
