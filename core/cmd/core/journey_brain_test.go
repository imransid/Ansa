package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

// fakeBrain answers as the brain would: each assistant reply and post is
// the next answer the test queued.
type fakeBrain struct {
	server  *httptest.Server
	mu      sync.Mutex
	replies []string
	posts   []string
}

func newFakeBrain(t *testing.T) *fakeBrain {
	brain := &fakeBrain{}
	brain.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		brain.mu.Lock()
		defer brain.mu.Unlock()
		queue := &brain.replies
		if r.URL.Path == "/v1/posts/write" {
			queue = &brain.posts
		}
		if len(*queue) == 0 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		io.WriteString(w, (*queue)[0])
		*queue = (*queue)[1:]
	}))
	t.Cleanup(brain.server.Close)
	return brain
}

func (b *fakeBrain) willReply(answer string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.replies = append(b.replies, answer)
}

func (b *fakeBrain) willPost(answer string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.posts = append(b.posts, answer)
}
