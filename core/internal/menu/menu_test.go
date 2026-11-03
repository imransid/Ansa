package menu

import "testing"

// "Other dishes" is how the menu page shows a dish without a category
// (lib/menu.ts NO_CATEGORY_LABEL): typed in, it is no category, so Up and
// Down move it among the dishes shown with it.
func TestOtherDishesTypedInIsNoCategory(t *testing.T) {
	for _, typed := range []string{"Other dishes", " other  dishes ", "OTHER DISHES"} {
		fields, problems := Typed{Category: typed, Name: "Water", Price: "2"}.Check("EUR")
		if len(problems) != 0 || fields.Category != "" {
			t.Errorf("%q: %q %v", typed, fields.Category, problems)
		}
	}
	if fields, _ := (Typed{Category: "Other drinks", Name: "Water", Price: "2"}).Check("EUR"); fields.Category != "Other drinks" {
		t.Errorf("another category stays: %q", fields.Category)
	}
}
