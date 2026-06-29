package quote

import (
	"bytes"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf16"
)

const (
	pdfPageWidth  = 595.0
	pdfPageHeight = 842.0
	pdfLeft       = 42.0
	pdfTop        = 800.0
	pdfLine       = 16.0
)

type pdfDoc struct {
	pages   []string
	current strings.Builder
	y       float64
}

func BuildPDF(snap *Snapshot, mode, lang string) []byte {
	result := Calculate(snap)
	selected := result.Selected
	if selected.Scheme == "" && len(result.Schemes) > 0 {
		selected = result.Schemes[0]
	}
	doc := &pdfDoc{}
	doc.newPage()

	inputs := snap.Inputs
	title := quoteTitle(inputs.ProjectName, lang, mode != "customer")
	doc.text(title, 18)
	doc.skip(6)
	doc.text(tx(lang, "基础信息", "Basic Information"), 13)
	doc.text(fmt.Sprintf("%s: %s", tx(lang, "我方公司", "Company"), blank(inputs.CompanyName)), 10)
	doc.text(fmt.Sprintf("%s: %s", tx(lang, "项目/客户", "Project"), blank(inputs.ProjectName)), 10)
	doc.text(fmt.Sprintf("%s: %s %s", tx(lang, "贸易术语", "Trade Term"), blank(inputs.TradeTerm), blank(inputs.Destination)), 10)
	doc.text(fmt.Sprintf("%s: %s", tx(lang, "报价有效期", "Valid Until"), blank(inputs.ValidUntil)), 10)
	doc.text(fmt.Sprintf("%s: %s", tx(lang, "报价币种", "Currency"), blank(inputs.OutputCurrency)), 10)
	doc.text(fmt.Sprintf("%s: %s", tx(lang, "报价金额", "Quotation Amount"), formatCurrency(quoteValue(selected, inputs.OutputCurrency), inputs.OutputCurrency)), 12)
	doc.skip(6)

	doc.text(tx(lang, "货物明细", "Cargo Details"), 13)
	if len(snap.Cargo) == 0 {
		doc.text(tx(lang, "暂无货物", "No cargo"), 10)
	} else {
		if mode == "customer" {
			doc.text(tx(lang, "货物 | 规格 | 数量 | 客户金额", "Product | Spec | Qty | Amount"), 9)
			for _, row := range snap.Cargo {
				qty := row.Qty
				lineTotal := customerCargoLine(row, selected, result.GoodsCost, inputs)
				doc.text(fmt.Sprintf("%s | %s | %s | %s",
					shortText(row.Name, 28), shortText(row.Spec, 26), compactNumber(qty), formatCurrency(lineTotal, inputs.OutputCurrency)), 9)
			}
		} else {
			doc.text(tx(lang, "货物 | 规格 | 数量 | 成本合计 | 客户金额", "Product | Spec | Qty | Cost Total | Amount"), 9)
			for _, row := range snap.Cargo {
				lineTotal := customerCargoLine(row, selected, result.GoodsCost, inputs)
				doc.text(fmt.Sprintf("%s | %s | %s | RMB %s | %s",
					shortText(row.Name, 24), shortText(row.Spec, 22), compactNumber(row.Qty), fmtMoney(cargoTotal(row)), formatCurrency(lineTotal, inputs.OutputCurrency)), 9)
			}
		}
	}
	doc.skip(6)

	if mode != "customer" {
		doc.text(tx(lang, "成本构成", "Cost Breakdown"), 13)
		doc.text(fmt.Sprintf("%s: RMB %s", tx(lang, "货物成本", "Goods Cost"), fmtMoney(result.GoodsCost)), 10)
		doc.text(fmt.Sprintf("%s: RMB %s", tx(lang, "其他费用", "Other Costs"), fmtMoney(selected.Freight)), 10)
		doc.text(fmt.Sprintf("%s: RMB %s", tx(lang, "出发港费用", "Origin Port Charges"), fmtMoney(selected.PortCharges)), 10)
		doc.text(fmt.Sprintf("%s: RMB %s", tx(lang, "总成本", "Total Cost"), fmtMoney(selected.TotalCost)), 10)
		doc.text(fmt.Sprintf("%s: RMB %s", tx(lang, "净利润", "Profit"), fmtMoney(selected.Profit)), 10)
		doc.text(fmt.Sprintf("%s: %s", tx(lang, "净利率", "Margin"), fmtPct(selected.Margin)), 10)
		doc.skip(6)

		doc.text(tx(lang, "其他费用明细", "Other Cost Details"), 13)
		if len(snap.Freight) == 0 {
			doc.text(tx(lang, "暂无其他费用", "No other costs"), 10)
		} else {
			for _, row := range snap.Freight {
				doc.text(fmt.Sprintf("%s | RMB %s | %s", shortText(row.Item, 42), fmtMoney(row.Amount), yesNo(row.Included, lang)), 9)
			}
		}
		doc.skip(6)
	}

	doc.text(tx(lang, "报价说明", "Notes"), 13)
	for _, line := range wrapText(getCustomerTermText(inputs.TradeTerm, inputs.Destination, lang), 72) {
		doc.text(line, 9)
	}
	for _, line := range wrapText(getExclusionText(inputs.TradeTerm, lang), 72) {
		doc.text(line, 9)
	}
	if strings.TrimSpace(inputs.Notes) != "" && !isDefaultExclusionNote(inputs.Notes) {
		for _, line := range wrapText(inputs.Notes, 72) {
			doc.text(line, 9)
		}
	}
	doc.skip(6)
	doc.text(tx(lang, "报价仅供沟通确认，最终以双方确认文件为准。", "Quotation is for confirmation and subject to final agreed documents."), 8)
	doc.finishPage()
	return doc.bytes()
}

func (d *pdfDoc) newPage() {
	d.current.Reset()
	d.y = pdfTop
}

func (d *pdfDoc) finishPage() {
	if d.current.Len() == 0 {
		return
	}
	d.pages = append(d.pages, d.current.String())
	d.current.Reset()
}

func (d *pdfDoc) ensure(lines float64) {
	if d.y-(lines*pdfLine) < 42 {
		d.finishPage()
		d.newPage()
	}
}

func (d *pdfDoc) skip(points float64) {
	d.y -= points
}

func (d *pdfDoc) text(value string, size float64) {
	for _, line := range strings.Split(value, "\n") {
		d.ensure(1)
		fmt.Fprintf(&d.current, "BT /F1 %.1f Tf 1 0 0 1 %.1f %.1f Tm <%s> Tj ET\n",
			size, pdfLeft, d.y, pdfHex(line))
		d.y -= pdfLine
	}
}

func (d *pdfDoc) bytes() []byte {
	var objects []string
	objects = append(objects, "<< /Type /Catalog /Pages 2 0 R >>")
	pageKids := make([]string, 0, len(d.pages))
	firstPageObj := 6
	for idx, content := range d.pages {
		pageObj := firstPageObj + idx*2
		contentObj := pageObj + 1
		pageKids = append(pageKids, fmt.Sprintf("%d 0 R", pageObj))
		objects = append(objects, fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.0f %.0f] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>", pdfPageWidth, pdfPageHeight, contentObj))
		objects = append(objects, streamObject(content))
	}
	objects = append([]string{
		objects[0],
		fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(pageKids, " "), len(d.pages)),
		"<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [4 0 R] >>",
		"<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> /FontDescriptor 5 0 R /DW 1000 >>",
		"<< /Type /FontDescriptor /FontName /STSong-Light /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>",
	}, objects[1:]...)

	var out bytes.Buffer
	out.WriteString("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
	offsets := make([]int, len(objects)+1)
	for idx, obj := range objects {
		offsets[idx+1] = out.Len()
		fmt.Fprintf(&out, "%d 0 obj\n%s\nendobj\n", idx+1, obj)
	}
	xref := out.Len()
	fmt.Fprintf(&out, "xref\n0 %d\n0000000000 65535 f \n", len(objects)+1)
	for idx := 1; idx <= len(objects); idx++ {
		fmt.Fprintf(&out, "%010d 00000 n \n", offsets[idx])
	}
	fmt.Fprintf(&out, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objects)+1, xref)
	return out.Bytes()
}

func streamObject(content string) string {
	return fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len([]byte(content)), content)
}

func pdfHex(value string) string {
	encoded := utf16.Encode([]rune(value))
	var b strings.Builder
	for _, r := range encoded {
		fmt.Fprintf(&b, "%04X", r)
	}
	return b.String()
}

func blank(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "-"
	}
	return value
}

func shortText(value string, limit int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= limit {
		return string(runes)
	}
	if limit <= 1 {
		return string(runes[:limit])
	}
	return string(runes[:limit-1]) + "..."
}

func compactNumber(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}

func wrapText(value string, limit int) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	runes := []rune(value)
	var lines []string
	for len(runes) > limit {
		lines = append(lines, string(runes[:limit]))
		runes = runes[limit:]
	}
	lines = append(lines, string(runes))
	return lines
}
