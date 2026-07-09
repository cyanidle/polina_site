import { basename as pathBasename, dirname as pathDirname, extname as pathExtname, join } from "jsr:@std/path@1";

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
 *   - dev:  `deno run --allow-net --allow-read --allow-env --allow-write --allow-run=magick,convert,identify server.ts`
 *   - prod: run on 127.0.0.1:8080 behind nginx (see nginx.conf).
 *
 * Usage:
 *   deno run --allow-net --allow-read --allow-env --allow-write --allow-run=magick,convert,identify server.ts                # 127.0.0.1:8080
 *   deno run --allow-net --allow-read --allow-env --allow-write --allow-run=magick,convert,identify server.ts 0.0.0.0 9090   # custom host/port
 *
 * Env vars (optional; --allow-env is required regardless of whether they're set):
 *   COMICS_DIR   where comics/ content lives — absolute, or relative to cwd (default "comics")
 *   ARTS_DIR     where arts/ content lives — absolute, or relative to cwd (default "arts")
 *
 *   IMAGE_RESIZE_ENABLED       "1"/"true" to downscale large images on the fly (default: true)
 *   IMAGE_RESIZE_MAX_DIM       max width/height of the derivative, in px (default: 1600)
 *   IMAGE_RESIZE_QUALITY       WebP/JPEG quality of the derivative (default: 82; lossless WebP uses it as compression-effort)
 *   IMAGE_RESIZE_FORMAT        output format of the derivative: "webp" (smaller, default) or "keep" (same as source)
 *   IMAGE_RESIZE_CONCURRENCY   parallel ImageMagick processes during generation (default: 3, clamped 1-8)
 *   IMAGE_RESIZE_FORCE         "1"/"true" to purge every existing small/ dir on startup so they regenerate
 *                              with current settings (one-shot — the flag is cleared after purge)
 *
 * Derivatives live in a small/ subdirectory next to the original, e.g.
 * /comics/ru/Test/page.png -> /comics/ru/Test/small/page.webp.
 *
 * Image resize needs ImageMagick (magick/convert/identify) on PATH AND
 * --allow-run=magick,convert,identify. If either is missing, resize is
 * skipped (logged once) and originals are served — the server still works.
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

// Derivatives live in a `small/` subdirectory next to the original, e.g.
// /comics/ru/Test/page.png -> /comics/ru/Test/small/page.webp.
// Directories, so the isFile filter in readImageFiles / scanArts naturally
// skips them; only scanComic's chapter-discovery loop needs an explicit
// exclusion (same as teaser/).  The flat arts scan is also unaffected.
const SMALL_DIRNAME = "small";

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

// ── image-resize config ───────────────────────────────────────
//
// Large images are downscaled once into a "shadow" WebP copy living in a
// small/ subdirectory next to the original: /path/to/page.png becomes
// /path/to/small/page.webp. All optional; needs ImageMagick + `--allow-run`
// (see the resize section below for details).
function parseBool(v: string | undefined, def: boolean): boolean {
  if (v == null) return def;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

const resizeEnabledCfg = parseBool(Deno.env.get("IMAGE_RESIZE_ENABLED"), true);
const resizeMaxDim = parseInt(Deno.env.get("IMAGE_RESIZE_MAX_DIM") ?? "", 10) || 1600;
const resizeQuality = parseInt(Deno.env.get("IMAGE_RESIZE_QUALITY") ?? "", 10) || 82;
const cores = navigator.hardwareConcurrency;
const resizeConcurrency = Math.min(8, Math.max(1, parseInt(Deno.env.get("IMAGE_RESIZE_CONCURRENCY") ?? "", 10) || cores));
// Output format of the derivative: "webp" (re-encode for much smaller files,
// default) or "keep" (same format as the source).
const resizeFormat = (Deno.env.get("IMAGE_RESIZE_FORMAT") ?? "webp").toLowerCase() === "keep" ? "keep" : "webp";

// Detected at startup in main(): "im7" (magick), "im6" (convert), or null.
// `resizeActive` is true only when enabled AND ImageMagick was detected AND
// --allow-run is granted.
let imKind: "im7" | "im6" | null = null;
let resizeActive = false;

// One-shot: when IMAGE_RESIZE_FORCE is set, main() purges every existing
// small/ directory before the first scan so they all regenerate with current
// settings (e.g. after changing FORMAT/QUALITY/MAX_DIM), then clears this.
let resizeForce = parseBool(Deno.env.get("IMAGE_RESIZE_FORCE"), false);

// Extension the derivative is written as. webp -> always .webp; keep -> the
// source's own extension.
function derivativeExt(srcExt: string): string {
  return resizeFormat === "webp" ? ".webp" : srcExt;
}

// Derivative filename: original stem + (possibly new) extension.
//   "page.png" + webp -> "page.webp"; "page.png" + keep -> "page.png".
function derivativeFilename(originalFile: string): string {
  const ext = pathExtname(originalFile);
  return pathBasename(originalFile, ext) + derivativeExt(ext);
}

// Absolute filesystem path of the derivative: small/ subdirectory next to
// the original, with the (possibly format-converted) filename.
function smallPath(originalPath: string): string {
  return join(pathDirname(originalPath), SMALL_DIRNAME, derivativeFilename(pathBasename(originalPath)));
}

// URL for the derivative — same segments as the original, but with small/
// inserted before the filename.
function smallUrl(segments: string[], originalFile: string): string {
  return urlFor(...segments, SMALL_DIRNAME, derivativeFilename(originalFile));
}

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
  return IMAGE_EXTS.has(pathExtname(filename).toLowerCase());
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

// ── image resize (ImageMagick) ────────────────────────────────
//
// Large source images are downscaled once into a "shadow" derivative in a
// sibling small/ subdirectory (e.g. page.png -> small/page.webp) and that
// derivative is served instead of the original. Generation is async and
// non-blocking: a scan schedules any missing/out-of-date derivatives, and
// the next scan (the file write fires the watcher) serves them. Originals
// are never modified; derivatives are plain cache files living in the same
// (gitignored) content dirs, served by the existing /comics/ and /arts/ routes.

let _runDenied = false;

// Environment passed to ImageMagick: the inherited env minus library-injection
// vars (LD_LIBRARY_PATH, DYLD_*, …). Deno refuses to leak those to a subprocess
// unless --allow-all, so stripping them lets a scoped --allow-run work in
// environments that set LD_* (snap packages, some containers). Built once.
const _subEnv: Record<string, string> = Object.fromEntries(
  Object.entries(Deno.env.toObject()).filter(([k]) => !/^(LD_|DYLD_)/.test(k)),
) as Record<string, string>;

async function runCmd(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  if (_runDenied) return { code: -1, stdout: "", stderr: "subprocess execution denied" };
  try {
    const proc = new Deno.Command(args[0], {
      args: args.slice(1),
      stdout: "piped",
      stderr: "piped",
      clearEnv: true,
      env: _subEnv,
    });
    const out = await proc.output();
    const dec = new TextDecoder();
    return { code: out.code, stdout: dec.decode(out.stdout), stderr: dec.decode(out.stderr) };
  } catch (e) {
    if (e instanceof Deno.errors.NotCapable) _runDenied = true;
    return { code: -1, stdout: "", stderr: e instanceof Error ? e.message : String(e) };
  }
}

async function detectIm(): Promise<"im7" | "im6" | null> {
  for (const [bin, kind] of [["magick", "im7"], ["convert", "im6"]] as const) {
    const r = await runCmd([bin, "-version"]);
    if (_runDenied) return null;
    if (r.code === 0 || /ImageMagick/i.test(r.stdout)) return kind;
  }
  return null;
}

function identifyArgs(filePath: string): string[] {
  return imKind === "im7"
    ? ["magick", "identify", "-format", "%w %h", filePath]
    : ["identify", "-format", "%w %h", filePath];
}

function resizeArgs(filePath: string, smallPath: string, outExt: string): string[] {
  // `>` shrinks only if larger than the box, so already-small images are left
  // untouched; -strip drops metadata for smaller files.
  const opts = ["-resize", `${resizeMaxDim}x${resizeMaxDim}>`, "-strip"];
  // -quality is only meaningful for lossy formats (for PNG it's the zlib
  // level 0-9), so it applies to the *output* — webp/jpeg — not the source.
  // Lossless webp uses -quality for compression-effort (0-100) rather than
  // visual quality; the true lossless parameter is the -define.
  if (outExt === ".webp") {
    opts.push("-quality", String(resizeQuality), "-define", "webp:lossless=true");
  } else if (outExt === ".jpg" || outExt === ".jpeg") {
    opts.push("-quality", String(resizeQuality));
  }
  if (imKind === "im7") return ["magick", filePath, ...opts, smallPath];
  return ["convert", filePath, ...opts, smallPath];
}

async function identifyDims(filePath: string): Promise<{ w: number; h: number } | null> {
  const r = await runCmd(identifyArgs(filePath));
  if (r.code !== 0) return null;
  const m = r.stdout.trim().split(/\s+/);
  const w = parseInt(m[0], 10);
  const h = parseInt(m[1], 10);
  return w > 0 && h > 0 ? { w, h } : null;
}

async function generateSmall(originalPath: string): Promise<void> {
  const dims = await identifyDims(originalPath);
  if (!dims) return;
  if (Math.max(dims.w, dims.h) <= resizeMaxDim) return; // already small enough
  const outExt = derivativeExt(extOf(originalPath));
  const derivative = smallPath(originalPath);
  // ensure the small/ directory exists (one stat + conditional mkdir)
  const smallDir = pathDirname(derivative);
  try { await Deno.stat(smallDir); } catch {
    await Deno.mkdir(smallDir, { recursive: true });
  }
  let origSize = 0;
  try { origSize = (await Deno.stat(originalPath)).size; } catch { /* ignore */ }
  const r = await runCmd(resizeArgs(originalPath, derivative, outExt));
  if (r.code === 0) {
    const fmt = outExt.slice(1);
    let pct = "";
    try {
      const smallSize = (await Deno.stat(derivative)).size;
      if (origSize > 0) {
        pct = ` -${Math.round((1 - smallSize / origSize) * 100)}%`;
      }
    } catch { /* ignore */ }
    console.log(`[comic-server] resized ${basenameOf(originalPath)} (${dims.w}×${dims.h} → ≤${resizeMaxDim}px, ${fmt} q${resizeQuality}${pct})`);
  } else if (r.stderr) {
    console.log(`[comic-server] resize failed: ${basenameOf(originalPath)} — ${r.stderr.trim()}`);
  }
}

// Bounded-concurrency queue so a big first scan doesn't fork dozens of
// ImageMagick processes at once. Tasks run as slots free up.
const Generating = new Set<string>();
let _genActive = 0;
const _genWaiters: Array<() => void> = [];

function enqueue(task: () => Promise<void>): void {
  const run = () => {
    task()
      .catch((e) => console.log(`[comic-server] ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        _genActive--;
        _genWaiters.shift()?.();
      });
  };
  if (_genActive < resizeConcurrency) {
    _genActive++;
    run();
  } else {
    _genWaiters.push(() => {
      _genActive++;
      run();
    });
  }
}

function scheduleResize(originalPath: string): void {
  if (!resizeActive || Generating.has(originalPath)) return;
  Generating.add(originalPath);
  enqueue(async () => {
    try {
      await generateSmall(originalPath);
    } finally {
      Generating.delete(originalPath);
    }
  });
}

// URL to serve for an image: the derivative if a current one exists, else
// the original (scheduling generation of the derivative in the background).
// `segments` are the URL path parts up to (but not including) the filename.
async function resolveImageUrl(dir: string, file: string, segments: string[]): Promise<string> {
  const originalUrl = urlFor(...segments, file);
  if (!resizeActive) return originalUrl;
  const origPath = `${dir}/${file}`;
  const derivPath = smallPath(origPath);
  try {
    const [s, o] = await Promise.all([Deno.stat(derivPath), Deno.stat(origPath)]);
    // Derivative is current only if not older than its source.
    if ((s.mtime?.getTime() ?? 0) >= (o.mtime?.getTime() ?? 0)) {
      return smallUrl(segments, file);
    }
  } catch { /* derivative missing -> fall through and schedule it */ }
  scheduleResize(origPath);
  return originalUrl;
}

async function scanComic(lang: string, name: string): Promise<ComicDetail | null> {
  const dir = `${COMICS_DIR}/${lang}/${name}`;
  const entries = await readDirSafe(dir);
  const subdirs = entries
    .filter((e) => e.isDirectory && e.name !== TEASER_DIRNAME && e.name !== SMALL_DIRNAME)
    .sort((a, b) => naturalCompare(a.name, b.name));

  const chapters: Chapter[] = [];
  if (subdirs.length > 0) {
    for (const sub of subdirs) {
      const subDir = `${dir}/${sub.name}`;
      const files = await readImageFiles(subDir);
      if (files.length === 0) continue;
      const pages: Page[] = [];
      for (const f of files) {
        pages.push({ file: `${sub.name}/${f}`, url: await resolveImageUrl(subDir, f, ["comics", lang, name, sub.name]) });
      }
      chapters.push({ name: sub.name, pages });
    }
  } else {
    const files = await readImageFiles(dir);
    if (files.length > 0) {
      const pages: Page[] = [];
      for (const f of files) {
        pages.push({ file: f, url: await resolveImageUrl(dir, f, ["comics", lang, name]) });
      }
      chapters.push({ name, pages });
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

  const teaserDir = `${dir}/${TEASER_DIRNAME}`;
  const teaserFiles = await readImageFiles(teaserDir);
  const teaser: string[] = [];
  for (const f of teaserFiles) teaser.push(await resolveImageUrl(teaserDir, f, ["comics", lang, name, TEASER_DIRNAME]));

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
    result.push({ file, title, description, url: await resolveImageUrl(ARTS_DIR, file, ["arts"]) });
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
      images.push({ file, description, url: await resolveImageUrl(dir, file, ["arts", CHARACTERS_DIRNAME, name]) });
    }
    result.push({ name, cover: images[0].url, images });
  }
  return result;
}

// Delete every small/ directory under `root` so derivatives get regenerated
// with current settings. Used by the one-shot IMAGE_RESIZE_FORCE flag at
// startup. Returns how many files were removed.
async function purgeDerivatives(root: string): Promise<number> {
  let n = 0;
  const walk = async (dir: string): Promise<void> => {
    const entries = await readDirSafe(dir);
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory && e.name === SMALL_DIRNAME) {
        // Count files inside before removing the directory
        const smallEntries = await readDirSafe(p);
        n += smallEntries.filter((f) => f.isFile).length;
        try { await Deno.remove(p, { recursive: true }); } catch { /* ignore */ }
      } else if (e.isDirectory) {
        await walk(p);
      }
    }
  };
  await walk(root);
  return n;
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
    if (Generating.size)
      return;
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
  return pathExtname(path).toLowerCase();
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

  // Detect ImageMagick for optional on-the-fly resize of large images.
  imKind = await detectIm();
  if (resizeEnabledCfg) {
    if (_runDenied) {
      console.log("[comic-server] image resize: --allow-run not granted; serving originals. Add --allow-run=magick,convert,identify or set IMAGE_RESIZE_ENABLED=false");
    } else if (!imKind) {
      console.log("[comic-server] image resize: ImageMagick not found; serving originals. Install IM or set IMAGE_RESIZE_ENABLED=false");
    } else {
      resizeActive = true;
      console.log(`[comic-server] image resize: on (ImageMagick ${imKind}, max ${resizeMaxDim}px, ${resizeFormat === "webp" ? "webp" : "same-format"}, q${resizeQuality})`);
    }
  } else {
    console.log("[comic-server] image resize: disabled (IMAGE_RESIZE_ENABLED=false)");
  }

  // One-shot purge of all existing derivatives so they regenerate with
  // current settings (set IMAGE_RESIZE_FORCE=1 to trigger this).
  if (resizeForce && resizeActive) {
    await Promise.all([purgeDerivatives(COMICS_DIR), purgeDerivatives(ARTS_DIR)]);
    // Count is omitted from the log (could be thousands) but the function
    // returns it; a manual count is `find … -type d -name small | wc -l`.
    console.log("[comic-server] image resize: purged old derivatives for regeneration");
    resizeForce = false;
  }

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
