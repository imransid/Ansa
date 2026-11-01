package config

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"regexp"
	"strings"
)

// The command-line tools (cmd/operator, cmd/simulate) read their settings
// from the environment first, then from the settings file for what the
// environment doesn't set. WHY: the operator runs
// `DATABASE_URL="<production>" make link-phone-line ...`, and a file read
// over the environment (the shell's `. ../.env.core`) would quietly put the
// local database back in its place. The old backend's `tsx --env-file`
// kept the same rule: the command line wins.

var settingName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// FillFromFile sets each NAME=value line of a settings file (../.env.core)
// that the environment doesn't set already. A missing file is fine (the
// environment alone, as on a server). A file with a bad line sets nothing;
// the error names the line, never a value.
func FillFromFile(path string) error {
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return errors.New("settings file: it can't be read")
	}
	settings := map[string]string{}
	for index, line := range strings.Split(string(data), "\n") {
		name, value, isSetting, ok := readSettingLine(line)
		if !ok {
			return fmt.Errorf("settings file: line %d isn't NAME=value", index+1)
		}
		if isSetting {
			settings[name] = value
		}
	}
	for name, value := range settings {
		if _, alreadySet := os.LookupEnv(name); alreadySet {
			continue
		}
		if err := os.Setenv(name, value); err != nil {
			return errors.New("settings file: a setting can't be set")
		}
	}
	return nil
}

// readSettingLine reads one line: a setting, or a blank or "#" comment line
// (isSetting false). A value may sit in quotes; an unquoted value ends
// before " #" (a comment after it, as the shell reads it).
func readSettingLine(line string) (name, value string, isSetting, ok bool) {
	line = strings.TrimSpace(strings.TrimSuffix(line, "\r"))
	if line == "" || strings.HasPrefix(line, "#") {
		return "", "", false, true
	}
	line = strings.TrimPrefix(line, "export ")
	name, value, found := strings.Cut(line, "=")
	name = strings.TrimSpace(name)
	if !found || !settingName.MatchString(name) {
		return "", "", false, false
	}
	value = strings.TrimSpace(value)
	if quoted(value, `"`) || quoted(value, `'`) {
		return name, value[1 : len(value)-1], true, true
	}
	if comment := strings.Index(value, " #"); comment >= 0 {
		value = strings.TrimSpace(value[:comment])
	}
	return name, value, true, true
}

func quoted(value, mark string) bool {
	return len(value) >= 2 && strings.HasPrefix(value, mark) && strings.HasSuffix(value, mark)
}
