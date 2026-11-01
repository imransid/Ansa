package commands

import (
	"context"
	"regexp"
	"testing"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

func testCompany(t *testing.T, pool *database.Pool) tenant.CompanyID {
	company, _ := tenant.FromTrustedSource(database.TestCompany(t, pool))
	return company
}

// A number is linked to one company only; unlinking is company-scoped and
// refused once the number has calls.
func TestPhoneLinesAreLinkedOnceAndUnlinkedOnlyBeforeTheirFirstCall(t *testing.T) {
	pool := database.ForTest(t)
	ctx := context.Background()
	ours, theirs := testCompany(t, pool), testCompany(t, pool)
	number := "pn-commands-" + ours.String()
	if CleanPhoneNumberID("  "+number+" ") != number || CleanPhoneNumberID("pn 1") != "" || CleanPhoneNumberID("ab") != "" {
		t.Fatal("Vapi's ids: 3-100 letters, digits, _ or -")
	}
	if holder, err := PhoneLineHolder(ctx, pool, ours, number); err != nil || holder != LineFree {
		t.Fatalf("a new number: %q %v", holder, err)
	}
	if linked, err := LinkPhoneLine(ctx, pool, ours, number); err != nil || !linked {
		t.Fatalf("linking: %v %v", linked, err)
	}
	if holder, _ := PhoneLineHolder(ctx, pool, ours, number); holder != LineOfThisCompany {
		t.Fatalf("ours now: %q", holder)
	}
	if holder, _ := PhoneLineHolder(ctx, pool, theirs, number); holder != LineOfAnotherCompany {
		t.Fatalf("another company sees it taken, never by whom: %q", holder)
	}
	if linked, err := LinkPhoneLine(ctx, pool, theirs, number); err != nil || linked {
		t.Fatalf("a number links once: %v %v", linked, err)
	}
	if outcome, _ := UnlinkPhoneLine(ctx, pool, theirs, number); outcome != NoSuchLine {
		t.Fatalf("another company can't unlink it: %q", outcome)
	}
	var lineID string
	pool.QueryRow(ctx, `SELECT id FROM phone_lines WHERE company_id = $1 AND vapi_phone_number_id = $2`, ours.String(), number).Scan(&lineID)
	if _, err := pool.Exec(ctx, `INSERT INTO calls (company_id, phone_line_id, vapi_call_id) VALUES ($1, $2, $3)`, ours.String(), lineID, "call-"+number); err != nil {
		t.Fatalf("a call: %v", err)
	}
	if outcome, err := UnlinkPhoneLine(ctx, pool, ours, number); err != nil || outcome != LineHasCalls {
		t.Fatalf("a number with calls stays: %q %v", outcome, err)
	}
	pool.Exec(ctx, `DELETE FROM calls WHERE company_id = $1`, ours.String())
	if outcome, err := UnlinkPhoneLine(ctx, pool, ours, number); err != nil || outcome != Unlinked {
		t.Fatalf("unlinking: %q %v", outcome, err)
	}
	if linked, _ := IsCompanysPhoneLine(ctx, pool, ours, number); linked {
		t.Fatal("unlinked")
	}
}

var forwardingPattern = regexp.MustCompile(`^c-[0-9a-f]{32}@inbound\.example\.test$`)

// A new forwarding address is the database's own new token; the old one is gone.
func TestTheForwardingAddressIsReplacedByANewDatabaseToken(t *testing.T) {
	pool := database.ForTest(t)
	ctx := context.Background()
	company := testCompany(t, pool)
	before, err := ForwardingAddress(ctx, pool, company, "inbound.example.test")
	if err != nil || !forwardingPattern.MatchString(before) {
		t.Fatalf("the address: %q %v", before, err)
	}
	after, err := ReplaceForwardingAddress(ctx, pool, company, "inbound.example.test")
	if err != nil || !forwardingPattern.MatchString(after) || after == before {
		t.Fatalf("a new address: %q %v", after, err)
	}
	if now, _ := ForwardingAddress(ctx, pool, company, "inbound.example.test"); now != after {
		t.Fatalf("the new one is the company's: %q", now)
	}
}
