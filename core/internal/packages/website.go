package packages

// Website is what the public website's Pricing page shows (step 58): the
// free trial and the packages to choose. The screens can't run Go and the
// website asks core nothing (it is fully static), so they read website.json,
// which website_test.go keeps equal to this package (make website-packages
// writes it again after a change in packages.go).
type Website struct {
	TrialDays int       `json:"trialDays"`
	Trial     Package   `json:"trial"`
	Paid      []Package `json:"paid"`
}

// ForWebsite is the packages as website.json holds them.
func ForWebsite() Website {
	return Website{TrialDays: TrialDays, Trial: Trial, Paid: Paid}
}
