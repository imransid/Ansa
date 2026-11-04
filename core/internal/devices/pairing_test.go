package devices

import (
	"context"
	"strings"
	"testing"

	"ansa/core/internal/database"
	"ansa/core/internal/settings"
)

// A code works once, for 5 minutes, for the company that made it; a wrong
// one connects nothing.
func TestACodeWorksOnceForItsOwnCompanyOnly(t *testing.T) {
	pool := database.ForTest(t)
	ctx := context.Background()
	a, b := newAccount(t, pool), newAccount(t, pool)
	code := a.code()
	if a.count(`SELECT count(*) FROM device_pair_codes WHERE company_id = $1 AND code_hash = $2 AND expires_at <= now() + interval '5 minutes'`,
		a.company.String(), hashSecret(code)) != 1 {
		t.Fatal("only the code's hash is stored, for 5 minutes")
	}
	pairing, err := Pair(ctx, pool, code, NewPhone{Name: "Rafa's iPhone", Platform: "ios"})
	if err != nil || pairing.Outcome != Paired || pairing.Device.Company != a.company || pairing.Device.PairedByUserID != a.owner {
		t.Fatalf("paired into the code's company, as its maker: %+v %v", pairing, err)
	}
	again, err := Pair(ctx, pool, code, NewPhone{Name: "Another phone", Platform: "android"})
	if err != nil || again.Outcome != WrongCode || again.Token != "" {
		t.Fatalf("a used code: %+v %v", again, err)
	}
	if wrong, err := Pair(ctx, pool, "ABCDEFGH", NewPhone{Name: "x", Platform: "ios"}); err != nil || wrong.Outcome != WrongCode {
		t.Fatalf("a wrong code: %+v %v", wrong, err)
	}
	if b.count(`SELECT count(*) FROM devices WHERE company_id = $1`, b.company.String()) != 0 ||
		a.count(`SELECT count(*) FROM devices WHERE company_id = $1`, a.company.String()) != 1 {
		t.Fatal("one phone, in the code's company only")
	}
}

func TestAnExpiredCodeConnectsNothing(t *testing.T) {
	pool := database.ForTest(t)
	a := newAccount(t, pool)
	code := a.code()
	a.exec(`UPDATE device_pair_codes SET created_at = now() - interval '6 minutes', expires_at = now() - interval '1 minute' WHERE company_id = $1`, a.company.String())
	if pairing, err := Pair(context.Background(), pool, code, NewPhone{Name: "x", Platform: "ios"}); err != nil || pairing.Outcome != WrongCode {
		t.Fatalf("expired: %+v %v", pairing, err)
	}
}

// Only owners make codes, and a code whose maker was removed or made a
// member since connects nothing (and stays unused).
func TestOnlyAnOwnersCodeConnects(t *testing.T) {
	pool := database.ForTest(t)
	ctx := context.Background()
	a := newAccount(t, pool)
	member := database.TestOwner(t, pool, a.company.String())
	a.exec(`UPDATE users SET role = 'member' WHERE company_id = $1 AND id = $2`, a.company.String(), member)
	if _, outcome, err := MakePairCode(ctx, pool, a.company, member, "http://127.0.0.1:8080"); err != nil || outcome != settings.NotAllowed {
		t.Fatalf("a member's code: %q %v", outcome, err)
	}
	demoted := a.code()
	a.exec(`UPDATE users SET role = 'member' WHERE company_id = $1 AND id = $2`, a.company.String(), a.owner)
	if pairing, err := Pair(ctx, pool, demoted, NewPhone{Name: "x", Platform: "ios"}); err != nil || pairing.Outcome != WrongCode {
		t.Fatalf("made a member since: %+v %v", pairing, err)
	}
	a.exec(`UPDATE users SET role = 'owner' WHERE company_id = $1 AND id = $2`, a.company.String(), a.owner)
	removed := a.code()
	a.exec(`UPDATE users SET deactivated_at = now() WHERE company_id = $1 AND id = $2`, a.company.String(), a.owner)
	if pairing, err := Pair(ctx, pool, removed, NewPhone{Name: "x", Platform: "ios"}); err != nil || pairing.Outcome != WrongCode {
		t.Fatalf("removed since: %+v %v", pairing, err)
	}
	if a.count(`SELECT count(*) FROM devices WHERE company_id = $1`, a.company.String()) != 0 ||
		a.count(`SELECT count(*) FROM device_pair_codes WHERE company_id = $1 AND used_at IS NOT NULL`, a.company.String()) != 0 {
		t.Fatal("no phone, and the refused codes stay unused")
	}
}

// A company keeps at most 10 phones: the 11th is refused and its code
// stays unused (it works once a phone is removed).
func TestACompanyKeepsAtMostTenPhones(t *testing.T) {
	pool := database.ForTest(t)
	ctx := context.Background()
	a := newAccount(t, pool)
	for range MaxDevicesPerCompany {
		a.phone("phone")
	}
	code := a.code()
	if pairing, err := Pair(ctx, pool, code, NewPhone{Name: "one too many", Platform: "ios"}); err != nil || pairing.Outcome != TooManyPhones {
		t.Fatalf("the 11th: %+v %v", pairing, err)
	}
	a.exec(`UPDATE devices SET removed_at = now() WHERE company_id = $1 AND id = (SELECT id FROM devices WHERE company_id = $1 LIMIT 1)`, a.company.String())
	if pairing, err := Pair(ctx, pool, code, NewPhone{Name: "now it fits", Platform: "ios"}); err != nil || pairing.Outcome != Paired {
		t.Fatalf("after a removal, the same code: %+v %v", pairing, err)
	}
}

// The token is given once and stored only as its hash; it names its phone
// until the phone is removed or its owner is no longer an active owner.
func TestATokenNamesItsPhoneWhileThePhoneAndItsOwnerLast(t *testing.T) {
	pool := database.ForTest(t)
	ctx := context.Background()
	a := newAccount(t, pool)
	token, device := a.phone("Rafa's iPhone")
	if a.count(`SELECT count(*) FROM devices WHERE company_id = $1 AND token_hash = $2`, a.company.String(), hashSecret(token)) != 1 ||
		a.count(`SELECT count(*) FROM devices WHERE company_id = $1 AND (token_hash = $2 OR name = $2)`, a.company.String(), token) != 0 {
		t.Fatal("only the token's hash is stored")
	}
	found, err := Authenticate(ctx, pool, token)
	if err != nil || found == nil || *found != device {
		t.Fatalf("the token names its phone: %+v %v", found, err)
	}
	for _, wrong := range []string{"", "not a token", strings.Repeat("A", 43), token + "x"} {
		if found, err := Authenticate(ctx, pool, wrong); err != nil || found != nil {
			t.Fatalf("%q names no phone: %+v %v", wrong, found, err)
		}
	}
	a.exec(`UPDATE users SET role = 'member' WHERE company_id = $1 AND id = $2`, a.company.String(), a.owner)
	if found, _ := Authenticate(ctx, pool, token); found != nil {
		t.Fatal("its owner made a member: refused")
	}
	a.exec(`UPDATE users SET role = 'owner', deactivated_at = now() WHERE company_id = $1 AND id = $2`, a.company.String(), a.owner)
	if found, _ := Authenticate(ctx, pool, token); found != nil {
		t.Fatal("its owner removed: refused")
	}
	a.exec(`UPDATE users SET deactivated_at = NULL WHERE company_id = $1 AND id = $2`, a.company.String(), a.owner)
	if err := Unpair(ctx, pool, device); err != nil {
		t.Fatal(err)
	}
	if found, _ := Authenticate(ctx, pool, token); found != nil {
		t.Fatal("a removed phone: refused")
	}
}
