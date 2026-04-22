const USER_KEY = "photoeze_user";
const CART_KEY = "photoeze_cart";

let supabaseClient = null;
let runtimeConfigPromise = null;
let paypalScriptPromise = null;

const state = {
  galleries: [],
  selectedGalleryId: null,
  cart: [],
  user: null,
  view: "welcome",
  loading: true,
  error: "",
  savingOrder: false,
  savingVisitor: false,
  lastPayPalOrderId: "",
  lastPayPalCaptureId: "",
  paypalReady: false,
  paypalError: ""
};

function firstMatch(text, regexList) {
  for (const regex of regexList) {
    const match = text.match(regex);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return "";
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
    /(?:SUPABASE_ANON_KEY|SUPABASE_KEY|MADPIX_SUPABASE_ANON_KEY|APP_SUPABASE_ANON_KEY|anonKey)\s*[:=]\s*["'`]([^"'`]+)["'`]/i,
    /["'`](eyJ[A-Za-z0-9._-]{40,})["'`]/i
  ]);
}

function extractPayPalClientId(source) {
  return firstMatch(source, [
    /(?:PAYPAL_CLIENT_ID|PAYPAL_SANDBOX_CLIENT_ID|PAYPAL_LIVE_CLIENT_ID|paypalClientId)\s*[:=]\s*["'`]([^"'`]+)["'`]/i
  ]);
}

async function getRuntimeConfig() {
  if (runtimeConfigPromise) {
    return runtimeConfigPromise;
  }

  runtimeConfigPromise = (async () => {
    const source = await readDataJsText();

    return {
      supabaseUrl: extractSupabaseUrl(source),
      supabaseAnonKey: extractSupabaseAnonKey(source),
      paypalClientId: extractPayPalClientId(source)
    };
  })();

  return runtimeConfigPromise;
}

async function createSupabaseClient() {
  try {
    if (!window.supabase || !window.supabase.createClient) {
      throw new Error("Supabase library did not load.");
    }

    const config = await getRuntimeConfig();

    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error("Supabase config not found.");
    }

    supabaseClient = window.supabase.createClient(
      config.supabaseUrl,
      config.supabaseAnonKey
    );
  } catch (error) {
    console.error("Supabase init error:", error);
    state.error = "Could not start app.";
    state.loading = false;
  }
}

async function loadPayPalSdk() {
  if (window.paypal && typeof window.paypal.Buttons === "function") {
    state.paypalReady = true;
    state.paypalError = "";
    return;
  }

  if (paypalScriptPromise) {
    return paypalScriptPromise;
  }

  paypalScriptPromise = (async () => {
    const config = await getRuntimeConfig();

    if (!config.paypalClientId) {
      throw new Error("PayPal client ID not found in data.js.");
    }

    await new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-paypal-sdk="true"]');
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", () => reject(new Error("PayPal SDK failed to load.")), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(
        config.paypalClientId
      )}&currency=NZD&intent=capture`;
      script.async = true;
      script.dataset.paypalSdk = "true";
      script.onload = resolve;
      script.onerror = () => reject(new Error("PayPal SDK failed to load."));
      document.head.appendChild(script);
    });

    if (!window.paypal || typeof window.paypal.Buttons !== "function") {
      throw new Error("PayPal SDK loaded but Buttons are unavailable.");
    }

    state.paypalReady = true;
    state.paypalError = "";
  })();

  return paypalScriptPromise;
}

function saveUser(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function loadUser() {
  return JSON.parse(localStorage.getItem(USER_KEY) || "null");
}

function saveCart() {
  localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
}

function loadCart() {
  return JSON.parse(localStorage.getItem(CART_KEY) || "[]");
}

function getSelectedGallery() {
  return state.galleries.find((gallery) => gallery.id === state.selectedGalleryId) || null;
}

function isInCart(photoId) {
  return state.cart.some((photo) => photo.id === photoId);
}

function getCartTotal() {
  return state.cart.reduce((sum, photo) => sum + Number(photo.price || 0), 0);
}

function cleanPhotoNumber(value) {
  return String(value || "")
    .split("/")
    .pop()
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]?result$/i, "")
    .trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function render() {
  const app = document.getElementById("app");
  if (!app) return;

  if (state.loading) {
    app.innerHTML = `
      <div class="checkout-box">
        <p>Loading...</p>
      </div>
    `;
    renderCart();
    return;
  }

  if (state.error) {
    app.innerHTML = `
      <div class="checkout-box">
        <p>${escapeHtml(state.error)}</p>
      </div>
    `;
    renderCart();
    return;
  }

  if (!state.user || state.view === "welcome") {
    renderWelcome(app);
    renderCart();
    return;
  }

  if (state.view === "checkout") {
    renderCheckout(app);
    renderCart();
    return;
  }

  if (state.view === "confirmation") {
    renderConfirmation(app);
    renderCart();
    return;
  }

  if (state.selectedGalleryId && state.view === "gallery") {
    renderGallery(app);
    renderCart();
    return;
  }

  renderGalleryList(app);
  renderCart();
}

function renderWelcome(app) {
  app.innerHTML = `
    <div class="welcome-wrap">
      <div class="welcome-card">
        <h1 class="welcome-logo">
          <span class="logo-mad">Mad</span><span class="logo-pix">Pix</span>
        </h1>
        <p class="welcome-text">A simple way to view and buy your photos.</p>

        <input id="welcomeName" type="text" placeholder="Your Name" />
        <input id="welcomePhone" type="text" placeholder="Phone Number" />
        <input id="welcomeEmail" type="email" placeholder="Email Address" />

        <button id="welcomeEnterBtn" class="admin-primary-button" type="button">
          ${state.savingVisitor ? "Entering..." : "Enter"}
        </button>
      </div>
    </div>
  `;

  const nameInput = document.getElementById("welcomeName");
  const phoneInput = document.getElementById("welcomePhone");
  const emailInput = document.getElementById("welcomeEmail");

  if (state.user) {
    nameInput.value = state.user.name || "";
    phoneInput.value = state.user.phone || "";
    emailInput.value = state.user.email || "";
  }

  document.getElementById("welcomeEnterBtn").onclick = async () => {
    const name = nameInput.value.trim();
    const phone = phoneInput.value.trim();
    const email = emailInput.value.trim();

    if (!name || !phone || !email) {
      alert("Please complete all fields");
      return;
    }

    if (!supabaseClient) {
      alert("Supabase is not connected.");
      return;
    }

    state.savingVisitor = true;
    render();

    const visitorId = crypto.randomUUID();

    try {
      const { error } = await supabaseClient
        .from("pe_visitors")
        .insert([
          {
            id: visitorId,
            name,
            phone,
            email
          }
        ]);

      if (error) {
        throw error;
      }

      state.user = { id: visitorId, name, phone, email };
      saveUser(state.user);
      state.savingVisitor = false;
      state.view = "galleries";
      render();
    } catch (error) {
      console.error("Save visitor error:", error);
      state.savingVisitor = false;
      render();
      alert("Could not save visitor");
    }
  };
}

function renderGalleryList(app) {
  app.innerHTML = `
    <section class="intro">
      <h2>Select Your Photos</h2>
      <p>Choose a gallery below to view and purchase your photos.</p>
    </section>

    <section class="gallery-grid">
      ${state.galleries.map((gallery) => `
        <article class="gallery-card">
          <div class="gallery-card-image-wrap">
            <img
              src="${escapeHtml(gallery.cover || "")}"
              alt="${escapeHtml(gallery.title)}"
              class="gallery-card-image"
            />
          </div>
          <div class="gallery-card-content">
            <h3>${escapeHtml(gallery.title)}</h3>
            <p>${gallery.photos.length} photos</p>
            <button class="gallery-card-button open-gallery-btn" data-id="${gallery.id}" type="button">
              Open Gallery
            </button>
          </div>
        </article>
      `).join("")}
    </section>
  `;

  document.querySelectorAll(".open-gallery-btn").forEach((button) => {
    button.onclick = () => {
      state.selectedGalleryId = button.dataset.id;
      state.view = "gallery";
      render();
    };
  });
}

function renderGallery(app) {
  const gallery = getSelectedGallery();

  if (!gallery) {
    state.selectedGalleryId = null;
    state.view = "galleries";
    render();
    return;
  }

  app.innerHTML = `
    <section class="intro">
      <button id="backToGalleriesBtn" class="back-button" type="button">← Back</button>
      <h2 style="margin-top:8px;">${escapeHtml(gallery.title)}</h2>
      <p>${escapeHtml(state.user.name)} — select your photos below.</p>
    </section>

    <section class="photo-grid">
      ${gallery.photos.map((photo) => `
        <article class="photo-card">
          <div class="photo-card-image-wrap">
            <img
              src="${escapeHtml(photo.image)}"
              alt="${escapeHtml(photo.photoNumber)}"
              class="photo-card-image"
            />
          </div>
          <div class="photo-card-content photo-card-compact-content">
            <h3 class="photo-card-number">${escapeHtml(photo.photoNumber)}</h3>
            <div class="photo-card-action-row">
              <span class="photo-card-price">$${Number(photo.price).toFixed(2)}</span>
              <button
                class="select-btn photo-select-btn photo-inline-btn"
                data-id="${photo.id}"
                type="button"
              >
                ${isInCart(photo.id) ? "Remove" : "Add to Cart"}
              </button>
            </div>
          </div>
        </article>
      `).join("")}
    </section>
  `;

  document.getElementById("backToGalleriesBtn").onclick = () => {
    state.selectedGalleryId = null;
    state.view = "galleries";
    render();
  };

  document.querySelectorAll(".photo-select-btn").forEach((button) => {
    button.onclick = () => {
      toggleCart(button.dataset.id);
    };
  });
}

function renderCheckout(app) {
  const total = getCartTotal();

  app.innerHTML = `
    <section class="intro">
      <button id="backFromCheckoutBtn" class="back-button" type="button">← Back</button>
      <h2 style="margin-top:8px;">Checkout</h2>
      <p>Please confirm your details and complete payment with PayPal.</p>
    </section>

    <div class="checkout-box">
      <h3>Your Order</h3>
      <ul>
        ${state.cart.map((photo) => `
          <li>${escapeHtml(photo.photoNumber || photo.title)} - $${Number(photo.price).toFixed(2)}</li>
        `).join("")}
      </ul>

      <p><strong>Total: $${total.toFixed(2)}</strong></p>

      <input id="checkoutName" type="text" placeholder="Your Name" value="${escapeHtml(state.user?.name || "")}" />
      <input id="checkoutPhone" type="text" placeholder="Phone Number" value="${escapeHtml(state.user?.phone || "")}" />
      <input id="checkoutEmail" type="email" placeholder="Email Address" value="${escapeHtml(state.user?.email || "")}" />

      <div id="paypalStatus" style="margin-top:16px;color:#6b7280;">
        ${state.paypalError ? escapeHtml(state.paypalError) : "Loading PayPal..."}
      </div>

      <div id="paypal-button-container" style="margin-top:16px;"></div>
    </div>
  `;

  document.getElementById("backFromCheckoutBtn").onclick = () => {
    if (state.selectedGalleryId) {
      state.view = "gallery";
    } else {
      state.view = "galleries";
    }
    render();
  };

  mountPayPalButtons();
}

function renderConfirmation(app) {
  app.innerHTML = `
    <section class="intro">
      <h2>Payment Received</h2>
      <p>Thank you ${escapeHtml(state.user?.name || "")}. Your PayPal payment has been received and your order has been saved.</p>
    </section>

    <div class="checkout-box">
      <p><strong>PayPal Order ID:</strong></p>
      <p>${escapeHtml(state.lastPayPalOrderId || "—")}</p>

      <p style="margin-top:12px;"><strong>PayPal Capture ID:</strong></p>
      <p>${escapeHtml(state.lastPayPalCaptureId || "—")}</p>

      <button id="backHomeBtn" type="button">Back to Galleries</button>
    </div>
  `;

  document.getElementById("backHomeBtn").onclick = () => {
    state.cart = [];
    saveCart();
    state.selectedGalleryId = null;
    state.view = "galleries";
    render();
  };
}

function toggleCart(photoId) {
  if (isInCart(photoId)) {
    state.cart = state.cart.filter((photo) => photo.id !== photoId);
  } else {
    const gallery = getSelectedGallery();
    if (!gallery) return;

    const photo = gallery.photos.find((item) => item.id === photoId);
    if (photo) {
      state.cart.push(photo);
    }
  }

  saveCart();
  render();
}

function renderCart() {
  let cart = document.getElementById("cart");

  if (!cart) {
    cart = document.createElement("div");
    cart.id = "cart";
    document.body.appendChild(cart);
  }

  const total = getCartTotal();

  cart.innerHTML = `
    <div class="cart-box">
      <h3>Cart (${state.cart.length})</h3>
      <p>Total: $${total.toFixed(2)}</p>
      <button id="checkoutBtn" type="button">Checkout</button>
      <button id="clearCartBtn" type="button">Clear</button>
    </div>
  `;

  document.getElementById("clearCartBtn").onclick = () => {
    state.cart = [];
    saveCart();
    render();
  };

  document.getElementById("checkoutBtn").onclick = () => {
    if (state.cart.length === 0) return;
    if (!state.user) {
      state.view = "welcome";
    } else {
      state.view = "checkout";
    }
    render();
  };
}

function getCheckoutFields() {
  const nameInput = document.getElementById("checkoutName");
  const phoneInput = document.getElementById("checkoutPhone");
  const emailInput = document.getElementById("checkoutEmail");

  if (!nameInput || !phoneInput || !emailInput) {
    throw new Error("Checkout form is missing.");
  }

  const name = nameInput.value.trim();
  const phone = phoneInput.value.trim();
  const email = emailInput.value.trim();

  if (!name || !phone || !email) {
    throw new Error("Please complete all fields.");
  }

  if (state.cart.length === 0) {
    throw new Error("Your cart is empty.");
  }

  return { name, phone, email };
}

async function mountPayPalButtons() {
  const statusEl = document.getElementById("paypalStatus");
  const container = document.getElementById("paypal-button-container");

  if (!statusEl || !container || state.view !== "checkout") {
    return;
  }

  container.innerHTML = "";
  statusEl.textContent = "Loading PayPal...";

  try {
    await loadPayPalSdk();

    await window.paypal
      .Buttons({
        style: {
          layout: "vertical",
          shape: "rect",
          label: "paypal"
        },

        createOrder(data, actions) {
          try {
            getCheckoutFields();
          } catch (error) {
            statusEl.textContent = error.message;
            return Promise.reject(error);
          }

          statusEl.textContent = "";

          return actions.order.create({
            purchase_units: [
              {
                amount: {
                  currency_code: "NZD",
                  value: getCartTotal().toFixed(2)
                }
              }
            ]
          });
        },

        async onApprove(data, actions) {
          statusEl.textContent = "Processing PayPal payment...";

          const details = await actions.order.capture();
          const captureId =
            details &&
            details.purchase_units &&
            details.purchase_units[0] &&
            details.purchase_units[0].payments &&
            details.purchase_units[0].payments.captures &&
            details.purchase_units[0].payments.captures[0] &&
            details.purchase_units[0].payments.captures[0].id
              ? details.purchase_units[0].payments.captures[0].id
              : "";

          await submitOrder({
            paymentMethod: "paypal",
            paymentStatus: "paid",
            paypalOrderId: data.orderID || "",
            paypalCaptureId: captureId || "",
            paypalPayerId: data.payerID || ""
          });

          statusEl.textContent = "";
        },

        onCancel() {
          statusEl.textContent = "PayPal checkout cancelled.";
        },

        onError(error) {
          console.error("PayPal error:", error);
          statusEl.textContent = "PayPal could not start.";
        }
      })
      .render("#paypal-button-container");

    statusEl.textContent = "";
  } catch (error) {
    console.error("PayPal setup error:", error);
    state.paypalError = error.message || "PayPal could not load.";
    statusEl.textContent = state.paypalError;
  }
}

async function submitOrder(paymentData) {
  if (!supabaseClient) {
    alert("Supabase is not connected.");
    return;
  }

  let checkout;
  try {
    checkout = getCheckoutFields();
  } catch (error) {
    alert(error.message);
    return;
  }

  const { name, phone, email } = checkout;
  const total = getCartTotal();

  state.user = { ...(state.user || {}), name, phone, email };
  saveUser(state.user);

  state.savingOrder = true;
  render();

  const orderId = crypto.randomUUID();

  try {
    const { error: orderError } = await supabaseClient
      .from("pe_orders")
      .insert([
        {
          id: orderId,
          customer_name: name,
          customer_email: email,
          total_amount: total,
          payment_status: paymentData.paymentStatus || "paid",
          payment_method: paymentData.paymentMethod || "paypal",
          notes:
            `Phone: ${phone}` +
            `${state.user?.id ? ` | Visitor ID: ${state.user.id}` : ""}` +
            `${paymentData.paypalOrderId ? ` | PayPal Order ID: ${paymentData.paypalOrderId}` : ""}` +
            `${paymentData.paypalCaptureId ? ` | PayPal Capture ID: ${paymentData.paypalCaptureId}` : ""}` +
            `${paymentData.paypalPayerId ? ` | PayPal Payer ID: ${paymentData.paypalPayerId}` : ""}`
        }
      ]);

    if (orderError) {
      throw orderError;
    }

    const orderItems = state.cart.map((item) => ({
      order_id: orderId,
      photo_id: item.id,
      photo_title: item.photoNumber || item.title,
      unit_price: Number(item.price)
    }));

    const { error: itemsError } = await supabaseClient
      .from("pe_order_items")
      .insert(orderItems);

    if (itemsError) {
      throw itemsError;
    }

    state.lastPayPalOrderId = paymentData.paypalOrderId || "";
    state.lastPayPalCaptureId = paymentData.paypalCaptureId || "";

    state.savingOrder = false;
    state.view = "confirmation";
    render();
  } catch (error) {
    console.error("Submit order error:", error);
    state.savingOrder = false;
    render();
    alert(
      "PayPal payment may have succeeded, but the order could not be saved. " +
      (paymentData.paypalOrderId ? `PayPal Order ID: ${paymentData.paypalOrderId}` : "")
    );
  }
}

async function loadData() {
  if (!supabaseClient) {
    render();
    return;
  }

  state.loading = true;
  state.error = "";
  render();

  try {
    const { data: galleriesData, error: galleriesError } = await supabaseClient
      .from("pe_galleries")
      .select("*")
      .eq("is_live", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (galleriesError) {
      throw galleriesError;
    }

    const { data: photosData, error: photosError } = await supabaseClient
      .from("pe_photos")
      .select("*")
      .eq("is_live", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (photosError) {
      throw photosError;
    }

    const safeGalleries = Array.isArray(galleriesData) ? galleriesData : [];
    const safePhotos = Array.isArray(photosData) ? photosData : [];

    state.galleries = safeGalleries.map((gallery) => {
      const photos = safePhotos
        .filter((photo) => photo.gallery_id === gallery.id)
        .map((photo) => {
          const photoNumber = cleanPhotoNumber(
            photo.file_path ||
              photo.title ||
              photo.name ||
              photo.image_url
          );

          return {
            id: photo.id,
            title: photo.title || photo.name || "Photo",
            photoNumber: photoNumber || photo.title || photo.name || "Photo",
            price: Number(photo.price || 0),
            image: photo.image_url || ""
          };
        });

      return {
        id: gallery.id,
        title: gallery.title || gallery.name || gallery.gallery_name || "Gallery",
        cover: gallery.cover_image_url || gallery.cover || (photos[0] ? photos[0].image : ""),
        photos
      };
    });

    state.loading = false;

    if (!state.user) {
      state.view = "welcome";
    } else if (state.selectedGalleryId) {
      state.view = "gallery";
    } else {
      state.view = "galleries";
    }

    render();
  } catch (error) {
    console.error("Load data error:", error);
    state.loading = false;
    state.error = "Could not load galleries.";
    render();
  }
}

async function initApp() {
  await createSupabaseClient();
  state.user = loadUser();
  state.cart = loadCart();
  renderCart();
  await loadData();
}

initApp();