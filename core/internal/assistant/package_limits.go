package assistant

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/conversations"
	"ansa/core/internal/packages"
)

// The company's package (step 57, core/internal/packages) before ansa's AI
// writes: a channel the package doesn't include, or a month whose AI
// replies are used up (or a free trial that ended), hands over with the
// holding reply: ansa never goes silent, it only stops writing with the AI.

// packageRefusal is why the package refuses this answer ("" = it may go),
// counting the reply when it may (never with the business's own key, which
// it pays for itself).
func (r *Runner) packageRefusal(ctx context.Context, turn conversations.Turn, info conversationInfo, inputs *Inputs) (string, error) {
	if info.Channel == conversations.ChannelMessenger && !inputs.Package.Messenger {
		return "not_in_package", nil
	}
	if inputs.OwnKey || inputs.KeyUnreadable {
		return "", nil
	}
	taken, err := packages.TakeAIReply(ctx, r.Pool, turn.CompanyID, r.now())
	if err != nil || taken {
		return "", err
	}
	return "package_used_up", nil
}

// callTimeLeft: whether the package still has call minutes this month,
// counting the live call's time so far.
func (r *Runner) callTimeLeft(ctx context.Context, turn conversations.Turn) (bool, error) {
	var started time.Time
	const live = `SELECT started_at FROM phone_calls WHERE company_id = $1 AND conversation_id = $2 AND ended_at IS NULL`
	err := r.Pool.QueryRow(ctx, live, turn.CompanyID.String(), turn.ConversationID).Scan(&started)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}
	seconds := 0
	if err == nil {
		seconds = int(r.now().Sub(started).Seconds())
	}
	return packages.CallTimeLeft(ctx, r.Pool, turn.CompanyID, r.now(), seconds)
}
