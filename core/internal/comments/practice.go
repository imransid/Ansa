package comments

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/messenger"
	"ansa/core/internal/secure"
	"ansa/core/internal/standins"
	"ansa/core/internal/tenant"
)

// The development practice comment box (the demo's commenter side): an
// owner writes a comment as a made-up person under a post of the
// company's stand-in Facebook Page, saved through the same path as a
// comment from Meta's webhook. Development only: the API refuses it in
// production, and stand-ins never answer there.

// The fixed stand-in post, so the demo always has one to comment on.
const (
	PracticePostID   = "dev-post-todays-special"
	PracticePostText = "Today's special: Kacchi Biryani, cooked fresh this morning."
)

// How many of the stand-in Page's published posts the box offers.
const practicePosts = 10

// ErrNoStandInPage: the company has no stand-in Facebook Page connected.
var ErrNoStandInPage = errors.New("comments: no stand-in Facebook Page")

// ErrUnknownPost: not one of the posts the box offers.
var ErrUnknownPost = errors.New("comments: not a post of the stand-in Page")

// PracticePost is one post a practice comment can go under.
type PracticePost struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

// PracticePosts are the stand-in Page's newest published posts (their
// first 300 characters), or the fixed stand-in post when it has none.
func PracticePosts(ctx context.Context, pool *database.Pool, company tenant.CompanyID) ([]PracticePost, error) {
	const statement = `
		SELECT publish_jobs.external_post_id, content_drafts.body FROM publish_jobs
		JOIN social_connections ON social_connections.id = publish_jobs.connection_id AND social_connections.company_id = publish_jobs.company_id
		JOIN content_drafts ON content_drafts.id = publish_jobs.draft_id AND content_drafts.company_id = publish_jobs.company_id
		WHERE publish_jobs.company_id = $1 AND publish_jobs.status = 'published' AND publish_jobs.external_post_id IS NOT NULL
			AND social_connections.platform = 'facebook' AND social_connections.is_stand_in
		ORDER BY publish_jobs.published_at DESC, publish_jobs.id
		LIMIT $2`
	rows, err := pool.Query(ctx, statement, company.String(), practicePosts)
	if err != nil {
		return nil, err
	}
	posts := []PracticePost{}
	for rows.Next() {
		var post PracticePost
		if err := rows.Scan(&post.ID, &post.Text); err != nil {
			rows.Close()
			return nil, err
		}
		post.Text = cutRunes(post.Text, 300)
		posts = append(posts, post)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(posts) == 0 {
		posts = append(posts, PracticePost{ID: PracticePostID, Text: PracticePostText})
	}
	return posts, nil
}

// SavePractice saves a made-up person's comment under one of those posts,
// as the webhook saves Meta's: the stand-in Page's id, the commenter by
// their name as the practice chat names its Messenger customers (so their
// Messenger chat is the same), a comment id of its own. The comment's id.
func SavePractice(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, postID, name, text string) (string, error) {
	pageID, connectionID, err := standInPage(ctx, pool, company)
	if err != nil {
		return "", err
	}
	posts, err := PracticePosts(ctx, pool, company)
	if err != nil {
		return "", err
	}
	if !offered(posts, postID) {
		return "", ErrUnknownPost
	}
	id, err := conversations.NewID()
	if err != nil {
		return "", err
	}
	event := messenger.CommentEvent{PageID: pageID, PostID: postID, CommentID: "practice-" + id, ParentID: postID,
		FromID: standins.PSID(name), FromName: name, Message: text, CreatedAt: time.Now()}
	return Save(ctx, pool, box, company, connectionID, event, time.Now())
}

// standInPage is the company's connected stand-in Facebook Page: its id and connection.
func standInPage(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (string, string, error) {
	const statement = `
		SELECT external_account_id, id::text FROM social_connections
		WHERE company_id = $1 AND platform = 'facebook' AND is_stand_in AND status = 'connected'
		LIMIT 1`
	var pageID, connectionID string
	err := pool.QueryRow(ctx, statement, company.String()).Scan(&pageID, &connectionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrNoStandInPage
	}
	return pageID, connectionID, err
}

func offered(posts []PracticePost, postID string) bool {
	for _, post := range posts {
		if post.ID == postID {
			return true
		}
	}
	return false
}
