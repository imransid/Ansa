package calls

// Why a call was decided as it was: the fixed codes stored on the call
// (calls.ai_reason_code, never the model's words) and the sentences the
// call page and the call's request show (the old lib/call-brain/reasons.ts).
var reasonLabels = map[string]string{
	"model_solved":          "Claude judged it solved, and the customer confirmed it in their own words.",
	"model_needs_human":     "Claude judged that a human needs to follow up.",
	"trimmed_output":        "Claude judged that a human needs to follow up (its answer was a little too long, so it was shortened).",
	"unverified_resolution": "Claude said solved, but no whole sentence in the customer's last two turns (the call's first four turns don't count) confirms it, so it was escalated.",
	"invalid_output":        "Claude's answer was malformed, so the call was escalated.",
	"model_refused":         "Claude declined to answer, so the call was escalated.",
	"model_truncated":       "Claude's answer was cut off, so the call was escalated.",
	"model_error":           "The AI could not be reached, so the call was escalated.",
	"model_unavailable":     "No Claude API key is set, so the call was escalated.",
	"no_transcript":         "The call has no transcript, so it was escalated.",
	"no_customer_speech":    "The customer never spoke, so the call was escalated.",
	"abnormal_end":          "The call ended abnormally, so it was escalated.",
	"transcript_unreadable": "The transcript could not be decrypted, so the call was escalated.",
	"analysis_error":        "Something went wrong while analyzing, so the call was escalated.",
}

// DescribeReason is the sentence for a reason code ("-" for one this
// version doesn't know); a failed request names the error's class.
func DescribeReason(code, errorClass string) string {
	if code == "model_error" && errorClass != "" {
		return "The AI could not be reached (" + errorClass + "), so the call was escalated."
	}
	if label, known := reasonLabels[code]; known {
		return label
	}
	return "-"
}
