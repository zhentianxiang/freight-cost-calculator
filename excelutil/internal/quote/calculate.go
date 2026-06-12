package quote

func CalculateSchemes(snap *Snapshot) (float64, float64, []SummaryRow) {
	goodsCost := 0.0
	for _, c := range snap.Cargo {
		goodsCost += cargoTotal(c)
	}

	quoteRmb := snap.Inputs.QuoteUsd * snap.Inputs.ExchangeRate
	var summaries []SummaryRow

	for _, s := range snap.Schemes {
		freight := 0.0
		for _, f := range snap.Freight {
			if f.Scheme == s && f.Included {
				freight += f.Amount
			}
		}
		totalCost := goodsCost + freight
		targetPrice := totalCost * (1 + snap.Inputs.TargetProfit/100)
		profit := quoteRmb - totalCost
		margin := 0.0
		if quoteRmb > 0 {
			margin = (profit / quoteRmb) * 100
		}

		summaries = append(summaries, SummaryRow{
			Scheme:      s,
			Freight:     freight,
			TotalCost:   totalCost,
			TargetPrice: targetPrice,
			Profit:      profit,
			Margin:      margin,
		})
	}
	return goodsCost, quoteRmb, summaries
}

func bestScheme(summaries []SummaryRow) SummaryRow {
	if len(summaries) == 0 {
		return SummaryRow{}
	}
	best := summaries[0]
	for _, s := range summaries {
		if s.TotalCost < best.TotalCost {
			best = s
		}
	}
	return best
}

func totalCargoQty(cargo []CargoRow) float64 {
	total := 0.0
	for _, c := range cargo {
		total += c.Qty
	}
	return total
}

func cargoTax(c CargoRow) float64 {
	return c.UnitPrice * c.Qty * (c.TaxRate / 100)
}

func cargoTotal(c CargoRow) float64 {
	return (c.UnitPrice * c.Qty) + cargoTax(c)
}

func quoteUnitUsd(totalUsd, totalQty float64) float64 {
	if totalQty == 0 {
		return 0
	}
	return totalUsd / totalQty
}

func quoteLineUsd(c CargoRow, unitUsd float64) float64 {
	return c.Qty * unitUsd
}

func FixDefaults(snap *Snapshot) {
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
