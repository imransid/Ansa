package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The file fills only what the environment doesn't set: a value given on
// the command line (DATABASE_URL="<production>" make ...) always wins.
func TestTheSettingsFileNeverOverridesTheEnvironment(t *testing.T) {
	file := filepath.Join(t.TempDir(), ".env.core")
	content := strings.Join([]string{
		"# a comment",
		"",
		"CORE_FILE_TEST_GIVEN=from-the-file",
		"CORE_FILE_TEST_FILLED=postgres://localhost/ansa",
		`export CORE_FILE_TEST_QUOTED="a value # with a mark"`,
		"CORE_FILE_TEST_COMMENTED=plain # a note\r",
	}, "\n")
	if err := os.WriteFile(file, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CORE_FILE_TEST_GIVEN", "from-the-command-line")
	for _, name := range []string{"CORE_FILE_TEST_FILLED", "CORE_FILE_TEST_QUOTED", "CORE_FILE_TEST_COMMENTED"} {
		t.Cleanup(func() { os.Unsetenv(name) })
	}
	if err := FillFromFile(file); err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"CORE_FILE_TEST_GIVEN":     "from-the-command-line",
		"CORE_FILE_TEST_FILLED":    "postgres://localhost/ansa",
		"CORE_FILE_TEST_QUOTED":    "a value # with a mark",
		"CORE_FILE_TEST_COMMENTED": "plain",
	}
	for name, value := range want {
		if got := os.Getenv(name); got != value {
			t.Errorf("%s: got %q, want %q", name, got, value)
		}
	}
}

func TestAMissingFileIsTheEnvironmentAloneAndABadLineIsNamedWithoutItsValue(t *testing.T) {
	if err := FillFromFile(filepath.Join(t.TempDir(), "none")); err != nil {
		t.Fatalf("a missing file is fine: %v", err)
	}
	file := filepath.Join(t.TempDir(), ".env.core")
	os.WriteFile(file, []byte("CORE_FILE_TEST_GOOD=1\nsecret-value-without-a-name\n"), 0o600)
	t.Cleanup(func() { os.Unsetenv("CORE_FILE_TEST_GOOD") })
	err := FillFromFile(file)
	if err == nil || !strings.Contains(err.Error(), "line 2") || strings.Contains(err.Error(), "secret-value") {
		t.Fatalf("got %v", err)
	}
	if _, set := os.LookupEnv("CORE_FILE_TEST_GOOD"); set {
		t.Fatal("a file with a bad line sets nothing")
	}
}
