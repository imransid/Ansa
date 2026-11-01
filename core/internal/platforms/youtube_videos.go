package platforms

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"ansa/core/internal/download"
)

// YouTube's publishing (the old adapters/youtube-videos.ts): one video
// through the resumable videos.insert (Google's "Resumable uploads"
// guide): a POST starts a session and names its address in Location, a PUT
// sends the bytes. No video exists before the bytes arrive, so every
// failure up to the PUT created nothing. Each upload costs one of the 100
// a day ansa's whole Google project gets. NOT TESTED against YouTube.

const youTubeUploadAddress = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status"

// Where a session address may point: the channel's token goes with the bytes.
var youTubeSessionHosts = []string{"www.googleapis.com"}

var youTubeVideoID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,30}$`)

// publishYouTube: one video, with its title and description (the post's text).
func (c *Connectors) publishYouTube(ctx context.Context, target Target, post Post) PostResult {
	if post.Media == nil || post.Media.Kind != "video" {
		return notCreated("text_posts_not_supported", 0)
	}
	title := strings.TrimFunc(post.Title, func(r rune) bool { return unicode.IsSpace(r) || r == 0xFEFF })
	if title == "" {
		return notCreated("title_missing", 0)
	}
	session, refused := c.startYouTubeUpload(ctx, target, title, post.Text, *post.Media)
	if refused != nil {
		return *refused
	}
	upload := request{method: http.MethodPut, address: session, body: post.Media.Bytes, timeout: VideoUploadTimeout,
		header: map[string]string{"Authorization": "Bearer " + target.Token, "Content-Type": post.Media.ContentType}}
	answered := c.send(ctx, upload)
	switch {
	case answered.noAnswer == "timeout":
		return unclear("timeout")
	case !answered.answered():
		return unclear("upload_interrupted")
	case answered.ok():
		var video struct {
			ID string `json:"id"`
		}
		if !readJSON(answered, &video) || !youTubeVideoID.MatchString(video.ID) {
			return unclear("no_post_id")
		}
		return PostResult{Kind: "published", PostID: video.ID, URL: "https://www.youtube.com/watch?v=" + video.ID}
	case answered.status == 500 || answered.status == 502 || answered.status == 503 || answered.status == 504:
		// The upload may have finished: Google says to resume the same session.
		return unclear("upload_interrupted")
	case answered.status == 404:
		return notCreated("upload_session_expired", 0)
	}
	// Any other answer "failed permanently".
	return notCreated(youTubeRefusalCode(answered), 0)
}

// startYouTubeUpload sends the video's details: the session's address, or
// why nothing was made.
func (c *Connectors) startYouTubeUpload(ctx context.Context, target Target, title, description string, media Media) (string, *PostResult) {
	refuse := func(result PostResult) (string, *PostResult) { return "", &result }
	details := map[string]any{"snippet": map[string]string{"title": title, "description": description}, "status": map[string]string{"privacyStatus": "public"}}
	body, _ := json.Marshal(details)
	headers := map[string]string{"Authorization": "Bearer " + target.Token, "Content-Type": "application/json; charset=UTF-8",
		"X-Upload-Content-Length": strconv.Itoa(len(media.Bytes)), "X-Upload-Content-Type": media.ContentType}
	answered := c.send(ctx, request{method: http.MethodPost, address: youTubeUploadAddress, header: headers, body: body, timeout: APITimeout})
	switch {
	case !answered.answered():
		return refuse(notCreated("upload_failed", 0))
	case !answered.ok():
		return refuse(notCreated(youTubeRefusalCode(answered), 0))
	}
	session := answered.header.Get("Location")
	if !download.Allowed(session, youTubeSessionHosts) {
		return refuse(notCreated("upload_url_refused", 0))
	}
	return session, nil
}

// youTubeReasons are the reasons Google lists in a refusal, never its message.
func youTubeReasons(a answer) []string {
	var refusal struct {
		Error struct {
			Errors []struct {
				Reason string `json:"reason"`
			} `json:"errors"`
		} `json:"error"`
	}
	if !readJSON(a, &refusal) || len(refusal.Error.Errors) > 20 {
		return nil
	}
	reasons := []string{}
	for _, entry := range refusal.Error.Errors {
		if utf16Length(entry.Reason) > 100 {
			return nil
		}
		reasons = append(reasons, entry.Reason)
	}
	return reasons
}

// youTubeRefusalCode: quotaExceeded and uploadLimitExceeded mean the day's
// uploads are used up (ansa's whole project shares them);
// rateLimitExceeded: too fast.
func youTubeRefusalCode(a answer) string {
	reasons := youTubeReasons(a)
	switch {
	case a.status == 401:
		return "token_rejected"
	case contains(reasons, "quotaExceeded") || contains(reasons, "uploadLimitExceeded"):
		return "quota_exceeded"
	case contains(reasons, "rateLimitExceeded"):
		return "rate_limited"
	case a.status == 403:
		return "permission_denied"
	case a.status == 400:
		return "invalid_request"
	}
	return "upload_failed"
}
