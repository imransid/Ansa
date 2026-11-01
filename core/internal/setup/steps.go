// Package setup is the setup a new owner fills in at /welcome, one step at
// a time, and the same sections on Settings → What it knows (the old
// services/restaurant-setup.ts, db/restaurant-setup.ts,
// db/setup-facts.ts). Owners change it (settings.AsOwner); everyone in the
// company reads it. A business and a person have their own steps.
package setup

import "slices"

// The steps, in order, for a business and for one person.
var (
	businessSteps = []string{"business", "contact", "hours", "orders", "assistant", "connect", "ready"}
	personalSteps = []string{"business", "away", "assistant", "connect", "ready"}
)

// NewCompanyName is a new owner's company until the setup's first step.
const NewCompanyName = "New business"

// The kinds of business setup offers (a CHECK repeats them).
var businessTypes = []string{"restaurant", "cafe", "bakery", "takeaway", "food_truck", "bar", "catering",
	"shop", "beauty", "health", "fitness", "services", "property", "other"}

// StepsFor is the steps of a business ("business") or a person ("personal").
func StepsFor(kind string) []string {
	if kind == "personal" {
		return personalSteps
	}
	return businessSteps
}

// StepNumber is a step's number (1 for the first), or 0 when it isn't one of the kind's.
func StepNumber(step, kind string) int {
	return slices.Index(StepsFor(kind), step) + 1
}

// SavedSteps is how many steps save something (all but "ready").
func SavedSteps(kind string) int {
	return len(StepsFor(kind)) - 1
}

// NextStep is the step after this one (the last stays the last).
func NextStep(step, kind string) string {
	steps := StepsFor(kind)
	index := slices.Index(steps, step)
	return steps[min(index+1, len(steps)-1)]
}

// PersonalHoldingReply is a person's holding reply: their name, as ansa
// says it, never a pronoun.
func PersonalHoldingReply(name string) string {
	return "Thanks for your message. " + name + " can't reply right now. I've passed it on, and " + name + " will get back to you soon."
}
