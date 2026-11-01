// Package files is core's private file storage (the old lib/file-storage.ts,
// adapters/r2.ts, adapters/dev-file-storage.ts): call recordings, uploaded
// documents, the media library. Core code calls these functions only, never
// R2 or the folder directly. Development: files in <DevFolder>/.dev-files
// (git-ignored). Production: Cloudflare R2 (USE_R2_STORAGE=true), a PRIVATE
// bucket reached only through short-lived signed links. Keys are made by
// core from ids only: <kind>/<companyId>/<id>.<ext>.
package files

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// ErrUnsafeKey: a key that isn't one of ours (never stored or read).
var ErrUnsafeKey = errors.New("files: unsafe key")

// Keys: letters, digits, / . _ -, starting with a letter or digit, no "..".
var safeKey = regexp.MustCompile(`^[a-z0-9][a-z0-9/._-]*$`)

// The largest file read back (the media library's longest video).
const readMax = 100 << 20

// R2 is one bucket's settings (all four, or file storage is the folder).
type R2 struct {
	AccountID, AccessKeyID, SecretAccessKey, Bucket string
}

// Store keeps files in R2, or (no R2) in the development folder.
type Store struct {
	R2        *R2
	DevFolder string
	// A test replaces the client.
	Client *http.Client
}

// Access is how a stored file is reached: a short-lived signed link (R2),
// or its bytes (development), served by core's own route after its login
// check, always with the type core stored.
type Access struct {
	SignedURL string
	Bytes     []byte
}

func checkKey(key string) error {
	if !safeKey.MatchString(key) || strings.Contains(key, "..") {
		return ErrUnsafeKey
	}
	return nil
}

// Put stores a file under key with its type.
func (s *Store) Put(ctx context.Context, key string, data []byte, contentType string) error {
	if err := checkKey(key); err != nil {
		return err
	}
	if s.R2 == nil {
		path, err := s.devPath(key)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return err
		}
		return os.WriteFile(path, data, 0o600)
	}
	response, err := s.r2Request(ctx, http.MethodPut, key, data, map[string]string{"content-type": contentType})
	if err != nil {
		return err
	}
	response.Body.Close()
	if response.StatusCode/100 != 2 {
		return errors.New("files: R2 refused the upload: " + response.Status)
	}
	return nil
}

// Read is a file's bytes, read on the server (a document's text, a post's
// image), or found=false. Never sent to a browser from here.
func (s *Store) Read(ctx context.Context, key string) (data []byte, found bool, err error) {
	if err := checkKey(key); err != nil {
		return nil, false, err
	}
	if s.R2 == nil {
		path, err := s.devPath(key)
		if err != nil {
			return nil, false, err
		}
		data, err := os.ReadFile(path)
		if errors.Is(err, os.ErrNotExist) {
			return nil, false, nil
		}
		return data, err == nil, err
	}
	response, err := s.r2Request(ctx, http.MethodGet, key, nil, nil)
	if err != nil {
		return nil, false, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return nil, false, nil
	}
	if response.StatusCode/100 != 2 {
		return nil, false, errors.New("files: R2 refused the read: " + response.Status)
	}
	data, err = io.ReadAll(io.LimitReader(response.Body, readMax+1))
	if err == nil && len(data) > readMax {
		return nil, false, errors.New("files: file too large to read")
	}
	return data, err == nil, err
}

// Delete removes a file (no file: nothing to do).
func (s *Store) Delete(ctx context.Context, key string) error {
	if err := checkKey(key); err != nil {
		return err
	}
	if s.R2 == nil {
		path, err := s.devPath(key)
		if err != nil {
			return err
		}
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	response, err := s.r2Request(ctx, http.MethodDelete, key, nil, nil)
	if err != nil {
		return err
	}
	response.Body.Close()
	if response.StatusCode/100 != 2 && response.StatusCode != http.StatusNotFound {
		return errors.New("files: R2 refused the delete: " + response.Status)
	}
	return nil
}

// Reach is how to hand one file to a browser: a link that works for
// `seconds`, answered with contentType whatever the object says (and saved
// as downloadName when given), or the bytes in development (found=false:
// no such file).
func (s *Store) Reach(ctx context.Context, key, contentType string, seconds int, downloadName string) (access Access, found bool, err error) {
	if err := checkKey(key); err != nil {
		return Access{}, false, err
	}
	if s.R2 == nil {
		data, found, err := s.Read(ctx, key)
		return Access{Bytes: data}, found, err
	}
	query := url.Values{"response-content-type": {contentType}}
	if downloadName != "" {
		query.Set("response-content-disposition", "attachment; filename*=UTF-8''"+url.PathEscape(downloadName))
	}
	return Access{SignedURL: s.credentials().presign(s.host(), "/"+s.R2.Bucket+"/"+key, query, seconds, time.Now())}, true, nil
}

// devPath keeps every key inside the development folder.
func (s *Store) devPath(key string) (string, error) {
	root, err := filepath.Abs(filepath.Join(s.DevFolder, ".dev-files"))
	if err != nil {
		return "", err
	}
	path := filepath.Join(root, filepath.FromSlash(key))
	if !strings.HasPrefix(path, root+string(filepath.Separator)) {
		return "", ErrUnsafeKey
	}
	return path, nil
}

func (s *Store) host() string {
	return s.R2.AccountID + ".r2.cloudflarestorage.com"
}

func (s *Store) credentials() credentials {
	return credentials{accessKeyID: s.R2.AccessKeyID, secretAccessKey: s.R2.SecretAccessKey, region: "auto"}
}

// r2Request sends one signed request about one object (path-style:
// /<bucket>/<key>), 60 s at most.
func (s *Store) r2Request(ctx context.Context, method, key string, body []byte, extra map[string]string) (*http.Response, error) {
	path := "/" + s.R2.Bucket + "/" + key
	payloadHash := emptyPayloadHash
	if body != nil {
		sum := sha256.Sum256(body)
		payloadHash = hex.EncodeToString(sum[:])
	}
	now := time.Now()
	headers := map[string]string{"host": s.host(), "x-amz-date": now.UTC().Format("20060102T150405Z"), "x-amz-content-sha256": payloadHash}
	for name, value := range extra {
		headers[name] = value
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	request, err := http.NewRequestWithContext(ctx, method, "https://"+s.host()+escapePath(path), bytes.NewReader(body))
	if err != nil {
		cancel()
		return nil, err
	}
	for name, value := range headers {
		if name != "host" {
			request.Header.Set(name, value)
		}
	}
	request.Header.Set("Authorization", s.credentials().signHeaders(method, path, url.Values{}, headers, payloadHash, now))
	client := s.Client
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Do(request)
	if err != nil {
		cancel()
		return nil, err
	}
	response.Body = cancelOnClose{response.Body, cancel}
	return response, nil
}

// cancelOnClose ends the request's time limit once its body is closed.
type cancelOnClose struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (c cancelOnClose) Close() error {
	defer c.cancel()
	return c.ReadCloser.Close()
}
