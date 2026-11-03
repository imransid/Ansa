package whatsapp

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strings"

	"ansa/core/internal/messenger"
)

// The plain Graph calls behind sending and signing up: nothing here reads
// or logs Meta's words, an address or a token.

// callGraph makes one Graph request with a business's token (in the
// Authorization header) and appsecret_proof (a token copied elsewhere is
// useless without ansa's app secret).
func callGraph(ctx context.Context, method, path, appSecret, token string, body []byte) (*http.Response, error) {
	query := url.Values{"appsecret_proof": {messenger.AppSecretProof(token, appSecret)}}
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	separator := "?"
	if strings.Contains(path, "?") {
		separator = "&"
	}
	request, err := http.NewRequestWithContext(ctx, method, GraphURL+path+separator+query.Encode(), reader)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	return graphClient.Do(request)
}

// graphSucceeded makes one call that answers {"success": true}.
func graphSucceeded(ctx context.Context, method, path, appSecret, token string, body []byte) bool {
	response, err := callGraph(ctx, method, path, appSecret, token, body)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	var answer struct {
		Success bool `json:"success"`
	}
	json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&answer)
	return response.StatusCode/100 == 2 && answer.Success
}

func getJSONWithToken(ctx context.Context, path, appSecret, token string, into any) (int, error) {
	response, err := callGraph(ctx, http.MethodGet, path, appSecret, token, nil)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(into)
	return response.StatusCode, nil
}

// getJSON reads a Graph answer that needs no business token (the address
// holds ansa's app credentials: never logged, like every Graph address).
func getJSON(ctx context.Context, address string, into any) (int, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return 0, err
	}
	response, err := graphClient.Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(into)
	return response.StatusCode, nil
}

// randomPIN is six random digits.
func randomPIN() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

func cutTo(text string, max int) string {
	if runes := []rune(text); len(runes) > max {
		return string(runes[:max])
	}
	return text
}
