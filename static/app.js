/**
 * Webcomic Reader — frontend
 *
 * The frontend is server-agnostic: URLs are the same whether Python or nginx
 * is in front.  In dev, server.py handles everything.  In prod, nginx serves
 * static files and images directly, proxying only /api/ to Python on localhost.
 */

// ── polling ──────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000;   // how often to check for new comics

// ── API helpers ──────────────────────────────────────────────

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function imageUrl(comicName, pageFile) {
  return `/comics/${encodeURIComponent(comicName)}/${encodeURIComponent(pageFile)}`;
}

// ── state ────────────────────────────────────────────────────

let state = {
  comics: [],        // [{name, pages: [string]}]
  activeComic: null, // name of selected comic, or null
  activePage: 0,     // index into active comic's pages array
};

// ── DOM refs ─────────────────────────────────────────────────

const $comicList   = document.getElementById("comic-list");
const $comicTitle  = document.getElementById("comic-title");
const $pageInd     = document.getElementById("page-indicator");
const $pageImage   = document.getElementById("page-image");
const $btnPrev     = document.getElementById("btn-prev");
const $btnNext     = document.getElementById("btn-next");
const $lightbox    = document.getElementById("lightbox");
const $lightboxImg = document.getElementById("lightbox-image");

// ── render ────────────────────────────────────────────────────

function renderComicList() {
  if (state.comics.length === 0) {
    $comicList.innerHTML = '<p class="placeholder">No comics found.<br>Drop a folder into <code>comics/</code></p>';
    return;
  }

  $comicList.innerHTML = state.comics
    .map(
      (c) => `
      <button class="comic-item${c.name === state.activeComic ? " active" : ""}"
              data-comic="${escapeHTML(c.name)}">
        ${escapeHTML(c.name)}
        <span class="page-count">${c.pages.length} page${c.pages.length !== 1 ? "s" : ""}</span>
      </button>`
    )
    .join("");
}

function renderReader() {
  const comic = state.comics.find((c) => c.name === state.activeComic);

  if (!comic) {
    $comicTitle.textContent = "← pick a comic";
    $pageInd.textContent = "";
    $pageImage.src = "";
    $pageImage.alt = "";
    $btnPrev.disabled = true;
    $btnNext.disabled = true;
    return;
  }

  $comicTitle.textContent = comic.name;

  const page = comic.pages[state.activePage];
  $pageInd.textContent = `${state.activePage + 1} / ${comic.pages.length}`;
  $btnPrev.disabled = state.activePage === 0;
  $btnNext.disabled = state.activePage >= comic.pages.length - 1;

  $pageImage.classList.add("loading");
  $pageImage.src = imageUrl(comic.name, page);
  $pageImage.alt = page;
  $pageImage.onload = () => $pageImage.classList.remove("loading");
  $pageImage.onerror = () => {
    $pageImage.classList.remove("loading");
    $pageImage.alt = "Failed to load image";
  };
}

// ── actions ───────────────────────────────────────────────────

function selectComic(name) {
  state.activeComic = name;
  state.activePage = 0;
  renderComicList();
  renderReader();
}

function goToPage(index) {
  const comic = state.comics.find((c) => c.name === state.activeComic);
  if (!comic) return;
  state.activePage = Math.max(0, Math.min(index, comic.pages.length - 1));
  renderReader();
}

function goPrev() { goToPage(state.activePage - 1); }
function goNext() { goToPage(state.activePage + 1); }

// ── events ────────────────────────────────────────────────────

$comicList.addEventListener("click", (e) => {
  const btn = e.target.closest(".comic-item");
  if (!btn) return;
  selectComic(btn.dataset.comic);
});

$btnPrev.addEventListener("click", goPrev);
$btnNext.addEventListener("click", goNext);

$pageImage.addEventListener("click", () => {
  if (!$pageImage.src) return;
  $lightboxImg.src = $pageImage.src;
  $lightbox.classList.remove("lightbox-hidden");
});

$lightbox.addEventListener("click", () => {
  $lightbox.classList.add("lightbox-hidden");
  $lightboxImg.src = "";
});

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  switch (e.key) {
    case "ArrowLeft":  goPrev(); break;
    case "ArrowRight": goNext(); break;
    case "Escape":     $lightbox.classList.add("lightbox-hidden"); break;
  }
});

// ── auto-discovery polling ───────────────────────────────────

let _pollTimer = null;

async function pollForNewComics() {
  try {
    const comics = await fetchJSON("/api/comics");

    // Detect new or removed comics
    const oldNames = new Set(state.comics.map((c) => c.name));
    const newNames = new Set(comics.map((c) => c.name));
    const added = comics.filter((c) => !oldNames.has(c.name));

    state.comics = comics;

    // If current comic was removed, pick the first available
    if (state.activeComic && !newNames.has(state.activeComic)) {
      state.activeComic = comics.length > 0 ? comics[0].name : null;
      state.activePage = 0;
    }

    renderComicList();

    // If a new comic appeared and nothing is selected, auto-select it
    if (added.length > 0 && !state.activeComic && comics.length > 0) {
      selectComic(comics[0].name);
    }
  } catch (err) {
    // Silently retry on next interval — don't spam the user
    console.warn("poll error:", err);
  } finally {
    _pollTimer = setTimeout(pollForNewComics, POLL_INTERVAL_MS);
  }
}

// ── init ──────────────────────────────────────────────────────

async function init() {
  try {
    state.comics = await fetchJSON("/api/comics");
  } catch (err) {
    $comicList.innerHTML =
      '<p class="placeholder">Failed to load comics.<br><small>' +
      escapeHTML(String(err)) +
      "</small></p>";
    console.error("init error:", err);
    return;
  }

  renderComicList();

  if (state.comics.length > 0) {
    selectComic(state.comics[0].name);
  }

  // Start background polling for new comics
  _pollTimer = setTimeout(pollForNewComics, POLL_INTERVAL_MS);
}

// ── util ──────────────────────────────────────────────────────

function escapeHTML(str) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

// ── go ────────────────────────────────────────────────────────

init();
