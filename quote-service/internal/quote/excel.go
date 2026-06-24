package quote

import (
	"encoding/base64"
	"fmt"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"math"
	"strings"

	"github.com/xuri/excelize/v2"
)

func WriteExcel(f *excelize.File, snap *Snapshot, mode, lang string) {
	FixDefaults(snap)
	s := createStyles(f)
	if mode == "customer" {
		writeCustomer(f, snap, lang, s)
		return
	}
	writeInternal(f, snap, lang, s)
}

func createStyles(f *excelize.File) *Styles {
	s := &Styles{}

	titleFg := "1A5B7A"
	s.TitleStyle, _ = f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Size: 20, Color: "FFFFFF"},
		Fill:      excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{titleFg}},
		Alignment: &excelize.Alignment{Horizontal: "center", Vertical: "center"},
		Border: []excelize.Border{
			{Type: "left", Color: titleFg, Style: 1},
			{Type: "right", Color: titleFg, Style: 1},
			{Type: "top", Color: titleFg, Style: 1},
			{Type: "bottom", Color: "FFFFFF", Style: 1},
		},
	})

	headerFg := "2C6E91"
	s.HeaderStyle, _ = f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Size: 14, Color: "FFFFFF"},
		Fill:      excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{headerFg}},
		Alignment: &excelize.Alignment{Horizontal: "center", Vertical: "center", WrapText: true},
		Border: []excelize.Border{
			{Type: "left", Color: "FFFFFF", Style: 1},
			{Type: "right", Color: "FFFFFF", Style: 1},
			{Type: "top", Color: headerFg, Style: 1},
			{Type: "bottom", Color: headerFg, Style: 1},
		},
	})

	subFg := "D6E4ED"
	s.SubHeaderStyle, _ = f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Size: 12, Color: "1A3B4C"},
		Fill:      excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{subFg}},
		Alignment: &excelize.Alignment{Vertical: "center"},
		Border: []excelize.Border{
			{Type: "left", Color: "B0C4D6", Style: 1},
			{Type: "right", Color: "B0C4D6", Style: 1},
			{Type: "top", Color: "B0C4D6", Style: 1},
			{Type: "bottom", Color: "B0C4D6", Style: 1},
		},
	})

	lightBorder := "C8D6E0"
	dataBorder := []excelize.Border{
		{Type: "left", Color: lightBorder, Style: 1},
		{Type: "right", Color: lightBorder, Style: 1},
		{Type: "top", Color: lightBorder, Style: 1},
		{Type: "bottom", Color: lightBorder, Style: 1},
	}
	s.DataStyle, _ = f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Size: 12, Color: "1A2B3C"},
		Alignment: &excelize.Alignment{Vertical: "center"},
		Border:    dataBorder,
	})

	s.MoneyStyle, _ = f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Size: 12, Color: "1A2B3C"},
		Alignment: &excelize.Alignment{Horizontal: "right", Vertical: "center"},
		Border:    dataBorder,
		NumFmt:    4,
	})

	highlightFg := "E8F5E9"
	s.HighlightStyle, _ = f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Size: 12, Color: "1A5B2E", Bold: true},
		Fill:      excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{highlightFg}},
		Alignment: &excelize.Alignment{Vertical: "center"},
		Border:    dataBorder,
	})

	s.BoldStyle, _ = f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Size: 12, Color: "1A2B3C", Bold: true},
		Alignment: &excelize.Alignment{Vertical: "center"},
		Border:    dataBorder,
	})

	s.NoteStyle, _ = f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Size: 11, Color: "667381", Italic: true},
		Alignment: &excelize.Alignment{Vertical: "center", WrapText: true},
	})

	s.AltDataStyle, _ = f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Size: 12, Color: "1A2B3C"},
		Fill:      excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"F5F8FA"}},
		Alignment: &excelize.Alignment{Vertical: "center"},
		Border:    dataBorder,
	})

	s.AltMoneyStyle, _ = f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Size: 12, Color: "1A2B3C"},
		Fill:      excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"F5F8FA"}},
		Alignment: &excelize.Alignment{Horizontal: "right", Vertical: "center"},
		Border:    dataBorder,
		NumFmt:    4,
	})

	sectionFg := "EAF0F6"
	s.SectionTitleStyle, _ = f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Size: 14, Color: "1A3B4C"},
		Fill:      excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{sectionFg}},
		Alignment: &excelize.Alignment{Vertical: "center"},
		Border: []excelize.Border{
			{Type: "left", Color: "B0C4D6", Style: 1},
			{Type: "right", Color: "B0C4D6", Style: 1},
			{Type: "top", Color: "B0C4D6", Style: 1},
			{Type: "bottom", Color: "8A9EAD", Style: 2},
		},
	})

	totalFg := "FFF3E0"
	s.TotalStyle, _ = f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Size: 12, Color: "1A2B3C", Bold: true},
		Fill:      excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{totalFg}},
		Alignment: &excelize.Alignment{Vertical: "center"},
		Border: []excelize.Border{
			{Type: "left", Color: "B0C4D6", Style: 1},
			{Type: "right", Color: "B0C4D6", Style: 1},
			{Type: "top", Color: "8A9EAD", Style: 2},
			{Type: "bottom", Color: "8A9EAD", Style: 2},
		},
	})

	s.TotalMoneyStyle, _ = f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Size: 12, Color: "1A2B3C", Bold: true},
		Fill:      excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{totalFg}},
		Alignment: &excelize.Alignment{Horizontal: "right", Vertical: "center"},
		Border: []excelize.Border{
			{Type: "left", Color: "B0C4D6", Style: 1},
			{Type: "right", Color: "B0C4D6", Style: 1},
			{Type: "top", Color: "8A9EAD", Style: 2},
			{Type: "bottom", Color: "8A9EAD", Style: 2},
		},
		NumFmt: 4,
	})

	s.SmallNoteStyle, _ = f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Size: 11, Color: "8899A6", Italic: true},
		Alignment: &excelize.Alignment{Vertical: "center", WrapText: true},
	})

	custTitleFg := "1A5B7A"
	s.CustomerTitleStyle, _ = f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Size: 22, Color: "FFFFFF"},
		Fill:      excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{custTitleFg}},
		Alignment: &excelize.Alignment{Horizontal: "center", Vertical: "center"},
		Border: []excelize.Border{
			{Type: "left", Color: custTitleFg, Style: 1},
			{Type: "right", Color: custTitleFg, Style: 1},
			{Type: "top", Color: custTitleFg, Style: 1},
			{Type: "bottom", Color: custTitleFg, Style: 1},
		},
	})

	custLabelFg := "EAF0F6"
	s.CustomerLabelStyle, _ = f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Size: 12, Color: "1A2B3C", Bold: true},
		Fill:      excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{custLabelFg}},
		Alignment: &excelize.Alignment{Vertical: "center"},
		Border:    dataBorder,
	})

	custBorder := []excelize.Border{
		{Type: "left", Color: lightBorder, Style: 1},
		{Type: "right", Color: lightBorder, Style: 1},
		{Type: "top", Color: lightBorder, Style: 1},
		{Type: "bottom", Color: lightBorder, Style: 1},
	}
	s.CustomerValueStyle, _ = f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Size: 12, Color: "1A2B3C"},
		Alignment: &excelize.Alignment{Vertical: "center"},
		Border:    custBorder,
	})

	return s
}

func writeInternal(f *excelize.File, snap *Snapshot, lang string, s *Styles) {
	inputs := snap.Inputs
	goodsCost, summaries := CalculateSchemes(snap)
	best := bestScheme(summaries)

	sheet1 := safeSheetName(tx(lang, "内部核算汇总", "Internal Master Summary"))
	f.SetSheetName("Sheet1", sheet1)

	// 设置列宽以适应最宽的货物明细表（A-N共14列）
	f.SetColWidth(sheet1, "A", "A", 25)
	f.SetColWidth(sheet1, "B", "B", 15)
	f.SetColWidth(sheet1, "C", "C", 18)
	f.SetColWidth(sheet1, "D", "G", 12)
	f.SetColWidth(sheet1, "H", "N", 15)

	row := 1
	// 1. 标题跨全列 (A:N)
	setVal(f, sheet1, fmt.Sprintf("A%d", row), inputs.ProjectName+" "+tx(lang, "完整报价测算报告", "Complete Quotation Report"), s.TitleStyle)
	f.MergeCell(sheet1, fmt.Sprintf("A%d", row), fmt.Sprintf("N%d", row))
	f.SetCellStyle(sheet1, fmt.Sprintf("A%d", row), fmt.Sprintf("N%d", row), s.TitleStyle)
	row++
	row++

	// 2. 基础信息
	setVal(f, sheet1, fmt.Sprintf("A%d", row), tx(lang, "基础信息", "Basic Info"), s.SectionTitleStyle)
	f.MergeCell(sheet1, fmt.Sprintf("A%d", row), fmt.Sprintf("N%d", row))
	f.SetCellStyle(sheet1, fmt.Sprintf("A%d", row), fmt.Sprintf("N%d", row), s.SectionTitleStyle)
	row++

	infoRows := []struct {
		label string
		value string
	}{
		{tx(lang, "我方公司", "Company"), inputs.CompanyName},
		{tx(lang, "贸易术语", "Trade Term"), inputs.TradeTerm + " " + inputs.Destination},
		{tx(lang, "柜型", "Container"), inputs.ContainerType},
		{tx(lang, "目的港", "Destination"), inputs.Destination},
		{tx(lang, "目的国", "Destination Country"), inputs.DestinationCountry},
		{tx(lang, "HS编码", "HS Code"), inputs.HSCode},
		{tx(lang, "报价有效期", "Valid Until"), inputs.ValidUntil},
		{tx(lang, "美元汇率", "USD/RMB Rate"), fmt.Sprintf("%.1f", inputs.ExchangeRate)},
		{tx(lang, "欧元汇率", "EUR/RMB Rate"), fmt.Sprintf("%.1f", inputs.EurExchangeRate)},
		{tx(lang, "最终报价币种", "Final Currency"), currencyName(inputs.OutputCurrency, lang)},
		{tx(lang, "进口关税率", "Import Duty Rate"), fmtPct(inputs.DutyRate)},
		{tx(lang, "进口VAT/GST", "Import VAT/GST"), fmtPct(inputs.ImportVatRate)},
		{tx(lang, "目标利润率", "Target Profit"), fmtPct(inputs.TargetProfit)},
	}
	for _, ir := range infoRows {
		if ir.value == "" {
			continue
		}
		setVal(f, sheet1, fmt.Sprintf("A%d", row), ir.label, s.BoldStyle)
		setVal(f, sheet1, fmt.Sprintf("B%d", row), ir.value, s.DataStyle)
		f.MergeCell(sheet1, fmt.Sprintf("B%d", row), fmt.Sprintf("N%d", row))
		f.SetCellStyle(sheet1, fmt.Sprintf("B%d", row), fmt.Sprintf("N%d", row), s.DataStyle)
		row++
	}
	row++

	// 3. 利润测算汇总
	setVal(f, sheet1, fmt.Sprintf("A%d", row), tx(lang, "利润测算", "Profit Analysis"), s.SectionTitleStyle)
	f.MergeCell(sheet1, fmt.Sprintf("A%d", row), fmt.Sprintf("N%d", row))
	f.SetCellStyle(sheet1, fmt.Sprintf("A%d", row), fmt.Sprintf("N%d", row), s.SectionTitleStyle)
	row++

	profitRows := []struct {
		label string
		value float64
		style int
	}{
		{tx(lang, "货物总成本", "Total Cargo Cost"), goodsCost, s.MoneyStyle},
		{tx(lang, "港口费用", "Port Charges"), best.PortCharges, s.MoneyStyle},
		{tx(lang, "目的国计入费用", "Included Destination Costs"), best.ImportCosts.IncludedTotal, s.MoneyStyle},
		{fmt.Sprintf("%s(%s)", tx(lang, "最终客户报价", "Final Quote"), inputs.OutputCurrency), quoteValue(best, inputs.OutputCurrency), s.MoneyStyle},
		{tx(lang, "最终客户报价(USD)", "Final Quote USD"), best.QuoteUsd, s.MoneyStyle},
		{tx(lang, "最终客户报价(EUR)", "Final Quote EUR"), best.QuoteEur, s.MoneyStyle},
		{tx(lang, "最终报价折合RMB", "Quote in RMB"), best.QuoteRmb, s.MoneyStyle},
	}
	for _, pr := range profitRows {
		setVal(f, sheet1, fmt.Sprintf("A%d", row), pr.label, s.BoldStyle)
		setMoney(f, sheet1, fmt.Sprintf("B%d", row), pr.value, pr.style)
		f.MergeCell(sheet1, fmt.Sprintf("B%d", row), fmt.Sprintf("N%d", row))
		f.SetCellStyle(sheet1, fmt.Sprintf("B%d", row), fmt.Sprintf("N%d", row), pr.style)
		row++
	}

	bestMsg := fmt.Sprintf("%s: %s / %s: %s",
		tx(lang, "总成本", "Total Cost"), fmtMoney(best.TotalCost),
		tx(lang, "净利润", "Net Profit"), fmtMoney(best.Profit))
	setVal(f, sheet1, fmt.Sprintf("A%d", row), bestMsg, s.HighlightStyle)
	f.MergeCell(sheet1, fmt.Sprintf("A%d", row), fmt.Sprintf("N%d", row))
	f.SetCellStyle(sheet1, fmt.Sprintf("A%d", row), fmt.Sprintf("N%d", row), s.HighlightStyle)
	row++
	row++

	// 4. 详细货物清单 (A:N)
	setVal(f, sheet1, fmt.Sprintf("A%d", row), tx(lang, "货物明细", "Cargo Details"), s.SectionTitleStyle)
	f.MergeCell(sheet1, fmt.Sprintf("A%d", row), fmt.Sprintf("N%d", row))
	f.SetCellStyle(sheet1, fmt.Sprintf("A%d", row), fmt.Sprintf("N%d", row), s.SectionTitleStyle)
	row++

	cargoHeaders := []string{
		tx(lang, "货物名称", "Cargo"),
		tx(lang, "图片", "Image"),
		tx(lang, "规格", "Spec"),
		tx(lang, "长(cm)", "L(cm)"),
		tx(lang, "高(cm)", "H(cm)"),
		tx(lang, "宽(cm)", "W(cm)"),
		tx(lang, "重量(kg)", "Wt(kg)"),
		tx(lang, "数量", "Qty"),
		tx(lang, "单价RMB", "Price"),
		tx(lang, "税率%", "Tax%"),
		tx(lang, "税费RMB", "Tax Amt"),
		tx(lang, "合计RMB", "Total RMB"),
		tx(lang, "成本单价USD", "Cost Unit USD"),
		tx(lang, "成本金额USD", "Cost Total USD"),
	}
	for i, h := range cargoHeaders {
		col := string(rune('A' + i))
		setVal(f, sheet1, fmt.Sprintf("%s%d", col, row), h, s.HeaderStyle)
	}
	row++

	for idx, cr := range snap.Cargo {
		alt := idx%2 == 1
		st := s.DataStyle
		mst := s.MoneyStyle
		if alt {
			st = s.AltDataStyle
			mst = s.AltMoneyStyle
		}
		f.SetRowHeight(sheet1, row, 58)
		setVal(f, sheet1, fmt.Sprintf("A%d", row), cr.Name, st)
		setVal(f, sheet1, fmt.Sprintf("B%d", row), imageCellText(cr), st)
		addCargoPicture(f, sheet1, fmt.Sprintf("B%d", row), cr)
		setVal(f, sheet1, fmt.Sprintf("C%d", row), cr.Spec, st)
		setMoney(f, sheet1, fmt.Sprintf("D%d", row), cr.Length, mst)
		setMoney(f, sheet1, fmt.Sprintf("E%d", row), cr.Height, mst)
		setMoney(f, sheet1, fmt.Sprintf("F%d", row), cr.Width, mst)
		setMoney(f, sheet1, fmt.Sprintf("G%d", row), cr.Weight, mst)
		setMoney(f, sheet1, fmt.Sprintf("H%d", row), cr.Qty, mst)
		setMoney(f, sheet1, fmt.Sprintf("I%d", row), cr.UnitPrice, mst)
		setVal(f, sheet1, fmt.Sprintf("J%d", row), fmtPct(cr.TaxRate), st)
		setMoney(f, sheet1, fmt.Sprintf("K%d", row), cargoTax(cr), mst)
		setMoney(f, sheet1, fmt.Sprintf("L%d", row), cargoTotal(cr), mst)
		setMoney(f, sheet1, fmt.Sprintf("M%d", row), cargoCostUnitUsd(cr, inputs), mst)
		setMoney(f, sheet1, fmt.Sprintf("N%d", row), cargoCostLineUsd(cr, inputs), mst)
		row++
	}
	row++

	// 5. 其他费用拆解
	setVal(f, sheet1, fmt.Sprintf("A%d", row), tx(lang, "其他费用明细", "Other Cost Itemization"), s.SectionTitleStyle)
	f.MergeCell(sheet1, fmt.Sprintf("A%d", row), fmt.Sprintf("N%d", row))
	f.SetCellStyle(sheet1, fmt.Sprintf("A%d", row), fmt.Sprintf("N%d", row), s.SectionTitleStyle)
	row++

	{
		schemeItems := snap.Freight
		setVal(f, sheet1, fmt.Sprintf("A%d", row), tx(lang, "费用项目", "Item"), s.HeaderStyle)
		setVal(f, sheet1, fmt.Sprintf("B%d", row), tx(lang, "金额RMB", "Amount"), s.HeaderStyle)
		setVal(f, sheet1, fmt.Sprintf("C%d", row), tx(lang, "计入总成本", "Included"), s.HeaderStyle)
		f.MergeCell(sheet1, fmt.Sprintf("C%d", row), fmt.Sprintf("N%d", row))
		f.SetCellStyle(sheet1, fmt.Sprintf("C%d", row), fmt.Sprintf("N%d", row), s.HeaderStyle)
		row++

		for _, item := range schemeItems {
			setVal(f, sheet1, fmt.Sprintf("A%d", row), item.Item, s.DataStyle)
			setMoney(f, sheet1, fmt.Sprintf("B%d", row), item.Amount, s.MoneyStyle)
			setVal(f, sheet1, fmt.Sprintf("C%d", row), yesNo(item.Included, lang), s.DataStyle)
			f.MergeCell(sheet1, fmt.Sprintf("C%d", row), fmt.Sprintf("N%d", row))
			f.SetCellStyle(sheet1, fmt.Sprintf("C%d", row), fmt.Sprintf("N%d", row), s.DataStyle)
			row++
		}
		row++
	}

	// 6. 成本构成
	setVal(f, sheet1, fmt.Sprintf("A%d", row), tx(lang, "成本构成", "Cost Breakdown"), s.SectionTitleStyle)
	f.MergeCell(sheet1, fmt.Sprintf("A%d", row), fmt.Sprintf("N%d", row))
	f.SetCellStyle(sheet1, fmt.Sprintf("A%d", row), fmt.Sprintf("N%d", row), s.SectionTitleStyle)
	row++

	compHeaders := []string{
		tx(lang, "其他费用", "Other Costs"),
		tx(lang, "港口费用", "Port Charges"),
		tx(lang, "总成本", "Total Cost"),
		tx(lang, "报价USD", "Quote USD"),
		tx(lang, "报价EUR", "Quote EUR"),
		tx(lang, "净利润", "Net Profit"),
		tx(lang, "净利率", "Margin"),
	}
	for i, h := range compHeaders {
		col := string(rune('A' + i))
		setVal(f, sheet1, fmt.Sprintf("%s%d", col, row), h, s.HeaderStyle)
	}
	f.MergeCell(sheet1, fmt.Sprintf("G%d", row), fmt.Sprintf("N%d", row))
	f.SetCellStyle(sheet1, fmt.Sprintf("G%d", row), fmt.Sprintf("N%d", row), s.HeaderStyle)
	row++

	for _, summ := range summaries {
		isBest := true
		st := s.DataStyle
		mst := s.MoneyStyle
		if isBest {
			st = s.HighlightStyle
			mst = s.HighlightStyle
		}
		setMoney(f, sheet1, fmt.Sprintf("A%d", row), summ.Freight, mst)
		setMoney(f, sheet1, fmt.Sprintf("B%d", row), summ.PortCharges, mst)
		setMoney(f, sheet1, fmt.Sprintf("C%d", row), summ.TotalCost, mst)
		setMoney(f, sheet1, fmt.Sprintf("D%d", row), summ.QuoteUsd, mst)
		setMoney(f, sheet1, fmt.Sprintf("E%d", row), summ.QuoteEur, mst)
		setMoney(f, sheet1, fmt.Sprintf("F%d", row), summ.Profit, mst)
		setVal(f, sheet1, fmt.Sprintf("G%d", row), fmtPct(summ.Margin), st)
		f.MergeCell(sheet1, fmt.Sprintf("G%d", row), fmt.Sprintf("N%d", row))
		f.SetCellStyle(sheet1, fmt.Sprintf("G%d", row), fmt.Sprintf("N%d", row), st)
		row++
	}
	row++

	if inputs.Notes != "" {
		setVal(f, sheet1, fmt.Sprintf("A%d", row), tx(lang, "备注", "Notes"), s.BoldStyle)
		setVal(f, sheet1, fmt.Sprintf("B%d", row), inputs.Notes, s.NoteStyle)
		f.MergeCell(sheet1, fmt.Sprintf("B%d", row), fmt.Sprintf("N%d", row))
		f.SetCellStyle(sheet1, fmt.Sprintf("B%d", row), fmt.Sprintf("N%d", row), s.NoteStyle)
		row++
	}
}

func filterFreight(items []FreightRow, scheme string) []FreightRow {
	var out []FreightRow
	for _, it := range items {
		if it.Scheme == scheme {
			out = append(out, it)
		}
	}
	return out
}

func writeCustomer(f *excelize.File, snap *Snapshot, lang string, s *Styles) {
	inputs := snap.Inputs
	goodsCost, summaries := CalculateSchemes(snap)
	best := bestScheme(summaries)
	customerTotal := quoteValue(best, inputs.OutputCurrency)

	sheet := safeSheetName(tx(lang, "客户报价单", "Quotation"))

	f.SetSheetName("Sheet1", sheet)

	f.SetColWidth(sheet, "A", "A", 28)
	f.SetColWidth(sheet, "B", "B", 15)
	f.SetColWidth(sheet, "C", "C", 12)
	f.SetColWidth(sheet, "D", "D", 12)
	f.SetColWidth(sheet, "E", "E", 12)
	f.SetColWidth(sheet, "F", "F", 12)
	f.SetColWidth(sheet, "G", "G", 12)
	f.SetColWidth(sheet, "H", "H", 14)
	f.SetColWidth(sheet, "I", "I", 14)
	f.SetColWidth(sheet, "J", "J", 14)

	row := 1
	title := inputs.ProjectName + " " + tx(lang, "报价单", "Quotation")
	setVal(f, sheet, fmt.Sprintf("A%d", row), title, s.CustomerTitleStyle)
	f.MergeCell(sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("J%d", row))
	row++

	setVal(f, sheet, fmt.Sprintf("A%d", row), tx(lang, "报价信息", "Quotation Info"), s.SectionTitleStyle)
	for i := 1; i <= 9; i++ {
		col := string(rune('A' + i))
		setVal(f, sheet, fmt.Sprintf("%s%d", col, row), "", s.SectionTitleStyle)
	}
	row++

	quoteInfo := []struct {
		label string
		value string
	}{
		{tx(lang, "我方公司", "Company"), inputs.CompanyName},
		{tx(lang, "贸易术语", "Trade Term"), fmt.Sprintf("%s %s", inputs.TradeTerm, inputs.Destination)},
		{tx(lang, "柜型", "Container"), inputs.ContainerType},
		{tx(lang, "报价有效期", "Valid Until"), inputs.ValidUntil},
		{tx(lang, "报价金额", "Quotation Amount"), formatCurrency(customerTotal, inputs.OutputCurrency)},
	}
	for _, item := range quoteInfo {
		if item.value == "" {
			row++
			continue
		}
		setVal(f, sheet, fmt.Sprintf("A%d", row), item.label, s.CustomerLabelStyle)
		setVal(f, sheet, fmt.Sprintf("B%d", row), "", s.CustomerValueStyle)
		setVal(f, sheet, fmt.Sprintf("C%d", row), item.value, s.CustomerValueStyle)
		f.MergeCell(sheet, fmt.Sprintf("C%d", row), fmt.Sprintf("J%d", row))
		row++
	}
	row++

	setVal(f, sheet, fmt.Sprintf("A%d", row), tx(lang, "货物清单", "Cargo List"), s.SectionTitleStyle)
	for i := 1; i <= 9; i++ {
		col := string(rune('A' + i))
		setVal(f, sheet, fmt.Sprintf("%s%d", col, row), "", s.SectionTitleStyle)
	}
	row++

	headers := []string{
		tx(lang, "货物名称", "Cargo"),
		tx(lang, "图片", "Image"),
		tx(lang, "规格", "Spec"),
		tx(lang, "长(cm)", "Length(cm)"),
		tx(lang, "高(cm)", "Height(cm)"),
		tx(lang, "宽(cm)", "Width(cm)"),
		tx(lang, "单箱KG", "KG/Unit"),
		tx(lang, "数量", "Qty"),
		fmt.Sprintf("%s %s", tx(lang, "报价单价", "Unit Price"), inputs.OutputCurrency),
		fmt.Sprintf("%s %s", tx(lang, "金额", "Amount"), inputs.OutputCurrency),
	}
	for i, h := range headers {
		col := string(rune('A' + i))
		setVal(f, sheet, fmt.Sprintf("%s%d", col, row), h, s.HeaderStyle)
	}
	row++

	for idx, cr := range snap.Cargo {
		alt := idx%2 == 1
		dataSt := s.DataStyle
		moneySt := s.MoneyStyle
		if alt {
			dataSt = s.AltDataStyle
			moneySt = s.AltMoneyStyle
		}
		f.SetRowHeight(sheet, row, 58)
		setVal(f, sheet, fmt.Sprintf("A%d", row), cr.Name, dataSt)
		setVal(f, sheet, fmt.Sprintf("B%d", row), imageCellText(cr), dataSt)
		addCargoPicture(f, sheet, fmt.Sprintf("B%d", row), cr)
		setVal(f, sheet, fmt.Sprintf("C%d", row), cr.Spec, dataSt)
		setVal(f, sheet, fmt.Sprintf("D%d", row), cr.Length, moneySt)
		setVal(f, sheet, fmt.Sprintf("E%d", row), cr.Height, moneySt)
		setVal(f, sheet, fmt.Sprintf("F%d", row), cr.Width, moneySt)
		setMoney(f, sheet, fmt.Sprintf("G%d", row), cr.Weight, moneySt)
		setMoney(f, sheet, fmt.Sprintf("H%d", row), cr.Qty, moneySt)
		setMoney(f, sheet, fmt.Sprintf("I%d", row), customerCargoUnit(cr, best, goodsCost, inputs), moneySt)
		setMoney(f, sheet, fmt.Sprintf("J%d", row), customerCargoLine(cr, best, goodsCost, inputs), moneySt)
		row++
	}

	setVal(f, sheet, fmt.Sprintf("A%d", row), tx(lang, "合计", "Total"), s.TotalStyle)
	for i := 1; i <= 8; i++ {
		col := string(rune('A' + i))
		setVal(f, sheet, fmt.Sprintf("%s%d", col, row), "", s.TotalStyle)
	}
	setVal(f, sheet, fmt.Sprintf("I%d", row), "", s.TotalMoneyStyle)
	setVal(f, sheet, fmt.Sprintf("J%d", row), customerTotal, s.TotalMoneyStyle)
	row++
	row++

	setVal(f, sheet, fmt.Sprintf("A%d", row), tx(lang, "费用说明", "Cost Scope"), s.SectionTitleStyle)
	for i := 1; i <= 9; i++ {
		col := string(rune('A' + i))
		setVal(f, sheet, fmt.Sprintf("%s%d", col, row), "", s.SectionTitleStyle)
	}
	row++

	termText := getCustomerTermText(inputs.TradeTerm, inputs.Destination, lang)
	exclusionText := getExclusionText(inputs.TradeTerm, lang)

	setVal(f, sheet, fmt.Sprintf("A%d", row), "• "+termText, s.NoteStyle)
	f.MergeCell(sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("J%d", row))
	row++

	setVal(f, sheet, fmt.Sprintf("A%d", row), "• "+exclusionText, s.NoteStyle)
	f.MergeCell(sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("J%d", row))
	row++

	if inputs.Notes != "" && !isDefaultExclusionNote(inputs.Notes) {
		setVal(f, sheet, fmt.Sprintf("A%d", row), "• "+inputs.Notes, s.NoteStyle)
		f.MergeCell(sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("J%d", row))
		row++
	}
}

func quoteValue(row SummaryRow, currency string) float64 {
	switch strings.ToUpper(strings.TrimSpace(currency)) {
	case "RMB", "CNY":
		return row.QuoteRmb
	case "EUR":
		return row.QuoteEur
	default:
		return row.QuoteUsd
	}
}

func customerCargoUnit(row CargoRow, selected SummaryRow, goodsCost float64, inputs Inputs) float64 {
	if row.Qty == 0 || goodsCost == 0 {
		return 0
	}
	return customerCargoLine(row, selected, goodsCost, inputs) / row.Qty
}

func customerCargoLine(row CargoRow, selected SummaryRow, goodsCost float64, inputs Inputs) float64 {
	if goodsCost == 0 {
		return 0
	}
	ratio := cargoTotal(row) / goodsCost
	return quoteValue(selected, inputs.OutputCurrency) * ratio
}

func currencyName(currency, lang string) string {
	switch strings.ToUpper(strings.TrimSpace(currency)) {
	case "RMB", "CNY":
		return tx(lang, "人民币 RMB", "RMB")
	case "EUR":
		return tx(lang, "欧元 EUR", "EUR")
	default:
		return tx(lang, "美元 USD", "USD")
	}
}

func formatCurrency(value float64, currency string) string {
	code := strings.ToUpper(strings.TrimSpace(currency))
	if code == "" {
		code = "USD"
	}
	if code == "CNY" {
		code = "RMB"
	}
	return fmt.Sprintf("%s %s", code, fmtMoney(value))
}

func imageCellText(cr CargoRow) string {
	if strings.TrimSpace(cr.ImageData) != "" {
		return ""
	}
	return cr.ImageName
}

func addCargoPicture(f *excelize.File, sheet, cell string, cr CargoRow) {
	ext, payload, ok := splitImageData(cr.ImageData)
	if !ok {
		return
	}
	file, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return
	}
	_ = f.AddPictureFromBytes(sheet, cell, &excelize.Picture{
		Extension: ext,
		File:      file,
		Format: &excelize.GraphicOptions{
			AltText:         cr.ImageName,
			LockAspectRatio: true,
			AutoFit:         true,
			OffsetX:         4,
			OffsetY:         4,
		},
	})
}

func splitImageData(data string) (string, string, bool) {
	if data == "" {
		return "", "", false
	}
	parts := strings.SplitN(data, ",", 2)
	if len(parts) != 2 || !strings.Contains(parts[0], ";base64") {
		return "", "", false
	}
	ext := ".jpg"
	header := strings.ToLower(parts[0])
	switch {
	case strings.Contains(header, "image/png"):
		ext = ".png"
	case strings.Contains(header, "image/gif"):
		ext = ".gif"
	case strings.Contains(header, "image/webp"):
		ext = ".webp"
	case strings.Contains(header, "image/jpeg"), strings.Contains(header, "image/jpg"):
		ext = ".jpg"
	}
	return ext, parts[1], true
}

func safeSheetName(name string) string {
	replacer := strings.NewReplacer("\\", " ", "/", " ", "?", " ", "*", " ", "[", " ", "]", " ", ":", " ")
	name = replacer.Replace(name)
	name = strings.TrimSpace(name)
	runes := []rune(name)
	if len(runes) > 31 {
		runes = runes[:31]
	}
	name = strings.TrimSpace(string(runes))
	if name == "" {
		name = "Sheet"
	}
	return name
}

func setVal(f *excelize.File, sheet, cell string, val interface{}, styleID int) {
	f.SetCellValue(sheet, cell, val)
	if styleID >= 0 {
		f.SetCellStyle(sheet, cell, cell, styleID)
	}
}

func setMoney(f *excelize.File, sheet, cell string, val float64, styleID int) {
	f.SetCellValue(sheet, cell, math.Round(val*100)/100)
	if styleID >= 0 {
		f.SetCellStyle(sheet, cell, cell, styleID)
	}
}

func fmtMoney(v float64) string {
	return fmt.Sprintf("%.2f", v)
}

func fmtPct(v float64) string {
	return fmt.Sprintf("%.2f%%", v)
}
