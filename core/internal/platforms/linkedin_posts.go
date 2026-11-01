package platforms

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"ansa/core/internal/download"
)

// LinkedIn's publishing (the old adapters/linkedin-posts.ts): a member post
// through the Posts API, an image first through the Images API
// (docs/research/social-publishing-apis.md, section 1). Videos need its
// multi-part Videos API: not built yet. NOT TESTED against LinkedIn.

const (
	linkedInPostsAddress = "https://api.linkedin.com/rest/posts"
	linkedInImageAddress = "https://api.linkedin.com/rest/images?action=initializeUpload"
	// Every /rest call names the API version (YYYYMM: each is supported for
	// at least a year, and a missing or ended one is refused).
	LinkedInVersion = "202610"
)

// The Images API takes JPG, GIF and PNG.
var linkedInImageTypes = []string{"image/jpeg", "image/png", "image/gif"}

// Where an upload address may point: the member's token goes with the
// image, so never anywhere else.
var linkedInUploadHosts = []string{"www.linkedin.com", "api.linkedin.com"}

var (
	linkedInImageURN = regexp.MustCompile(`^urn:li:image:[A-Za-z0-9_-]{1,200}$`)
	linkedInPostURN  = regexp.MustCompile(`^urn:li:(share|ugcPost):\d{1,30}$`)
	duplicateWord    = regexp.MustCompile(`(?i)duplicate`)
)

// The Posts API's error table: these created nothing (409: "retry").
var linkedInNotCreated = map[int]string{400: "invalid_request", 401: "token_rejected", 403: "permission_denied", 404: "not_found", 409: "conflict"}

// publishLinkedIn: the image first (when there is one), then the post.
func (c *Connectors) publishLinkedIn(ctx context.Context, target Target, post Post) PostResult {
	if post.Media != nil && post.Media.Kind == "video" {
		return notCreated("video_not_supported", 0)
	}
	imageURN := ""
	if post.Media != nil {
		urn, refused := c.uploadLinkedInImage(ctx, target, *post.Media)
		if refused != nil {
			return *refused
		}
		imageURN = urn
	}
	return c.createLinkedInPost(ctx, target, post, imageURN)
}

func linkedInHeaders(token string) map[string]string {
	return map[string]string{"Authorization": "Bearer " + token, "Linkedin-Version": LinkedInVersion, "X-Restli-Protocol-Version": "2.0.0", "Content-Type": "application/json"}
}

// uploadLinkedInImage registers the image, then sends its bytes: the
// image's URN for the post, or why nothing was posted (nothing is posted
// yet at this stage, so every failure is "not created").
func (c *Connectors) uploadLinkedInImage(ctx context.Context, target Target, media Media) (string, *PostResult) {
	if !contains(linkedInImageTypes, media.ContentType) {
		refused := notCreated("media_type_not_accepted", 0)
		return "", &refused
	}
	body, _ := json.Marshal(map[string]any{"initializeUploadRequest": map[string]string{"owner": "urn:li:person:" + target.ExternalID}})
	started := c.send(ctx, request{method: http.MethodPost, address: linkedInImageAddress, header: linkedInHeaders(target.Token), body: body, timeout: APITimeout})
	if started.answered() && (started.status == 401 || started.status == 429) {
		refused := notCreated("token_rejected", 0)
		if started.status == 429 {
			refused = notCreated("rate_limited", secondsFromRetryAfter(started.header.Get("Retry-After"), c.now()))
		}
		return "", &refused
	}
	var registered struct {
		Value struct {
			UploadURL string `json:"uploadUrl"`
			Image     string `json:"image"`
		} `json:"value"`
	}
	if !readJSONIfOK(started, &registered) || !isAbsoluteURL(registered.Value.UploadURL) || !linkedInImageURN.MatchString(registered.Value.Image) {
		refused := notCreated("upload_failed", 0)
		return "", &refused
	}
	if !download.Allowed(registered.Value.UploadURL, linkedInUploadHosts) {
		refused := notCreated("upload_url_refused", 0)
		return "", &refused
	}
	upload := request{method: http.MethodPut, address: registered.Value.UploadURL, body: media.Bytes, timeout: ImageUploadTimeout,
		header: map[string]string{"Authorization": "Bearer " + target.Token, "Content-Type": media.ContentType}}
	if !c.send(ctx, upload).ok() {
		refused := notCreated("upload_failed", 0)
		return "", &refused
	}
	return registered.Value.Image, nil
}

// linkedInPostBody is the post as the Posts API takes it.
type linkedInPostBody struct {
	Author       string `json:"author"`
	Commentary   string `json:"commentary"`
	Visibility   string `json:"visibility"`
	Distribution struct {
		FeedDistribution               string   `json:"feedDistribution"`
		TargetEntities                 []string `json:"targetEntities"`
		ThirdPartyDistributionChannels []string `json:"thirdPartyDistributionChannels"`
	} `json:"distribution"`
	Content                   *linkedInContent `json:"content,omitempty"`
	LifecycleState            string           `json:"lifecycleState"`
	IsReshareDisabledByAuthor bool             `json:"isReshareDisabledByAuthor"`
}

// linkedInContent is a post's image: its URN and its alt text.
type linkedInContent struct {
	Media struct {
		ID      string `json:"id"`
		AltText string `json:"altText,omitempty"`
	} `json:"media"`
}

// createLinkedInPost: 201 with the post's id in the x-restli-id header.
func (c *Connectors) createLinkedInPost(ctx context.Context, target Target, post Post, imageURN string) PostResult {
	body := linkedInPostBody{Author: "urn:li:person:" + target.ExternalID, Commentary: LinkedInLittleText(post.Text), Visibility: "PUBLIC", LifecycleState: "PUBLISHED"}
	body.Distribution.FeedDistribution = "MAIN_FEED"
	body.Distribution.TargetEntities, body.Distribution.ThirdPartyDistributionChannels = []string{}, []string{}
	if imageURN != "" {
		body.Content = &linkedInContent{}
		body.Content.Media.ID, body.Content.Media.AltText = imageURN, post.Media.AltText
	}
	encoded, _ := json.Marshal(body)
	answered := c.send(ctx, request{method: http.MethodPost, address: linkedInPostsAddress, header: linkedInHeaders(target.Token), body: encoded, timeout: APITimeout})
	if !answered.answered() {
		return unclear(answered.noAnswer)
	}
	if answered.status != 201 {
		return c.linkedInRefusal(answered)
	}
	postID := answered.header.Get("X-Restli-Id")
	// Created, but without its id nobody could tell which post it is.
	if !linkedInPostURN.MatchString(postID) {
		return unclear("no_post_id")
	}
	return PostResult{Kind: "published", PostID: postID, URL: "https://www.linkedin.com/feed/update/" + postID + "/"}
}

// linkedInRefusal: 400, 401, 403, 404, 409, 422 and 429 created nothing; a
// 5xx (or anything else) may have.
func (c *Connectors) linkedInRefusal(a answer) PostResult {
	switch {
	case a.status == 422:
		// Read only to tell a duplicate apart; the message is never kept or logged.
		var refusal struct {
			Message string `json:"message"`
		}
		if readJSON(a, &refusal) && utf16Length(refusal.Message) <= 10_000 && duplicateWord.MatchString(refusal.Message) {
			return notCreated("duplicate", 0)
		}
		return notCreated("unprocessable", 0)
	case linkedInNotCreated[a.status] != "":
		return notCreated(linkedInNotCreated[a.status], 0)
	case a.status == 429:
		return notCreated("rate_limited", secondsFromRetryAfter(a.header.Get("Retry-After"), c.now()))
	case a.status >= 500:
		return unclear("server_error")
	}
	return unclear("unexpected_answer")
}

// isAbsoluteURL: an address with a scheme and a host (Zod's url()).
func isAbsoluteURL(raw string) bool {
	parsed, err := url.Parse(raw)
	return err == nil && parsed.Scheme != "" && parsed.Host != "" && !strings.ContainsAny(raw, " \t\r\n")
}
