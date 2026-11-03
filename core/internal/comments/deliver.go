package comments

import (
	"context"

	"ansa/core/internal/messenger"
	"ansa/core/internal/tenant"
)

// deliverDue sends the parts saved "sending": the private message first
// (the public note announces it), then the public reply, each recorded as
// sent, failed or unclear; then the comment's final status. A run cut off
// after it started sending never sends again by itself: what it left
// "sending" becomes "unclear" (it may have gone out), as for chat replies.
func (a *Answerer) deliverDue(ctx context.Context, company tenant.CompanyID, c *comment) (string, error) {
	if !isSending(c.PublicStatus) && !isSending(c.PrivateStatus) {
		return c.Status, nil
	}
	if c.DeliveryStartedAt != nil {
		return "cut_off", settleCutOff(ctx, a.Pool, company, c.ID)
	}
	claimed, err := claimDelivery(ctx, a.Pool, company, c.ID)
	if err != nil || !claimed {
		return "taken", err
	}
	found, err := readSwitches(ctx, a.Pool, company, c.ConnectionID)
	if err != nil {
		return "", err
	}
	privateFailed := false
	if isSending(c.PrivateStatus) {
		result := a.sendPrivately(ctx, company, c, found)
		privateFailed = result.Status == PartFailed
		if err := a.recordPrivate(ctx, company, c, result); err != nil {
			return "", err
		}
	}
	if isSending(c.PublicStatus) {
		result := a.replyPublicly(ctx, company, c, found)
		if privateFailed {
			// The note says a message was sent: without one it isn't posted.
			result = messenger.Result{Status: PartFailed, Error: "private_message_failed"}
		}
		if err := recordPart(ctx, a.Pool, company, c.ID, "public", result); err != nil {
			return "", err
		}
	}
	return settle(ctx, a.Pool, company, c.ID)
}

// sendPrivately sends the private message: Meta's private reply to the
// comment (a stand-in Page's goes to a file, development only).
func (a *Answerer) sendPrivately(ctx context.Context, company tenant.CompanyID, c *comment, found switches) messenger.PrivateReplyResult {
	text, err := a.Box.Decrypt(*c.PrivateEncrypted, TextContext(company, c.ID, "private_message"))
	switch {
	case err != nil:
		return messenger.PrivateReplyResult{Result: messenger.Result{Status: PartFailed, Error: "refused"}}
	case !found.PageConnected:
		return messenger.PrivateReplyResult{Result: messenger.Result{Status: PartFailed, Error: "not_connected"}}
	case !found.PageCanMessage:
		return messenger.PrivateReplyResult{Result: messenger.Result{Status: PartFailed, Error: "cannot_reply"}}
	case found.PageStandIn:
		result := a.writeStandIn(c, "private_message", text)
		return messenger.PrivateReplyResult{Result: result, RecipientID: c.CommenterID}
	}
	token, ok := a.pageToken(ctx, company, c)
	if !ok {
		return messenger.PrivateReplyResult{Result: messenger.Result{Status: PartFailed, Error: "not_connected"}}
	}
	return messenger.SendPrivateReply(ctx, a.MetaAppSecret, c.PageID, token, c.CommentID, text)
}

// replyPublicly posts the public reply under the comment (a stand-in
// Page's goes to a file, development only).
func (a *Answerer) replyPublicly(ctx context.Context, company tenant.CompanyID, c *comment, found switches) messenger.Result {
	text, err := a.Box.Decrypt(*c.PublicEncrypted, TextContext(company, c.ID, "public_reply"))
	switch {
	case err != nil:
		return messenger.Result{Status: PartFailed, Error: "refused"}
	case !found.PageConnected || !found.PageAllowed:
		return messenger.Result{Status: PartFailed, Error: "not_connected"}
	case found.PageStandIn:
		return a.writeStandIn(c, "public_reply", text)
	}
	token, ok := a.pageToken(ctx, company, c)
	if !ok {
		return messenger.Result{Status: PartFailed, Error: "not_connected"}
	}
	return messenger.ReplyUnderComment(ctx, a.MetaAppSecret, c.CommentID, token, text)
}

// recordPrivate records the private message's outcome; one Meta delivered
// to a commenter it named also joins their Messenger conversation.
func (a *Answerer) recordPrivate(ctx context.Context, company tenant.CompanyID, c *comment, result messenger.PrivateReplyResult) error {
	if err := recordPart(ctx, a.Pool, company, c.ID, "private", result.Result); err != nil {
		return err
	}
	if result.Status != PartSent || result.RecipientID == "" {
		return nil
	}
	text, err := a.Box.Decrypt(*c.PrivateEncrypted, TextContext(company, c.ID, "private_message"))
	if err != nil {
		return nil
	}
	return a.joinConversation(ctx, company, c, result, text)
}
