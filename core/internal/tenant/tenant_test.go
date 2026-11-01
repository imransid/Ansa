package tenant

import "testing"

func TestOnlyUUIDsBecomeCompanyIDs(t *testing.T) {
	id, err := FromTrustedSource("E0EF2BC4-E44A-4231-9841-12C3CDC22D31")
	if err != nil || id.String() != "e0ef2bc4-e44a-4231-9841-12c3cdc22d31" {
		t.Fatalf("a uuid in capitals is lowercased, got %q, %v", id.String(), err)
	}
	for _, bad := range []string{"", "1 OR 1=1", "e0ef2bc4-e44a-4231-9841-12c3cdc22d3", "e0ef2bc4e44a4231984112c3cdc22d31"} {
		if _, err := FromTrustedSource(bad); err != ErrNotACompanyID {
			t.Fatalf("%q must be refused", bad)
		}
	}
	var zero CompanyID
	if !zero.IsZero() {
		t.Fatal("an unset CompanyID must say so")
	}
}
