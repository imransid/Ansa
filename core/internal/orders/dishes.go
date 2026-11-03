package orders

import "strings"

// findDish is today's dish the AI named in an order: by its label as the
// menu shows it ("M1"), else by its exact name when exactly one of today's
// dishes has it. WHY the name too (step 58): the AI sometimes writes the
// dish's name although it is asked for the label; an exact, unique name is
// as certain, the price is still the menu's, and the customer confirms
// ansa's summary. A partial or shared name is not found: a person takes it.
func findDish(menu []MenuChoice, label string) (MenuChoice, bool) {
	wanted := strings.Join(strings.Fields(label), " ")
	for _, dish := range menu {
		if dish.Label == strings.ToUpper(wanted) {
			return dish, true
		}
	}
	var named []MenuChoice
	for _, dish := range menu {
		if strings.EqualFold(strings.Join(strings.Fields(dish.Name), " "), wanted) {
			named = append(named, dish)
		}
	}
	if len(named) == 1 {
		return named[0], true
	}
	return MenuChoice{}, false
}
