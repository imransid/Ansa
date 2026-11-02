package brainclient

import (
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"
)

// What the brain's own work around the model takes at most (reading the
// request, building the prompt, checking the answer), on top of the model.
const brainOverhead = 5 * time.Second

// Every use the brain defines (brain/brain/ai.py) and the wait of the core
// part that asks for it. A new use must be added here.
var waitForUse = map[string]time.Duration{
	"ASSISTANT_REPLY":    AssistantReplyWait,
	"EMAIL_TRIAGE":       EmailTriageWait,
	"CALL_DECISION":      CallDecisionWait,
	"AUTOPOST":           AutopostWait,
	"MENU_READING":       MenuReadingWait,
	"PERFORMANCE_REVIEW": PerformanceReviewWait,
	"CONTENT_DRAFT":      ContentDraftWait,
	"ONBOARDING_TURN":    CofounderWait,
	"FACT_SUGGESTION":    CofounderWait,
	"MARKETING_PLAN":     CofounderWait,
	"CALENDAR_PLAN":      CofounderWait,
}

var (
	useLine       = regexp.MustCompile(`(?m)^([A-Z_]+) = UseSettings\(.*timeout_seconds=([0-9_]+), max_retries=([0-9]+)\)`)
	retryWaitLine = regexp.MustCompile(`(?m)^MAX_RETRY_WAIT_SECONDS = ([0-9.]+)$`)
	claudeCode    = regexp.MustCompile(`(?m)^TIMEOUT_SECONDS = ([0-9]+)$`)
)

// The brain finishes every use before core stops waiting for its answer:
// every try timing out and the longest waits between them (or Claude Code's
// limit), plus the brain's own work. Read from the brain's files, so tuning
// either side can't leave core giving up on answers the brain still pays for.
func TestTheBrainAnswersBeforeCoreStopsWaiting(t *testing.T) {
	settings := readBrainFile(t, "../../../brain/brain/ai.py")
	retryWait := secondsIn(t, retryWaitLine, settings, "MAX_RETRY_WAIT_SECONDS")
	uses := useLine.FindAllStringSubmatch(settings, -1)
	if len(uses) < len(waitForUse) {
		t.Fatalf("found %d uses in brain/brain/ai.py, expected at least %d: did their lines change shape?", len(uses), len(waitForUse))
	}
	for _, use := range uses {
		name := use[1]
		wait, known := waitForUse[name]
		if !known {
			t.Errorf("%s: a use core doesn't know: add its wait to waitForUse (and waits.go)", name)
			continue
		}
		timeout := seconds(t, use[2])
		retries, _ := strconv.Atoi(use[3])
		longest := timeout*time.Duration(retries+1) + retryWait*time.Duration(retries) + brainOverhead
		if longest > wait {
			t.Errorf("%s: the brain may take %v, but core waits %v", name, longest, wait)
		}
	}

	// Claude Code (development) answers the assistant and "Post for me".
	limit := secondsIn(t, claudeCode, readBrainFile(t, "../../../brain/brain/claude_code.py"), "TIMEOUT_SECONDS")
	for _, wait := range []time.Duration{AssistantReplyWait, AutopostWait} {
		if limit+brainOverhead > wait {
			t.Errorf("Claude Code may take %v, but core waits %v", limit, wait)
		}
	}
	// Whisper (development) hears the practice phone's recordings.
	hearing := secondsIn(t, claudeCode, readBrainFile(t, "../../../brain/brain/voice/whisper.py"), "TIMEOUT_SECONDS")
	if hearing+brainOverhead > VoiceWait {
		t.Errorf("Whisper may take %v, but core waits %v", hearing, VoiceWait)
	}
}

func readBrainFile(t *testing.T, path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading %s: %v", path, err)
	}
	return string(data)
}

func secondsIn(t *testing.T, line *regexp.Regexp, text, name string) time.Duration {
	found := line.FindStringSubmatch(text)
	if found == nil {
		t.Fatalf("%s not found in the brain's file", name)
	}
	return seconds(t, found[1])
}

// seconds reads a Python number ("30", "8.0", "3_000") as seconds.
func seconds(t *testing.T, number string) time.Duration {
	value, err := strconv.ParseFloat(strings.ReplaceAll(number, "_", ""), 64)
	if err != nil {
		t.Fatalf("not a number: %q", number)
	}
	return time.Duration(value * float64(time.Second))
}
