package quote

import "strings"

func Calculate(snap *Snapshot) CalculationResult {
	FixDefaults(snap)
	goodsCost, schemes := CalculateSchemes(snap)
	selected := bestScheme(schemes)
	return CalculationResult{
		Inputs:    snap.Inputs,
		GoodsCost: goodsCost,
		Schemes:   schemes,
		Selected:  selected,
	}
}

func CalculateSchemes(snap *Snapshot) (float64, []SummaryRow) {
	goodsCost := 0.0
	for _, c := range snap.Cargo {
		goodsCost += cargoTotal(c)
	}

	var summaries []SummaryRow
	for _, s := range summarySchemeIDs(snap) {
		freight := 0.0
		hasQuotedCost := false
		for _, f := range snap.Freight {
			if f.Scheme == s && f.Included {
				freight += f.Amount
				if f.Amount > 0 {
					hasQuotedCost = true
				}
			}
		}
		importCosts := estimateImportCosts(snap.Inputs, goodsCost, freight)
		totalCost := goodsCost + freight + importCosts.IncludedTotal

		// 最终报价(RMB) = 总成本 / (1 - 目标利润率%)
		profitRate := snap.Inputs.TargetProfit
		divisor := 1 - profitRate/100
		quoteRmb := 0.0
		if divisor > 0.01 {
			quoteRmb = totalCost / divisor
		} else {
			quoteRmb = totalCost * (1 + profitRate/100)
		}
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
		markup := 0.0
		if totalCost > 0 {
			markup = (profit / totalCost) * 100
		}

		summaries = append(summaries, SummaryRow{
			Scheme:        s,
			Freight:       freight,
			ImportCosts:   importCosts,
			TotalCost:     totalCost,
			TargetPrice:   targetPrice,
			QuoteUsd:      quoteUsd,
			QuoteEur:      quoteEur,
			QuoteRmb:      quoteRmb,
			Profit:        profit,
			Margin:        margin,
			Markup:        markup,
			HasQuotedCost: hasQuotedCost,
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
	candidates := summaries
	var eligible []SummaryRow
	for _, s := range summaries {
		if s.HasQuotedCost {
			eligible = append(eligible, s)
		}
	}
	if len(eligible) > 0 {
		candidates = eligible
	}
	best := candidates[0]
	for _, s := range candidates {
		if s.TotalCost < best.TotalCost {
			best = s
			continue
		}
		if s.TotalCost == best.TotalCost && s.Profit > best.Profit {
			best = s
		}
	}
	return best
}

func summarySchemeIDs(snap *Snapshot) []string {
	seen := make(map[string]bool)
	var out []string
	for _, row := range snap.Freight {
		if !isMeaningfulFreightRow(row) || strings.TrimSpace(row.Scheme) == "" {
			continue
		}
		if !seen[row.Scheme] {
			seen[row.Scheme] = true
			out = append(out, row.Scheme)
		}
	}
	if len(out) > 0 {
		return out
	}
	for _, scheme := range snap.Schemes {
		if strings.TrimSpace(scheme) == "" || seen[scheme] {
			continue
		}
		seen[scheme] = true
		out = append(out, scheme)
	}
	if len(out) > 0 {
		return []string{out[0]}
	}
	return []string{"A"}
}

func isMeaningfulFreightRow(row FreightRow) bool {
	return strings.TrimSpace(row.Item) != "" || row.Amount > 0
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
