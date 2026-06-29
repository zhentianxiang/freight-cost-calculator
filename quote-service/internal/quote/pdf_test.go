package quote

import (
	"bytes"
	"testing"
)

func TestBuildPDFProducesPDFBytes(t *testing.T) {
	snap := Snapshot{
		Inputs: Inputs{
			ProjectName:     "测试报价",
			TradeTerm:       "CFR",
			Destination:     "Barcelona",
			OutputCurrency:  "USD",
			ExchangeRate:    7.2,
			EurExchangeRate: 7.8,
			TargetProfit:    20,
		},
		Cargo: []CargoRow{{Name: "大理石雕塑", Spec: "100 x 50 x 80 cm", Qty: 1, UnitPrice: 1000}},
	}

	data := BuildPDF(&snap, "customer", "zh")
	if !bytes.HasPrefix(data, []byte("%PDF-")) {
		t.Fatalf("expected PDF header, got %q", data[:min(len(data), 8)])
	}
	if !bytes.Contains(data, []byte("%%EOF")) {
		t.Fatal("expected EOF marker")
	}
}
