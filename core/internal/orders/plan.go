package orders

// What ansa does with the assistant's order answer, before anything is
// saved (the old lib/order-steps.ts). The AI's words are never sent here.
const (
	StepHandover = "handover"
	StepAsk      = "ask"
	StepPropose  = "propose"
	StepPlace    = "place"
	StepWithdraw = "withdraw"
)

// Step is one planned step: Reason for a handover, Text for what ansa
// sends, Order for a proposal.
type Step struct {
	Kind, Reason, Text string
	Order              Priced
}

// Ordering is what a step needs to know about the business today.
type Ordering struct {
	TakesOrders bool
	// A live call: ansa's texts are the spoken ones (SpokenQuestion, SpokenSummaryText).
	Spoken bool
	// "Opens at 18:00" while closed now by its own hours; "" when open or no hours were given.
	ClosedNow string
	Menu      []MenuChoice
	Options   Options
	// The language of ansa's texts: the customer's newest message's (LanguageOf; "" is English).
	Language string
}

// PlanStep plans the answer `kind` (order_summary, order_confirmed,
// order_withdrawn) for a business or a person ("personal").
func PlanStep(kind string, request *Request, ordering Ordering, companyKind string) Step {
	// A person's account, a business that takes no orders here, or one that
	// offers neither delivery nor pickup (no way to promise): a person does.
	offersAWay := ordering.Options.Delivery || ordering.Options.Pickup
	if companyKind != "business" || !ordering.TakesOrders || !offersAWay {
		return Step{Kind: StepHandover, Reason: "order"}
	}
	language := ordering.Language
	switch kind {
	case "order_confirmed":
		return Step{Kind: StepPlace}
	case "order_withdrawn":
		return Step{Kind: StepWithdraw, Text: WithdrawnText(language)}
	}
	if ordering.ClosedNow != "" {
		return Step{Kind: StepAsk, Text: ClosedText(ordering.ClosedNow, language)}
	}
	if request == nil {
		return Step{Kind: StepHandover, Reason: "order_unclear"}
	}
	priced, gap := Price(*request, ordering.Menu, ordering.Options)
	switch gap {
	case "":
		if ordering.Spoken {
			return Step{Kind: StepPropose, Order: priced, Text: SpokenSummaryText(priced, language)}
		}
		return Step{Kind: StepPropose, Order: priced, Text: SummaryText(priced, language)}
	case GapUnknownItem:
		return Step{Kind: StepHandover, Reason: "order_unclear"}
	}
	if ordering.Spoken {
		return Step{Kind: StepAsk, Text: SpokenQuestion(gap, ordering.Options, language)}
	}
	return Step{Kind: StepAsk, Text: Question(gap, ordering.Options, language)}
}
