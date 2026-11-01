package platforms

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"ansa/core/internal/contentrules"
)

// The development stand-in for every platform whose app isn't set on a
// development server (the old adapters/dev-social.ts), so connecting and
// publishing can be tried before ansa has any app. Publishing writes the
// post to .dev-social/<platform>/<time>-<id>.json (git-ignored) and
// answers "published" with a dev id. Nothing leaves this machine.
// Production refuses it (the door), and the pages mark every stand-in.

// publishToStandIn "publishes" one post as a file, refusing what ansa
// can't publish to the real platform (a YouTube text post, a LinkedIn
// video), as the real one would. Never the file's bytes: its kind, type,
// size and alt text only.
func (c *Connectors) publishToStandIn(platform string, post Post) PostResult {
	format := "post"
	if post.Media != nil {
		format = "image_post"
		if post.Media.Kind == "video" {
			format = "video"
		}
	}
	if !contentrules.Takes(contentrules.PublishedFormats[platform], format) {
		if format == "video" {
			return notCreated("video_not_supported", 0)
		}
		return notCreated("text_posts_not_supported", 0)
	}
	id, err := newID()
	if err != nil {
		return notCreated("stand_in_write_failed", 0)
	}
	record := map[string]any{
		"note":       "Development stand-in: this post was NOT published anywhere.",
		"platform":   platform,
		"account_id": contentrules.StandInAccountID,
		"title":      post.Title,
		"text":       post.Text,
		"media":      nil,
		"written_at": c.now().UTC().Format(time.RFC3339),
	}
	if post.Media != nil {
		record["media"] = map[string]any{"kind": post.Media.Kind, "content_type": post.Media.ContentType, "size_bytes": len(post.Media.Bytes), "alt_text": post.Media.AltText}
	}
	body, _ := json.MarshalIndent(record, "", "  ")
	directory := filepath.Join(c.StandInDir, platform)
	name := c.now().UTC().Format("2006-01-02T15-04-05.000Z") + "-" + id + ".json"
	if os.MkdirAll(directory, 0o700) != nil || os.WriteFile(filepath.Join(directory, name), append(body, '\n'), 0o600) != nil {
		// A read-only disk, say. Nothing else is said: the error names the path.
		return notCreated("stand_in_write_failed", 0)
	}
	return PostResult{Kind: "published", PostID: "dev-" + id}
}

// newID is a random UUID (version 4).
func newID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:]), nil
}

// StandInAccount is a platform's one stand-in account, with a made-up
// token (stored and handled like a real one) that never runs out.
func StandInAccount(platform, displayName string, scopes []string) (Account, error) {
	id, err := newID()
	if err != nil {
		return Account{}, err
	}
	return Account{ExternalID: contentrules.StandInAccountID, DisplayName: "Development stand-in (" + displayName + ")", Kind: AccountKinds[platform],
		Scopes: scopes, AccessToken: "dev-stand-in-" + id}, nil
}
