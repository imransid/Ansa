package drafts

import "testing"

func TestClaimsNeedAnOwnerUnlessEachIsBackedNow(t *testing.T) {
	one := 1
	draft := Draft{Version: 1, GeneratedVersion: &one,
		Claims:    []byte(`[{"text":"Open since 1998","supported":true,"fact_topics":["history"]}]`),
		FactsUsed: []byte(`[{"topic":"history","value":"Since 1998"}]`)}
	if !ClaimsChecked(draft, map[string]string{"history": "Since 1998"}) {
		t.Fatal("a claim backed by an unchanged fact needs nobody")
	}
	if ClaimsChecked(draft, map[string]string{"history": "Since 1999"}) {
		t.Fatal("a fact changed since: an owner checks")
	}
	two := 2
	edited := draft
	edited.GeneratedVersion = &two
	if ClaimsChecked(edited, map[string]string{"history": "Since 1998"}) {
		t.Fatal("a hand edit since: an owner checks")
	}
	none := Draft{Version: 1, GeneratedVersion: &one, Claims: []byte(`[]`), FactsUsed: []byte(`[]`)}
	if !ClaimsChecked(none, nil) {
		t.Fatal("no claims listed: nothing to check")
	}
	odd := none
	odd.Claims = []byte(`[{"text":"x"}]`)
	if ClaimsChecked(odd, nil) {
		t.Fatal("a claim in another shape: an owner checks")
	}
}
