// MadPix Admin - locked function base with hard-wired tables
// pe_galleries + pe_photos only

(function () {
  "use strict";

  const galleriesBtn = document.getElementById("showGalleriesBtn");
  const visitorsBtn = document.getElementById("showVisitorsBtn");
  const ordersBtn = document.getElementById("showOrdersBtn");
  const output = document.getElementById("adminGalleryList");

  const statVisits = document.getElementById("statVisits");
  const statPurchases = document.getElementById("statPurchases");
  const statRevenue = document.getElementById("statRevenue");

  function setOutput(html) {
    if (!output) {
      console.error("adminGalleryList not found");
      return;
    }
    output.innerHTML = html;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function showLoading(message) {
    setOutput(`<div style="padding:12px;margin-top:12px;">${escapeHtml(message)}</div>`);
  }

  function showError(message, error) {
    console.error(message, error || "");
    setOutput(`
      <div style="padding:12px;border:1px solid #cc0000;margin-top:12px;">
        <strong>Admin error</strong>
        <div style="margin-top:8px;">${escapeHtml(message)}</div>
      </div>
    `);
  }

  function firstMatch(text, regexList) {
    for (const regex of regexList) {
      const match = text.match(regex);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    return "";
  }

  function formatMoney(value) {
    const amount = Number(value || 0);
    return `$${amount.toFixed(2)}`;
  }

  function getGalleryName(gallery) {
    return (
      gallery.name ||
      gallery.title ||
      gallery.gallery_name ||
      gallery.slug ||
      `Gallery ${gallery.id}`
    );
  }

  function cleanPhotoNumber(photo) {
    const raw =
      photo.file_name ||
      photo.filename ||
      photo.name ||
      photo.title ||
      photo.file_path ||
      photo.image_url ||
      "";

    const lastPart = String(raw).split("/").pop() || "";
    return lastPart
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]?result$/i, "")
      .trim();
  }

  function sortRowsByCreatedAtDesc(rows) {
    return [...rows].sort((a, b) => {
      const aTime = a && a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b && b.created_at ? new Date(b.created_at).getTime() : 0;
      return bTime - aTime;
    });
  }

  async function readDataJsText() {
    const response = await fetch("data.js", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Could not read data.js.");
    }
    return await response.text();
  }

  function extractSupabaseUrl(source) {
    return firstMatch(source, [
      /(https:\/\/[a-z0-9-]+\.supabase\.co)/i,
      /["'`](https:\/\/[a-z0-9-]+\.supabase\.co)["'`]/i
    ]);
  }

  function extractSupabaseAnonKey(source) {
    return firstMatch(source, [
      /(?:SUPABASE_ANON_KEY|SUPABASE_KEY|MADPIX_SUPABASE_ANON_KEY|APP_SUPABASE_ANON_KEY)\s*[:=]\s*["'`]([^"'`]+)["'`]/i,
      /["'`](eyJ[A-Za-z0-9._-]{40,})["'`]/i
    ]);
  }

  function extractBucketName(source) {
    return firstMatch(source, [
      /(?:SUPABASE_BUCKET|MADPIX_BUCKET|APP_BUCKET|bucket)\s*[:=]\s*["'`]([^"'`]+)["'`]/i
    ]) || "photos";
  }

  async function getRuntimeConfig() {
    if (window.__madpixRuntimeConfig) {
      return window.__madpixRuntimeConfig;
    }

    const source = await readDataJsText();

    const config = {
      url: extractSupabaseUrl(source),
      key: extractSupabaseAnonKey(source),
      bucket: extractBucketName(source)
    };

    window.__madpixRuntimeConfig = config;
    return config;
  }

  async function getSupabaseClient() {
    if (window.__madpixAdminSupabase) {
      return window.__madpixAdminSupabase;
    }

    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("Supabase library not loaded.");
    }

    const config = await getRuntimeConfig();

    if (!config.url) {
      throw new Error("Supabase URL not found in data.js.");
    }

    if (!config.key) {
      throw new Error("Supabase anon key not found in data.js.");
    }

    window.__madpixAdminSupabase = window.supabase.createClient(config.url, config.key);
    return window.__madpixAdminSupabase;
  }

  async function getBucketName() {
    const config = await getRuntimeConfig();
    return config.bucket || "photos";
  }

  async function queryVisitorTable() {
    const sb = await getSupabaseClient();
    const tables = ["pe_visits", "pe_visitors", "visitors"];
    let lastError = null;

    for (const tableName of tables) {
      const { data, error } = await sb
        .from(tableName)
        .select("*")
        .order("created_at", { ascending: false });

      if (!error) {
        return { tableName, data: data || [] };
      }
      lastError = error;
    }

    throw lastError || new Error("No working visitors table found.");
  }

  async function queryOrdersTable() {
    const sb = await getSupabaseClient();

    const attempts = [
      { table: "pe_orders", ordered: true },
      { table: "pe_orders", ordered: false },
      { table: "pe_purchases", ordered: true },
      { table: "pe_purchases", ordered: false },
      { table: "orders", ordered: true },
      { table: "orders", ordered: false },
      { table: "purchases", ordered: true },
      { table: "purchases", ordered: false }
    ];

    let lastError = null;

    for (const attempt of attempts) {
      let query = sb.from(attempt.table).select("*");

      if (attempt.ordered) {
        query = query.order("created_at", { ascending: false });
      }

      const { data, error } = await query;

      if (!error) {
        const safeRows = Array.isArray(data) ? data : [];
        return {
          tableName: attempt.table,
          data: attempt.ordered ? safeRows : sortRowsByCreatedAtDesc(safeRows)
        };
      }

      lastError = error;
    }

    throw lastError || new Error("No working purchases table found.");
  }

  async function refreshStats() {
    try {
      const visitResult = await queryVisitorTable().catch(() => ({ data: [] }));
      const orderResult = await queryOrdersTable().catch(() => ({ data: [] }));

      const visits = Array.isArray(visitResult.data) ? visitResult.data : [];
      const orders = Array.isArray(orderResult.data) ? orderResult.data : [];

      let revenue = 0;
      orders.forEach((row) => {
        revenue += Number(
          row.total ||
          row.amount ||
          row.total_amount ||
          row.price_total ||
          row.revenue ||
          0
        );
      });

      if (statVisits) statVisits.textContent = String(visits.length);
      if (statPurchases) statPurchases.textContent = String(orders.length);
      if (statRevenue) statRevenue.textContent = formatMoney(revenue);
    } catch (error) {
      console.error("Could not refresh stats.", error);
      if (statVisits) statVisits.textContent = "—";
      if (statPurchases) statPurchases.textContent = "—";
      if (statRevenue) statRevenue.textContent = "—";
    }
  }

  async function loadGalleries() {
    try {
      showLoading("Loading galleries...");
      const sb = await getSupabaseClient();

      const { data, error } = await sb
        .from("pe_galleries")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      const galleries = Array.isArray(data) ? data : [];

      if (!galleries.length) {
        setOutput(`
          <div style="padding:12px;margin-top:12px;">
            <div>No galleries found.</div>
            <div style="margin-top:12px;">
              <button type="button" id="createGalleryBtn">Create Gallery</button>
            </div>
          </div>
        `);
        return;
      }

      setOutput(`
        <div style="margin-top:12px;">
          <div style="margin-bottom:12px;">
            <button type="button" id="createGalleryBtn">Create Gallery</button>
          </div>
          ${galleries.map((gallery) => `
            <div style="padding:10px 0;border-bottom:1px solid #ddd;">
              <div><strong>${escapeHtml(getGalleryName(gallery))}</strong></div>
              <div style="margin-top:8px;">
                <button type="button" class="openGalleryBtn" data-gallery-id="${escapeHtml(gallery.id)}">
                  Open Gallery
                </button>
              </div>
            </div>
          `).join("")}
        </div>
      `);
    } catch (error) {
      showError(error.message || "Failed to load galleries.", error);
    }
  }

  async function loadVisitors() {
    try {
      showLoading("Loading visitors...");
      const result = await queryVisitorTable();
      const data = result.data || [];

      if (!data.length) {
        setOutput(`<div style="padding:12px;margin-top:12px;">No visitor records found.</div>`);
        return;
      }

      setOutput(`
        <div style="margin-top:12px;">
          <div style="margin-bottom:12px;"><strong>Visitors</strong></div>
          <div style="margin-bottom:12px;font-size:12px;opacity:0.7;">Source table: ${escapeHtml(result.tableName)}</div>
          <div style="overflow:auto;">
            <table style="width:100%;border-collapse:collapse;">
              <thead>
                <tr>
                  <th style="text-align:left;padding:8px;border-bottom:1px solid #ddd;">When</th>
                  <th style="text-align:left;padding:8px;border-bottom:1px solid #ddd;">Gallery</th>
                  <th style="text-align:left;padding:8px;border-bottom:1px solid #ddd;">Visitor</th>
                  <th style="text-align:left;padding:8px;border-bottom:1px solid #ddd;">Source</th>
                </tr>
              </thead>
              <tbody>
                ${data.map((row) => `
                  <tr>
                    <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(row.created_at || row.visited_at || "")}</td>
                    <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(row.gallery_id || row.gallery_name || row.gallery_slug || "")}</td>
                    <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(row.email || row.name || row.visitor_id || row.ip || "")}</td>
                    <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(row.referrer || row.source || "")}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      `);
    } catch (error) {
      showError("Could not load visitors. No working visitors table found.", error);
    }
  }

  async function loadOrders() {
    try {
      showLoading("Loading purchases...");
      const result = await queryOrdersTable();
      const data = result.data || [];

      if (!data.length) {
        setOutput(`<div style="padding:12px;margin-top:12px;">No purchase records found.</div>`);
        return;
      }

      setOutput(`
        <div style="margin-top:12px;">
          <div style="margin-bottom:12px;"><strong>Purchases</strong></div>
          <div style="margin-bottom:12px;font-size:12px;opacity:0.7;">Source table: ${escapeHtml(result.tableName)}</div>
          <div style="overflow:auto;">
            <table style="width:100%;border-collapse:collapse;">
              <thead>
                <tr>
                  <th style="text-align:left;padding:8px;border-bottom:1px solid #ddd;">When</th>
                  <th style="text-align:left;padding:8px;border-bottom:1px solid #ddd;">Buyer</th>
                  <th style="text-align:left;padding:8px;border-bottom:1px solid #ddd;">Total</th>
                  <th style="text-align:left;padding:8px;border-bottom:1px solid #ddd;">Status</th>
                </tr>
              </thead>
              <tbody>
                ${data.map((row) => `
                  <tr>
                    <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(row.created_at || "")}</td>
                    <td style="padding:8px;border-bottom:1px solid #eee;">
                      ${escapeHtml(
                        row.customer_email ||
                        row.customer_name ||
                        row.email ||
                        row.name ||
                        row.buyer_email ||
                        row.buyer_name ||
                        ""
                      )}
                    </td>
                    <td style="padding:8px;border-bottom:1px solid #eee;">
                      ${escapeHtml(
                        formatMoney(
                          row.total ||
                          row.amount ||
                          row.total_amount ||
                          row.price_total ||
                          row.revenue ||
                          0
                        )
                      )}
                    </td>
                    <td style="padding:8px;border-bottom:1px solid #eee;">
                      ${escapeHtml(
                        row.payment_status ||
                        row.status ||
                        row.order_status ||
                        ""
                      )}
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      `);
    } catch (error) {
      showError("Could not load purchases. No working purchases table found.", error);
    }
  }

  async function openGallery(galleryId) {
    try {
      showLoading("Loading gallery...");
      const sb = await getSupabaseClient();

      const { data: gallery, error: galleryError } = await sb
        .from("pe_galleries")
        .select("*")
        .eq("id", galleryId)
        .single();

      if (galleryError) throw galleryError;

      const { data: photos, error: photosError } = await sb
        .from("pe_photos")
        .select("*")
        .eq("gallery_id", galleryId)
        .order("created_at", { ascending: true });

      if (photosError) throw photosError;

      const photoList = Array.isArray(photos) ? photos : [];

      let galleryPrice = "";
      if (photoList.length > 0) {
        const pricedPhoto = photoList.find((photo) => photo.price !== null && photo.price !== undefined && photo.price !== "");
        if (pricedPhoto) {
          galleryPrice = String(pricedPhoto.price);
        }
      }

      const title = getGalleryName(gallery);
      const liveCount = photoList.filter((photo) => !!photo.is_live).length;

      setOutput(`
        <div style="margin-top:12px;">
          <div style="margin-bottom:16px;">
            <button type="button" id="backToGalleriesBtn">Back to Galleries</button>
            <button type="button" id="uploadPhotosBtn" style="margin-left:8px;">Upload Photos</button>
            <input type="file" id="photoUploadInput" multiple style="display:none;" data-gallery-id="${escapeHtml(galleryId)}" />
          </div>

          <div style="padding:18px;border-bottom:1px solid #ddd;">
            <h3 style="margin-bottom:12px;">${escapeHtml(title)}</h3>

            <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin-bottom:14px;">
              <div style="min-width:220px;flex:0 1 260px;">
                <label style="display:block;margin-bottom:6px;">Gallery Price</label>
                <input type="number" step="0.01" id="galleryPriceInput" value="${escapeHtml(galleryPrice)}">
              </div>
              <div>
                <button type="button" id="saveGalleryPriceBtn" data-gallery-id="${escapeHtml(galleryId)}">
                  Save Gallery Price
                </button>
              </div>
            </div>

            <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;">
              <button type="button" id="makeGalleryLiveBtn" data-gallery-id="${escapeHtml(galleryId)}">
                Make Gallery Live
              </button>
              <button type="button" id="makeGalleryDraftBtn" data-gallery-id="${escapeHtml(galleryId)}">
                Make Gallery Draft
              </button>
              <div style="font-size:14px;color:#6b7280;">
                ${escapeHtml(String(liveCount))} of ${escapeHtml(String(photoList.length))} live
              </div>
            </div>
          </div>

          ${
            !photoList.length
              ? `<div style="padding:18px 0;">No photos in this gallery yet.</div>`
              : `
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-top:18px;">
                  ${photoList.map((photo) => {
                    const photoNumber = cleanPhotoNumber(photo);
                    return `
                      <div style="padding:14px;border:1px solid #e5e7eb;border-radius:18px;background:#fff;box-shadow:0 10px 24px rgba(15,23,42,0.05);">
                        <div style="margin-bottom:10px;">
                          ${
                            photo.image_url
                              ? `<img src="${escapeHtml(photo.image_url)}" alt="" style="width:100%;height:180px;object-fit:cover;border-radius:14px;">`
                              : `<div style="height:180px;border-radius:14px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;">No image</div>`
                          }
                        </div>

                        <div style="font-size:24px;font-weight:800;line-height:1.1;margin-bottom:12px;color:#111827;">
                          ${escapeHtml(photoNumber || "Photo")}
                        </div>

                        <div style="margin-bottom:10px;">
                          <label style="display:block;margin-bottom:6px;">Sort Order</label>
                          <input
                            type="number"
                            class="photoSortInput"
                            data-photo-id="${escapeHtml(photo.id)}"
                            data-gallery-id="${escapeHtml(galleryId)}"
                            value="${escapeHtml(photo.sort_order || "")}"
                          >
                        </div>

                        <div style="margin-bottom:4px;">
                          <label>
                            <input
                              type="checkbox"
                              class="photoLiveInput"
                              data-photo-id="${escapeHtml(photo.id)}"
                              data-gallery-id="${escapeHtml(galleryId)}"
                              ${photo.is_live ? "checked" : ""}
                            >
                            Live
                          </label>
                        </div>
                      </div>
                    `;
                  }).join("")}
                </div>
              `
          }
        </div>
      `);
    } catch (error) {
      showError(error.message || "Failed to open gallery.", error);
    }
  }

  function showCreateGalleryForm() {
    setOutput(`
      <div style="margin-top:12px;">
        <div style="margin-bottom:12px;">
          <button type="button" id="backToGalleriesBtn">Back to Galleries</button>
        </div>

        <h3>Create Gallery</h3>

        <div style="margin-bottom:12px;">
          <label style="display:block;margin-bottom:6px;">Gallery Name</label>
          <input type="text" id="newGalleryName">
        </div>

        <div>
          <button type="button" id="saveNewGalleryBtn">Create Gallery</button>
        </div>
      </div>
    `);
  }

  async function createGallery() {
    try {
      const nameInput = document.getElementById("newGalleryName");
      const name = nameInput ? nameInput.value.trim() : "";

      if (!name) {
        showError("Gallery name is required.");
        return;
      }

      showLoading("Creating gallery...");
      const sb = await getSupabaseClient();

      const payload = {
        name: name,
        slug: name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        is_live: false
      };

      const { data, error } = await sb
        .from("pe_galleries")
        .insert(payload)
        .select()
        .single();

      if (error) throw error;

      await openGallery(data.id);
      await refreshStats();
    } catch (error) {
      showError(error.message || "Failed to create gallery.", error);
    }
  }

  async function uploadPhotos(galleryId, files) {
    try {
      if (!files || files.length === 0) {
        return;
      }

      showLoading("Uploading photos...");
      const sb = await getSupabaseClient();
      const bucketName = await getBucketName();

      for (const file of Array.from(files)) {
        const extension = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
        const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
        const filePath = `${galleryId}/${fileName}`;
        const cleanedTitle = file.name
          .replace(/\.[^.]+$/, "")
          .replace(/[-_]?result$/i, "")
          .trim();

        const { error: uploadError } = await sb.storage
          .from(bucketName)
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        const { data: publicData } = sb.storage
          .from(bucketName)
          .getPublicUrl(filePath);

        const { error: insertError } = await sb
          .from("pe_photos")
          .insert({
            gallery_id: galleryId,
            title: cleanedTitle,
            image_url: publicData.publicUrl,
            file_path: filePath,
            is_live: true
          });

        if (insertError) throw insertError;
      }

      await openGallery(galleryId);
      await refreshStats();
    } catch (error) {
      showError(error.message || "Failed to upload photos.", error);
    }
  }

  async function saveGalleryPrice(galleryId) {
    try {
      const priceInput = document.getElementById("galleryPriceInput");
      const priceValue = priceInput ? priceInput.value.trim() : "";

      if (priceValue === "") {
        showError("Gallery price is required.");
        return;
      }

      showLoading("Saving gallery price...");
      const sb = await getSupabaseClient();

      const { error } = await sb
        .from("pe_photos")
        .update({ price: Number(priceValue) })
        .eq("gallery_id", galleryId);

      if (error) throw error;

      await openGallery(galleryId);
      await refreshStats();
    } catch (error) {
      showError(error.message || "Failed to save gallery price.", error);
    }
  }

  async function setGalleryLive(galleryId, isLive) {
    try {
      showLoading(isLive ? "Making gallery live..." : "Making gallery draft...");
      const sb = await getSupabaseClient();

      const { error: photoError } = await sb
        .from("pe_photos")
        .update({ is_live: isLive })
        .eq("gallery_id", galleryId);

      if (photoError) throw photoError;

      const { error: galleryError } = await sb
        .from("pe_galleries")
        .update({ is_live: isLive })
        .eq("id", galleryId);

      if (galleryError) throw galleryError;

      await openGallery(galleryId);
    } catch (error) {
      showError(error.message || "Failed to update gallery live state.", error);
    }
  }

  async function savePhotoAuto(photoId, galleryId) {
    try {
      const sortInput = document.querySelector(`.photoSortInput[data-photo-id="${photoId}"]`);
      const liveInput = document.querySelector(`.photoLiveInput[data-photo-id="${photoId}"]`);

      const payload = {
        is_live: liveInput ? !!liveInput.checked : false
      };

      if (sortInput && sortInput.value !== "") {
        payload.sort_order = Number(sortInput.value);
      } else {
        payload.sort_order = null;
      }

      const sb = await getSupabaseClient();
      const { error } = await sb
        .from("pe_photos")
        .update(payload)
        .eq("id", photoId);

      if (error) throw error;
    } catch (error) {
      showError(error.message || "Failed to save photo edits.", error);
      await openGallery(galleryId);
    }
  }

  if (galleriesBtn) {
    galleriesBtn.addEventListener("click", loadGalleries);
  }

  if (visitorsBtn) {
    visitorsBtn.addEventListener("click", loadVisitors);
  }

  if (ordersBtn) {
    ordersBtn.addEventListener("click", loadOrders);
  }

  document.addEventListener("click", function (event) {
    const openBtn = event.target.closest(".openGalleryBtn");
    if (openBtn) {
      openGallery(openBtn.getAttribute("data-gallery-id"));
      return;
    }

    const backBtn = event.target.closest("#backToGalleriesBtn");
    if (backBtn) {
      loadGalleries();
      return;
    }

    const createBtn = event.target.closest("#createGalleryBtn");
    if (createBtn) {
      showCreateGalleryForm();
      return;
    }

    const saveNewGalleryBtn = event.target.closest("#saveNewGalleryBtn");
    if (saveNewGalleryBtn) {
      createGallery();
      return;
    }

    const uploadBtn = event.target.closest("#uploadPhotosBtn");
    if (uploadBtn) {
      const input = document.getElementById("photoUploadInput");
      if (input) input.click();
      return;
    }

    const saveGalleryPriceBtn = event.target.closest("#saveGalleryPriceBtn");
    if (saveGalleryPriceBtn) {
      saveGalleryPrice(saveGalleryPriceBtn.getAttribute("data-gallery-id"));
      return;
    }

    const makeGalleryLiveBtn = event.target.closest("#makeGalleryLiveBtn");
    if (makeGalleryLiveBtn) {
      setGalleryLive(makeGalleryLiveBtn.getAttribute("data-gallery-id"), true);
      return;
    }

    const makeGalleryDraftBtn = event.target.closest("#makeGalleryDraftBtn");
    if (makeGalleryDraftBtn) {
      setGalleryLive(makeGalleryDraftBtn.getAttribute("data-gallery-id"), false);
      return;
    }
  });

  document.addEventListener("change", function (event) {
    const fileInput = event.target.closest("#photoUploadInput");
    if (fileInput) {
      uploadPhotos(fileInput.getAttribute("data-gallery-id"), fileInput.files);
      return;
    }

    const liveInput = event.target.closest(".photoLiveInput");
    if (liveInput) {
      savePhotoAuto(
        liveInput.getAttribute("data-photo-id"),
        liveInput.getAttribute("data-gallery-id")
      );
    }
  });

  document.addEventListener(
    "blur",
    function (event) {
      const sortInput = event.target.closest(".photoSortInput");
      if (sortInput) {
        savePhotoAuto(
          sortInput.getAttribute("data-photo-id"),
          sortInput.getAttribute("data-gallery-id")
        );
      }
    },
    true
  );

  refreshStats();
  console.log("MadPix admin ready");
})();