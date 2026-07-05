# Hardgrizz Comics

A self-hosted webcomic + art site with a Hardgrizz-poster look: white background, red/yellow/blue geometric shapes, bold angular type. Deno backend, vanilla-JS single-page frontend — no build step, no database, no dependencies beyond [Deno](https://deno.land/).

For how to add comics/art, see **[UPLOADING.md](UPLOADING.md)** (short, in Russian, with layout examples).

## Quick start

```bash
# 1. Install Deno (once)
curl -fsSL https://deno.land/install.sh | sh

# 2. Add a comic (Russian or English)
mkdir -p "comics/ru/Мой комикс"
cp page1.png page2.png "comics/ru/Мой комикс/"

# 3. Run the server from the repo root
deno run --allow-net --allow-read --allow-env server.ts
# or: deno task dev
```

Open http://127.0.0.1:8080 — done.

Custom host/port:

```bash
deno run --allow-net --allow-read --allow-env server.ts 0.0.0.0 9090
```

Custom content locations (e.g. content stored outside the repo):

```bash
COMICS_DIR=/data/comics ARTS_DIR=/data/arts deno run --allow-net --allow-read --allow-env server.ts
```

`COMICS_DIR`/`ARTS_DIR` accept absolute paths or paths relative to the working directory; they default to `comics`/`arts` under the repo root.

## Site structure

- **Landing** — welcome text, two buttons: "Комиксы" / "Арты".
- **Арты** — grid of art with titles; click to open enlarged with description.
- **Комиксы** — grid of comics (cover + title) for the currently selected language; opening it drops straight into the list (no language-picker step). The RU/EN corner toggle switches which language's collection is listed.
- **Comic page** — carousel (cover + `teaser/` images), navigable by click/dots/swipe; title, description, chapter picker, "Читать с начала", character list.
- **Reader** — one page at a time, arrow navigation (click/keyboard/swipe), page-jump field, fullscreen mode (button or <kbd>F</kbd>), author comment + publish date per page if set.

The whole UI is bilingual (RU/EN) via a corner toggle, which also selects which comic collection (`comics/ru/` vs `comics/en/`) the list shows. Comic text (title, description, character bios, page comments) can be translated within a single `meta.json` instead of duplicating the comic under both `comics/ru/` and `comics/en/` — see `UPLOADING.md`.

Reading progress (chapter + page) is saved per comic in the browser's `localStorage` — the comic page shows a "Continue reading" button and progress bar, and the comics grid shows a thin progress bar under any comic you've started. This is per-browser, not synced anywhere.

## Content layout

```
comics/ru/<comic>/<page files>              single-chapter comic
comics/ru/<comic>/<chapter>/<page files>    multi-chapter comic
comics/ru/<comic>/teaser/<image files>      optional carousel images (not chapter pages)
comics/ru/<comic>/meta.json                 optional: title, description, cover,
                                             characters, per-page comments/dates
comics/en/...                                same, for the English version
arts/<file>                                  a piece of art
arts/<file>.txt                              optional description sidecar
```

Details and examples: **[UPLOADING.md](UPLOADING.md)**.

`comics/` and `arts/` are gitignored — content lives only on the server, not in the repo. The server watches both directories (`Deno.watchFs`) and picks up changes within ~200ms, no restart needed.

## How it works

```
static/          frontend: index.html (SPA shell), app.js (hash router + views), style.css
server.ts        Deno server: static files, /api/comics, /api/arts, image serving
comics/          your comics (gitignored)
arts/            your art (gitignored)
nginx.conf       optional production reverse-proxy config (nginx)
apache.conf      optional production reverse-proxy config (Apache, equivalent)
deno.json        deno task "dev"; also enables editor Deno support
```

API (served from an in-memory cache kept fresh by `Deno.watchFs`):

- `GET /api/health` — `{status, comics, arts}` counts
- `GET /api/comics/<lang>` — list of `{lang, name, title, cover}` (lang: `ru` or `en`)
- `GET /api/comics/<lang>/<name>` — full comic: description, teaser, characters, chapters (each page has `file`, `url`, optional `comment`/`date`)
- `GET /api/arts` — list of `{file, title, description, url}`

Both comics endpoints accept an optional `?uiLang=ru|en` query param to resolve any translated (`{"ru": "...", "en": "..."}`) text fields in `meta.json`; it defaults to `<lang>` if omitted.

## Production (nginx or Apache)

The reverse proxy serves `static/`, `comics/`, `arts/` directly (with 7-day immutable cache headers on images) and proxies only `/api/` to Deno on localhost. Two equivalent configs are provided — use whichever you run.

**nginx:**

```bash
sudo cp nginx.conf /etc/nginx/sites-available/comic
sudo ln -s /etc/nginx/sites-available/comic /etc/nginx/sites-enabled/
# edit server_name and the /path/to/polina_site paths in the config
sudo nginx -t && sudo nginx -s reload
deno run --allow-net --allow-read --allow-env server.ts   # stays on 127.0.0.1:8080
```

**Apache:**

```bash
sudo a2enmod proxy proxy_http headers expires alias   # once
sudo cp apache.conf /etc/apache2/sites-available/comic.conf
# edit ServerName and the /path/to/polina_site paths in the config
sudo a2ensite comic && sudo apachectl configtest && sudo systemctl reload apache2
deno run --allow-net --allow-read --allow-env server.ts   # stays on 127.0.0.1:8080
```

The frontend uses the same relative URLs either way, so nothing else changes.

## Running as a service

`start.sh` launches the server (`deno run ...`); `comic-server.service` is a systemd unit that runs `start.sh`, so systemd manages a shell script rather than calling `deno` directly:

```bash
# edit WorkingDirectory / ExecStart in comic-server.service first
sudo cp comic-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now comic-server
journalctl -u comic-server -f   # logs
```

## Deploying updates

`deploy.sh` rsyncs the source code (not `comics/`/`arts/`, which are gitignored user content living only on the server) to the production host and optionally restarts the service:

```bash
# fill in REMOTE_HOST / REMOTE_PATH / RESTART_CMD at the top of the file first
./deploy.sh
```
