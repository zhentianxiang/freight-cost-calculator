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
let pendingDownloadType = "";
let autosaveTimer = 0;
let lastSavedSignature = "";

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

function quoteUnitUsd() {
  const result = calculate();
  const selected = getBestScheme(result.schemes) || result.schemes[0];
  const qty = totalCargoQty();
  return qty ? selected.quoteUsd / qty : 0;
}

function quoteUnitByCurrency(currency) {
  const result = calculate();
  const selected = getBestScheme(result.schemes) || result.schemes[0];
  const qty = totalCargoQty();
  if (!qty || !selected) return 0;
  return quoteValueByCurrency(selected, currency) / qty;
}

function quoteLineUsd(row) {
  return quoteUnitUsd() * cleanNum(row.qty);
}

function quoteLineByCurrency(row, currency) {
  return quoteUnitByCurrency(currency) * cleanNum(row.qty);
}

function quoteValueByCurrency(row, currency) {
  if (currency === "RMB") return row.quoteRmb || 0;
  if (currency === "EUR") return row.quoteEur || 0;
  return row.quoteUsd || 0;
}

function formatQuoteMoney(value, currency) {
  if (currency === "RMB") return `¥${fmt.format(Math.round(value || 0))}`;
  if (currency === "EUR") return `€${fmt.format(Math.round(value || 0))}`;
  return `$${fmt.format(Math.round(value || 0))}`;
}

function formatPrimaryQuote(value, currency) {
  return formatQuoteMoney(value, currency);
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
    if ($(key)) $(key).value = value;
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

function calculate() {
  const inputs = getInputs();
  const goodsCost = state.cargo.reduce((sum, row) => sum + cargoTotal(row), 0);
  const schemes = getSummarySchemeIds().map((scheme) => {
    const rows = state.freight.filter((row) => row.scheme === scheme);
    const freight = state.freight
      .filter((row) => row.scheme === scheme && row.included)
      .reduce((sum, row) => sum + cleanNum(row.amount), 0);
    const importCosts = estimateImportCosts(inputs, goodsCost, freight);
    const totalCost = goodsCost + freight + importCosts.includedTotal;
    
    // 最终报价(RMB) = 总成本 / (1 - 目标利润率%)
    const profitRate = cleanNum(inputs.targetProfit);
    const divisor = 1 - profitRate / 100;
    // 保护：防止除以0或利润率过高导致报价异常，若利润率>=100则采用成本加成方式兜底
    const quoteRmb = divisor > 0.01 ? totalCost / divisor : totalCost * (1 + profitRate / 100);
    
    const quoteUsd = inputs.exchangeRate > 0 ? quoteRmb / inputs.exchangeRate : 0;
    const quoteEur = inputs.eurExchangeRate > 0 ? quoteRmb / inputs.eurExchangeRate : 0;
    
    const targetPrice = quoteRmb;
    const profit = quoteRmb - totalCost;
    const margin = quoteRmb > 0 ? (profit / quoteRmb) * 100 : 0;
    const markup = totalCost > 0 ? (profit / totalCost) * 100 : 0;
    const hasQuotedCost = rows.some((row) => row.included && cleanNum(row.amount) > 0);
    return { scheme, freight, totalCost, targetPrice, quoteRmb, quoteUsd, quoteEur, profit, margin, markup, hasQuotedCost, importCosts };
  });
  return { inputs, goodsCost, schemes };
}

function estimateImportCosts(inputs, goodsCost, freight) {
  const customsValue = goodsCost + freight;
  const duty = customsValue * cleanNum(inputs.dutyRate) / 100;
  const importTax = (customsValue + duty) * cleanNum(inputs.importVatRate) / 100;
  const destinationLocal = cleanNum(inputs.destinationDelivery) + cleanNum(inputs.destinationOther);
  const clearance = cleanNum(inputs.destinationClearance);
  const term = inputs.tradeTerm;
  const includeDelivery = term === "DAP" || term === "DDP";
  const includeImport = term === "DDP";
  const includedTotal = (includeDelivery ? destinationLocal : 0) + (includeImport ? clearance + duty + importTax : 0);
  return { customsValue, duty, importTax, destinationLocal, clearance, includedTotal, includeDelivery, includeImport };
}

function getBestScheme(schemes) {
  const eligible = schemes.filter((row) => row.hasQuotedCost);
  const candidates = eligible.length ? eligible : schemes;
  return candidates.reduce((best, row) => {
    if (!best) return row;
    if (row.totalCost < best.totalCost) return row;
    if (row.totalCost === best.totalCost && row.profit > best.profit) return row;
    return best;
  }, null);
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

function renderSummary() {
  const result = calculate();
  if (!result.schemes || result.schemes.length === 0) return;

  const selected = getBestScheme(result.schemes) || result.schemes[0];
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

function renderImportCostSummary(inputs, costs = estimateImportCosts(inputs, 0, 0)) {
  const scope = $("importScope");
  const note = $("importCostNote");
  if (!scope || !note) return;
  if (inputs.tradeTerm === "DDP") {
    scope.textContent = `已计入DDP：派送/其他 ${money(costs.destinationLocal)}，清关 ${money(costs.clearance)}，关税 ${money(costs.duty)}，VAT/GST ${money(costs.importTax)}`;
  } else if (inputs.tradeTerm === "DAP") {
    scope.textContent = `已计入DAP：目的国派送/其他 ${money(costs.destinationLocal)}；关税/VAT仅作参考`;
  } else {
    scope.textContent = `${inputs.tradeTerm}不自动计入目的国费用`;
  }
  note.textContent = `估算完税基础 ${money(costs.customsValue)}；进口关税 ${money(costs.duty)}；进口VAT/GST ${money(costs.importTax)}。政策与税率请按目的国、HS编码和原产地确认。`;
}

function syncAndRender() {
  renderCargo();
  renderFreight();
  renderSchemeOptions();
  renderSummary();
}

function updateStateOnInput(event) {
  const target = event.target;
  if (target.closest("#piPage")) return;
  
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
    renderSummary();
    scheduleAutoSave();
  }
}

function updateStateOnChange(event) {
  const target = event.target;
  if (target.closest("#piPage")) return;
  
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

const defaultExclusion = "目的港清关、关税、目的港杂费、仓储费、查验费、目的地派送及其他买方当地费用默认不包含在CFR报价内。";

function tx(lang, zh, en) {
  if (lang === "en") return en;
  if (lang === "bilingual") return `${zh} / ${en}`;
  return zh;
}

function yesNo(value, lang) {
  return value ? tx(lang, "是", "Yes") : tx(lang, "否", "No");
}

function currencyLabel(currency, lang = "zh") {
  if (currency === "RMB") return tx(lang, "人民币", "RMB");
  if (currency === "EUR") return tx(lang, "欧元", "EUR");
  return tx(lang, "美元", "USD");
}

function freightName(scheme, lang) {
  return scheme;
}

function quoteTitle(projectName, lang, detail = false) {
  const base = detail ? tx(lang, "报价明细", "Quotation Detail") : tx(lang, "报价单", "Quotation");
  return `${projectName} ${base}`.trim();
}

function languageSuffix(lang) {
  if (lang === "en") return "English";
  if (lang === "bilingual") return "中英双语";
  return "中文";
}

function sheetName(name) {
  return escapeXml(String(name).replace(/[\\/:*?\[\]]/g, " ").slice(0, 31).trim() || "Sheet");
}

function buildMarkdown(mode, lang = "zh") {
  if (mode === "customer") return buildCustomerMarkdown(lang);
  return buildInternalMarkdown(lang);
}

function buildInternalMarkdown(lang = "zh") {
  const { inputs, goodsCost, schemes } = calculate();
  const selected = getBestScheme(schemes) || schemes[0];
  const lines = [];
  lines.push(`# ${escapeMd(quoteTitle(inputs.projectName, lang, true))}`);
  lines.push("");
  if (inputs.companyName) lines.push(`- ${tx(lang, "我方公司", "Quoted by")}：${escapeMd(inputs.companyName)}`);
  lines.push(`- ${tx(lang, "贸易术语", "Trade Term")}：${inputs.tradeTerm}`);
  lines.push(`- ${tx(lang, "柜型", "Container Type")}：${escapeMd(inputs.containerType)}`);
  lines.push(`- ${tx(lang, "目的港/目的地", "Destination")}：${escapeMd(inputs.destination)}`);
  lines.push(`- ${tx(lang, "报价有效期", "Valid Until")}：${escapeMd(inputs.validUntil)}`);
  lines.push(`- ${tx(lang, "USD兑RMB汇率", "USD/RMB Rate")}：${inputs.exchangeRate}`);
  lines.push(`- ${tx(lang, "EUR兑RMB汇率", "EUR/RMB Rate")}：${inputs.eurExchangeRate}`);
  lines.push(`- ${tx(lang, "最终报价币种", "Final Currency")}：${inputs.outputCurrency}`);
  if (inputs.destinationCountry) lines.push(`- ${tx(lang, "目的国", "Destination Country")}：${escapeMd(inputs.destinationCountry)}`);
  if (inputs.hsCode) lines.push(`- ${tx(lang, "HS编码", "HS Code")}：${escapeMd(inputs.hsCode)}`);
  lines.push(`- ${tx(lang, "进口关税率", "Import Duty Rate")}：${inputs.dutyRate}%`);
  lines.push(`- ${tx(lang, "进口VAT/GST", "Import VAT/GST")}：${inputs.importVatRate}%`);
  lines.push("");
  lines.push(`## ${tx(lang, "货物成本", "Cargo Cost")}`);
  lines.push("");
  lines.push(`|${tx(lang, "货物名称", "Cargo")}|${tx(lang, "图片", "Image")}|${tx(lang, "规格", "Specification")}|${tx(lang, "长(cm)", "Length(cm)")}|${tx(lang, "高(cm)", "Height(cm)")}|${tx(lang, "宽(cm)", "Width(cm)")}|${tx(lang, "单箱KG", "KG/Unit")}|${tx(lang, "数量", "Qty")}|${tx(lang, "单价RMB", "Unit Price RMB")}|${tx(lang, "税率", "Tax Rate")}|${tx(lang, "税费RMB", "Tax RMB")}|${tx(lang, "合计RMB", "Total RMB")}|${tx(lang, "平均报价单价", "Avg Quote Unit")} ${inputs.outputCurrency}|${tx(lang, "报价金额", "Quote Amount")} ${inputs.outputCurrency}|`);
  lines.push("|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  state.cargo.forEach((row) => {
    lines.push(`|${escapeMd(row.name)}|${escapeMd(row.imageName || "")}|${escapeMd(row.spec)}|${row.length}|${row.height}|${row.width}|${fmt.format(row.weight)}|${row.qty}|${fmt.format(row.unitPrice)}|${row.taxRate}%|${fmt.format(cargoTax(row))}|${fmt.format(cargoTotal(row))}|${fmt.format(quoteUnitByCurrency(inputs.outputCurrency))}|${fmt.format(quoteLineByCurrency(row, inputs.outputCurrency))}|`);
  });
  lines.push(`|**${tx(lang, "货物总成本", "Total Cargo Cost")}**|||||||||||**${fmt.format(goodsCost)}**||**${fmt.format(quoteValueByCurrency(selected, inputs.outputCurrency))}**|`);
  lines.push("");
  lines.push(`## ${tx(lang, "货代费用", "Freight Forwarder Cost")}`);
  lines.push("");
  schemes.forEach(({ scheme }) => {
    lines.push(`### ${freightName(scheme, lang)}`);
    lines.push("");
    lines.push(`|${tx(lang, "费用项目", "Cost Item")}|${tx(lang, "金额RMB", "Amount RMB")}|${tx(lang, "计入报价", "Included")}|`);
    lines.push("|---|---:|---|");
    state.freight.filter((row) => row.scheme === scheme).forEach((row) => {
      lines.push(`|${escapeMd(row.item)}|${fmt.format(row.amount)}|${yesNo(row.included, lang)}|`);
    });
    const summary = schemes.find((item) => item.scheme === scheme);
    lines.push(`|**${tx(lang, "计入费用合计", "Included Cost Total")}**|**${fmt.format(summary.freight)}**||`);
    lines.push("");
  });
  lines.push(`## ${tx(lang, "利润测算", "Profit Calculation")}`);
  lines.push("");
  lines.push(`|${tx(lang, "方案", "Option")}|${tx(lang, "物流费RMB", "Logistics RMB")}|${tx(lang, "总成本RMB", "Total Cost RMB")}|${tx(lang, "报价USD", "Quote USD")}|${tx(lang, "报价EUR", "Quote EUR")}|${tx(lang, "最终报价RMB", "Final Quote RMB")}|${tx(lang, "净利润RMB", "Net Profit RMB")}|${tx(lang, "净利率", "Net Margin")}|${tx(lang, "成本加成率", "Markup")}|`);
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  schemes.forEach((row) => {
    lines.push(`|${freightName(row.scheme, lang)}|${fmt.format(row.freight)}|${fmt.format(row.totalCost)}|${fmt.format(Math.round(row.quoteUsd))}|${fmt.format(Math.round(row.quoteEur))}|${fmt.format(row.quoteRmb)}|${fmt.format(row.profit)}|${pct(row.margin)}|${pct(row.markup)}|`);
  });
  lines.push("");
  lines.push(`${tx(lang, "自动推荐方案", "Recommended option")}：${freightName(selected.scheme, lang)}，${tx(lang, "预计净利润", "Estimated net profit")} ${fmt.format(selected.profit)} RMB。`);
  if (inputs.notes) {
    lines.push("");
    lines.push(`## ${tx(lang, "备注", "Notes")}`);
    lines.push("");
    lines.push(inputs.notes);
  }
  return lines.join("\n");
}

function buildCustomerMarkdown(lang = "zh") {
  const { inputs, schemes } = calculate();
  const selected = getBestScheme(schemes) || schemes[0];
  const lines = [];
  lines.push(`# ${escapeMd(quoteTitle(inputs.projectName, lang))}`);
  lines.push("");
  lines.push(`| ${tx(lang, "项目", "Item")} | ${tx(lang, "内容", "Details")} |`);
  lines.push("|---|---|");
  if (inputs.companyName) lines.push(`| ${tx(lang, "我方公司", "Quoted by")} | ${escapeMd(inputs.companyName)} |`);
  lines.push(`| ${tx(lang, "贸易术语", "Trade Term")} | ${inputs.tradeTerm} ${escapeMd(inputs.destination || tx(lang, "目的港", "Destination Port"))} |`);
  lines.push(`| ${tx(lang, "柜型", "Container Type")} | ${escapeMd(inputs.containerType)} |`);
  lines.push(`| ${tx(lang, "报价有效期", "Valid Until")} | ${escapeMd(inputs.validUntil)} |`);
  lines.push(`| ${tx(lang, "报价金额", "Quotation Amount")} | **${formatQuoteMoney(quoteValueByCurrency(selected, inputs.outputCurrency), inputs.outputCurrency)}** |`);
  lines.push("");
  lines.push(`## ${tx(lang, "货物信息", "Cargo Information")}`);
  lines.push("");
  lines.push(`| ${tx(lang, "货物名称", "Cargo")} | ${tx(lang, "图片", "Image")} | ${tx(lang, "规格", "Specification")} | ${tx(lang, "长(cm)", "Length(cm)")} | ${tx(lang, "高(cm)", "Height(cm)")} | ${tx(lang, "宽(cm)", "Width(cm)")} | ${tx(lang, "单箱KG", "KG/Unit")} | ${tx(lang, "数量", "Qty")} | ${tx(lang, "平均报价单价", "Avg Unit Price")} ${inputs.outputCurrency} | ${tx(lang, "报价金额", "Amount")} ${inputs.outputCurrency} |`);
  lines.push("|---|---|---|---:|---:|---:|---:|---:|---:|---:|");
  state.cargo.forEach((row) => {
    lines.push(`|${escapeMd(row.name)}|${escapeMd(row.imageName || "")}|${escapeMd(row.spec)}|${row.length}|${row.height}|${row.width}|${fmt.format(row.weight)}|${row.qty}|${fmt.format(quoteUnitByCurrency(inputs.outputCurrency))}|${fmt.format(quoteLineByCurrency(row, inputs.outputCurrency))}|`);
  });
  lines.push("");
  lines.push(`## ${tx(lang, "费用说明", "Cost Scope")}`);
  lines.push("");
  lines.push(`- ${getCustomerTermText(inputs.tradeTerm, inputs.destination, lang)}`);
  lines.push(`- ${getExclusionText(lang)}`);
  if (inputs.notes && inputs.notes !== defaultExclusion) lines.push(`- ${escapeMd(inputs.notes)}`);
  return lines.join("\n");
}

function getCustomerTermText(term, destination, lang = "zh") {
  const place = destination || tx(lang, "指定目的港", "the named destination port");
  if (term === "FOB") {
    return tx(
      lang,
      "报价包含货物至中国起运港并完成出口报关相关费用，不包含国际海运费、保险费及目的港费用。",
      "The quotation includes cargo, delivery to the China port of loading, and export customs clearance. International ocean freight, insurance, and destination charges are excluded."
    );
  }
  if (term === "CIF") {
    return tx(
      lang,
      `报价包含货物、出口端费用、国际海运费及基础海运保险至${place}。`,
      `The quotation includes cargo, origin-side charges, international ocean freight, and basic marine insurance to ${place}.`
    );
  }
  if (term === "DAP") {
    return tx(
      lang,
      `报价包含货物、出口端费用、国际运输及目的国本地派送至${place}，不包含进口清关、关税及进口税费。`,
      `The quotation includes cargo, origin-side charges, international transport, and destination local delivery to ${place}. Import clearance, duties, and import taxes are excluded.`
    );
  }
  if (term === "DDP") {
    return tx(
      lang,
      `报价包含货物、出口端费用、国际运输、目的国本地派送、进口清关、预估关税及进口税费至${place}。`,
      `The quotation includes cargo, origin-side charges, international transport, destination local delivery, import clearance, estimated duties, and import taxes to ${place}.`
    );
  }
  return tx(
    lang,
    `报价包含货物、出口端费用及国际海运费至${place}。`,
    `The quotation includes cargo, origin-side charges, and international ocean freight to ${place}.`
  );
}

function getExclusionText(lang = "zh") {
  return tx(
    lang,
    "不包含目的港清关、关税、目的港杂费、仓储费、查验费、目的地派送及其他买方当地费用。",
    "Destination customs clearance, duties/taxes, destination port charges, storage, inspection, destination delivery, and other buyer-side local charges are excluded."
  );
}

function xmlCell(value, type = "String") {
  const safe = escapeXml(value);
  if (type === "Number") return `<Cell><Data ss:Type="Number">${safe}</Data></Cell>`;
  return `<Cell><Data ss:Type="String">${safe}</Data></Cell>`;
}

function xmlRow(values) {
  return `<Row>${values.map((item) => Array.isArray(item) ? xmlCell(item[0], item[1]) : xmlCell(item)).join("")}</Row>`;
}

function buildExcelXml(mode, lang = "zh") {
  if (mode === "customer") return buildCustomerExcelXml(lang);
  return buildInternalExcelXml(lang);
}

function buildInternalExcelXml(lang = "zh") {
  const { inputs, goodsCost, schemes } = calculate();
  const selected = getBestScheme(schemes) || schemes[0];
  const cargoRows = [
    xmlRow([tx(lang, "货物名称", "Cargo"), tx(lang, "图片", "Image"), tx(lang, "规格", "Specification"), tx(lang, "长(cm)", "Length(cm)"), tx(lang, "高(cm)", "Height(cm)"), tx(lang, "宽(cm)", "Width(cm)"), tx(lang, "单箱KG", "KG/Unit"), tx(lang, "数量", "Qty"), tx(lang, "单价RMB", "Unit Price RMB"), tx(lang, "税率%", "Tax Rate %"), tx(lang, "税费RMB", "Tax RMB"), tx(lang, "合计RMB", "Total RMB"), `${tx(lang, "平均报价单价", "Avg Quote Unit")} ${inputs.outputCurrency}`, `${tx(lang, "报价金额", "Quote Amount")} ${inputs.outputCurrency}`]),
    ...state.cargo.map((row) => xmlRow([
      row.name, row.imageName || "", row.spec,
      [row.length, "Number"], [row.height, "Number"], [row.width, "Number"], [row.weight, "Number"], [row.qty, "Number"],
      [row.unitPrice, "Number"], [row.taxRate, "Number"], [cargoTax(row), "Number"], [cargoTotal(row), "Number"], [quoteUnitByCurrency(inputs.outputCurrency), "Number"], [quoteLineByCurrency(row, inputs.outputCurrency), "Number"]
    ])),
    xmlRow([tx(lang, "货物总成本", "Total Cargo Cost"), "", "", "", "", "", "", "", "", "", "", [goodsCost, "Number"], "", [quoteValueByCurrency(selected, inputs.outputCurrency), "Number"]])
  ].join("");

  const freightRows = [
    xmlRow([tx(lang, "方案", "Option"), tx(lang, "费用项目", "Cost Item"), tx(lang, "金额RMB", "Amount RMB"), tx(lang, "计入报价", "Included")]),
    ...state.freight.map((row) => xmlRow([freightName(row.scheme, lang), row.item, [row.amount, "Number"], yesNo(row.included, lang)]))
  ].join("");

  const summaryRows = [
    xmlRow([tx(lang, "我方公司", "Quoted by"), inputs.companyName]),
    xmlRow([tx(lang, "项目/客户", "Project/Customer"), inputs.projectName]),
    xmlRow([tx(lang, "贸易术语", "Trade Term"), inputs.tradeTerm]),
    xmlRow([tx(lang, "柜型", "Container Type"), inputs.containerType]),
    xmlRow([tx(lang, "目的港/目的地", "Destination"), inputs.destination]),
    xmlRow([tx(lang, "目的国", "Destination Country"), inputs.destinationCountry]),
    xmlRow([tx(lang, "HS编码", "HS Code"), inputs.hsCode]),
    xmlRow([tx(lang, "报价有效期", "Valid Until"), inputs.validUntil]),
    xmlRow([tx(lang, "USD兑RMB汇率", "USD/RMB Rate"), [inputs.exchangeRate, "Number"]]),
    xmlRow([tx(lang, "EUR兑RMB汇率", "EUR/RMB Rate"), [inputs.eurExchangeRate, "Number"]]),
    xmlRow([tx(lang, "进口关税率%", "Import Duty Rate %"), [inputs.dutyRate, "Number"]]),
    xmlRow([tx(lang, "进口VAT/GST%", "Import VAT/GST %"), [inputs.importVatRate, "Number"]]),
    xmlRow([tx(lang, "目的国派送费RMB", "Destination Delivery RMB"), [inputs.destinationDelivery, "Number"]]),
    xmlRow([tx(lang, "进口清关服务费RMB", "Import Clearance RMB"), [inputs.destinationClearance, "Number"]]),
    xmlRow([tx(lang, "目的国其他费用RMB", "Other Destination RMB"), [inputs.destinationOther, "Number"]]),
    xmlRow([tx(lang, "最终报价币种", "Final Currency"), currencyLabel(inputs.outputCurrency, lang)]),
    xmlRow([`${tx(lang, "最终客户报价", "Final Customer Quote")} ${inputs.outputCurrency}`, [quoteValueByCurrency(selected, inputs.outputCurrency), "Number"]]),
    xmlRow([tx(lang, "最终客户报价折合RMB", "Final Quote RMB"), [selected.quoteRmb, "Number"]]),
    xmlRow([""]),
    xmlRow([tx(lang, "方案", "Option"), tx(lang, "物流费RMB", "Logistics RMB"), tx(lang, "总成本RMB", "Total Cost RMB"), tx(lang, "报价USD", "Quote USD"), tx(lang, "报价EUR", "Quote EUR"), tx(lang, "最终报价RMB", "Final Quote RMB"), tx(lang, "净利润RMB", "Net Profit RMB"), tx(lang, "净利率%", "Net Margin %"), tx(lang, "成本加成率%", "Markup %")]),
    ...schemes.map((row) => xmlRow([
      freightName(row.scheme, lang), [row.freight, "Number"], [row.totalCost, "Number"], [row.quoteUsd, "Number"], [row.quoteEur, "Number"], [row.quoteRmb, "Number"],
      [row.profit, "Number"], [row.margin, "Number"], [row.markup, "Number"]
    ])),
    xmlRow([""]),
    xmlRow([tx(lang, "备注", "Notes"), inputs.notes])
  ].join("");

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="${sheetName(tx(lang, "报价汇总", "Summary"))}"><Table>${summaryRows}</Table></Worksheet>
 <Worksheet ss:Name="${sheetName(tx(lang, "货物成本", "Cargo Cost"))}"><Table>${cargoRows}</Table></Worksheet>
 <Worksheet ss:Name="${sheetName(tx(lang, "货代费用", "Freight Cost"))}"><Table>${freightRows}</Table></Worksheet>
</Workbook>`;
}

function buildCustomerExcelXml(lang = "zh") {
  const { inputs, schemes } = calculate();
  const selected = getBestScheme(schemes) || schemes[0];
  const infoRows = [
    xmlRow([quoteTitle(inputs.projectName, lang)]),
    xmlRow([tx(lang, "项目", "Item"), tx(lang, "内容", "Details")]),
    xmlRow([tx(lang, "我方公司", "Quoted by"), inputs.companyName]),
    xmlRow([tx(lang, "贸易术语", "Trade Term"), `${inputs.tradeTerm} ${inputs.destination || tx(lang, "目的港", "Destination Port")}`]),
    xmlRow([tx(lang, "柜型", "Container Type"), inputs.containerType]),
    xmlRow([tx(lang, "报价有效期", "Valid Until"), inputs.validUntil]),
    xmlRow([tx(lang, "报价金额", "Quotation Amount"), formatQuoteMoney(quoteValueByCurrency(selected, inputs.outputCurrency), inputs.outputCurrency)]),
    xmlRow([""]),
    xmlRow([tx(lang, "货物名称", "Cargo"), tx(lang, "图片", "Image"), tx(lang, "规格", "Specification"), tx(lang, "长(cm)", "Length(cm)"), tx(lang, "高(cm)", "Height(cm)"), tx(lang, "宽(cm)", "Width(cm)"), tx(lang, "单箱KG", "KG/Unit"), tx(lang, "数量", "Qty"), `${tx(lang, "平均报价单价", "Avg Unit Price")} ${inputs.outputCurrency}`, `${tx(lang, "报价金额", "Amount")} ${inputs.outputCurrency}`]),
    ...state.cargo.map((row) => xmlRow([
      row.name, row.imageName || "", row.spec,
      [row.length, "Number"], [row.height, "Number"], [row.width, "Number"], [row.weight, "Number"], [row.qty, "Number"], [quoteUnitByCurrency(inputs.outputCurrency), "Number"], [quoteLineByCurrency(row, inputs.outputCurrency), "Number"]
    ])),
    xmlRow([""]),
    xmlRow([tx(lang, "费用说明", "Cost Scope")]),
    xmlRow([getCustomerTermText(inputs.tradeTerm, inputs.destination, lang)]),
    xmlRow([getExclusionText(lang)]),
    xmlRow([inputs.notes && inputs.notes !== defaultExclusion ? inputs.notes : ""])
  ].join("");

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="${sheetName(tx(lang, "客户报价单", "Customer Quote"))}"><Table>${infoRows}</Table></Worksheet>
</Workbook>`;
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
    const snapshot = getSnapshot("Excel导出");
    snapshot.inputs.exchangeRate = cleanNum(snapshot.inputs.exchangeRate);
    snapshot.inputs.eurExchangeRate = cleanNum(snapshot.inputs.eurExchangeRate);
    snapshot.inputs.targetProfit = cleanNum(snapshot.inputs.targetProfit);

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
    $("statusLine").textContent = "服务器未响应，回退到浏览器版本";
    download(`${safeName()}_报价表_${suffix}_${langSuffix}.xls`, "application/vnd.ms-excel;charset=utf-8", buildExcelXml(mode, lang));
  }
}

function downloadSelectedVersion(mode) {
  const suffix = mode === "customer" ? "客户版" : "内部留存版";
  const lang = $("exportLanguage").value;
  const langSuffix = languageSuffix(lang);
  if (pendingDownloadType === "md") {
    download(`${safeName()}_报价表_${suffix}_${langSuffix}.md`, "text/markdown;charset=utf-8", buildMarkdown(mode, lang));
  }
  if (pendingDownloadType === "excel") {
    downloadExcel(mode, lang, suffix, langSuffix);
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
  const snapshot = getSnapshot("服务器归档");
  snapshot.inputs.exchangeRate = cleanNum(snapshot.inputs.exchangeRate);
  snapshot.inputs.eurExchangeRate = cleanNum(snapshot.inputs.eurExchangeRate);
  snapshot.inputs.targetProfit = cleanNum(snapshot.inputs.targetProfit);

  try {
    const resp = await fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    $("statusLine").textContent = "已成功归档到服务器长期保存。";
  } catch (e) {
    alert("归档失败: " + e.message);
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
        <td>${escapeXml(item.label)}</td>
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
    if ($(id) && value !== undefined) $(id).value = value;
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

function importQuoteToPi() {
  const inputs = getInputs();
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
    unitPrice: Math.round(quoteUnitByCurrency(currency) * 100) / 100,
    remarks: row.spec
  }));
  if (!piState.items.length) addPiItem();
  renderPi();
  persistPiDraft();
  setActiveView("pi");
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
