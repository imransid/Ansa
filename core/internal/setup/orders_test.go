package setup

import "testing"

// Taking orders needs a way to get them to the customer: with neither
// delivery nor pickup ansa would promise a pickup the business never offered.
func TestTakingOrdersNeedsDeliveryOrPickup(t *testing.T) {
	neither := Orders{TakesOrders: true, Currency: "BDT"}
	if fields := neither.Check(); fields["form"] != "Choose delivery, pickup or both to take orders." {
		t.Fatalf("refused: %v", fields)
	}
	for name, fine := range map[string]Orders{
		"delivery":  {TakesOrders: true, Delivery: true, Currency: "BDT"},
		"pickup":    {TakesOrders: true, Pickup: true, Currency: "BDT"},
		"no orders": {TakesOrders: false, Currency: "BDT"},
	} {
		if fields := fine.Check(); len(fields) != 0 {
			t.Errorf("%s: %v", name, fields)
		}
	}
	// Both problems at once: the way, and a currency that isn't one.
	if fields := (&Orders{TakesOrders: true, Currency: "XYZ"}).Check(); fields["form"] == "" || fields["currency"] == "" {
		t.Fatalf("both said: %v", fields)
	}
}
