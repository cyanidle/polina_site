/**
 * Webcomic server — auto-discovers comics and art from the filesystem.
 *
 * Uses Deno.watchFs to monitor comics/ and arts/, so new content dropped
 * into either folder appears immediately — no restart and no per-request
 * scanning.
 *
 * Layout:
 *   comics/<lang>/<comic>/<page files>            single-chapter comic
 *   comics/<lang>/<comic>/<chapter>/<page files>   multi-chapter comic
 *   comics/<lang>/<comic>/teaser/<image files>     carousel images (not chapter pages —
 *                                                  e.g. textless art), shown in file order
 *   comics/<lang>/<comic>/meta.json                optional metadata (see below)
 *   arts/<file>                                    a piece of art
 *   arts/<file>.txt                                optional description sidecar
 *
 * meta.json (all fields optional):
 *   {
 *     "title": "...",
 *     "description": "...",
 *     "cover": "0. Обложка.png",
 *     "characters": [{ "name": "...", "about": "..." }],
 *     "pages": { "3стр.png": { "comment": "...", "date": "2026-01-15" } }
 *   }
 *
 * title, description, character.about and page.comment may also be a
 * { "ru": "...", "en": "..." } object instead of a plain string — the API
 * resolves it per-request via the `uiLang` query param (falling back to
 * the comic's own <lang>, then to whichever translation exists).
 *
 * Architecture:
 *   - dev:  `deno run --allow-net --allow-read --allow-env server.ts`
 *   - prod: run on 127.0.0.1:8080 behind nginx (see nginx.conf).
 *
 * Usage:
 *   deno run --allow-net --allow-read --allow-env server.ts                # 127.0.0.1:8080
 *   deno run --allow-net --allow-read --allow-env server.ts 0.0.0.0 9090   # custom host/port
 *
 * Env vars (optional; --allow-env is required regardless of whether they're set):
 *   COMICS_DIR   where comics/ content lives — absolute, or relative to cwd (default "comics")
 *   ARTS_DIR     where arts/ content lives — absolute, or relative to cwd (default "arts")
 */

const ROOT = Deno.cwd() + "/";

function resolveDir(envVarName: string, defaultName: string): string {
  const configured = Deno.env.get(envVarName)?.replace(/\/+$/, "");
  if (!configured) return `${ROOT}${defaultName}`;
  const resolved = configured.startsWith("/") ? configured : `${ROOT}${configured}`;
  console.log(`[comic-server] ${envVarName}=${configured} -> ${resolved}`);
  return resolved;
}

const COMICS_DIR = resolveDir("COMICS_DIR", "comics");
const ARTS_DIR = resolveDir("ARTS_DIR", "arts");
const STATIC_DIR = `${ROOT}static`;

const LANGS = ["ru", "en"];

// Reserved subdirectory name for carousel images — excluded from chapter
// discovery so it never gets treated as a chapter itself.
const TEASER_DIRNAME = "teaser";

// Reserved subdirectory under ARTS_DIR holding the character gallery
// (one image per character + optional <name>.txt). It's a directory, so the
// flat arts scan (isFile filter) skips it automatically.
const CHARACTERS_DIRNAME = "characters";

const IMAGE_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg",
]);

const MIME: Record<string, string> = {
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
};

// Natural sort (like Windows Explorer): digit runs compare as numbers,
// so "2стр.png" < "10стр.png".
const naturalCompare = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
}).compare;

// ── types ────────────────────────────────────────────────────────

// Either a plain string (shown regardless of UI language) or a map of
// language code -> text, resolved per-request via pickLocale().
type Localized = string | Record<string, string>;

type PageMeta = { comment?: Localized; date?: string };
type Character = { name: string; about?: Localized };

type Meta = {
  title?: Localized;
  description?: Localized;
  cover?: string;
  characters?: Character[];
  pages?: Record<string, PageMeta>;
};

type Page = { file: string; url: string; comment?: Localized; date?: string };
type Chapter = { name: string; pages: Page[] };

// Internal cache shape: text fields stay Localized (unresolved) until a
// request picks a uiLang. `lang` here is the comic's own collection
// (comics/<lang>/...), used as the fallback locale when uiLang has no match.
type ComicSummary = { lang: string; name: string; title: Localized; cover: string };
type ComicDetail = ComicSummary & {
  description: Localized;
  teaser: string[];
  characters: Character[];
  chapters: Chapter[];
};

type Art = { file: string; title: string; description: string; url: string };

// A character, scanned from arts/characters/<name>/ — a folder holding an
// arbitrary number of images, each with an optional <image>.txt description.
// `name` is the folder name and is what comic meta.json `characters[].name`
// is matched against to make a comic's character label clickable.
type CharacterImage = { file: string; url: string; description: string };
type CharacterEntry = { name: string; cover: string; images: CharacterImage[] };

function pickLocale(value: Localized | undefined, uiLang: string, fallbackLang: string): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return value[uiLang] ?? value[fallbackLang] ?? Object.values(value)[0] ?? "";
}

// The title used for sorting/logging — resolved against the comic's own
// collection language, independent of any visitor's UI language.
function nativeTitle(c: ComicSummary): string {
  return pickLocale(c.title, c.lang, c.lang);
}

// Cached comics are full ComicDetail objects, so we can surface a total
// page count in the summary — the frontend uses it to flag comics with
// unread/new pages without fetching every comic's detail.
function resolveComicSummary(c: ComicDetail, uiLang: string) {
  const pages = c.chapters.reduce((n, ch) => n + ch.pages.length, 0);
  return { lang: c.lang, name: c.name, title: pickLocale(c.title, uiLang, c.lang), cover: c.cover, pages };
}

function resolveComicDetail(c: ComicDetail, uiLang: string) {
  return {
    lang: c.lang,
    name: c.name,
    title: pickLocale(c.title, uiLang, c.lang),
    cover: c.cover,
    description: pickLocale(c.description, uiLang, c.lang),
    teaser: c.teaser,
    // `link` is the gallery character's name (the arts/characters/<name>/
    // folder) when a match exists, so the frontend can link the label to its
    // page. Matched case-insensitively; the gallery's own casing is used.
    characters: c.characters.map((ch) => {
      const match = characters.find((g) => g.name.toLowerCase() === ch.name.toLowerCase());
      return { name: ch.name, about: pickLocale(ch.about, uiLang, c.lang), link: match?.name };
    }),
    chapters: c.chapters.map((ch) => ({
      name: ch.name,
      pages: ch.pages.map((p) => ({
        file: p.file,
        url: p.url,
        comment: p.comment ? pickLocale(p.comment, uiLang, c.lang) : undefined,
        date: p.date,
      })),
    })),
  };
}

// Every comic (across all languages) whose meta.json references this
// character by name (case-insensitive) — used to show "appears in" links on
// the character's page. Titles are resolved for the requesting uiLang.
function comicsForCharacter(charName: string, uiLang: string) {
  const target = charName.toLowerCase();
  const refs: { lang: string; name: string; title: string }[] = [];
  for (const lang of LANGS) {
    for (const comic of comicsByLang[lang] ?? []) {
      if (comic.characters.some((ch) => ch.name.toLowerCase() === target)) {
        refs.push({ lang: comic.lang, name: comic.name, title: pickLocale(comic.title, uiLang, comic.lang) });
      }
    }
  }
  return refs;
}

function resolveCharacter(c: CharacterEntry, uiLang: string) {
  return { ...c, comics: comicsForCharacter(c.name, uiLang) };
}

// ── content cache ────────────────────────────────────────────────
//
// The filesystem is scanned once at startup, then kept up-to-date by
// a Deno.watchFs watcher. API handlers read from this cache so they
// never touch the disk.

let comicsByLang: Record<string, ComicDetail[]> = {};
let arts: Art[] = [];
let characters: CharacterEntry[] = [];

function urlFor(...segments: string[]): string {
  return "/" + segments.map(encodeURIComponent).join("/");
}

async function readDirSafe(dir: string): Promise<Deno.DirEntry[]> {
  const entries: Deno.DirEntry[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) entries.push(entry);
  } catch { /* directory missing */ }
  return entries;
}

function isImage(filename: string): boolean {
  const dot = filename.lastIndexOf(".");
  return dot !== -1 && IMAGE_EXTS.has(filename.substring(dot).toLowerCase());
}

async function readImageFiles(dir: string): Promise<string[]> {
  const entries = await readDirSafe(dir);
  const files = entries.filter((e) => e.isFile && isImage(e.name)).map((e) => e.name);
  files.sort(naturalCompare);
  return files;
}

async function readMeta(dir: string): Promise<Meta> {
  try {
    const text = await Deno.readTextFile(`${dir}/meta.json`);
    return JSON.parse(text) as Meta;
  } catch {
    return {};
  }
}

function basenameOf(relPath: string): string {
  const slash = relPath.lastIndexOf("/");
  return slash === -1 ? relPath : relPath.substring(slash + 1);
}

async function scanComic(lang: string, name: string): Promise<ComicDetail | null> {
  const dir = `${COMICS_DIR}/${lang}/${name}`;
  const entries = await readDirSafe(dir);
  const subdirs = entries
    .filter((e) => e.isDirectory && e.name !== TEASER_DIRNAME)
    .sort((a, b) => naturalCompare(a.name, b.name));

  const chapters: Chapter[] = [];
  if (subdirs.length > 0) {
    for (const sub of subdirs) {
      const files = await readImageFiles(`${dir}/${sub.name}`);
      if (files.length === 0) continue;
      chapters.push({
        name: sub.name,
        pages: files.map((f) => ({ file: `${sub.name}/${f}`, url: urlFor("comics", lang, name, sub.name, f) })),
      });
    }
  } else {
    const files = await readImageFiles(dir);
    if (files.length > 0) {
      chapters.push({
        name,
        pages: files.map((f) => ({ file: f, url: urlFor("comics", lang, name, f) })),
      });
    }
  }

  if (chapters.length === 0) {
    if (entries.length > 0) {
      console.log(`[comic-server] warning: '${name}' (${lang}) has files but no recognized image pages — check extensions (${dir})`);
    }
    return null;
  }

  const meta = await readMeta(dir);
  const allPages = chapters.flatMap((c) => c.pages);

  // attach per-page comment/date from meta.json (keyed by bare filename)
  if (meta.pages) {
    for (const page of allPages) {
      const pm = meta.pages[basenameOf(page.file)];
      if (pm) {
        page.comment = pm.comment;
        page.date = pm.date;
      }
    }
  }

  const findByBasename = (bare: string) => allPages.find((p) => basenameOf(p.file) === bare);

  const coverPage = (meta.cover && findByBasename(meta.cover)) || allPages[0];

  const teaserFiles = await readImageFiles(`${dir}/${TEASER_DIRNAME}`);
  const teaser = teaserFiles.map((f) => urlFor("comics", lang, name, TEASER_DIRNAME, f));

  return {
    lang,
    name,
    title: meta.title || name,
    description: meta.description || "",
    cover: coverPage.url,
    teaser,
    characters: meta.characters ?? [],
    chapters,
  };
}

async function scanComicsForLang(lang: string): Promise<ComicDetail[]> {
  const langDir = `${COMICS_DIR}/${lang}`;
  const entries = await readDirSafe(langDir);
  const dirs = entries.filter((e) => e.isDirectory);
  const result: ComicDetail[] = [];
  for (const dir of dirs) {
    const comic = await scanComic(lang, dir.name);
    if (comic) {
      const pageCount = comic.chapters.reduce((n, c) => n + c.pages.length, 0);
      console.log(`[comic-server]   + '${comic.name}' (${lang}): ${comic.chapters.length} chapter(s), ${pageCount} page(s)`);
      result.push(comic);
    }
  }
  if (dirs.length === 0) {
    console.log(`[comic-server] no comic folders found in ${langDir}`);
  }
  result.sort((a, b) => naturalCompare(nativeTitle(a), nativeTitle(b)));
  return result;
}

async function scanArts(): Promise<Art[]> {
  const entries = await readDirSafe(ARTS_DIR);
  const files = entries.filter((e) => e.isFile && isImage(e.name)).map((e) => e.name);
  files.sort(naturalCompare);

  const result: Art[] = [];
  for (const file of files) {
    const dot = file.lastIndexOf(".");
    const title = dot === -1 ? file : file.substring(0, dot);
    let description = "";
    try {
      description = (await Deno.readTextFile(`${ARTS_DIR}/${title}.txt`)).trim();
    } catch { /* no sidecar */ }
    result.push({ file, title, description, url: urlFor("arts", file) });
  }
  return result;
}

// Character gallery — arts/characters/<name>/ is one folder per character,
// holding any number of images, each with an optional <image>.txt sidecar
// for a per-picture description. The folder name is the character name; its
// first image (natural sort) is the cover. Loose files directly under
// arts/characters/ (not in a subfolder) and empty folders are ignored.
async function scanCharacters(): Promise<CharacterEntry[]> {
  const base = `${ARTS_DIR}/${CHARACTERS_DIRNAME}`;
  const dirs = (await readDirSafe(base)).filter((e) => e.isDirectory).map((e) => e.name);
  dirs.sort(naturalCompare);

  const result: CharacterEntry[] = [];
  for (const name of dirs) {
    const dir = `${base}/${name}`;
    const files = await readImageFiles(dir);
    if (files.length === 0) continue;

    const images: CharacterImage[] = [];
    for (const file of files) {
      const dot = file.lastIndexOf(".");
      const bare = dot === -1 ? file : file.substring(0, dot);
      let description = "";
      try {
        description = (await Deno.readTextFile(`${dir}/${bare}.txt`)).trim();
      } catch { /* no sidecar */ }
      images.push({ file, description, url: urlFor("arts", CHARACTERS_DIRNAME, name, file) });
    }
    result.push({ name, cover: images[0].url, images });
  }
  return result;
}

async function scan(): Promise<void> {
  console.log(`[comic-server] scanning ${COMICS_DIR} and ${ARTS_DIR}...`);
  const next: Record<string, ComicDetail[]> = {};
  for (const lang of LANGS) next[lang] = await scanComicsForLang(lang);
  comicsByLang = next;
  arts = await scanArts();
  characters = await scanCharacters();
  console.log(`[comic-server]   + ${arts.length} art file(s) in ${ARTS_DIR}`);
  console.log(`[comic-server]   + ${characters.length} character(s) in ${ARTS_DIR}/${CHARACTERS_DIRNAME}`);
}

// ── filesystem watcher ─────────────────────────────────────────

function startWatcher(): Deno.FsWatcher[] {
  const DEBOUNCE_MS = 200;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const rescan = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      await scan();
      console.log("[comic-server] rescanned after filesystem change");
    }, DEBOUNCE_MS);
  };

  const watchers = [
    Deno.watchFs(COMICS_DIR, { recursive: true }),
    Deno.watchFs(ARTS_DIR, { recursive: true }),
  ];
  for (const watcher of watchers) {
    (async () => {
      for await (const _event of watcher) rescan();
    })();
  }
  return watchers;
}

// ── file serving ───────────────────────────────────────────────

function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.substring(dot).toLowerCase();
}

function mimeType(path: string): string {
  return MIME[extOf(path)] ?? "application/octet-stream";
}

async function serveFile(filePath: string): Promise<Response> {
  try {
    const data = await Deno.readFile(filePath);
    return new Response(data, {
      status: 200,
      headers: {
        "Content-Type": mimeType(filePath),
        "Content-Length": String(data.length),
      },
    });
  } catch (err) {
    console.log(`[comic-server] 404: ${filePath} (${(err as Error).message})`);
    return new Response("Not found", { status: 404 });
  }
}

function json(data: unknown, status = 200): Response {
  const body = JSON.stringify(data, null, 2);
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": String(new TextEncoder().encode(body).length),
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// ── routing ────────────────────────────────────────────────────

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = decodeURIComponent(url.pathname);

  if (path === "/api/health") {
    const total = LANGS.reduce((n, l) => n + (comicsByLang[l]?.length ?? 0), 0);
    return json({ status: "ok", comics: total, arts: arts.length, characters: characters.length });
  }

  if (path === "/api/arts") {
    return json(arts);
  }

  if (path === "/api/characters") {
    const uiLang = url.searchParams.get("uiLang") || LANGS[0];
    return json(characters.map((c) => resolveCharacter(c, uiLang)));
  }

  // /api/comics/<lang> -> summaries
  // /api/comics/<lang>/<name> -> full detail
  if (path.startsWith("/api/comics/")) {
    const rest = path.slice("/api/comics/".length).replace(/\/$/, "");
    const slash = rest.indexOf("/");
    const lang = slash === -1 ? rest : rest.slice(0, slash);

    if (!LANGS.includes(lang)) {
      return json({ error: `unknown lang '${lang}', expected one of: ${LANGS.join(", ")}` }, 404);
    }

    const uiLang = url.searchParams.get("uiLang") || lang;

    if (slash === -1) {
      return json((comicsByLang[lang] ?? []).map((c) => resolveComicSummary(c, uiLang)));
    }

    const name = rest.slice(slash + 1);
    const comic = (comicsByLang[lang] ?? []).find((c) => c.name === name);
    if (!comic) return new Response("Comic not found", { status: 404 });
    return json(resolveComicDetail(comic, uiLang));
  }

  // Comic / art images — served from the (possibly overridden) COMICS_DIR /
  // ARTS_DIR, not literally "<ROOT>/comics" or "<ROOT>/arts".
  if (path.startsWith("/comics/")) {
    const filePath = `${COMICS_DIR}/${path.slice("/comics/".length)}`;
    return await serveFile(filePath);
  }
  if (path.startsWith("/arts/")) {
    const filePath = `${ARTS_DIR}/${path.slice("/arts/".length)}`;
    return await serveFile(filePath);
  }

  // Static frontend files
  let staticPath = `${STATIC_DIR}${path}`;
  if (path === "/" || path.endsWith("/")) {
    staticPath = `${STATIC_DIR}${path}index.html`;
  }
  const res = await serveFile(staticPath);
  // SPA fallback: unknown non-file routes (client-side router paths) serve index.html
  if (res.status === 404 && !extOf(path)) {
    return await serveFile(`${STATIC_DIR}/index.html`);
  }
  return res;
}

// ── main ───────────────────────────────────────────────────────

async function main() {
  const hostname = Deno.args[0] ?? "127.0.0.1";
  const port = parseInt(Deno.args[1] ?? "8080", 10);

  // Initial scan
  await scan();

  // Watch for changes
  const watchers = startWatcher();

  // Shutdown cleanup
  const shutdown = () => {
    console.log("\nshutting down…");
    for (const w of watchers) { try { w.close(); } catch { /* ok */ } }
    Deno.exit(0);
  };
  Deno.addSignalListener("SIGINT", shutdown);
  Deno.addSignalListener("SIGTERM", shutdown);

  Deno.serve({ hostname, port }, async (req) => {
    console.log(`[comic-server] ${req.method} ${new URL(req.url).pathname}`);
    return await handle(req);
  });

  const total = LANGS.reduce((n, l) => n + (comicsByLang[l]?.length ?? 0), 0);
  console.log(`webcomic server @ http://${hostname}:${port}`);
  console.log(`  comics dir : ${COMICS_DIR} (langs: ${LANGS.join(", ")})`);
  console.log(`  arts dir   : ${ARTS_DIR}`);
  console.log(`  static dir : ${STATIC_DIR}`);
  console.log(`  comics found: ${total}, arts found: ${arts.length}`);
  if (hostname === "127.0.0.1") {
    console.log("  (localhost only — put nginx in front for public access)");
  }
  console.log("  watching for filesystem changes…");
  console.log("  Press Ctrl+C to stop.");
}

main();
