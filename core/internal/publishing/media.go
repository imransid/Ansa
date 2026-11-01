package publishing

import (
	"context"
	"time"
)

// How long reading a draft's image or video from storage may take (the old run's 30 s).
const mediaReadTimeout = 30 * time.Second

// readMedia reads the draft's image or video right before sending, as the
// platform gets it. nil with no problem: a text post. Problems (nothing
// sent): "media_missing" (not in storage: the post fails) or
// "media_unavailable" (storage failed or was too slow: tried again later).
// LOGGING RULE: a file's key is never logged.
func (r *Runner) readMedia(ctx context.Context, media *attachedMedia) (*OutgoingMedia, string) {
	if media == nil {
		return nil, ""
	}
	if r.Files == nil {
		return nil, "media_unavailable"
	}
	readCtx, cancel := context.WithTimeout(ctx, mediaReadTimeout)
	defer cancel()
	data, found, err := r.Files.Read(readCtx, media.StorageKey)
	switch {
	case err != nil:
		return nil, "media_unavailable"
	case !found:
		return nil, "media_missing"
	}
	return &OutgoingMedia{Kind: media.Kind, ContentType: media.ContentType, AltText: media.AltText, Bytes: data}, ""
}
