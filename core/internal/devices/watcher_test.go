package devices

import (
	"context"
	"testing"

	"ansa/core/internal/database"
	"ansa/core/internal/settings"
)

// runWatcher runs one round of the watcher and fails the test on an error.
func runWatcher(t *testing.T, pool *database.Pool) {
	t.Helper()
	if _, err := SwitchAwayWhenUnreachable(context.Background(), pool); err != nil {
		t.Fatalf("the watcher: %v", err)
	}
}

// No phone seen for longer than the wait: ansa switches to away as "I'm
// away" does (a conversation a person took over handed back, by no person;
// a waiting message due now), set by the phone, with its line. A phone
// still within the wait, or another company, is left alone.
func TestThePhonesSwitchAnsaAwayAfterTheWait(t *testing.T) {
	pool := database.ForTest(t)
	a, b := newAccount(t, pool), newAccount(t, pool)
	_, phone := a.phone("Rafa's iPhone")
	a.follow(5)
	a.phoneSilentFor(phone, "4 minutes")
	taken := a.conversation("ana")
	a.exec(`UPDATE conversations SET handled_by = 'person', taken_over_by_user_id = $3, taken_over_at = now() WHERE company_id = $1 AND id = $2`,
		a.company.String(), taken, a.owner)
	waiting := a.conversation("bo")
	a.exec(`UPDATE conversations SET assistant_due_at = now() + interval '10 minutes' WHERE company_id = $1 AND id = $2`, a.company.String(), waiting)
	_, theirPhone := b.phone("their phone")
	b.follow(1)
	b.phoneSilentFor(theirPhone, "10 seconds")

	runWatcher(t, pool)
	if away, _ := a.awayState(); away {
		t.Fatal("seen 4 minutes ago, waiting 5: still available")
	}
	a.phoneSilentFor(phone, "6 minutes")
	runWatcher(t, pool)
	if away, setBy := a.awayState(); !away || setBy != settings.AwayByPhone {
		t.Fatalf("away, set by the phone: %v %q", away, setBy)
	}
	if a.count(`SELECT count(*) FROM assistant_activity WHERE company_id = $1 AND conversation_id = $2 AND action = 'handed_back' AND actor_user_id IS NULL`,
		a.company.String(), taken) != 1 {
		t.Fatal("the taken-over conversation is handed back, by no person")
	}
	if a.count(`SELECT count(*) FROM conversations WHERE company_id = $1 AND id = $2 AND assistant_due_at <= now()`, a.company.String(), waiting) != 1 {
		t.Fatal("the waiting message is due now")
	}
	if a.count(`SELECT count(*) FROM phone_presence_changes WHERE company_id = $1 AND change = 'away' AND device_id IS NULL`, a.company.String()) != 1 {
		t.Fatal("one line: the phone was unreachable")
	}
	runWatcher(t, pool)
	if a.count(`SELECT count(*) FROM phone_presence_changes WHERE company_id = $1`, a.company.String()) != 1 {
		t.Fatal("already away: nothing more")
	}
	if away, _ := b.awayState(); away {
		t.Fatal("another company's phone checked in: it stays available")
	}
}

// Off (the default), or with no phone that counts (none, removed, or its
// owner no longer an owner), the watcher never switches.
func TestTheWatcherNeverSwitchesWhenOffOrWithoutAPhone(t *testing.T) {
	pool := database.ForTest(t)
	off := newAccount(t, pool)
	_, offPhone := off.phone("phone")
	off.phoneSilentFor(offPhone, "2 hours")
	noPhone := newAccount(t, pool)
	noPhone.follow(1)
	removed := newAccount(t, pool)
	_, removedPhone := removed.phone("phone")
	removed.follow(1)
	removed.phoneSilentFor(removedPhone, "2 hours")
	removed.exec(`UPDATE devices SET removed_at = now() WHERE company_id = $1`, removed.company.String())
	demoted := newAccount(t, pool)
	_, demotedPhone := demoted.phone("phone")
	demoted.follow(1)
	demoted.phoneSilentFor(demotedPhone, "2 hours")
	demoted.exec(`UPDATE users SET role = 'member' WHERE company_id = $1 AND id = $2`, demoted.company.String(), demoted.owner)

	runWatcher(t, pool)
	for name, account := range map[string]*account{"off": off, "no phone": noPhone, "phone removed": removed, "its owner a member": demoted} {
		if away, _ := account.awayState(); away {
			t.Fatalf("%s: switched away", name)
		}
	}
}

// A person's own "I'm away" is never undone by a check-in; after a
// person's "I'm back" while the phone is off, the watcher waits until the
// phone is seen again before it switches.
func TestThePhonesNeverUndoAPersonsOwnSwitch(t *testing.T) {
	pool := database.ForTest(t)
	ctx := context.Background()
	a := newAccount(t, pool)
	_, phone := a.phone("Rafa's iPhone")
	a.follow(5)
	if outcome, err := settings.SetAway(ctx, pool, a.company, a.owner, true); err != nil || outcome != settings.Saved {
		t.Fatalf("I'm away: %q %v", outcome, err)
	}
	if connected, err := CheckIn(ctx, pool, phone); err != nil || !connected {
		t.Fatalf("check-in: %v %v", connected, err)
	}
	if away, setBy := a.awayState(); !away || setBy != settings.AwayByPerson {
		t.Fatalf("a person's away stays: %v %q", away, setBy)
	}
	a.phoneSilentFor(phone, "1 hour")
	if outcome, err := settings.SetAway(ctx, pool, a.company, a.owner, false); err != nil || outcome != settings.Saved {
		t.Fatalf("I'm back: %q %v", outcome, err)
	}
	runWatcher(t, pool)
	if away, _ := a.awayState(); away {
		t.Fatal("I'm back while the phone is off: the watcher waits for the phone")
	}
	if _, err := CheckIn(ctx, pool, phone); err != nil {
		t.Fatal(err)
	}
	a.phoneSilentFor(phone, "6 minutes")
	runWatcher(t, pool)
	if away, setBy := a.awayState(); !away || setBy != settings.AwayByPhone {
		t.Fatalf("seen again, then unreachable: away by the phone: %v %q", away, setBy)
	}
}

// A check-in switches back an away the phones set, with its line naming
// the phone; switching the setting off ends one too.
func TestACheckInSwitchesBackOnlyWhatThePhonesSet(t *testing.T) {
	pool := database.ForTest(t)
	ctx := context.Background()
	a := newAccount(t, pool)
	_, phone := a.phone("Rafa's iPhone")
	a.follow(1)
	a.phoneSilentFor(phone, "2 minutes")
	runWatcher(t, pool)
	if connected, err := CheckIn(ctx, pool, phone); err != nil || !connected {
		t.Fatalf("check-in: %v %v", connected, err)
	}
	if away, setBy := a.awayState(); away || setBy != "" {
		t.Fatalf("back: %v %q", away, setBy)
	}
	if a.count(`SELECT count(*) FROM phone_presence_changes WHERE company_id = $1 AND change = 'back' AND device_id = $2`, a.company.String(), phone.ID) != 1 ||
		a.count(`SELECT count(*) FROM devices WHERE company_id = $1 AND id = $2 AND last_seen_at > now() - interval '5 seconds'`, a.company.String(), phone.ID) != 1 {
		t.Fatal("seen now, and a line naming the phone that came back")
	}
	a.phoneSilentFor(phone, "2 minutes")
	runWatcher(t, pool)
	if outcome, err := SaveSettings(ctx, pool, a.company, a.owner, false, 1); err != nil || outcome != settings.Saved {
		t.Fatalf("switched off: %q %v", outcome, err)
	}
	if away, _ := a.awayState(); away {
		t.Fatal("switching the setting off ends the phones' away")
	}
	if err := Unpair(ctx, pool, phone); err != nil {
		t.Fatal(err)
	}
	if connected, err := CheckIn(ctx, pool, phone); err != nil || connected {
		t.Fatalf("a removed phone checks in no more: %v %v", connected, err)
	}
}
