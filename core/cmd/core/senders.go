package main

import (
	"context"

	"ansa/core/internal/platforms"
	"ansa/core/internal/publishing"
	"ansa/core/internal/social"
	"ansa/core/internal/tenant"
)

// connectorSenders are the publishing queue's senders for LinkedIn, X and
// YouTube: the account made ready by the renewer (its permission renewed
// first where the platform allows), then the platform's connector.
func connectorSenders(renewer *social.Renewer, connectors *platforms.Connectors) map[string]*publishing.Sender {
	senders := map[string]*publishing.Sender{}
	for _, platform := range []string{"linkedin", "x", "youtube"} {
		senders[platform] = connectorSender(platform, renewer, connectors)
	}
	return senders
}

func connectorSender(platform string, renewer *social.Renewer, connectors *platforms.Connectors) *publishing.Sender {
	ready := func(ctx context.Context, company tenant.CompanyID, connectionID string) (*publishing.ReadyAccount, error) {
		prepared, err := renewer.Prepare(ctx, company, connectionID)
		if err != nil {
			return nil, err
		}
		account := &publishing.ReadyAccount{ExternalID: prepared.ExternalID, Token: prepared.Token, StoredToken: prepared.StoredToken, IsStandIn: prepared.IsStandIn}
		switch {
		case prepared.Kind == "ready":
			return account, nil
		case prepared.Kind == "needs_reauth":
			return nil, social.ErrNeedsReconnect
		case prepared.Kind == "disconnected", prepared.Kind == "not_found":
			return nil, social.ErrNotConnected
		case prepared.Code == "token_unreadable":
			return nil, social.ErrNotUsable
		case prepared.Code == "not_set_up":
			// The queue then fails it "platform_not_set_up" (this sender isn't set up).
			return account, nil
		}
		return nil, publishing.ErrRenewalUnavailable
	}
	publish := func(ctx context.Context, account *publishing.ReadyAccount, post publishing.OutgoingPost) publishing.PostResult {
		outgoing := platforms.Post{Text: post.Text, Title: post.Title}
		if post.Media != nil {
			outgoing.Media = &platforms.Media{Kind: post.Media.Kind, ContentType: post.Media.ContentType, Bytes: post.Media.Bytes, AltText: post.Media.AltText}
		}
		result := connectors.Publish(ctx, platform, false, platforms.Target{ExternalID: account.ExternalID, Token: account.Token}, outgoing)
		return publishing.PostResult{Kind: result.Kind, Code: result.Code, PostID: result.PostID, URL: result.URL, RetryAfterSeconds: result.RetryAfterSeconds}
	}
	return &publishing.Sender{Ready: ready, Publish: publish, SetUp: connectors.Mode(platform) == "real"}
}
