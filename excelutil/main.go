package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"strings"

	"github.com/xuri/excelize/v2"
)

type Inputs struct {
	CompanyName    string  `json:"companyName"`
	ProjectName    string  `json:"projectName"`
	TradeTerm      string  `json:"tradeTerm"`
	ContainerType  string  `json:"containerType"`
	Destination    string  `json:"destination"`
	ValidUntil     string  `json:"validUntil"`
	ExchangeRate   float64 `json:"exchangeRate"`
	QuoteUsd       float64 `json:"quoteUsd"`
	TargetProfit   float64 `json:"targetProfit"`
	SelectedScheme string  `json:"selectedScheme"`
	Notes          string  `json:"notes"`
}

type CargoRow struct {
	Name      string  `json:"name"`
	Spec      string  `json:"spec"`
	Length    float64 `json:"length"`
	Height    float64 `json:"height"`
	Width     float64 `json:"width"`
	Weight    float64 `json:"weight"`
	Qty       float64 `json:"qty"`
	UnitPrice float64 `json:"unitPrice"`
	TaxRate   float64 `json:"taxRate"`
}

type FreightRow struct {
	Scheme   string  `json:"scheme"`
	Item     string  `json:"item"`
	Amount   float64 `json:"amount"`
	Included bool    `json:"included"`
}

type Snapshot struct {
	ID        string       `json:"id"`
	Label     string       `json:"label"`
	UpdatedAt string       `json:"updatedAt"`
	Inputs    Inputs       `json:"inputs"`
	Schemes   []string     `json:"schemes"`
	Cargo     []CargoRow   `json:"cargo"`
	Freight   []FreightRow `json:"freight"`
}

func cargoTax(row CargoRow) float64 {
	return row.UnitPrice * row.Qty * row.TaxRate / 100
}

func cargoTotal(row CargoRow) float64 {
	return row.UnitPrice*row.Qty + cargoTax(row)
}

func totalCargoQty(cargo []CargoRow) float64 {
	var sum float64
	for _, row := range cargo {
		sum += row.Qty
	}
	return sum
}

func quoteUnitUsd(quoteUsd float64, qty float64) float64 {
	if qty == 0 {
		return 0
	}
	return quoteUsd / qty
}

func quoteLineUsd(unitUsd float64, qty float64) float64 {
	return unitUsd * qty
}

type SchemeSummary struct {
	Scheme        string
	Freight       float64
	TotalCost     float64
	TargetPrice   float64
	QuoteRmb      float64
	Profit        float64
	Margin        float64
	Markup        float64
	HasQuotedCost bool
}

func calculateSchemes(snap *Snapshot) (goodsCost float64, quoteRmb float64, summaries []SchemeSummary) {
	inputs := snap.Inputs
	for _, row := range snap.Cargo {
		goodsCost += cargoTotal(row)
	}
	quoteRmb = inputs.QuoteUsd * inputs.ExchangeRate

	schemeSet := make(map[string]bool)
	for _, fr := range snap.Freight {
		if fr.Scheme != "" {
			schemeSet[fr.Scheme] = true
		}
	}
	var schemeIDs []string
	for _, s := range snap.Schemes {
		if schemeSet[s] {
			schemeIDs = append(schemeIDs, s)
		}
	}
	if len(schemeIDs) == 0 {
		for s := range schemeSet {
			schemeIDs = append(schemeIDs, s)
		}
	}
	if len(schemeIDs) == 0 {
		schemeIDs = []string{"A"}
	}

	for _, scheme := range schemeIDs {
		var freight float64
		for _, fr := range snap.Freight {
			if fr.Scheme == scheme && fr.Included {
				freight += fr.Amount
			}
		}
		totalCost := goodsCost + freight
		targetPrice := totalCost * (1 + inputs.TargetProfit/100)
		profit := quoteRmb - totalCost
		margin := 0.0
		if quoteRmb != 0 {
			margin = profit / quoteRmb * 100
		}
		markup := 0.0
		if totalCost != 0 {
			markup = profit / totalCost * 100
		}
		var hasQuotedCost bool
		for _, fr := range snap.Freight {
			if fr.Scheme == scheme && fr.Included && fr.Amount > 0 {
				hasQuotedCost = true
				break
			}
		}
		summaries = append(summaries, SchemeSummary{
			Scheme:        scheme,
			Freight:       freight,
			TotalCost:     totalCost,
			TargetPrice:   targetPrice,
			QuoteRmb:      quoteRmb,
			Profit:        profit,
			Margin:        margin,
			Markup:        markup,
			HasQuotedCost: hasQuotedCost,
		})
	}
	return
}

func bestScheme(summaries []SchemeSummary) SchemeSummary {
	var eligible []SchemeSummary
	for _, s := range summaries {
		if s.HasQuotedCost {
			eligible = append(eligible, s)
		}
	}
	candidates := eligible
	if len(candidates) == 0 {
		candidates = summaries
	}
	best := candidates[0]
	for _, s := range candidates[1:] {
		if s.TotalCost < best.TotalCost || (s.TotalCost == best.TotalCost && s.Profit > best.Profit) {
			best = s
		}
	}
	return best
}

func tx(lang, zh, en string) string {
	switch lang {
	case "en":
		return en
	case "bilingual":
		return zh + " / " + en
	default:
		return zh
	}
}

func freightName(scheme, lang string) string {
	return scheme + tx(lang, "货代", "Forwarder")
}

func yesNo(val bool, lang string) string {
	if val {
		return tx(lang, "是", "Yes")
	}
	return tx(lang, "否", "No")
}

func fmtMoney(v float64) string {
	if math.Abs(v) >= 1e8 {
		return fmt.Sprintf("%.2f", v)
	}
	return fmt.Sprintf("%.0f", math.Round(v))
}

func fmtPct(v float64) string {
	return fmt.Sprintf("%.2f%%", v)
}

type Styles struct {
	TitleStyle         int
	HeaderStyle        int
	SubHeaderStyle     int
	DataStyle          int
	MoneyStyle         int
	HighlightStyle     int
	BoldStyle          int
	NoteStyle          int
	AltDataStyle       int
	AltMoneyStyle      int
	SectionTitleStyle  int
	TotalStyle         int
	TotalMoneyStyle    int
	SmallNoteStyle     int
	CustomerTitleStyle int
	CustomerLabelStyle int
	CustomerValueStyle int
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


func setVal(f *excelize.File, sheet, cell string, val interface{}, styleID int) {
	f.SetCellValue(sheet, cell, val)
	if styleID >= 0 {
		f.SetCellStyle(sheet, cell, cell, styleID)
	}
}

func setMoney(f *excelize.File, sheet, cell string, val float64, styleID int) {
	f.SetCellFloat(sheet, cell, math.Round(val), 0, 64)
	if styleID >= 0 {
		f.SetCellStyle(sheet, cell, cell, styleID)
	}
}

func writeInternal(f *excelize.File, snap *Snapshot, lang string, s *Styles) {
	inputs := snap.Inputs
	goodsCost, quoteRmb, summaries := calculateSchemes(snap)
	best := bestScheme(summaries)
	qty := totalCargoQty(snap.Cargo)
	unitUsd := quoteUnitUsd(inputs.QuoteUsd, qty)

	sheet1 := safeSheetName(tx(lang, "报价汇总", "Summary"))
	f.SetSheetName("Sheet1", sheet1)

	// 统一列宽，使布局更舒展
	f.SetColWidth(sheet1, "A", "A", 25)
	f.SetColWidth(sheet1, "B", "F", 18)

	row := 1
	// 标题跨全列
	setVal(f, sheet1, fmt.Sprintf("A%d", row), inputs.ProjectName+" "+tx(lang, "报价测算汇总", "Quotation Summary"), s.TitleStyle)
	f.MergeCell(sheet1, fmt.Sprintf("A%d", row), fmt.Sprintf("F%d", row))
	f.SetCellStyle(sheet1, fmt.Sprintf("A%d", row), fmt.Sprintf("F%d", row), s.TitleStyle)
	row++
	row++ // 增加留白

	// 基础信息部分
	setVal(f, sheet1, fmt.Sprintf("A%d", row), tx(lang, "基础信息", "Basic Info"), s.SectionTitleStyle)
	f.MergeCell(sheet1, fmt.Sprintf("A%d", row), fmt.Sprintf("F%d", row))
	f.SetCellStyle(sheet1, fmt.Sprintf("A%d", row), fmt.Sprintf("F%d", row), s.SectionTitleStyle)
	row++

	infoRows := []struct {
		label string
		value string
	}{
		{tx(lang, "我方公司", "Company"), inputs.CompanyName},
		{tx(lang, "贸易术语", "Trade Term"), inputs.TradeTerm + " " + inputs.Destination},
		{tx(lang, "柜型", "Container"), inputs.ContainerType},
		{tx(lang, "目的港", "Destination"), inputs.Destination},
		{tx(lang, "报价有效期", "Valid Until"), inputs.ValidUntil},
		{tx(lang, "美元汇率", "USD/RMB Rate"), fmt.Sprintf("%.6f", inputs.ExchangeRate)},
		{tx(lang, "目标利润率", "Target Profit"), fmtPct(inputs.TargetProfit)},
	}
	for _, ir := range infoRows {
		if ir.value == "" {
			continue
		}
		setVal(f, sheet1, fmt.Sprintf("A%d", row), ir.label, s.BoldStyle)
		setVal(f, sheet1, fmt.Sprintf("B%d", row), ir.value, s.DataStyle)
		f.MergeCell(sheet1, fmt.Sprintf("B%d", row), fmt.Sprintf("F%d", row))
		f.SetCellStyle(sheet1, fmt.Sprintf("B%d", row), fmt.Sprintf("F%d", row), s.DataStyle)
		row++
	}
	row++

	// 利润测算部分
	setVal(f, sheet1, fmt.Sprintf("A%d", row), tx(lang, "利润测算", "Profit Analysis"), s.SectionTitleStyle)
	f.MergeCell(sheet1, fmt.Sprintf("A%d", row), fmt.Sprintf("F%d", row))
	f.SetCellStyle(sheet1, fmt.Sprintf("A%d", row), fmt.Sprintf("F%d", row), s.SectionTitleStyle)
	row++

	profitRows := []struct {
		label string
		value float64
		style int
	}{
		{tx(lang, "货物总成本", "Total Cargo Cost"), goodsCost, s.MoneyStyle},
		{tx(lang, "最终客户报价(USD)", "Final Quote USD"), inputs.QuoteUsd, s.MoneyStyle},
		{tx(lang, "最终报价折合RMB", "Quote in RMB"), quoteRmb, s.MoneyStyle},
	}
	for _, pr := range profitRows {
		setVal(f, sheet1, fmt.Sprintf("A%d", row), pr.label, s.BoldStyle)
		setMoney(f, sheet1, fmt.Sprintf("B%d", row), pr.value, pr.style)
		f.MergeCell(sheet1, fmt.Sprintf("B%d", row), fmt.Sprintf("F%d", row))
		f.SetCellStyle(sheet1, fmt.Sprintf("B%d", row), fmt.Sprintf("F%d", row), pr.style)
		row++
	}

	// 推荐方案高亮行
	bestMsg := fmt.Sprintf("%s: %s | %s: %s / %s: %s",
		tx(lang, "推荐方案", "Best Option"), freightName(best.Scheme, lang),
		tx(lang, "总成本", "Total Cost"), fmtMoney(best.TotalCost),
		tx(lang, "净利润", "Net Profit"), fmtMoney(best.Profit))
	setVal(f, sheet1, fmt.Sprintf("A%d", row), bestMsg, s.HighlightStyle)
	f.MergeCell(sheet1, fmt.Sprintf("A%d", row), fmt.Sprintf("F%d", row))
	f.SetCellStyle(sheet1, fmt.Sprintf("A%d", row), fmt.Sprintf("F%d", row), s.HighlightStyle)
	row++
	row++

	// 货物清单部分（新加入汇总页）
	setVal(f, sheet1, fmt.Sprintf("A%d", row), tx(lang, "货物清单", "Cargo List"), s.SectionTitleStyle)
	f.MergeCell(sheet1, fmt.Sprintf("A%d", row), fmt.Sprintf("F%d", row))
	f.SetCellStyle(sheet1, fmt.Sprintf("A%d", row), fmt.Sprintf("F%d", row), s.SectionTitleStyle)
	row++

	cargoHeadersSmall := []string{
		tx(lang, "货物名称", "Cargo"),
		tx(lang, "规格", "Spec"),
		tx(lang, "数量", "Qty"),
		tx(lang, "单价RMB", "Unit Price"),
		tx(lang, "合计RMB", "Total"),
	}
	for i, h := range cargoHeadersSmall {
		col := string(rune('A' + i))
		setVal(f, sheet1, fmt.Sprintf("%s%d", col, row), h, s.HeaderStyle)
	}
	// 最后一列跨两格
	setVal(f, sheet1, fmt.Sprintf("F%d", row), "", s.HeaderStyle)
	f.MergeCell(sheet1, fmt.Sprintf("E%d", row), fmt.Sprintf("F%d", row))
	row++

	for idx, cr := range snap.Cargo {
		alt := idx%2 == 1
		dataSt := s.DataStyle
		moneySt := s.MoneyStyle
		if alt {
			dataSt = s.AltDataStyle
			moneySt = s.AltMoneyStyle
		}
		setVal(f, sheet1, fmt.Sprintf("A%d", row), cr.Name, dataSt)
		setVal(f, sheet1, fmt.Sprintf("B%d", row), cr.Spec, dataSt)
		setMoney(f, sheet1, fmt.Sprintf("C%d", row), cr.Qty, moneySt)
		setMoney(f, sheet1, fmt.Sprintf("D%d", row), cr.UnitPrice, moneySt)
		setMoney(f, sheet1, fmt.Sprintf("E%d", row), cargoTotal(cr), moneySt)
		f.MergeCell(sheet1, fmt.Sprintf("E%d", row), fmt.Sprintf("F%d", row))
		f.SetCellStyle(sheet1, fmt.Sprintf("F%d", row), fmt.Sprintf("F%d", row), moneySt)
		row++
	}
	row++

	// 方案对比部分
	setVal(f, sheet1, fmt.Sprintf("A%d", row), tx(lang, "方案对比", "Option Comparison"), s.SectionTitleStyle)
	f.MergeCell(sheet1, fmt.Sprintf("A%d", row), fmt.Sprintf("F%d", row))
	f.SetCellStyle(sheet1, fmt.Sprintf("A%d", row), fmt.Sprintf("F%d", row), s.SectionTitleStyle)
	row++

	headers := []string{
		tx(lang, "方案", "Option"),
		tx(lang, "物流费", "Logistics"),
		tx(lang, "总成本", "Total Cost"),
		tx(lang, "目标价", "Target Price"),
		tx(lang, "净利润", "Net Profit"),
		tx(lang, "净利率", "Margin"),
	}
	for i, h := range headers {
		col := string(rune('A' + i))
		setVal(f, sheet1, fmt.Sprintf("%s%d", col, row), h, s.HeaderStyle)
	}
	row++

	for _, summ := range summaries {
		isBest := summ.Scheme == best.Scheme
		dataSt := s.DataStyle
		moneySt := s.MoneyStyle
		if isBest {
			dataSt = s.HighlightStyle
			moneySt = s.HighlightStyle
		}
		setVal(f, sheet1, fmt.Sprintf("A%d", row), freightName(summ.Scheme, lang), dataSt)
		setMoney(f, sheet1, fmt.Sprintf("B%d", row), summ.Freight, moneySt)
		setMoney(f, sheet1, fmt.Sprintf("C%d", row), summ.TotalCost, moneySt)
		setMoney(f, sheet1, fmt.Sprintf("D%d", row), summ.TargetPrice, moneySt)
		setMoney(f, sheet1, fmt.Sprintf("E%d", row), summ.Profit, moneySt)
		st := moneySt
		if isBest {
			st = s.HighlightStyle
		}
		setVal(f, sheet1, fmt.Sprintf("F%d", row), fmtPct(summ.Margin), st)
		row++
	}
	row++

	if inputs.Notes != "" {
		setVal(f, sheet1, fmt.Sprintf("A%d", row), tx(lang, "备注", "Notes"), s.BoldStyle)
		setVal(f, sheet1, fmt.Sprintf("B%d", row), inputs.Notes, s.NoteStyle)
		f.MergeCell(sheet1, fmt.Sprintf("B%d", row), fmt.Sprintf("F%d", row))
		f.SetCellStyle(sheet1, fmt.Sprintf("B%d", row), fmt.Sprintf("F%d", row), s.NoteStyle)
		row++
	}

	sheet2 := safeSheetName(tx(lang, "货物成本明细", "Cargo Details"))
	f.NewSheet(sheet2)


	cargoHeaders := []string{
		tx(lang, "货物名称", "Cargo"),
		tx(lang, "规格", "Specification"),
		tx(lang, "长(m)", "Length(m)"),
		tx(lang, "高(m)", "Height(m)"),
		tx(lang, "宽(m)", "Width(m)"),
		tx(lang, "单箱KG", "KG/Unit"),
		tx(lang, "数量", "Qty"),
		tx(lang, "单价RMB", "Unit Price"),
		tx(lang, "税率%", "Tax Rate"),
		tx(lang, "税费RMB", "Tax"),
		tx(lang, "合计RMB", "Total"),
		tx(lang, "平均报价USD", "Avg Quote"),
		tx(lang, "报价金额USD", "Quote Amt"),
	}

	widths := []float64{18, 16, 10, 10, 10, 12, 8, 14, 10, 14, 16, 14, 16}
	for i, w := range widths {
		col := string(rune('A' + i))
		f.SetColWidth(sheet2, col, col, w)
	}

	// 标题行
	title := inputs.ProjectName + " " + tx(lang, "货物成本明细", "Cargo Cost Details")
	setVal(f, sheet2, "A1", title, s.TitleStyle)
	f.MergeCell(sheet2, "A1", "M1")

	vHeader := 2
	for i, h := range cargoHeaders {
		col := string(rune('A' + i))
		setVal(f, sheet2, fmt.Sprintf("%s%d", col, vHeader), h, s.HeaderStyle)
	}

	row = 3
	for idx, cr := range snap.Cargo {
		alt := idx%2 == 1
		dataSt := s.DataStyle
		moneySt := s.MoneyStyle
		if alt {
			dataSt = s.AltDataStyle
			moneySt = s.AltMoneyStyle
		}
		setVal(f, sheet2, fmt.Sprintf("A%d", row), cr.Name, dataSt)
		setVal(f, sheet2, fmt.Sprintf("B%d", row), cr.Spec, dataSt)
		setVal(f, sheet2, fmt.Sprintf("C%d", row), cr.Length, moneySt)
		setVal(f, sheet2, fmt.Sprintf("D%d", row), cr.Height, moneySt)
		setVal(f, sheet2, fmt.Sprintf("E%d", row), cr.Width, moneySt)
		setMoney(f, sheet2, fmt.Sprintf("F%d", row), cr.Weight, moneySt)
		setMoney(f, sheet2, fmt.Sprintf("G%d", row), cr.Qty, moneySt)
		setMoney(f, sheet2, fmt.Sprintf("H%d", row), cr.UnitPrice, moneySt)
		setVal(f, sheet2, fmt.Sprintf("I%d", row), cr.TaxRate, moneySt)
		setMoney(f, sheet2, fmt.Sprintf("J%d", row), cargoTax(cr), moneySt)
		setMoney(f, sheet2, fmt.Sprintf("K%d", row), cargoTotal(cr), moneySt)
		setMoney(f, sheet2, fmt.Sprintf("L%d", row), unitUsd, moneySt)
		setMoney(f, sheet2, fmt.Sprintf("M%d", row), quoteLineUsd(unitUsd, cr.Qty), moneySt)
		row++
	}

	setVal(f, sheet2, fmt.Sprintf("A%d", row), tx(lang, "合计", "Total"), s.TotalStyle)
	for colIdx := 1; colIdx <= 12; colIdx++ {
		col := string(rune('A' + colIdx))
		setVal(f, sheet2, fmt.Sprintf("%s%d", col, row), "", s.TotalStyle)
	}
	setMoney(f, sheet2, fmt.Sprintf("K%d", row), goodsCost, s.TotalMoneyStyle)
	setVal(f, sheet2, fmt.Sprintf("M%d", row), inputs.QuoteUsd, s.TotalMoneyStyle)
	row++

	sheet3 := safeSheetName(tx(lang, "货代费用", "Freight Details"))
	f.NewSheet(sheet3)

	f.SetColWidth(sheet3, "A", "A", 24)
	f.SetColWidth(sheet3, "B", "B", 14)
	f.SetColWidth(sheet3, "C", "C", 12)

	setVal(f, sheet3, "A1", tx(lang, "货代费用明细", "Freight Forwarder Details"), s.TitleStyle)
	f.MergeCell(sheet3, "A1", "D1")

	vHeader = 2
	ftHeaders := []string{
		tx(lang, "方案", "Option"),
		tx(lang, "费用项目", "Cost Item"),
		tx(lang, "金额RMB", "Amount"),
		tx(lang, "计入报价", "Included"),
	}
	for i, h := range ftHeaders {
		col := string(rune('A' + i))
		if col > "D" {
			break
		}
		setVal(f, sheet3, fmt.Sprintf("%s%d", col, vHeader), h, s.HeaderStyle)
	}
	f.SetColWidth(sheet3, "D", "D", 12)

	row = 3
	for _, scheme := range snap.Schemes {
		groupRows := []FreightRow{}
		for _, fr := range snap.Freight {
			if fr.Scheme == scheme {
				groupRows = append(groupRows, fr)
			}
		}
		if len(groupRows) == 0 {
			continue
		}

		setVal(f, sheet3, fmt.Sprintf("A%d", row), freightName(scheme, lang), s.SubHeaderStyle)
		setVal(f, sheet3, fmt.Sprintf("B%d", row), "", s.SubHeaderStyle)
		setVal(f, sheet3, fmt.Sprintf("C%d", row), "", s.SubHeaderStyle)
		setVal(f, sheet3, fmt.Sprintf("D%d", row), "", s.SubHeaderStyle)
		row++

		for idx, fr := range groupRows {
			alt := idx%2 == 1
			dataSt := s.DataStyle
			moneySt := s.MoneyStyle
			if alt {
				dataSt = s.AltDataStyle
				moneySt = s.AltMoneyStyle
			}
			setVal(f, sheet3, fmt.Sprintf("A%d", row), "", dataSt)
			setVal(f, sheet3, fmt.Sprintf("B%d", row), fr.Item, dataSt)
			setMoney(f, sheet3, fmt.Sprintf("C%d", row), math.Round(fr.Amount), moneySt)
			setVal(f, sheet3, fmt.Sprintf("D%d", row), yesNo(fr.Included, lang), dataSt)
			row++
		}

		setVal(f, sheet3, fmt.Sprintf("A%d", row), tx(lang, "小计", "Subtotal"), s.TotalStyle)
		setVal(f, sheet3, fmt.Sprintf("B%d", row), "", s.TotalStyle)
		var schemeTotal float64
		for _, fr := range groupRows {
			if fr.Included {
				schemeTotal += fr.Amount
			}
		}
		setMoney(f, sheet3, fmt.Sprintf("C%d", row), math.Round(schemeTotal), s.TotalMoneyStyle)
		setVal(f, sheet3, fmt.Sprintf("D%d", row), "", s.TotalStyle)
		row++
		row++
	}
}

func writeCustomer(f *excelize.File, snap *Snapshot, lang string, s *Styles) {
	inputs := snap.Inputs
	qty := totalCargoQty(snap.Cargo)
	unitUsd := quoteUnitUsd(inputs.QuoteUsd, qty)

	sheet := safeSheetName(tx(lang, "报价单", "Quotation"))
	f.SetSheetName("Sheet1", sheet)

	f.SetColWidth(sheet, "A", "A", 28)
	f.SetColWidth(sheet, "B", "B", 12)
	f.SetColWidth(sheet, "C", "C", 12)
	f.SetColWidth(sheet, "D", "D", 12)
	f.SetColWidth(sheet, "E", "E", 12)
	f.SetColWidth(sheet, "F", "F", 12)
	f.SetColWidth(sheet, "G", "G", 12)
	f.SetColWidth(sheet, "H", "H", 14)
	f.SetColWidth(sheet, "I", "I", 14)

	row := 1
	title := inputs.ProjectName + " " + tx(lang, "报价单", "Quotation")
	setVal(f, sheet, fmt.Sprintf("A%d", row), title, s.CustomerTitleStyle)
	f.MergeCell(sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("I%d", row))
	row++

	setVal(f, sheet, fmt.Sprintf("A%d", row), tx(lang, "报价信息", "Quotation Info"), s.SectionTitleStyle)
	for i := 1; i <= 8; i++ {
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
		{tx(lang, "报价金额", "Quotation Amount"), fmt.Sprintf("USD %s", fmtMoney(inputs.QuoteUsd))},
	}
	for _, item := range quoteInfo {
		if item.value == "" {
			row++
			continue
		}
		setVal(f, sheet, fmt.Sprintf("A%d", row), item.label, s.CustomerLabelStyle)
		setVal(f, sheet, fmt.Sprintf("B%d", row), "", s.CustomerValueStyle)
		setVal(f, sheet, fmt.Sprintf("C%d", row), item.value, s.CustomerValueStyle)
		f.MergeCell(sheet, fmt.Sprintf("C%d", row), fmt.Sprintf("I%d", row))
		row++
	}
	row++

	setVal(f, sheet, fmt.Sprintf("A%d", row), tx(lang, "货物清单", "Cargo List"), s.SectionTitleStyle)
	for i := 1; i <= 8; i++ {
		col := string(rune('A' + i))
		setVal(f, sheet, fmt.Sprintf("%s%d", col, row), "", s.SectionTitleStyle)
	}
	row++

	headers := []string{
		tx(lang, "货物名称", "Cargo"),
		tx(lang, "规格", "Spec"),
		tx(lang, "长(m)", "Length"),
		tx(lang, "高(m)", "Height"),
		tx(lang, "宽(m)", "Width"),
		tx(lang, "单箱KG", "KG/Unit"),
		tx(lang, "数量", "Qty"),
		tx(lang, "均单价USD", "Unit Price"),
		tx(lang, "金额USD", "Amount"),
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
		setVal(f, sheet, fmt.Sprintf("A%d", row), cr.Name, dataSt)
		setVal(f, sheet, fmt.Sprintf("B%d", row), cr.Spec, dataSt)
		setVal(f, sheet, fmt.Sprintf("C%d", row), cr.Length, moneySt)
		setVal(f, sheet, fmt.Sprintf("D%d", row), cr.Height, moneySt)
		setVal(f, sheet, fmt.Sprintf("E%d", row), cr.Width, moneySt)
		setMoney(f, sheet, fmt.Sprintf("F%d", row), cr.Weight, moneySt)
		setMoney(f, sheet, fmt.Sprintf("G%d", row), cr.Qty, moneySt)
		setMoney(f, sheet, fmt.Sprintf("H%d", row), unitUsd, moneySt)
		setMoney(f, sheet, fmt.Sprintf("I%d", row), quoteLineUsd(unitUsd, cr.Qty), moneySt)
		row++
	}

	setVal(f, sheet, fmt.Sprintf("A%d", row), tx(lang, "合计", "Total"), s.TotalStyle)
	for i := 1; i <= 7; i++ {
		col := string(rune('A' + i))
		setVal(f, sheet, fmt.Sprintf("%s%d", col, row), "", s.TotalStyle)
	}
	setVal(f, sheet, fmt.Sprintf("H%d", row), unitUsd, s.TotalMoneyStyle)
	setVal(f, sheet, fmt.Sprintf("I%d", row), inputs.QuoteUsd, s.TotalMoneyStyle)
	row++
	row++

	setVal(f, sheet, fmt.Sprintf("A%d", row), tx(lang, "费用说明", "Cost Scope"), s.SectionTitleStyle)
	for i := 1; i <= 8; i++ {
		col := string(rune('A' + i))
		setVal(f, sheet, fmt.Sprintf("%s%d", col, row), "", s.SectionTitleStyle)
	}
	row++

	termText := getCustomerTermText(inputs.TradeTerm, inputs.Destination, lang)
	exclusionText := getExclusionText(lang)

	setVal(f, sheet, fmt.Sprintf("A%d", row), "• "+termText, s.NoteStyle)
	f.MergeCell(sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("I%d", row))
	row++

	setVal(f, sheet, fmt.Sprintf("A%d", row), "• "+exclusionText, s.NoteStyle)
	f.MergeCell(sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("I%d", row))
	row++

	if inputs.Notes != "" && inputs.Notes != defaultExclusion && inputs.Notes != defaultExclusion2 {
		setVal(f, sheet, fmt.Sprintf("A%d", row), "• "+inputs.Notes, s.NoteStyle)
		f.MergeCell(sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("I%d", row))
		row++
	}
	row++
	row++

}

func getCustomerTermText(term, destination, lang string) string {
	place := destination
	if place == "" {
		place = tx(lang, "指定目的港", "the named destination port")
	}
	switch term {
	case "FOB":
		return tx(lang,
			"报价包含货物至中国起运港并完成出口报关相关费用，不包含国际海运费、保险费及目的港费用。",
			"The quotation includes cargo, delivery to the China port of loading, and export customs clearance. International ocean freight, insurance, and destination charges are excluded.")
	case "CIF":
		return tx(lang,
			fmt.Sprintf("报价包含货物、出口端费用、国际海运费及基础海运保险至%s。", place),
			fmt.Sprintf("The quotation includes cargo, origin-side charges, international ocean freight, and basic marine insurance to %s.", place))
	default:
		return tx(lang,
			fmt.Sprintf("报价包含货物、出口端费用及国际海运费至%s。", place),
			fmt.Sprintf("The quotation includes cargo, origin-side charges, and international ocean freight to %s.", place))
	}
}

func getExclusionText(lang string) string {
	return tx(lang,
		"不包含目的港清关、关税、目的港杂费、仓储费、查验费、目的地派送及其他买方当地费用。",
		"Destination customs clearance, duties/taxes, destination port charges, storage, inspection, destination delivery, and other buyer-side local charges are excluded.")
}

const defaultExclusion = "目的港清关、关税、目的港杂费、目的地派送等费用默认不包含在CFR报价内。"
const defaultExclusion2 = "目的港清关、关税、目的港杂费、仓储费、查验费、目的地派送及其他买方当地费用默认不包含在CFR报价内。"

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

func fixDefaults(snap *Snapshot) {
	if snap.Inputs.ProjectName == "" {
		snap.Inputs.ProjectName = "未命名报价"
	}
	if snap.Inputs.TargetProfit == 0 {
		snap.Inputs.TargetProfit = 15
	}
	if len(snap.Schemes) == 0 {
		for _, fr := range snap.Freight {
			if fr.Scheme != "" {
				snap.Schemes = append(snap.Schemes, fr.Scheme)
			}
		}
		if len(snap.Schemes) == 0 {
			snap.Schemes = []string{"A"}
		}
		seen := make(map[string]bool)
		var dedup []string
		for _, s := range snap.Schemes {
			if !seen[s] {
				seen[s] = true
				dedup = append(dedup, s)
			}
		}
		snap.Schemes = dedup
	}
}

// ── HTTP 服务器模式 ──────────────────────────────────────────────────────

const storageDir = "./data"

func initStorage() {
	if _, err := os.Stat(storageDir); os.IsNotExist(err) {
		_ = os.MkdirAll(storageDir, 0755)
	}
}

func startServer() {
	initStorage()
	mux := http.NewServeMux()
	mux.HandleFunc("/api/export", handleExport)
	mux.HandleFunc("/api/save", handleSave)
	mux.HandleFunc("/api/list", handleList)
	mux.HandleFunc("/api/load", handleLoad)
	mux.HandleFunc("/api/delete", handleDelete)
	addr := ":8081"
	log.Printf("excelutil 服务器启动于 %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}

func handleDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "Missing ID", http.StatusBadRequest)
		return
	}
	safeID := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '_'
	}, id)
	path := fmt.Sprintf("%s/%s.json", storageDir, safeID)
	if err := os.Remove(path); err != nil {
		http.Error(w, "Failed to delete", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, "Deleted")
}

func handleSave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var snap Snapshot
	if err := json.NewDecoder(r.Body).Decode(&snap); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if snap.ID == "" {
		snap.ID = fmt.Sprintf("%d", os.Getpid()) // Fallback
	}
	// 清理文件名
	safeID := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '_'
	}, snap.ID)

	path := fmt.Sprintf("%s/%s.json", storageDir, safeID)
	data, _ := json.MarshalIndent(snap, "", "  ")
	if err := os.WriteFile(path, data, 0644); err != nil {
		http.Error(w, "Failed to save", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, "Saved")
}

func handleList(w http.ResponseWriter, r *http.Request) {
	files, err := os.ReadDir(storageDir)
	if err != nil {
		http.Error(w, "Failed to read storage", http.StatusInternalServerError)
		return
	}

	type Summary struct {
		ID          string `json:"id"`
		ProjectName string `json:"projectName"`
		Label       string `json:"label"`
		UpdatedAt   string `json:"updatedAt"`
	}
	var list []Summary
	for _, f := range files {
		if !strings.HasSuffix(f.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(storageDir + "/" + f.Name())
		if err != nil {
			continue
		}
		var snap Snapshot
		if err := json.Unmarshal(data, &snap); err == nil {
			list = append(list, Summary{
				ID:          snap.ID,
				ProjectName: snap.Inputs.ProjectName,
				Label:       snap.Label,
				UpdatedAt:   snap.UpdatedAt,
			})
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(list)
}

func handleLoad(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "Missing ID", http.StatusBadRequest)
		return
	}
	safeID := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '_'
	}, id)
	path := fmt.Sprintf("%s/%s.json", storageDir, safeID)
	data, err := os.ReadFile(path)
	if err != nil {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

func handleExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	mode := r.URL.Query().Get("mode")
	if mode == "" {
		mode = "customer"
	}
	lang := r.URL.Query().Get("lang")
	if lang == "" {
		lang = "zh"
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}

	var snap Snapshot
	if err := json.Unmarshal(body, &snap); err != nil {
		http.Error(w, "Invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	fixDefaults(&snap)

	f := excelize.NewFile()
	styles := createStyles(f)

	if mode == "internal" {
		writeInternal(f, &snap, lang, styles)
	} else {
		writeCustomer(f, &snap, lang, styles)
	}

	// 清理非法字符做文件名
	name := strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r == ':' || r == '*' || r == '?' || r == '"' || r == '<' || r == '>' || r == '|' {
			return '_'
		}
		return r
	}, snap.Inputs.ProjectName)
	if name == "" {
		name = "Quotation"
	}

	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s_%s.xlsx"`, name, mode))

	if _, err := f.WriteTo(w); err != nil {
		log.Printf("写入 Excel 响应失败: %v", err)
	}
}

func main() {
	serverMode := flag.Bool("server", false, "启动 HTTP 服务器模式")
	inputFile := flag.String("i", "", "输入 JSON 文件（默认 stdin）")
	outputFile := flag.String("o", "", "输出 .xlsx 文件（默认 stdout）")
	mode := flag.String("mode", "customer", "导出模式：internal（内部留存版）| customer（客户版，默认）")
	lang := flag.String("lang", "zh", "语言：zh | en | bilingual")
	flag.Parse()

	if *serverMode {
		startServer()
		return
	}

	var data []byte
	var err error
	if *inputFile != "" {
		data, err = os.ReadFile(*inputFile)
		if err != nil {
			fmt.Fprintf(os.Stderr, "读取输入文件失败: %v\n", err)
			os.Exit(1)
		}
	} else {
		data, err = io.ReadAll(os.Stdin)
		if err != nil {
			fmt.Fprintf(os.Stderr, "读取标准输入失败: %v\n", err)
			os.Exit(1)
		}
	}

	var snap Snapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		fmt.Fprintf(os.Stderr, "JSON 解析失败: %v\n", err)
		os.Exit(1)
	}

	fixDefaults(&snap)

	f := excelize.NewFile()
	s := createStyles(f)

	if *mode == "internal" {
		writeInternal(f, &snap, *lang, s)
	} else {
		writeCustomer(f, &snap, *lang, s)
	}

	var buf io.Writer
	var outFile *os.File
	if *outputFile != "" {
		outFile, err = os.Create(*outputFile)
		if err != nil {
			fmt.Fprintf(os.Stderr, "创建输出文件失败: %v\n", err)
			os.Exit(1)
		}
		defer outFile.Close()
		buf = outFile
	} else {
		buf = os.Stdout
	}

	if _, err := f.WriteTo(buf); err != nil {
		fmt.Fprintf(os.Stderr, "写入 Excel 失败: %v\n", err)
		os.Exit(1)
	}

	var schemeLabels []string
	for _, s := range snap.Schemes {
		schemeLabels = append(schemeLabels, s)
	}
	fmt.Fprintf(os.Stderr, "✓ 已生成 %s 版报价单（%s）\n", *mode, strings.Join(schemeLabels, ", "))
}
