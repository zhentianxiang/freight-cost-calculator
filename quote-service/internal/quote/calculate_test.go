package quote

import (
	"math"
	"testing"
)

func TestPortChargesAreIncludedInTotalCost(t *testing.T) {
	snap := Snapshot{
		Inputs: Inputs{
			ExchangeRate:    7,
			EurExchangeRate: 8,
			OutputCurrency:  "USD",
			TargetProfit:    20,
		},
		Schemes: []string{"A"},
		Cargo: []CargoRow{
			{Length: 200, Width: 100, Height: 100, Weight: 500, Qty: 2, UnitPrice: 1000},
		},
		Freight: []FreightRow{
			{Scheme: "A", Item: "Freight", Amount: 100, Included: true},
		},
		PortCharges: []PortChargeRow{
			{Side: "origin", Item: "Origin RT", Currency: "USD", Unit: "rt", Rate: 10, Included: true},
			{Side: "destination", Item: "Destination min", Currency: "EUR", Unit: "ton", Rate: 1, Min: 5, Included: true},
		},
	}

	result := Calculate(&snap)
	if got, want := result.CargoStats.VolumeCBM, 4.0; math.Abs(got-want) > 0.001 {
		t.Fatalf("volume = %v, want %v", got, want)
	}
	if got, want := result.CargoStats.WeightTon, 1.0; math.Abs(got-want) > 0.001 {
		t.Fatalf("weight ton = %v, want %v", got, want)
	}
	if got, want := result.CargoStats.RT, 4.0; math.Abs(got-want) > 0.001 {
		t.Fatalf("rt = %v, want %v", got, want)
	}
	if got, want := result.PortCharges.TotalRMB, 320.0; math.Abs(got-want) > 0.001 {
		t.Fatalf("port total = %v, want %v", got, want)
	}
	if got, want := result.Selected.TotalCost, 2420.0; math.Abs(got-want) > 0.001 {
		t.Fatalf("total cost = %v, want %v", got, want)
	}
}
