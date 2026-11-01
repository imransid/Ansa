package addresses

import "testing"

func TestCustomerAddressesAreReadAsBrowsersReadThem(t *testing.T) {
	good := map[string]string{
		" Ana@Example.COM ":          "ana@example.com",
		"sales&support@shop.example": "sales&support@shop.example",
		"ivan@почта.рф":              "ivan@xn--80a1acny.xn--p1ai",
	}
	for input, want := range good {
		if got, problem := CustomerEmail(input); got != want || problem != "" {
			t.Errorf("%q: got %q %q", input, got, problem)
		}
	}
	for _, bad := range []string{"user@localhost", "josé@example.com", "a@b", "no at sign", "a@example.com/x"} {
		if got, problem := CustomerEmail(bad); got != "" || problem == "" {
			t.Errorf("%q should be refused: %q", bad, got)
		}
	}
}
