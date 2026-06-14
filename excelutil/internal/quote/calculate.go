package quote

func CalculateSchemes(snap *Snapshot) (float64, []SummaryRow) {
	goodsCost := 0.0
	for _, c := range snap.Cargo {
		goodsCost += cargoTotal(c)
	}

	var summaries []SummaryRow
	for _, s := range snap.Schemes {
		freight := 0.0
		for _, f := range snap.Freight {
			if f.Scheme == s && f.Included {
				freight += f.Amount
			}
		}
		importCosts := estimateImportCosts(snap.Inputs, goodsCost, freight)
		totalCost := goodsCost + freight + importCosts.IncludedTotal

		// 最终报价(RMB) = 总成本 / (1 - 目标利润率%)
		quoteRmb := totalCost / (1 - snap.Inputs.TargetProfit/100)
		quoteUsd := 0.0
		if snap.Inputs.ExchangeRate > 0 {
			quoteUsd = quoteRmb / snap.Inputs.ExchangeRate
		}
		quoteEur := 0.0
		if snap.Inputs.EurExchangeRate > 0 {
			quoteEur = quoteRmb / snap.Inputs.EurExchangeRate
		}

		targetPrice := quoteRmb
		profit := quoteRmb - totalCost
		margin := 0.0
		if quoteRmb > 0 {
			margin = (profit / quoteRmb) * 100
		}

		summaries = append(summaries, SummaryRow{
			Scheme:      s,
			Freight:     freight,
			ImportCosts: importCosts,
			TotalCost:   totalCost,
			TargetPrice: targetPrice,
			QuoteUsd:    quoteUsd,
			QuoteEur:    quoteEur,
			QuoteRmb:    quoteRmb,
			Profit:      profit,
			Margin:      margin,
		})
	}
	return goodsCost, summaries
}

func estimateImportCosts(inputs Inputs, goodsCost, freight float64) ImportCosts {
	customsValue := goodsCost + freight
	duty := customsValue * inputs.DutyRate / 100
	importTax := (customsValue + duty) * inputs.ImportVatRate / 100
	destinationLocal := inputs.DestinationDelivery + inputs.DestinationOther
	clearance := inputs.DestinationClearance
	includeDelivery := inputs.TradeTerm == "DAP" || inputs.TradeTerm == "DDP"
	includeImport := inputs.TradeTerm == "DDP"
	includedTotal := 0.0
	if includeDelivery {
		includedTotal += destinationLocal
	}
	if includeImport {
		includedTotal += clearance + duty + importTax
	}
	return ImportCosts{
		CustomsValue:     customsValue,
		Duty:             duty,
		ImportTax:        importTax,
		DestinationLocal: destinationLocal,
		Clearance:        clearance,
		IncludedTotal:    includedTotal,
		IncludeDelivery:  includeDelivery,
		IncludeImport:    includeImport,
	}
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
	if snap.Inputs.OutputCurrency == "" {
		snap.Inputs.OutputCurrency = "USD"
	}
	if snap.Inputs.EurExchangeRate == 0 {
		snap.Inputs.EurExchangeRate = 7.8
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
