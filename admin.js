(function () {
  "use strict";

  const galleriesBtn = document.getElementById("showGalleriesBtn");
  const visitorsBtn = document.getElementById("showVisitorsBtn");
  const ordersBtn = document.getElementById("showOrdersBtn");
  const output = document.getElementById("adminGalleryList");

  const statVisits = document.getElementById("statVisits");
  const statPurchases = document.getElementById("statPurchases");
  const statRevenue = document.getElementById("statRevenue");

  let currentGalleryId = null;
  let currentGalleryName = "";
  let isUploading = false;

  function setActiveTab(tabName) {
    if (galleriesBtn) galleriesBtn.classList.remove("admin-nav-btn-active");
    if (visitorsBtn) visitorsBtn.classList.remove("admin-nav-btn-active");
    if (ordersBtn) ordersBtn.classList.remove("admin-nav-btn-active");

    if (tabName === "galleries" && galleriesBtn) galleriesBtn.classList.add("admin-nav-btn-active");
    if (tabName === "visitors" && visitorsBtn) visitorsBtn.classList.add("admin-nav-btn-active");
    if (tabName === "orders" && ordersBtn) ordersBtn.classList.add("admin-nav-btn-active");
  }

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
    setOutput(`
      <div class="admin-message-card">
        <div class="admin-message-title">Loading</div>
        <div class="admin-message-text">${escapeHtml(message)}</div>
      </div>
    `);
  }

  function showError(message, error) {
    console.error(message, error || "");
    setOutput(`
      <div class="admin-message-card admin-error-card">
        <div class="admin-message-title">Admin error</div>
        <div class="admin-message-text">${escapeHtml(message)}</div>
      </div>
    `);
  }

  function showUploadStatus(galleryName, currentIndex, totalFiles, fileName, completedCount) {
    const percent = totalFiles > 0 ? Math.round((completedCount / totalFiles) * 100) : 0;

    setOutput(`
      <div class="admin-message-card">
        <div class="admin-message-title">Uploading Photos</div>
        <div class="admin-message-stack">
          <div><strong>Gallery:</strong> ${escapeHtml(galleryName || "Gallery")}</div>
          <div><strong>Uploading:</strong> ${escapeHtml(String(currentIndex))} of ${escapeHtml(String(totalFiles))}</div>
          <div><strong>Current file:</strong> ${escapeHtml(fileName || "")}</div>
          <div><strong>Completed:</strong> ${escapeHtml(String(completedCount))} of ${escapeHtml(String(totalFiles))}</div>
        </div>
        <div class="upload-progress-wrap">
          <div class="upload-progress-label">
            <span>Progress</span>
            <span>${escapeHtml(String(percent))}%</span>
          </div>
          <div class="upload-progress-bar">
            <div class="upload-progress-fill" style="width:${percent}%;"></div>
          </div>
        </div>
        <div class="admin-muted-note">Do not close this page while upload is running.</div>
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
    return `NZ$${amount.toFixed(2)}`;
  }

  function slugify(value) {
    return String(value || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function uniquePhotoCode(galleryId, fileName, index) {
    const baseName = String(fileName || "")
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]?result$/i, "")
      .trim();

    const galleryPart = slugify(galleryId);
    const filePart = slugify(baseName) || `photo-${index + 1}`;
    return `${galleryPart}-${filePart}-${Date.now()}-${index + 1}`;
  }

  function getGalleryName(gallery) {
    return (
      gallery.title ||
      gallery.name ||
      gallery.code ||
      gallery.slug ||
      gallery.gallery_name ||
      `Gallery ${gallery.id}`
    );
  }

  function getPreviewUrl(photo) {
    return photo.preview_url || photo.image_url || "";
  }

  function cleanPhotoNumber(photo) {
    const raw =
      photo.title ||
      photo.name ||
      photo.file_name ||
      photo.filename ||
      photo.original_name ||
      photo.image_name ||
      photo.preview_url ||
      photo.image_url ||
      "";

    const lastPart = String(raw).split("/").pop() || "";
    return lastPart
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]?result$/i, "")
      .replace(/-preview$/i, "")
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
      /(?:SUPABASE_ANON_KEY|SUPABASE_KEY|MADPIX_SUPABASE_ANON_KEY|APP_SUPABASE_ANON_KEY|PHOTOEZE_SUPABASE_ANON_KEY)\s*[:=]\s*["'`]([^"'`]+)["'`]/i,
      /["'`](eyJ[A-Za-z0-9._-]{40,})["'`]/i
    ]);
  }

  function extractBucketName(source) {
    return firstMatch(source, [
      /(?:SUPABASE_BUCKET|MADPIX_BUCKET|PHOTOEZE_BUCKET|APP_BUCKET|bucket)\s*[:=]\s*["'`]([^"'`]+)["'`]/i
    ]) || "photos";
  }

  async function getRuntimeConfig() {
    if (window.__photoezeRuntimeConfig) {
      return window.__photoezeRuntimeConfig;
    }

    const source = await readDataJsText();

    const config = {
      url: extractSupabaseUrl(source),
      key: extractSupabaseAnonKey(source),
      bucket: extractBucketName(source)
    };

    window.__photoezeRuntimeConfig = config;
    return config;
  }

  async function getSupabaseClient() {
    if (window.__photoezeAdminSupabase) {
      return window.__photoezeAdminSupabase;
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

    window.__photoezeAdminSupabase = window.supabase.createClient(config.url, config.key);
    return window.__photoezeAdminSupabase;
  }

  async function getBucketName() {
    const config = await getRuntimeConfig();
    return config.bucket || "photos";
  }

  function extractStoragePathFromPublicUrl(url, bucketName) {
    if (!url || !bucketName) return "";

    try {
      const parsed = new URL(url);
      const marker = `/storage/v1/object/public/${bucketName}/`;
      const idx = parsed.pathname.indexOf(marker);

      if (idx === -1) return "";

      const encodedPath = parsed.pathname.slice(idx + marker.length);
      return decodeURIComponent(encodedPath);
    } catch (error) {
      return "";
    }
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
      if (statVisits) statVisits.textContent = "0";
      if (statPurchases) statPurchases.textContent = "0";
      if (statRevenue) statRevenue.textContent = "NZ$0.00";
    }
  }

  async function loadGalleries() {
    try {
      setActiveTab("galleries");
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
          <div class="admin-page-block">
            <div class="admin-block-header">
              <div>
                <h2>Galleries</h2>
                <p>No galleries found yet.</p>
              </div>
              <div>
                <button type="button" id="createGalleryBtn" class="admin-btn admin-btn-primary">Create Gallery</button>
              </div>
            </div>
          </div>
        `);
        return;
      }

      setOutput(`
        <div class="admin-page-block">
          <div class="admin-block-header">
            <div>
              <h2>Galleries</h2>
              <p>Manage and open existing galleries.</p>
            </div>
            <div>
              <button type="button" id="createGalleryBtn" class="admin-btn admin-btn-primary">Create Gallery</button>
            </div>
          </div>

          <div class="admin-gallery-list">
            ${galleries.map((gallery) => `
              <div class="admin-gallery-row">
                <div class="admin-gallery-row-main">
                  <div class="admin-gallery-row-title">${escapeHtml(getGalleryName(gallery))}</div>
                  <div class="admin-gallery-row-meta">
                    <span>${gallery.is_live ? "Live" : "Draft"}</span>
                  </div>
                </div>
                <div class="admin-gallery-row-actions">
                  <button type="button" class="admin-btn admin-btn-secondary openGalleryBtn" data-gallery-id="${escapeHtml(gallery.id)}">
                    Open Gallery
                  </button>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      `);
    } catch (error) {
      showError(error.message || "Failed to load galleries.", error);
    }
  }

  async function loadVisitors() {
    try {
      setActiveTab("visitors");
      showLoading("Loading visitors...");
      const result = await queryVisitorTable();
      const data = result.data || [];

      if (!data.length) {
        setOutput(`
          <div class="admin-page-block">
            <div class="admin-block-header">
              <div>
                <h2>Visitors</h2>
                <p>No visitor records found.</p>
              </div>
            </div>
          </div>
        `);
        return;
      }

      setOutput(`
        <div class="admin-page-block">
          <div class="admin-block-header">
            <div>
              <h2>Visitors</h2>
              <p>Source table: ${escapeHtml(result.tableName)}</p>
            </div>
          </div>

          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Gallery</th>
                  <th>Visitor</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                ${data.map((row) => `
                  <tr>
                    <td>${escapeHtml(row.created_at || row.visited_at || "")}</td>
                    <td>${escapeHtml(row.gallery_id || row.gallery_name || row.gallery_slug || "")}</td>
                    <td>${escapeHtml(row.email || row.name || row.visitor_id || row.ip || "")}</td>
                    <td>${escapeHtml(row.referrer || row.source || "")}</td>
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
      setActiveTab("orders");
      showLoading("Loading purchases...");
      const result = await queryOrdersTable();
      const data = result.data || [];

      if (!data.length) {
        setOutput(`
          <div class="admin-page-block">
            <div class="admin-block-header">
              <div>
                <h2>Orders</h2>
                <p>No purchase records found.</p>
              </div>
            </div>
          </div>
        `);
        return;
      }

      setOutput(`
        <div class="admin-page-block">
          <div class="admin-block-header">
            <div>
              <h2>Orders</h2>
              <p>Source table: ${escapeHtml(result.tableName)}</p>
            </div>
          </div>

          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Buyer</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${data.map((row) => `
                  <tr>
                    <td>${escapeHtml(row.created_at || "")}</td>
                    <td>
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
                    <td>
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
                    <td>
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
      setActiveTab("galleries");
      currentGalleryId = galleryId;
      showLoading("Loading gallery...");
      const sb = await getSupabaseClient();

      const { data: gallery, error: galleryError } = await sb
        .from("pe_galleries")
        .select("*")
        .eq("id", galleryId)
        .single();

      if (galleryError) throw galleryError;

      currentGalleryName = getGalleryName(gallery);

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

      const title = currentGalleryName;
      const liveCount = photoList.filter((photo) => !!photo.is_live).length;

      setOutput(`
        <div class="admin-page-block">
          <div class="admin-block-header">
            <div>
              <h2>${escapeHtml(title)}</h2>
              <p>${escapeHtml(String(liveCount))} of ${escapeHtml(String(photoList.length))} live</p>
            </div>

            <div class="admin-header-actions">
              <button type="button" id="backToGalleriesBtn" class="admin-btn admin-btn-secondary" ${isUploading ? "disabled" : ""}>Back to Galleries</button>
              <button type="button" id="uploadPhotosBtn" class="admin-btn admin-btn-primary" ${isUploading ? "disabled" : ""}>Upload Photos</button>
              <button type="button" id="deleteGalleryBtn" class="admin-btn admin-btn-danger" data-gallery-id="${escapeHtml(galleryId)}" data-gallery-name="${escapeHtml(title)}" ${isUploading ? "disabled" : ""}>Delete Gallery</button>
              <input type="file" id="photoUploadInput" multiple style="display:none;" data-gallery-id="${escapeHtml(galleryId)}" ${isUploading ? "disabled" : ""} />
            </div>
          </div>

          <div class="admin-settings-row">
            <div class="admin-settings-card">
              <label for="galleryPriceInput">Gallery Price</label>
              <input type="number" step="0.01" id="galleryPriceInput" value="${escapeHtml(galleryPrice)}" ${isUploading ? "disabled" : ""} />
              <button type="button" id="saveGalleryPriceBtn" class="admin-btn admin-btn-primary" data-gallery-id="${escapeHtml(galleryId)}" ${isUploading ? "disabled" : ""}>Save Gallery Price</button>
            </div>

            <div class="admin-settings-card">
              <div class="admin-settings-actions">
                <button type="button" id="makeGalleryLiveBtn" class="admin-btn admin-btn-primary" data-gallery-id="${escapeHtml(galleryId)}" ${isUploading ? "disabled" : ""}>Make Gallery Live</button>
                <button type="button" id="makeGalleryDraftBtn" class="admin-btn admin-btn-secondary" data-gallery-id="${escapeHtml(galleryId)}" ${isUploading ? "disabled" : ""}>Make Gallery Draft</button>
              </div>
            </div>
          </div>

          ${
            !photoList.length
              ? `<div class="admin-empty-state">No photos in this gallery yet.</div>`
              : `
                <div class="admin-photo-grid">
                  ${photoList.map((photo) => {
                    const photoNumber = cleanPhotoNumber(photo);
                    const previewUrl = getPreviewUrl(photo);

                    return `
                      <div class="admin-photo-card">
                        <div class="admin-photo-thumb">
                          ${
                            previewUrl
                              ? `<img src="${escapeHtml(previewUrl)}" alt="">`
                              : `<div class="admin-no-image">No image</div>`
                          }
                        </div>

                        <div class="admin-photo-body">
                          <div class="admin-photo-title">${escapeHtml(photoNumber || "Photo")}</div>

                          <div class="admin-field-group">
                            <label>Sort Order</label>
                            <input
                              type="number"
                              class="photoSortInput"
                              data-photo-id="${escapeHtml(photo.id)}"
                              data-gallery-id="${escapeHtml(galleryId)}"
                              value="${escapeHtml(photo.sort_order || "")}"
                              ${isUploading ? "disabled" : ""}
                            />
                          </div>

                          <label class="admin-checkbox-row">
                            <input
                              type="checkbox"
                              class="photoLiveInput"
                              data-photo-id="${escapeHtml(photo.id)}"
                              data-gallery-id="${escapeHtml(galleryId)}"
                              ${photo.is_live ? "checked" : ""}
                              ${isUploading ? "disabled" : ""}
                            />
                            <span>Live</span>
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
      <div class="admin-page-block admin-form-block">
        <div class="admin-block-header">
          <div>
            <h2>Create Gallery</h2>
            <p>Create a new gallery.</p>
          </div>
          <div>
            <button type="button" id="backToGalleriesBtn" class="admin-btn admin-btn-secondary">Back to Galleries</button>
          </div>
        </div>

        <div class="admin-settings-card">
          <label for="newGalleryName">Gallery Name</label>
          <input type="text" id="newGalleryName" />
          <button type="button" id="saveNewGalleryBtn" class="admin-btn admin-btn-primary">Create Gallery</button>
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
        title: name,
        code: slugify(name),
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

      isUploading = true;

      const sb = await getSupabaseClient();
      const bucketName = await getBucketName();
      const totalFiles = files.length;
      let completedCount = 0;

      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];

        showUploadStatus(
          currentGalleryName,
          i + 1,
          totalFiles,
          file.name,
          completedCount
        );

        const extension = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
        const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
        const storagePath = `${galleryId}/${fileName}`;
        const cleanedTitle = file.name
          .replace(/\.[^.]+$/, "")
          .replace(/[-_]?result$/i, "")
          .trim();

        const { error: uploadError } = await sb.storage
          .from(bucketName)
          .upload(storagePath, file);

        if (uploadError) throw uploadError;

        const { data: publicData } = sb.storage
          .from(bucketName)
          .getPublicUrl(storagePath);

        const photoPayload = {
          gallery_id: galleryId,
          code: uniquePhotoCode(galleryId, file.name, i),
          title: cleanedTitle,
          image_url: publicData.publicUrl,
          preview_url: publicData.publicUrl,
          original_url: publicData.publicUrl,
          is_live: true
        };

        const { error: insertError } = await sb
          .from("pe_photos")
          .insert(photoPayload);

        if (insertError) throw insertError;

        completedCount += 1;

        showUploadStatus(
          currentGalleryName,
          Math.min(i + 1, totalFiles),
          totalFiles,
          file.name,
          completedCount
        );
      }

      const fileInput = document.getElementById("photoUploadInput");
      if (fileInput) {
        fileInput.value = "";
      }

      isUploading = false;
      await openGallery(galleryId);

      try {
        await refreshStats();
      } catch (statsError) {
        console.error("Stats refresh failed after upload.", statsError);
      }
    } catch (error) {
      isUploading = false;
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

  async function deleteGallery(galleryId, galleryName) {
    const firstConfirm = window.confirm(
      `Delete gallery "${galleryName}"?\n\nThis will remove the gallery and all of its photos.`
    );

    if (!firstConfirm) {
      return;
    }

    const typed = window.prompt(`Type DELETE to remove "${galleryName}"`);

    if (typed !== "DELETE") {
      return;
    }

    try {
      showLoading(`Deleting gallery "${galleryName}"...`);
      const sb = await getSupabaseClient();
      const bucketName = await getBucketName();

      const { data: photos, error: photosReadError } = await sb
        .from("pe_photos")
        .select("*")
        .eq("gallery_id", galleryId);

      if (photosReadError) throw photosReadError;

      const photoRows = Array.isArray(photos) ? photos : [];
      const filePaths = photoRows.flatMap((row) => {
        const paths = [];
        const previewPath = extractStoragePathFromPublicUrl(row.preview_url || row.image_url, bucketName);
        const originalPath = extractStoragePathFromPublicUrl(row.original_url || row.image_url, bucketName);

        if (previewPath) paths.push(previewPath);
        if (originalPath && originalPath !== previewPath) paths.push(originalPath);

        return paths;
      });

      if (filePaths.length > 0) {
        const { error: storageRemoveError } = await sb.storage
          .from(bucketName)
          .remove(filePaths);

        if (storageRemoveError) {
          throw storageRemoveError;
        }
      }

      const { error: deletePhotosError } = await sb
        .from("pe_photos")
        .delete()
        .eq("gallery_id", galleryId);

      if (deletePhotosError) throw deletePhotosError;

      const { error: deleteGalleryError } = await sb
        .from("pe_galleries")
        .delete()
        .eq("id", galleryId);

      if (deleteGalleryError) throw deleteGalleryError;

      await refreshStats();
      await loadGalleries();
    } catch (error) {
      const messageText = String(error && error.message ? error.message : error || "");

      if (
        /foreign key/i.test(messageText) ||
        /violates/i.test(messageText) ||
        /constraint/i.test(messageText)
      ) {
        showError(
          `Could not delete "${galleryName}". It may have existing orders linked to its photos.`,
          error
        );
        return;
      }

      showError(`Failed to delete gallery "${galleryName}".`, error);
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
      if (isUploading) return;
      openGallery(openBtn.getAttribute("data-gallery-id"));
      return;
    }

    const backBtn = event.target.closest("#backToGalleriesBtn");
    if (backBtn) {
      if (isUploading) return;
      loadGalleries();
      return;
    }

    const createBtn = event.target.closest("#createGalleryBtn");
    if (createBtn) {
      if (isUploading) return;
      showCreateGalleryForm();
      return;
    }

    const saveNewGalleryBtn = event.target.closest("#saveNewGalleryBtn");
    if (saveNewGalleryBtn) {
      if (isUploading) return;
      createGallery();
      return;
    }

    const uploadBtn = event.target.closest("#uploadPhotosBtn");
    if (uploadBtn) {
      if (isUploading) return;
      const input = document.getElementById("photoUploadInput");
      if (input) input.click();
      return;
    }

    const saveGalleryPriceBtn = event.target.closest("#saveGalleryPriceBtn");
    if (saveGalleryPriceBtn) {
      if (isUploading) return;
      saveGalleryPrice(saveGalleryPriceBtn.getAttribute("data-gallery-id"));
      return;
    }

    const makeGalleryLiveBtn = event.target.closest("#makeGalleryLiveBtn");
    if (makeGalleryLiveBtn) {
      if (isUploading) return;
      setGalleryLive(makeGalleryLiveBtn.getAttribute("data-gallery-id"), true);
      return;
    }

    const makeGalleryDraftBtn = event.target.closest("#makeGalleryDraftBtn");
    if (makeGalleryDraftBtn) {
      if (isUploading) return;
      setGalleryLive(makeGalleryDraftBtn.getAttribute("data-gallery-id"), false);
      return;
    }

    const deleteGalleryBtn = event.target.closest("#deleteGalleryBtn");
    if (deleteGalleryBtn) {
      if (isUploading) return;
      deleteGallery(
        deleteGalleryBtn.getAttribute("data-gallery-id"),
        deleteGalleryBtn.getAttribute("data-gallery-name") || "Gallery"
      );
      return;
    }
  });

  document.addEventListener("change", function (event) {
    const fileInput = event.target.closest("#photoUploadInput");
    if (fileInput) {
      if (isUploading) return;
      uploadPhotos(fileInput.getAttribute("data-gallery-id"), fileInput.files);
      return;
    }

    const liveInput = event.target.closest(".photoLiveInput");
    if (liveInput) {
      if (isUploading) return;
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
        if (isUploading) return;
        savePhotoAuto(
          sortInput.getAttribute("data-photo-id"),
          sortInput.getAttribute("data-gallery-id")
        );
      }
    },
    true
  );

  if (statVisits) statVisits.textContent = "0";
  if (statPurchases) statPurchases.textContent = "0";
  if (statRevenue) statRevenue.textContent = "NZ$0.00";

  refreshStats();
  loadGalleries();
  console.log("Photoeze admin ready");
})();