# Hardgrizz Comics

A self-hosted webcomic, art, and character-gallery site. The backend is a small Deno server; the frontend is a vanilla-JavaScript single-page application with no build step or database.

Content authoring instructions are in [UPLOADING.md](UPLOADING.md) (Russian).

## Quick start

Requirements:

- [Deno](https://deno.com/) 2.x
- optionally, ImageMagick 6 or 7 for automatic image resizing

```bash
# Add content under comics/, arts/, and/or characters/, then run:
deno task dev
```

Open <http://127.0.0.1:8080>.

`deno task dev` grants the permissions needed for content scanning, filesystem watching, and optional ImageMagick derivatives. To run without image resizing or subprocess permission:

```bash
IMAGE_RESIZE_ENABLED=false \
  deno run --allow-net --allow-read --allow-env server.ts
```

Custom bind address and port are positional arguments:

```bash
deno run --allow-net --allow-read --allow-env --allow-write \
  --allow-run=magick,convert,identify \
  server.ts 0.0.0.0 9090
```

To keep content outside the repository, set one root containing all three content directories:

```bash
POLINA_SITE=/data/polina deno task dev
```

`POLINA_SITE` may be absolute or relative to the working directory. The frontend always comes from this repository's `static/` directory.

## Content layout

```text
comics/
├── ru/
│   └── <comic>/
└── en/
    └── <comic>/
arts/
└── <art files>
characters/
└── <character>/
    └── <gallery files>
```

A comic can be flat or chaptered:

```text
comics/ru/<comic>/<page image>                    flat comic
comics/ru/<comic>/<chapter>/<page image>          chaptered comic
comics/ru/<comic>/teaser/<image>                  optional detail-page carousel
comics/ru/<comic>/meta.json                       optional metadata
arts/<image>                                      artwork
arts/<image stem>.txt                             optional art description
characters/<name>/<image>                         character gallery
characters/<name>/<image stem>.txt                optional image caption
```

Page files, chapters, teaser images, artworks, and character images use natural filename order: `2.png` comes before `10.png`. There is no separate page-index file and natural ordering is intentionally the source of truth.

If a comic contains any non-reserved subdirectory, those subdirectories are chapters and root-level images are not pages. `teaser/` and generated `small/` directories are reserved and never become chapters. The server logs a warning when chapter folders cause root images to be ignored.

See [UPLOADING.md](UPLOADING.md) for the `meta.json` schema, naming advice, translations, and replacement workflow.

The content directories are gitignored and are not part of a source deployment.

## Image replacement and caching

Source images may be replaced without renaming them. The filesystem watcher rescans content after roughly 200 ms, and API image URLs include a revision derived from the source file. This changes the browser URL when the source changes and prevents an old same-name image from being pinned in cache.

The supplied nginx and Apache configs also limit image caching to five minutes with revalidation; they no longer use immutable seven-day caching. API JSON is served with `Cache-Control: no-store`.

With resizing enabled, the first scan after a replacement may briefly return the new original while the new derivative is generated. Once generation finishes, the API switches to the corresponding `small/` URL.

Do not replace or edit files inside `small/`. Replace the source image next to that directory. Avoid preserving an old source modification time; if a copy tool does so, run `touch` on the source after copying.

## Automatic image resizing

Resizing is enabled by default. Images larger than the configured maximum dimension are converted in the background into a sibling `small/` directory:

```text
comics/ru/Test/page.png       source, never modified
comics/ru/Test/small/page.webp
```

The API serves a current derivative when one exists and otherwise serves the original while scheduling generation. ImageMagick runs with bounded concurrency. WebP output is lossless; `IMAGE_RESIZE_QUALITY` controls its compression effort.

| Variable | Default | Meaning |
| --- | --- | --- |
| `IMAGE_RESIZE_ENABLED` | `true` | Enable background derivatives |
| `IMAGE_RESIZE_MAX_DIM` | `1600` | Maximum derivative width or height |
| `IMAGE_RESIZE_QUALITY` | `82` | WebP compression effort or JPEG quality |
| `IMAGE_RESIZE_FORMAT` | `webp` | `webp` or `keep` (source format) |
| `IMAGE_RESIZE_CONCURRENCY` | CPU count, max 8 | Parallel ImageMagick jobs |
| `IMAGE_RESIZE_FORCE` | `false` | Purge all `small/` directories once at startup |

Useful maintenance commands:

```bash
./scripts/ensure-small-dirs.sh   # optional; the server also creates them
./scripts/purge-small-dirs.sh    # remove every generated small/ directory
deno task dev                    # regenerate derivatives as content is scanned
```

`IMAGE_RESIZE_FORCE=true deno task dev` combines purging and regeneration in one startup.

## User-facing behavior

- The RU/EN toggle changes the interface language and chooses the `comics/ru/` or `comics/en/` collection shown in the comic grid.
- Comic detail pages show the cover, `teaser/` carousel, description, chapters, and linked characters.
- The reader supports buttons, keyboard arrows, touch navigation, a page field, preloading, and an emulated fullscreen overlay. It does not invoke device fullscreen on mobile.
- Reading progress and unread markers are browser-local (`localStorage`); there is no account or server-side synchronization.
- Progress records include the comic-relative page filename. Inserting or naturally reordering files therefore does not make “Continue reading” jump to a different image.
- The first visit shows an 18+ confirmation gate; acceptance is stored in the browser.

## API

The server scans content into memory on startup and refreshes it with `Deno.watchFs`.

- `GET /api/health` — service status and content counts
- `GET /api/comics/<ru|en>?uiLang=<ru|en>` — comic summaries, including `pages` and natural-ordered `pageFiles`
- `GET /api/comics/<ru|en>/<name>?uiLang=<ru|en>` — comic detail and chapters
- `GET /api/arts` — artworks
- `GET /api/characters?uiLang=<ru|en>` — character galleries and related comics

Comic text may be a string or a `{ "ru": "...", "en": "..." }` object. The API resolves localized fields for `uiLang`, then the comic collection language, then the first available value.

## Repository map

```text
server.ts                    backend, scanner, derivatives, API, file serving
static/index.html            SPA shell
static/app.js                hash router, views, reader, browser state
static/style.css             site styling
config/nginx.conf            nginx production template
config/apache.conf           Apache production template
config/comic-server.service  systemd template
scripts/start.sh             localhost production launcher (port 8080)
scripts/*-small-dirs.sh      derivative maintenance
compose/docker-compose.yml   auxiliary Cloudflare DDNS/certbot services
```

The only source dependency is `@std/path`, locked and vendored through Deno. There are no npm packages or frontend build tools.

## Production

Both supplied reverse-proxy templates serve the frontend and content directly, and proxy `/api/` to Deno at `127.0.0.1:8080`. Replace every `/path/to/polina_site` and `comics.local` placeholder before installing either config. If `POLINA_SITE` points elsewhere, update the shared content mapping too.

Start the backend directly:

```bash
./scripts/start.sh
```

Or install the systemd template after editing its paths:

```bash
sudo cp config/comic-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now comic-server
journalctl -u comic-server -f
```

For nginx, install `config/nginx.conf`, run `nginx -t`, and reload. For Apache, enable `proxy`, `proxy_http`, `headers`, `expires`, and `alias`, install `config/apache.conf`, run `apachectl configtest`, and reload.

## Verification

There is currently no automated test suite. Before deploying a change:

```bash
deno check server.ts static/app.js
bash -n scripts/*.sh
git diff --check
```

Then run the server, check `/api/health`, inspect a comic detail response to confirm its natural page order, and exercise replacement, reader navigation, and “Continue reading” in a browser.
