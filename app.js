(function () {
  "use strict";

  const app = document.getElementById("app");

  const STORAGE_KEY = "madpix_selected_photos_v1";

  const state = {
    galleries: [],
    selectedGalleryId: null,
    photos: [],
    selectedPhotoIds: new Set(),
    lightboxPhotoId: null,
    slideshowTimer: null,
    slideshowRunning: false
  };

  function show(message) {
    app.innerHTML = `<div style="padding:20px;">${escapeHtml(message)}</div>`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatMoney(value) {
    const amount = Number(value || 0);
    return `NZ$${amount.toFixed(2)}`;
  }

  function cleanPhotoLabel(photo) {
    const raw =
      photo.title ||
      photo.name ||
      photo.file_name ||
      photo.filename ||
      photo.image_url ||
      "";

    const lastPart = String(raw).split("/").pop() || "";
    return lastPart
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]?result$/i, "")
      .trim();
  }

  function getSupabaseClient() {
    if (window.__madpixPublicSupabase) {
      return window.__madpixPublicSupabase;
    }

    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("Supabase library not loaded");
    }

    if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
      throw new Error("Missing Supabase config");
    }

    window.__madpixPublicSupabase = window.supabase.createClient(
      window.SUPABASE_URL,
      window.SUPABASE_ANON_KEY
    );

    return window.__madpixPublicSupabase;
  }

  function loadSavedSelection() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return new Set();

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Set();

      return new Set(parsed.map((item) => String(item)));
    } catch (error) {
      console.error("Failed to load saved selection", error);
      return new Set();
    }
  }

  function persistSelection() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(Array.from(state.selectedPhotoIds))
      );
    } catch (error) {
      console.error("Failed to save selection", error);
    }
  }

  async function loadGalleries() {
    const sb = getSupabaseClient();

    const { data, error } = await sb
      .from("pe_galleries")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    return Array.isArray(data) ? data : [];
  }

  async function loadPhotos(galleryId) {
    const sb = getSupabaseClient();

    const { data, error } = await sb
      .from("pe_photos")
      .select("*")
      .eq("gallery_id", galleryId)
      .eq("is_live", true)
      .order("sort_order", { ascending: true });

    if (error) throw error;

    return Array.isArray(data) ? data : [];
  }

  function getSelectedGallery() {
    return state.galleries.find((gallery) => String(gallery.id) === String(state.selectedGalleryId)) || null;
  }

  function getSelectedPhotos() {
    return state.photos.filter((photo) => state.selectedPhotoIds.has(String(photo.id)));
  }

  function getCartTotal() {
    return getSelectedPhotos().reduce((sum, photo) => sum + Number(photo.price || 0), 0);
  }

  function getPhotoIndexById(photoId) {
    return state.photos.findIndex((photo) => String(photo.id) === String(photoId));
  }

  function getCurrentLightboxPhoto() {
    return state.photos.find((photo) => String(photo.id) === String(state.lightboxPhotoId)) || null;
  }

  function togglePhoto(photoId) {
    const key = String(photoId);

    if (state.selectedPhotoIds.has(key)) {
      state.selectedPhotoIds.delete(key);
    } else {
      state.selectedPhotoIds.add(key);
    }

    persistSelection();
    renderPage();
  }

  function clearSelectionForCurrentGallery() {
    state.photos.forEach((photo) => {
      state.selectedPhotoIds.delete(String(photo.id));
    });
    persistSelection();
  }

  async function selectGallery(galleryId) {
    stopSlideshow();
    state.lightboxPhotoId = null;
    state.selectedGalleryId = galleryId;
    await refreshSelectedGallery();
  }

  function openLightbox(photoId) {
    state.lightboxPhotoId = String(photoId);
    renderPage();
  }

  function closeLightbox() {
    stopSlideshow();
    state.lightboxPhotoId = null;
    renderPage();
  }

  function showPreviousPhoto() {
    const currentIndex = getPhotoIndexById(state.lightboxPhotoId);
    if (currentIndex === -1 || state.photos.length === 0) return;

    const nextIndex = currentIndex === 0 ? state.photos.length - 1 : currentIndex - 1;
    state.lightboxPhotoId = String(state.photos[nextIndex].id);
    renderPage();
  }

  function showNextPhoto() {
    const currentIndex = getPhotoIndexById(state.lightboxPhotoId);
    if (currentIndex === -1 || state.photos.length === 0) return;

    const nextIndex = currentIndex === state.photos.length - 1 ? 0 : currentIndex + 1;
    state.lightboxPhotoId = String(state.photos[nextIndex].id);
    renderPage();
  }

  function stopSlideshow() {
    if (state.slideshowTimer) {
      clearInterval(state.slideshowTimer);
      state.slideshowTimer = null;
    }
    state.slideshowRunning = false;
  }

  function startSlideshow() {
    stopSlideshow();
    state.slideshowRunning = true;
    state.slideshowTimer = setInterval(() => {
      const currentIndex = getPhotoIndexById(state.lightboxPhotoId);
      if (currentIndex === -1 || state.photos.length === 0) return;

      const nextIndex = currentIndex === state.photos.length - 1 ? 0 : currentIndex + 1;
      state.lightboxPhotoId = String(state.photos[nextIndex].id);
      renderPage();
    }, 3000);
  }

  function toggleSlideshow() {
    if (state.slideshowRunning) {
      stopSlideshow();
    } else {
      startSlideshow();
    }
    renderPage();
  }

  function renderGallerySelector() {
    return `
      <div style="margin-bottom:18px;">
        <div style="font-size:15px;font-weight:700;margin-bottom:10px;">Galleries</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          ${state.galleries
            .map((gallery) => {
              const isSelected = String(gallery.id) === String(state.selectedGalleryId);

              return `
                <button
                  type="button"
                  class="gallery-select-btn"
                  data-gallery-id="${escapeHtml(gallery.id)}"
                  style="
                    padding:8px 12px;
                    border:1px solid ${isSelected ? "#111827" : "#d1d5db"};
                    background:${isSelected ? "#111827" : "#ffffff"};
                    color:${isSelected ? "#ffffff" : "#111827"};
                    border-radius:999px;
                    cursor:pointer;
                    font-size:13px;
                    font-weight:600;
                  "
                >
                  ${escapeHtml(gallery.title || gallery.name || "Gallery")}
                </button>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  function renderStickyCheckoutBar() {
    const selectedPhotos = getSelectedPhotos();
    const count = selectedPhotos.length;
    const total = getCartTotal();
    const disabled = count === 0;

    return `
      <div
        style="
          position:sticky;
          top:0;
          z-index:20;
          background:rgba(255,255,255,0.96);
          backdrop-filter:blur(6px);
          border:1px solid #e5e7eb;
          border-radius:12px;
          padding:10px 14px;
          margin-bottom:18px;
        "
      >
        <div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:center;">
          <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;font-size:13px;color:#374151;">
            <div><strong>${count}</strong> selected</div>
            <div><strong>${formatMoney(total)}</strong></div>
          </div>

          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button
              type="button"
              id="clearSelectionBtn"
              ${disabled ? "disabled" : ""}
              style="
                padding:8px 12px;
                border:1px solid #d1d5db;
                background:#ffffff;
                color:#111827;
                border-radius:10px;
                cursor:${disabled ? "not-allowed" : "pointer"};
                opacity:${disabled ? "0.5" : "1"};
                font-size:13px;
                font-weight:600;
              "
            >
              Clear
            </button>

            <button
              type="button"
              id="goToCheckoutBtn"
              ${disabled ? "disabled" : ""}
              style="
                padding:8px 14px;
                border:1px solid #111827;
                background:#111827;
                color:#ffffff;
                border-radius:10px;
                cursor:${disabled ? "not-allowed" : "pointer"};
                opacity:${disabled ? "0.5" : "1"};
                font-size:13px;
                font-weight:700;
              "
            >
              Checkout
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function renderPhotos() {
    if (!state.photos.length) {
      return `<div>No live photos in this gallery</div>`;
    }

    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px;">
        ${state.photos
          .map((photo) => {
            const label = cleanPhotoLabel(photo);
            const isSelected = state.selectedPhotoIds.has(String(photo.id));
            const price = Number(photo.price || 0);
            const canBuy = price > 0;

            return `
              <div style="border:1px solid #e5e7eb;border-radius:12px;padding:12px;background:#ffffff;">
                <button
                  type="button"
                  class="photo-open-btn"
                  data-photo-id="${escapeHtml(photo.id)}"
                  style="display:block;width:100%;padding:0;border:none;background:transparent;cursor:pointer;text-align:left;"
                >
                  <img
                    src="${escapeHtml(photo.image_url)}"
                    alt="${escapeHtml(label)}"
                    style="width:100%;height:260px;object-fit:cover;display:block;border-radius:8px;"
                  >
                </button>

                <div style="margin-top:10px;font-size:15px;font-weight:700;line-height:1.35;color:#111827;">
                  ${escapeHtml(label)}
                </div>

                <div style="margin-top:4px;font-size:13px;font-weight:600;color:#6b7280;">
                  ${canBuy ? formatMoney(price) : "Price unavailable"}
                </div>

                <div style="margin-top:10px;display:flex;gap:8px;">
                  <button
                    type="button"
                    class="photo-open-btn"
                    data-photo-id="${escapeHtml(photo.id)}"
                    style="
                      flex:1;
                      padding:9px 10px;
                      border:1px solid #d1d5db;
                      background:#ffffff;
                      color:#111827;
                      border-radius:10px;
                      cursor:pointer;
                      font-size:13px;
                      font-weight:600;
                    "
                  >
                    View
                  </button>

                  <button
                    type="button"
                    class="photo-toggle-btn"
                    data-photo-id="${escapeHtml(photo.id)}"
                    ${canBuy ? "" : "disabled"}
                    style="
                      flex:1;
                      padding:9px 10px;
                      border:1px solid ${isSelected ? "#111827" : "#d1d5db"};
                      background:${isSelected ? "#111827" : "#ffffff"};
                      color:${isSelected ? "#ffffff" : "#111827"};
                      border-radius:10px;
                      cursor:${canBuy ? "pointer" : "not-allowed"};
                      opacity:${canBuy ? "1" : "0.5"};
                      font-size:13px;
                      font-weight:600;
                    "
                  >
                    ${isSelected ? "Selected" : "Select"}
                  </button>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function renderLightbox() {
    const photo = getCurrentLightboxPhoto();
    if (!photo) return "";

    const label = cleanPhotoLabel(photo);
    const currentIndex = getPhotoIndexById(photo.id);
    const totalCount = state.photos.length;

    return `
      <div
        id="lightboxOverlay"
        style="
          position:fixed;
          inset:0;
          background:rgba(0,0,0,0.88);
          display:flex;
          align-items:center;
          justify-content:center;
          z-index:1000;
          padding:20px;
        "
      >
        <div
          style="
            position:relative;
            width:min(1100px,100%);
            max-height:100%;
            overflow:auto;
            background:#111827;
            border-radius:16px;
            padding:18px;
          "
        >
          <button
            type="button"
            id="closeLightboxBtn"
            style="
              position:absolute;
              top:12px;
              right:12px;
              width:40px;
              height:40px;
              border:none;
              border-radius:999px;
              background:rgba(255,255,255,0.12);
              color:#ffffff;
              cursor:pointer;
              font-size:20px;
              font-weight:700;
            "
          >
            ×
          </button>

          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px;color:#ffffff;">
            <div>
              <div style="font-size:20px;font-weight:700;">${escapeHtml(label)}</div>
              <div style="margin-top:4px;font-size:13px;color:#d1d5db;">${currentIndex + 1} of ${totalCount}</div>
            </div>

            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button
                type="button"
                id="prevPhotoBtn"
                style="
                  padding:8px 12px;
                  border:1px solid rgba(255,255,255,0.18);
                  background:transparent;
                  color:#ffffff;
                  border-radius:10px;
                  cursor:pointer;
                  font-size:13px;
                  font-weight:600;
                "
              >
                Prev
              </button>

              <button
                type="button"
                id="toggleSlideshowBtn"
                style="
                  padding:8px 12px;
                  border:1px solid rgba(255,255,255,0.18);
                  background:transparent;
                  color:#ffffff;
                  border-radius:10px;
                  cursor:pointer;
                  font-size:13px;
                  font-weight:600;
                "
              >
                ${state.slideshowRunning ? "Stop 3s Auto" : "Start 3s Auto"}
              </button>

              <button
                type="button"
                id="nextPhotoBtn"
                style="
                  padding:8px 12px;
                  border:1px solid rgba(255,255,255,0.18);
                  background:transparent;
                  color:#ffffff;
                  border-radius:10px;
                  cursor:pointer;
                  font-size:13px;
                  font-weight:600;
                "
              >
                Next
              </button>
            </div>
          </div>

          <div style="display:flex;align-items:center;justify-content:center;">
            <img
              src="${escapeHtml(photo.image_url)}"
              alt="${escapeHtml(label)}"
              style="max-width:100%;max-height:75vh;object-fit:contain;display:block;border-radius:12px;background:#000000;"
            >
          </div>
        </div>
      </div>
    `;
  }

  function renderGalleryView() {
    const gallery = getSelectedGallery();

    if (!gallery) {
      return `<div style="padding:20px;">No gallery selected</div>`;
    }

    return `
      <div style="padding:20px;">
        ${renderGallerySelector()}

        <div style="margin-bottom:14px;">
          <h2 style="margin:0;font-size:26px;line-height:1.2;">${escapeHtml(gallery.title || gallery.name || "Gallery")}</h2>
        </div>

        ${renderStickyCheckoutBar()}
        ${renderPhotos()}
      </div>

      ${renderLightbox()}
    `;
  }

  function bindUi() {
    document.querySelectorAll(".gallery-select-btn").forEach((button) => {
      button.addEventListener("click", async function () {
        await selectGallery(this.getAttribute("data-gallery-id"));
      });
    });

    document.querySelectorAll(".photo-toggle-btn").forEach((button) => {
      button.addEventListener("click", function () {
        togglePhoto(this.getAttribute("data-photo-id"));
      });
    });

    document.querySelectorAll(".photo-open-btn").forEach((button) => {
      button.addEventListener("click", function () {
        openLightbox(this.getAttribute("data-photo-id"));
      });
    });

    const clearSelectionBtn = document.getElementById("clearSelectionBtn");
    if (clearSelectionBtn) {
      clearSelectionBtn.addEventListener("click", function () {
        clearSelectionForCurrentGallery();
        renderPage();
      });
    }

    const goToCheckoutBtn = document.getElementById("goToCheckoutBtn");
    if (goToCheckoutBtn) {
      goToCheckoutBtn.addEventListener("click", function () {
        window.location.href = "checkout.html";
      });
    }

    const closeLightboxBtn = document.getElementById("closeLightboxBtn");
    if (closeLightboxBtn) {
      closeLightboxBtn.addEventListener("click", function () {
        closeLightbox();
      });
    }

    const prevPhotoBtn = document.getElementById("prevPhotoBtn");
    if (prevPhotoBtn) {
      prevPhotoBtn.addEventListener("click", function () {
        showPreviousPhoto();
      });
    }

    const nextPhotoBtn = document.getElementById("nextPhotoBtn");
    if (nextPhotoBtn) {
      nextPhotoBtn.addEventListener("click", function () {
        showNextPhoto();
      });
    }

    const toggleSlideshowBtn = document.getElementById("toggleSlideshowBtn");
    if (toggleSlideshowBtn) {
      toggleSlideshowBtn.addEventListener("click", function () {
        toggleSlideshow();
      });
    }

    const lightboxOverlay = document.getElementById("lightboxOverlay");
    if (lightboxOverlay) {
      lightboxOverlay.addEventListener("click", function (event) {
        if (event.target === lightboxOverlay) {
          closeLightbox();
        }
      });
    }

    document.onkeydown = function (event) {
      if (!state.lightboxPhotoId) return;

      if (event.key === "Escape") {
        closeLightbox();
      } else if (event.key === "ArrowLeft") {
        showPreviousPhoto();
      } else if (event.key === "ArrowRight") {
        showNextPhoto();
      } else if (event.key === " ") {
        event.preventDefault();
        toggleSlideshow();
      }
    };
  }

  function renderPage() {
    app.innerHTML = renderGalleryView();
    bindUi();
  }

  async function refreshSelectedGallery() {
    try {
      show("Loading gallery...");
      state.photos = await loadPhotos(state.selectedGalleryId);
      renderPage();
    } catch (error) {
      console.error(error);
      show("Error loading gallery");
    }
  }

  async function init() {
    try {
      show("Loading galleries...");
      state.selectedPhotoIds = loadSavedSelection();
      state.galleries = await loadGalleries();

      if (!state.galleries.length) {
        show("No galleries found");
        return;
      }

      state.selectedGalleryId = state.galleries[0].id;
      state.photos = await loadPhotos(state.selectedGalleryId);
      renderPage();
    } catch (error) {
      console.error(error);
      show("Error loading gallery");
    }
  }

  init();
})();