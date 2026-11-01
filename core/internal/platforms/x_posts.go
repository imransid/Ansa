package platforms

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/textproto"
)

// X's publishing (the old adapters/x-posts.ts): POST /2/tweets, an image
// sent first through the v2 media upload (docs/research/
// social-publishing-apis.md, section 4). Videos and GIF animations need
// X's chunked upload: not built yet. X takes up to 4 images; a draft holds
// one. NOT TESTED against X.

const (
	xTweetsAddress = "https://api.x.com/2/tweets"
	xMediaAddress  = "https://api.x.com/2/media/upload"
	// Images: JPG, PNG, GIF and WEBP, at most 5 MB.
	xMaxImageBytes = 5 * 1024 * 1024
)

var xImageTypes = []string{"image/jpeg", "image/png", "image/gif", "image/webp"}

// docs.x.com's response codes: these created nothing.
var xNotCreated = map[int]string{400: "invalid_request", 401: "token_rejected", 403: "permission_denied", 404: "not_found"}

// publishX: the image first (when there is one), then the post.
func (c *Connectors) publishX(ctx context.Context, target Target, post Post) PostResult {
	if post.Media != nil && post.Media.Kind == "video" {
		return notCreated("video_not_supported", 0)
	}
	type mediaIDs struct {
		MediaIDs []string `json:"media_ids"`
	}
	body := struct {
		Text  string    `json:"text"`
		Media *mediaIDs `json:"media,omitempty"`
	}{Text: post.Text}
	if post.Media != nil {
		mediaID, refused := c.uploadXImage(ctx, target, *post.Media)
		if refused != nil {
			return *refused
		}
		body.Media = &mediaIDs{MediaIDs: []string{mediaID}}
	}
	encoded, _ := json.Marshal(body)
	headers := map[string]string{"Authorization": "Bearer " + target.Token, "Content-Type": "application/json"}
	answered := c.send(ctx, request{method: http.MethodPost, address: xTweetsAddress, header: headers, body: encoded, timeout: APITimeout})
	if !answered.answered() {
		return unclear(answered.noAnswer)
	}
	if !answered.ok() {
		return c.xRefusal(answered)
	}
	// 201 with data.id; a 200 with an errors array is a partial success.
	var created struct {
		Data *struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if !readJSON(answered, &created) || created.Data == nil || !xNumericID.MatchString(created.Data.ID) {
		return unclear("no_post_id")
	}
	return PostResult{Kind: "published", PostID: created.Data.ID, URL: "https://x.com/i/web/status/" + created.Data.ID}
}

// uploadXImage is the simple v2 upload (multipart: the bytes and
// media_category): its media id for the post, or why nothing was posted.
func (c *Connectors) uploadXImage(ctx context.Context, target Target, media Media) (string, *PostResult) {
	refuse := func(result PostResult) (string, *PostResult) { return "", &result }
	if !contains(xImageTypes, media.ContentType) {
		return refuse(notCreated("media_type_not_accepted", 0))
	}
	if len(media.Bytes) > xMaxImageBytes {
		return refuse(notCreated("media_too_large", 0))
	}
	body, contentType, err := xImageForm(media)
	if err != nil {
		return refuse(notCreated("upload_failed", 0))
	}
	headers := map[string]string{"Authorization": "Bearer " + target.Token, "Content-Type": contentType}
	answered := c.send(ctx, request{method: http.MethodPost, address: xMediaAddress, header: headers, body: body, timeout: ImageUploadTimeout})
	if answered.answered() && (answered.status == 401 || answered.status == 429) {
		return refuse(c.xRefusal(answered))
	}
	var uploaded struct {
		Data *struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if !readJSONIfOK(answered, &uploaded) || uploaded.Data == nil || !xNumericID.MatchString(uploaded.Data.ID) {
		return refuse(notCreated("upload_failed", 0))
	}
	return uploaded.Data.ID, nil
}

// xImageForm is the upload's multipart body: "media" (the bytes, with
// their type) and "media_category" tweet_image.
func xImageForm(media Media) ([]byte, string, error) {
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part := textproto.MIMEHeader{}
	part.Set("Content-Disposition", `form-data; name="media"; filename="image"`)
	part.Set("Content-Type", media.ContentType)
	file, err := form.CreatePart(part)
	if err != nil {
		return nil, "", err
	}
	if _, err := file.Write(media.Bytes); err != nil {
		return nil, "", err
	}
	if err := form.WriteField("media_category", "tweet_image"); err != nil {
		return nil, "", err
	}
	if err := form.Close(); err != nil {
		return nil, "", err
	}
	return body.Bytes(), form.FormDataContentType(), nil
}

// xRefusal: 400, 401, 403, 404 and 429 created nothing; a 5xx (and
// anything else) may have.
func (c *Connectors) xRefusal(a answer) PostResult {
	switch {
	case xNotCreated[a.status] != "":
		return notCreated(xNotCreated[a.status], 0)
	case a.status == 429:
		// x-rate-limit-reset: when the window ends, in seconds since 1970.
		return notCreated("rate_limited", secondsUntilEpochSeconds(a.header.Get("X-Rate-Limit-Reset"), c.now()))
	case a.status >= 500:
		return unclear("server_error")
	}
	return unclear("unexpected_answer")
}
