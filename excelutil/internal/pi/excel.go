package pi

import (
	"fmt"
	"math"
	"strings"

	"github.com/xuri/excelize/v2"
)

type styles struct {
	title   int
	section int
	label   int
	value   int
	header  int
	text    int
	money   int
	total   int
	note    int
}

func WriteExcel(f *excelize.File, inv *Invoice) {
	inv.FixDefaults()
	s := createStyles(f)
	sheet := "PI发票"
	f.SetSheetName("Sheet1", sheet)
	f.SetColWidth(sheet, "A", "A", 8)
	f.SetColWidth(sheet, "B", "B", 24)
	f.SetColWidth(sheet, "C", "D", 16)
	f.SetColWidth(sheet, "E", "E", 18)
	f.SetColWidth(sheet, "F", "G", 12)
	f.SetColWidth(sheet, "H", "I", 16)
	f.SetColWidth(sheet, "J", "J", 26)

	row := 1
	set(f, sheet, fmt.Sprintf("A%d", row), "PROFORMA INVOICE / 形式发票", s.title)
	mergeStyled(f, sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("J%d", row), s.title)
	f.SetRowHeight(sheet, row, 30)
	row += 2

	row = writeMeta(f, sheet, row, inv, s)
	row = writeParties(f, sheet, row, inv, s)
	row = writeItems(f, sheet, row, inv, s)
	row = writeShipment(f, sheet, row, inv, s)
	row = writeBank(f, sheet, row, inv, s)
	row = writeTerms(f, sheet, row, inv, s)
	writeSignatures(f, sheet, row, s)
}

func writeMeta(f *excelize.File, sheet string, row int, inv *Invoice, s styles) int {
	section(f, sheet, row, "Basic Information / 基础信息", s)
	row++
	fields := [][4]string{
		{"PI No.", inv.PINo, "Incoterms", incotermText(inv)},
		{"Issue Date", inv.IssueDate, "Payment Term", inv.PaymentTerm},
		{"Validity", inv.Validity, "Customer Ref.", inv.CustomerRef},
		{"Currency", inv.Currency, "Sales Contact", inv.SalesContact},
	}
	for _, item := range fields {
		set(f, sheet, fmt.Sprintf("A%d", row), item[0], s.label)
		set(f, sheet, fmt.Sprintf("B%d", row), item[1], s.value)
		mergeStyled(f, sheet, fmt.Sprintf("B%d", row), fmt.Sprintf("D%d", row), s.value)
		set(f, sheet, fmt.Sprintf("E%d", row), item[2], s.label)
		set(f, sheet, fmt.Sprintf("F%d", row), item[3], s.value)
		mergeStyled(f, sheet, fmt.Sprintf("F%d", row), fmt.Sprintf("J%d", row), s.value)
		row++
	}
	return row + 1
}

func writeParties(f *excelize.File, sheet string, row int, inv *Invoice, s styles) int {
	section(f, sheet, row, "Seller and Buyer / 卖方与买方", s)
	row++
	set(f, sheet, fmt.Sprintf("A%d", row), "SELLER / EXPORTER", s.header)
	mergeStyled(f, sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("E%d", row), s.header)
	set(f, sheet, fmt.Sprintf("F%d", row), "BUYER / IMPORTER", s.header)
	mergeStyled(f, sheet, fmt.Sprintf("F%d", row), fmt.Sprintf("J%d", row), s.header)
	row++
	seller := partyLines(inv.Seller, true)
	buyer := partyLines(inv.Buyer, false)
	height := max(len(seller), len(buyer))
	for i := 0; i < height; i++ {
		set(f, sheet, fmt.Sprintf("A%d", row), at(seller, i), s.text)
		mergeStyled(f, sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("E%d", row), s.text)
		set(f, sheet, fmt.Sprintf("F%d", row), at(buyer, i), s.text)
		mergeStyled(f, sheet, fmt.Sprintf("F%d", row), fmt.Sprintf("J%d", row), s.text)
		row++
	}
	return row + 1
}

func writeItems(f *excelize.File, sheet string, row int, inv *Invoice, s styles) int {
	section(f, sheet, row, "Product Description and Commercial Value / 产品描述与商业金额", s)
	row++
	currency := strings.TrimSpace(inv.Currency)
	if currency == "" {
		currency = "USD"
	}
	headers := []string{"No.", "Product / Model", "Material", "Finish", "Size", "Qty", "Unit", fmt.Sprintf("Unit Price (%s)", currency), fmt.Sprintf("Amount (%s)", currency), "Remarks"}
	for i, h := range headers {
		set(f, sheet, cell(i+1, row), h, s.header)
	}
	row++

	total := 0.0
	for idx, item := range inv.Items {
		amount := round2(item.Qty * item.UnitPrice)
		total += amount
		values := []any{idx + 1, item.Product, item.Material, item.Finish, item.Size, item.Qty, item.Unit, item.UnitPrice, amount, item.Remarks}
		for i, v := range values {
			style := s.text
			if i == 7 || i == 8 {
				style = s.money
			}
			set(f, sheet, cell(i+1, row), v, style)
		}
		row++
	}
	set(f, sheet, fmt.Sprintf("A%d", row), "Total Amount / 总金额", s.total)
	mergeStyled(f, sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("H%d", row), s.total)
	set(f, sheet, fmt.Sprintf("I%d", row), total, s.total)
	set(f, sheet, fmt.Sprintf("J%d", row), inv.Currency, s.total)
	return row + 2
}

func writeShipment(f *excelize.File, sheet string, row int, inv *Invoice, s styles) int {
	section(f, sheet, row, "Shipment and Packing / 运输与包装", s)
	row++
	fields := [][2]string{
		{"Port of Loading / 起运港", inv.LoadingPort},
		{"Destination / 目的地", inv.Destination},
		{"Shipment / 运输方式", inv.Shipment},
		{"Delivery Time / 交期", inv.DeliveryTime},
		{"Packing / 包装", inv.Packing},
	}
	for _, item := range fields {
		set(f, sheet, fmt.Sprintf("A%d", row), item[0], s.label)
		mergeStyled(f, sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("C%d", row), s.label)
		set(f, sheet, fmt.Sprintf("D%d", row), item[1], s.value)
		mergeStyled(f, sheet, fmt.Sprintf("D%d", row), fmt.Sprintf("J%d", row), s.value)
		row++
	}
	return row + 1
}

func writeBank(f *excelize.File, sheet string, row int, inv *Invoice, s styles) int {
	section(f, sheet, row, "Beneficiary Bank Details / 收款银行信息", s)
	row++
	fields := [][2]string{
		{"Beneficiary / 收款人", inv.Bank.Beneficiary},
		{"Beneficiary Address / 收款人地址", inv.Bank.BeneficiaryAddr},
		{"Bank Name / 开户银行", inv.Bank.BankName},
		{"Bank Address / 银行地址", inv.Bank.BankAddress},
		{"Account No. / 账号", inv.Bank.AccountNo},
		{"SWIFT / BIC", inv.Bank.Swift},
		{"Bank Code / Routing / IBAN", inv.Bank.BankCode},
		{"Payment Reference / 付款备注", inv.Bank.PaymentReference},
		{"Bank Charges / 银行手续费", inv.Bank.BankCharges},
	}
	for _, item := range fields {
		set(f, sheet, fmt.Sprintf("A%d", row), item[0], s.label)
		mergeStyled(f, sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("C%d", row), s.label)
		set(f, sheet, fmt.Sprintf("D%d", row), item[1], s.value)
		mergeStyled(f, sheet, fmt.Sprintf("D%d", row), fmt.Sprintf("J%d", row), s.value)
		row++
	}
	return row + 1
}

func writeTerms(f *excelize.File, sheet string, row int, inv *Invoice, s styles) int {
	section(f, sheet, row, "Terms and Notes / 条款与备注", s)
	row++
	set(f, sheet, fmt.Sprintf("A%d", row), inv.Terms, s.note)
	mergeStyled(f, sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("J%d", row), s.note)
	f.SetRowHeight(sheet, row, 120)
	row++
	if strings.TrimSpace(inv.Notes) != "" {
		set(f, sheet, fmt.Sprintf("A%d", row), inv.Notes, s.note)
		mergeStyled(f, sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("J%d", row), s.note)
		f.SetRowHeight(sheet, row, 56)
		row++
	}
	return row + 1
}

func writeSignatures(f *excelize.File, sheet string, row int, s styles) {
	section(f, sheet, row, "Buyer Acceptance / 买方确认", s)
	row++
	set(f, sheet, fmt.Sprintf("A%d", row), "For Seller / Exporter\n卖方/出口商", s.header)
	mergeStyled(f, sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("E%d", row), s.header)
	set(f, sheet, fmt.Sprintf("F%d", row), "For Buyer / Importer\n买方/进口商", s.header)
	mergeStyled(f, sheet, fmt.Sprintf("F%d", row), fmt.Sprintf("J%d", row), s.header)
	row++
	for _, label := range []string{"Authorized Signature / 授权签字", "Name / Title / 姓名职务", "Company Seal / 公司盖章", "Date / 日期"} {
		set(f, sheet, fmt.Sprintf("A%d", row), label, s.value)
		mergeStyled(f, sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("E%d", row), s.value)
		set(f, sheet, fmt.Sprintf("F%d", row), label, s.value)
		mergeStyled(f, sheet, fmt.Sprintf("F%d", row), fmt.Sprintf("J%d", row), s.value)
		row++
	}
}

func createStyles(f *excelize.File) styles {
	const defaultFontSize = 14
	border := []excelize.Border{
		{Type: "left", Color: "B8C2CC", Style: 1},
		{Type: "right", Color: "B8C2CC", Style: 1},
		{Type: "top", Color: "B8C2CC", Style: 1},
		{Type: "bottom", Color: "B8C2CC", Style: 1},
	}
	title, _ := f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Size: 18, Color: "FFFFFF"},
		Fill:      excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"175F78"}},
		Alignment: &excelize.Alignment{Horizontal: "center", Vertical: "center"},
		Border:    border,
	})
	section, _ := f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Size: defaultFontSize, Color: "17324A"},
		Fill:      excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"E7F3F6"}},
		Alignment: &excelize.Alignment{Vertical: "center"},
		Border:    border,
	})
	label, _ := f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Size: defaultFontSize, Color: "17212B"},
		Fill:      excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"F2F4F7"}},
		Alignment: &excelize.Alignment{Vertical: "center", WrapText: true},
		Border:    border,
	})
	value, _ := f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Size: defaultFontSize, Color: "17212B"},
		Alignment: &excelize.Alignment{Vertical: "center", WrapText: true},
		Border:    border,
	})
	header, _ := f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Size: defaultFontSize, Color: "17212B"},
		Fill:      excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"DCE8EF"}},
		Alignment: &excelize.Alignment{Horizontal: "center", Vertical: "center", WrapText: true},
		Border:    border,
	})
	text, _ := f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Size: defaultFontSize, Color: "17212B"},
		Alignment: &excelize.Alignment{Vertical: "center", WrapText: true},
		Border:    border,
	})
	money, _ := f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Size: defaultFontSize, Color: "17212B"},
		Alignment: &excelize.Alignment{Horizontal: "right", Vertical: "center"},
		Border:    border,
		NumFmt:    4,
	})
	total, _ := f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Size: defaultFontSize, Color: "17212B"},
		Fill:      excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"FFF4D8"}},
		Alignment: &excelize.Alignment{Horizontal: "right", Vertical: "center"},
		Border:    border,
		NumFmt:    4,
	})
	note, _ := f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Size: defaultFontSize, Color: "334155"},
		Alignment: &excelize.Alignment{Vertical: "top", WrapText: true},
		Border:    border,
	})
	return styles{title: title, section: section, label: label, value: value, header: header, text: text, money: money, total: total, note: note}
}

func section(f *excelize.File, sheet string, row int, title string, s styles) {
	set(f, sheet, fmt.Sprintf("A%d", row), title, s.section)
	mergeStyled(f, sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("J%d", row), s.section)
}

func set(f *excelize.File, sheet, cell string, value any, style int) {
	f.SetCellValue(sheet, cell, value)
	if style >= 0 {
		f.SetCellStyle(sheet, cell, cell, style)
	}
}

func mergeStyled(f *excelize.File, sheet, start, end string, style int) {
	f.MergeCell(sheet, start, end)
	if style >= 0 {
		f.SetCellStyle(sheet, start, end, style)
	}
}

func incotermText(inv *Invoice) string {
	parts := []string{inv.Incoterms}
	if inv.Destination != "" {
		parts = append(parts, inv.Destination)
	}
	parts = append(parts, "Incoterms 2020")
	return strings.Join(parts, " ")
}

func partyLines(p Party, seller bool) []string {
	lines := []string{p.Company, p.Address}
	if p.Contact != "" {
		lines = append(lines, "Contact: "+p.Contact)
	}
	contact := strings.Trim(strings.Join([]string{nonEmpty("Tel: ", p.Tel), nonEmpty("Email: ", p.Email)}, " | "), " |")
	if contact != "" {
		lines = append(lines, contact)
	}
	if seller {
		lines = append(lines, nonEmpty("Business License No.: ", p.LicenseNo), nonEmpty("Customs Code: ", p.CustomsCode))
	} else {
		lines = append(lines, nonEmpty("VAT / Importer No.: ", p.TaxNo))
	}
	return compact(lines)
}

func nonEmpty(prefix, value string) string {
	if value == "" {
		return ""
	}
	return prefix + value
}

func compact(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			out = append(out, value)
		}
	}
	return out
}

func at(values []string, index int) string {
	if index >= len(values) {
		return ""
	}
	return values[index]
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func cell(col, row int) string {
	name, _ := excelize.ColumnNumberToName(col)
	return fmt.Sprintf("%s%d", name, row)
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}
