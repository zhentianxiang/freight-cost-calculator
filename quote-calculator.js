const state = {
  schemes: ["A货代", "B货代"],
  cargo: [
    { name: "大理石马", spec: "实际出货尺寸", length: 2.1, height: 2.1, width: 0.5, weight: 2200, qty: 5, unitPrice: 20000, taxRate: 13 },
    { name: "不锈钢猎鹰", spec: "实际出货尺寸", length: 3, height: 2, width: 0.8, weight: 500, qty: 1, unitPrice: 40000, taxRate: 0 }
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
const autosaveDelayMs = 3000;
let pendingDownloadType = "";
let autosaveTimer = 0;
let lastSavedSignature = "";

function cargoTax(row) {
  return cleanNum(row.unitPrice) * cleanNum(row.qty) * cleanNum(row.taxRate) / 100;
}

function cargoTotal(row) {
  return cleanNum(row.unitPrice) * cleanNum(row.qty) + cargoTax(row);
}

function totalCargoQty() {
  return state.cargo.reduce((sum, row) => sum + cleanNum(row.qty), 0);
}

function quoteUnitUsd() {
  const qty = totalCargoQty();
  return qty ? cleanNum($("quoteUsd").value) / qty : 0;
}

function quoteLineUsd(row) {
  return quoteUnitUsd() * cleanNum(row.qty);
}

function getInputs() {
  return {
    companyName: $("companyName").value.trim(),
    projectName: $("projectName").value.trim() || "未命名报价",
    tradeTerm: $("tradeTerm").value,
    containerType: $("containerType").value.trim(),
    destination: $("destination").value.trim(),
    validUntil: $("validUntil").value.trim(),
    exchangeRate: cleanNum($("exchangeRate").value),
    quoteUsd: cleanNum($("quoteUsd").value),
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
    validUntil: $("validUntil").value.trim(),
    exchangeRate: $("exchangeRate").value,
    quoteUsd: $("quoteUsd").value,
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
    state.cargo = Array.isArray(snapshot.cargo) ? snapshot.cargo : state.cargo;
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
  renderSchemeOptions();
  const inputs = getInputs();
  const goodsCost = state.cargo.reduce((sum, row) => sum + cargoTotal(row), 0);
  const quoteRmb = inputs.quoteUsd * inputs.exchangeRate;
  const schemes = getSummarySchemeIds().map((scheme) => {
    const rows = state.freight.filter((row) => row.scheme === scheme);
    const freight = state.freight
      .filter((row) => row.scheme === scheme && row.included)
      .reduce((sum, row) => sum + cleanNum(row.amount), 0);
    const totalCost = goodsCost + freight;
    const targetPrice = totalCost * (1 + inputs.targetProfit / 100);
    const profit = quoteRmb - totalCost;
    const margin = quoteRmb ? profit / quoteRmb * 100 : 0;
    const markup = totalCost ? profit / totalCost * 100 : 0;
    const hasQuotedCost = rows.some((row) => row.included && cleanNum(row.amount) > 0);
    return { scheme, freight, totalCost, targetPrice, profit, margin, markup, hasQuotedCost };
  });
  return { inputs, goodsCost, quoteRmb, schemes };
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
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cargo-name"><input value="${escapeXml(row.name)}" data-cargo="${index}" data-key="name"></td>
      <td class="cargo-spec"><input value="${escapeXml(row.spec)}" data-cargo="${index}" data-key="spec"></td>
      <td class="cargo-dim"><input class="num" type="number" step="0.01" value="${row.length}" data-cargo="${index}" data-key="length"></td>
      <td class="cargo-dim"><input class="num" type="number" step="0.01" value="${row.height}" data-cargo="${index}" data-key="height"></td>
      <td class="cargo-dim"><input class="num" type="number" step="0.01" value="${row.width}" data-cargo="${index}" data-key="width"></td>
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

function renderFreight() {
  syncSchemesFromRows();
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
    tr.querySelector("[data-key='scheme']").value = row.scheme;
    tbody.appendChild(tr);
  });
}

function renderSummary() {
  const result = calculate();
  const selected = getBestScheme(result.schemes) || result.schemes[0];
  $("termPill").textContent = result.inputs.tradeTerm;
  $("selectedSchemePill").textContent = `${selected.scheme} 最优`;
  $("summaryTable").querySelector("thead th:nth-child(4)").textContent = `${result.inputs.targetProfit}%价`;
  $("goodsCost").textContent = money(result.goodsCost);
  $("quoteRmb").textContent = money(result.quoteRmb);
  $("selectedCost").textContent = money(selected.totalCost);
  $("selectedProfit").textContent = money(selected.profit);
  $("profitMetric").className = `metric ${selected.profit >= 0 ? "green" : "red"}`;
  $("statusLine").textContent = `自动取总成本最低方案；净利率 ${pct(selected.margin)}，成本加成率 ${pct(selected.markup)}`;
  $("termNote").textContent = getTermNote(result.inputs.tradeTerm);

  const tbody = $("summaryTable").querySelector("tbody");
  tbody.innerHTML = "";
  result.schemes.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.scheme}${row.scheme === selected.scheme ? "（最优）" : ""}</td>
      <td class="money">${fmt.format(row.freight)}</td>
      <td class="money">${fmt.format(row.totalCost)}</td>
      <td class="money">${fmt.format(row.targetPrice)}</td>
      <td class="money">${fmt.format(row.profit)}</td>
      <td class="money">${pct(row.margin)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function getTermNote(term) {
  if (term === "FOB") return "FOB通常不包含国际海运费；如货代费用里计入了海运费，需改为不计入或改用CFR/CIF口径。";
  if (term === "CIF") return "CIF通常包含国际海运费和保险费；请确认保险费已在费用表中计入。";
  return "CFR通常包含国际海运费，不包含目的港清关、关税、目的港杂费和目的地派送。";
}

function syncAndRender() {
  renderCargo();
  renderFreight();
  renderSummary();
}

function updateStateOnInput(event) {
  const target = event.target;
  let changed = false;
  if (target.matches("[data-cargo]")) {
    const row = state.cargo[Number(target.dataset.cargo)];
    const key = target.dataset.key;
    row[key] = target.type === "number" ? cleanNum(target.value) : target.value;
    renderSummary();
    changed = true;
  }
  if (target.matches("[data-freight]")) {
    const row = state.freight[Number(target.dataset.freight)];
    const key = target.dataset.key;
    if (key === "included") row[key] = target.value === "true";
    else row[key] = target.type === "number" ? cleanNum(target.value) : target.value;
    renderSummary();
    changed = true;
  }
  if (target.closest(".section-body") || target.closest(".topbar")) {
    renderSummary();
    changed = true;
  }
  if (changed) scheduleAutoSave();
}

function updateStateOnChange(event) {
  const target = event.target;
  let changed = false;
  if (target.matches("[data-cargo]")) {
    const row = state.cargo[Number(target.dataset.cargo)];
    const key = target.dataset.key;
    row[key] = target.type === "number" ? cleanNum(target.value) : target.value;
    renderCargo();
    renderSummary();
    changed = true;
  }
  if (target.matches("[data-freight]")) {
    const row = state.freight[Number(target.dataset.freight)];
    const key = target.dataset.key;
    if (key === "included") row[key] = target.value === "true";
    else row[key] = target.type === "number" ? cleanNum(target.value) : target.value;
    renderFreight();
    renderSummary();
    changed = true;
  }
  if (target.closest(".section-body") && !target.matches("[data-cargo]") && !target.matches("[data-freight]")) {
    renderSummary();
    changed = true;
  }
  if (changed) scheduleAutoSave();
}

function addCargo() {
  state.cargo.push({ name: "", spec: "", length: 0, height: 0, width: 0, weight: 0, qty: 1, unitPrice: 0, taxRate: 0 });
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
  $("validUntil").value = "";
  $("exchangeRate").value = "";
  $("quoteUsd").value = "";
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
  const { inputs, goodsCost, quoteRmb, schemes } = calculate();
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
  lines.push("");
  lines.push(`## ${tx(lang, "货物成本", "Cargo Cost")}`);
  lines.push("");
  lines.push(`|${tx(lang, "货物名称", "Cargo")}|${tx(lang, "规格", "Specification")}|${tx(lang, "长(m)", "Length(m)")}|${tx(lang, "高(m)", "Height(m)")}|${tx(lang, "宽(m)", "Width(m)")}|${tx(lang, "单箱KG", "KG/Unit")}|${tx(lang, "数量", "Qty")}|${tx(lang, "单价RMB", "Unit Price RMB")}|${tx(lang, "税率", "Tax Rate")}|${tx(lang, "税费RMB", "Tax RMB")}|${tx(lang, "合计RMB", "Total RMB")}|${tx(lang, "平均报价单价USD", "Avg Quote Unit USD")}|${tx(lang, "报价金额USD", "Quote Amount USD")}|`);
  lines.push("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  state.cargo.forEach((row) => {
    lines.push(`|${escapeMd(row.name)}|${escapeMd(row.spec)}|${row.length}|${row.height}|${row.width}|${fmt.format(row.weight)}|${row.qty}|${fmt.format(row.unitPrice)}|${row.taxRate}%|${fmt.format(cargoTax(row))}|${fmt.format(cargoTotal(row))}|${fmt.format(quoteUnitUsd())}|${fmt.format(quoteLineUsd(row))}|`);
  });
  lines.push(`|**${tx(lang, "货物总成本", "Total Cargo Cost")}**||||||||||**${fmt.format(goodsCost)}**||**${fmt.format(inputs.quoteUsd)}**|`);
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
  lines.push(`|${tx(lang, "方案", "Option")}|${tx(lang, "物流费RMB", "Logistics RMB")}|${tx(lang, "总成本RMB", "Total Cost RMB")}|${tx(lang, "目标利润价RMB", "Target Price RMB")}|${tx(lang, "最终报价折合RMB", "Final Quote RMB")}|${tx(lang, "净利润RMB", "Net Profit RMB")}|${tx(lang, "净利率", "Net Margin")}|${tx(lang, "成本加成率", "Markup")}|`);
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|");
  schemes.forEach((row) => {
    lines.push(`|${freightName(row.scheme, lang)}|${fmt.format(row.freight)}|${fmt.format(row.totalCost)}|${fmt.format(row.targetPrice)}|${fmt.format(quoteRmb)}|${fmt.format(row.profit)}|${pct(row.margin)}|${pct(row.markup)}|`);
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
  const { inputs } = calculate();
  const lines = [];
  lines.push(`# ${escapeMd(quoteTitle(inputs.projectName, lang))}`);
  lines.push("");
  lines.push(`| ${tx(lang, "项目", "Item")} | ${tx(lang, "内容", "Details")} |`);
  lines.push("|---|---|");
  if (inputs.companyName) lines.push(`| ${tx(lang, "我方公司", "Quoted by")} | ${escapeMd(inputs.companyName)} |`);
  lines.push(`| ${tx(lang, "贸易术语", "Trade Term")} | ${inputs.tradeTerm} ${escapeMd(inputs.destination || tx(lang, "目的港", "Destination Port"))} |`);
  lines.push(`| ${tx(lang, "柜型", "Container Type")} | ${escapeMd(inputs.containerType)} |`);
  lines.push(`| ${tx(lang, "报价有效期", "Valid Until")} | ${escapeMd(inputs.validUntil)} |`);
  lines.push(`| ${tx(lang, "报价金额", "Quotation Amount")} | **USD ${fmt.format(inputs.quoteUsd)}** |`);
  lines.push("");
  lines.push(`## ${tx(lang, "货物信息", "Cargo Information")}`);
  lines.push("");
  lines.push(`| ${tx(lang, "货物名称", "Cargo")} | ${tx(lang, "规格", "Specification")} | ${tx(lang, "长(m)", "Length(m)")} | ${tx(lang, "高(m)", "Height(m)")} | ${tx(lang, "宽(m)", "Width(m)")} | ${tx(lang, "单箱KG", "KG/Unit")} | ${tx(lang, "数量", "Qty")} | ${tx(lang, "平均报价单价USD", "Avg Unit Price USD")} | ${tx(lang, "报价金额USD", "Amount USD")} |`);
  lines.push("|---|---|---:|---:|---:|---:|---:|---:|---:|");
  state.cargo.forEach((row) => {
    lines.push(`|${escapeMd(row.name)}|${escapeMd(row.spec)}|${row.length}|${row.height}|${row.width}|${fmt.format(row.weight)}|${row.qty}|${fmt.format(quoteUnitUsd())}|${fmt.format(quoteLineUsd(row))}|`);
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
  const { inputs, goodsCost, quoteRmb, schemes } = calculate();
  const cargoRows = [
    xmlRow([tx(lang, "货物名称", "Cargo"), tx(lang, "规格", "Specification"), tx(lang, "长(m)", "Length(m)"), tx(lang, "高(m)", "Height(m)"), tx(lang, "宽(m)", "Width(m)"), tx(lang, "单箱KG", "KG/Unit"), tx(lang, "数量", "Qty"), tx(lang, "单价RMB", "Unit Price RMB"), tx(lang, "税率%", "Tax Rate %"), tx(lang, "税费RMB", "Tax RMB"), tx(lang, "合计RMB", "Total RMB"), tx(lang, "平均报价单价USD", "Avg Quote Unit USD"), tx(lang, "报价金额USD", "Quote Amount USD")]),
    ...state.cargo.map((row) => xmlRow([
      row.name, row.spec,
      [row.length, "Number"], [row.height, "Number"], [row.width, "Number"], [row.weight, "Number"], [row.qty, "Number"],
      [row.unitPrice, "Number"], [row.taxRate, "Number"], [cargoTax(row), "Number"], [cargoTotal(row), "Number"], [quoteUnitUsd(), "Number"], [quoteLineUsd(row), "Number"]
    ])),
    xmlRow([tx(lang, "货物总成本", "Total Cargo Cost"), "", "", "", "", "", "", "", "", "", [goodsCost, "Number"], "", [inputs.quoteUsd, "Number"]])
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
    xmlRow([tx(lang, "报价有效期", "Valid Until"), inputs.validUntil]),
    xmlRow([tx(lang, "USD兑RMB汇率", "USD/RMB Rate"), [inputs.exchangeRate, "Number"]]),
    xmlRow([tx(lang, "最终客户报价USD", "Final Customer Quote USD"), [inputs.quoteUsd, "Number"]]),
    xmlRow([tx(lang, "最终客户报价折合RMB", "Final Quote RMB"), [quoteRmb, "Number"]]),
    xmlRow([""]),
    xmlRow([tx(lang, "方案", "Option"), tx(lang, "物流费RMB", "Logistics RMB"), tx(lang, "总成本RMB", "Total Cost RMB"), tx(lang, "目标利润价RMB", "Target Price RMB"), tx(lang, "净利润RMB", "Net Profit RMB"), tx(lang, "净利率%", "Net Margin %"), tx(lang, "成本加成率%", "Markup %")]),
    ...schemes.map((row) => xmlRow([
      freightName(row.scheme, lang), [row.freight, "Number"], [row.totalCost, "Number"], [row.targetPrice, "Number"],
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
  const { inputs } = calculate();
  const infoRows = [
    xmlRow([quoteTitle(inputs.projectName, lang)]),
    xmlRow([tx(lang, "项目", "Item"), tx(lang, "内容", "Details")]),
    xmlRow([tx(lang, "我方公司", "Quoted by"), inputs.companyName]),
    xmlRow([tx(lang, "贸易术语", "Trade Term"), `${inputs.tradeTerm} ${inputs.destination || tx(lang, "目的港", "Destination Port")}`]),
    xmlRow([tx(lang, "柜型", "Container Type"), inputs.containerType]),
    xmlRow([tx(lang, "报价有效期", "Valid Until"), inputs.validUntil]),
    xmlRow([tx(lang, "报价金额", "Quotation Amount"), `USD ${fmt.format(inputs.quoteUsd)}`]),
    xmlRow([""]),
    xmlRow([tx(lang, "货物名称", "Cargo"), tx(lang, "规格", "Specification"), tx(lang, "长(m)", "Length(m)"), tx(lang, "高(m)", "Height(m)"), tx(lang, "宽(m)", "Width(m)"), tx(lang, "单箱KG", "KG/Unit"), tx(lang, "数量", "Qty"), tx(lang, "平均报价单价USD", "Avg Unit Price USD"), tx(lang, "报价金额USD", "Amount USD")]),
    ...state.cargo.map((row) => xmlRow([
      row.name, row.spec,
      [row.length, "Number"], [row.height, "Number"], [row.width, "Number"], [row.weight, "Number"], [row.qty, "Number"], [quoteUnitUsd(), "Number"], [quoteLineUsd(row), "Number"]
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
    snapshot.inputs.quoteUsd = cleanNum(snapshot.inputs.quoteUsd);
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
  button.textContent = "获取中";
  source.textContent = "正在获取USD/CNY汇率...";
  try {
    const response = await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const rate = data?.rates?.CNY;
    if (!rate || data.result !== "success") throw new Error("汇率数据不可用");
    $("exchangeRate").value = Number(rate).toFixed(6);
    const updated = data.time_last_update_utc ? `，更新时间：${data.time_last_update_utc}` : "";
    source.innerHTML = `已获取USD/CNY ${Number(rate).toFixed(6)}${updated}。Rates by <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener">Exchange Rate API</a>。`;
    renderSummary();
  } catch (error) {
    source.textContent = "汇率获取失败，请继续手动填写；公开接口可能受网络、跨域或限流影响。";
  } finally {
    button.disabled = false;
    button.textContent = "获取";
  }
}

async function archiveSnapshot() {
  const snapshot = getSnapshot("服务器归档");
  snapshot.inputs.exchangeRate = cleanNum(snapshot.inputs.exchangeRate);
  snapshot.inputs.quoteUsd = cleanNum(snapshot.inputs.quoteUsd);
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
        <td>${escapeXml(item.label)}</td>
        <td>
          <div class="actions">
            <button class="btn primary small-btn" title="加载此报价" data-load-id="${item.id}">加载</button>
            <button class="btn danger small-btn" title="删除归档" data-delete-id="${item.id}">删除</button>
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
    state.cargo = Array.isArray(data.cargo) ? data.cargo : state.cargo;
    state.freight = Array.isArray(data.freight) ? data.freight : state.freight;
    state.schemes = Array.isArray(data.schemes) ? data.schemes : getSchemeIds();
    
    syncAndRender();
    $("historyDialog").classList.add("hidden");
    $("statusLine").textContent = `已加载服务器归档: ${data.inputs.projectName} (${formatSaveTime(data.updatedAt)})`;
  } catch (e) {
    alert("加载失败: " + e.message);
  }
}

document.addEventListener("input", updateStateOnInput);
document.addEventListener("change", updateStateOnChange);
document.addEventListener("click", (event) => {
  const cargoIndex = event.target.dataset.deleteCargo;
  const freightIndex = event.target.dataset.deleteFreight;
  if (cargoIndex !== undefined) {
    state.cargo.splice(Number(cargoIndex), 1);
    syncAndRender();
    scheduleAutoSave();
  }
  if (freightIndex !== undefined) {
    state.freight.splice(Number(freightIndex), 1);
    syncAndRender();
    scheduleAutoSave();
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

loadDraftOnStart();
syncAndRender();
