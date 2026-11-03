package autopost

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/assistant"
	"ansa/core/internal/brainclient"
	"ansa/core/internal/contentrules"
	"ansa/core/internal/database"
	"ansa/core/internal/drafts"
	"ansa/core/internal/hours"
	"ansa/core/internal/logging"
	"ansa/core/internal/menu"
	"ansa/core/internal/money"
	"ansa/core/internal/publishing"
	"ansa/core/internal/secure"
	"ansa/core/internal/settings"
	"ansa/core/internal/setup"
	"ansa/core/internal/tenant"
)

// How many earlier posts the topic brain reads, and how many offers the AI gets.
const (
	historyRead = 30
	offersSent  = 40
)

// Writer writes one company's posts. LOGGING RULE: never the post, the
// prompt or the AI's answer: fixed lines with codes only.
type Writer struct {
	Pool  *database.Pool
	Box   *secure.Box
	Brain *brainclient.Client
	Log   *logging.Logger
}

// WriteOutcome is what came of one posting time: "scheduled" (with its
// jobs), "waiting_approval", "skipped" or "taken" (another run has it).
type WriteOutcome struct {
	Outcome string
	JobIDs  []string
}

// brainPost is the brain's answer.
type brainPost struct {
	Kind         string   `json:"kind"`
	Reason       string   `json:"reason"`
	ErrorName    string   `json:"error_name"`
	Body         string   `json:"body"`
	CallToAction string   `json:"call_to_action"`
	Hashtags     []string `json:"hashtags"`
}

// WritePostFor writes one post for one company and posting time: ansa's
// topic brain picks what to post about (learning from the numbers of the
// posts before), the brain writes it from the business's own details only,
// ansa's checks read it (a second try on another kind when they stop it),
// and it becomes a draft in the owner's name, scheduled under the owner's
// "Post for me" rule (Automatic) or waiting for an owner (Ask me first).
// The posting time is claimed first, so two runs write it once.
func (w *Writer) WritePostFor(ctx context.Context, company Company, postAt time.Time) (WriteOutcome, error) {
	zone, err := time.LoadLocation(company.TimeZone)
	if err != nil {
		return WriteOutcome{}, err
	}
	details, err := w.readDetails(ctx, company.ID)
	if err != nil {
		return WriteOutcome{}, err
	}
	local := postAt.In(zone)
	brainInput := BrainInput{BusinessType: details.businessType, Items: details.itemNames, Date: local.Format("2006-01-02"), Weekday: local.Weekday().String(), History: details.history}
	choice := ChooseNextPost(brainInput)
	slotID, err := claimPostingTime(ctx, w.Pool, company.ID, postAt, choice)
	if err != nil || slotID == "" {
		return WriteOutcome{Outcome: "taken"}, err
	}
	if len(details.pages) == 0 {
		return w.skip(ctx, company.ID, slotID, "no_page", 0)
	}
	if details.keyUnreadable {
		return w.skip(ctx, company.ID, slotID, "no_ai", 0)
	}
	if allowed, err := w.packageAllows(ctx, company, details); err != nil || !allowed {
		if err != nil {
			return WriteOutcome{}, err
		}
		return w.skip(ctx, company.ID, slotID, "package", 0)
	}
	request := details.request
	var post *Post
	failure := "checks_failed"
	attempts := 0
	for ; attempts < 2 && post == nil; attempts++ {
		if attempts > 0 {
			brainInput.Skip = []string{choice.Kind}
			choice = ChooseNextPost(brainInput)
		}
		request["post"] = map[string]any{"kind_label": KindLabels[choice.Kind], "topic": choice.Topic, "item_name": choice.ItemName,
			"special_day": choice.SpecialDay, "day": local.Weekday().String() + " " + local.Format("2006-01-02")}
		var answer brainPost
		if err := w.Brain.Call(ctx, "/v1/posts/write", request, &answer); err != nil || answer.Kind != "ok" {
			if answer.Reason == "model_unavailable" {
				return w.skip(ctx, company.ID, slotID, "no_ai", attempts+1)
			}
			w.Log.Warn("post for me: the AI failed", logging.Code(firstNonEmpty(answer.ErrorName, answer.Reason, "no_answer")))
			failure = "ai_failed"
			continue
		}
		written := Post{Body: answer.Body, CallToAction: answer.CallToAction, Hashtags: answer.Hashtags}
		if CheckText(written, details.checks) {
			post = &written
		}
	}
	if post == nil {
		return w.skip(ctx, company.ID, slotID, failure, attempts)
	}
	return w.saveAndSchedule(ctx, company, slotID, postAt, choice, *post, details.pages, attempts)
}

// saveAndSchedule saves the post as a draft in the owner's name, then
// schedules it (Automatic) or leaves it for an owner (Ask me first, or when
// the queue refuses it: the rule was switched off or its owner left).
func (w *Writer) saveAndSchedule(ctx context.Context, company Company, slotID string, postAt time.Time, choice Choice, post Post, pages []string, attempts int) (WriteOutcome, error) {
	draft := drafts.NewDraft{Platform: "facebook", Format: "post", Topic: cut(choice.Topic, 200), Body: post.Body, CallToAction: post.CallToAction, Hashtags: post.Hashtags, Generated: true}
	draftID, err := drafts.Create(ctx, w.Pool, company.ID, company.EnabledByUserID, draft)
	if errors.Is(err, drafts.ErrNotAllowed) {
		return w.skip(ctx, company.ID, slotID, "not_owner", attempts)
	}
	if err != nil {
		return WriteOutcome{}, err
	}
	status := SlotWaitingApproval
	var jobIDs []string
	if company.Mode == "automatic" {
		request := publishing.ScheduleRequest{DraftID: draftID, ShownVersion: 1, ConnectionIDs: pages, At: &postAt, WithoutApproval: true}
		scheduled, err := publishing.Schedule(ctx, w.Pool, company.ID, company.EnabledByUserID, request)
		if err != nil {
			return WriteOutcome{}, err
		}
		if scheduled.Outcome == "scheduled" {
			status, jobIDs = SlotScheduled, scheduled.JobIDs
		} else {
			w.Log.Warn("post for me: not scheduled, an owner approves it", logging.Code(scheduled.Outcome))
		}
	}
	if err := finishPostingTime(ctx, w.Pool, company.ID, slotID, status, draftID, "", choice, attempts); err != nil {
		return WriteOutcome{}, err
	}
	return WriteOutcome{Outcome: status, JobIDs: jobIDs}, nil
}

func (w *Writer) skip(ctx context.Context, company tenant.CompanyID, slotID, reason string, attempts int) (WriteOutcome, error) {
	return WriteOutcome{Outcome: SlotSkipped}, finishPostingTime(ctx, w.Pool, company, slotID, SlotSkipped, "", reason, Choice{}, attempts)
}

// details is what one post is written from and checked against.
type details struct {
	businessType  string
	itemNames     []string
	history       []PastPost
	pages         []string
	keyUnreadable bool
	// The business's own Claude key writes (its posts aren't counted against its package).
	ownKey  bool
	request map[string]any
	checks  CheckData
}

// readDetails reads the business's own details: what it is, its offers
// with their prices, its hours, the owner's instructions and words to
// avoid, its newest posts, its connected Facebook Pages and its AI engine.
// Nothing about customers or the account.
func (w *Writer) readDetails(ctx context.Context, company tenant.CompanyID) (*details, error) {
	var businessType, companyName string
	const companyRow = `SELECT COALESCE(business_type, ''), name FROM companies WHERE id = $1`
	if err := w.Pool.QueryRow(ctx, companyRow, company.String()).Scan(&businessType, &companyName); err != nil {
		return nil, err
	}
	view, err := settings.Read(ctx, w.Pool, company)
	if err != nil {
		return nil, err
	}
	facts, err := drafts.ConfirmedFacts(ctx, w.Pool, company)
	if err != nil {
		return nil, err
	}
	items, err := menu.List(ctx, w.Pool, company)
	if err != nil {
		return nil, err
	}
	slots, err := ListPostingTimes(ctx, w.Pool, company, historyRead)
	if err != nil {
		return nil, err
	}
	d := &details{businessType: businessType}
	if d.pages, err = connectedPages(ctx, w.Pool, company); err != nil {
		return nil, err
	}
	apiKey, unreadable, err := w.ownKey(ctx, company, view.Engine)
	if err != nil {
		return nil, err
	}
	d.keyUnreadable = unreadable
	d.ownKey = apiKey != nil
	currency := "EUR"
	if view.Currency != nil {
		currency = *view.Currency
	}
	ownerTexts := []string{view.Instructions, view.DeliveryNote, view.PaymentNote, facts["description"]}
	var prices []int64
	offers := []string{}
	for _, item := range items {
		if !item.Available {
			continue
		}
		d.itemNames = append(d.itemNames, item.Name)
		prices = append(prices, item.PriceCents)
		ownerTexts = append(ownerTexts, item.Description)
		if len(offers) < offersSent {
			offers = append(offers, joinNonEmpty(" | ", item.Name, money.Format(item.PriceCents, currency), item.Description))
		}
	}
	recent := []string{}
	for _, slot := range slots {
		if slot.Status != SlotSkipped {
			d.history = append(d.history, PastPost{Kind: slot.Kind, ItemName: slot.ItemName, SpecialDay: slot.SpecialDay, Engagement: slot.Engagement})
		}
		if slot.Body != nil && *slot.Body != "" && len(recent) < 5 {
			recent = append(recent, cut(strings.SplitN(*slot.Body, "\n", 2)[0], 200))
		}
	}
	wordsToAvoid := contentrules.ReadWordsToAvoid(facts["words_to_avoid"])
	if wordsToAvoid == nil {
		// None: an empty list, as the brain reads every list strictly (null is refused).
		wordsToAvoid = []string{}
	}
	d.checks = CheckData{CheckData: assistant.CheckData{Currency: currency, MenuPrices: prices, OwnerTexts: ownerTexts}, WordsToAvoid: wordsToAvoid}
	label := setup.BusinessTypeLabels[businessType]
	if label == "" {
		label = "Business"
	}
	d.request = map[string]any{
		"engine":         view.Engine,
		"api_key":        apiKey,
		"business":       map[string]any{"name": firstNonEmpty(facts["company_name"], companyName), "type": label, "description": facts["description"], "address": facts["location"]},
		"hours":          hoursLines(view.OpeningHours),
		"offers":         offers,
		"instructions":   view.Instructions,
		"words_to_avoid": wordsToAvoid,
		"recent_posts":   recent,
	}
	return d, nil
}

// ownKey is the business's own Claude key when its engine uses one: nil
// for ansa's; unreadable = it saved one that can't be read (ansa's is never
// used in its place: nobody pays unaware).
func (w *Writer) ownKey(ctx context.Context, company tenant.CompanyID, engine string) (key *string, unreadable bool, err error) {
	if engine != "api_key" {
		return nil, false, nil
	}
	var encrypted *string
	if err := w.Pool.QueryRow(ctx, `SELECT anthropic_key_encrypted FROM assistant_settings WHERE company_id = $1`, company.String()).Scan(&encrypted); err != nil || encrypted == nil {
		return nil, false, ignoreNoRows(err)
	}
	plain, err := w.Box.Decrypt(*encrypted, assistant.KeyContext(company))
	if err != nil {
		return nil, true, nil
	}
	return &plain, false, nil
}

// connectedPages are the company's connected Facebook Pages, oldest first.
func connectedPages(ctx context.Context, pool *database.Pool, company tenant.CompanyID) ([]string, error) {
	const statement = `SELECT id FROM social_connections WHERE company_id = $1 AND platform = 'facebook' AND status = 'connected' ORDER BY connected_at`
	rows, err := pool.Query(ctx, statement, company.String())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var pages []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		pages = append(pages, id)
	}
	return pages, rows.Err()
}

func ignoreNoRows(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	return err
}

func hoursLines(raw []byte) []string {
	lines := []string{}
	week, ok := hours.Parse(raw)
	if !ok {
		return lines
	}
	for _, day := range hours.Weekdays {
		lines = append(lines, day.Label+": "+hours.DescribeDay(week[day.Key]))
	}
	return lines
}

func joinNonEmpty(separator string, parts ...string) string {
	var kept []string
	for _, part := range parts {
		if strings.TrimSpace(part) != "" {
			kept = append(kept, part)
		}
	}
	return strings.Join(kept, separator)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
