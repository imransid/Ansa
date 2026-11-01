package calls

import (
	"context"
	"strings"
	"time"

	"ansa/core/internal/download"
	"ansa/core/internal/logging"
	"ansa/core/internal/tenant"
)

// A recording: audio only, at most 100 MB, one minute for the whole copy.
const (
	recordingMaxBytes = 100 << 20
	recordingTimeout  = time.Minute
)

var recordingExtensions = map[string]string{
	"audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/webm": "webm",
}

// copyRecording copies a call's recording into private storage
// (recordings/<company>/<call>.<ext>), only from an allowed host. A failure
// marks the call's recording "failed" (it isn't tried again: the address
// is never stored). Never the address or the key in a log.
func (h *Webhook) copyRecording(ctx context.Context, company tenant.CompanyID, callID, address string) {
	if !download.Allowed(address, h.RecordingHosts) {
		h.Log.Warn("vapi recording ignored", logging.Code("host_not_allowed"))
		return
	}
	rules := download.Rules{AllowedHosts: h.RecordingHosts, MaxBytes: recordingMaxBytes, Timeout: recordingTimeout,
		Accepts: func(contentType string) bool { return strings.HasPrefix(contentType, "audio/") }}
	data, contentType, _, ok := download.Fetch(ctx, address, rules)
	if !ok {
		h.markRecordingFailed(ctx, company, callID)
		return
	}
	extension := recordingExtensions[contentType]
	if extension == "" {
		extension = "audio"
	}
	key := "recordings/" + company.String() + "/" + callID + "." + extension
	if err := h.Files.Put(ctx, key, data, contentType); err != nil {
		h.Log.Error("vapi recording not stored", logging.ErrorType(err))
		h.markRecordingFailed(ctx, company, callID)
		return
	}
	const stored = `UPDATE calls SET recording_status = 'stored', recording_key = $3, recording_content_type = $4 WHERE company_id = $1 AND id = $2`
	if _, err := h.Pool.Exec(ctx, stored, company.String(), callID, key, contentType); err != nil {
		h.Log.Error("vapi recording not recorded", logging.ErrorType(err))
	}
}

func (h *Webhook) markRecordingFailed(ctx context.Context, company tenant.CompanyID, callID string) {
	const failed = `UPDATE calls SET recording_status = 'failed', recording_key = NULL, recording_content_type = NULL WHERE company_id = $1 AND id = $2`
	if _, err := h.Pool.Exec(ctx, failed, company.String(), callID); err != nil {
		h.Log.Error("vapi recording status not saved", logging.ErrorType(err))
	}
}
