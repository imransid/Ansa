package publishing

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// StandInAccountID is the development stand-in account's id on every platform.
const StandInAccountID = "dev:stand-in"

// publishToStandIn "publishes" a post as a file (development only, as the
// old adapters/dev-social.ts): .dev-social/<platform>/<time>-<id>.json, and
// answers "published" with a dev id and no address. Nothing leaves this
// machine. The image or video itself is not copied: its kind, type, size
// and alt text only. Only the file name could be logged, never the post.
func publishToStandIn(folder, platform, jobID string, post OutgoingPost) PostResult {
	var media map[string]any
	if post.Media != nil {
		media = map[string]any{"kind": post.Media.Kind, "content_type": post.Media.ContentType, "size_bytes": len(post.Media.Bytes), "alt_text": post.Media.AltText}
	}
	record := map[string]any{
		"note":       "Development stand-in: this post was NOT published anywhere.",
		"platform":   platform,
		"account_id": StandInAccountID,
		"title":      post.Title,
		"text":       post.Text,
		"media":      media,
		"written_at": time.Now().UTC().Format(time.RFC3339),
	}
	body, _ := json.MarshalIndent(record, "", "  ")
	directory := filepath.Join(folder, platform)
	name := time.Now().UTC().Format("2006-01-02T15-04-05.000Z") + "-" + jobID + ".json"
	if os.MkdirAll(directory, 0o700) != nil || os.WriteFile(filepath.Join(directory, name), append(body, '\n'), 0o600) != nil {
		return PostResult{Kind: "not_created", Code: "stand_in_write_failed"}
	}
	return PostResult{Kind: "published", PostID: "dev-" + jobID}
}
