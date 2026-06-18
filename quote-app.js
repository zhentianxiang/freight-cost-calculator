const state = {
  schemes: ["A货代", "B货代"],
  cargo: [
    { name: "大理石马", spec: "实际出货尺寸", length: 210, height: 210, width: 50, weight: 2200, qty: 5, unitPrice: 20000, taxRate: 13 },
    { name: "不锈钢猎鹰", spec: "实际出货尺寸", length: 300, height: 200, width: 80, weight: 500, qty: 1, unitPrice: 40000, taxRate: 0 }
  ],
  freight: [
    { scheme: "A货代", item: "船运费用", amount: 20300, included: true },
    { scheme: "A货代", item: "保险费", amount: 3500, included: true },
    { scheme: "A货代", item: "报关费用", amount: 3500, included: true },
    { scheme: "A货代", item: "港杂费用", amount: 3500, included: true },
    { scheme: "A货代", item: "送货到港口费用", amount: 6500, included: true },
    { scheme: "B货代", item: "船运费用", amount: 43910, included: true },
    { scheme: "B货代", item: "订舱费", amount: 390, included: true },
    { scheme: "B货代", item: "港杂费", amount: 200, included: true },
    { scheme: "B货代", item: "文件费", amount: 450, included: true },
    { scheme: "B货代", item: "THC码头操作费", amount: 986, included: true },
    { scheme: "B货代", item: "EDI费", amount: 30, included: true },
    { scheme: "B货代", item: "设备管理费", amount: 100, included: true },
    { scheme: "B货代", item: "舱单录入费", amount: 100, included: true },
    { scheme: "B货代", item: "电放费", amount: 450, included: true },
    { scheme: "B货代", item: "报关费", amount: 100, included: true },
    { scheme: "B货代", item: "熏蒸费", amount: 400, included: true },
    { scheme: "B货代", item: "拖车费", amount: 3600, included: true }
  ]
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
const schemeLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
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
    selectedScheme: $("selectedScheme").value,
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
    selectedScheme: $("selectedScheme").value,
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
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    label,
    updatedAt: new Date().toISOString(),
    inputs: getRawInputs(),
    schemes: [...state.schemes],
    cargo: state.cargo.map((row) => ({ ...row })),
    freight: state.freight.map((row) => ({ ...row }))
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
      taxRate: cleanNum(row.taxRate)
    })),
    freight: state.freight.map((row) => ({
      ...row,
      amount: cleanNum(row.amount),
      included: Boolean(row.included)
    }))
  };
}

function snapshotSignature(snapshot) {
  return JSON.stringify({
    inputs: snapshot.inputs,
    schemes: snapshot.schemes,
    cargo: snapshot.cargo,
    freight: snapshot.freight
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
  try {
    const snapshot = JSON.parse(localStorage.getItem(storageDraftKey) || localStorage.getItem("quote-calculator-data") || "null");
    if (!snapshot) return;
    applyInputs(snapshot.inputs);
    state.cargo = Array.isArray(snapshot.cargo) ? normalizeCargoDimensions(snapshot.cargo) : state.cargo;
    state.freight = Array.isArray(snapshot.freight) ? snapshot.freight : state.freight;
    state.schemes = Array.isArray(snapshot.schemes) ? snapshot.schemes : getSchemeIds();
    lastSavedSignature = snapshotSignature(getSnapshot("启动"));
  } catch (error) {
    // Keep default template if local storage data is corrupted.
  }
}

function getSchemeIds() {
  const fromRows = state.freight.map((row) => row.scheme).filter(Boolean);
  const rowSchemes = [...new Set(fromRows)];
  if (rowSchemes.length) return rowSchemes;

  const fromState = Array.isArray(state.schemes) ? state.schemes.filter(Boolean) : [];
  const stateSchemes = [...new Set(fromState)];
  return stateSchemes.length ? [stateSchemes[0]] : ["A"];
}

function isMeaningfulFreightRow(row) {
  return Boolean(String(row.item ?? "").trim()) || cleanNum(row.amount) > 0;
}

function getSummarySchemeIds() {
  const fromRows = state.freight
    .filter(isMeaningfulFreightRow)
    .map((row) => row.scheme)
    .filter(Boolean);
  const unique = [...new Set(fromRows)];
  return unique.length ? unique : [getSchemeIds()[0]];
}

function syncSchemesFromRows() {
  state.schemes = getSchemeIds();
}

function renderSchemeOptions() {
  syncSchemesFromRows();
  const select = $("selectedScheme");
  const current = select.value;
  select.innerHTML = state.schemes
    .map((scheme) => `<option value="${escapeXml(scheme)}">${escapeXml(scheme)}</option>`)
    .join("");
  select.value = state.schemes.includes(current) ? current : state.schemes[0];
}

function getNextSchemeId() {
  const used = new Set(getSchemeIds());
  const nextLetter = schemeLetters.find((letter) => !used.has(letter));
  if (nextLetter) return nextLetter;
  let index = 1;
  while (used.has(`方案${index}`)) index += 1;
  return `方案${index}`;
}

function renderCargo() {
  const tbody = $("cargoTable").querySelector("tbody");
  tbody.innerHTML = "";
  state.cargo.forEach((row, index) => {
    const imageLabel = row.imageName ? escapeXml(row.imageName) : "上传";
    const preview = row.imageData ? `<img class="cargo-thumb" alt="${escapeXml(row.imageName || row.name || "货物图片")}" src="${escapeXml(row.imageData)}">` : "";
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
          ${row.imageData ? `<button class="btn danger small-btn" title="移除图片" type="button" data-remove-image="${index}">×</button>` : ""}
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

const baseFreightItems = [
  "船运费用", "保险费", "报关费用", "港杂费用", "送货到港口费用",
  "订舱费", "文件费", "THC码头操作费", "EDI费", "设备管理费",
  "舱单录入费", "电放费", "熏蒸费", "拖车费", "仓储费", "查验费", "目的港费用",
  "目的国派送费", "进口清关服务费", "进口关税", "进口VAT/GST"
];

function updateFreightDatalist() {
  const term = $("tradeTerm").value;
  const list = $("freightItemList");
  if (!list) return;
  
  const filtered = baseFreightItems.filter(item => {
    if (term === "FOB" && item === "船运费用") return false;
    if (term === "CFR" && item === "保险费") return false;
    return true;
  });
  
  list.innerHTML = filtered.map(i => `<option value="${escapeXml(i)}"></option>`).join("");
}

function renderFreight() {
  syncSchemesFromRows();
  updateFreightDatalist();
  const schemeOptions = state.schemes
    .map((scheme) => `<option value="${escapeXml(scheme)}">${escapeXml(scheme)}</option>`)
    .join("");
  const tbody = $("freightTable").querySelector("tbody");
  tbody.innerHTML = "";
  state.freight.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="freight-scheme">
        <select data-freight="${index}" data-key="scheme">
          ${schemeOptions}
        </select>
      </td>
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

    tr.querySelector("[data-key='scheme']").value = row.scheme;
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
  renderDestinationCostVisibility(result.inputs.tradeTerm);
  $("selectedSchemePill").textContent = `${selected.scheme} 最优`;
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
      <td>${row.scheme}${row.scheme === selected.scheme ? "（最优）" : ""}</td>
      <td class="money">${fmt.format(row.freight)}</td>
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
  if (term === "FOB") return "FOB通常不包含国际海运费；如货代费用里计入了海运费，需改为不计入或改用CFR/CIF口径。";
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
  
  if (target.matches("[data-image-cargo]")) {
    updateCargoImage(target);
    return;
  } else if (target.matches("[data-cargo]")) {
    const row = state.cargo[Number(target.dataset.cargo)];
    const key = target.dataset.key;
    row[key] = target.type === "number" ? cleanNum(target.value) : target.value;
    changed = true;
  } else if (target.matches("[data-freight]")) {
    const row = state.freight[Number(target.dataset.freight)];
    const key = target.dataset.key;
    if (key === "included") row[key] = target.value === "true";
    else row[key] = target.type === "number" ? cleanNum(target.value) : target.value;
    changed = true;
  } else if (target.id === "tradeTerm") {
    updateFreightDatalist();
    changed = true;
  } else if (target.closest(".section-body") || target.closest(".topbar")) {
    changed = true;
  }

  if (changed) {
    renderCurrencyConverter();
    renderSummary();
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
    renderCargo();
    changed = true;
  } else if (target.matches("[data-freight]")) {
    const row = state.freight[Number(target.dataset.freight)];
    const key = target.dataset.key;
    if (key === "included") row[key] = target.value === "true";
    else row[key] = target.type === "number" ? cleanNum(target.value) : target.value;
    renderFreight();
    changed = true;
  } else if (target.closest(".section-body") || target.closest(".topbar")) {
    changed = true;
  }

  if (changed) {
    renderCurrencyConverter();
    renderSummary();
    scheduleAutoSave();
  }
}

function addCargo() {
  state.cargo.push({ name: "", spec: "", length: 0, height: 0, width: 0, weight: 0, qty: 1, unitPrice: 0, taxRate: 0, imageName: "", imageData: "" });
  syncAndRender();
  scheduleAutoSave();
}

function addFreight(scheme) {
  const targetScheme = scheme || $("selectedScheme").value || getSchemeIds()[0];
  state.freight.push({ scheme: targetScheme, item: "", amount: 0, included: true });
  syncAndRender();
  scheduleAutoSave();
}

function addFreightScheme() {
  const defaultName = getNextSchemeId();
  $("schemeNameInput").value = defaultName;
  $("schemeError").classList.add("hidden");
  $("schemePromptDialog").classList.remove("hidden");
  setTimeout(() => {
    const input = $("schemeNameInput");
    input.focus();
    input.select();
  }, 50);
}

function saveSchemeName() {
  const name = $("schemeNameInput").value.trim();
  if (!name) {
    $("schemeError").textContent = "方案名称不能为空。";
    $("schemeError").classList.remove("hidden");
    return;
  }
  if (state.schemes.includes(name)) {
    $("schemeError").textContent = "该名称已存在，请使用其他名称。";
    $("schemeError").classList.remove("hidden");
    return;
  }
  const scheme = name;
  state.schemes.push(scheme);
  state.freight.push({ scheme, item: "", amount: 0, included: true });
  syncAndRender();
  $("selectedScheme").value = scheme;
  renderSummary();
  scheduleAutoSave();
  $("schemePromptDialog").classList.add("hidden");
}

function cancelSchemeName() {
  $("schemePromptDialog").classList.add("hidden");
}

function applyEmptyState() {
  state.schemes = ["A货代"];
  state.cargo = [];
  state.freight = [];
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
  closeExportDialog();
}

 function clearAllData() {
  clearInputFields();
  applyEmptyState();
  window.clearTimeout(autosaveTimer);
  lastSavedSignature = "";
  localStorage.removeItem("quote-calculator-data");
  localStorage.removeItem(storageDraftKey);
  syncAndRender();
  $("statusLine").textContent = "已清空当前数据和本机保存。";
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
        const maxSize = 900;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve({
          imageName: randomImageName(),
          imageData: canvas.toDataURL("image/jpeg", 0.82)
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

async function updateCargoImage(input) {
  const index = Number(input.dataset.imageCargo);
  const file = input.files && input.files[0];
  if (!file || !state.cargo[index]) return;
  try {
    const image = await readImageFile(file);
    state.cargo[index].imageName = image.imageName;
    state.cargo[index].imageData = image.imageData;
    syncAndRender();
    scheduleAutoSave();
  } catch (error) {
    alert("图片读取失败，请换一张图片重试。");
  }
}

async function archiveSnapshot() {
  const snapshot = normalizeSnapshotForServer(getSnapshot("服务器归档"));
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
    $("statusLine").textContent = "已成功归档到服务器长期保存。";
    saved = true;
    button.textContent = "已归档";
    showToast("已保存到归档");
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
    const resp = await fetch(`/api/load?id=${id}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    
    applyInputs(data.inputs);
    state.cargo = Array.isArray(data.cargo) ? normalizeCargoDimensions(data.cargo) : state.cargo;
    state.freight = Array.isArray(data.freight) ? data.freight : state.freight;
    state.schemes = Array.isArray(data.schemes) ? data.schemes : getSchemeIds();
    
    syncAndRender();
    $("historyDialog").classList.add("hidden");
    $("statusLine").textContent = `已加载服务器归档: ${data.inputs.projectName} (${formatSaveTime(data.updatedAt)})`;
  } catch (e) {
    alert("加载失败: " + e.message);
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
      syncAndRender();
      scheduleAutoSave();
    }
  }
  if (freightIndex !== undefined) {
    state.freight.splice(Number(freightIndex), 1);
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
$("addFreightSchemeBtn").addEventListener("click", addFreightScheme);
$("addFreightBtn").addEventListener("click", () => addFreight());
$("fetchRateBtn").addEventListener("click", fetchUsdCnyRate);
$("policyLookupBtn").addEventListener("click", openPolicyLookup);
$("clearBtn").addEventListener("click", clearAllData);
$("mdBtn").addEventListener("click", () => openExportDialog("md"));
$("excelBtn").addEventListener("click", () => openExportDialog("excel"));
$("saveSchemeBtn").addEventListener("click", saveSchemeName);
$("cancelSchemeBtn").addEventListener("click", cancelSchemeName);
$("schemePromptDialog").addEventListener("click", (event) => {
  if (event.target.id === "schemePromptDialog") cancelSchemeName();
});
$("schemeNameInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveSchemeName();
});
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
syncAndRender();
if (!loadPiDraft()) initPiDefaults();
renderPi();
