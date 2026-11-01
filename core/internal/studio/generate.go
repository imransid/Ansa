package studio

import (
	"context"
	"strings"
	"time"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/database"
	"ansa/core/internal/drafts"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/tenant"
)

// The AI's part of the content studio (the old services/content-generation.ts):
// a new draft written by the brain, and new text for a draft that exists
// (Regenerate). Anyone in the company. A text the AI couldn't write, or
// wrote in a shape core can't use, saves NOTHING: no new draft, and a
// regenerated one keeps its content.
//
// LOGGING RULE: never the facts, the articles, the topic, the request or
// the AI's answer: fixed lines and codes only.

// Generations: 30 an hour per company (each is a paid AI call), the old counter.
var Generations = ratelimit.Rule{MaxAttempts: 30, Window: time.Hour}

// The page's words when nothing was written.
const (
	aiUnavailable     = "The AI isn't available right now, so nothing was written. Try again later, or write the draft yourself."
	aiUnusable        = "The AI's text came back in a form that can't be used, so nothing was saved. Try again."
	aiFailed          = "The AI couldn't write the draft just now, so nothing was saved. Try again in a few minutes."
	tooManyAIDrafts   = "Your company asked the AI for a lot of drafts this hour. Wait a while and try again."
	staleBeforeAI     = "Someone changed this draft after you opened it, so the AI wasn't asked. Reload the page to see their change."
	staleWhileWriting = "Someone changed this draft while the AI was writing, so the AI's text was not saved. Reload the page to see their change."
)

// Writer asks the brain for drafts.
type Writer struct {
	Pool    *database.Pool
	Brain   *brainclient.Client
	Limiter *ratelimit.Limiter
	Log     *logging.Logger
}

// Result is a generation's outcome: a draft written (Outcome "created" or
// Changed, with the draft's id), or why not in the page's words (Refusal).
type Result struct {
	Outcome, DraftID, Refusal string
}

// Generate writes a new draft with the AI and saves it.
func (w *Writer) Generate(ctx context.Context, company tenant.CompanyID, actorUserID string, d NewDraft) (Result, error) {
	generated, refusal, err := w.write(ctx, company, DraftRequest(d))
	if err != nil || refusal != "" {
		return Result{Refusal: refusal}, err
	}
	id, outcome, err := Create(ctx, w.Pool, company, actorUserID, d, generated)
	if err != nil || outcome != "created" {
		return Result{Outcome: outcome}, err
	}
	return Result{Outcome: "created", DraftID: id}, nil
}

// Regenerate writes new content for one draft as its next version, when
// nobody changed it since the version the page showed. A draft that is
// archived, or changed since, is refused BEFORE the AI is asked (a paid
// call, and one of the company's hourly drafts); both are checked again
// where the text is saved, locked.
func (w *Writer) Regenerate(ctx context.Context, company tenant.CompanyID, actorUserID, draftID string, version int) (Result, error) {
	draft, err := drafts.Read(ctx, w.Pool, company, draftID)
	switch {
	case err != nil:
		return Result{}, err
	case draft == nil:
		return Result{Outcome: NotFound}, nil
	case !drafts.In(drafts.EditableStatuses, draft.Status):
		return Result{Outcome: WrongStatus}, nil
	case draft.Version != version:
		return Result{Outcome: Stale, Refusal: staleBeforeAI}, nil
	}
	request := DraftRequest{Platform: draft.Platform, Format: draft.Format, Placement: Placement{Topic: draft.Topic, Pillar: draft.Pillar, Campaign: draft.Campaign}}
	generated, refusal, err := w.write(ctx, company, request)
	if err != nil || refusal != "" {
		return Result{Refusal: refusal}, err
	}
	outcome, err := SaveRegenerated(ctx, w.Pool, company, actorUserID, draftID, version, *generated)
	if outcome == Stale {
		return Result{Outcome: Stale, Refusal: staleWhileWriting}, err
	}
	return Result{Outcome: outcome, DraftID: draftID}, err
}

// write asks the brain for one draft, after what a draft needs and the
// hourly limit; nothing is saved here. A refusal is in the page's words.
func (w *Writer) write(ctx context.Context, company tenant.CompanyID, r DraftRequest) (*Generated, string, error) {
	facts, err := drafts.ConfirmedFacts(ctx, w.Pool, company)
	if err != nil {
		return nil, "", err
	}
	// The facts a plan can't do without: without them the AI could only guess.
	if missing := drafts.MissingForTheAI(facts); len(missing) > 0 {
		return nil, "The AI needs these facts confirmed first: " + strings.Join(missing, ", ") + ". Confirm or fill them in on the Profile page, or start a blank draft.", nil
	}
	if over, err := w.Limiter.Over(ctx, "content-generations", company.String(), Generations); err != nil || over {
		return nil, tooManyAIDrafts, err
	}
	in, err := gatherInputs(ctx, w.Pool, company, facts, r)
	if err != nil {
		return nil, "", err
	}
	var answer brainAnswer
	if err := w.Brain.Call(ctx, "/v1/content/draft", in.request, &answer); err != nil || answer.Kind != "ok" {
		return nil, w.describeFailure(answer), nil
	}
	sent := map[string]bool{}
	for topic := range facts {
		sent[topic] = true
	}
	written := readAnswer(answer.Draft, r, sent)
	if written == nil {
		return nil, aiUnusable, nil
	}
	written.FactsUsed = drafts.OrderedFacts(facts)
	written.KnowledgeUsed, written.PlanVersion = in.knowledgeUsed, in.planVersion
	return written, "", nil
}

// describeFailure is why no text came back, in plain words (never a
// setting or an error's text); the log line has the code.
func (w *Writer) describeFailure(answer brainAnswer) string {
	switch answer.Reason {
	case "model_unavailable":
		return aiUnavailable
	case "unusable_answer":
		return aiUnusable
	}
	code := answer.ErrorName
	if code == "" {
		code = "no_answer"
	}
	w.Log.Warn("content studio: the AI failed", logging.Code(code))
	return aiFailed
}
