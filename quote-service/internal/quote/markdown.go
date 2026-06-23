package quote

import (
	"fmt"
	"math"
	"strings"
)

func BuildMarkdown(snap *Snapshot, mode, lang string) string {
	FixDefaults(snap)
	if mode == "customer" {
		return buildCustomerMarkdown(snap, lang)
	}
	return buildInternalMarkdown(snap, lang)
}

func buildInternalMarkdown(snap *Snapshot, lang string) string {
	result := Calculate(snap)
	inputs := result.Inputs
	selected := result.Selected
	var lines []string
	lines = append(lines, "# "+escapeMd(quoteTitle(inputs.ProjectName, lang, true)), "")
	if inputs.CompanyName != "" {
		lines = append(lines, fmt.Sprintf("- %s：%s", tx(lang, "我方公司", "Quoted by"), escapeMd(inputs.CompanyName)))
	}
	lines = append(lines,
		fmt.Sprintf("- %s：%s", tx(lang, "贸易术语", "Trade Term"), inputs.TradeTerm),
		fmt.Sprintf("- %s：%s", tx(lang, "柜型", "Container Type"), escapeMd(inputs.ContainerType)),
		fmt.Sprintf("- %s：%s", tx(lang, "目的港/目的地", "Destination"), escapeMd(inputs.Destination)),
		fmt.Sprintf("- %s：%s", tx(lang, "报价有效期", "Valid Until"), escapeMd(inputs.ValidUntil)),
		fmt.Sprintf("- %s：%.4g", tx(lang, "USD兑RMB汇率", "USD/RMB Rate"), inputs.ExchangeRate),
		fmt.Sprintf("- %s：%.4g", tx(lang, "EUR兑RMB汇率", "EUR/RMB Rate"), inputs.EurExchangeRate),
		fmt.Sprintf("- %s：%s", tx(lang, "最终报价币种", "Final Currency"), inputs.OutputCurrency),
	)
	if inputs.DestinationCountry != "" {
		lines = append(lines, fmt.Sprintf("- %s：%s", tx(lang, "目的国", "Destination Country"), escapeMd(inputs.DestinationCountry)))
	}
	if inputs.HSCode != "" {
		lines = append(lines, fmt.Sprintf("- %s：%s", tx(lang, "HS编码", "HS Code"), escapeMd(inputs.HSCode)))
	}
	lines = append(lines,
		fmt.Sprintf("- %s：%s", tx(lang, "进口关税率", "Import Duty Rate"), fmtPct(inputs.DutyRate)),
		fmt.Sprintf("- %s：%s", tx(lang, "进口VAT/GST", "Import VAT/GST"), fmtPct(inputs.ImportVatRate)),
		"", "## "+tx(lang, "货物成本", "Cargo Cost"), "",
	)
	lines = append(lines,
		fmt.Sprintf("|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s %s|%s %s|",
			tx(lang, "货物名称", "Cargo"), tx(lang, "图片", "Image"), tx(lang, "规格", "Specification"),
			tx(lang, "长(cm)", "Length(cm)"), tx(lang, "高(cm)", "Height(cm)"), tx(lang, "宽(cm)", "Width(cm)"),
			tx(lang, "单箱KG", "KG/Unit"), tx(lang, "数量", "Qty"), tx(lang, "单价RMB", "Unit Price RMB"),
			tx(lang, "税率", "Tax Rate"), tx(lang, "税费RMB", "Tax RMB"), tx(lang, "合计RMB", "Total RMB"),
			tx(lang, "平均报价单价", "Avg Quote Unit"), inputs.OutputCurrency,
			tx(lang, "报价金额", "Quote Amount"), inputs.OutputCurrency),
		"|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
	)
	unit := quoteUnit(quoteValue(selected, inputs.OutputCurrency), totalCargoQty(snap.Cargo))
	for _, row := range snap.Cargo {
		lines = append(lines, fmt.Sprintf("|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|",
			escapeMd(row.Name), escapeMd(row.ImageName), escapeMd(row.Spec),
			fmtMoney(row.Length), fmtMoney(row.Height), fmtMoney(row.Width), fmtMoney(row.Weight), fmtMoney(row.Qty),
			fmtMoney(row.UnitPrice), fmtPct(row.TaxRate), fmtMoney(cargoTax(row)), fmtMoney(cargoTotal(row)),
			fmtMoney(unit), fmtMoney(row.Qty*unit)))
	}
	lines = append(lines, fmt.Sprintf("|**%s**|||||||||||**%s**||**%s**|",
		tx(lang, "货物总成本", "Total Cargo Cost"), fmtMoney(result.GoodsCost), fmtMoney(quoteValue(selected, inputs.OutputCurrency))),
		"", "## "+tx(lang, "货代费用", "Freight Forwarder Cost"), "")
	for _, summary := range result.Schemes {
		lines = append(lines, "### "+freightName(summary.Scheme, lang), "",
			fmt.Sprintf("|%s|%s|%s|", tx(lang, "费用项目", "Cost Item"), tx(lang, "金额RMB", "Amount RMB"), tx(lang, "计入报价", "Included")),
			"|---|---:|---|")
		for _, row := range snap.Freight {
			if row.Scheme == summary.Scheme {
				lines = append(lines, fmt.Sprintf("|%s|%s|%s|", escapeMd(row.Item), fmtMoney(row.Amount), yesNo(row.Included, lang)))
			}
		}
		lines = append(lines, fmt.Sprintf("|**%s**|**%s**||", tx(lang, "计入费用合计", "Included Cost Total"), fmtMoney(summary.Freight)), "")
	}
	lines = append(lines, "## "+tx(lang, "利润测算", "Profit Calculation"), "",
		fmt.Sprintf("|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|",
			tx(lang, "方案", "Option"), tx(lang, "物流费RMB", "Logistics RMB"), tx(lang, "港口费RMB", "Port Charges RMB"), tx(lang, "总成本RMB", "Total Cost RMB"),
			tx(lang, "报价USD", "Quote USD"), tx(lang, "报价EUR", "Quote EUR"), tx(lang, "最终报价RMB", "Final Quote RMB"),
			tx(lang, "净利润RMB", "Net Profit RMB"), tx(lang, "净利率", "Net Margin"), tx(lang, "成本加成率", "Markup")),
		"|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
	for _, row := range result.Schemes {
		lines = append(lines, fmt.Sprintf("|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|",
			freightName(row.Scheme, lang), fmtMoney(row.Freight), fmtMoney(row.PortCharges), fmtMoney(row.TotalCost), fmtMoney(math.Round(row.QuoteUsd)),
			fmtMoney(math.Round(row.QuoteEur)), fmtMoney(row.QuoteRmb), fmtMoney(row.Profit), fmtPct(row.Margin), fmtPct(row.Markup)))
	}
	lines = append(lines, "", fmt.Sprintf("%s：%s，%s %s RMB。",
		tx(lang, "自动推荐方案", "Recommended option"), freightName(selected.Scheme, lang),
		tx(lang, "预计净利润", "Estimated net profit"), fmtMoney(selected.Profit)))
	if inputs.Notes != "" {
		lines = append(lines, "", "## "+tx(lang, "备注", "Notes"), "", inputs.Notes)
	}
	return strings.Join(lines, "\n")
}

func buildCustomerMarkdown(snap *Snapshot, lang string) string {
	result := Calculate(snap)
	inputs := result.Inputs
	selected := result.Selected
	var lines []string
	lines = append(lines, "# "+escapeMd(quoteTitle(inputs.ProjectName, lang, false)), "")
	lines = append(lines, fmt.Sprintf("| %s | %s |", tx(lang, "项目", "Item"), tx(lang, "内容", "Details")), "|---|---|")
	if inputs.CompanyName != "" {
		lines = append(lines, fmt.Sprintf("| %s | %s |", tx(lang, "我方公司", "Quoted by"), escapeMd(inputs.CompanyName)))
	}
	lines = append(lines,
		fmt.Sprintf("| %s | %s %s |", tx(lang, "贸易术语", "Trade Term"), inputs.TradeTerm, escapeMd(defaultDestination(inputs.Destination, lang))),
		fmt.Sprintf("| %s | %s |", tx(lang, "柜型", "Container Type"), escapeMd(inputs.ContainerType)),
		fmt.Sprintf("| %s | %s |", tx(lang, "报价有效期", "Valid Until"), escapeMd(inputs.ValidUntil)),
		fmt.Sprintf("| %s | **%s** |", tx(lang, "报价金额", "Quotation Amount"), formatCurrency(quoteValue(selected, inputs.OutputCurrency), inputs.OutputCurrency)),
		"", "## "+tx(lang, "货物信息", "Cargo Information"), "",
		fmt.Sprintf("| %s | %s | %s | %s | %s | %s | %s | %s | %s %s | %s %s |",
			tx(lang, "货物名称", "Cargo"), tx(lang, "图片", "Image"), tx(lang, "规格", "Specification"),
			tx(lang, "长(cm)", "Length(cm)"), tx(lang, "高(cm)", "Height(cm)"), tx(lang, "宽(cm)", "Width(cm)"),
			tx(lang, "单箱KG", "KG/Unit"), tx(lang, "数量", "Qty"),
			tx(lang, "报价单价", "Unit Price"), inputs.OutputCurrency, tx(lang, "报价金额", "Amount"), inputs.OutputCurrency),
		"|---|---|---|---:|---:|---:|---:|---:|---:|---:|",
	)
	for _, row := range snap.Cargo {
		lines = append(lines, fmt.Sprintf("|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|",
			escapeMd(row.Name), escapeMd(row.ImageName), escapeMd(row.Spec),
			fmtMoney(row.Length), fmtMoney(row.Height), fmtMoney(row.Width), fmtMoney(row.Weight), fmtMoney(row.Qty),
			fmtMoney(customerCargoUnit(row, selected, result.GoodsCost, inputs)),
			fmtMoney(customerCargoLine(row, selected, result.GoodsCost, inputs))))
	}
	lines = append(lines, "", "## "+tx(lang, "费用说明", "Cost Scope"), "",
		"- "+getCustomerTermText(inputs.TradeTerm, inputs.Destination, lang),
		"- "+getExclusionText(inputs.TradeTerm, lang))
	if inputs.Notes != "" && !isDefaultExclusionNote(inputs.Notes) {
		lines = append(lines, "- "+escapeMd(inputs.Notes))
	}
	return strings.Join(lines, "\n")
}

func quoteTitle(projectName, lang string, detail bool) string {
	base := tx(lang, "报价单", "Quotation")
	if detail {
		base = tx(lang, "报价明细", "Quotation Detail")
	}
	return strings.TrimSpace(projectName + " " + base)
}

func escapeMd(value string) string {
	return strings.ReplaceAll(value, "|", "\\|")
}

func quoteUnit(total, qty float64) float64 {
	if qty == 0 {
		return 0
	}
	return total / qty
}

func defaultDestination(destination, lang string) string {
	if destination != "" {
		return destination
	}
	return tx(lang, "目的港", "Destination Port")
}
