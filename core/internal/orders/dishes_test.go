package orders

import "testing"

// A dish named by its exact, unique name is found as by its label (the AI
// sometimes writes the name); a partial or shared name goes to a person.
func TestADishIsFoundByItsLabelOrItsExactName(t *testing.T) {
	today := []MenuChoice{{Label: "M1", Name: "Kacchi Biryani", PriceCents: 45000}, {Label: "M2", Name: "Borhani", PriceCents: 8000},
		{Label: "M3", Name: "Firni", PriceCents: 9000}, {Label: "M4", Name: "Firni", PriceCents: 12000}}
	order, gap := Price(Request{Items: []Item{{"kacchi  biryani ", 2}, {"M2", 1}}, Fulfilment: "pickup"}, today, both)
	if gap != "" || len(order.Lines) != 2 || order.Lines[0].Name != "Kacchi Biryani" || order.TotalCents != 98000 {
		t.Fatalf("by its exact name, priced from the menu: %+v %s", order, gap)
	}
	for _, unclear := range []string{"Kacchi", "Firni", "M9"} {
		if _, gap := Price(Request{Items: []Item{{unclear, 1}}, Fulfilment: "pickup"}, today, both); gap != GapUnknownItem {
			t.Errorf("%q: a person takes it, got %q", unclear, gap)
		}
	}
}
