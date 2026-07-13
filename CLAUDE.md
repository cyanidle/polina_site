# CLAUDE.md

## Project

Hardgrizz Comics is a Deno 2 backend and vanilla-JavaScript SPA. It has no database, frontend framework, npm packages, or build step. `@std/path` is locked and vendored by Deno.

User content is gitignored and lives below one root:

```text
<POLINA_SITE>/comics/{ru,en}/<comic>/
<POLINA_SITE>/arts/
<POLINA_SITE>/characters/<character>/
```

`POLINA_SITE` defaults to the repository working directory. `static/` always resolves from the working directory, so run commands from the repository root. Do not commit content or generated `small/` directories.

## Commands

```bash
deno task dev
deno check server.ts static/app.js
bash -n scripts/*.sh
git diff --check
```

Without ImageMagick:

```bash
IMAGE_RESIZE_ENABLED=false \
  deno run --allow-net --allow-read --allow-env server.ts
```

Production uses `./scripts/start.sh`, which binds `127.0.0.1:8080`. Both proxy templates target that port.

There is no automated test suite. After changes, run the server and verify `/api/health`, relevant JSON responses, and the affected browser flow.

## Architecture

- `server.ts` scans content into memory, watches `POLINA_SITE`, generates derivatives, serves the API, and serves files in direct-development mode.
- `static/app.js` contains the hash router, all views, localStorage state, reader navigation, preloading, and emulated fullscreen.
- `static/style.css` contains all styling and the fixed fullscreen overlay.
- `UPLOADING.md` is the short Russian authoring guide. Keep it synchronized with filesystem and metadata behavior.
- `config/nginx.conf` and `config/apache.conf` serve static/content files and proxy `/api/` to Deno.

API routes:

```text
GET /api/health
GET /api/comics/<lang>?uiLang=<lang>
GET /api/comics/<lang>/<name>?uiLang=<lang>
GET /api/arts
GET /api/characters?uiLang=<lang>
```

The summary response includes both a page count and natural-ordered `pageFiles`. JSON responses use `Cache-Control: no-store`.

## Content invariants

- Natural filename sorting is the editorial order for comics, chapters, teasers, arts, and character galleries. Do not add a separate order manifest unless explicitly requested.
- Any comic subdirectory other than `teaser/` and `small/` is a chapter. If chapters exist, root images are ignored and the scanner logs a warning.
- `meta.json` fields are optional. Localized text is a string or `{ "ru": "...", "en": "..." }`.
- Page metadata prefers comic-relative keys such as `Chapter/1.png`, then falls back to a bare filename for compatibility. This prevents ambiguity when chapters repeat names.
- `cover` follows the same relative-path-first lookup.
- Character links match `meta.json` character names to `characters/<name>/` case-insensitively.
- Path segments may contain spaces and Cyrillic. Encode each URL segment; never encode an entire multi-segment path as one segment.

## Derivatives and replacement

Large images generate current-format or lossless-WebP derivatives under a sibling `small/` directory. `small/` is the current and only derivative layout. Never reintroduce `-sm` sibling naming.

Generation is asynchronous and concurrency-limited. A missing or older derivative schedules generation while the original is returned. The queue triggers a rescan when drained because watcher events are suppressed during generation.

Atomic output must keep the real image extension last. ImageMagick chooses its encoder from that suffix; a temporary name ending only in `.tmp` can create source-format bytes later mislabeled as WebP.

API image URLs contain a revision based on source stat data. Same-name source replacement therefore changes the URL. nginx and Apache apply a five-minute, revalidated fallback cache instead of immutable caching.

`IMAGE_RESIZE_ENABLED=false` must not probe ImageMagick or request subprocess permission.

## Browser state and fullscreen

Reading progress is stored under `localStorage.readingProgress`. New records retain numeric indices for compatibility but use `pageFile` and `seenPageFiles` as stable identities. Inserting or naturally reordering pages must not move “Continue reading” to another file or mark an existing page as new.

The reader and art viewer use emulated fullscreen, not the browser Fullscreen API. `#app.emulated-fullscreen` becomes a fixed `100dvh` overlay; body scrolling is locked and all controls except the exit icon are hidden. The class lives on `#app`, which survives reader rerenders and page turns. Leaving an eligible reader/art route must clear the class.

Views replace `#app.innerHTML`; each view must attach its listeners after rendering. `setupFullscreenButton()` removes its prior listeners before binding the new exit button.

## Production templates

- nginx consolidates the shared content root with one regex `location` for `comics`, `arts`, and `characters`.
- Apache uses one `AliasMatch` and one `DirectoryMatch` for the same URL prefixes.
- Replace `/path/to/polina_site` and the example hostname before installation.
- If `POLINA_SITE` differs from the repository path, point content mappings at that root while leaving the static document root at the repository's `static/` directory.
- Keep the image-cache policy and upstream port consistent across both proxies.

## Code conventions

- Preserve the dependency-light architecture unless asked to change it.
- Use relative frontend URLs.
- Escape all content-derived text inserted through `innerHTML`.
- Keep comments only for non-obvious invariants or compatibility constraints; do not duplicate README material in source files.
- Keep changes scoped and preserve gitignored content.

## Review backlog

The next cleanup phase should add scanner/API tests before splitting files. Highest-value cases are natural ordering, flat-versus-chapter discovery, duplicate page basenames, invalid metadata, derivative refresh, replacement URL revisions, and progress migration. After coverage exists, split content scanning/resizing/routing out of `server.ts` and state/router/view helpers out of `static/app.js`.

Also serialize overlapping scans, cancel stale frontend fetch/render work, validate `meta.json` shapes instead of relying on TypeScript casts, and cover request-path containment with regression tests. These are known hardening tasks, not established behavior to preserve.
