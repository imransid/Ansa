package messenger

import (
	"bytes"
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Comments on a Page's posts come through the same signed Page webhook as
// messages, as entry[].changes with field "feed" (Meta's Page webhooks).
// Only a new comment is read ("comment" added); an edit, a removal, a
// reaction or a new post is left out. The company is still the Page's,
// found by the webhook (findPage); core/internal/comments decides the rest.

// CommentEvent is one new comment, with only what ansa reads.
type CommentEvent struct {
	PageID, PostID, CommentID string
	// The comment it answers inside a thread; the post itself (or "") for a
	// comment on the post.
	ParentID string
	// Who wrote it: Meta's id for them and their name as Meta gives it.
	FromID, FromName string
	Message          string
	// "photo" or "video" when the comment carries one ("" for none): named,
	// never downloaded.
	AttachmentKind string
	CreatedAt      time.Time
}

// A comment's or a post's id: digits, or "<page>_<post>" style digits.
var metaObjectID = regexp.MustCompile(`^\d{1,40}(_\d{1,40}){0,2}$`)

type rawFeed struct {
	Object string `json:"object"`
	Entry  []struct {
		ID      string `json:"id"`
		Changes []struct {
			Field string          `json:"field"`
			Value json.RawMessage `json:"value"`
		} `json:"changes"`
	} `json:"entry"`
}

type rawComment struct {
	Item        string          `json:"item"`
	Verb        string          `json:"verb"`
	PostID      string          `json:"post_id"`
	CommentID   string          `json:"comment_id"`
	ParentID    string          `json:"parent_id"`
	Message     string          `json:"message"`
	Photo       string          `json:"photo"`
	Video       string          `json:"video"`
	CreatedTime json.RawMessage `json:"created_time"`
	From        struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"from"`
}

// ParseCommentEvents reads the new comments of a Page webhook's body. Other
// changes (an edit, a removal, a reaction, a post) are left out; a new
// comment that isn't in the shape ansa reads makes the whole body
// ErrNotForAnsa (answered 200: Meta would send it again and again).
func ParseCommentEvents(body []byte) ([]CommentEvent, error) {
	var raw rawFeed
	if err := json.NewDecoder(bytes.NewReader(body)).Decode(&raw); err != nil || raw.Object != "page" || len(raw.Entry) > 100 {
		return nil, ErrNotForAnsa
	}
	var events []CommentEvent
	for _, entry := range raw.Entry {
		if len(entry.Changes) > 100 {
			return nil, ErrNotForAnsa
		}
		for _, change := range entry.Changes {
			if change.Field != "feed" {
				continue
			}
			event, isNewComment, err := readComment(entry.ID, change.Value)
			if err != nil {
				return nil, err
			}
			if isNewComment {
				events = append(events, event)
			}
		}
	}
	return events, nil
}

// readComment reads one feed change: whether it is a new comment, and the
// comment when it is.
func readComment(pageID string, value json.RawMessage) (CommentEvent, bool, error) {
	var c rawComment
	if json.Unmarshal(value, &c) != nil {
		return CommentEvent{}, false, ErrNotForAnsa
	}
	if c.Item != "comment" || c.Verb != "add" {
		return CommentEvent{}, false, nil
	}
	created, ok := readCreatedTime(c.CreatedTime)
	switch {
	case !ok, !metaID.MatchString(pageID), !metaObjectID.MatchString(c.PostID), !metaObjectID.MatchString(c.CommentID),
		c.ParentID != "" && !metaObjectID.MatchString(c.ParentID), !metaID.MatchString(c.From.ID),
		len(c.Message) > 20_000, len(c.From.Name) > 1_000:
		return CommentEvent{}, false, ErrNotForAnsa
	}
	event := CommentEvent{PageID: pageID, PostID: c.PostID, CommentID: c.CommentID, ParentID: c.ParentID, FromID: c.From.ID, FromName: c.From.Name,
		Message: c.Message, CreatedAt: created}
	if c.Photo != "" {
		event.AttachmentKind = "photo"
	} else if c.Video != "" {
		event.AttachmentKind = "video"
	}
	return event, true, nil
}

// readCreatedTime reads Meta's created_time: Unix seconds (a number or a
// string of digits), or a time like "2026-11-04T10:00:00+0000".
func readCreatedTime(raw json.RawMessage) (time.Time, bool) {
	text := strings.Trim(string(raw), `"`)
	if seconds, err := strconv.ParseInt(text, 10, 64); err == nil && seconds > 0 && seconds < 1<<40 {
		return time.Unix(seconds, 0).UTC(), true
	}
	for _, layout := range []string{"2006-01-02T15:04:05-0700", time.RFC3339} {
		if at, err := time.Parse(layout, text); err == nil {
			return at.UTC(), true
		}
	}
	return time.Time{}, false
}

// OnThePost: the comment was written on the post itself, not as a reply
// inside another comment's thread.
func (e CommentEvent) OnThePost() bool {
	return e.ParentID == "" || e.ParentID == e.PostID
}

// Describe is what ansa keeps of a comment: its text, or a line naming its
// photo or video (never downloaded: open Facebook to see it).
func (e CommentEvent) Describe() string {
	text := strings.TrimSpace(e.Message)
	attachment := map[string]string{"photo": "[A photo: open Facebook to see it]", "video": "[A video: open Facebook to see it]"}[e.AttachmentKind]
	switch {
	case text != "" && attachment != "":
		return text + "\n" + attachment
	case text != "":
		return text
	case attachment != "":
		return attachment
	}
	return "[Something: open Facebook to see it]"
}
