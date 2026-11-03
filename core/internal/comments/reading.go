package comments

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/assistant"
	"ansa/core/internal/messenger"
	"ansa/core/internal/orders"
	"ansa/core/internal/social"
	"ansa/core/internal/tenant"
)

// How much of the post the brain reads (the post itself is never stored),
// and of the comment (the smallest slice that does the job).
const (
	postTextMax    = 1_000
	commentTextMax = 2_000
)

// BrainRequest is what core sends the brain for one comment: ONE company's
// slice (the business's own details exactly as the chat assistant reads
// them), the post and the comment, never an id. Its JSON names match the
// brain's CommentRequest (brain/brain/comments/models.py), which refuses
// any field it doesn't know.
type BrainRequest struct {
	Kind              string               `json:"kind"`
	Business          assistant.Business   `json:"business"`
	Hours             *assistant.Hours     `json:"hours"`
	Ordering          assistant.Ordering   `json:"ordering"`
	Orders            assistant.Orders     `json:"orders"`
	Menu              []assistant.MenuItem `json:"menu"`
	NotAvailableToday []string             `json:"not_available_today"`
	Instructions      string               `json:"instructions"`
	Knowledge         string               `json:"knowledge"`
	Categories        []string             `json:"categories"`
	// The post the comment is under (the business's own words, at most
	// 1,000 characters; "" when ansa can't read it) and the comment.
	Post    string  `json:"post"`
	Comment string  `json:"comment"`
	Engine  string  `json:"engine"`
	APIKey  *string `json:"api_key"`
}

// BrainAnswer is the brain's proposal (brain/brain/comments/answer.py):
// Kind is what it read the comment as, or "failed" (Reason says why).
type BrainAnswer struct {
	Kind           string `json:"kind"`
	PublicReply    string `json:"public_reply"`
	PrivateMessage string `json:"private_message"`
	Subject        string `json:"subject"`
	Summary        string `json:"summary"`
	Category       string `json:"category"`
	Reason         string `json:"reason"`
}

// reading is everything one answer needs: the brain's slice and what core
// checks the answer against and sends with it.
type reading struct {
	Request                         BrainRequest
	Checks                          assistant.CheckData
	Name, Kind, HoldingReply, Reply string
	OwnKey, KeyUnreadable           bool
}

// gather reads the business's own details as the chat assistant does
// (assistant.GatherInputs: name, details, hours, today's menu by label and
// the dishes not available today, instructions, categories), the saved
// answers matching the comment, and the post's text.
func (a *Answerer) gather(ctx context.Context, company tenant.CompanyID, c *comment, text string, standIn bool) (*reading, error) {
	inputs, err := assistant.GatherInputs(ctx, a.Pool, a.Box, company, "", a.now())
	if err != nil {
		return nil, fmt.Errorf("inputs: %w", err)
	}
	inputs.Request.Conversation = []assistant.Line{{Sender: "customer", Text: text}}
	if err := inputs.AddKnowledge(ctx, a.Pool, company); err != nil {
		return nil, err
	}
	post := a.postText(ctx, company, c, standIn)
	in := inputs.Request
	request := BrainRequest{Kind: in.Kind, Business: in.Business, Hours: in.Hours, Ordering: in.Ordering,
		Orders: assistant.Orders{TakesOrders: in.Orders.TakesOrders, DeliveryFee: in.Orders.DeliveryFee, InProgress: []string{}, Placed: []string{}},
		Menu:   in.Menu, NotAvailableToday: in.NotAvailableToday, Instructions: in.Instructions, Knowledge: in.Knowledge, Categories: in.Categories,
		Post: post, Comment: cutRunes(text, commentTextMax), Engine: in.Engine, APIKey: in.APIKey}
	checks := inputs.Checks
	// The post is the business's own words: a price or a link in it may be repeated.
	checks.OwnerTexts = append(checks.OwnerTexts, post)
	return &reading{Request: request, Checks: checks, Name: inputs.Name, Kind: inputs.Kind, HoldingReply: inputs.HoldingReply, Reply: inputs.ReplyMode,
		OwnKey: inputs.OwnKey, KeyUnreadable: inputs.KeyUnreadable}, nil
}

// planInputs is what core decides with, for this comment.
func (r *reading) planInputs(commentID, text string) planInputs {
	return planInputs{Checks: r.Checks, Name: r.Name, AccountKind: r.Kind, HoldingReply: r.HoldingReply, ReplyMode: r.Reply,
		Language: orders.LanguageOf(text), CommentID: commentID}
}

// postText is the post's own text: Meta's for a real Page (with the Page's
// token), else the text of the post ansa published (a stand-in Page's, or a
// real one Meta didn't give). "" when neither is there.
func (a *Answerer) postText(ctx context.Context, company tenant.CompanyID, c *comment, standIn bool) string {
	if !standIn && a.MetaAppSecret != "" {
		token, err := social.PageToken(ctx, a.Pool, a.Box, company, c.ConnectionID)
		if err == nil {
			if text := messenger.PostText(ctx, a.MetaAppSecret, c.PostID, token, postTextMax); text != "" {
				return text
			}
		}
	}
	text, err := PublishedPostText(ctx, a.Pool, company, c.PostID)
	if err != nil {
		return ""
	}
	return cutRunes(text, postTextMax)
}

// PublishedPostText is the text of a post ansa published (its draft's
// body), or the development practice post's; "" for a post ansa didn't
// publish.
func PublishedPostText(ctx context.Context, db reader, company tenant.CompanyID, postID string) (string, error) {
	if postID == PracticePostID {
		return PracticePostText, nil
	}
	const statement = `
		SELECT content_drafts.body FROM publish_jobs
		JOIN content_drafts ON content_drafts.id = publish_jobs.draft_id AND content_drafts.company_id = publish_jobs.company_id
		WHERE publish_jobs.company_id = $1 AND publish_jobs.external_post_id = $2 AND publish_jobs.status = 'published'
		ORDER BY publish_jobs.published_at DESC
		LIMIT 1`
	var body string
	err := db.QueryRow(ctx, statement, company.String(), postID).Scan(&body)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return strings.TrimSpace(body), err
}

func cutRunes(text string, max int) string {
	if runes := []rune(text); len(runes) > max {
		return string(runes[:max])
	}
	return text
}
