const API_OVERRIDE = localStorage.getItem("groceryLabApi");
const API_CANDIDATES = [
  API_OVERRIDE,
  "https://grocery.nekree.com",
  "http://localhost:8001",
]
  .filter(Boolean)
  .map((base) => String(base).replace(/\/+$/, ""));

let API_BASE = API_CANDIDATES[0] || "https://grocery.nekree.com";

const params = new URLSearchParams(window.location.search);
const code = params.get("code");
const postalCode = localStorage.getItem("groceryLabPostal") || "";
const radiusKm = Number(localStorage.getItem("groceryLabRadius") || 8);

const productName = document.getElementById("product-name");
const summary = document.getElementById("details-summary");
const summaryInfo = document.getElementById("details-summary-info");
const productImage = document.getElementById("product-image");
const nutritionTable = document.getElementById("nutrition-table");
const offersList = document.getElementById("offers-list");
const loadingIndicator = document.getElementById("loading-indicator");
const nutritionModeButtons = {
  default: document.getElementById("nutrition-mode-default"),
  per100: document.getElementById("nutrition-mode-per100"),
  package: document.getElementById("nutrition-mode-package"),
};

let currentNutrition = [];
let nutritionMode = "default";
let currentServingText = "Serving size not available";
let currentServingSize = null;
let currentPackageSize = null;
let pendingRequests = 0;

const DAILY_VALUES = {
  "Total Fat": 78,
  "Saturated Fat": 20,
  "Carbohydrate": 275,
  Fiber: 28,
  Sugar: 50,
  Sodium: 2300,
  Cholesterol: 300,
  Protein: 50,
};

const ROW_ORDER = [
  "Total Fat",
  "Saturated Fat",
  "Trans Fat",
  "Cholesterol",
  "Sodium",
  "Carbohydrate",
  "Fiber",
  "Sugar",
  "Protein",
  "Vitamin D",
  "Calcium",
  "Iron",
  "Potassium",
  "Vitamin A",
  "Vitamin C",
];

function formatMoney(value) {
  if (value == null) return "-";
  return `$${Number(value).toFixed(2)}`;
}

function formatValue(value) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return Number(value).toFixed(2);
}

function normalizeSizeUnit(unit) {
  const u = String(unit || "").trim().toLowerCase();
  const aliases = {
    grams: "g",
    gram: "g",
    kilograms: "kg",
    kilogram: "kg",
    milligrams: "mg",
    milligram: "mg",
    milliliters: "ml",
    milliliter: "ml",
    millilitres: "ml",
    millilitre: "ml",
    liters: "l",
    liter: "l",
    litres: "l",
    litre: "l",
  };
  return aliases[u] || u;
}

function parseSizeToBase(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;

  const u = normalizeSizeUnit(unit);
  if (u === "g") return { value: n, dimension: "mass" };
  if (u === "kg") return { value: n * 1000, dimension: "mass" };
  if (u === "mg") return { value: n / 1000, dimension: "mass" };
  if (u === "ml") return { value: n, dimension: "volume" };
  if (u === "l") return { value: n * 1000, dimension: "volume" };
  return null;
}

function parsePackageSizeText(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const match = raw.match(/([0-9]*\.?[0-9]+)\s*(kg|g|mg|l|ml)\b/i);
  if (!match) return null;
  return parseSizeToBase(Number(match[1]), match[2]);
}

function computeNutritionValueForMode(row, mode) {
  const amount = Number(row.amount);
  if (!Number.isFinite(amount)) return null;

  if (mode === "default") return amount;

  if (mode === "per100") {
    const apiValue = Number(row.per_100g);
    if (Number.isFinite(apiValue)) return apiValue;
    if (!currentServingSize || currentServingSize.value <= 0) return null;
    return (amount / currentServingSize.value) * 100;
  }

  if (mode === "package") {
    const apiValue = Number(row.total_in_package);
    if (Number.isFinite(apiValue)) return apiValue;
    if (!currentServingSize || !currentPackageSize) return null;
    if (currentServingSize.dimension !== currentPackageSize.dimension) return null;
    if (currentServingSize.value <= 0) return null;
    const servingsPerPackage = currentPackageSize.value / currentServingSize.value;
    return amount * servingsPerPackage;
  }

  return amount;
}

function dailyValuePercent(label, value) {
  const dv = DAILY_VALUES[label];
  if (!dv || value == null || Number.isNaN(Number(value))) return "-";
  return `${Math.round((Number(value) / dv) * 100)}%`;
}

async function fetchJSON(url) {
  pendingRequests += 1;
  if (loadingIndicator) loadingIndicator.classList.remove("hidden");

  let res;
  try {
    res = await fetch(url);
  } finally {
    pendingRequests = Math.max(0, pendingRequests - 1);
    if (loadingIndicator && pendingRequests === 0) {
      loadingIndicator.classList.add("hidden");
    }
  }

  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
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
      // Try next candidate
    }
  }
  throw new Error("API host unreachable.");
}

function renderNutrition(rows) {
  if (!rows?.length) {
    nutritionTable.innerHTML = '<p class="muted">No nutrition values available.</p>';
    return;
  }

  const pickedValue = (row) => {
    return computeNutritionValueForMode(row, nutritionMode);
  };

  const visibleRows = rows.filter((row) => {
    const value = pickedValue(row);
    return value != null && !Number.isNaN(Number(value));
  });

  if (!visibleRows.length) {
    nutritionTable.innerHTML = '<p class="muted">No nutrition values available for this mode.</p>';
    return;
  }

  const caloriesRow = visibleRows.find((row) => row.label === "Calories") || null;
  const otherRows = visibleRows.filter((row) => row.label !== "Calories");
  const sortedRows = [
    ...otherRows.sort((a, b) => {
      const ai = ROW_ORDER.indexOf(a.label);
      const bi = ROW_ORDER.indexOf(b.label);
      const av = ai === -1 ? 999 : ai;
      const bv = bi === -1 ? 999 : bi;
      return av - bv;
    }),
  ];

  const rowsHtml = sortedRows
    .map((row) => {
      const value = pickedValue(row);
      const unit = row.unit || "";
      const dv = dailyValuePercent(row.label, value);
      return `
        <div class="nutrition-row nutrition-row-tight ${row.label === "Saturated Fat" || row.label === "Trans Fat" || row.label === "Fiber" || row.label === "Sugar" ? "nutrition-subrow" : ""}">
          <div class="nutrition-name">${row.label}</div>
          <div class="nutrition-value">${formatValue(value)} ${unit}</div>
          <div class="nutrition-dv">${dv}</div>
        </div>
      `;
    })
    .join("");

  const caloriesHtml = caloriesRow
    ? `
      <div class="nutrition-calories-row">
        <div class="nutrition-name">Calories</div>
        <div class="nutrition-calories-value">${formatValue(pickedValue(caloriesRow))}</div>
      </div>
    `
    : "";

  const servingLabel = nutritionMode === "default"
    ? `Serving size ${currentServingText}`
    : nutritionMode === "per100"
      ? "Serving size Per 100g"
      : "Serving size Total package";

  nutritionTable.innerHTML = `
    <div class="nutrition-label nutrition-label-classic">
      <div class="nutrition-title">Nutrition Facts</div>
      <div class="nutrition-serving">${servingLabel}</div>
      <div class="nutrition-divider-thick"></div>
      ${caloriesHtml}
      <div class="nutrition-divider-thick"></div>
      <div class="nutrition-col-head"><span>Amount per serving</span><span>% Daily Value*</span></div>
      ${rowsHtml}
      <div class="nutrition-footnote">* Percent Daily Value is based on a 2,000 calorie diet.</div>
      <div class="nutrition-divider-thick"></div>
    </div>
  `;
}

function setNutritionMode(mode) {
  nutritionMode = mode;
  Object.entries(nutritionModeButtons).forEach(([key, button]) => {
    if (!button) return;
    if (key === mode) button.classList.add("active");
    else button.classList.remove("active");
  });
  renderNutrition(currentNutrition);
}

function renderOffers(offers) {
  if (!offers?.length) {
    offersList.innerHTML = '<p class="muted">No nearby offers found.</p>';
    return;
  }

  offersList.innerHTML = offers
    .map(
      (o) => `
      <div class="offer-row">
        <div>${o.store_name || o.banner || o.store_id}</div>
        <div>${o.distance_km != null ? `${o.distance_km} km` : "-"}</div>
        <div>${o.deal_price != null ? `<span class="deal">${formatMoney(o.deal_price)}</span> <s>${formatMoney(o.price)}</s>` : formatMoney(o.price)}</div>
      </div>
    `
    )
    .join("");
}

async function init() {
  await resolveApiBase();

  if (!code) {
    productName.textContent = "Missing product code";
    return;
  }

  const query = new URLSearchParams({
    postal_code: postalCode,
    radius_km: String(radiusKm),
  });

  const data = await fetchJSON(`${API_BASE}/v1/products/${encodeURIComponent(code)}?${query.toString()}`);
  const p = data.product || {};
  currentNutrition = data.nutrition || [];
  currentServingText = p.servingSize || (p.servingSizeAmt && p.servingSizeUnit ? `${formatValue(p.servingSizeAmt)} ${p.servingSizeUnit}` : "Serving size not available");
  currentServingSize = parseSizeToBase(p.servingSizeAmt, p.servingSizeUnit);
  currentPackageSize = parseSizeToBase(p.packageSizeAmt, p.packageSizeUnit) || parsePackageSizeText(p.packageSize);

  productName.textContent = p.name || code;
  const imageUrl = p.defaultImageUrl || "https://via.placeholder.com/460x300?text=No+Image";
  if (productImage) {
    productImage.src = imageUrl;
    productImage.style.display = "block";
    productImage.onerror = () => {
      productImage.src = "https://via.placeholder.com/460x300?text=No+Image";
    };
  } else if (summary) {
    summary.insertAdjacentHTML(
      "afterbegin",
      `<img class="product-detail-image" src="${imageUrl}" alt="${p.name || code}" loading="lazy" onerror="this.src='https://via.placeholder.com/460x300?text=No+Image'" />`
    );
  }

  summaryInfo.innerHTML = `
    <h2>${p.name || "Unknown Product"}</h2>
    <p class="muted">${p.brand || ""}</p>
    <p><strong>Code:</strong> ${p.code || code}</p>
    <p><strong>Package:</strong> ${p.packageSize || "-"}</p>
    <p><strong>Serving:</strong> ${formatValue(p.servingSizeAmt)} ${p.servingSizeUnit || ""}</p>
    <p><strong>Description:</strong> ${p.description || "No description"}</p>
    <p><strong>Categories:</strong> ${(p.categoryNames || []).join(", ") || "-"}</p>
  `;

  Object.entries(nutritionModeButtons).forEach(([key, button]) => {
    if (!button) return;
    button.onclick = () => setNutritionMode(key);
  });

  setNutritionMode("default");
  renderOffers(data.offers || []);
}

init().catch((err) => {
  console.error(err);
  productName.textContent = "Failed to load product";
});
