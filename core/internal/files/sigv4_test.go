package files

import (
	"net/url"
	"strings"
	"testing"
	"time"
)

// AWS's documented example credentials and day ("Signature Version 4
// examples" in the S3 API reference).
var example = credentials{accessKeyID: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1"}

var exampleDay = time.Date(2013, 5, 24, 0, 0, 0, 0, time.UTC)

func TestHeaderSigningMatchesAWSsGetObjectExample(t *testing.T) {
	headers := map[string]string{
		"host":                 "examplebucket.s3.amazonaws.com",
		"range":                "bytes=0-9",
		"x-amz-content-sha256": emptyPayloadHash,
		"x-amz-date":           "20130524T000000Z",
	}
	authorization := example.signHeaders("GET", "/test.txt", url.Values{}, headers, emptyPayloadHash, exampleDay)
	if !strings.HasSuffix(authorization, "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41") {
		t.Fatalf("authorization: %s", authorization)
	}
}

func TestPresigningMatchesAWSsQueryExample(t *testing.T) {
	link := example.presign("examplebucket.s3.amazonaws.com", "/test.txt", url.Values{}, 86400, exampleDay)
	if !strings.Contains(link, "X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404") {
		t.Fatalf("link: %s", link)
	}
}
