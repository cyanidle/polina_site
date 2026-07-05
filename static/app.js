/**
 * Hardgrizz Comics — frontend
 *
 * Single-page app with a tiny hash router. No build step, no framework.
 * Server API: /api/comics/<lang>, /api/comics/<lang>/<name>, /api/arts.
 */

// ── i18n ─────────────────────────────────────────────────────

const STRINGS = {
  welcomeTitle: { ru: "Hardgrizz Comics", en: "Hardgrizz Comics", },
  welcomeText: { ru: "Комиксы и рисунки.", en: "Comics and art.", },
  comics: { ru: "Комиксы", en: "Comics", },
  arts: { ru: "Арты", en: "Arts", },
  pickLanguage: { ru: "Выберите язык", en: "Pick a language", },
  russian: { ru: "Русский", en: "Russian", },
  english: { ru: "English", en: "English", },
  readFromStart: { ru: "Читать с начала", en: "Read from the start", },
  chapters: { ru: "Главы", en: "Chapters", },
  characters: { ru: "Персонажи", en: "Characters", },
  back: { ru: "Назад", en: "Back", },
  backToComics: { ru: "К комиксам", en: "Back to comics", },
  backToArts: { ru: "К артам", en: "Back to arts", },
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
};

let siteLang = localStorage.getItem("siteLang") || "ru";

function t(key) {
  return STRINGS[key][siteLang] ?? STRINGS[key].ru ?? key;
}

function setSiteLang(lang) {
  siteLang = lang;
  localStorage.setItem("siteLang", lang);
  document.documentElement.lang = lang;
  renderLangToggle();
  render();
}

function renderLangToggle() {
  document.querySelectorAll("[data-lang-btn]").forEach((el) => {
    el.classList.toggle("active", el.dataset.langBtn === siteLang);
  });
}

document.getElementById("lang-toggle").addEventListener("click", () => {
  setSiteLang(siteLang === "ru" ? "en" : "ru");
});

// ── util ─────────────────────────────────────────────────────

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

// ── reading progress (localStorage) ───────────────────────────

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

function saveProgress(lang, name, chapterIdx, pageIdx, comic) {
  const totalPages = comic.chapters.reduce((n, c) => n + c.pages.length, 0);
  const pagesBefore = comic.chapters.slice(0, chapterIdx).reduce((n, c) => n + c.pages.length, 0);
  const fraction = totalPages > 0 ? (pagesBefore + pageIdx + 1) / totalPages : 0;

  const all = loadAllProgress();
  all[progressKey(lang, name)] = { chapterIdx, pageIdx, fraction, updatedAt: Date.now() };
  localStorage.setItem("readingProgress", JSON.stringify(all));
}

// ── fullscreen ───────────────────────────────────────────────

function fullscreenSupported() {
  return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
}

function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function toggleFullscreen(el) {
  if (fullscreenElement()) {
    Promise.resolve((document.exitFullscreen || document.webkitExitFullscreen)?.call(document)).catch(() => {});
  } else {
    Promise.resolve((el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)).catch(() => {});
  }
}

// Wires a button to toggle fullscreen on `el`. Hides the button entirely
// on browsers without Fullscreen API support (notably iOS Safari).
//
// Re-rendering a view (page turn, language switch) doesn't always go
// through `hashchange` — setSiteLang() calls render() directly — so we
// can't rely on that event alone to clean up. Instead each call tears
// down the previous call's listeners itself, keeping at most one set alive.
let _fsCleanup = null;

function setupFullscreenButton(btn, el) {
  _fsCleanup?.();
  _fsCleanup = null;

  if (!btn || !fullscreenSupported()) { btn?.classList.add("hidden"); return; }

  const update = () => {
    const active = fullscreenElement() === el;
    btn.textContent = active ? t("exitFullscreen") : t("fullscreen");
  };
  update();

  const onClick = () => toggleFullscreen(el);
  btn.addEventListener("click", onClick);
  document.addEventListener("fullscreenchange", update);
  document.addEventListener("webkitfullscreenchange", update);

  _fsCleanup = () => {
    btn.removeEventListener("click", onClick);
    document.removeEventListener("fullscreenchange", update);
    document.removeEventListener("webkitfullscreenchange", update);
  };
}

// ── router ───────────────────────────────────────────────────

const $app = document.getElementById("app");

function parseHash() {
  const hash = location.hash.replace(/^#\/?/, "");
  return hash.split("/").filter((s) => s.length > 0).map(decodeURIComponent);
}

async function render() {
  const route = parseHash();
  renderLangToggle();

  try {
    if (route.length === 0) return renderLanding();
    if (route[0] === "comics" && route.length === 1) return renderLangPicker();
    if (route[0] === "comics" && route.length === 2) return await renderComicsGrid(route[1]);
    if (route[0] === "comics" && route.length === 3) return await renderComicDetail(route[1], route[2]);
    if (route[0] === "comics" && route[3] === "read") {
      return await renderReader(route[1], route[2], Number(route[4]), Number(route[5]));
    }
    if (route[0] === "arts" && route.length === 1) return await renderArtsGrid();
    if (route[0] === "arts" && route.length === 2) return await renderArtDetail(route[1]);
  } catch (err) {
    console.error(err);
    $app.innerHTML = `<div class="view"><p class="placeholder">${escapeHTML(t("error"))}</p></div>`;
    return;
  }

  navigate("/");
}

window.addEventListener("hashchange", render);

// ── shapes (decorative) ─────────────────────────────────────

function landingShapes() {
  return `
    <div class="landing-shapes">
      <div class="shape shape-square shape-yellow-bar"></div>
      <div class="shape shape-square shape-red-diamond shape-diamond"></div>
      <div class="shape shape-circle shape-blue-circle"></div>
      <div class="shape shape-square shape-red-bar"></div>
    </div>`;
}

// ── landing ──────────────────────────────────────────────────

function renderLanding() {
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
        </div>
      </div>
    </div>`;
  bindNav();
}

// ── comics: language picker ──────────────────────────────────

function renderLangPicker() {
  document.title = `${t("comics")} — Hardgrizz Comics`;
  $app.innerHTML = `
    <div class="view lang-picker">
      <button class="btn btn-red" data-lang-pick="ru">${escapeHTML(t("russian"))}</button>
      <button class="btn btn-blue" data-lang-pick="en">${escapeHTML(t("english"))}</button>
    </div>`;

  $app.querySelectorAll("[data-lang-pick]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const lang = btn.dataset.langPick;
      setSiteLang(lang);
      navigate(`/comics/${lang}`);
    });
  });
}

// ── comics: grid ─────────────────────────────────────────────

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
    return `
    <button class="card" data-nav="/comics/${encPath(lang, c.name)}">
      <div class="card-accent"></div>
      <img class="card-cover" src="${escapeHTML(c.cover)}" alt="${escapeHTML(c.title)}" loading="lazy">
      <div class="card-title">${escapeHTML(c.title)}</div>
      ${progress ? `<div class="card-progress"><div class="card-progress-fill" style="width:${Math.round(progress.fraction * 100)}%"></div></div>` : ""}
    </button>`;
  }).join("");
  bindNav();
}

// ── comics: detail ───────────────────────────────────────────

async function renderComicDetail(lang, name) {
  const comic = await fetchJSON(`/api/comics/${encPath(lang, name)}?uiLang=${encodeURIComponent(siteLang)}`);
  document.title = `${comic.title} — Hardgrizz Comics`;

  const carouselImages = [comic.cover, ...comic.teaser.filter((u) => u !== comic.cover)];
  const progress = getProgress(lang, name);

  $app.innerHTML = `
    <div class="view comic-detail">
      <div class="container">
        <div class="section-header">
          <button class="back-link" data-nav="/comics/${encodeURIComponent(lang)}">← ${escapeHTML(t("backToComics"))}</button>
        </div>

        <div class="comic-top">
          <div class="carousel" id="carousel">
            <div class="carousel-track">
              <img id="carousel-img" src="${escapeHTML(carouselImages[0])}" alt="${escapeHTML(comic.title)}">
            </div>
            ${carouselImages.length > 1 ? `
              <button class="carousel-nav carousel-prev" aria-label="prev">‹</button>
              <button class="carousel-nav carousel-next" aria-label="next">›</button>
              <div class="carousel-dots">
                ${carouselImages.map((_, i) => `<span class="carousel-dot${i === 0 ? " active" : ""}" data-dot="${i}"></span>`).join("")}
              </div>` : ""}
          </div>

          <div class="comic-info">
            <h1 class="comic-title">${escapeHTML(comic.title)}</h1>
            ${comic.description ? `<p class="comic-description">${escapeHTML(comic.description)}</p>` : ""}

            ${progress ? `
              <div class="progress-bar"><div class="progress-fill" style="width:${Math.round(progress.fraction * 100)}%"></div></div>
            ` : ""}

            <div class="comic-actions">
              <button class="btn btn-red" id="read-from-start">${escapeHTML(t("readFromStart"))}</button>
              ${progress ? `<button class="btn btn-yellow" id="continue-reading">${escapeHTML(t("continueReading"))} — ${Math.round(progress.fraction * 100)}%</button>` : ""}
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
                  <div class="character-name">${escapeHTML(ch.name)}</div>
                  ${ch.about ? `<div class="character-about">${escapeHTML(ch.about)}</div>` : ""}
                </div>
              `).join("")}
            </div>
          </div>` : ""}
      </div>
    </div>`;
  bindNav();

  // carousel behaviour
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

  // read from start / continue / chapter selection
  document.getElementById("read-from-start").addEventListener("click", () => {
    navigate(`/comics/${encPath(lang, name)}/read/0/0`);
  });
  document.getElementById("continue-reading")?.addEventListener("click", () => {
    navigate(`/comics/${encPath(lang, name)}/read/${progress.chapterIdx}/${progress.pageIdx}`);
  });
  document.querySelectorAll("[data-chapter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigate(`/comics/${encPath(lang, name)}/read/${btn.dataset.chapter}/0`);
    });
  });
}

// ── comics: reader ───────────────────────────────────────────

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
        <button class="btn-ghost fullscreen-btn" id="reader-fullscreen">${escapeHTML(t("fullscreen"))}</button>
      </div>

      <div class="reader-viewport" id="reader-viewport">
        <button class="reader-nav reader-prev" id="reader-prev" ${prevDisabled ? "disabled" : ""}>‹</button>
        <img id="reader-image" src="${escapeHTML(page.url)}" alt="${escapeHTML(page.file)}">
        <button class="reader-nav reader-next" id="reader-next" ${nextDisabled ? "disabled" : ""}>›</button>
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

  // swipe support
  let touchStartX = 0, touchStartY = 0;
  const $viewport = document.getElementById("reader-viewport");
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

  // clean up the keydown listener when we navigate away
  window.addEventListener("hashchange", () => document.removeEventListener("keydown", onKeydown), { once: true });
}

// ── arts: grid ───────────────────────────────────────────────

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
      <div class="card-accent"></div>
      <img class="card-cover" src="${escapeHTML(a.url)}" alt="${escapeHTML(a.title)}" loading="lazy">
      <div class="card-title">${escapeHTML(a.title)}</div>
    </button>`).join("");
  bindNav();
}

// ── arts: detail ─────────────────────────────────────────────

async function renderArtDetail(file) {
  const arts = await fetchJSON("/api/arts");
  const art = arts.find((a) => a.file === file);
  if (!art) return navigate("/arts");

  document.title = `${art.title} — Hardgrizz Comics`;
  $app.innerHTML = `
    <div class="view">
      <div class="container">
        <div class="section-header">
          <button class="back-link" data-nav="/arts">← ${escapeHTML(t("backToArts"))}</button>
        </div>
      </div>
      <div class="art-detail">
        <img id="art-image" src="${escapeHTML(art.url)}" alt="${escapeHTML(art.title)}">
        <h1 class="art-detail-title">${escapeHTML(art.title)}</h1>
        ${art.description ? `<p class="art-detail-description">${escapeHTML(art.description)}</p>` : ""}
        <button class="btn btn-yellow" id="art-fullscreen">${escapeHTML(t("fullscreen"))}</button>
      </div>
    </div>`;
  bindNav();
  setupFullscreenButton(document.getElementById("art-fullscreen"), $app);
}

// ── nav delegation ───────────────────────────────────────────

function bindNav() {
  $app.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => navigate(el.dataset.nav));
  });
}

// ── go ────────────────────────────────────────────────────────

document.documentElement.lang = siteLang;
renderLangToggle();
render();
