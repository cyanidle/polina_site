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
deno run --allow-net --allow-read --allow-env --allow-run=magick,convert,identify server.ts
# or: deno task dev
```

Open http://127.0.0.1:8080 — done. (`--allow-run=…` is only for the optional on-the-fly image resize below; drop it if you don't use that.)

Custom host/port:

```bash
deno run --allow-net --allow-read --allow-env --allow-run=magick,convert,identify server.ts 0.0.0.0 9090
```

Custom content locations (e.g. content stored outside the repo):

```bash
COMICS_DIR=/data/comics ARTS_DIR=/data/arts deno run --allow-net --allow-read --allow-env --allow-run=magick,convert,identify server.ts
```

`COMICS_DIR`/`ARTS_DIR` accept absolute paths or paths relative to the working directory; they default to `comics`/`arts` under the repo root.

### Automatic image resize (optional)

Large images are downscaled on the fly into smaller "shadow" WebP copies in a sibling `small/` subdirectory (e.g. `page.png` → `small/page.webp`) and those are served instead of the originals — handy when source pages are huge phone-scans. It's on by default and needs [ImageMagick](https://imagemagick.org/) (`magick`/`convert`/`identify`) plus `--allow-run` and `--allow-write` (for the `small/` dir — the server creates it automatically). If either is missing it's skipped (logged once) and originals are served — the server keeps working. Config (env vars):

| var | default | meaning |
| --- | --- | --- |
| `IMAGE_RESIZE_ENABLED` | `true` | `false` disables it entirely |
| `IMAGE_RESIZE_MAX_DIM` | `1600` | max width/height of the derivative, in px (images already ≤ this are left alone) |
| `IMAGE_RESIZE_QUALITY` | `82` | WebP/JPEG quality of the derivative (for lossless WebP: compression-effort) |
| `IMAGE_RESIZE_FORMAT` | `webp` | output format: `webp` (smaller, re-encodes) or `keep` (same format as source) |
| `IMAGE_RESIZE_CONCURRENCY` | `cpu cores` | parallel ImageMagick processes during generation |
| `IMAGE_RESIZE_FORCE` | `false` | set to `true` to delete every `small/` directory on startup so derivatives regenerate with current settings (one-shot) |

Derivatives are generated in the background and cached; originals are never modified. **Derivatives are lossless WebP by default** (pixel-perfect quality, still smaller than PNG originals).

Run `./scripts/ensure-small-dirs.sh` after adding new content to pre-create the `small/` directories — the server creates them on demand as well, but the script front-loads it for a fresh install. To regenerate all derivatives after changing resize settings, run `./scripts/purge-small-dirs.sh`, then restart with `IMAGE_RESIZE_FORCE=1`.

## Site structure

- **Landing** — welcome text, three buttons: "Комиксы" / "Арты" / "Персонажи".
- **Арты** — grid of art with titles; click to open enlarged with description.
- **Персонажи** — grid of characters (cover + name) from `arts/characters/`; each character is a folder of images, and opening one shows the whole gallery with a caption under each picture, plus links to every comic that character appears in.
- **Комиксы** — grid of comics (cover + title) for the currently selected language; opening it drops straight into the list (no language-picker step). The RU/EN corner toggle switches which language's collection is listed.
- **Comic page** — carousel (cover + `teaser/` images), navigable by click/dots/swipe; title, description, chapter picker, "Читать с начала", character list. A character's name is a link to its page when a matching image exists in `arts/characters/`.
- **Reader** — one page at a time, arrow navigation (click/keyboard/swipe), page-jump field, fullscreen mode (button or <kbd>F</kbd>), author comment + publish date per page if set.

On a visitor's **first arrival** an 18+ age gate is shown ("I am 18 or older" to enter, "Leave" to exit); the choice is remembered in `localStorage` so it only appears once. A short "18+" disclaimer footer is shown on every page.

The whole UI is bilingual (RU/EN) via a corner toggle, which also selects which comic collection (`comics/ru/` vs `comics/en/`) the list shows. Comic text (title, description, character bios, page comments) can be translated within a single `meta.json` instead of duplicating the comic under both `comics/ru/` and `comics/en/` — see `UPLOADING.md`.

Reading progress (chapter + page) is saved per comic in the browser's `localStorage` — the comic page shows a "Continue reading" button and progress bar, and the comics grid shows a thin progress bar under any comic you've started. This is per-browser, not synced anywhere.

Unread content is flagged with a yellow pointy-star badge (a black `!` inside): on the landing page's "Комиксы" / "Арты" / "Персонажи" buttons (if anything is unread), on each comic, art, and character card, and on a comic's page (when it has pages you haven't read). A comic counts as unread until you've seen every page — including pages added after you'd already finished it — and an artwork or character until you've opened it once. Like reading progress, this is tracked per-browser in `localStorage`, not synced.

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
arts/characters/<name>/<image>               a character = one folder of images
arts/characters/<name>/<image>.txt           optional per-image description sidecar
```

Details and examples: **[UPLOADING.md](UPLOADING.md)**.

`comics/` and `arts/` are gitignored — content lives only on the server, not in the repo. The server watches both directories (`Deno.watchFs`) and picks up changes within ~200ms, no restart needed.

## How it works

```
static/          frontend: index.html (SPA shell), app.js (hash router + views), style.css
server.ts        Deno server: static files, /api/comics, /api/arts, image serving
comics/          your comics (gitignored)
arts/            your art (gitignored)
config/          optional production reverse-proxy + systemd configs
scripts/         helper scripts (start.sh, resize dir mgmt, deploy)
deno.json        deno task "dev"; also enables editor Deno support
```

API (served from an in-memory cache kept fresh by `Deno.watchFs`):

- `GET /api/health` — `{status, comics, arts, characters}` counts
- `GET /api/comics/<lang>` — list of `{lang, name, title, cover, pages}` (lang: `ru` or `en`)
- `GET /api/comics/<lang>/<name>` — full comic: description, teaser, characters (each character has `name`, optional `about`, and `file` when a matching `arts/characters/` entry exists), chapters (each page has `file`, `url`, optional `comment`/`date`)
- `GET /api/arts` — list of `{file, title, description, url}`
- `GET /api/characters` — list of `{name, cover, images: [{file, url, description}], comics: [{lang, name, title}]}` from `arts/characters/<name>/` (one folder per character); `comics` is every comic referencing that character. Accepts `?uiLang=ru|en` to resolve comic titles.

Both comics endpoints accept an optional `?uiLang=ru|en` query param to resolve any translated (`{"ru": "...", "en": "..."}`) text fields in `meta.json`; it defaults to `<lang>` if omitted.

## Production (nginx or Apache)

The reverse proxy serves `static/`, `comics/`, `arts/` directly (with 7-day immutable cache headers on images) and proxies only `/api/` to Deno on localhost. Two equivalent configs are provided — use whichever you run.

**nginx:**

```bash
sudo cp config/nginx.conf /etc/nginx/sites-available/comic
sudo ln -s /etc/nginx/sites-available/comic /etc/nginx/sites-enabled/
# edit server_name and the /path/to/polina_site paths in the config
sudo nginx -t && sudo nginx -s reload
deno run --allow-net --allow-read --allow-env --allow-run=magick,convert,identify server.ts   # stays on 127.0.0.1:8080
```

**Apache:**

```bash
sudo a2enmod proxy proxy_http headers expires alias   # once
sudo cp config/apache.conf /etc/apache2/sites-available/comic.conf
# edit ServerName and the /path/to/polina_site paths in the config
sudo a2ensite comic && sudo apachectl configtest && sudo systemctl reload apache2
deno run --allow-net --allow-read --allow-env --allow-run=magick,convert,identify server.ts   # stays on 127.0.0.1:8080
```

The frontend uses the same relative URLs either way, so nothing else changes.

## Running as a service

`scripts/start.sh` launches the server (`deno run ...`); `config/comic-server.service` is a systemd unit that runs it, so systemd manages a shell script rather than calling `deno` directly:

```bash
# edit WorkingDirectory / ExecStart in config/comic-server.service first
sudo cp config/comic-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now comic-server
journalctl -u comic-server -f   # logs
```

## Deploying updates

`scripts/deploy.sh` rsyncs the source code (not `comics/`/`arts/`, which are gitignored user content living only on the server) to the production host and optionally restarts the service:

```bash
# fill in REMOTE_HOST / REMOTE_PATH / RESTART_CMD at the top of the file first
./scripts/deploy.sh
```
