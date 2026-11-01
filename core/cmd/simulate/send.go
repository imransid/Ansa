package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"time"

	"ansa/core/internal/commands"
)

// How the tools reach core: over HTTP to a running core on this computer
// (as the old scripts posted to the running app), or straight to one of
// core's webhook handlers in this process (as the old scripts called the
// same code the webhook calls). Each tool says which.

// coreClient sends to a core on this computer: 30 seconds a request, never
// following a redirect.
var coreClient = &http.Client{
	Timeout:       30 * time.Second,
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

// postToCore sends a body to the running core and returns the status and
// the answer (at most 1 MB).
func postToCore(ctx context.Context, address, path string, body []byte, headers http.Header) (int, []byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, address+path, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	copyHeaders(request.Header, headers)
	request.Header.Set("Content-Type", "application/json")
	response, err := coreClient.Do(request)
	if err != nil {
		return 0, nil, commands.Refusal("No core answered at " + address + ": start it first (make run).")
	}
	defer response.Body.Close()
	answer, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	return response.StatusCode, answer, nil
}

// serveInProcess hands a body to one of core's webhook handlers in this
// process, as its route would, from this computer's address. Returns the
// status the handler answered.
func serveInProcess(handler http.Handler, path string, body []byte, headers http.Header) int {
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	request.RemoteAddr = "127.0.0.1:1"
	copyHeaders(request.Header, headers)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder.Code
}

func copyHeaders(to, from http.Header) {
	for name, values := range from {
		for _, value := range values {
			to.Add(name, value)
		}
	}
}

// headersOf turns a name -> value map (Vapi's signing headers) into headers.
func headersOf(values map[string]string) http.Header {
	headers := http.Header{}
	for name, value := range values {
		headers.Set(name, value)
	}
	return headers
}

// randomHex is n random bytes written as hex: made-up ids, and the secrets
// of the handlers a tool runs in this process (made for that one run).
func randomHex(n int) string {
	raw := make([]byte, n)
	// Since Go 1.24, rand.Read never returns an error.
	rand.Read(raw)
	return hex.EncodeToString(raw)
}

// takeValue takes "<name> <value>" out of the arguments, wherever it is;
// ok is false when the name is there without a value.
func takeValue(args []string, name string) (value string, rest []string, ok bool) {
	for index := 0; index < len(args); index++ {
		if args[index] != name {
			rest = append(rest, args[index])
			continue
		}
		if index+1 >= len(args) {
			return "", nil, false
		}
		value = args[index+1]
		index++
	}
	return value, rest, true
}

// takeSwitch takes "<name>" out of the arguments, wherever it is.
func takeSwitch(args []string, name string) (bool, []string) {
	found := false
	var rest []string
	for _, arg := range args {
		if arg == name {
			found = true
			continue
		}
		rest = append(rest, arg)
	}
	return found, rest
}
