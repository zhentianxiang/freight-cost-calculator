package quote

import "strings"

func Calculate(snap *Snapshot) CalculationResult {
	FixDefaults(snap)
	goodsCost, schemes := CalculateSchemes(snap)
	selected := bestScheme(schemes)
	stats := CargoStatsFor(snap.Cargo)
	portTotals := CalculatePortCharges(snap)
	return CalculationResult{
		Inputs:      snap.Inputs,
		GoodsCost:   goodsCost,
		CargoStats:  stats,
		PortCharges: portTotals,
		Schemes:     schemes,
		Selected:    selected,
	}
}

func CalculateSchemes(snap *Snapshot) (float64, []SummaryRow) {
	goodsCost := 0.0
	for _, c := range snap.Cargo {
		goodsCost += cargoTotal(c)
	}
	portTotals := CalculatePortCharges(snap)

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
		totalCost := goodsCost + freight + portTotals.TotalRMB + importCosts.IncludedTotal

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
			PortCharges:   portTotals.TotalRMB,
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

func CargoStatsFor(cargo []CargoRow) CargoStats {
	stats := CargoStats{}
	for _, c := range cargo {
		qty := c.Qty
		stats.Qty += qty
		if c.Length > 0 && c.Height > 0 && c.Width > 0 && qty > 0 {
			stats.VolumeCBM += c.Length * c.Height * c.Width / 1000000 * qty
		}
		if c.Weight > 0 && qty > 0 {
			stats.WeightKG += c.Weight * qty
		}
	}
	stats.WeightTon = stats.WeightKG / 1000
	stats.RT = stats.VolumeCBM
	if stats.WeightTon > stats.RT {
		stats.RT = stats.WeightTon
	}
	return stats
}

func CalculatePortCharges(snap *Snapshot) PortTotals {
	stats := CargoStatsFor(snap.Cargo)
	totals := PortTotals{}
	for _, row := range snap.PortCharges {
		if !row.Included || row.Rate == 0 {
			continue
		}
		result := calculatePortChargeRow(row, snap.Inputs, stats)
		totals.Rows = append(totals.Rows, result)
		if result.Side == "destination" {
			totals.DestinationRMB += result.AmountRMB
		} else {
			totals.OriginRMB += result.AmountRMB
		}
		totals.TotalRMB += result.AmountRMB
	}
	return totals
}

func calculatePortChargeRow(row PortChargeRow, inputs Inputs, stats CargoStats) PortChargeResultRow {
	unit := strings.ToLower(strings.TrimSpace(row.Unit))
	base := 1.0
	switch unit {
	case "rt":
		base = stats.RT
	case "ton":
		base = stats.WeightTon
	case "cbm":
		base = stats.VolumeCBM
	case "hbl", "票", "fixed", "":
		base = 1
	default:
		base = 1
	}
	amount := row.Rate * base
	if row.Min != 0 && amount < row.Min {
		amount = row.Min
	}
	rate := portExchangeRate(row.Currency, inputs)
	return PortChargeResultRow{
		Side:         normalizePortSide(row.Side),
		Item:         row.Item,
		Currency:     normalizeCurrency(row.Currency),
		Unit:         unit,
		Rate:         row.Rate,
		Min:          row.Min,
		Base:         base,
		Amount:       amount,
		AmountRMB:    amount * rate,
		ExchangeRate: rate,
		Included:     row.Included,
	}
}

func normalizePortSide(side string) string {
	side = strings.ToLower(strings.TrimSpace(side))
	if side == "destination" || side == "目的港" {
		return "destination"
	}
	return "origin"
}

func normalizeCurrency(currency string) string {
	currency = strings.ToUpper(strings.TrimSpace(currency))
	if currency == "USD" || currency == "EUR" {
		return currency
	}
	return "RMB"
}

func portExchangeRate(currency string, inputs Inputs) float64 {
	switch normalizeCurrency(currency) {
	case "USD":
		if inputs.ExchangeRate > 0 {
			return inputs.ExchangeRate
		}
	case "EUR":
		if inputs.EurExchangeRate > 0 {
			return inputs.EurExchangeRate
		}
	}
	return 1
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

func cargoCostUnitUsd(c CargoRow, inputs Inputs) float64 {
	if c.Qty == 0 {
		return 0
	}
	return cargoCostLineUsd(c, inputs) / c.Qty
}

func cargoCostLineUsd(c CargoRow, inputs Inputs) float64 {
	if inputs.ExchangeRate == 0 {
		return 0
	}
	return cargoTotal(c) / inputs.ExchangeRate
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
