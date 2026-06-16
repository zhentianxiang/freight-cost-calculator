package quote

import (
	"math"
	"strconv"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"
)

func TestInternalExcelCargoUsdColumnsUseCost(t *testing.T) {
	snap := Snapshot{
		Inputs: Inputs{
			ProjectName:    "Test Project",
			ExchangeRate:   7,
			OutputCurrency: "USD",
			TargetProfit:   30,
		},
		Schemes: []string{"A"},
		Cargo: []CargoRow{
			{
				Name:      "Stone sculpture",
				Qty:       2,
				UnitPrice: 700,
				TaxRate:   10,
			},
		},
		Freight: []FreightRow{
			{Scheme: "A", Item: "Freight", Amount: 700, Included: true},
		},
	}

	f := excelize.NewFile()
	WriteExcel(f, &snap, "internal", "en")

	sheet := "Internal Master Summary"
	cargoRow := findTestRow(t, f, sheet, "Stone sculpture")
	costUnit, err := f.GetCellValue(sheet, "M"+strconv.Itoa(cargoRow))
	if err != nil {
		t.Fatal(err)
	}
	costTotal, err := f.GetCellValue(sheet, "N"+strconv.Itoa(cargoRow))
	if err != nil {
		t.Fatal(err)
	}
	if got, want := parseTestFloat(t, costUnit), 110.0; math.Abs(got-want) > 0.001 {
		t.Fatalf("cost unit USD = %v, want %v", got, want)
	}
	if got, want := parseTestFloat(t, costTotal), 220.0; math.Abs(got-want) > 0.001 {
		t.Fatalf("cost total USD = %v, want %v", got, want)
	}
}

func findTestRow(t *testing.T, f *excelize.File, sheet, firstCell string) int {
	t.Helper()
	rows, err := f.GetRows(sheet)
	if err != nil {
		t.Fatal(err)
	}
	for idx, row := range rows {
		if len(row) > 0 && row[0] == firstCell {
			return idx + 1
		}
	}
	t.Fatalf("row with first cell %q not found", firstCell)
	return 0
}

func parseTestFloat(t *testing.T, value string) float64 {
	t.Helper()
	value = strings.ReplaceAll(value, ",", "")
	got, err := strconv.ParseFloat(value, 64)
	if err != nil {
		t.Fatalf("parse %q: %v", value, err)
	}
	return got
}
