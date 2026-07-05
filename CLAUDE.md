# CLAUDE.md

Hardgrizz-styled webcomic + art site. Deno backend, vanilla JS SPA frontend, no build step, no npm/deno dependencies (aside from Google Fonts loaded via `<link>`), no database.

## Run

```bash
deno run --allow-net --allow-read server.ts              # dev: http://127.0.0.1:8080
deno task dev                                              # same, via deno.json
deno run --allow-net --allow-read server.ts 0.0.0.0 9090  # custom host/port (positional args)
```

No test suite or linter config. Verify changes by running the server and hitting `curl http://127.0.0.1:8080/api/health`, and by driving the actual pages in a browser — this is a UI-heavy app; typechecking (`deno check server.ts`) does not catch broken frontend flows.

## Layout

- `server.ts` — the entire backend (single file). Serves `static/`, `/comics/` and `/arts/` images, and the JSON API. All content is scanned into an in-memory cache at startup and refreshed by a debounced `Deno.watchFs` watcher on both `comics/` and `arts/` — API handlers never touch the disk directly.
- `static/index.html` — thin SPA shell: one `#app` mount point, Google Fonts link (Archivo / Archivo Black), a fixed RU/EN language toggle.
- `static/app.js` — hash-based router (`#/`, `#/comics`, `#/comics/<lang>`, `#/comics/<lang>/<name>`, `#/comics/<lang>/<name>/read/<chapterIdx>/<pageIdx>`, `#/arts`, `#/arts/<file>`) plus all view-rendering functions. Bilingual UI strings live in the `STRINGS` object; `siteLang` persists in `localStorage`.
- `static/style.css` — Hardgrizz theme: white background, sharp corners (`--radius: 0`), red/yellow/blue CSS variables, `Archivo Black` for headings/buttons, `Archivo` for body text, hard drop-shadow buttons/cards (`box-shadow: 5px 5px 0 var(--clr-ink)`).
- `comics/<lang>/<name>/` — content, **gitignored**. `<lang>` is `ru` or `en`. If the comic folder has subdirectories (other than `teaser/`, see below), each subdirectory is a chapter; otherwise it's a single flat chapter. Optional `meta.json` per comic (title, description, cover, characters, per-page comments/dates) — see `UPLOADING.md` for the schema. Text fields (`title`, `description`, `character.about`, `page.comment`) may be a plain string or a `{ "ru": "...", "en": "..." }` object (`Localized` type in `server.ts`); the API resolves it per-request from the `uiLang` query param (`pickLocale`/`resolveComicDetail`/`resolveComicSummary`), falling back to the comic's own `<lang>`, then to whatever translation exists. The frontend passes `?uiLang=<siteLang>` on every comics fetch so switching the RU/EN toggle re-resolves text without needing separate `<lang>` folders per translation.
- `comics/<lang>/<name>/teaser/` — optional carousel images for the comic detail page (e.g. textless art, not chapter pages). Reserved dirname (`TEASER_DIRNAME` in `server.ts`) excluded from chapter discovery; images shown in filename sort order via `naturalCompare`. No `meta.json` field for this anymore — it used to be `meta.teaser: string[]` pointing at chapter page filenames, replaced by this dedicated directory.
- `arts/` — content, **gitignored**. Flat: one image per artwork, optional sidecar `<name>.txt` for its description.
- `UPLOADING.md` — brief content-authoring guide (Russian, with layout examples) for the non-technical artist adding comics/art. Keep it short; update it if the `meta.json` schema or folder conventions change.
- `nginx.conf` — production config: nginx serves static + `/comics/` + `/arts/`, proxies `/api/` to Deno on 127.0.0.1:8080.
- `deno.json` / `.vscode/settings.json` — `deno task dev` and editor Deno-LSP support (`.vscode` is gitignored, local-only).
- `deploy.sh` — rsyncs source (not `comics/`/`arts/`) to production and optionally restarts the service; has placeholder `REMOTE_HOST`/`REMOTE_PATH`/`RESTART_CMD` to fill in, same pattern as `nginx.conf`'s placeholder paths.

## Conventions & gotchas

- Keep it dependency-free: backend uses only the `Deno` global; frontend is framework-free (no bundler, no npm). Don't introduce these without being asked.
- Frontend must stay server-agnostic: use relative URLs only (`/api/...`, `/comics/...`, `/arts/...`) so the same code works behind Deno directly or behind nginx.
- Comic/art names and page filenames contain spaces and Cyrillic — always `encodeURIComponent` per path segment on the frontend (see `encPath`/`urlFor` helpers); the server builds page URLs the same way and `decodeURIComponent`s incoming request paths.
- Page and comic/chapter order use natural sort (`Intl.Collator` with `numeric: true`, like Windows Explorer) via `naturalCompare` in `server.ts` — keep any new sorting consistent with it.
- Comic discovery is one level deep beyond the comic folder itself: a comic's subdirectories are treated as chapters; a chapter's own subdirectories (if any) are not scanned.
- MIME types are the hardcoded `MIME` map in `server.ts`; add entries there if new file types are served.
- `comics/` and `arts/` are in `.gitignore`; never commit their contents.
- The router does full `innerHTML` re-renders per view (no vdom/diffing) — keep view functions self-contained and re-attach their own event listeners after rendering (see `bindNav()` and the per-view listener setup in `renderReader`/`renderComicDetail`).
- Fullscreen (reader + art detail) uses the standard/webkit-prefixed Fullscreen API via `setupFullscreenButton()` in `app.js`; it feature-detects with `document.fullscreenEnabled` and hides the button entirely when unsupported (iOS Safari has no element-level Fullscreen API). `F` also toggles it in the reader. The fullscreen target is always `#app` (never `.reader`/`.art-detail`/an `<img>` directly) — those get torn down and rebuilt on every page turn or language switch (full `innerHTML` re-render), and a browser force-exits fullscreen the instant its fullscreen element is disconnected from the document; `#app` itself is never replaced, so fullscreen survives navigation. `setupFullscreenButton()` also tears down its own previous listener set on each call (via a module-level `_fsCleanup`) since language switches call `render()` directly rather than through `hashchange`.
- Mobile: the fixed RU/EN corner toggle can visually collide with header content on narrow screens — `.reader-header`/`.section-header` reserve `padding-right` (mobile media query in `style.css`) to clear it; if you resize the toggle, re-check that clearance. Touch targets (`.reader-nav`, `.carousel-nav`) are kept at ≥44px on mobile per platform guidance.
- "Archivo Black" has no Cyrillic glyphs, so Cyrillic headings/buttons silently fall back to "Archivo" — every rule using `"Archivo Black", sans-serif` also sets `font-weight: 900` explicitly so that fallback still renders bold instead of the browser default weight.
- Reading progress is stored client-side in `localStorage` (`readingProgress` key, one entry per `<lang>/<name>`) via `getProgress()`/`saveProgress()` in `app.js` — no server involvement. It's read by the comics grid (progress bar per card) and the comic detail page (progress bar + "continue reading" button).
