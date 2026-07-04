/**
 * Webcomic server — auto-discovers comics from the filesystem.
 *
 * Uses Deno.watchFs to monitor the comics directory, so new comics dropped
 * into the folder appear immediately — no restart and no per-request scanning.
 *
 * Architecture:
 *   - dev:  `deno run --allow-net --allow-read server.ts`
 *   - prod: run on 127.0.0.1:8080 behind nginx (see nginx.conf).
 *
 * Usage:
 *   deno run --allow-net --allow-read server.ts                    # 127.0.0.1:8080
 *   deno run --allow-net --allow-read server.ts 0.0.0.0 9090       # custom host/port
 */

const ROOT = Deno.cwd() + "/";
const COMICS_DIR = `${ROOT}comics`;
const STATIC_DIR = `${ROOT}static`;

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

// ── comic cache ─────────────────────────────────────────────────
//
// The filesystem is scanned once at startup, then kept up-to-date by
// a Deno.watchFs watcher.  API handlers read from this cache so they
// never touch the disk.

type Comic = { name: string; pages: string[] };

let comics: Comic[] = [];

async function scan(): Promise<void> {
  const result: Comic[] = [];
  const seen = new Set<string>();

  try {
    for await (const entry of Deno.readDir(COMICS_DIR)) {
      if (!entry.isDirectory) continue;
      const pages = await readPages(`${COMICS_DIR}/${entry.name}`);
      if (pages.length > 0) {
        result.push({ name: entry.name, pages });
        seen.add(entry.name);
      }
    }
  } catch { /* directory missing */ }

  result.sort((a, b) => a.name.localeCompare(b.name));

  // Log newcomers
  const oldNames = new Set(comics.map((c) => c.name));
  for (const name of seen) {
    if (!oldNames.has(name)) console.log(`[comic-server] + new comic detected: '${name}'`);
  }
  for (const old of oldNames) {
    if (!seen.has(old)) console.log(`[comic-server] - comic removed: '${old}'`);
  }

  comics = result;
}

async function readPages(dir: string): Promise<string[]> {
  const pages: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile) continue;
      const dot = entry.name.lastIndexOf(".");
      if (dot === -1) continue;
      if (IMAGE_EXTS.has(entry.name.substring(dot).toLowerCase())) {
        pages.push(entry.name);
      }
    }
  } catch { /* directory missing */ }
  pages.sort();
  return pages;
}

// ── filesystem watcher ─────────────────────────────────────────

function startWatcher(): Deno.FsWatcher {
  // Debounce: coalesce rapid-fire FS events into a single rescan
  let timer: ReturnType<typeof setTimeout> | null = null;
  const DEBOUNCE_MS = 200;

  const watcher = Deno.watchFs(COMICS_DIR, { recursive: true });
  (async () => {
    for await (const _event of watcher) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        await scan();
        console.log("[comic-server] rescanned after filesystem change");
      }, DEBOUNCE_MS);
    }
  })();

  return watcher;
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
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function json(data: unknown): Response {
  const body = JSON.stringify(data, null, 2);
  return new Response(body, {
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

  // Health check
  if (path === "/api/health") {
    return json({ status: "ok", comics: comics.length });
  }

  // API: list all comics (from cache)
  if (path === "/api/comics") {
    return json(comics);
  }

  // API: single comic detail (from cache)
  if (path.startsWith("/api/comics/")) {
    const name = path.slice("/api/comics/".length).replace(/\/$/, "");
    const comic = comics.find((c) => c.name === name);
    if (!comic) {
      return new Response("Comic not found", { status: 404 });
    }
    return json(comic);
  }

  // Comic images
  if (path.startsWith("/comics/")) {
    const filePath = `${ROOT}${path.replace(/^\//, "")}`;
    return await serveFile(filePath);
  }

  // Static frontend files
  let staticPath = `${STATIC_DIR}${path}`;
  if (path === "/" || path.endsWith("/")) {
    staticPath = `${STATIC_DIR}${path}index.html`;
  }
  return await serveFile(staticPath);
}

// ── main ───────────────────────────────────────────────────────

async function main() {
  const hostname = Deno.args[0] ?? "127.0.0.1";
  const port = parseInt(Deno.args[1] ?? "8080", 10);

  // Ensure directories exist
  try { Deno.mkdirSync(COMICS_DIR); } catch { /* ok */ }
  try { Deno.mkdirSync(STATIC_DIR); } catch { /* ok */ }

  // Initial scan
  await scan();

  // Watch for changes
  const watcher = startWatcher();

  // Shutdown cleanup
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

  console.log(`webcomic server @ http://${hostname}:${port}`);
  console.log(`  comics dir : ${COMICS_DIR}`);
  console.log(`  static dir : ${STATIC_DIR}`);
  console.log(`  comics found: ${comics.length}`);
  if (hostname === "127.0.0.1") {
    console.log("  (localhost only — put nginx in front for public access)");
  }
  console.log("  watching for filesystem changes…");
  console.log("  Press Ctrl+C to stop.");
}

main();
