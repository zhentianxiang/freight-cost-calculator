const state = {
  schemes: ["默认"],
  cargo: [],
  freight: [],
  portCharges: []
};

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const money = (value) => `¥${fmt.format(Math.round(value || 0))}`;
const currencySymbols = { USD: "USD", RMB: "RMB", EUR: "EUR" };
const pct = (value) => `${(Number.isFinite(value) ? value : 0).toFixed(2)}%`;
const cleanNum = (value) => Number.parseFloat(value) || 0;
const escapeXml = (value) => String(value ?? "").replace(/[<>&"']/g, (ch) => ({
  "<": "&lt;",
  ">": "&gt;",
  "&": "&amp;",
  "\"": "&quot;",
  "'": "&apos;"
})[ch]);
const escapeMd = (value) => String(value ?? "").replace(/\|/g, "\\|");
const defaultScheme = "默认";
const storageDraftKey = "quote-calculator-draft";
const piStorageDraftKey = "pi-invoice-draft-v2";
const autosaveDelayMs = 3000;
const supportedQuoteTerms = new Set(["CFR", "FOB", "CIF", "DAP", "DDP"]);
const supportedPiTerms = new Set(["CFR", "FOB", "CIF", "DAP", "DDP", "EXW"]);
let pendingDownloadType = "";
let autosaveTimer = 0;
let lastSavedSignature = "";
let toastTimer = 0;
let calculationRequestId = 0;
let latestCalculationResult = null;
let currentArchiveId = "";
let summaryRefreshTimer = 0;

const piDefaultTerms = `1. This PI becomes binding after buyer's written acceptance and seller's receipt of agreed deposit or full payment.
2. Production and shipment schedules are counted from the date cleared funds are received in seller's bank account.
3. Natural marble and stone may vary in veining, color tone, texture, mineral lines, pinholes and natural repair.
4. Buyer shall approve drawings, renderings, models, stone selection photos or production photos where applicable.
5. Seller shall use export-standard packing. Risk transfer follows agreed Incoterms 2020.
6. Buyer is responsible for import license, customs clearance, duties, taxes, storage and destination charges unless included under agreed Incoterms.
7. Customized marble and stone sculptures are made-to-order. Deposit is non-refundable after production starts except for seller's material breach.
8. Prices, bank details, drawings, private designs and commercial terms are confidential.`;

const piState = {
  items: [
    { product: "Marble Horse Sculpture / 大理石马雕塑", material: "Natural marble", finish: "Hand carved / polished", size: "2.1 x 0.5 x 2.1 m", qty: 5, unit: "set", unitPrice: 5920, remarks: "Custom design per approved drawing/photo" },
    { product: "Stainless Steel Falcon / 不锈钢猎鹰", material: "Stainless steel", finish: "Mirror polished", size: "3 x 0.8 x 2 m", qty: 1, unit: "set", unitPrice: 5900, remarks: "Actual shipment size" }
  ]
};

function cargoTax(row) {
  return cleanNum(row.unitPrice) * cleanNum(row.qty) * cleanNum(row.taxRate) / 100;
}

function cargoTotal(row) {
  return cleanNum(row.unitPrice) * cleanNum(row.qty) + cargoTax(row);
}

function cargoVolumeCbm(row) {
  const qty = cleanNum(row.qty);
  const length = cleanNum(row.length);
  const height = cleanNum(row.height);
  const width = cleanNum(row.width);
  if (!qty || !length || !height || !width) return 0;
  return length * height * width / 1000000 * qty;
}

function cargoWeightKg(row) {
  return cleanNum(row.weight) * cleanNum(row.qty);
}

function cargoStats() {
  const volumeCbm = state.cargo.reduce((sum, row) => sum + cargoVolumeCbm(row), 0);
  const weightKg = state.cargo.reduce((sum, row) => sum + cargoWeightKg(row), 0);
  const weightTon = weightKg / 1000;
  return {
    volumeCbm,
    weightKg,
    weightTon,
    rt: Math.max(volumeCbm, weightTon),
    qty: totalCargoQty()
  };
}

function normalizeCargoDimensions(cargo = []) {
  const rowsWithDims = cargo.filter((row) => [row.length, row.height, row.width].some((value) => cleanNum(value) > 0));
  const looksLikeMeters = rowsWithDims.length > 0 && rowsWithDims.every((row) => {
    const dims = [cleanNum(row.length), cleanNum(row.height), cleanNum(row.width)].filter((value) => value > 0);
    return dims.length && dims.every((value) => value <= 20);
  });
  if (!looksLikeMeters) return cargo;
  return cargo.map((row) => ({
    ...row,
    length: cleanNum(row.length) ? Math.round(cleanNum(row.length) * 100) : row.length,
    height: cleanNum(row.height) ? Math.round(cleanNum(row.height) * 100) : row.height,
    width: cleanNum(row.width) ? Math.round(cleanNum(row.width) * 100) : row.width
  }));
}

function totalCargoQty() {
  return state.cargo.reduce((sum, row) => sum + cleanNum(row.qty), 0);
}

function normalizeCurrency(currency) {
  return ["USD", "EUR", "RMB"].includes(currency) ? currency : "RMB";
}

function portExchangeRate(currency) {
  if (currency === "USD") return cleanNum($("exchangeRate").value) || 1;
  if (currency === "EUR") return cleanNum($("eurExchangeRate").value) || 1;
  return 1;
}

function portChargeBase(row, stats = cargoStats()) {
  const unit = row.unit || "rt";
  if (unit === "rt") return stats.rt;
  if (unit === "ton") return stats.weightTon;
  if (unit === "cbm") return stats.volumeCbm;
  return 1;
}

function portChargeAmount(row, stats = cargoStats(), { respectIncluded = true } = {}) {
  if (respectIncluded && !row.included) return { base: portChargeBase(row, stats), amount: 0, amountRmb: 0 };
  const base = portChargeBase(row, stats);
  const primaryAmount = cleanNum(row.rate) * base;
  let amount = primaryAmount;
  let altBase = 0;
  let altAmount = 0;
  if (cleanNum(row.altRate) > 0) {
    altBase = portChargeBase({ unit: row.altUnit || "rt" }, stats);
    altAmount = cleanNum(row.altRate) * altBase;
    amount = row.chargeMode === "min" ? Math.min(primaryAmount, altAmount) : Math.max(primaryAmount, altAmount);
  }
  const min = cleanNum(row.min);
  if (min && amount < min) amount = min;
  const currency = normalizeCurrency(row.currency);
  return {
    base,
    altBase,
    primaryAmount,
    altAmount,
    amount,
    amountRmb: amount * portExchangeRate(currency)
  };
}

function portChargeTotals() {
  const stats = cargoStats();
  return state.portCharges.reduce((total, row) => {
    if (row.side === "destination") return total;
    return total + portChargeAmount(row, stats).amountRmb;
  }, 0);
}

function quoteValueByCurrency(row, currency) {
  if (!row) return 0;
  if (currency === "RMB") return row.quoteRmb || 0;
  if (currency === "EUR") return row.quoteEur || 0;
  return row.quoteUsd || 0;
}

async function calculateOnServer() {
  const snapshot = normalizeSnapshotForServer(getSnapshot("服务器计算"));
  const resp = await fetch("/api/quote/calculate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snapshot)
  });
  if (!resp.ok) {
    const message = await resp.text();
    throw new Error(`HTTP ${resp.status}${message ? `: ${message.trim()}` : ""}`);
  }
  return resp.json();
}

async function ensureCalculationResult() {
  if (latestCalculationResult) return latestCalculationResult;
  latestCalculationResult = await calculateOnServer();
  return latestCalculationResult;
}

function scheduleSummaryRefresh() {
  window.clearTimeout(summaryRefreshTimer);
  summaryRefreshTimer = window.setTimeout(() => {
    renderSummary();
  }, 300);
}

function customerCargoUnitByCurrency(row, selected, goodsCost, currency) {
  const qty = cleanNum(row.qty);
  if (!qty || !selected || !goodsCost) return 0;
  return customerCargoLineByCurrency(row, selected, goodsCost, currency) / qty;
}

function customerCargoLineByCurrency(row, selected, goodsCost, currency) {
  if (!selected || !goodsCost) return 0;
  const ratio = cargoTotal(row) / goodsCost;
  return quoteValueByCurrency(selected, currency) * ratio;
}

function formatQuoteMoney(value, currency) {
  if (currency === "RMB") return `¥${fmt.format(Math.round(value || 0))}`;
  if (currency === "EUR") return `€${fmt.format(Math.round(value || 0))}`;
  return `$${fmt.format(Math.round(value || 0))}`;
}

function formatPrimaryQuote(value, currency) {
  return formatQuoteMoney(value, currency);
}

function formatConverterMoney(value, currency) {
  if (!Number.isFinite(value)) return "--";
  if (currency === "RMB") return `¥${fmt.format(Math.round(value * 100) / 100)}`;
  if (currency === "EUR") return `€${fmt.format(Math.round(value * 100) / 100)}`;
  return `$${fmt.format(Math.round(value * 100) / 100)}`;
}

function renderCurrencyConverter() {
  const amountInput = $("converterAmount");
  const currencySelect = $("converterCurrency");
  if (!amountInput || !currencySelect) return;

  const amount = cleanNum(amountInput.value);
  const currency = currencySelect.value || "USD";
  const usdRate = cleanNum($("exchangeRate").value);
  const eurRate = cleanNum($("eurExchangeRate").value);
  let rmbValue = amount;

  if (currency === "USD") rmbValue = usdRate > 0 ? amount * usdRate : NaN;
  if (currency === "EUR") rmbValue = eurRate > 0 ? amount * eurRate : NaN;

  const usdValue = usdRate > 0 ? rmbValue / usdRate : NaN;
  const eurValue = eurRate > 0 ? rmbValue / eurRate : NaN;
  $("converterRmb").textContent = formatConverterMoney(rmbValue, "RMB");
  $("converterUsd").textContent = formatConverterMoney(usdValue, "USD");
  $("converterEur").textContent = formatConverterMoney(eurValue, "EUR");
}

function goodsCostMetaText() {
  const cargoCount = state.cargo.length;
  const qty = totalCargoQty();
  const taxedCount = state.cargo.filter((row) => cleanNum(row.taxRate) > 0).length;
  const qtyText = Number.isInteger(qty) ? fmt.format(qty) : qty.toFixed(2);
  const taxText = taxedCount ? `${taxedCount}行含税` : "未计税费";
  return `${cargoCount}个货物 / ${qtyText}件 / ${taxText}`;
}

function cargoSizeCm(row) {
  const size = [row.length, row.width, row.height].filter((value) => cleanNum(value) > 0).join(" x ");
  return size ? `${size} cm` : "";
}

function getInputs() {
  return {
    companyName: $("companyName").value.trim(),
    projectName: $("projectName").value.trim() || "未命名报价",
    tradeTerm: $("tradeTerm").value,
    containerType: $("containerType").value.trim(),
    destination: $("destination").value.trim(),
    destinationCountry: $("destinationCountry").value.trim(),
    hsCode: $("hsCode").value.trim(),
    validUntil: $("validUntil").value.trim(),
    exchangeRate: cleanNum($("exchangeRate").value),
    eurExchangeRate: cleanNum($("eurExchangeRate").value),
    outputCurrency: $("outputCurrency").value || "USD",
    dutyRate: cleanNum($("dutyRate").value),
    importVatRate: cleanNum($("importVatRate").value),
    destinationDelivery: cleanNum($("destinationDelivery").value),
    destinationClearance: cleanNum($("destinationClearance").value),
    destinationOther: cleanNum($("destinationOther").value),
    targetProfit: cleanNum($("targetProfit").value),
    selectedScheme: defaultScheme,
    notes: $("notes").value.trim()
  };
}

function getRawInputs() {
  return {
    companyName: $("companyName").value.trim(),
    projectName: $("projectName").value.trim(),
    tradeTerm: $("tradeTerm").value,
    containerType: $("containerType").value.trim(),
    destination: $("destination").value.trim(),
    destinationCountry: $("destinationCountry").value.trim(),
    hsCode: $("hsCode").value.trim(),
    validUntil: $("validUntil").value.trim(),
    exchangeRate: $("exchangeRate").value,
    eurExchangeRate: $("eurExchangeRate").value,
    outputCurrency: $("outputCurrency").value,
    dutyRate: $("dutyRate").value,
    importVatRate: $("importVatRate").value,
    destinationDelivery: $("destinationDelivery").value,
    destinationClearance: $("destinationClearance").value,
    destinationOther: $("destinationOther").value,
    targetProfit: $("targetProfit").value,
    selectedScheme: defaultScheme,
    notes: $("notes").value
  };
}

function applyInputs(inputs = {}) {
  Object.entries(inputs).forEach(([key, value]) => {
    if (!$(key)) return;
    if (key === "tradeTerm" && !supportedQuoteTerms.has(value)) {
      $(key).value = "CFR";
      return;
    }
    $(key).value = value;
  });
}

function getSnapshot(label = "自动保存") {
  return {
    id: currentArchiveId || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    label,
    updatedAt: new Date().toISOString(),
    inputs: getRawInputs(),
    schemes: [defaultScheme],
    cargo: state.cargo.map((row) => ({ ...row })),
    freight: state.freight.map((row) => ({ ...row })),
    portCharges: state.portCharges.map((row) => ({ ...row }))
  };
}

function normalizeSnapshotForServer(snapshot) {
  return {
    ...snapshot,
    inputs: getInputs(),
    cargo: state.cargo.map((row) => ({
      ...row,
      length: cleanNum(row.length),
      height: cleanNum(row.height),
      width: cleanNum(row.width),
      weight: cleanNum(row.weight),
      qty: cleanNum(row.qty),
      unitPrice: cleanNum(row.unitPrice),
      taxRate: cleanNum(row.taxRate),
      imageData: row.imageUrl ? "" : (row.imageData || ""),
      imageUrl: row.imageUrl || ""
    })),
    freight: state.freight.map((row) => ({
      ...row,
      scheme: defaultScheme,
      amount: cleanNum(row.amount),
      included: Boolean(row.included)
    })),
    portCharges: state.portCharges.map((row) => ({
      ...row,
      side: row.side || "origin",
      item: row.item || "",
      currency: normalizeCurrency(row.currency),
      unit: row.unit || "rt",
      rate: cleanNum(row.rate),
      altUnit: row.altUnit || "",
      altRate: cleanNum(row.altRate),
      chargeMode: row.chargeMode || "max",
      min: cleanNum(row.min),
      included: Boolean(row.included)
    }))
  };
}

function snapshotSignature(snapshot) {
  return JSON.stringify({
    inputs: snapshot.inputs,
    schemes: snapshot.schemes,
    cargo: snapshot.cargo,
    freight: snapshot.freight,
    portCharges: snapshot.portCharges
  });
}

function formatSaveTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || "";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function persistDraft({ force = false, label = "自动保存" } = {}) {
  const snapshot = getSnapshot(label);
  const signature = snapshotSignature(snapshot);
  if (!force && signature === lastSavedSignature) return;

  localStorage.setItem(storageDraftKey, JSON.stringify(snapshot));
  localStorage.setItem("quote-calculator-data", JSON.stringify(snapshot));
  lastSavedSignature = signature;
  $("statusLine").textContent = `已本地保存 ${formatSaveTime(snapshot.updatedAt)}`;
}

function scheduleAutoSave() {
  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => persistDraft(), autosaveDelayMs);
}

function showToast(message, type = "success") {
  const toast = $("appToast");
  if (!toast) return;
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("error", type === "error");
  toast.classList.remove("hidden");
  toastTimer = window.setTimeout(() => {
    toast.classList.add("hidden");
  }, 2600);
}

function loadDraftOnStart() {
  localStorage.removeItem("quote-calculator-cleared");
  localStorage.removeItem(storageDraftKey);
  localStorage.removeItem("quote-calculator-data");
}

function getSchemeIds() {
  return [defaultScheme];
}

function isMeaningfulFreightRow(row) {
  return Boolean(String(row.item ?? "").trim()) || cleanNum(row.amount) > 0;
}

function getSummarySchemeIds() {
  return [defaultScheme];
}

function syncSchemesFromRows() {
  state.schemes = [defaultScheme];
  state.freight.forEach((row) => {
    row.scheme = defaultScheme;
  });
}

function renderSchemeOptions() {
  syncSchemesFromRows();
}

function renderCargo() {
  const tbody = $("cargoTable").querySelector("tbody");
  tbody.innerHTML = "";
  state.cargo.forEach((row, index) => {
    const imageLabel = row.imageName ? escapeXml(row.imageName) : "上传";
    const imageSrc = row.imageData || row.imageUrl || "";
    const preview = imageSrc ? `<img class="cargo-thumb" alt="${escapeXml(row.imageName || row.name || "货物图片")}" src="${escapeXml(imageSrc)}">` : "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cargo-name"><input value="${escapeXml(row.name)}" data-cargo="${index}" data-key="name"></td>
      <td class="cargo-image">
        <div class="image-cell">
          ${preview}
          <label class="image-upload">
            <input type="file" accept="image/*" data-image-cargo="${index}">
            <span>${imageLabel}</span>
          </label>
          ${imageSrc ? `<button class="btn danger small-btn" title="移除图片" type="button" data-remove-image="${index}">×</button>` : ""}
        </div>
      </td>
      <td class="cargo-spec"><input value="${escapeXml(row.spec)}" data-cargo="${index}" data-key="spec"></td>
      <td class="cargo-dim"><input class="num" type="number" step="1" value="${row.length}" data-cargo="${index}" data-key="length"></td>
      <td class="cargo-dim"><input class="num" type="number" step="1" value="${row.height}" data-cargo="${index}" data-key="height"></td>
      <td class="cargo-dim"><input class="num" type="number" step="1" value="${row.width}" data-cargo="${index}" data-key="width"></td>
      <td class="cargo-weight"><input class="num" type="number" step="1" value="${row.weight}" data-cargo="${index}" data-key="weight"></td>
      <td class="cargo-qty"><input class="num" type="number" step="1" value="${row.qty}" data-cargo="${index}" data-key="qty"></td>
      <td class="cargo-price"><input class="num" type="number" step="1" value="${row.unitPrice}" data-cargo="${index}" data-key="unitPrice"></td>
      <td class="cargo-tax-rate"><input class="num" type="number" step="0.01" value="${row.taxRate}" data-cargo="${index}" data-key="taxRate"></td>
      <td class="cargo-tax readonly">${fmt.format(cargoTax(row))}</td>
      <td class="cargo-total readonly">${fmt.format(cargoTotal(row))}</td>
      <td class="row-action"><button class="btn danger small-btn" type="button" data-delete-cargo="${index}">×</button></td>
    `;
    tbody.appendChild(tr);
  });
}

const portChargeExamples = [
  { side: "origin", item: "海运费/退费待确认", currency: "USD", unit: "rt", rate: 270, min: 0, included: true },
  { side: "origin", item: "ENS", currency: "USD", unit: "hbl", rate: 25, min: 0, included: true },
  { side: "origin", item: "港杂", currency: "RMB", unit: "rt", rate: 185, min: 0, included: true },
  { side: "origin", item: "报关", currency: "RMB", unit: "hbl", rate: 100, min: 0, included: true },
  { side: "destination", item: "DOCUMENTATION", currency: "EUR", unit: "hbl", rate: 72.92, min: 0, included: false },
  { side: "destination", item: "STRIPPING", currency: "EUR", unit: "cbm", rate: 32.86, altUnit: "ton", altRate: 75.26, chargeMode: "max", min: 75.26, included: false },
  { side: "destination", item: "THC", currency: "EUR", unit: "rt", rate: 35.08, min: 88.09, included: false },
  { side: "destination", item: "ISPS", currency: "EUR", unit: "hbl", rate: 6.36, min: 0, included: false },
  { side: "destination", item: "T3", currency: "EUR", unit: "ton", rate: 4.24, min: 0, included: false },
  { side: "destination", item: "Inland", currency: "EUR", unit: "rt", rate: 12.9, min: 34.98, included: false },
  { side: "destination", item: "WAREHOUSE", currency: "EUR", unit: "rt", rate: 70, min: 0, included: false },
  { side: "destination", item: "ERS", currency: "EUR", unit: "rt", rate: 18, min: 0, included: false },
  { side: "destination", item: "Comm. & Logistic fee", currency: "EUR", unit: "hbl", rate: 200, min: 0, included: false },
  { side: "destination", item: "CIC", currency: "EUR", unit: "hbl", rate: 15.9, min: 0, included: false },
  { side: "destination", item: "SECURITY AND SANITARY FEE", currency: "EUR", unit: "hbl", rate: 20, min: 0, included: false },
  { side: "destination", item: "CISF", currency: "USD", unit: "rt", rate: 130, min: 0, included: false },
  { side: "destination", item: "CAF", currency: "USD", unit: "rt", rate: 20, min: 0, included: false },
  { side: "destination", item: "FUEL SURCHARGE AT COST", currency: "EUR", unit: "fixed", rate: 0, min: 0, included: false },
  { side: "destination", item: "T-1 formalities", currency: "EUR", unit: "fixed", rate: 45, min: 0, included: false }
];

function defaultPortCharges() {
  return portChargeExamples.map((row) => ({ ...row }));
}

function renderPortCharges(result) {
  const stats = result?.cargoStats || cargoStats();
  $("cargoVolumeCbm").textContent = (stats.volumeCbm || 0).toFixed(3);
  $("cargoWeightTon").textContent = (stats.weightTon || 0).toFixed(3);
  $("cargoChargeRt").textContent = (stats.rt || 0).toFixed(3);
  $("portChargeTotal").textContent = money(result?.portCharges?.totalRmb ?? portChargeTotals());

  renderPortChargeTable("portChargeTable", stats, {
    rows: state.portCharges
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.side !== "destination"),
    showIncluded: true,
    emptyText: "暂无出发港费用。可点击“新增费用”手动填写，或点击“套用港口示例”。"
  });
  renderPortChargeTable("destinationPortChargeTable", stats, {
    rows: state.portCharges
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.side === "destination"),
    showIncluded: false,
    emptyText: "暂无目的港费用。可点击“新增目的港费用”手动填写，或点击“套用港口示例”。"
  });
}

function renderPortChargeTable(tableId, stats, { rows, showIncluded, emptyText }) {
  const tbody = $(tableId).querySelector("tbody");
  tbody.innerHTML = "";
  rows.forEach(({ row, index }) => {
    const calc = portChargeAmount(row, stats, { respectIncluded: showIncluded });
    const tr = document.createElement("tr");
    tr.innerHTML = portChargeRowHtml(row, index, calc, showIncluded);
    tbody.appendChild(tr);
  });

  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="${showIncluded ? 12 : 11}" class="readonly" style="text-align:left">${emptyText}</td>`;
    tbody.appendChild(tr);
  }
}

function portChargeRowHtml(row, index, calc, showIncluded) {
  return `
    <td class="port-item"><input value="${escapeXml(row.item || "")}" data-port-charge="${index}" data-key="item" placeholder="费用项目"></td>
    <td class="port-currency">
      <select data-port-charge="${index}" data-key="currency">
        <option value="RMB"${row.currency === "RMB" ? " selected" : ""}>RMB</option>
        <option value="USD"${row.currency === "USD" ? " selected" : ""}>USD</option>
        <option value="EUR"${row.currency === "EUR" ? " selected" : ""}>EUR</option>
      </select>
    </td>
    <td class="port-unit">
      <select data-port-charge="${index}" data-key="unit">
        <option value="rt"${row.unit === "rt" ? " selected" : ""}>RT</option>
        <option value="ton"${row.unit === "ton" ? " selected" : ""}>TON</option>
        <option value="cbm"${row.unit === "cbm" ? " selected" : ""}>CBM</option>
        <option value="hbl"${row.unit === "hbl" ? " selected" : ""}>HBL</option>
        <option value="fixed"${row.unit === "fixed" ? " selected" : ""}>固定</option>
      </select>
    </td>
    <td class="port-rate"><input class="num" type="number" step="0.01" value="${row.rate || 0}" data-port-charge="${index}" data-key="rate"></td>
    <td class="port-unit">
      <select data-port-charge="${index}" data-key="altUnit">
        <option value=""${!row.altUnit ? " selected" : ""}>无</option>
        <option value="rt"${row.altUnit === "rt" ? " selected" : ""}>RT</option>
        <option value="ton"${row.altUnit === "ton" ? " selected" : ""}>TON</option>
        <option value="cbm"${row.altUnit === "cbm" ? " selected" : ""}>CBM</option>
        <option value="hbl"${row.altUnit === "hbl" ? " selected" : ""}>HBL</option>
        <option value="fixed"${row.altUnit === "fixed" ? " selected" : ""}>固定</option>
      </select>
    </td>
    <td class="port-rate"><input class="num" type="number" step="0.01" value="${row.altRate || 0}" data-port-charge="${index}" data-key="altRate"></td>
    <td class="port-mode">
      <select data-port-charge="${index}" data-key="chargeMode">
        <option value="max"${(row.chargeMode || "max") === "max" ? " selected" : ""}>取高</option>
        <option value="min"${row.chargeMode === "min" ? " selected" : ""}>取低</option>
      </select>
    </td>
    <td class="port-min"><input class="num" type="number" step="0.01" value="${row.min || 0}" data-port-charge="${index}" data-key="min"></td>
    <td class="port-base readonly">${calc.altAmount ? `${calc.base.toFixed(3)} / ${calc.altBase.toFixed(3)}` : calc.base.toFixed(3)}</td>
    <td class="port-amount readonly">${money(calc.amountRmb)}</td>
    ${showIncluded ? `
      <td class="port-included">
        <select data-port-charge="${index}" data-key="included">
          <option value="true"${row.included ? " selected" : ""}>是</option>
          <option value="false"${!row.included ? " selected" : ""}>否</option>
        </select>
      </td>` : ""}
    <td class="row-action"><button class="btn danger small-btn" type="button" data-delete-port-charge="${index}">×</button></td>
  `;
}

const baseFreightItems = [
  "国内派送费", "装卸费用"
];

function updateFreightDatalist() {
  const list = $("freightItemList");
  if (!list) return;
  list.innerHTML = baseFreightItems.map(i => `<option value="${escapeXml(i)}"></option>`).join("");
}

function renderFreight() {
  syncSchemesFromRows();
  updateFreightDatalist();
  const tbody = $("freightTable").querySelector("tbody");
  tbody.innerHTML = "";
  state.freight.forEach((row, index) => {
    row.scheme = defaultScheme;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="freight-item"><input list="freightItemList" value="${escapeXml(row.item)}" data-freight="${index}" data-key="item"></td>
      <td class="freight-amount"><input class="num" type="number" step="1" value="${row.amount}" data-freight="${index}" data-key="amount"></td>
      <td class="freight-included">
        <select data-freight="${index}" data-key="included">
          <option value="true"${row.included ? " selected" : ""}>是</option>
          <option value="false"${!row.included ? " selected" : ""}>否</option>
        </select>
      </td>
      <td class="row-action"><button class="btn danger small-btn" type="button" data-delete-freight="${index}">×</button></td>
    `;
    
    // 修复 datalist 必须清空才能重新选择的体验问题
    const itemInput = tr.querySelector("[data-key='item']");
    itemInput.addEventListener("mousedown", function() {
      if (this.value) {
        this._tempVal = this.value;
        this.value = "";
      }
    });
    itemInput.addEventListener("blur", function() {
      if (!this.value && this._tempVal) {
        this.value = this._tempVal;
      }
      delete this._tempVal;
    });

    tbody.appendChild(tr);
  });
}

async function renderSummary() {
  const requestId = ++calculationRequestId;
  latestCalculationResult = null;
  let result;
  try {
    result = await calculateOnServer();
    if (requestId !== calculationRequestId) return;
    latestCalculationResult = result;
  } catch (error) {
    if (requestId !== calculationRequestId) return;
    $("statusLine").textContent = `服务器计算暂不可用：${error.message}`;
    return;
  }
  if (!result.schemes || result.schemes.length === 0) return;

  const selected = result.selected || result.schemes[0];
  if (!selected) return;

  $("termPill").textContent = result.inputs.tradeTerm;
  renderPortCharges(result);
  renderDestinationCostVisibility(result.inputs.tradeTerm);
  $("selectedSchemePill").textContent = "单一成本";
  $("goodsCost").textContent = money(result.goodsCost);
  $("goodsCostMeta").textContent = goodsCostMetaText();
  renderImportCostSummary(result.inputs, selected.importCosts);
  
  // 更新最终报价展示
  $("finalQuoteUsd").textContent = formatQuoteMoney(selected.quoteUsd, "USD");
  $("finalQuoteEur").textContent = formatQuoteMoney(selected.quoteEur, "EUR");
  $("finalQuoteRmb").textContent = money(selected.quoteRmb);
  $("finalQuotePrimaryCurrency").textContent = result.inputs.outputCurrency;
  $("finalQuotePrimaryValue").textContent = formatPrimaryQuote(quoteValueByCurrency(selected, result.inputs.outputCurrency), result.inputs.outputCurrency);
  $("summaryQuoteHeader").textContent = `报价${result.inputs.outputCurrency}`;
  
  $("selectedCost").textContent = money(selected.totalCost);
  $("selectedProfit").textContent = money(selected.profit);
  $("profitMetric").className = `metric ${selected.profit >= 0 ? "green" : "red"}`;
  
  const currentMargin = pct(selected.margin);
  const currentMarkup = pct(selected.markup);
  $("statusLine").textContent = `基于 ${result.inputs.targetProfit}% 利润率自动测算；净利率 ${currentMargin}，成本加成率 ${currentMarkup}`;
  $("termNote").textContent = getTermNote(result.inputs.tradeTerm);

  const tbody = $("summaryTable").querySelector("tbody");
  tbody.innerHTML = "";
  result.schemes.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="money">${fmt.format(row.freight)}</td>
      <td class="money">${fmt.format(row.portCharges || 0)}</td>
      <td class="money">${fmt.format(row.totalCost)}</td>
      <td class="money">${fmt.format(Math.round(quoteValueByCurrency(row, result.inputs.outputCurrency)))}</td>
      <td class="money">${fmt.format(row.profit)}</td>
      <td class="money">${pct(row.margin)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderDestinationCostVisibility(term = $("tradeTerm").value) {
  const section = $("destinationCostSection");
  if (!section) return;
  section.classList.toggle("hidden", !(term === "DAP" || term === "DDP"));
}

function getTermNote(term) {
  if (term === "FOB") return "FOB通常不包含国际海运费；如其他费用里计入了海运费，需改为不计入或改用CFR/CIF口径。";
  if (term === "CIF") return "CIF通常包含国际海运费和保险费；请确认保险费已在费用表中计入。";
  if (term === "DAP") return "DAP通常包含运输至买方指定地点的派送费，但不包含进口清关、进口关税和进口税费。";
  if (term === "DDP") return "DDP通常包含运输至指定地点、进口清关、进口关税及进口税费；税率需以目的国官方政策或货代确认为准。";
  return "CFR通常包含国际海运费，不包含目的港清关、关税、目的港杂费和目的地派送。";
}

function renderImportCostSummary(inputs, costs = {}) {
  const scope = $("importScope");
  const note = $("importCostNote");
  if (!scope || !note) return;
  const safeCosts = {
    destinationLocal: 0,
    clearance: 0,
    duty: 0,
    importTax: 0,
    customsValue: 0,
    ...costs
  };
  if (inputs.tradeTerm === "DDP") {
    scope.textContent = `已计入DDP：派送/其他 ${money(safeCosts.destinationLocal)}，清关 ${money(safeCosts.clearance)}，关税 ${money(safeCosts.duty)}，VAT/GST ${money(safeCosts.importTax)}`;
  } else if (inputs.tradeTerm === "DAP") {
    scope.textContent = `已计入DAP：目的国派送/其他 ${money(safeCosts.destinationLocal)}；关税/VAT仅作参考`;
  } else {
    scope.textContent = `${inputs.tradeTerm}不自动计入目的国费用`;
  }
  note.textContent = `估算完税基础 ${money(safeCosts.customsValue)}；进口关税 ${money(safeCosts.duty)}；进口VAT/GST ${money(safeCosts.importTax)}。政策与税率请按目的国、HS编码和原产地确认。`;
}

function syncAndRender() {
  renderCargo();
  renderPortCharges();
  renderFreight();
  renderSchemeOptions();
  renderCurrencyConverter();
  renderSummary();
}

function updateStateOnInput(event) {
  const target = event.target;
  if (target.closest("#piPage")) return;
  if (target.closest("#currencyConverter")) {
    renderCurrencyConverter();
    return;
  }
  
  let changed = false;
  let shouldRefreshSummary = false;
  let shouldRefreshPortCharges = false;
  
  if (target.matches("[data-image-cargo]")) {
    updateCargoImage(target);
    return;
  } else if (target.matches("[data-cargo]")) {
    const row = state.cargo[Number(target.dataset.cargo)];
    const key = target.dataset.key;
    row[key] = target.type === "number" ? cleanNum(target.value) : target.value;
    changed = true;
    shouldRefreshSummary = true;
  } else if (target.matches("[data-freight]")) {
    const row = state.freight[Number(target.dataset.freight)];
    const key = target.dataset.key;
    if (key === "included") row[key] = target.value === "true";
    else row[key] = target.type === "number" ? cleanNum(target.value) : target.value;
    changed = true;
    shouldRefreshSummary = true;
  } else if (target.matches("[data-port-charge]")) {
    const row = state.portCharges[Number(target.dataset.portCharge)];
    const key = target.dataset.key;
    if (key === "included") row[key] = target.value === "true";
    else row[key] = target.type === "number" ? cleanNum(target.value) : target.value;
    changed = true;
  } else if (target.id === "tradeTerm") {
    updateFreightDatalist();
    changed = true;
    shouldRefreshSummary = true;
    shouldRefreshPortCharges = true;
  } else if (target.closest(".section-body") || target.closest(".topbar")) {
    changed = true;
    shouldRefreshSummary = true;
  }

  if (changed) {
    renderCurrencyConverter();
    if (shouldRefreshPortCharges) renderPortCharges();
    if (shouldRefreshSummary) scheduleSummaryRefresh();
    scheduleAutoSave();
  }
}

function updateStateOnChange(event) {
  const target = event.target;
  if (target.closest("#piPage")) return;
  if (target.closest("#currencyConverter")) {
    renderCurrencyConverter();
    return;
  }
  
  let changed = false;
  
  if (target.matches("[data-cargo]")) {
    const row = state.cargo[Number(target.dataset.cargo)];
    const key = target.dataset.key;
    row[key] = target.type === "number" ? cleanNum(target.value) : target.value;
    changed = true;
  } else if (target.matches("[data-freight]")) {
    const row = state.freight[Number(target.dataset.freight)];
    const key = target.dataset.key;
    if (key === "included") row[key] = target.value === "true";
    else row[key] = target.type === "number" ? cleanNum(target.value) : target.value;
    renderFreight();
    changed = true;
  } else if (target.matches("[data-port-charge]")) {
    const row = state.portCharges[Number(target.dataset.portCharge)];
    const key = target.dataset.key;
    if (key === "included") row[key] = target.value === "true";
    else row[key] = target.type === "number" ? cleanNum(target.value) : target.value;
    changed = true;
  } else if (target.closest(".section-body") || target.closest(".topbar")) {
    changed = true;
  }

  if (changed) {
    window.clearTimeout(summaryRefreshTimer);
    renderCurrencyConverter();
    renderPortCharges();
    renderSummary();
    scheduleAutoSave();
  }
}

function addCargo() {
  state.cargo.push({ name: "", spec: "", length: 0, height: 0, width: 0, weight: 0, qty: 1, unitPrice: 0, taxRate: 0, imageName: "", imageData: "", imageUrl: "" });
  syncAndRender();
  scheduleAutoSave();
}

function addFreight() {
  state.freight.push({ scheme: defaultScheme, item: "", amount: 0, included: true });
  syncAndRender();
  scheduleAutoSave();
}

function addPortCharge(row = {}) {
  state.portCharges.push({
    side: "origin",
    item: "",
    currency: "RMB",
    unit: "rt",
    rate: 0,
    altUnit: "",
    altRate: 0,
    chargeMode: "max",
    min: 0,
    included: true,
    ...row
  });
  syncAndRender();
  scheduleAutoSave();
}

function addDestinationPortCharge() {
  addPortCharge({ side: "destination", currency: "EUR", included: false });
}

function loadPortChargeExamples() {
  state.portCharges = defaultPortCharges();
  syncAndRender();
  scheduleAutoSave();
  showToast("已套用港口费用示例，可继续修改单价和最低收费");
}

function applyEmptyState() {
  state.schemes = [defaultScheme];
  state.cargo = [];
  state.freight = [];
  state.portCharges = defaultPortCharges();
}

function clearInputFields() {
  $("companyName").value = "";
  $("projectName").value = "";
  $("tradeTerm").value = "CFR";
  $("containerType").value = "";
  $("destination").value = "";
  $("destinationCountry").value = "";
  $("hsCode").value = "";
  $("validUntil").value = "";
  $("exchangeRate").value = "7.2";
  $("eurExchangeRate").value = "7.8";
  $("outputCurrency").value = "USD";
  $("dutyRate").value = "0";
  $("importVatRate").value = "0";
  $("destinationDelivery").value = "0";
  $("destinationClearance").value = "0";
  $("destinationOther").value = "0";
  $("targetProfit").value = "15";
  $("notes").value = "";
}

function download(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function languageSuffix(lang) {
  if (lang === "en") return "English";
  if (lang === "bilingual") return "中英双语";
  return "中文";
}

function safeName() {
  return (getInputs().projectName || "报价").replace(/[\\/:*?"<>|]/g, "_");
}

function openExportDialog(type) {
  pendingDownloadType = type;
  $("exportDialog").classList.remove("hidden");
}

function closeExportDialog() {
  pendingDownloadType = "";
  $("exportDialog").classList.add("hidden");
}

function exportLabel(lang, zh, en) {
  if (lang === "en") return en;
  if (lang === "bilingual") return `${zh} / ${en}`;
  return zh;
}

function pdfMoney(value, currency) {
  return formatQuoteMoney(value || 0, currency || "USD");
}

function pdfNumber(value) {
  return fmt.format(Math.round(value || 0));
}

function pdfCargoSize(row) {
  const dims = [row.length, row.width, row.height].filter((value) => cleanNum(value) > 0);
  return dims.length ? `${dims.join(" × ")} cm` : "-";
}

function quoteDocumentTitle(mode, lang) {
  const base = mode === "customer"
    ? exportLabel(lang, "客户报价单", "Quotation")
    : exportLabel(lang, "内部报价测算", "Internal Quotation");
  return `${safeName()} - ${base}`;
}

function buildPdfHtml(snapshot, result, mode, lang) {
  const inputs = result.inputs || snapshot.inputs || {};
  const selected = result.selected || (result.schemes || [])[0] || {};
  const currency = inputs.outputCurrency || "USD";
  const isCustomer = mode === "customer";
  const title = quoteDocumentTitle(mode, lang);
  const termText = `${inputs.tradeTerm || "CFR"} ${inputs.destination || ""}`.trim();
  const quoteTotal = quoteValueByCurrency(selected, currency);
  const cargoRows = (snapshot.cargo || []).map((row) => {
    const qty = cleanNum(row.qty);
    const customerLine = customerCargoLineByCurrency(row, selected, result.goodsCost, currency);
    const customerUnit = qty ? customerLine / qty : 0;
    const cells = isCustomer
      ? `
        <td>${escapeXml(row.name || "-")}</td>
        <td class="image">${row.imageData || row.imageUrl ? `<img src="${escapeXml(row.imageData || row.imageUrl)}" alt="${escapeXml(row.imageName || row.name || "cargo")}">` : ""}</td>
        <td>${escapeXml(row.spec || "-")}<br><span>${escapeXml(pdfCargoSize(row))}</span></td>
        <td class="num">${pdfNumber(qty)}</td>
        <td class="num">${pdfMoney(customerUnit, currency)}</td>
        <td class="num">${pdfMoney(customerLine, currency)}</td>
      `
      : `
        <td>${escapeXml(row.name || "-")}</td>
        <td>${escapeXml(row.spec || "-")}<br><span>${escapeXml(pdfCargoSize(row))}</span></td>
        <td class="num">${pdfNumber(cleanNum(row.weight))}</td>
        <td class="num">${pdfNumber(qty)}</td>
        <td class="num">¥${pdfNumber(cleanNum(row.unitPrice))}</td>
        <td class="num">${pct(cleanNum(row.taxRate))}</td>
        <td class="num">¥${pdfNumber(cargoTotal(row))}</td>
        <td class="num">${pdfMoney(customerLine, currency)}</td>
      `;
    return `<tr>${cells}</tr>`;
  }).join("");

  const costRows = selected ? `
    <tr>
      <td class="num">¥${pdfNumber(selected.freight)}</td>
      <td class="num">¥${pdfNumber(selected.portCharges || 0)}</td>
      <td class="num">¥${pdfNumber(selected.totalCost)}</td>
      <td class="num">${pdfMoney(quoteValueByCurrency(selected, currency), currency)}</td>
      <td class="num">¥${pdfNumber(selected.profit)}</td>
      <td class="num">${pct(selected.margin)}</td>
    </tr>
  ` : "";

  const freightRows = (snapshot.freight || [])
    .filter((row) => !isCustomer && (row.item || cleanNum(row.amount) > 0))
    .map((row) => `
      <tr>
        <td>${escapeXml(row.item || "-")}</td>
        <td class="num">¥${pdfNumber(cleanNum(row.amount))}</td>
        <td>${escapeXml(row.included ? exportLabel(lang, "是", "Yes") : exportLabel(lang, "否", "No"))}</td>
      </tr>
    `).join("");

  const customerNote = getTermNote(inputs.tradeTerm || "CFR");
  const notes = [customerNote, inputs.notes].filter(Boolean).map((note) => `<p>${escapeXml(note)}</p>`).join("");

  return `<!doctype html>
<html lang="${lang === "en" ? "en" : "zh-CN"}">
<head>
  <meta charset="utf-8">
  <title>${escapeXml(title)}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #17212b;
      font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", Arial, sans-serif;
      background: #fff;
    }
    .sheet { width: 100%; }
    .hero {
      background: #175f78;
      color: #fff;
      padding: 18px 20px;
      border-radius: 10px 10px 0 0;
    }
    h1 { margin: 0; font-size: 24px; letter-spacing: .02em; }
    .subtitle { margin-top: 6px; opacity: .9; }
    .summary {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      padding: 14px 0;
    }
    .card {
      border: 1px solid #d8e0e8;
      border-radius: 8px;
      padding: 10px;
      min-height: 64px;
      break-inside: avoid;
    }
    .label { color: #667381; font-size: 11px; }
    .value { margin-top: 5px; font-size: 16px; font-weight: 800; color: #175f78; }
    h2 {
      margin: 18px 0 8px;
      padding: 8px 10px;
      border-left: 5px solid #175f78;
      background: #e7f3f6;
      font-size: 15px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      page-break-inside: auto;
    }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    th, td {
      border: 1px solid #c8d6e0;
      padding: 7px 8px;
      vertical-align: middle;
    }
    th {
      background: #dce8ef;
      color: #17324a;
      text-align: left;
      font-weight: 800;
    }
    td span { color: #667381; }
    .num { text-align: right; white-space: nowrap; }
    .image { width: 82px; text-align: center; }
    .image img {
      max-width: 70px;
      max-height: 58px;
      object-fit: contain;
      border-radius: 4px;
      border: 1px solid #e4eaf0;
    }
    .tag {
      display: inline-block;
      margin-left: 4px;
      padding: 1px 5px;
      border-radius: 999px;
      background: #e8f5ee;
      color: #1c7c54;
      font-size: 10px;
      font-weight: 800;
    }
    .notes {
      border: 1px solid #d8e0e8;
      border-radius: 8px;
      padding: 10px 12px;
      color: #334155;
      background: #fbfcfd;
    }
    .notes p { margin: 4px 0; }
    .footer {
      margin-top: 18px;
      padding-top: 10px;
      border-top: 1px solid #d8e0e8;
      color: #667381;
      font-size: 10px;
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
  <script>
    window.addEventListener("load", () => {
      window.setTimeout(() => window.print(), 250);
    });
  </script>
</head>
<body>
  <main class="sheet">
    <section class="hero">
      <h1>${escapeXml(title)}</h1>
      <div class="subtitle">${escapeXml(exportLabel(lang, "由 CFR 报价自动计算器生成", "Generated by Freight Cost Calculator"))}</div>
    </section>

    <section class="summary">
      <div class="card"><div class="label">${escapeXml(exportLabel(lang, "项目/客户", "Project"))}</div><div class="value">${escapeXml(inputs.projectName || "-")}</div></div>
      <div class="card"><div class="label">${escapeXml(exportLabel(lang, "贸易术语", "Trade Term"))}</div><div class="value">${escapeXml(termText || "-")}</div></div>
      <div class="card"><div class="label">${escapeXml(exportLabel(lang, "柜型", "Container"))}</div><div class="value">${escapeXml(inputs.containerType || "-")}</div></div>
      <div class="card"><div class="label">${escapeXml(exportLabel(lang, "最终报价", "Final Quote"))}</div><div class="value">${escapeXml(pdfMoney(quoteTotal, currency))}</div></div>
    </section>

    <h2>${escapeXml(exportLabel(lang, "基础信息", "Basic Information"))}</h2>
    <table>
      <tbody>
        <tr><th>${escapeXml(exportLabel(lang, "我方公司", "Company"))}</th><td>${escapeXml(inputs.companyName || "-")}</td><th>${escapeXml(exportLabel(lang, "报价有效期", "Valid Until"))}</th><td>${escapeXml(inputs.validUntil || "-")}</td></tr>
        <tr><th>${escapeXml(exportLabel(lang, "目的港/目的地", "Destination"))}</th><td>${escapeXml(inputs.destination || "-")}</td><th>${escapeXml(exportLabel(lang, "报价币种", "Currency"))}</th><td>${escapeXml(currency)}</td></tr>
      </tbody>
    </table>

    <h2>${escapeXml(exportLabel(lang, "货物明细", "Cargo Details"))}</h2>
    <table>
      <thead>
        <tr>
          ${isCustomer
            ? `<th>${escapeXml(exportLabel(lang, "货物名称", "Product"))}</th><th>${escapeXml(exportLabel(lang, "图片", "Image"))}</th><th>${escapeXml(exportLabel(lang, "规格/尺寸", "Spec / Size"))}</th><th class="num">${escapeXml(exportLabel(lang, "数量", "Qty"))}</th><th class="num">${escapeXml(exportLabel(lang, "单价", "Unit Price"))}</th><th class="num">${escapeXml(exportLabel(lang, "金额", "Amount"))}</th>`
            : `<th>${escapeXml(exportLabel(lang, "货物名称", "Product"))}</th><th>${escapeXml(exportLabel(lang, "规格/尺寸", "Spec / Size"))}</th><th class="num">${escapeXml(exportLabel(lang, "单箱KG", "KG/Box"))}</th><th class="num">${escapeXml(exportLabel(lang, "数量", "Qty"))}</th><th class="num">${escapeXml(exportLabel(lang, "成本单价", "Cost Unit"))}</th><th class="num">${escapeXml(exportLabel(lang, "税率", "Tax"))}</th><th class="num">${escapeXml(exportLabel(lang, "成本合计", "Cost Total"))}</th><th class="num">${escapeXml(exportLabel(lang, "客户金额", "Customer Amount"))}</th>`}
        </tr>
      </thead>
      <tbody>${cargoRows || `<tr><td colspan="${isCustomer ? 6 : 8}">${escapeXml(exportLabel(lang, "暂无货物", "No cargo"))}</td></tr>`}</tbody>
    </table>

    ${isCustomer ? "" : `
      <h2>${escapeXml(exportLabel(lang, "成本构成", "Cost Breakdown"))}</h2>
      <table>
        <thead><tr><th class="num">${escapeXml(exportLabel(lang, "其他费用", "Other"))}</th><th class="num">${escapeXml(exportLabel(lang, "港口费", "Port"))}</th><th class="num">${escapeXml(exportLabel(lang, "总成本", "Total Cost"))}</th><th class="num">${escapeXml(exportLabel(lang, "客户报价", "Quote"))}</th><th class="num">${escapeXml(exportLabel(lang, "净利润", "Profit"))}</th><th class="num">${escapeXml(exportLabel(lang, "净利率", "Margin"))}</th></tr></thead>
        <tbody>${costRows}</tbody>
      </table>

      <h2>${escapeXml(exportLabel(lang, "其他费用明细", "Other Cost Details"))}</h2>
      <table>
        <thead><tr><th>${escapeXml(exportLabel(lang, "费用项目", "Item"))}</th><th class="num">${escapeXml(exportLabel(lang, "金额", "Amount"))}</th><th>${escapeXml(exportLabel(lang, "计入总成本", "Included"))}</th></tr></thead>
        <tbody>${freightRows || `<tr><td colspan="3">${escapeXml(exportLabel(lang, "暂无其他费用", "No other costs"))}</td></tr>`}</tbody>
      </table>
    `}

    <h2>${escapeXml(exportLabel(lang, "报价说明", "Notes"))}</h2>
    <section class="notes">${notes || `<p>${escapeXml(exportLabel(lang, "无额外备注。", "No additional notes."))}</p>`}</section>

    <section class="footer">
      <span>${escapeXml(exportLabel(lang, "生成时间", "Generated"))}: ${escapeXml(new Date().toLocaleString("zh-CN"))}</span>
      <span>${escapeXml(exportLabel(lang, "报价仅供沟通确认，最终以双方确认文件为准。", "Quotation is for confirmation and subject to final agreed documents."))}</span>
    </section>
  </main>
</body>
</html>`;
}

async function downloadPDF(mode, lang, suffix, langSuffix) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("浏览器阻止了PDF导出窗口，请允许弹窗后重试。");
    return;
  }
  printWindow.document.write("<!doctype html><meta charset='utf-8'><title>PDF</title><p style='font:16px sans-serif;padding:24px'>正在生成PDF...</p>");
  try {
    const snapshot = normalizeSnapshotForServer(getSnapshot("PDF导出"));
    const resp = await fetch("/api/quote/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    });
    if (!resp.ok) {
      const message = await resp.text();
      throw new Error(`HTTP ${resp.status}${message ? `: ${message.trim()}` : ""}`);
    }
    const result = await resp.json();
    const html = buildPdfHtml(snapshot, result, mode, lang);
    const blobUrl = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    printWindow.location.replace(blobUrl);
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    $("statusLine").textContent = `已生成PDF打印页（${suffix}），请选择“保存为PDF”。`;
  } catch (e) {
    printWindow.close();
    $("statusLine").textContent = "PDF导出失败，请确认服务器可用。";
    alert("PDF导出失败: " + e.message);
  }
}

async function downloadExcel(mode, lang, suffix, langSuffix) {
  try {
    const snapshot = normalizeSnapshotForServer(getSnapshot("Excel导出"));

    const resp = await fetch(`/api/export?mode=${mode}&lang=${lang}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const blob = await resp.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${safeName()}_报价表_${suffix}_${langSuffix}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    $("statusLine").textContent = `已通过服务器生成专业Excel（${suffix}）`;
  } catch (e) {
    $("statusLine").textContent = "Excel导出失败，请确认服务器可用。";
    alert("Excel导出失败: " + e.message);
  }
}

async function downloadMarkdown(mode, lang, suffix, langSuffix) {
  try {
    const snapshot = normalizeSnapshotForServer(getSnapshot("MD导出"));
    const resp = await fetch(`/api/export/markdown?mode=${mode}&lang=${lang}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    });
    if (!resp.ok) {
      const message = await resp.text();
      throw new Error(`HTTP ${resp.status}${message ? `: ${message.trim()}` : ""}`);
    }
    const content = await resp.text();
    download(`${safeName()}_报价表_${suffix}_${langSuffix}.md`, "text/markdown;charset=utf-8", content);
    $("statusLine").textContent = `已通过服务器生成MD（${suffix}）`;
  } catch (e) {
    $("statusLine").textContent = "MD导出失败，请确认服务器可用。";
    alert("MD导出失败: " + e.message);
  }
}

async function downloadSelectedVersion(mode) {
  const suffix = mode === "customer" ? "客户版" : "内部留存版";
  const lang = $("exportLanguage").value;
  const langSuffix = languageSuffix(lang);
  if (pendingDownloadType === "md") {
    await downloadMarkdown(mode, lang, suffix, langSuffix);
  }
  if (pendingDownloadType === "excel") {
    await downloadExcel(mode, lang, suffix, langSuffix);
  }
  if (pendingDownloadType === "pdf") {
    await downloadPDF(mode, lang, suffix, langSuffix);
  }
  closeExportDialog();
}

function resetQuoteWorkspace(message = "已新建空白报价。") {
  currentArchiveId = "";
  clearInputFields();
  applyEmptyState();
  window.clearTimeout(autosaveTimer);
  lastSavedSignature = "";
  localStorage.removeItem("quote-calculator-data");
  localStorage.removeItem(storageDraftKey);
  syncAndRender();
  $("statusLine").textContent = message;
}

function clearAllData() {
  resetQuoteWorkspace("已清空当前报价；不会删除服务器归档。");
}

function newQuote() {
  resetQuoteWorkspace("已开始一份新的空白报价；保存时会生成新的归档记录。");
}

async function fetchUsdCnyRate() {
  const source = $("rateSource");
  const button = $("fetchRateBtn");
  button.disabled = true;
  button.innerHTML = "<span>同步中</span><small>USD/EUR</small>";
  source.textContent = "正在获取USD/CNY和EUR/CNY汇率...";
  try {
    const response = await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const rate = data?.rates?.CNY;
    const eurPerUsd = data?.rates?.EUR;
    if (!rate || data.result !== "success") throw new Error("汇率数据不可用");
    $("exchangeRate").value = Number(rate).toFixed(1);
    if (eurPerUsd > 0) $("eurExchangeRate").value = Number(rate / eurPerUsd).toFixed(1);
    const updated = data.time_last_update_utc ? `，更新时间：${data.time_last_update_utc}` : "";
    source.innerHTML = `已获取USD/CNY ${Number(rate).toFixed(1)}，EUR/CNY ${Number($("eurExchangeRate").value).toFixed(1)}${updated}。Rates by <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener">Exchange Rate API</a>。`;
    renderCurrencyConverter();
    renderSummary();
  } catch (error) {
    source.textContent = "汇率获取失败，请继续手动填写；公开接口可能受网络、跨域或限流影响。";
  } finally {
    button.disabled = false;
    button.innerHTML = "<span>同步获取</span><small>USD/EUR</small>";
  }
}

function openPolicyLookup() {
  const inputs = getInputs();
  const country = inputs.destinationCountry || inputs.destination || "destination country";
  const hs = inputs.hsCode || "HS code";
  const query = encodeURIComponent(`${country} official customs tariff import duty VAT ${hs}`);
  window.open(`https://www.google.com/search?q=${query}`, "_blank", "noopener");
  $("importCostNote").textContent = `已打开政策查询：请按目的国 ${country}、HS编码 ${hs}、原产地和材质确认关税/VAT后填写税率。`;
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      image.onerror = reject;
      image.onload = () => {
        const maxSize = 520;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve({
          imageName: randomImageName(),
          imageData: canvas.toDataURL("image/jpeg", 0.74)
        });
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function randomImageName() {
  const bytes = new Uint8Array(8);
  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    bytes.forEach((_, index) => {
      bytes[index] = Math.floor(Math.random() * 256);
    });
  }
  const random = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `cargo_${Date.now().toString(36)}_${random}.jpg`;
}

async function uploadCargoImage(image) {
  const resp = await fetch("/api/images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: image.imageName,
      data: image.imageData
    })
  });
  if (!resp.ok) {
    const message = await resp.text();
    throw new Error(`HTTP ${resp.status}${message ? `: ${message.trim()}` : ""}`);
  }
  return resp.json();
}

async function updateCargoImage(input) {
  const index = Number(input.dataset.imageCargo);
  const file = input.files && input.files[0];
  if (!file || !state.cargo[index]) return;
  try {
    const image = await readImageFile(file);
    const uploaded = await uploadCargoImage(image);
    state.cargo[index].imageName = uploaded.name || image.imageName;
    state.cargo[index].imageData = "";
    state.cargo[index].imageUrl = uploaded.url || "";
    syncAndRender();
    scheduleAutoSave();
  } catch (error) {
    alert("图片上传失败，请确认服务器可用后重试：" + error.message);
  }
}

async function migrateLegacyCargoImages(cargo = []) {
  let migrated = 0;
  for (const row of cargo) {
    if (!row || row.imageUrl || !row.imageData) continue;
    try {
      const uploaded = await uploadCargoImage({
        imageName: row.imageName || randomImageName(),
        imageData: row.imageData
      });
      row.imageName = uploaded.name || row.imageName || "";
      row.imageUrl = uploaded.url || "";
      row.imageData = "";
      migrated += 1;
    } catch (error) {
      // Keep the legacy base64 image as a fallback if migration fails.
      console.warn("Legacy image migration failed", error);
    }
  }
  return migrated;
}

async function saveCurrentArchiveQuietly(label = "图片迁移") {
  if (!currentArchiveId) return;
  const snapshot = normalizeSnapshotForServer(getSnapshot(label));
  const resp = await fetch("/api/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snapshot),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

async function archiveSnapshot() {
  const snapshot = normalizeSnapshotForServer(getSnapshot("服务器归档"));
  const wasUpdating = Boolean(currentArchiveId);
  const button = $("archiveBtn");
  const originalText = button.textContent;
  let saved = false;
  button.disabled = true;
  button.textContent = "保存中...";

  try {
    const resp = await fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    });
    if (!resp.ok) {
      const message = await resp.text();
      throw new Error(`HTTP ${resp.status}${message ? `: ${message.trim()}` : ""}`);
    }
    saved = true;
    button.textContent = "已归档";
    showToast(wasUpdating ? "已更新归档" : "已保存到归档");
    resetQuoteWorkspace(wasUpdating ? "已更新归档，并自动新建空白报价。" : "已保存到归档，并自动新建空白报价。");
    window.setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
    }, 1400);
  } catch (e) {
    button.textContent = originalText;
    showToast("归档失败，请查看报错", "error");
    alert("归档失败: " + e.message);
  } finally {
    if (!saved) button.disabled = false;
  }
}

async function deleteSnapshot(id, event) {
  event.stopPropagation();
  if (!confirm("确定要删除这条归档记录吗？")) return;
  try {
    const resp = await fetch(`/api/delete?id=${id}`, { method: "POST" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    fetchHistory(); // 刷新列表
  } catch (e) {
    alert("删除失败: " + e.message);
  }
}

async function updateSnapshotLabel(id, event) {
  event.stopPropagation();
  const button = event.target.closest("[data-update-label-id]");
  const editor = button?.closest(".history-label-editor");
  const input = editor?.querySelector(".history-label-input");
  if (!button || !input) return;

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "保存中";
  try {
    const resp = await fetch("/api/update-label", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, label: input.value })
    });
    if (!resp.ok) {
      const message = await resp.text();
      throw new Error(`HTTP ${resp.status}${message ? `: ${message.trim()}` : ""}`);
    }
    const result = await resp.json();
    input.value = result.label || "";
    button.textContent = "已保存";
    showToast("归档备注已更新");
    window.setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
    }, 1200);
  } catch (error) {
    button.textContent = originalText;
    button.disabled = false;
    showToast("备注保存失败", "error");
    alert("备注保存失败: " + error.message);
  }
}

async function fetchHistory() {
  try {
    const resp = await fetch("/api/list");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const list = await resp.json();
    const tbody = $("historyTable").querySelector("tbody");
    tbody.innerHTML = "";
    
    list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    list.forEach((item) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${formatSaveTime(item.updatedAt)}</td>
        <td>${escapeXml(item.projectName)}</td>
        <td>${escapeXml(item.destination || "-")}</td>
        <td class="history-label-cell">
          <div class="history-label-editor">
            <input class="history-label-input" maxlength="200" value="${escapeXml(item.label || "")}" placeholder="填写归档备注">
            <button class="history-label-save" type="button" data-update-label-id="${escapeXml(item.id)}">保存</button>
          </div>
        </td>
        <td class="history-action-cell">
          <div class="history-actions">
            <button class="history-action-btn load" type="button" title="加载此报价" data-load-id="${item.id}">加载</button>
            <button class="history-action-btn delete" type="button" title="删除归档" data-delete-id="${item.id}">删除</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
    $("historyDialog").classList.remove("hidden");
  } catch (e) {
    alert("读取历史失败: " + e.message);
  }
}

async function loadSnapshot(id) {
  try {
    $("statusLine").textContent = "正在加载归档...";
    const loadButton = document.querySelector(`[data-load-id="${CSS.escape(id)}"]`);
    if (loadButton) {
      loadButton.disabled = true;
      loadButton.textContent = "加载中";
    }
    const resp = await fetch(`/api/load?id=${id}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    
    currentArchiveId = data.id || id;
    applyInputs(data.inputs);
    const loadedCargo = Array.isArray(data.cargo) ? normalizeCargoDimensions(data.cargo) : state.cargo;
    const migratedImages = await migrateLegacyCargoImages(loadedCargo);
    state.cargo = loadedCargo;
    state.freight = Array.isArray(data.freight) ? data.freight.map((row) => ({ ...row, scheme: defaultScheme })) : state.freight;
    state.schemes = [defaultScheme];
    state.portCharges = Array.isArray(data.portCharges) ? data.portCharges : [];
    
    syncAndRender();
    $("historyDialog").classList.add("hidden");
    if (migratedImages) {
      try {
        await saveCurrentArchiveQuietly("旧图片迁移");
      } catch (error) {
        console.warn("Failed to save migrated archive", error);
      }
    }
    $("statusLine").textContent = `已加载服务器归档: ${data.inputs.projectName} (${formatSaveTime(data.updatedAt)})；${migratedImages ? `已迁移 ${migratedImages} 张旧图片，` : ""}保存归档会更新当前记录。`;
  } catch (e) {
    alert("加载失败: " + e.message);
  } finally {
    document.querySelectorAll("[data-load-id]").forEach((button) => {
      button.disabled = false;
      button.textContent = "加载";
    });
  }
}

function setActiveView(view) {
  document.querySelectorAll(".nav-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  $("quotePage").classList.toggle("active", view === "quote");
  $("piPage").classList.toggle("active", view === "pi");
  if (view === "pi") renderPi();
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function defaultPiNo() {
  const compactDate = todayISO().replaceAll("-", "");
  return `PI-${compactDate}-001`;
}

function defaultPiInvoice() {
  const piNo = defaultPiNo();
  return {
    piNo,
    issueDate: todayISO(),
    incoterms: "CFR",
    paymentTerm: "T/T Wire Transfer",
    validity: "15 days",
    customerRef: "Inquiry-Dubai-001",
    currency: "USD",
    salesContact: "Sales Manager / WhatsApp / Email",
    loadingPort: "Tianjin / China Port",
    destination: "Dubai",
    shipment: "By sea",
    deliveryTime: "To be confirmed after deposit",
    packing: "Export standard wooden crate packing",
    seller: {
      company: "Quyang Sculpture Co., Ltd.",
      address: "Quyang County, Baoding, Hebei, China",
      contact: "Sales Manager",
      tel: "+86 000 0000 0000",
      email: "sales@example.com",
      licenseNo: "Sample Business License No.",
      customsCode: "Sample Customs Code"
    },
    buyer: {
      company: "Dubai Customer LLC",
      address: "Dubai, United Arab Emirates",
      contact: "Purchasing Manager",
      tel: "+971 00 000 0000",
      email: "buyer@example.com",
      taxNo: "Sample VAT / Importer No."
    },
    items: [
      { product: "Marble Horse Sculpture / 大理石马雕塑", material: "Natural marble", finish: "Hand carved / polished", size: "2.1 x 0.5 x 2.1 m", qty: 5, unit: "set", unitPrice: 5920, remarks: "Custom design per approved drawing/photo" },
      { product: "Stainless Steel Falcon / 不锈钢猎鹰", material: "Stainless steel", finish: "Mirror polished", size: "3 x 0.8 x 2 m", qty: 1, unit: "set", unitPrice: 5900, remarks: "Actual shipment size" }
    ],
    bank: {
      beneficiary: "Quyang Sculpture Co., Ltd.",
      beneficiaryAddress: "Quyang County, Baoding, Hebei, China",
      bankName: "Sample Bank",
      bankAddress: "Sample Bank Address",
      accountNo: "000000000000",
      swift: "SAMPLEXX",
      bankCode: "Routing / IBAN if applicable",
      paymentReference: `${piNo} - Dubai Customer LLC`,
      bankCharges: "All bank charges outside seller's bank are for buyer's account unless otherwise agreed."
    },
    terms: piDefaultTerms,
    notes: "Please replace sample contact and bank details with confirmed information before sending to buyer."
  };
}

function initPiDefaults() {
  applyPiInvoice(defaultPiInvoice());
}

function getPiText(id) {
  return ($(id)?.value || "").trim();
}

function getPiInvoice() {
  return {
    piNo: getPiText("piNo"),
    issueDate: getPiText("piIssueDate"),
    incoterms: getPiText("piIncoterms"),
    paymentTerm: getPiText("piPaymentTerm"),
    validity: getPiText("piValidity"),
    customerRef: getPiText("piCustomerRef"),
    currency: getPiText("piCurrency") || "USD",
    salesContact: getPiText("piSalesContact"),
    loadingPort: getPiText("piLoadingPort"),
    destination: getPiText("piDestination"),
    shipment: getPiText("piShipment"),
    deliveryTime: getPiText("piDeliveryTime"),
    packing: getPiText("piPacking"),
    seller: {
      company: getPiText("piSellerCompany"),
      address: getPiText("piSellerAddress"),
      contact: getPiText("piSellerContact"),
      tel: getPiText("piSellerTel"),
      email: getPiText("piSellerEmail"),
      licenseNo: getPiText("piSellerLicense"),
      customsCode: getPiText("piSellerCustoms")
    },
    buyer: {
      company: getPiText("piBuyerCompany"),
      address: getPiText("piBuyerAddress"),
      contact: getPiText("piBuyerContact"),
      tel: getPiText("piBuyerTel"),
      email: getPiText("piBuyerEmail"),
      taxNo: getPiText("piBuyerTax")
    },
    items: piState.items.map((row) => ({
      product: row.product,
      material: row.material,
      finish: row.finish,
      size: row.size,
      qty: cleanNum(row.qty),
      unit: row.unit || "set",
      unitPrice: cleanNum(row.unitPrice),
      remarks: row.remarks
    })),
    bank: {
      beneficiary: getPiText("piBankBeneficiary"),
      beneficiaryAddress: getPiText("piBeneficiaryAddress"),
      bankName: getPiText("piBankName"),
      bankAddress: getPiText("piBankAddress"),
      accountNo: getPiText("piAccountNo"),
      swift: getPiText("piSwift"),
      bankCode: getPiText("piBankCode"),
      paymentReference: getPiText("piPaymentReference"),
      bankCharges: getPiText("piBankCharges")
    },
    terms: getPiText("piTerms"),
    notes: getPiText("piNotes")
  };
}

function piAmount(row) {
  return cleanNum(row.qty) * cleanNum(row.unitPrice);
}

function piTotal() {
  return piState.items.reduce((sum, row) => sum + piAmount(row), 0);
}

function formatPiMoney(value, currency = getPiText("piCurrency") || "USD") {
  return `${currency} ${fmt.format(Math.round(value || 0))}`;
}

function renderPiItems() {
  const tbody = $("piItemTable").querySelector("tbody");
  tbody.innerHTML = "";
  piState.items.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="pi-product"><input value="${escapeXml(row.product)}" data-pi-item="${index}" data-key="product"></td>
      <td class="pi-material"><input value="${escapeXml(row.material)}" data-pi-item="${index}" data-key="material"></td>
      <td class="pi-finish"><input value="${escapeXml(row.finish)}" data-pi-item="${index}" data-key="finish"></td>
      <td class="pi-size"><input value="${escapeXml(row.size)}" data-pi-item="${index}" data-key="size"></td>
      <td class="pi-qty"><input class="num" type="number" step="1" value="${row.qty}" data-pi-item="${index}" data-key="qty"></td>
      <td class="pi-unit"><input value="${escapeXml(row.unit)}" data-pi-item="${index}" data-key="unit"></td>
      <td class="pi-price"><input class="num" type="number" step="0.01" value="${row.unitPrice}" data-pi-item="${index}" data-key="unitPrice"></td>
      <td class="pi-amount readonly">${fmt.format(Math.round(piAmount(row)))}</td>
      <td class="pi-remarks"><input value="${escapeXml(row.remarks)}" data-pi-item="${index}" data-key="remarks"></td>
      <td class="row-action"><button class="btn danger small-btn" type="button" data-delete-pi-item="${index}">×</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function previewRow(label, value) {
  return `<div class="pi-preview-row"><div class="label">${escapeXml(label)}</div><div class="value">${escapeXml(value || "-")}</div></div>`;
}

function renderPiPreview() {
  const invoice = getPiInvoice();
  const currency = invoice.currency || "USD";
  $("piCurrencyPill").textContent = currency;
  $("piTotalPill").textContent = formatPiMoney(piTotal(), currency);
  const itemRows = invoice.items.map((row, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeXml(row.product)}</td>
      <td class="money">${fmt.format(row.qty)}</td>
      <td class="money">${fmt.format(Math.round(row.unitPrice || 0))}</td>
      <td class="money">${fmt.format(Math.round(row.qty * row.unitPrice || 0))}</td>
    </tr>
  `).join("");
  $("piPreview").innerHTML = `
    <div class="pi-preview-block">
      <h3>${escapeXml(invoice.piNo || "PROFORMA INVOICE")}</h3>
      ${previewRow("开票日期", invoice.issueDate)}
      ${previewRow("贸易术语", `${invoice.incoterms} ${invoice.destination}`.trim())}
      ${previewRow("付款方式", invoice.paymentTerm)}
      ${previewRow("有效期", invoice.validity)}
    </div>
    <div class="pi-preview-block">
      ${previewRow("卖方", invoice.seller.company)}
      ${previewRow("买方", invoice.buyer.company)}
      ${previewRow("目的地", invoice.destination)}
      ${previewRow("交期", invoice.deliveryTime)}
    </div>
    <div class="pi-preview-table">
      <table>
        <thead><tr><th>No.</th><th>产品</th><th>数量</th><th>单价</th><th>金额</th></tr></thead>
        <tbody>${itemRows}</tbody>
      </table>
    </div>
  `;
  $("piStatusLine").textContent = `当前PI合计 ${formatPiMoney(piTotal(), currency)}，共 ${invoice.items.length} 个产品行。`;
}

function renderPi() {
  renderPiItems();
  renderPiPreview();
}

function persistPiDraft() {
  localStorage.setItem(piStorageDraftKey, JSON.stringify(getPiInvoice()));
}

function loadPiDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(piStorageDraftKey) || "null");
    if (!draft) return false;
    applyPiInvoice(draft);
    return true;
  } catch (error) {
    return false;
  }
}

function applyPiInvoice(invoice = {}) {
  const map = {
    piNo: invoice.piNo,
    piIssueDate: invoice.issueDate,
    piIncoterms: invoice.incoterms,
    piPaymentTerm: invoice.paymentTerm,
    piValidity: invoice.validity,
    piCustomerRef: invoice.customerRef,
    piCurrency: invoice.currency,
    piSalesContact: invoice.salesContact,
    piLoadingPort: invoice.loadingPort,
    piDestination: invoice.destination,
    piShipment: invoice.shipment,
    piDeliveryTime: invoice.deliveryTime,
    piPacking: invoice.packing,
    piSellerCompany: invoice.seller?.company,
    piSellerAddress: invoice.seller?.address,
    piSellerContact: invoice.seller?.contact,
    piSellerTel: invoice.seller?.tel,
    piSellerEmail: invoice.seller?.email,
    piSellerLicense: invoice.seller?.licenseNo,
    piSellerCustoms: invoice.seller?.customsCode,
    piBuyerCompany: invoice.buyer?.company,
    piBuyerAddress: invoice.buyer?.address,
    piBuyerContact: invoice.buyer?.contact,
    piBuyerTel: invoice.buyer?.tel,
    piBuyerEmail: invoice.buyer?.email,
    piBuyerTax: invoice.buyer?.taxNo,
    piBankBeneficiary: invoice.bank?.beneficiary,
    piBeneficiaryAddress: invoice.bank?.beneficiaryAddress,
    piBankName: invoice.bank?.bankName,
    piBankAddress: invoice.bank?.bankAddress,
    piAccountNo: invoice.bank?.accountNo,
    piSwift: invoice.bank?.swift,
    piBankCode: invoice.bank?.bankCode,
    piPaymentReference: invoice.bank?.paymentReference,
    piBankCharges: invoice.bank?.bankCharges,
    piTerms: invoice.terms,
    piNotes: invoice.notes
  };
  Object.entries(map).forEach(([id, value]) => {
    if (!$(id) || value === undefined) return;
    if (id === "piIncoterms" && !supportedPiTerms.has(value)) {
      $(id).value = "CFR";
      return;
    }
    $(id).value = value;
  });
  if (Array.isArray(invoice.items) && invoice.items.length) {
    piState.items = invoice.items.map((row) => ({ ...row }));
  }
}

function updatePiItem(event) {
  const target = event.target;
  if (!target.matches("[data-pi-item]")) return false;
  const row = piState.items[Number(target.dataset.piItem)];
  const key = target.dataset.key;
  row[key] = target.type === "number" ? cleanNum(target.value) : target.value;
  renderPiPreview();
  persistPiDraft();
  return true;
}

function updatePiForm(event) {
  if (!event.target.closest("#piPage")) return;
  if (updatePiItem(event)) return;
  if (event.target.id === "piNo" || event.target.id === "piBuyerCompany") {
    $("piPaymentReference").value = `${$("piNo").value} - ${$("piBuyerCompany").value}`.trim();
  }
  renderPiPreview();
  persistPiDraft();
}

function addPiItem(row = {}) {
  piState.items.push({
    product: "",
    material: "",
    finish: "",
    size: "",
    qty: 1,
    unit: "set",
    unitPrice: 0,
    remarks: "",
    ...row
  });
  renderPi();
  persistPiDraft();
}

function clearPi() {
  localStorage.removeItem(piStorageDraftKey);
  document.querySelectorAll("#piPage input, #piPage textarea").forEach((input) => {
    input.value = "";
  });
  $("piIncoterms").value = "CFR";
  $("piCurrency").value = "USD";
  piState.items = [{ product: "", material: "", finish: "", size: "", qty: 1, unit: "set", unitPrice: 0, remarks: "" }];
  renderPi();
  $("piStatusLine").textContent = "已清空当前PI内容。";
}

async function importQuoteToPi() {
  try {
    const { inputs, goodsCost, selected } = await ensureCalculationResult();
    const currency = inputs.outputCurrency || "USD";
    $("piSellerCompany").value = inputs.companyName;
    $("piBuyerCompany").value = inputs.projectName;
    $("piIncoterms").value = inputs.tradeTerm;
    $("piDestination").value = inputs.destination;
    $("piValidity").value = inputs.validUntil || $("piValidity").value;
    $("piCurrency").value = currency;
    $("piNo").value = $("piNo").value || defaultPiNo();
    $("piIssueDate").value = $("piIssueDate").value || todayISO();
    $("piPaymentReference").value = `${$("piNo").value} - ${inputs.projectName}`;
    piState.items = state.cargo.map((row) => ({
      product: row.name,
      material: "",
      finish: "",
      size: cargoSizeCm(row),
      qty: cleanNum(row.qty) || 1,
      unit: "set",
      unitPrice: Math.round(customerCargoUnitByCurrency(row, selected, goodsCost, currency) * 100) / 100,
      remarks: row.spec
    }));
    if (!piState.items.length) addPiItem();
    renderPi();
    persistPiDraft();
    setActiveView("pi");
  } catch (e) {
    alert("从报价带入PI失败: " + e.message);
  }
}

function piSafeName() {
  return (getPiText("piNo") || getPiText("piBuyerCompany") || "PI发票").replace(/[\\/:*?"<>|]/g, "_");
}

async function exportPIExcel() {
  const invoice = getPiInvoice();
  try {
    const resp = await fetch("/api/pi/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(invoice)
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${piSafeName()}_PI形式发票.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    $("piStatusLine").textContent = "已生成并下载PI Excel。";
  } catch (error) {
    alert("PI导出失败: " + error.message);
  }
}

document.addEventListener("input", updateStateOnInput);
document.addEventListener("change", updateStateOnChange);
document.addEventListener("input", updatePiForm);
document.addEventListener("change", updatePiForm);
document.addEventListener("click", (event) => {
  const cargoIndex = event.target.dataset.deleteCargo;
  const removeImageIndex = event.target.dataset.removeImage;
  const freightIndex = event.target.dataset.deleteFreight;
  const portChargeIndex = event.target.dataset.deletePortCharge;
  const piItemIndex = event.target.dataset.deletePiItem;
  if (cargoIndex !== undefined) {
    state.cargo.splice(Number(cargoIndex), 1);
    syncAndRender();
    scheduleAutoSave();
  }
  if (removeImageIndex !== undefined) {
    const row = state.cargo[Number(removeImageIndex)];
    if (row) {
      row.imageName = "";
      row.imageData = "";
      row.imageUrl = "";
      syncAndRender();
      scheduleAutoSave();
    }
  }
  if (freightIndex !== undefined) {
    state.freight.splice(Number(freightIndex), 1);
    syncAndRender();
    scheduleAutoSave();
  }
  if (portChargeIndex !== undefined) {
    state.portCharges.splice(Number(portChargeIndex), 1);
    syncAndRender();
    scheduleAutoSave();
  }
  if (piItemIndex !== undefined) {
    piState.items.splice(Number(piItemIndex), 1);
    if (!piState.items.length) addPiItem();
    renderPi();
    persistPiDraft();
  }
  
  const loadID = event.target.dataset.loadId;
  if (loadID) {
    loadSnapshot(loadID);
  }

  const deleteID = event.target.dataset.deleteId;
  if (deleteID) {
    deleteSnapshot(deleteID, event);
  }

  const updateLabelID = event.target.dataset.updateLabelId;
  if (updateLabelID) {
    updateSnapshotLabel(updateLabelID, event);
  }
});

$("addCargoBtn").addEventListener("click", addCargo);
$("addFreightBtn").addEventListener("click", () => addFreight());
$("addPortChargeBtn").addEventListener("click", () => addPortCharge());
$("addDestinationPortChargeBtn").addEventListener("click", addDestinationPortCharge);
$("loadPortExampleBtn").addEventListener("click", loadPortChargeExamples);
$("fetchRateBtn").addEventListener("click", fetchUsdCnyRate);
$("policyLookupBtn").addEventListener("click", openPolicyLookup);
$("clearBtn").addEventListener("click", clearAllData);
$("newQuoteBtn").addEventListener("click", newQuote);
$("mdBtn").addEventListener("click", () => openExportDialog("md"));
$("pdfBtn").addEventListener("click", () => openExportDialog("pdf"));
$("excelBtn").addEventListener("click", () => openExportDialog("excel"));
$("cancelExportBtn").addEventListener("click", closeExportDialog);
$("exportDialog").addEventListener("click", (event) => {
  if (event.target.id === "exportDialog") closeExportDialog();
  const mode = event.target.dataset.exportMode;
  if (mode) downloadSelectedVersion(mode);
});

$("archiveBtn").addEventListener("click", archiveSnapshot);
$("historyBtn").addEventListener("click", fetchHistory);
$("closeHistoryBtn").addEventListener("click", () => $("historyDialog").classList.add("hidden"));
$("historyTable").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !event.target.matches(".history-label-input")) return;
  event.preventDefault();
  event.target.closest(".history-label-editor")?.querySelector("[data-update-label-id]")?.click();
});
document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => setActiveView(button.dataset.view));
});
$("piAddItemBtn").addEventListener("click", () => addPiItem());
$("piImportQuoteBtn").addEventListener("click", importQuoteToPi);
$("piClearBtn").addEventListener("click", clearPi);
$("piExportBtn").addEventListener("click", exportPIExcel);

loadDraftOnStart();
resetQuoteWorkspace("已打开空白报价；可从历史加载归档。");
if (!loadPiDraft()) initPiDefaults();
renderPi();
