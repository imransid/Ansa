package publishing

import (
	"context"
	"errors"

	"ansa/core/internal/contentrules"
	"ansa/core/internal/social"
	"ansa/core/internal/tenant"
)

// OutgoingPost is one post as a platform gets it.
type OutgoingPost struct {
	// The published text: body, call to action and hashtags, each its own
	// paragraph (YouTube: the video's description).
	Text string
	// A YouTube video's title ("" on every other platform).
	Title string
	// The image or video, read from storage right before sending; nil: a text post.
	Media *OutgoingMedia
}

// OutgoingMedia is a post's image or video: its kind ("image" or "video"),
// the type its bytes were stored with, its alt text (published with it).
type OutgoingMedia struct {
	Kind, ContentType, AltText string
	Bytes                      []byte
}

// ReadyAccount is a connected account ready for one post. Only
// core/internal/social decrypts (and renews) its token.
type ReadyAccount struct {
	// The platform's id of the account ("dev:stand-in" for the development stand-in).
	ExternalID string
	Token      string
	// The token as stored: a refusal marks the account only while it still
	// holds this one (a reconnect meanwhile stands).
	StoredToken string
	IsStandIn   bool
}

// ErrRenewalUnavailable: the platform didn't answer while ansa renewed the
// account's permission (X, Google). Nothing was sent; the post is tried
// again later ("token_refresh_unavailable"). A Sender's Ready returns it.
var ErrRenewalUnavailable = errors.New("publishing: the platform didn't answer the renewal")

// Sender is how core publishes to one platform.
type Sender struct {
	// Ready reads the account for one post (renewing its permission where
	// the platform allows): social.ErrNeedsReconnect, social.ErrNotConnected,
	// social.ErrNotUsable or ErrRenewalUnavailable when it can't be used now.
	Ready func(ctx context.Context, company tenant.CompanyID, connectionID string) (*ReadyAccount, error)
	// Publish sends the post to a real account. It creates the post itself,
	// so no answer (or one without an id) is "unclear": a person checks.
	Publish func(ctx context.Context, account *ReadyAccount, post OutgoingPost) PostResult
	// ansa's app for the platform is set up (a real account can post).
	SetUp bool
}

// senderFor is THE place where each platform's sending plugs in: the
// sender core publishes to a platform with, or nil when core doesn't send
// to it yet (its posts stay queued for the old runner, which claims them
// the same way). Today: Facebook, text and image posts. LinkedIn, X and
// YouTube: their connectors' senders go in OtherSenders (main.go), and the
// claim then takes their posts too (claimable).
func (r *Runner) senderFor(platform string) *Sender {
	if platform == "facebook" {
		return r.facebookSender()
	}
	return r.OtherSenders[platform]
}

// claimable are the "platform:format" pairs core sends now: those ansa
// publishes (contentrules.PublishedFormats) to a platform with a sender.
func (r *Runner) claimable() []string {
	pairs := []string{}
	for _, platform := range contentrules.Platforms {
		if r.senderFor(platform) == nil {
			continue
		}
		for _, format := range contentrules.PublishedFormats[platform] {
			pairs = append(pairs, platform+":"+format)
		}
	}
	return pairs
}

// facebookSender posts to a Facebook Page with its Page token.
func (r *Runner) facebookSender() *Sender {
	ready := func(ctx context.Context, company tenant.CompanyID, connectionID string) (*ReadyAccount, error) {
		page, err := social.PageForPosting(ctx, r.Pool, r.Box, company, connectionID)
		if err != nil {
			return nil, err
		}
		return &ReadyAccount{ExternalID: page.ExternalID, Token: page.Token, StoredToken: page.StoredToken, IsStandIn: page.IsStandIn}, nil
	}
	publish := func(ctx context.Context, account *ReadyAccount, post OutgoingPost) PostResult {
		return r.PublishFacebook(ctx, r.FacebookAppSecret, account.ExternalID, account.Token, post)
	}
	return &Sender{Ready: ready, Publish: publish, SetUp: r.FacebookAppSecret != ""}
}
