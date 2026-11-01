package email

import (
	"errors"
	"html"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// writeToDevOutbox writes the email as an HTML page in .dev-emails/ (the
// old adapters/dev-email-outbox.ts): open it in a browser. Nothing is sent.
func (s *Sender) writeToDevOutbox(message Message) Result {
	stamp := strings.ReplaceAll(time.Now().UTC().Format("2006-01-02T15:04:05.000Z"), ":", "-")
	name := stamp + "-" + safeFileName(message.IdempotencyKey) + ".html"
	replyTo := message.ReplyTo
	if replyTo == "" {
		replyTo = "(none)"
	}
	var page strings.Builder
	page.WriteString("<!doctype html>\n<html>\n  <body>\n    <p style=\"background: #fff3cd; padding: 8px;\">Dev outbox: this email was NOT sent.</p>\n")
	for _, field := range [][2]string{{"From", message.From}, {"To", message.To}, {"Reply-To", replyTo}, {"Subject", message.Subject}} {
		page.WriteString("<div><strong>" + field[0] + ":</strong> " + html.EscapeString(field[1]) + "</div>\n")
	}
	page.WriteString("    <hr />\n    " + message.HTML + "\n    <hr />\n    <pre>" + html.EscapeString(message.Text) + "</pre>\n  </body>\n</html>")
	folder := filepath.Join(s.DevFolder, ".dev-emails")
	if err := os.MkdirAll(folder, 0o700); err != nil {
		return Result{Error: fileErrorCode(err)}
	}
	if err := os.WriteFile(filepath.Join(folder, name), []byte(page.String()), 0o600); err != nil {
		return Result{Error: fileErrorCode(err)}
	}
	return Result{OK: true, ProviderID: "dev-outbox:" + name}
}

// safeFileName keeps letters, digits and "-" only.
func safeFileName(key string) string {
	return strings.Map(func(r rune) rune {
		if r == '-' || (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
			return r
		}
		return '_'
	}, key)
}

// fileErrorCode is the file system's code only ("EROFS"): its message holds the path.
func fileErrorCode(err error) string {
	var errno syscall.Errno
	if errors.As(err, &errno) {
		switch errno {
		case syscall.EROFS:
			return "EROFS"
		case syscall.EACCES:
			return "EACCES"
		case syscall.ENOSPC:
			return "ENOSPC"
		}
	}
	if errors.Is(err, fs.ErrPermission) {
		return "EACCES"
	}
	return "unknown_error"
}
