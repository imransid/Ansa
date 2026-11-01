package logging

import (
	"bytes"
	"errors"
	"strings"
	"testing"
)

func TestAnErrorIsLoggedByItsTypeNeverItsMessage(t *testing.T) {
	var out bytes.Buffer
	New(&out).Error("telegram send failed", ErrorType(errors.New("token 12345:SECRET refused")), Code("refused"))
	line := out.String()
	if strings.Contains(line, "SECRET") || strings.Contains(line, "refused\"") && strings.Contains(line, "token") {
		t.Fatalf("the error's message reached the log: %s", line)
	}
	if !strings.Contains(line, `"error_type":"*errors.errorString"`) || !strings.Contains(line, `"code":"refused"`) {
		t.Fatalf("missing safe fields: %s", line)
	}
}
