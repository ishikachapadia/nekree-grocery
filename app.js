const API_OVERRIDE = localStorage.getItem("groceryLabApi");
const API_CANDIDATES = [
  API_OVERRIDE,
  "https://grocery.nekree.com",
  "http://localhost:8001",
]
  .filter(Boolean)
  .map((base) => String(base).replace(/\/+$/, ""));

let API_BASE = API_CANDIDATES[0] || "https://grocery.nekree.com";

const state = {
  postalCode: localStorage.getItem("groceryLabPostal") || "",
  radiusKm: Number(localStorage.getItem("groceryLabRadius") || 8),
  stores: [],
  selectedCategory: null,
  expandedCategories: new Set(),
  query: "",
  page: 1,
  pageSize: 20,
  total: 0,
  mealItems: new Map(),
  productLoadController: null,
  pendingRequests: 0,
  selectedCategoryName: "",
};

const elements = {
  modal: document.getElementById("location-modal"),
  postalInput: document.getElementById("postal-input"),
  radiusInput: document.getElementById("radius-input"),
  saveLocation: document.getElementById("save-location"),
  locationError: document.getElementById("location-error"),
  changeLocation: document.getElementById("change-location"),
  categories: document.getElementById("categories"),
  products: document.getElementById("products"),
  searchInput: document.getElementById("search-input"),
  searchBtn: document.getElementById("search-btn"),
  postalPill: document.getElementById("postal-pill"),
  radiusPill: document.getElementById("radius-pill"),
  storesPill: document.getElementById("stores-pill"),
  modePill: document.getElementById("mode-pill"),
  prevPage: document.getElementById("prev-page"),
  nextPage: document.getElementById("next-page"),
  pageLabel: document.getElementById("page-label"),
  mealLines: document.getElementById("meal-lines"),
  mealTotals: document.getElementById("meal-totals"),
  recalcMeal: document.getElementById("recalc-meal"),
  mealLoading: document.getElementById("meal-loading"),
  loadingIndicator: document.getElementById("loading-indicator"),
  clearCategory: document.getElementById("clear-category"),
};

function formatMoney(value) {
  if (value == null) return "-";
  return `$${Number(value).toFixed(2)}`;
}

function normalizePostal(input) {
  return String(input || "").toUpperCase().replace(/\s+/g, "");
}

function normalizeUnit(unit) {
  const raw = String(unit || "").trim().toLowerCase();
  const aliases = {
    gram: "g",
    grams: "g",
    milliliter: "ml",
    milliliters: "ml",
    millilitre: "ml",
    millilitres: "ml",
  };
  return aliases[raw] || raw;
}

function readableUnit(unit) {
  const normalized = normalizeUnit(unit);
  return normalized || "qty";
}

function updateHeaderPills() {
  elements.postalPill.textContent = state.postalCode || "-";
  elements.radiusPill.textContent = `${state.radiusKm} km`;
  elements.storesPill.textContent = String(state.stores.length);
  elements.pageLabel.textContent = `Page ${state.page}`;
}

function currentMode() {
  if (state.query && state.selectedCategoryName) return `Search: ${state.query} in ${state.selectedCategoryName}`;
  if (state.query && state.selectedCategory) return `Search: ${state.query} in ${state.selectedCategory}`;
  if (state.selectedCategoryName) return `Category: ${state.selectedCategoryName}`;
  if (state.selectedCategory) return `Category ${state.selectedCategory}`;
  if (state.query) return `Search: ${state.query}`;
  return "Browse";
}

function setModeLabel() {
  elements.modePill.textContent = currentMode();
}

function refreshLoadingOverlay() {
  const isLoading = state.pendingRequests > 0;
  if (elements.loadingIndicator) {
    elements.loadingIndicator.classList.toggle("hidden", !isLoading);
  }
  document.body.classList.toggle("is-loading", isLoading);
}

async function fetchJSON(url, options = {}) {
  state.pendingRequests += 1;
  refreshLoadingOverlay();

  let res;
  try {
    res = await fetch(url, options);
  } finally {
    state.pendingRequests = Math.max(0, state.pendingRequests - 1);
    refreshLoadingOverlay();
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body.detail) message = body.detail;
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }
  return res.json();
}

async function resolveApiBase() {
  for (const candidate of API_CANDIDATES) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${candidate}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        API_BASE = candidate;
        return;
      }
    } catch {
      // Try the next candidate host.
    }
  }
  throw new Error("API host unreachable. Check grocery.nekree.com DNS or set localStorage groceryLabApi.");
}

async function loadStores() {
  const params = new URLSearchParams({
    postal_code: state.postalCode,
    radius_km: String(state.radiusKm),
  });
  const data = await fetchJSON(`${API_BASE}/v1/stores/within-radius?${params.toString()}`);
  state.stores = data.stores || [];
  updateHeaderPills();
}

function categoryNode(node) {
  const wrapper = document.createElement("div");
  wrapper.className = "category-item";

  const row = document.createElement("div");
  row.className = "category-row";

  const hasChildren = !!(node.children && node.children.length);
  const expanded = state.expandedCategories.has(node.code);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "cat-toggle";
  toggle.textContent = hasChildren ? (expanded ? "▾" : "▸") : "";
  toggle.disabled = !hasChildren;
  toggle.onclick = (ev) => {
    ev.stopPropagation();
    if (!hasChildren) return;
    if (expanded) {
      state.expandedCategories.delete(node.code);
    } else {
      state.expandedCategories.add(node.code);
    }
    renderCategories(window.__categoryTree || []);
  };

  const button = document.createElement("div");
  button.className = "category-node";
  if (state.selectedCategory === node.code) button.classList.add("active");
  button.textContent = `${node.name} (${node.product_count})`;
  button.onclick = () => {
    if (!hasChildren) return;
    if (expanded) state.expandedCategories.delete(node.code);
    else state.expandedCategories.add(node.code);
    renderCategories(window.__categoryTree || []);
  };

  const selectButton = document.createElement("button");
  selectButton.type = "button";
  selectButton.className = "category-select";
  if (state.selectedCategory === node.code) selectButton.classList.add("active");
  selectButton.textContent = state.selectedCategory === node.code ? "Selected" : "Use";
  selectButton.onclick = (ev) => {
    ev.stopPropagation();
    state.selectedCategory = node.code;
    state.selectedCategoryName = node.name;
    setModeLabel();
    renderCategories(window.__categoryTree || []);
  };

  row.appendChild(toggle);
  row.appendChild(button);
  row.appendChild(selectButton);
  wrapper.appendChild(row);

  if (hasChildren && expanded) {
    const kids = document.createElement("div");
    kids.className = "category-children";
    node.children.forEach((child) => kids.appendChild(categoryNode(child)));
    wrapper.appendChild(kids);
  }

  return wrapper;
}

function renderCategories(tree) {
  elements.categories.innerHTML = "";
  tree.slice(0, 120).forEach((root) => elements.categories.appendChild(categoryNode(root)));
}

async function loadCategories() {
  const data = await fetchJSON(`${API_BASE}/v1/categories/tree`);
  window.__categoryTree = data.tree || [];
  state.expandedCategories.clear();
  renderCategories(window.__categoryTree);
}

function renderCard(product) {
  const card = document.createElement("article");
  card.className = "product-card";

  const image = product.image_url || "https://via.placeholder.com/300x180?text=No+Image";
  const detailsHref = `product.html?code=${encodeURIComponent(product.code)}`;

  card.innerHTML = `
    <img src="${image}" alt="${product.name}" loading="lazy" />
    <div class="product-title">${product.name}</div>
    <div class="muted">${product.brand || "Unknown brand"}</div>
    <div class="muted">${product.package_size || ""}</div>
    <div class="price-slot"></div>
    <div class="store-switches"></div>
    <div class="card-actions">
      <button class="add-meal">Add To Meal</button>
      <a class="link-btn" href="${detailsHref}">Details</a>
    </div>
  `;

  const priceSlot = card.querySelector(".price-slot");
  const switchRow = card.querySelector(".store-switches");

  const setOffer = (offer) => {
    const price = offer.deal_price != null ? `<span class="deal">${formatMoney(offer.deal_price)}</span> <s>${formatMoney(offer.price)}</s>` : formatMoney(offer.price);
    const label = (offer.store_name || offer.banner || offer.store_id || "Store").trim();
    priceSlot.innerHTML = `<div class="price">${price}</div><div class="muted">${label} • ${offer.distance_km} km</div>`;
  };

  const offers = (product.offers || []).map((offer) => ({
    ...offer,
    store_name: String(offer.store_name || "").trim(),
    banner: String(offer.banner || "").trim(),
  }));
  if (offers.length) {
    setOffer(offers[0]);
  }

  offers.slice(0, 7).forEach((offer, idx) => {
    const pill = document.createElement("button");
    pill.className = `store-pill ${idx === 0 ? "active" : "inactive"}`;
    pill.textContent = offer.store_name || offer.banner || offer.store_id || `Store ${idx + 1}`;
    pill.onclick = () => {
      switchRow.querySelectorAll(".store-pill").forEach((el) => el.classList.remove("active"));
      switchRow.querySelectorAll(".store-pill").forEach((el) => el.classList.add("inactive"));
      pill.classList.remove("inactive");
      pill.classList.add("active");
      setOffer(offer);
    };
    switchRow.appendChild(pill);
  });

  card.querySelector(".add-meal").onclick = () => {
    const existing = state.mealItems.get(product.code) || {
      ...product,
      quantity_unit: normalizeUnit(product.recommended_quantity_unit || product.serving_size_unit || product.package_size_unit || "g"),
      quantity: Number(product.serving_size_amt || 100),
    };
    existing.quantity = Number(existing.quantity || 0) + Number(product.serving_size_amt || 25);
    state.mealItems.set(product.code, existing);
    renderMealItems();
  };

  return card;
}

function renderProducts(products) {
  elements.products.innerHTML = "";
  if (!products.length) {
    elements.products.innerHTML = '<p class="muted">No products found with current filters.</p>';
    return;
  }

  products.forEach((product) => elements.products.appendChild(renderCard(product)));
}

async function loadProducts() {
  if (!state.postalCode) return;

  if (state.productLoadController) {
    state.productLoadController.abort();
  }
  state.productLoadController = new AbortController();

  const params = new URLSearchParams({
    postal_code: state.postalCode,
    radius_km: String(state.radiusKm),
    page: String(state.page),
    page_size: String(state.pageSize),
  });

  if (state.selectedCategory) params.set("category_code", state.selectedCategory);
  if (state.query) params.set("query", state.query);

  let data;
  try {
    elements.searchBtn.disabled = true;
    data = await fetchJSON(`${API_BASE}/v1/products/explore?${params.toString()}`, {
      signal: state.productLoadController.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") return;
    throw err;
  } finally {
    elements.searchBtn.disabled = false;
  }
  state.total = data.total || 0;
  state.stores = data.stores || state.stores;

  updateHeaderPills();
  setModeLabel();
  renderProducts(data.products || []);
}

function renderMealItems() {
  elements.mealLines.innerHTML = "";

  if (!state.mealItems.size) {
    elements.mealLines.innerHTML = '<p class="muted">No items yet. Add from product cards.</p>';
    elements.mealTotals.innerHTML = "";
    return;
  }

  state.mealItems.forEach((item, code) => {
    const unitLabel = readableUnit(item.quantity_unit);
    const row = document.createElement("div");
    row.className = "meal-item";
    row.innerHTML = `
      <strong>${item.name}</strong>
      <div class="muted">${item.brand || ""}</div>
      <label>Quantity (g or ml)
        <input type="number" min="1" step="1" value="${item.quantity}" data-code="${code}" class="meal-qty" />
      </label>
      <div class="muted">Using unit: ${unitLabel}</div>
      <button data-remove="${code}" class="ghost-btn">Remove</button>
    `;
    elements.mealLines.appendChild(row);
  });

  elements.mealLines.querySelectorAll(".meal-qty").forEach((input) => {
    input.addEventListener("change", (ev) => {
      const code = ev.target.getAttribute("data-code");
      const item = state.mealItems.get(code);
      if (!item) return;
      item.quantity = Math.max(1, Number(ev.target.value || 1));
      state.mealItems.set(code, item);
    });
  });

  elements.mealLines.querySelectorAll("button[data-remove]").forEach((button) => {
    button.addEventListener("click", (ev) => {
      const code = ev.target.getAttribute("data-remove");
      state.mealItems.delete(code);
      renderMealItems();
    });
  });
}

async function recalcMeal() {
  if (!state.mealItems.size) return;

  const items = Array.from(state.mealItems.values()).map((item) => ({
    code: item.code,
    quantity: item.quantity,
    quantity_unit: item.quantity_unit,
  }));

  const payload = {
    postal_code: state.postalCode,
    radius_km: state.radiusKm,
    items,
  };

  if (elements.mealLoading) elements.mealLoading.classList.remove("hidden");
  elements.recalcMeal.disabled = true;

  let data;
  try {
    data = await fetchJSON(`${API_BASE}/v1/meals/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } finally {
    if (elements.mealLoading) elements.mealLoading.classList.add("hidden");
    elements.recalcMeal.disabled = false;
  }

  const totals = data.totals || {};
  elements.mealTotals.innerHTML = `
    <div><strong>Est. Cost:</strong> ${formatMoney(totals.estimated_cost || 0)}</div>
    <div><strong>Calories:</strong> ${Number(totals.calories || 0).toFixed(2)}</div>
    <div><strong>Protein:</strong> ${Number(totals.protein || 0).toFixed(2)} g</div>
    <div><strong>Carbs:</strong> ${Number(totals.carbs || 0).toFixed(2)} g</div>
    <div><strong>Fat:</strong> ${Number(totals.fat || 0).toFixed(2)} g</div>
  `;
}

function bindEvents() {
  elements.changeLocation.onclick = () => elements.modal.classList.add("open");

  elements.saveLocation.onclick = async () => {
    try {
      elements.locationError.textContent = "";
      const postal = normalizePostal(elements.postalInput.value);
      const radius = Number(elements.radiusInput.value || 8);
      if (!postal) throw new Error("Postal code is required");

      state.postalCode = postal;
      state.radiusKm = Math.max(1, Math.min(200, radius));
      state.page = 1;

      localStorage.setItem("groceryLabPostal", state.postalCode);
      localStorage.setItem("groceryLabRadius", String(state.radiusKm));

      await loadStores();
      await loadProducts();
      elements.modal.classList.remove("open");
    } catch (err) {
      elements.locationError.textContent = err.message || "Could not load stores";
    }
  };

  elements.searchBtn.onclick = () => {
    state.query = elements.searchInput.value.trim();
    state.page = 1;
    loadProducts();
  };

  elements.searchInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      elements.searchBtn.click();
    }
  });

  elements.clearCategory.onclick = () => {
    state.selectedCategory = null;
    state.selectedCategoryName = "";
    setModeLabel();
    renderCategories(window.__categoryTree || []);
  };

  elements.prevPage.onclick = () => {
    if (state.page > 1) {
      state.page -= 1;
      loadProducts();
    }
  };

  elements.nextPage.onclick = () => {
    const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
    if (state.page < pages) {
      state.page += 1;
      loadProducts();
    }
  };

  elements.recalcMeal.onclick = recalcMeal;
}

async function init() {
  bindEvents();
  await resolveApiBase();
  await loadCategories();

  elements.postalInput.value = state.postalCode;
  elements.radiusInput.value = String(state.radiusKm);

  if (state.postalCode) {
    elements.modal.classList.remove("open");
    await loadStores();
    await loadProducts();
  }

  updateHeaderPills();
  setModeLabel();
  renderMealItems();
}

init().catch((err) => {
  console.error(err);
  elements.locationError.textContent = err.message || "Initialization error";
});