package home

import "testing"

// Why ansa is away: someone's "I'm away" (also one from before the phone
// app, with no away_set_by), the phones, or the away hours.
func TestWhyAnsaIsAway(t *testing.T) {
	cases := []struct {
		awaySinceSet bool
		setBy        string
		awayNow      bool
		want         string
	}{
		{true, "person", true, "you"},
		{true, "", true, "you"},
		{true, "phone", true, "phone"},
		{false, "", true, "hours"},
		{false, "", false, ""},
	}
	for _, c := range cases {
		if got := awayBy(c.awaySinceSet, c.setBy, c.awayNow); got != c.want {
			t.Fatalf("%+v: %q", c, got)
		}
	}
}
