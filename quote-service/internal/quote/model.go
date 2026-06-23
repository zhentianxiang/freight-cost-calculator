package quote

type Inputs struct {
	CompanyName          string  `json:"companyName"`
	ProjectName          string  `json:"projectName"`
	TradeTerm            string  `json:"tradeTerm"`
	ContainerType        string  `json:"containerType"`
	Destination          string  `json:"destination"`
	DestinationCountry   string  `json:"destinationCountry"`
	HSCode               string  `json:"hsCode"`
	ValidUntil           string  `json:"validUntil"`
	ExchangeRate         float64 `json:"exchangeRate"`
	EurExchangeRate      float64 `json:"eurExchangeRate"`
	OutputCurrency       string  `json:"outputCurrency"`
	DutyRate             float64 `json:"dutyRate"`
	ImportVatRate        float64 `json:"importVatRate"`
	DestinationDelivery  float64 `json:"destinationDelivery"`
	DestinationClearance float64 `json:"destinationClearance"`
	DestinationOther     float64 `json:"destinationOther"`
	TargetProfit         float64 `json:"targetProfit"`
	SelectedScheme       string  `json:"selectedScheme"`
	Notes                string  `json:"notes"`
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
	ImageName string  `json:"imageName"`
	ImageData string  `json:"imageData"`
	ImageURL  string  `json:"imageUrl"`
}

type FreightRow struct {
	Scheme   string  `json:"scheme"`
	Item     string  `json:"item"`
	Amount   float64 `json:"amount"`
	Included bool    `json:"included"`
}

type PortChargeRow struct {
	Side     string  `json:"side"`
	Item     string  `json:"item"`
	Currency string  `json:"currency"`
	Unit     string  `json:"unit"`
	Rate     float64 `json:"rate"`
	Min      float64 `json:"min"`
	Included bool    `json:"included"`
}

type Snapshot struct {
	ID          string          `json:"id"`
	Label       string          `json:"label"`
	UpdatedAt   string          `json:"updatedAt"`
	Inputs      Inputs          `json:"inputs"`
	Schemes     []string        `json:"schemes"`
	Cargo       []CargoRow      `json:"cargo"`
	Freight     []FreightRow    `json:"freight"`
	PortCharges []PortChargeRow `json:"portCharges"`
}

type SummaryRow struct {
	Scheme        string      `json:"scheme"`
	Freight       float64     `json:"freight"`
	PortCharges   float64     `json:"portCharges"`
	ImportCosts   ImportCosts `json:"importCosts"`
	TotalCost     float64     `json:"totalCost"`
	TargetPrice   float64     `json:"targetPrice"`
	QuoteUsd      float64     `json:"quoteUsd"`
	QuoteEur      float64     `json:"quoteEur"`
	QuoteRmb      float64     `json:"quoteRmb"`
	Profit        float64     `json:"profit"`
	Margin        float64     `json:"margin"`
	Markup        float64     `json:"markup"`
	HasQuotedCost bool        `json:"hasQuotedCost"`
}

type ImportCosts struct {
	CustomsValue     float64 `json:"customsValue"`
	Duty             float64 `json:"duty"`
	ImportTax        float64 `json:"importTax"`
	DestinationLocal float64 `json:"destinationLocal"`
	Clearance        float64 `json:"clearance"`
	IncludedTotal    float64 `json:"includedTotal"`
	IncludeDelivery  bool    `json:"includeDelivery"`
	IncludeImport    bool    `json:"includeImport"`
}

type CalculationResult struct {
	Inputs      Inputs       `json:"inputs"`
	GoodsCost   float64      `json:"goodsCost"`
	CargoStats  CargoStats   `json:"cargoStats"`
	PortCharges PortTotals   `json:"portCharges"`
	Schemes     []SummaryRow `json:"schemes"`
	Selected    SummaryRow   `json:"selected"`
}

type CargoStats struct {
	VolumeCBM float64 `json:"volumeCbm"`
	WeightKG  float64 `json:"weightKg"`
	WeightTon float64 `json:"weightTon"`
	RT        float64 `json:"rt"`
	Qty       float64 `json:"qty"`
}

type PortTotals struct {
	OriginRMB      float64               `json:"originRmb"`
	DestinationRMB float64               `json:"destinationRmb"`
	TotalRMB       float64               `json:"totalRmb"`
	Rows           []PortChargeResultRow `json:"rows"`
}

type PortChargeResultRow struct {
	Side         string  `json:"side"`
	Item         string  `json:"item"`
	Currency     string  `json:"currency"`
	Unit         string  `json:"unit"`
	Rate         float64 `json:"rate"`
	Min          float64 `json:"min"`
	Base         float64 `json:"base"`
	Amount       float64 `json:"amount"`
	AmountRMB    float64 `json:"amountRmb"`
	ExchangeRate float64 `json:"exchangeRate"`
	Included     bool    `json:"included"`
}

type Styles struct {
	TitleStyle         int
	HeaderStyle        int
	SubHeaderStyle     int
	DataStyle          int
	AltDataStyle       int
	MoneyStyle         int
	AltMoneyStyle      int
	HighlightStyle     int
	BoldStyle          int
	NoteStyle          int
	SectionTitleStyle  int
	TotalStyle         int
	TotalMoneyStyle    int
	SmallNoteStyle     int
	CustomerTitleStyle int
	CustomerLabelStyle int
	CustomerValueStyle int
}
