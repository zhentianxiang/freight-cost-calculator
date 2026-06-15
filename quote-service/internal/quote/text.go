package quote

import (
	"fmt"
	"strings"
)

const (
	defaultExclusion     = "不包含目的港清关、关税、目的港杂费、仓储费、查验费、目的地派送及其他买方当地费用。"
	defaultExclusion2    = "Destination customs clearance, duties/taxes, destination port charges, storage, inspection, destination delivery, and other buyer-side local charges are excluded."
	legacyCFRExclusion   = "目的港清关、关税、目的港杂费、仓储费、查验费、目的地派送及其他买方当地费用默认不包含在CFR报价内。"
	legacyCFRExclusionEn = "Destination customs clearance, duties/taxes, destination port charges, storage, inspection, destination delivery, and other buyer-side local charges are not included in CFR quotation by default."
)

func getCustomerTermText(term, destination, lang string) string {
	place := destination
	if place == "" {
		place = tx(lang, "指定目的港", "the named destination port")
	}
	switch term {
	case "FOB":
		return tx(lang,
			"FOB报价包含货物、出口包装、送至中国起运港及出口报关相关费用。",
			"FOB quotation includes cargo, export packing, delivery to the China port of loading, and export customs clearance charges.")
	case "CIF":
		return tx(lang,
			fmt.Sprintf("CIF报价包含货物、出口端费用、国际海运费及基础海运保险至%s。", place),
			fmt.Sprintf("CIF quotation includes cargo, origin-side charges, international ocean freight, and basic marine insurance to %s.", place))
	case "DAP":
		return tx(lang,
			fmt.Sprintf("DAP报价包含货物、出口端费用、国际运输及目的国本地派送至%s。", place),
			fmt.Sprintf("DAP quotation includes cargo, origin-side charges, international transport, and destination local delivery to %s.", place))
	case "DDP":
		return tx(lang,
			fmt.Sprintf("DDP报价包含货物、出口端费用、国际运输、目的国本地派送、进口清关、预估关税及进口税费至%s。", place),
			fmt.Sprintf("DDP quotation includes cargo, origin-side charges, international transport, destination local delivery, import clearance, estimated duties, and import taxes to %s.", place))
	default:
		return tx(lang,
			fmt.Sprintf("CFR报价包含货物、出口端费用及国际海运费至%s。", place),
			fmt.Sprintf("CFR quotation includes cargo, origin-side charges, and international ocean freight to %s.", place))
	}
}

func getExclusionText(term, lang string) string {
	switch term {
	case "FOB":
		return tx(lang,
			"不包含国际海运费、海运保险、目的港杂费、进口清关、关税税费、仓储查验、目的地派送及其他买方当地费用。",
			"International ocean freight, marine insurance, destination port charges, import clearance, duties/taxes, storage, inspection, destination delivery, and other buyer-side local charges are excluded.")
	case "CIF":
		return tx(lang,
			"不包含目的港杂费、进口清关、关税税费、仓储查验、目的地派送及其他买方当地费用。",
			"Destination port charges, import clearance, duties/taxes, storage, inspection, destination delivery, and other buyer-side local charges are excluded.")
	case "DAP":
		return tx(lang,
			"不包含进口清关、关税税费、进口许可证、海关查验及因买方原因产生的仓储、滞港、滞箱等目的国费用。",
			"Import clearance, duties/taxes, import licenses, customs inspection, and buyer-caused destination storage, demurrage, detention, or similar charges are excluded.")
	case "DDP":
		return tx(lang,
			"不包含买方原因造成的仓储、滞港、滞箱、特殊查验、二次派送及报价未列明的目的地附加费用；进口税费按报价时预估口径执行。",
			"Buyer-caused storage, demurrage, detention, special inspection, redelivery, and destination surcharges not stated in the quotation are excluded; import duties/taxes follow the estimate used in this quotation.")
	default:
		return tx(lang,
			"不包含海运保险、目的港杂费、进口清关、关税税费、仓储查验、目的地派送及其他买方当地费用。",
			"Marine insurance, destination port charges, import clearance, duties/taxes, storage, inspection, destination delivery, and other buyer-side local charges are excluded.")
	}
}

func isDefaultExclusionNote(note string) bool {
	note = strings.TrimSpace(note)
	return note == defaultExclusion ||
		note == defaultExclusion2 ||
		note == legacyCFRExclusion ||
		note == legacyCFRExclusionEn
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
