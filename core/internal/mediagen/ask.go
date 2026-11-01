package mediagen

import (
	"context"
	"strings"
	"time"

	"ansa/core/internal/download"
	"ansa/core/internal/media"
)

// Talking to an image or video service for one claimed request: one start,
// then polls while the service works in the background, within the run's
// budget. A service that throws, panics or doesn't answer in time never
// stops a run: every answer becomes done, failed (a code) or unfinished.
// The service's error is never looked at (its text could quote the prompt).

// answer is what the service gave: status "done", "failed" or "unfinished".
type answer struct {
	status    string
	output    Output
	code      string
	costCents *int
}

// askProvider asks for the claimed request (or, when an earlier run
// started it, only polls the service's job) until it is done, failed, or
// the budget is spent ("unfinished": a later run polls again).
func askProvider(ctx context.Context, p Provider, c *Claimed, budget time.Duration, sleep func(time.Duration), saveID func(string) error) (answer, error) {
	deadline := time.Now().Add(budget)
	var startCost *int
	if c.ProviderJobID == nil {
		started, broke := callWithin(ctx, p.RequestTimeout(), func(ctx context.Context) (Started, error) {
			return p.Start(ctx, Request{Kind: c.Kind, Prompt: c.Prompt})
		})
		switch {
		// No answer in time: it may have started, and without its id nobody can ask.
		case broke == "timeout":
			return answer{status: "failed", code: "provider_timeout"}, nil
		case broke != "":
			return answer{status: "failed", code: "provider_failed"}, nil
		case started.Status == "done":
			return answer{status: "done", output: started.Output, costCents: started.CostCents}, nil
		case started.Status != "started" || started.ProviderJobID == "":
			return answer{status: "failed", code: codeOr(started.Code)}, nil
		}
		startCost = started.CostCents
		if err := saveID(started.ProviderJobID); err != nil {
			return answer{}, err
		}
		c.ProviderJobID = &started.ProviderJobID
	}
	// Polls while one more wait and one more answer still end before the deadline.
	for !time.Now().Add(p.PollInterval() + p.RequestTimeout()).After(deadline) {
		sleep(p.PollInterval())
		polled, broke := callWithin(ctx, p.RequestTimeout(), func(ctx context.Context) (Polled, error) {
			return p.Poll(ctx, *c.ProviderJobID)
		})
		if broke != "" || polled.Status == "running" {
			continue
		}
		if polled.Status == "done" {
			if polled.CostCents == nil {
				polled.CostCents = startCost
			}
			return answer{status: "done", output: polled.Output, costCents: polled.CostCents}, nil
		}
		return answer{status: "failed", code: codeOr(polled.Code), costCents: startCost}, nil
	}
	return answer{status: "unfinished"}, nil
}

// callWithin is the call's answer, or why there is none: "timeout" when it
// took longer than limit, "threw" when it failed or panicked.
func callWithin[T any](ctx context.Context, limit time.Duration, call func(context.Context) (T, error)) (T, string) {
	ctx, cancel := context.WithTimeout(ctx, limit)
	defer cancel()
	type result struct {
		value T
		err   error
	}
	done := make(chan result, 1)
	go func() {
		defer func() {
			if recover() != nil {
				done <- result{err: context.Canceled}
			}
		}()
		value, err := call(ctx)
		done <- result{value: value, err: err}
	}()
	var nothing T
	select {
	case r := <-done:
		if r.err != nil {
			return nothing, "threw"
		}
		return r.value, ""
	case <-ctx.Done():
		return nothing, "timeout"
	}
}

func codeOr(code string) string {
	if _, known := ErrorWords[code]; known {
		return code
	}
	return "provider_failed"
}

// For the result's download: redirects and body together.
const downloadTimeout = 30 * time.Second

// fetchAndCheck is the result's bytes and type, fetched at once from the
// service's own hosts when it gave an address (its links expire), kept
// only when its own bytes are an accepted file of the kind asked for;
// otherwise a code, never a file.
func fetchAndCheck(ctx context.Context, output Output, p Provider, kind string) ([]byte, string, string) {
	data := output.Bytes
	if data == nil {
		accepts := func(contentType string) bool {
			return strings.HasPrefix(contentType, "image/") || strings.HasPrefix(contentType, "video/") || contentType == "application/octet-stream"
		}
		fetched, _, tooLarge, ok := download.Fetch(ctx, output.URL, download.Rules{AllowedHosts: p.OutputHosts(),
			MaxBytes: media.MaxGeneratedBytes, Accepts: accepts, Timeout: downloadTimeout})
		// Too big says so: trying again would fetch the same file (and pay again).
		if tooLarge {
			return nil, "", "output_too_large"
		}
		if !ok {
			return nil, "", "download_failed"
		}
		data = fetched
	}
	if len(data) > media.MaxGeneratedBytes {
		return nil, "", "output_too_large"
	}
	contentType := media.DetectType(data)
	if contentType == "" || media.KindOfType[contentType] != kind {
		return nil, "", "unexpected_output"
	}
	return data, contentType, ""
}
