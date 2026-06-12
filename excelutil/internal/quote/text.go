package quote

import "fmt"

const (
	defaultExclusion  = "不包含目的港清关、关税、目的港杂费、仓储费、查验费、目的地派送及其他买方当地费用。"
	defaultExclusion2 = "Destination customs clearance, duties/taxes, destination port charges, storage, inspection, destination delivery, and other buyer-side local charges are excluded."
)

func getCustomerTermText(term, destination, lang string) string {
	place := destination
	if place == "" {
		place = tx(lang, "指定目的港", "the named destination port")
	}
	switch term {
	case "FOB":
		return tx(lang,
			"报价包含货物至中国起运港并完成出口报关相关费用，不包含国际海运费、保险费及目的港费用。",
			"The quotation includes cargo, delivery to the China port of loading, and export customs clearance. International ocean freight, insurance, and destination charges are excluded.")
	case "CIF":
		return tx(lang,
			fmt.Sprintf("报价包含货物、出口端费用、国际海运费及基础海运保险至%s。", place),
			fmt.Sprintf("The quotation includes cargo, origin-side charges, international ocean freight, and basic marine insurance to %s.", place))
	default:
		return tx(lang,
			fmt.Sprintf("报价包含货物、出口端费用及国际海运费至%s。", place),
			fmt.Sprintf("The quotation includes cargo, origin-side charges, and international ocean freight to %s.", place))
	}
}

func getExclusionText(lang string) string {
	return tx(lang,
		defaultExclusion,
		defaultExclusion2)
}

func tx(lang, zh, en string) string {
	if lang == "en" {
		return en
	}
	if lang == "bilingual" {
		return fmt.Sprintf("%s / %s", zh, en)
	}
	return zh
}

func yesNo(v bool, lang string) string {
	if v {
		return tx(lang, "是", "Yes")
	}
	return tx(lang, "否", "No")
}

func freightName(scheme, lang string) string {
	return scheme + tx(lang, "货代", " Forwarder")
}
