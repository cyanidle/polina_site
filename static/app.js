const FS_ENTER = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="7,1 17,1 17,11"/><polyline points="11,17 1,17 1,7"/></svg>`;
const FS_EXIT  = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="11,1 1,1 1,11"/><polyline points="7,17 17,17 17,7"/></svg>`;

const STRINGS = {
  welcomeTitle: { ru: "Hardgrizz Comics", en: "Hardgrizz Comics", },
  welcomeText: { ru: "Комиксы и рисунки.", en: "Comics and art.", },
  comics: { ru: "Комиксы", en: "Comics", },
  arts: { ru: "Арты", en: "Arts", },
  charactersTab: { ru: "Персонажи", en: "Characters", },
  readFromStart: { ru: "Читать с начала", en: "Read from the start", },
  chapters: { ru: "Главы", en: "Chapters", },
  characters: { ru: "Персонажи", en: "Characters", },
  backToComics: { ru: "К комиксам", en: "Back to comics", },
  backToArts: { ru: "К артам", en: "Back to arts", },
  backToCharacters: { ru: "К персонажам", en: "Back to characters", },
  noCharacters: { ru: "Персонажи пока не добавлены.", en: "No characters yet.", },
  backToComic: { ru: "К странице комикса", en: "Back to comic page", },
  home: { ru: "На главную", en: "Home", },
  noComics: { ru: "Комиксы пока не добавлены.", en: "No comics yet.", },
  noArts: { ru: "Работы пока не добавлены.", en: "No art yet.", },
  loading: { ru: "Загрузка…", en: "Loading…", },
  error: { ru: "Не удалось загрузить данные.", en: "Failed to load data.", },
  page: { ru: "Страница", en: "Page", },
  published: { ru: "Опубликовано", en: "Published", },
  fullscreen: { ru: "На весь экран", en: "Fullscreen", },
  exitFullscreen: { ru: "Свернуть", en: "Exit fullscreen", },
  continueReading: { ru: "Продолжить чтение", en: "Continue reading", },
  disclaimer: {
    ru: "Этот контент предназначен только для взрослой аудитории 18+",
    en: "This content is intended for mature audiences only 18+",
  },
  ageTitle: { ru: "18+", en: "18+", },
  ageText: {
    ru: "Этот сайт содержит материалы, предназначенные только для взрослых. Вам исполнилось 18 лет?",
    en: "This site contains content intended for mature audiences only. Are you 18 or older?",
  },
  ageConfirm: { ru: "Мне есть 18", en: "I am 18 or older", },
  ageLeave: { ru: "Выйти", en: "Leave", },
  prev: { ru: "Назад", en: "Previous", },
  next: { ru: "Вперёд", en: "Next", },
  newComics: { ru: "Есть новые комиксы", en: "New comics", },
  newArts: { ru: "Есть новые работы", en: "New art", },
  newCharacters: { ru: "Есть новые персонажи", en: "New characters", },
  newPages: { ru: "Есть новые страницы", en: "New pages", },
  newItem: { ru: "Новое", en: "New", },
  relatedComics: { ru: "Появляется в комиксах", en: "Appears in comics", },
};

// Language precedence: URL query, localStorage, then Russian.
function urlLang() {
  const l = new URLSearchParams(location.search).get("lang");
  return l === "ru" || l === "en" ? l : null;
}

let siteLang = urlLang() || localStorage.getItem("siteLang") || "ru";

function syncUrlLang() {
  const url = new URL(location.href);
  if (url.searchParams.get("lang") === siteLang) return;
  url.searchParams.set("lang", siteLang);
  history.replaceState(history.state, "", url);
}

function t(key) {
  return STRINGS[key][siteLang] ?? STRINGS[key].ru ?? key;
}

function setSiteLang(lang) {
  siteLang = lang;
  localStorage.setItem("siteLang", lang);
  syncUrlLang();
  document.documentElement.lang = lang;
  renderLangToggle();
  renderDisclaimer();
  renderAgeGate();
  render();
}

function renderDisclaimer() {
  const footer = document.getElementById("site-footer");
  if (footer) footer.textContent = t("disclaimer");
}

function ageConfirmed() {
  return localStorage.getItem("ageConfirmed") === "yes";
}

function renderAgeGate() {
  const existing = document.getElementById("age-gate");
  if (ageConfirmed()) { existing?.remove(); return; }
  if (existing) {
    existing.querySelector(".age-gate-text").textContent = t("ageText");
    existing.querySelector("#age-confirm").textContent = t("ageConfirm");
    existing.querySelector("#age-leave").textContent = t("ageLeave");
    return;
  }
  const overlay = document.createElement("div");
  overlay.id = "age-gate";
  overlay.className = "age-gate";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", t("ageTitle"));
  overlay.innerHTML = `
    <div class="age-gate-box">
      <div class="age-gate-badge">18+</div>
      <p class="age-gate-text">${escapeHTML(t("ageText"))}</p>
      <div class="age-gate-actions">
        <button class="btn btn-red" id="age-confirm">${escapeHTML(t("ageConfirm"))}</button>
        <button class="btn btn-ghost" id="age-leave">${escapeHTML(t("ageLeave"))}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#age-confirm").addEventListener("click", () => {
    localStorage.setItem("ageConfirmed", "yes");
    overlay.remove();
  });
  overlay.querySelector("#age-leave").addEventListener("click", () => {
    location.href = "https://www.google.com/";
  });
}

function renderLangToggle() {
  document.querySelectorAll("[data-lang-btn]").forEach((el) => {
    el.classList.toggle("active", el.dataset.langBtn === siteLang);
  });
}

document.getElementById("lang-toggle").addEventListener("click", () => {
  setSiteLang(siteLang === "ru" ? "en" : "ru");
});

function escapeHTML(str) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(str ?? ""));
  return div.innerHTML;
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function navigate(path) {
  location.hash = path;
}

function encPath(...segments) {
  return segments.map(encodeURIComponent).join("/");
}

function progressKey(lang, name) {
  return `${lang}/${name}`;
}

function loadAllProgress() {
  try {
    return JSON.parse(localStorage.getItem("readingProgress") || "{}");
  } catch {
    return {};
  }
}

function getProgress(lang, name) {
  return loadAllProgress()[progressKey(lang, name)] ?? null;
}

function comicPageFiles(comic) {
  return comic.chapters.flatMap((chapter) => chapter.pages.map((page) => page.file));
}

function progressFraction(progress, totalPages, pageFiles) {
  if (!progress || totalPages <= 0) return 0;
  if (Array.isArray(pageFiles) && Array.isArray(progress.seenPageFiles)) {
    const seen = new Set(progress.seenPageFiles);
    return pageFiles.filter((file) => seen.has(file)).length / totalPages;
  }
  if (typeof progress.seenPages === "number") {
    return Math.min(progress.seenPages, totalPages) / totalPages;
  }
  return Math.max(0, Math.min(progress.fraction ?? 0, 1));
}

// Prefer the page's stable comic-relative filename. The numeric indices are
// retained for progress records written by older versions of the frontend.
function progressPosition(progress, comic) {
  if (progress?.pageFile) {
    for (let chapterIdx = 0; chapterIdx < comic.chapters.length; chapterIdx++) {
      const pageIdx = comic.chapters[chapterIdx].pages.findIndex((page) => page.file === progress.pageFile);
      if (pageIdx !== -1) return { chapterIdx, pageIdx };
    }
  }

  const chapterIdx = Math.max(0, Math.min(
    Number.isInteger(progress?.chapterIdx) ? progress.chapterIdx : 0,
    comic.chapters.length - 1,
  ));
  const chapter = comic.chapters[chapterIdx];
  const pageIdx = Math.max(0, Math.min(
    Number.isInteger(progress?.pageIdx) ? progress.pageIdx : 0,
    chapter.pages.length - 1,
  ));
  return { chapterIdx, pageIdx };
}

function saveProgress(lang, name, chapterIdx, pageIdx, comic) {
  const pageFiles = comicPageFiles(comic);
  const totalPages = pageFiles.length;
  const pagesBefore = comic.chapters.slice(0, chapterIdx).reduce((n, c) => n + c.pages.length, 0);
  const flatSeen = pagesBefore + pageIdx + 1;

  const all = loadAllProgress();
  const prev = all[progressKey(lang, name)];
  const seen = new Set(Array.isArray(prev?.seenPageFiles) ? prev.seenPageFiles : []);

  // Migrate legacy count-only progress, then mark every page through the
  // current position as read. File identities survive insertions/reordering.
  if (!Array.isArray(prev?.seenPageFiles)) {
    for (const file of pageFiles.slice(0, prev?.seenPages ?? 0)) seen.add(file);
  }
  for (const file of pageFiles.slice(0, flatSeen)) seen.add(file);

  const seenPageFiles = pageFiles.filter((file) => seen.has(file));
  const seenPages = seenPageFiles.length;
  const fraction = totalPages > 0 ? seenPages / totalPages : 0;
  all[progressKey(lang, name)] = {
    chapterIdx,
    pageIdx,
    pageFile: comic.chapters[chapterIdx].pages[pageIdx].file,
    fraction,
    seenPages,
    seenPageFiles,
    totalPages,
    updatedAt: Date.now(),
  };
  localStorage.setItem("readingProgress", JSON.stringify(all));
}

function comicHasUnread(lang, name, totalPages, pageFiles) {
  const p = getProgress(lang, name);
  if (!p) return true;
  if (Array.isArray(pageFiles) && Array.isArray(p.seenPageFiles)) {
    const seen = new Set(p.seenPageFiles);
    return pageFiles.some((file) => !seen.has(file));
  }
  if (typeof totalPages === "number" && totalPages > 0) {
    const seen = p.seenPages ?? Math.round((p.fraction ?? 0) * totalPages);
    return seen < totalPages;
  }
  return (p.fraction ?? 0) < 1;
}

function loadVisited(store) {
  try {
    return JSON.parse(localStorage.getItem(store) || "{}");
  } catch {
    return {};
  }
}

function isVisited(store, id) {
  return !!loadVisited(store)[id];
}

function markVisited(store, id) {
  const all = loadVisited(store);
  if (all[id]) return;
  all[id] = Date.now();
  localStorage.setItem(store, JSON.stringify(all));
}

const isArtVisited = (file) => isVisited("visitedArts", file);
const markArtVisited = (file) => markVisited("visitedArts", file);
const isCharacterVisited = (name) => isVisited("visitedCharacters", name);
const markCharacterVisited = (name) => markVisited("visitedCharacters", name);

function burstPoints(spikes, outer, inner, cx, cy) {
  const pts = [];
  const step = Math.PI / spikes;
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = i * step - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}
const _burstPoints = burstPoints(12, 48, 37, 50, 50);

function newBadge(labelKey) {
  const label = t(labelKey || "newItem");
  return `<span class="new-badge" role="img" aria-label="${escapeHTML(label)}" title="${escapeHTML(label)}">
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <polygon points="${_burstPoints}" fill="var(--clr-yellow)" stroke="var(--clr-ink)" stroke-width="5" stroke-linejoin="round"></polygon>
      <text x="50" y="53" text-anchor="middle" dominant-baseline="central" font-family="'Baumans', 'Baumans', sans-serif" font-weight="900" font-size="54" fill="var(--clr-ink)">!</text>
    </svg>
  </span>`;
}

const EMULATED_FULLSCREEN_CHANGE = "emulatedfullscreenchange";

function fullscreenActive(el) {
  return el.classList.contains("emulated-fullscreen");
}

function setFullscreen(el, active) {
  el.classList.toggle("emulated-fullscreen", active);
  document.body.classList.toggle("emulated-fullscreen-open", active);
  document.dispatchEvent(new Event(EMULATED_FULLSCREEN_CHANGE));
}

function toggleFullscreen(el) {
  setFullscreen(el, !fullscreenActive(el));
}

// Views may rerender without hashchange, so each call removes old listeners.
let _fsCleanup = null;

function setupFullscreenButton(btn, el) {
  _fsCleanup?.();
  _fsCleanup = null;

  if (!btn) return;

  const isIcon = btn.classList.contains("fullscreen-icon");

  const update = () => {
    const active = fullscreenActive(el);
    if (isIcon) {
      btn.innerHTML = active ? FS_EXIT : FS_ENTER;
      btn.setAttribute("aria-label", active ? t("exitFullscreen") : t("fullscreen"));
    } else {
      btn.textContent = active ? t("exitFullscreen") : t("fullscreen");
    }
  };
  update();

  const onClick = (event) => {
    event.stopPropagation();
    toggleFullscreen(el);
  };
  const onKeydown = (event) => {
    if (event.key === "Escape" && fullscreenActive(el)) toggleFullscreen(el);
  };
  btn.addEventListener("click", onClick);
  document.addEventListener("keydown", onKeydown);
  document.addEventListener(EMULATED_FULLSCREEN_CHANGE, update);

  _fsCleanup = () => {
    btn.removeEventListener("click", onClick);
    document.removeEventListener("keydown", onKeydown);
    document.removeEventListener(EMULATED_FULLSCREEN_CHANGE, update);
  };
}

const $app = document.getElementById("app");

function parseHash() {
  const hash = location.hash.replace(/^#\/?/, "");
  return hash.split("/").filter((s) => s.length > 0).map(decodeURIComponent);
}

async function render() {
  const route = parseHash();
  document.documentElement.classList.remove("detail-route");
  const fullscreenEligible =
    (route[0] === "comics" && route[3] === "read") ||
    (route[0] === "arts" && route.length === 2);
  if (!fullscreenEligible) {
    if (fullscreenActive($app)) setFullscreen($app, false);
    _fsCleanup?.();
    _fsCleanup = null;
  }
  const $langToggle = document.getElementById("lang-toggle");
  if ($langToggle) {
    const isDetail =
      (route[0] === "comics" && route.length >= 3) ||
      (route[0] === "arts" && route.length >= 2) ||
      (route[0] === "characters" && route.length >= 2);
    $langToggle.style.display = isDetail ? "none" : "";
  }
  renderLangToggle();

  try {
    if (route.length === 0) return await renderLanding();
    if (route[0] === "comics" && route.length <= 2) return await renderComicsGrid(siteLang);
    if (route[0] === "comics" && route.length === 3) return await renderComicDetail(route[1], route[2]);
    if (route[0] === "comics" && route[3] === "read") {
      return await renderReader(route[1], route[2], Number(route[4]), Number(route[5]));
    }
    if (route[0] === "arts" && route.length === 1) return await renderArtsGrid();
    if (route[0] === "arts" && route.length === 2) return await renderArtDetail(route[1]);
    if (route[0] === "characters" && route.length === 1) return await renderCharactersGrid();
    if (route[0] === "characters" && route.length === 2) return await renderCharacterDetail(route[1]);
  } catch (err) {
    console.error(err);
    $app.innerHTML = `<div class="view"><p class="placeholder">${escapeHTML(t("error"))}</p></div>`;
    return;
  }

  navigate("/");
}

window.addEventListener("hashchange", render);

function landingShapes() {
  return `
    <div class="landing-shapes">
      <div class="shape shape-square shape-yellow-bar"></div>
      <div class="shape shape-square shape-red-diamond shape-diamond"></div>
      <div class="shape shape-circle shape-blue-circle"></div>
      <div class="shape shape-square shape-red-bar"></div>
    </div>`;
}

async function renderLanding() {
  document.title = "Hardgrizz Comics";
  $app.innerHTML = `
    <div class="view landing">
      ${landingShapes()}
      <div class="landing-content">
        <h1 class="landing-title">${escapeHTML(t("welcomeTitle"))}</h1>
        <p class="landing-text">${escapeHTML(t("welcomeText"))}</p>
        <div class="landing-buttons">
          <button class="btn btn-red" data-nav="/comics">${escapeHTML(t("comics"))}</button>
          <button class="btn btn-blue" data-nav="/arts">${escapeHTML(t("arts"))}</button>
          <button class="btn btn-yellow" data-nav="/characters">${escapeHTML(t("charactersTab"))}</button>
        </div>
      </div>
    </div>`;
  bindNav();

  try {
    const [comics, arts, characters] = await Promise.all([
      fetchJSON(`/api/comics/${encodeURIComponent(siteLang)}?uiLang=${encodeURIComponent(siteLang)}`).catch(() => []),
      fetchJSON("/api/arts").catch(() => []),
      fetchJSON("/api/characters").catch(() => []),
    ]);
    if (location.hash.replace(/^#\/?/, "") !== "") return;
    const anyComic = comics.some((c) => comicHasUnread(siteLang, c.name, c.pages, c.pageFiles));
    const anyArt = arts.some((a) => !isArtVisited(a.file));
    const anyCharacter = characters.some((c) => !isCharacterVisited(c.name));
    const $comicsBtn = $app.querySelector('[data-nav="/comics"]');
    const $artsBtn = $app.querySelector('[data-nav="/arts"]');
    const $charsBtn = $app.querySelector('[data-nav="/characters"]');
    if (anyComic && $comicsBtn) $comicsBtn.insertAdjacentHTML("beforeend", newBadge("newComics"));
    if (anyArt && $artsBtn) $artsBtn.insertAdjacentHTML("beforeend", newBadge("newArts"));
    if (anyCharacter && $charsBtn) $charsBtn.insertAdjacentHTML("beforeend", newBadge("newCharacters"));
  } catch { /* best effort */ }
}

async function renderComicsGrid(lang) {
  document.title = `${t("comics")} — Hardgrizz Comics`;
  $app.innerHTML = `
    <div class="view">
      <div class="container">
        <div class="section-header">
          <h2 class="section-title">${escapeHTML(t("comics"))}</h2>
          <button class="back-link" data-nav="/">← ${escapeHTML(t("home"))}</button>
        </div>
        <div class="grid" id="comics-grid">
          <p class="placeholder">${escapeHTML(t("loading"))}</p>
        </div>
      </div>
    </div>`;
  bindNav();

  const comics = await fetchJSON(`/api/comics/${encodeURIComponent(lang)}?uiLang=${encodeURIComponent(siteLang)}`);
  const $grid = document.getElementById("comics-grid");

  if (comics.length === 0) {
    $grid.innerHTML = `<p class="placeholder">${escapeHTML(t("noComics"))}</p>`;
    return;
  }

  $grid.innerHTML = comics.map((c) => {
    const progress = getProgress(lang, c.name);
    const unread = comicHasUnread(lang, c.name, c.pages, c.pageFiles);
    const fraction = progressFraction(progress, c.pages, c.pageFiles);
    return `
    <button class="card" data-nav="/comics/${encPath(lang, c.name)}">
      ${unread ? newBadge("newItem") : ""}
      <div class="card-accent"></div>
      <img class="card-cover" src="${escapeHTML(c.cover)}" alt="${escapeHTML(c.title)}" loading="lazy">
      <div class="card-title">${escapeHTML(c.title)}</div>
      ${progress ? `<div class="card-progress"><div class="card-progress-fill" style="width:${Math.round(fraction * 100)}%"></div></div>` : ""}
    </button>`;
  }).join("");
  bindNav();
}

async function renderComicDetail(lang, name) {
  const comic = await fetchJSON(`/api/comics/${encPath(lang, name)}?uiLang=${encodeURIComponent(siteLang)}`);
  document.title = `${comic.title} — Hardgrizz Comics`;

  const carouselImages = [comic.cover, ...comic.teaser.filter((u) => u !== comic.cover)];
  const progress = getProgress(lang, name);
  const pageFiles = comicPageFiles(comic);
  const totalPages = pageFiles.length;
  const unread = comicHasUnread(lang, name, totalPages, pageFiles);
  const fraction = progressFraction(progress, totalPages, pageFiles);
  const continueAt = progress ? progressPosition(progress, comic) : null;

  $app.innerHTML = `
    <div class="view comic-detail">
      <div class="container">
        <div class="section-header">
          <button class="back-link" data-nav="/comics">← ${escapeHTML(t("backToComics"))}</button>
        </div>

        <div class="comic-top">
          <div class="carousel" id="carousel">
            <div class="carousel-track">
              <img id="carousel-img" src="${escapeHTML(carouselImages[0])}" alt="${escapeHTML(comic.title)}">
            </div>
            ${carouselImages.length > 1 ? `
              <button class="carousel-nav carousel-prev" aria-label="${escapeHTML(t("prev"))}">‹</button>
              <button class="carousel-nav carousel-next" aria-label="${escapeHTML(t("next"))}">›</button>
              <div class="carousel-dots">
                ${carouselImages.map((_, i) => `<span class="carousel-dot${i === 0 ? " active" : ""}" data-dot="${i}"></span>`).join("")}
              </div>` : ""}
          </div>

          <div class="comic-info">
            <h1 class="comic-title">${escapeHTML(comic.title)}${unread ? newBadge("newPages") : ""}</h1>
            ${comic.description ? `<p class="comic-description">${escapeHTML(comic.description)}</p>` : ""}

            ${progress ? `
              <div class="progress-bar"><div class="progress-fill" style="width:${Math.round(fraction * 100)}%"></div></div>
            ` : ""}

            <div class="comic-actions">
              <button class="btn btn-red" id="read-from-start">${escapeHTML(t("readFromStart"))}</button>
              ${progress ? `<button class="btn btn-yellow" id="continue-reading">${escapeHTML(t("continueReading"))} — ${Math.round(fraction * 100)}%</button>` : ""}
            </div>

            ${comic.chapters.length > 1 ? `
              <span class="chapters-label">${escapeHTML(t("chapters"))}</span>
              <div class="chapters-list">
                ${comic.chapters.map((ch, i) => `
                  <button class="chapter-btn" data-chapter="${i}">${escapeHTML(ch.name)}</button>
                `).join("")}
              </div>` : ""}
          </div>
        </div>

        ${comic.characters.length > 0 ? `
          <div class="characters">
            <span class="characters-label">${escapeHTML(t("characters"))}</span>
            <div class="characters-list">
              ${comic.characters.map((ch) => `
                <div class="character-card">
                  ${ch.link
                    ? `<button class="character-name character-link" data-nav="/characters/${encodeURIComponent(ch.link)}">${escapeHTML(ch.name)}</button>`
                    : `<div class="character-name">${escapeHTML(ch.name)}</div>`}
                  ${ch.about ? `<div class="character-about">${escapeHTML(ch.about)}</div>` : ""}
                </div>
              `).join("")}
            </div>
          </div>` : ""}
      </div>
    </div>`;
  bindNav();

  let carouselIndex = 0;
  const $carouselImg = document.getElementById("carousel-img");
  function showCarousel(i) {
    carouselIndex = (i + carouselImages.length) % carouselImages.length;
    $carouselImg.src = carouselImages[carouselIndex];
    document.querySelectorAll(".carousel-dot").forEach((d, di) => d.classList.toggle("active", di === carouselIndex));
  }
  document.querySelector(".carousel-prev")?.addEventListener("click", () => showCarousel(carouselIndex - 1));
  document.querySelector(".carousel-next")?.addEventListener("click", () => showCarousel(carouselIndex + 1));
  document.querySelectorAll(".carousel-dot").forEach((d) => {
    d.addEventListener("click", () => showCarousel(Number(d.dataset.dot)));
  });

  if (carouselImages.length > 1) {
    let carouselTouchX = 0, carouselTouchY = 0;
    const $carousel = document.getElementById("carousel");
    $carousel.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) return;
      carouselTouchX = e.touches[0].clientX;
      carouselTouchY = e.touches[0].clientY;
    }, { passive: true });
    $carousel.addEventListener("touchend", (e) => {
      if (e.changedTouches.length !== 1) return;
      const dx = e.changedTouches[0].clientX - carouselTouchX;
      const dy = e.changedTouches[0].clientY - carouselTouchY;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
      if (dx < 0) showCarousel(carouselIndex + 1); else showCarousel(carouselIndex - 1);
    }, { passive: true });
  }

  document.getElementById("read-from-start").addEventListener("click", () => {
    navigate(`/comics/${encPath(lang, name)}/read/0/0`);
  });
  document.getElementById("continue-reading")?.addEventListener("click", () => {
    navigate(`/comics/${encPath(lang, name)}/read/${continueAt.chapterIdx}/${continueAt.pageIdx}`);
  });
  document.querySelectorAll("[data-chapter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigate(`/comics/${encPath(lang, name)}/read/${btn.dataset.chapter}/0`);
    });
  });
}

const PRELOAD_AHEAD = 3;
const PRELOAD_MAX = 10;
const _preloaded = new Map();

function preloadUrl(url) {
  if (!url || _preloaded.has(url)) return;
  const img = new Image();
  img.src = url;
  _preloaded.set(url, img);
  while (_preloaded.size > PRELOAD_MAX) {
    _preloaded.delete(_preloaded.keys().next().value);
  }
}

function preloadAround(comic, chapterIdx, pageIdx) {
  const flat = [];
  comic.chapters.forEach((ch, ci) =>
    ch.pages.forEach((p, pi) => flat.push({ ci, pi, url: p.url })));
  const cur = flat.findIndex((e) => e.ci === chapterIdx && e.pi === pageIdx);
  if (cur === -1) return;
  for (let i = 1; i <= PRELOAD_AHEAD; i++) preloadUrl(flat[cur + i]?.url);
  preloadUrl(flat[cur - 1]?.url);
}

async function renderReader(lang, name, chapterIdx, pageIdx) {
  const comic = await fetchJSON(`/api/comics/${encPath(lang, name)}?uiLang=${encodeURIComponent(siteLang)}`);
  const chapter = comic.chapters[chapterIdx];
  if (!chapter) return navigate(`/comics/${encPath(lang, name)}`);

  pageIdx = Math.max(0, Math.min(pageIdx || 0, chapter.pages.length - 1));
  const page = chapter.pages[pageIdx];
  document.title = `${comic.title} — ${t("page")} ${pageIdx + 1}`;

  const atFirstChapter = chapterIdx === 0;
  const atLastChapter = chapterIdx === comic.chapters.length - 1;
  const atFirstPage = pageIdx === 0;
  const atLastPage = pageIdx === chapter.pages.length - 1;

  const prevDisabled = atFirstPage && atFirstChapter;
  const nextDisabled = atLastPage && atLastChapter;

  $app.innerHTML = `
    <div class="view reader">
      <div class="reader-header">
        <div class="reader-header-top">
          <button class="back-link" data-nav="/comics/${encPath(lang, name)}">← ${escapeHTML(t("backToComic"))}</button>
          <div class="reader-titles">
            <div class="reader-comic-title">${escapeHTML(comic.title)}</div>
            ${comic.chapters.length > 1 ? `<div class="reader-chapter-title">${escapeHTML(chapter.name)}</div>` : ""}
          </div>
        </div>
      </div>

      <div class="reader-viewport" id="reader-viewport">
        <button class="reader-nav reader-prev" id="reader-prev" aria-label="${escapeHTML(t("prev"))}" ${prevDisabled ? "disabled" : ""}>‹</button>
        <img id="reader-image" src="${escapeHTML(page.url)}" alt="${escapeHTML(page.file)}">
        <button class="reader-nav reader-next" id="reader-next" aria-label="${escapeHTML(t("next"))}" ${nextDisabled ? "disabled" : ""}>›</button>
        <button class="fullscreen-icon" id="reader-fullscreen" aria-label="${escapeHTML(t("fullscreen"))}"></button>
      </div>

      <div class="reader-footer">
        <div class="reader-page-jump">
          <input id="reader-page-input" type="number" min="1" max="${chapter.pages.length}" value="${pageIdx + 1}" inputmode="numeric">
          <span>/ ${chapter.pages.length}</span>
        </div>
        <div class="reader-meta">
          ${page.comment ? `<p class="reader-comment">${escapeHTML(page.comment)}</p>` : ""}
          ${page.date ? `<p class="reader-date">${escapeHTML(t("published"))}: ${escapeHTML(page.date)}</p>` : ""}
        </div>
      </div>
    </div>`;
  bindNav();

  function go(nextChapterIdx, nextPageIdx) {
    navigate(`/comics/${encPath(lang, name)}/read/${nextChapterIdx}/${nextPageIdx}`);
  }

  function goPrev() {
    if (pageIdx > 0) return go(chapterIdx, pageIdx - 1);
    if (chapterIdx > 0) {
      const prevChapter = comic.chapters[chapterIdx - 1];
      return go(chapterIdx - 1, prevChapter.pages.length - 1);
    }
  }

  function goNext() {
    if (pageIdx < chapter.pages.length - 1) return go(chapterIdx, pageIdx + 1);
    if (chapterIdx < comic.chapters.length - 1) return go(chapterIdx + 1, 0);
  }

  document.getElementById("reader-prev").addEventListener("click", goPrev);
  document.getElementById("reader-next").addEventListener("click", goNext);
  setupFullscreenButton(document.getElementById("reader-fullscreen"), $app);
  saveProgress(lang, name, chapterIdx, pageIdx, comic);
  preloadAround(comic, chapterIdx, pageIdx);

  const $input = document.getElementById("reader-page-input");
  function commitPageInput() {
    const n = parseInt($input.value, 10);
    if (Number.isNaN(n)) { $input.value = pageIdx + 1; return; }
    go(chapterIdx, Math.max(0, Math.min(n - 1, chapter.pages.length - 1)));
  }
  $input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { commitPageInput(); $input.blur(); }
  });
  $input.addEventListener("blur", commitPageInput);
  $input.addEventListener("focus", () => $input.select());

  function onKeydown(e) {
    if (e.target.tagName === "INPUT") return;
    if (e.key === "ArrowLeft") goPrev();
    if (e.key === "ArrowRight") goNext();
    if (e.key === "f" || e.key === "F") toggleFullscreen($app);
  }
  document.addEventListener("keydown", onKeydown);

  let touchStartX = 0, touchStartY = 0;
  const $viewport = document.getElementById("reader-viewport");

  $viewport.addEventListener("click", (e) => {
    if (e.target.closest("button, input, a")) return;
    const rect = $viewport.getBoundingClientRect();
    const xRatio = (e.clientX - rect.left) / rect.width;
    if (xRatio < 0.5) goPrev(); else goNext();
  });

  $viewport.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  $viewport.addEventListener("touchend", (e) => {
    if (e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) goNext(); else goPrev();
  }, { passive: true });

  window.addEventListener("hashchange", () => document.removeEventListener("keydown", onKeydown), { once: true });
}

async function renderArtsGrid() {
  document.title = `${t("arts")} — Hardgrizz Comics`;
  $app.innerHTML = `
    <div class="view">
      <div class="container">
        <div class="section-header">
          <h2 class="section-title">${escapeHTML(t("arts"))}</h2>
          <button class="back-link" data-nav="/">← ${escapeHTML(t("home"))}</button>
        </div>
        <div class="grid" id="arts-grid">
          <p class="placeholder">${escapeHTML(t("loading"))}</p>
        </div>
      </div>
    </div>`;
  bindNav();

  const arts = await fetchJSON("/api/arts");
  const $grid = document.getElementById("arts-grid");

  if (arts.length === 0) {
    $grid.innerHTML = `<p class="placeholder">${escapeHTML(t("noArts"))}</p>`;
    return;
  }

  $grid.innerHTML = arts.map((a) => `
    <button class="card" data-nav="/arts/${encodeURIComponent(a.file)}">
      ${isArtVisited(a.file) ? "" : newBadge("newItem")}
      <div class="card-accent"></div>
      <img class="card-cover" src="${escapeHTML(a.url)}" alt="${escapeHTML(a.title)}" loading="lazy">
      <div class="card-title">${escapeHTML(a.title)}</div>
    </button>`).join("");
  bindNav();
}

async function renderArtDetail(file) {
  const arts = await fetchJSON("/api/arts");
  const art = arts.find((a) => a.file === file);
  if (!art) return navigate("/arts");

  markArtVisited(file);
  document.title = `${art.title} — Hardgrizz Comics`;
  $app.innerHTML = `
    <div class="view">
      <div class="container">
        <div class="section-header">
          <button class="back-link" data-nav="/arts">← ${escapeHTML(t("backToArts"))}</button>
        </div>
      </div>
      <div class="art-detail">
        <div class="art-viewport" id="art-viewport">
          <img id="art-image" src="${escapeHTML(art.url)}" alt="${escapeHTML(art.title)}">
          <button class="fullscreen-icon" id="art-fullscreen" aria-label="${escapeHTML(t("fullscreen"))}"></button>
        </div>
        <h1 class="art-detail-title">${escapeHTML(art.title)}</h1>
        ${art.description ? `<p class="art-detail-description">${escapeHTML(art.description)}</p>` : ""}
      </div>
    </div>`;
  bindNav();
  setupFullscreenButton(document.getElementById("art-fullscreen"), $app);
}

async function renderCharactersGrid() {
  document.title = `${t("charactersTab")} — Hardgrizz Comics`;
  $app.innerHTML = `
    <div class="view">
      <div class="container">
        <div class="section-header">
          <h2 class="section-title">${escapeHTML(t("charactersTab"))}</h2>
          <button class="back-link" data-nav="/">← ${escapeHTML(t("home"))}</button>
        </div>
        <div class="grid" id="characters-grid">
          <p class="placeholder">${escapeHTML(t("loading"))}</p>
        </div>
      </div>
    </div>`;
  bindNav();

  const chars = await fetchJSON("/api/characters");
  const $grid = document.getElementById("characters-grid");

  if (chars.length === 0) {
    $grid.innerHTML = `<p class="placeholder">${escapeHTML(t("noCharacters"))}</p>`;
    return;
  }

  $grid.innerHTML = chars.map((c) => `
    <button class="card" data-nav="/characters/${encodeURIComponent(c.name)}">
      ${isCharacterVisited(c.name) ? "" : newBadge("newItem")}
      <div class="card-accent"></div>
      <img class="card-cover" src="${escapeHTML(c.cover)}" alt="${escapeHTML(c.name)}" loading="lazy">
      <div class="card-title">${escapeHTML(c.name)}</div>
    </button>`).join("");
  bindNav();
}

async function renderCharacterDetail(name) {
  const chars = await fetchJSON(`/api/characters?uiLang=${encodeURIComponent(siteLang)}`);
  const character = chars.find((c) => c.name === name);
  if (!character) return navigate("/characters");

  markCharacterVisited(name);
  document.title = `${character.name} — Hardgrizz Comics`;
  const relatedComics = character.comics ?? [];
  $app.innerHTML = `
    <div class="view">
      <div class="container">
        <div class="section-header">
          <h2 class="section-title">${escapeHTML(character.name)}</h2>
          <button class="back-link" data-nav="/characters">← ${escapeHTML(t("backToCharacters"))}</button>
        </div>
        <div class="character-gallery">
          ${character.images.map((img) => `
            <figure class="character-figure">
              <img class="character-figure-img" src="${escapeHTML(img.url)}" alt="${escapeHTML(character.name)}" loading="lazy">
              ${img.description ? `<figcaption class="character-figure-caption">${escapeHTML(img.description)}</figcaption>` : ""}
            </figure>
          `).join("")}
        </div>
        ${relatedComics.length > 0 ? `
          <div class="related-comics">
            <span class="related-comics-label">${escapeHTML(t("relatedComics"))}</span>
            <div class="related-comics-list">
              ${relatedComics.map((rc) => `
                <button class="btn btn-blue related-comic-btn" data-nav="/comics/${encPath(rc.lang, rc.name)}">${escapeHTML(rc.title)}</button>
              `).join("")}
            </div>
          </div>` : ""}
      </div>
    </div>`;
  bindNav();
}

function bindNav() {
  $app.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => navigate(el.dataset.nav));
  });
}

document.documentElement.lang = siteLang;
localStorage.setItem("siteLang", siteLang);
syncUrlLang();
renderLangToggle();
renderDisclaimer();
renderAgeGate();
render();
