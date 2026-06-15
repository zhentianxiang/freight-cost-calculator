package pi

type Invoice struct {
	PINo         string      `json:"piNo"`
	IssueDate    string      `json:"issueDate"`
	Incoterms    string      `json:"incoterms"`
	PaymentTerm  string      `json:"paymentTerm"`
	Validity     string      `json:"validity"`
	CustomerRef  string      `json:"customerRef"`
	Currency     string      `json:"currency"`
	SalesContact string      `json:"salesContact"`
	LoadingPort  string      `json:"loadingPort"`
	Destination  string      `json:"destination"`
	Shipment     string      `json:"shipment"`
	DeliveryTime string      `json:"deliveryTime"`
	Packing      string      `json:"packing"`
	Seller       Party       `json:"seller"`
	Buyer        Party       `json:"buyer"`
	Items        []Item      `json:"items"`
	Bank         BankDetails `json:"bank"`
	Terms        string      `json:"terms"`
	Notes        string      `json:"notes"`
}

type Party struct {
	Company     string `json:"company"`
	Address     string `json:"address"`
	Contact     string `json:"contact"`
	Tel         string `json:"tel"`
	Email       string `json:"email"`
	LicenseNo   string `json:"licenseNo"`
	CustomsCode string `json:"customsCode"`
	TaxNo       string `json:"taxNo"`
}

type Item struct {
	Product   string  `json:"product"`
	Material  string  `json:"material"`
	Finish    string  `json:"finish"`
	Size      string  `json:"size"`
	Qty       float64 `json:"qty"`
	Unit      string  `json:"unit"`
	UnitPrice float64 `json:"unitPrice"`
	Remarks   string  `json:"remarks"`
}

type BankDetails struct {
	Beneficiary      string `json:"beneficiary"`
	BeneficiaryAddr  string `json:"beneficiaryAddress"`
	BankName         string `json:"bankName"`
	BankAddress      string `json:"bankAddress"`
	AccountNo        string `json:"accountNo"`
	Swift            string `json:"swift"`
	BankCode         string `json:"bankCode"`
	PaymentReference string `json:"paymentReference"`
	BankCharges      string `json:"bankCharges"`
}

func (i *Invoice) FixDefaults() {
	if i.PINo == "" {
		i.PINo = "PI-YYYYMMDD-001"
	}
	if i.Currency == "" {
		i.Currency = "USD"
	}
	if i.PaymentTerm == "" {
		i.PaymentTerm = "T/T Wire Transfer"
	}
	if i.Validity == "" {
		i.Validity = "15 days"
	}
	if i.Incoterms == "" {
		i.Incoterms = "CFR"
	}
	if i.Packing == "" {
		i.Packing = "Export standard wooden crate packing"
	}
	if i.Terms == "" {
		i.Terms = defaultTerms
	}
	if i.Bank.BankCharges == "" {
		i.Bank.BankCharges = "All bank charges outside seller's bank are for buyer's account unless otherwise agreed."
	}
	if i.Bank.PaymentReference == "" {
		i.Bank.PaymentReference = i.PINo + " - " + i.Buyer.Company
	}
	if len(i.Items) == 0 {
		i.Items = []Item{{Qty: 1, Unit: "set"}}
	}
	for idx := range i.Items {
		if i.Items[idx].Unit == "" {
			i.Items[idx].Unit = "set"
		}
	}
}

const defaultTerms = `1. This PI becomes binding after buyer's written acceptance and seller's receipt of agreed deposit or full payment.
2. Production and shipment schedules are counted from the date cleared funds are received in seller's bank account.
3. Natural marble and stone may vary in veining, color tone, texture, mineral lines, pinholes and natural repair.
4. Buyer shall approve drawings, renderings, models, stone selection photos or production photos where applicable.
5. Seller shall use export-standard packing. Risk transfer follows agreed Incoterms 2020.
6. Buyer is responsible for import license, customs clearance, duties, taxes, storage and destination charges unless included under agreed Incoterms.
7. Customized marble and stone sculptures are made-to-order. Deposit is non-refundable after production starts except for seller's material breach.
8. Prices, bank details, drawings, private designs and commercial terms are confidential.`
