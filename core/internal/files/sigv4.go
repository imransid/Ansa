package files

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

// AWS Signature Version 4, the way R2 (the S3 API) checks every request:
// written here with the standard library only (one file, tested against
// AWS's own documented examples) instead of the whole AWS SDK.

// credentials are one access key of one bucket's account.
type credentials struct {
	accessKeyID, secretAccessKey, region string
}

const algorithm = "AWS4-HMAC-SHA256"

// emptyPayloadHash is SHA-256 of nothing (a GET or DELETE body).
const emptyPayloadHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

// signHeaders signs a request in its headers: it returns the Authorization
// value for these headers (lower-case names, already including host,
// x-amz-date and x-amz-content-sha256).
func (c credentials) signHeaders(method, path string, query url.Values, headers map[string]string, payloadHash string, at time.Time) string {
	names := make([]string, 0, len(headers))
	for name := range headers {
		names = append(names, name)
	}
	sort.Strings(names)
	var canonicalHeaders strings.Builder
	for _, name := range names {
		canonicalHeaders.WriteString(name + ":" + strings.TrimSpace(headers[name]) + "\n")
	}
	signedHeaders := strings.Join(names, ";")
	request := strings.Join([]string{method, escapePath(path), canonicalQuery(query), canonicalHeaders.String(), signedHeaders, payloadHash}, "\n")
	scope := c.scope(at)
	return algorithm + " Credential=" + c.accessKeyID + "/" + scope + ", SignedHeaders=" + signedHeaders + ", Signature=" + c.signature(request, scope, at)
}

// presign is a GET link that works for `seconds`, signed in its query:
// only the host header is signed and the payload is UNSIGNED-PAYLOAD.
func (c credentials) presign(host, path string, query url.Values, seconds int, at time.Time) string {
	signed := url.Values{}
	for name, values := range query {
		signed[name] = values
	}
	signed.Set("X-Amz-Algorithm", algorithm)
	signed.Set("X-Amz-Credential", c.accessKeyID+"/"+c.scope(at))
	signed.Set("X-Amz-Date", at.UTC().Format("20060102T150405Z"))
	signed.Set("X-Amz-Expires", strconv.Itoa(seconds))
	signed.Set("X-Amz-SignedHeaders", "host")
	request := strings.Join([]string{"GET", escapePath(path), canonicalQuery(signed), "host:" + host + "\n", "host", "UNSIGNED-PAYLOAD"}, "\n")
	signed.Set("X-Amz-Signature", c.signature(request, c.scope(at), at))
	return "https://" + host + escapePath(path) + "?" + canonicalQuery(signed)
}

func (c credentials) scope(at time.Time) string {
	return at.UTC().Format("20060102") + "/" + c.region + "/s3/aws4_request"
}

// signature: the string to sign (the canonical request's hash under its
// date and scope), signed with a key derived from the secret, the day, the
// region and the service.
func (c credentials) signature(canonicalRequest, scope string, at time.Time) string {
	requestHash := sha256.Sum256([]byte(canonicalRequest))
	toSign := algorithm + "\n" + at.UTC().Format("20060102T150405Z") + "\n" + scope + "\n" + hex.EncodeToString(requestHash[:])
	key := hmacSHA256([]byte("AWS4"+c.secretAccessKey), at.UTC().Format("20060102"))
	key = hmacSHA256(key, c.region)
	key = hmacSHA256(key, "s3")
	key = hmacSHA256(key, "aws4_request")
	return hex.EncodeToString(hmacSHA256(key, toSign))
}

func hmacSHA256(key []byte, data string) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(data))
	return mac.Sum(nil)
}

// canonicalQuery: names sorted, every name and value escaped the AWS way.
func canonicalQuery(query url.Values) string {
	names := make([]string, 0, len(query))
	for name := range query {
		names = append(names, name)
	}
	sort.Strings(names)
	var parts []string
	for _, name := range names {
		values := append([]string{}, query[name]...)
		sort.Strings(values)
		for _, value := range values {
			parts = append(parts, escape(name)+"="+escape(value))
		}
	}
	return strings.Join(parts, "&")
}

// escapePath escapes each segment of a path, keeping the slashes.
func escapePath(path string) string {
	segments := strings.Split(path, "/")
	for i, segment := range segments {
		segments[i] = escape(segment)
	}
	return strings.Join(segments, "/")
}

// escape is RFC 3986: only A-Z a-z 0-9 - _ . ~ stay as they are.
func escape(text string) string {
	var out strings.Builder
	for _, b := range []byte(text) {
		if (b >= 'A' && b <= 'Z') || (b >= 'a' && b <= 'z') || (b >= '0' && b <= '9') || b == '-' || b == '_' || b == '.' || b == '~' {
			out.WriteByte(b)
		} else {
			out.WriteString("%" + strings.ToUpper(hex.EncodeToString([]byte{b})))
		}
	}
	return out.String()
}
