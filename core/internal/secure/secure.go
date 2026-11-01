// Package secure encrypts sensitive text stored in the database (messages,
// transcripts, tokens, addresses) with AES-256-GCM, in the same "v1" format
// the old TypeScript backend wrote (lib/encryption.ts), so both read the
// same rows during the move.
//
// Stored format: "v1:<iv>:<tag>:<ciphertext>", each part standard base64.
// The context (company and record) is mixed in as additional authenticated
// data: it isn't stored, and a value copied into another company's row can't
// be decrypted there.
package secure

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
)

const (
	formatVersion = "v1"
	ivBytes       = 12
	// Always the full tag: a shorter one would make a forged value easier to guess.
	tagBytes = 16
	keyBytes = 32
)

// ErrUnreadable is returned when stored text can't be decrypted: changed
// data, another context, a wrong key, or an unknown format. Never log the
// value or the context with it.
var ErrUnreadable = errors.New("stored text can't be decrypted")

// Box holds the encryption key. Make one at start with NewBox.
type Box struct {
	aead cipher.AEAD
}

// NewBox checks the key (32 bytes, given as base64) and prepares AES-256-GCM.
func NewBox(base64Key string) (*Box, error) {
	key, err := base64.StdEncoding.DecodeString(base64Key)
	if err != nil || len(key) != keyBytes {
		return nil, errors.New("the encryption key must be 32 bytes, written as base64")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("preparing AES: %w", err)
	}
	aead, err := cipher.NewGCMWithTagSize(block, tagBytes)
	if err != nil {
		return nil, fmt.Errorf("preparing GCM: %w", err)
	}
	return &Box{aead: aead}, nil
}

// Encrypt returns the stored form of plainText for this context, with a
// fresh random IV every time.
func (b *Box) Encrypt(plainText, context string) (string, error) {
	iv := make([]byte, ivBytes)
	if _, err := rand.Read(iv); err != nil {
		return "", fmt.Errorf("making an IV: %w", err)
	}
	sealed := b.aead.Seal(nil, iv, []byte(plainText), []byte(context))
	// Go appends the tag to the ciphertext; the stored format keeps them apart.
	ciphertext, tag := sealed[:len(sealed)-tagBytes], sealed[len(sealed)-tagBytes:]
	parts := []string{formatVersion, encode(iv), encode(tag), encode(ciphertext)}
	return strings.Join(parts, ":"), nil
}

// Decrypt reads a stored value written for this context, or ErrUnreadable.
func (b *Box) Decrypt(stored, context string) (string, error) {
	parts := strings.Split(stored, ":")
	if len(parts) != 4 || parts[0] != formatVersion {
		return "", ErrUnreadable
	}
	iv, errIV := decode(parts[1])
	tag, errTag := decode(parts[2])
	ciphertext, errText := decode(parts[3])
	if errIV != nil || errTag != nil || errText != nil || len(iv) != ivBytes || len(tag) != tagBytes || len(ciphertext) == 0 {
		return "", ErrUnreadable
	}
	plain, err := b.aead.Open(nil, iv, append(ciphertext, tag...), []byte(context))
	if err != nil {
		return "", ErrUnreadable
	}
	return string(plain), nil
}

func encode(data []byte) string {
	return base64.StdEncoding.EncodeToString(data)
}

func decode(text string) ([]byte, error) {
	return base64.StdEncoding.DecodeString(text)
}
