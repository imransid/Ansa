package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"ansa/core/internal/files"
)

// A recording for the demo's first finished call (its call page plays it):
// each turn spoken by the Mac's own voices (say), Samantha for ansa's phone
// assistant and Rishi for the caller, joined into one WAV and stored where a
// call's recording is (recordings/<company>/<call>.wav). On a computer
// without say, or without those voices, the call has no recording.

// say's output: 16-bit mono at this rate.
const recordingRate = 22050

func addDemoRecording(ctx context.Context, w *world, a demoAccount) error {
	sayProgram, err := exec.LookPath("say")
	if err != nil {
		fmt.Fprintln(w.out, "No recording for the demo call: say isn't on this computer.")
		return nil
	}
	call := demoCalls[0]
	var callID string
	if err := w.pool.QueryRow(ctx, `SELECT id::text FROM calls WHERE company_id = $1 AND caller_number = $2`, a.company.String(), call.caller).Scan(&callID); err != nil {
		return err
	}
	folder, err := os.MkdirTemp("", "ansa-demo-call-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(folder)
	pause := make([]byte, recordingRate*2*4/10)
	var samples []byte
	for i, line := range call.transcript {
		voice, text := "Rishi", strings.TrimPrefix(line, "User: ")
		if strings.HasPrefix(line, "AI: ") {
			voice, text = "Samantha", strings.TrimPrefix(line, "AI: ")
		}
		spoken, err := speak(ctx, sayProgram, voice, text, filepath.Join(folder, fmt.Sprintf("%d.wav", i)))
		if err != nil {
			fmt.Fprintln(w.out, "No recording for the demo call: say couldn't speak it.")
			return nil
		}
		samples = append(append(samples, spoken...), pause...)
	}
	key := "recordings/" + a.company.String() + "/" + callID + ".wav"
	if err := (&files.Store{DevFolder: w.cfg.DevFolder}).Put(ctx, key, wavFile(samples), "audio/wav"); err != nil {
		return err
	}
	_, err = w.pool.Exec(ctx, `UPDATE calls SET recording_status = 'stored', recording_key = $3, recording_content_type = 'audio/wav' WHERE company_id = $1 AND id = $2`,
		a.company.String(), callID, key)
	return err
}

// speak has say speak the text into a WAV file and returns its samples.
func speak(ctx context.Context, sayProgram, voice, text, file string) ([]byte, error) {
	format := fmt.Sprintf("--data-format=LEI16@%d", recordingRate)
	if err := exec.CommandContext(ctx, sayProgram, "-v", voice, "-o", file, "--file-format=WAVE", format, text).Run(); err != nil {
		return nil, err
	}
	content, err := os.ReadFile(file)
	if err != nil {
		return nil, err
	}
	return wavSamples(content)
}

// wavSamples is the "data" chunk of a WAV file.
func wavSamples(content []byte) ([]byte, error) {
	if len(content) < 12 || string(content[:4]) != "RIFF" || string(content[8:12]) != "WAVE" {
		return nil, errors.New("not a WAV file")
	}
	for at := 12; at+8 <= len(content); {
		size := int(binary.LittleEndian.Uint32(content[at+4 : at+8]))
		if string(content[at:at+4]) == "data" && at+8+size <= len(content) {
			return content[at+8 : at+8+size], nil
		}
		at += 8 + size + size%2
	}
	return nil, errors.New("no samples")
}

// wavFile wraps 16-bit mono samples in a WAV file.
func wavFile(samples []byte) []byte {
	var file bytes.Buffer
	file.WriteString("RIFF")
	binary.Write(&file, binary.LittleEndian, uint32(36+len(samples)))
	file.WriteString("WAVEfmt ")
	for _, value := range []any{uint32(16), uint16(1), uint16(1), uint32(recordingRate), uint32(recordingRate * 2), uint16(2), uint16(16)} {
		binary.Write(&file, binary.LittleEndian, value)
	}
	file.WriteString("data")
	binary.Write(&file, binary.LittleEndian, uint32(len(samples)))
	file.Write(samples)
	return file.Bytes()
}
