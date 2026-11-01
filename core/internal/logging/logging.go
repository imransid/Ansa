// Package logging writes one JSON line per event with a fixed message and
// only safe fields: an event name, an error's type, a code, a count, a
// duration. There is no way to log free text, a request body or an error's
// message, because those can hold customers' words, names, tokens or keys
// (docs/backend/security.md, rule 3).
package logging

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"time"
)

// Logger is the service's logger. Make it once with New.
type Logger struct {
	out *slog.Logger
}

// Field is one safe value on a log line. Make it with the functions below.
type Field struct {
	attr slog.Attr
}

// New writes JSON lines to w (os.Stdout in production).
func New(w io.Writer) *Logger {
	if w == nil {
		w = os.Stdout
	}
	return &Logger{out: slog.New(slog.NewJSONHandler(w, nil))}
}

// Code is a short fixed code ("rate_limited", "not_connected").
func Code(code string) Field { return Field{slog.String("code", code)} }

// Count is a number of things.
func Count(name string, n int) Field { return Field{slog.Int(name, n)} }

// Took is how long something took.
func Took(d time.Duration) Field { return Field{slog.Int64("took_ms", d.Milliseconds())} }

// ErrorType names an error by its Go type only, never its message.
func ErrorType(err error) Field {
	if err == nil {
		return Field{slog.String("error_type", "none")}
	}
	return Field{slog.String("error_type", fmt.Sprintf("%T", err))}
}

// Info logs a normal event. `event` must be a fixed string written in code.
func (l *Logger) Info(event string, fields ...Field) { l.out.Info(event, attrs(fields)...) }

// Warn logs something refused or skipped.
func (l *Logger) Warn(event string, fields ...Field) { l.out.Warn(event, attrs(fields)...) }

// Error logs a failure.
func (l *Logger) Error(event string, fields ...Field) { l.out.Error(event, attrs(fields)...) }

func attrs(fields []Field) []any {
	list := make([]any, 0, len(fields))
	for _, field := range fields {
		list = append(list, field.attr)
	}
	return list
}
