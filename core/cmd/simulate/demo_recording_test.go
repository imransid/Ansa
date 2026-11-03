package main

import (
	"bytes"
	"testing"
)

// The demo's recording is a WAV file whose samples read back as written.
func TestTheDemoRecordingIsAWAVFile(t *testing.T) {
	samples := []byte{1, 0, 2, 0, 3, 0}
	file := wavFile(samples)
	if len(file) != 44+len(samples) || string(file[:4]) != "RIFF" || string(file[8:16]) != "WAVEfmt " {
		t.Fatalf("a WAV header: %q", file[:16])
	}
	read, err := wavSamples(file)
	if err != nil || !bytes.Equal(read, samples) {
		t.Fatalf("samples read back: %v %v", read, err)
	}
	if _, err := wavSamples([]byte("not a wav file at all")); err == nil {
		t.Fatal("not a WAV file")
	}
}
