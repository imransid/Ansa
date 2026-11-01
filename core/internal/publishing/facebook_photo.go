package publishing

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"time"

	"ansa/core/internal/messenger"
)

// Facebook's /photos takes jpeg, bmp, png, gif and tiff, at most 10 MB
// (the media library holds no bmp or tiff; a WebP is refused before asking).
var facebookPhotoTypes = map[string]bool{"image/jpeg": true, "image/png": true, "image/gif": true}

const facebookPhotoMaxBytes = 10 << 20

// How long sending one image may take (the old IMAGE_UPLOAD_TIMEOUT_MS).
const facebookPhotoTimeout = 60 * time.Second

var facebookPhotoClient = &http.Client{Timeout: facebookPhotoTimeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

// publishFacebookPhoto posts a photo with its caption (the post's text) to
// a Page's /photos, which publishes it as a post, with its alt text when
// it has one.
func publishFacebookPhoto(ctx context.Context, appSecret, pageID, pageToken string, post OutgoingPost) PostResult {
	if !facebookPhotoTypes[post.Media.ContentType] {
		return PostResult{Kind: "not_created", Code: "media_type_not_accepted"}
	}
	if len(post.Media.Bytes) > facebookPhotoMaxBytes {
		return PostResult{Kind: "not_created", Code: "media_too_large"}
	}
	body, contentType, err := photoForm(post, pageToken, messenger.AppSecretProof(pageToken, appSecret))
	if err != nil {
		return PostResult{Kind: "not_created", Code: "invalid_request"}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, messenger.GraphURL+"/"+url.PathEscape(pageID)+"/photos", body)
	if err != nil {
		return PostResult{Kind: "not_created", Code: "invalid_request"}
	}
	request.Header.Set("Content-Type", contentType)
	response, err := facebookPhotoClient.Do(request)
	if err != nil {
		return PostResult{Kind: "unclear", Code: noAnswerCode(err)}
	}
	defer response.Body.Close()
	return readFacebookAnswer(response)
}

// photoForm is the multipart body the old adapter sent: the image as
// "source" (named "image", with its own type), then caption, published,
// alt_text_custom (only when there is one), access_token and appsecret_proof.
func photoForm(post OutgoingPost, pageToken, proof string) (*bytes.Buffer, string, error) {
	body := &bytes.Buffer{}
	form := multipart.NewWriter(body)
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", `form-data; name="source"; filename="image"`)
	header.Set("Content-Type", post.Media.ContentType)
	part, err := form.CreatePart(header)
	if err != nil {
		return nil, "", err
	}
	if _, err := part.Write(post.Media.Bytes); err != nil {
		return nil, "", err
	}
	fields := [][2]string{{"caption", post.Text}, {"published", "true"}}
	if post.Media.AltText != "" {
		fields = append(fields, [2]string{"alt_text_custom", post.Media.AltText})
	}
	fields = append(fields, [2]string{"access_token", pageToken}, [2]string{"appsecret_proof", proof})
	for _, field := range fields {
		if err := form.WriteField(field[0], field[1]); err != nil {
			return nil, "", err
		}
	}
	return body, form.FormDataContentType(), form.Close()
}
