package analytics

import "strconv"

// What the Analytics page says about a post beside its numbers (the old
// lib/analytics/post-notes.ts): why it has none, and what the latest try
// came to. Never a promise the collector won't keep: past its platform's
// read days nothing is read again.

// WhyNoNumbers says why a post has no numbers, or why it never will.
func WhyNoNumbers(post ShownPost) string {
	label := PlatformLabels[post.Platform]
	switch {
	case post.AccountIsStandIn:
		return "A development stand-in's post: no platform has its numbers, so only simulated ones show."
	case !post.HasPlatformID:
		return "Marked as published by hand: ansa doesn't know the post's id on " + label + ", so its numbers can't be read."
	case len(CollectedColumns(post.Platform)) == 0:
		return label + " gives its post numbers only with a permission ansa doesn't have yet (see What the numbers mean below)."
	case !post.NumbersStillRead:
		return "ansa reads " + label + " posts' numbers for " + strconv.Itoa(ReadDays(post.Platform)) + " days after they go out, and read none for this one."
	case post.MetricsError != nil:
		return describeMetricsError(*post.MetricsError, label)
	}
	return "Not read yet: ansa reads a post's numbers about once a day, from an hour after it went out."
}

// LatestTryProblem says why the latest try read nothing, shown under the
// numbers an earlier one read; "" when it read some. Also "" once the
// post's numbers are no longer read: its words may promise another try,
// and none comes.
func LatestTryProblem(post ShownPost) string {
	if post.MetricsError == nil || !post.NumbersStillRead {
		return ""
	}
	return describeMetricsError(*post.MetricsError, PlatformLabels[post.Platform])
}

// describeMetricsError is the page's words for a post's metrics_error. A
// code this version doesn't know (written by a later one) is shown as it is.
func describeMetricsError(code, platform string) string {
	switch code {
	case "needs_permission":
		return platform + " gives these numbers only with a permission ansa doesn't have yet."
	case "stand_in":
		return "A development stand-in account: its numbers come only from pnpm simulate:post-metrics."
	case "not_set_up":
		return platform + " isn't set up by ansa on this server, so its numbers can't be read."
	case "reauthorization_needed":
		return platform + " no longer accepts ansa's permission for this account: reconnect it on the Accounts page."
	case "account_disconnected":
		return "The account was disconnected, so its numbers are no longer read."
	case "token_refresh_unavailable":
		return platform + " didn't answer when ansa renewed its permission. ansa tries again tomorrow."
	case "account_unreadable":
		return "ansa couldn't read the account's stored permission. Contact ansa if it keeps happening."
	case "token_rejected":
		return platform + " refused ansa's permission for this account: reconnect it on the Accounts page."
	case "permission_denied":
		return platform + " says this account may not read the post's numbers."
	case "not_found":
		return platform + " can't find the post any more (it may have been deleted there)."
	case "rate_limited", "quota_exceeded":
		return platform + " asked ansa to slow down. ansa tries again tomorrow."
	case "invalid_request":
		return platform + " refused the request for the post's numbers."
	case "server_error", "timeout", "network_error":
		return platform + " didn't answer properly when ansa asked. ansa tries again tomorrow."
	case "unexpected_answer", "no_numbers":
		return platform + "'s answer held no numbers ansa could read. ansa tries again tomorrow."
	}
	return "The numbers couldn't be read (" + code + ")."
}
