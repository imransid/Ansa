package assistant

import (
	"context"
	"encoding/json"
	"regexp"
	"time"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/chat"
	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/jobs"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/secure"
)

// ReplyJobKind answers one customer message (queued by the channels).
const ReplyJobKind = "assistant.reply"

// What one run did.
const (
	OutcomeReplied    = "replied"
	OutcomeDrafted    = "drafted"
	OutcomeNoReply    = "no-reply"
	OutcomeHandedOver = "handed-over"
	OutcomeQuiet      = "quiet"
	OutcomeWaiting    = "waiting"
)

// The hourly limits (the old RATE_LIMITS, the same counters): per customer
// conversation (past it: quiet) and per business (past it: a person).
var (
	customerReplyLimit = ratelimit.Rule{MaxAttempts: 20, Window: time.Hour}
	companyReplyLimit  = ratelimit.Rule{MaxAttempts: 200, Window: time.Hour}
)

// Runner answers customer messages: the assistant (the old
// services/assistant-reply.ts). The AI's own text reaches a customer only
// after core's checks; anything else hands over to a person.
type Runner struct {
	Pool    *database.Pool
	Box     *secure.Box
	Limiter *ratelimit.Limiter
	Brain   *brainclient.Client
	Chat    *chat.Sender
	Log     *logging.Logger
	// Tests set the clock; nil = the real one.
	Now func() time.Time
}

type replyPayload struct {
	ConversationID   string `json:"conversationId"`
	TriggerMessageID string `json:"triggerMessageId"`
	// The catch-up's run for a message you didn't answer in time: ansa
	// answers now, whatever your away settings say.
	CoverAfterNoReply bool `json:"coverAfterNoReply"`
}

var idPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// HandleJob runs the "assistant.reply" job.
func (r *Runner) HandleJob(ctx context.Context, job *jobs.Job) error {
	var payload replyPayload
	if json.Unmarshal(job.Payload, &payload) != nil || !idPattern.MatchString(payload.ConversationID) || !idPattern.MatchString(payload.TriggerMessageID) {
		return &jobs.Failure{Code: "bad_payload", Permanent: true}
	}
	turn := conversations.Turn{CompanyID: job.CompanyID, ConversationID: payload.ConversationID, TriggerMessageID: payload.TriggerMessageID}
	outcome, err := r.Answer(ctx, turn, payload.CoverAfterNoReply)
	if err == nil {
		r.Log.Info("assistant: run finished", logging.Code(outcome))
	}
	return err
}

// Answer decides and does what the assistant does with one message. An
// error means nothing was decided (a database failure): the job tries again,
// and the gate makes sure a message is never answered twice.
func (r *Runner) Answer(ctx context.Context, turn conversations.Turn, coverAfterNoReply bool) (string, error) {
	gate, info, err := r.readGate(ctx, turn)
	if err != nil || gate != GateMay {
		return OutcomeQuiet, err
	}
	if !coverAfterNoReply {
		availability, err := ReadAvailability(ctx, r.Pool, turn.CompanyID)
		if err != nil {
			return "", err
		}
		switch cover, minutes := DecideCover(availability, r.now()); cover {
		case CoverLeave:
			return OutcomeQuiet, nil
		case CoverWait:
			return OutcomeWaiting, ScheduleCheck(ctx, r.Pool, turn.CompanyID, turn.ConversationID, minutes)
		}
	}
	if over, err := r.Limiter.Over(ctx, "assistant-customer", turn.ConversationID, customerReplyLimit); err != nil || over {
		return OutcomeQuiet, r.markHandledIf(ctx, turn, over, err)
	}
	inputs, err := GatherInputs(ctx, r.Pool, r.Box, turn.CompanyID, turn.ConversationID, r.now())
	if err != nil {
		return "", err
	}
	// Someone you marked important always comes to you: no AI answer at all.
	if info.Important {
		return OutcomeHandedOver, r.handOver(ctx, turn, info, inputs, Handover{Reason: "important_person", SendHoldingReply: true})
	}
	over, err := r.Limiter.Over(ctx, "assistant-replies", turn.CompanyID.String(), companyReplyLimit)
	if err != nil {
		return "", err
	}
	if over {
		return OutcomeHandedOver, r.handOver(ctx, turn, info, inputs, Handover{Reason: "reply_limit", SendHoldingReply: true})
	}
	decision := r.decide(ctx, inputs)
	switch decision.Kind {
	case "no_reply":
		return OutcomeNoReply, r.markHandledIf(ctx, turn, true, nil)
	case "reply":
		return r.sendOrDraft(ctx, turn, info, inputs, decision.Text)
	}
	return OutcomeHandedOver, r.handOver(ctx, turn, info, inputs, handoverFor(decision, inputs))
}

// decide asks the brain and checks its answer: a reply that passes, no
// reply, or why a person is needed (Kind "needs_person" or "failed").
func (r *Runner) decide(ctx context.Context, inputs *Inputs) Decision {
	if inputs.KeyUnreadable {
		return Decision{Kind: "failed", Reason: "model_unavailable"}
	}
	var decision Decision
	if err := r.Brain.Call(ctx, "/v1/assistant/reply", inputs.Request, &decision); err != nil {
		r.Log.Error("assistant: brain unavailable", logging.ErrorType(err))
		return Decision{Kind: "failed", Reason: "model_failed"}
	}
	switch decision.Kind {
	case "reply":
		if reason := CheckReply(decision.Text, inputs.Checks); reason != "" {
			return Decision{Kind: "failed", Reason: reason}
		}
		return decision
	case "no_reply", "needs_person":
		return decision
	case "failed":
		if decision.Reason != "model_unavailable" && decision.Reason != "unusable_answer" {
			decision.Reason = "model_failed"
		}
		return decision
	case "order_summary", "order_confirmed", "order_withdrawn":
		// Orders move to core in phase 3; until then a person takes them.
		return Decision{Kind: "failed", Reason: "order"}
	}
	return Decision{Kind: "failed", Reason: "unusable_answer"}
}

// handoverFor is the handover a decision asks for: the AI's subject,
// summary and category only when it asked for a person itself.
func handoverFor(decision Decision, inputs *Inputs) Handover {
	handover := Handover{Reason: decision.Reason, SendHoldingReply: true}
	if decision.Kind != "needs_person" {
		return handover
	}
	if _, known := aiHandoverReasons[decision.Reason]; !known {
		handover.Reason = "unsure"
	}
	handover.Subject = decision.Subject
	handover.Summary = decision.Summary
	handover.CategoryName = decision.Category
	return handover
}

// The reasons the AI itself may give (the brain's AI_HANDOVER_REASONS).
var aiHandoverReasons = map[string]struct{}{
	"unsure": {}, "complaint": {}, "refund": {}, "asked_for_person": {}, "order": {}, "needs_decision": {}, "order_change": {},
}

func (r *Runner) now() time.Time {
	if r.Now != nil {
		return r.Now()
	}
	return time.Now()
}
