package orders

import (
	"strconv"
	"strings"
	"unicode"

	"ansa/core/internal/money"
)

// The languages of ansa's own order texts: Bangla for a customer who writes
// in Bengali script, else English.
const (
	English = "en"
	Bangla  = "bn"
)

// LanguageOf is the language of ansa's texts for a customer's newest
// message: Bangla when most of its letters are Bengali script
// (U+0980-U+09FF), else English. Digits, spaces and signs don't count.
func LanguageOf(text string) string {
	bengali, letters := 0, 0
	for _, r := range text {
		if !unicode.IsLetter(r) && !unicode.IsMark(r) {
			continue
		}
		letters++
		if r >= 0x0980 && r <= 0x09FF {
			bengali++
		}
	}
	if bengali*2 > letters {
		return Bangla
	}
	return English
}

// The Bangla texts below say what texts.go's English ones say: the numbers
// and prices are written the same way (money.Format), the dishes as the
// menu names them.

const (
	sendTheAddressBangla = "অনুগ্রহ করে পুরো ঠিকানাটা পাঠান।"
	tellTheAddressBangla = "অনুগ্রহ করে পুরো ঠিকানাটা বলুন।"
)

func questionBangla(gap string, options Options) string {
	switch {
	case gap == GapNoItems:
		return "আপনি কী অর্ডার করতে চান?"
	case gap == GapAddress:
		return "কোথায় ডেলিভারি দেব? " + sendTheAddressBangla
	case options.Delivery && options.Pickup:
		return "আপনি কি ডেলিভারি নেবেন, নাকি নিজে এসে নিয়ে যাবেন?"
	case options.Delivery:
		return "আমরা ডেলিভারি দিই: কোথায় পৌঁছে দেব? " + sendTheAddressBangla
	case options.Pickup:
		return "আমরা ডেলিভারি দিই না, তবে আপনি নিজে এসে নিয়ে যেতে পারেন। নিজে এসে নিলে চলবে?"
	}
	return "দুঃখিত, এই মুহূর্তে আমরা অর্ডার নিতে পারছি না।"
}

func summaryBangla(order Priced) string {
	price := func(cents int64) string { return money.Format(cents, order.Currency) }
	lines := []string{"আপনার অর্ডার:"}
	for _, line := range order.Lines {
		lines = append(lines, strconv.Itoa(line.Quantity)+" × "+line.Name+": "+price(line.LineTotalCents))
	}
	if order.DeliveryFeeCents > 0 {
		lines = append(lines, "ডেলিভারি চার্জ: "+price(order.DeliveryFeeCents))
	}
	lines = append(lines, "মোট: "+price(order.TotalCents))
	if order.Fulfilment == "delivery" {
		lines = append(lines, "ডেলিভারির ঠিকানা: "+order.Address)
	} else {
		lines = append(lines, "নিজে এসে নেবেন")
	}
	lines = append(lines, "কখন: "+wantedTimeBangla(order.Time))
	if order.Notes != "" {
		lines = append(lines, "নোট: "+order.Notes)
	}
	return strings.Join(append(lines, "", "অর্ডারটি কি নিশ্চিত করব? নিশ্চিত করতে “হ্যাঁ” লিখে পাঠান।"), "\n")
}

func spokenSummaryBangla(order Priced) string {
	price := func(cents int64) string { return money.Format(cents, order.Currency) }
	parts := []string{"আপনার অর্ডার:"}
	for _, line := range order.Lines {
		parts = append(parts, strconv.Itoa(line.Quantity)+" "+line.Name+", "+price(line.LineTotalCents)+"।")
	}
	if order.DeliveryFeeCents > 0 {
		parts = append(parts, "ডেলিভারি চার্জ, "+price(order.DeliveryFeeCents)+"।")
	}
	parts = append(parts, "মোট, "+price(order.TotalCents)+"।")
	if order.Fulfilment == "delivery" {
		parts = append(parts, "ডেলিভারির ঠিকানা: "+order.Address+"।")
	} else {
		parts = append(parts, "নিজে এসে নেবেন।")
	}
	parts = append(parts, "কখন: "+wantedTimeBangla(order.Time)+"।")
	if order.Notes != "" {
		parts = append(parts, "নোট: "+order.Notes+"।")
	}
	return strings.Join(append(parts, "অর্ডারটি কি নিশ্চিত করব? নিশ্চিত করতে অনুগ্রহ করে হ্যাঁ বলুন।"), " ")
}

// wantedTimeBangla: ansa's own "As soon as possible" in Bangla; a time the
// customer gave stays as they wrote it.
func wantedTimeBangla(wanted string) string {
	if wanted == asSoonAsPossible {
		return "যত তাড়াতাড়ি সম্ভব"
	}
	return wanted
}

// hoursBangla is hours.Now's text for closed ("Closed today", "Closed now",
// "Opens at 18:00") in Bangla; anything else as it is.
func hoursBangla(hoursNow string) string {
	switch {
	case hoursNow == "Closed today":
		return "আজ বন্ধ"
	case hoursNow == "Closed now":
		return "এখন বন্ধ"
	case strings.HasPrefix(hoursNow, "Opens at "):
		return strings.TrimPrefix(hoursNow, "Opens at ") + "-এ খুলবে"
	}
	return strings.ToLower(hoursNow)
}

func statusBangla(change string, number int, fulfilment string, wasNew bool) string {
	n := "#" + strconv.Itoa(number)
	switch change {
	case "accept":
		return "আপনার অর্ডার " + n + " গ্রহণ করা হয়েছে। আমরা অর্ডারটি প্রস্তুত করছি।"
	case "ready":
		if fulfilment == "delivery" {
			return "আপনার অর্ডার " + n + " পথে আছে।"
		}
		return "আপনার অর্ডার " + n + " তৈরি, এসে নিয়ে যেতে পারেন।"
	case "done":
		return "অর্ডার " + n + "-এর জন্য ধন্যবাদ!"
	}
	if wasNew {
		return "দুঃখিত, আমরা আপনার অর্ডার " + n + " নিতে পারছি না। কোনো প্রশ্ন থাকলে এখানে আমাদের লিখুন।"
	}
	return "দুঃখিত, আপনার অর্ডার " + n + " বাতিল করা হয়েছে। কোনো প্রশ্ন থাকলে এখানে আমাদের লিখুন।"
}
