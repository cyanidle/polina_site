import { basename as pathBasename, dirname as pathDirname, extname as pathExtname, join, resolve as pathResolve } from "jsr:@std/path@1";

const ROOT = Deno.cwd() + "/";

function resolveDir(envVarName: string, defaultName: string): string {
  const configured = Deno.env.get(envVarName)?.replace(/\/+$/, "");
  if (!configured) return `${ROOT}${defaultName}`;
  const resolved = configured.startsWith("/") ? configured : `${ROOT}${configured}`;
  console.log(`[comic-server] ${envVarName}=${configured} -> ${resolved}`);
  return resolved;
}

const SITE_DIR = resolveDir("POLINA_SITE", ".");
const COMICS_DIR = `${SITE_DIR}/comics`;
const ARTS_DIR = `${SITE_DIR}/arts`;
const CHARACTERS_DIR = `${SITE_DIR}/characters`;
const STATIC_DIR = `${ROOT}static`;

const LANGS = ["ru", "en"];

const TEASER_DIRNAME = "teaser";
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

// Natural ordering is the editorial page index and must remain the default.
const naturalCompare = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
}).compare;

function parseBool(v: string | undefined, def: boolean): boolean {
  if (v == null) return def;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

const resizeEnabledCfg = parseBool(Deno.env.get("IMAGE_RESIZE_ENABLED"), true);
const resizeMaxDim = parseInt(Deno.env.get("IMAGE_RESIZE_MAX_DIM") ?? "", 10) || 1600;
const resizeQuality = parseInt(Deno.env.get("IMAGE_RESIZE_QUALITY") ?? "", 10) || 82;
const cores = navigator.hardwareConcurrency;
const resizeConcurrency = Math.min(8, Math.max(1, parseInt(Deno.env.get("IMAGE_RESIZE_CONCURRENCY") ?? "", 10) || cores));
const resizeFormat = (Deno.env.get("IMAGE_RESIZE_FORMAT") ?? "webp").toLowerCase() === "keep" ? "keep" : "webp";

let imKind: "im7" | "im6" | null = null;
let resizeActive = false;

let resizeForce = parseBool(Deno.env.get("IMAGE_RESIZE_FORCE"), false);

function derivativeExt(srcExt: string): string {
  return resizeFormat === "webp" ? ".webp" : srcExt;
}

function derivativeFilename(originalFile: string): string {
  const ext = pathExtname(originalFile);
  return pathBasename(originalFile, ext) + derivativeExt(ext);
}

function smallPath(originalPath: string): string {
  return join(pathDirname(originalPath), SMALL_DIRNAME, derivativeFilename(pathBasename(originalPath)));
}

function smallUrl(segments: string[], originalFile: string): string {
  return urlFor(...segments, SMALL_DIRNAME, derivativeFilename(originalFile));
}

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

type ComicSummary = { lang: string; name: string; title: Localized; cover: string };
type ComicDetail = ComicSummary & {
  description: Localized;
  teaser: string[];
  characters: Character[];
  chapters: Chapter[];
};

type Art = { file: string; title: string; description: string; url: string };

type CharacterImage = { file: string; url: string; description: string };
type CharacterEntry = { name: string; cover: string; images: CharacterImage[] };

function pickLocale(value: Localized | undefined, uiLang: string, fallbackLang: string): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return value[uiLang] ?? value[fallbackLang] ?? Object.values(value)[0] ?? "";
}

function nativeTitle(c: ComicSummary): string {
  return pickLocale(c.title, c.lang, c.lang);
}

function resolveComicSummary(c: ComicDetail, uiLang: string) {
  const pageFiles = c.chapters.flatMap((ch) => ch.pages.map((page) => page.file));
  return {
    lang: c.lang,
    name: c.name,
    title: pickLocale(c.title, uiLang, c.lang),
    cover: c.cover,
    pages: pageFiles.length,
    pageFiles,
  };
}

function resolveComicDetail(c: ComicDetail, uiLang: string) {
  return {
    lang: c.lang,
    name: c.name,
    title: pickLocale(c.title, uiLang, c.lang),
    cover: c.cover,
    description: pickLocale(c.description, uiLang, c.lang),
    teaser: c.teaser,
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
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      console.log(`[comic-server] warning: cannot read ${dir}/meta.json — ${error instanceof Error ? error.message : String(error)}`);
    }
    return {};
  }
}

function basenameOf(relPath: string): string {
  const slash = relPath.lastIndexOf("/");
  return slash === -1 ? relPath : relPath.substring(slash + 1);
}

let _runDenied = false;

// Scoped --allow-run rejects inherited library-injection variables.
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
  const opts = ["-resize", `${resizeMaxDim}x${resizeMaxDim}>`, "-strip"];
  // Lossless WebP interprets quality as compression effort.
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

async function generateSmall(originalPath: string): Promise<boolean> {
  const dims = await identifyDims(originalPath);
  if (!dims) return false;
  if (Math.max(dims.w, dims.h) <= resizeMaxDim) return false;
  const outExt = derivativeExt(extOf(originalPath));
  const derivative = smallPath(originalPath);
  const smallDir = pathDirname(derivative);
  try { await Deno.stat(smallDir); } catch {
    await Deno.mkdir(smallDir, { recursive: true });
  }
  // Keep the real output extension last. ImageMagick selects its encoder from
  // the suffix; `page.webp.tmp` would contain mislabeled source-format bytes.
  const tmp = `${derivative}.tmp${outExt}`;
  try { await Deno.remove(tmp); } catch { /* didn't exist */ }
  let origSize = 0;
  try { origSize = (await Deno.stat(originalPath)).size; } catch { /* ignore */ }
  const r = await runCmd(resizeArgs(originalPath, tmp, outExt));
  if (r.code === 0) {
    await Deno.rename(tmp, derivative);
    const fmt = outExt.slice(1);
    let pct = "";
    try {
      const smallSize = (await Deno.stat(derivative)).size;
      if (origSize > 0) {
        pct = ` -${Math.round((1 - smallSize / origSize) * 100)}%`;
      }
    } catch { /* ignore */ }
    console.log(`[comic-server] resized ${basenameOf(originalPath)} (${dims.w}×${dims.h} → ≤${resizeMaxDim}px, ${fmt} q${resizeQuality}${pct})`);
    return true;
  } else {
    try { await Deno.remove(tmp); } catch { /* ignore */ }
    if (r.stderr) {
      console.log(`[comic-server] resize failed: ${basenameOf(originalPath)} — ${r.stderr.trim()}`);
    }
  }
  return false;
}

const Generating = new Set<string>();
let _genActive = 0;
let _resizedCount = 0;
const _genWaiters: Array<() => void> = [];

// Watcher events are suppressed during generation, so drain triggers a scan.
function _maybeDrain(): void {
  if (Generating.size > 0 || _genActive > 0) return;
  if (_resizedCount > 0) {
    console.log(`[comic-server] image resize: all done (${_resizedCount} image(s) resized), rescanning…`);
    _resizedCount = 0;
    scan();
  }
}

function enqueue(task: () => Promise<void>): void {
  const run = () => {
    task()
      .catch((e) => console.log(`[comic-server] ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        _genActive--;
        _genWaiters.shift()?.();
        _maybeDrain();
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
      const ok = await generateSmall(originalPath);
      if (ok) _resizedCount++;
    } finally {
      Generating.delete(originalPath);
    }
  });
}

async function resolveImageUrl(dir: string, file: string, segments: string[]): Promise<string> {
  const origPath = `${dir}/${file}`;
  let originalInfo: Deno.FileInfo | null = null;
  try { originalInfo = await Deno.stat(origPath); } catch { /* scanner will omit missing files on its next pass */ }

  // Same-name replacements need a new URL to escape browser and proxy caches.
  const revision = originalInfo
    ? [
      originalInfo.mtime?.getTime() ?? 0,
      originalInfo.birthtime?.getTime() ?? 0,
      originalInfo.ino ?? 0,
      originalInfo.size,
    ]
      .map((value) => value.toString(36))
      .join("-")
    : "missing";
  const versioned = (url: string) => `${url}?v=${revision}`;
  const originalUrl = versioned(urlFor(...segments, file));
  if (!resizeActive || !originalInfo) return originalUrl;

  const derivPath = smallPath(origPath);
  try {
    const s = await Deno.stat(derivPath);
    if ((s.mtime?.getTime() ?? 0) >= (originalInfo.mtime?.getTime() ?? 0)) {
      return versioned(smallUrl(segments, file));
    }
  } catch { /* derivative missing -> fall through and schedule it */ }
  scheduleResize(origPath);
  return originalUrl;
}

async function scanComic(lang: string, name: string): Promise<ComicDetail | null> {
  const dir = `${COMICS_DIR}/${lang}/${name}`;
  const entries = await readDirSafe(dir);
  const meta = await readMeta(dir);
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

  const allPages = chapters.flatMap((c) => c.pages);

  if (subdirs.length > 0) {
    const ignoredRootPages = await readImageFiles(dir);
    if (ignoredRootPages.length > 0) {
      console.log(`[comic-server] warning: '${name}' (${lang}) has chapter folders, so ${ignoredRootPages.length} root image(s) are ignored`);
    }
  }

  // Prefer a comic-relative path ("Chapter/1.png") so repeated filenames in
  // different chapters can carry distinct metadata. Bare filenames remain a
  // backwards-compatible fallback.
  if (meta.pages) {
    for (const page of allPages) {
      const pm = meta.pages[page.file] ?? meta.pages[basenameOf(page.file)];
      if (pm) {
        page.comment = pm.comment;
        page.date = pm.date;
      }
    }
  }

  const findPage = (ref: string) => allPages.find((page) => page.file === ref) ??
    allPages.find((page) => basenameOf(page.file) === ref);
  const coverPage = (meta.cover && findPage(meta.cover)) || allPages[0];

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

async function scanCharacters(): Promise<CharacterEntry[]> {
  const dirs = (await readDirSafe(CHARACTERS_DIR)).filter((e) => e.isDirectory).map((e) => e.name);
  dirs.sort(naturalCompare);

  const result: CharacterEntry[] = [];
  for (const name of dirs) {
    const dir = `${CHARACTERS_DIR}/${name}`;
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
      images.push({ file, description, url: await resolveImageUrl(dir, file, ["characters", name]) });
    }
    result.push({ name, cover: images[0].url, images });
  }
  return result;
}

async function purgeDerivatives(root: string): Promise<number> {
  let n = 0;
  const walk = async (dir: string): Promise<void> => {
    const entries = await readDirSafe(dir);
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory && e.name === SMALL_DIRNAME) {
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
  console.log(`[comic-server] scanning ${SITE_DIR}…`);
  const next: Record<string, ComicDetail[]> = {};
  for (const lang of LANGS) next[lang] = await scanComicsForLang(lang);
  comicsByLang = next;
  arts = await scanArts();
  characters = await scanCharacters();
  console.log(`[comic-server]   + ${arts.length} art file(s)`);
  console.log(`[comic-server]   + ${characters.length} character(s)`);
}

function startWatcher(): Deno.FsWatcher {
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

  const watcher = Deno.watchFs(SITE_DIR, { recursive: true });
  (async () => {
    for await (const _event of watcher) rescan();
  })();
  return watcher;
}

function extOf(path: string): string {
  return pathExtname(path).toLowerCase();
}

function mimeType(path: string): string {
  return MIME[extOf(path)] ?? "application/octet-stream";
}

function requestFilePath(root: string, relativePath: string): string | null {
  const base = pathResolve(root);
  const candidate = pathResolve(base, relativePath);
  return candidate.startsWith(`${base}/`) ? candidate : null;
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
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return new Response("Bad request", { status: 400 });
  }

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

  if (path.startsWith("/comics/")) {
    const filePath = requestFilePath(COMICS_DIR, path.slice("/comics/".length));
    if (!filePath) return new Response("Not found", { status: 404 });
    return await serveFile(filePath);
  }
  if (path.startsWith("/arts/")) {
    const filePath = requestFilePath(ARTS_DIR, path.slice("/arts/".length));
    if (!filePath) return new Response("Not found", { status: 404 });
    return await serveFile(filePath);
  }
  if (path.startsWith("/characters/")) {
    const filePath = requestFilePath(CHARACTERS_DIR, path.slice("/characters/".length));
    if (!filePath) return new Response("Not found", { status: 404 });
    return await serveFile(filePath);
  }

  const staticRelativePath = `${path.slice(1)}${path === "/" || path.endsWith("/") ? "index.html" : ""}`;
  const staticPath = requestFilePath(STATIC_DIR, staticRelativePath);
  if (!staticPath) return new Response("Not found", { status: 404 });
  const res = await serveFile(staticPath);
  if (res.status === 404 && !extOf(path)) {
    return await serveFile(`${STATIC_DIR}/index.html`);
  }
  return res;
}

async function main() {
  const hostname = Deno.args[0] ?? "127.0.0.1";
  const port = parseInt(Deno.args[1] ?? "8080", 10);

  if (resizeEnabledCfg) {
    imKind = await detectIm();
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

  if (resizeForce && resizeActive) {
    await purgeDerivatives(SITE_DIR);
    console.log("[comic-server] image resize: purged old derivatives for regeneration");
    resizeForce = false;
  }

  await scan();
  const watcher = startWatcher();
  const shutdown = () => {
    console.log("\nshutting down…");
    try { watcher.close(); } catch { /* ok */ }
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
  console.log(`  site dir   : ${SITE_DIR}`);
  console.log(`    comics/  : ${COMICS_DIR} (langs: ${LANGS.join(", ")})`);
  console.log(`    arts/    : ${ARTS_DIR}`);
  console.log(`    characters/: ${CHARACTERS_DIR}`);
  console.log(`  static dir : ${STATIC_DIR}`);
  console.log(`  comics found: ${total}, arts found: ${arts.length}, characters found: ${characters.length}`);
  if (hostname === "127.0.0.1") {
    console.log("  (localhost only — put nginx in front for public access)");
  }
  console.log("  watching for filesystem changes…");
  console.log("  Press Ctrl+C to stop.");
}

main();
