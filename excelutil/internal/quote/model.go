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
}

type FreightRow struct {
	Scheme   string  `json:"scheme"`
	Item     string  `json:"item"`
	Amount   float64 `json:"amount"`
	Included bool    `json:"included"`
}

type Snapshot struct {
	ID        string       `json:"id"`
	Label     string       `json:"label"`
	UpdatedAt string       `json:"updatedAt"`
	Inputs    Inputs       `json:"inputs"`
	Schemes   []string     `json:"schemes"`
	Cargo     []CargoRow   `json:"cargo"`
	Freight   []FreightRow `json:"freight"`
}

type SummaryRow struct {
	Scheme      string
	Freight     float64
	ImportCosts ImportCosts
	TotalCost   float64
	TargetPrice float64
	QuoteUsd    float64
	QuoteEur    float64
	QuoteRmb    float64
	Profit      float64
	Margin      float64
}

type ImportCosts struct {
	CustomsValue     float64
	Duty             float64
	ImportTax        float64
	DestinationLocal float64
	Clearance        float64
	IncludedTotal    float64
	IncludeDelivery  bool
	IncludeImport    bool
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
