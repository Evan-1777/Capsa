// Package ids generates identifiers and tokens from a cryptographically secure
// source, along with the token hash used for storage.
package ids

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
)

// Locked alphabets, aligned with capsa/ids.py.
const (
	idAlphabet     = "abcdefghijklmnopqrstuvwxyz0123456789"
	secretAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"

	memoryIDChars = 6
	keyIDChars    = 8
	secretChars   = 32
)

// NewKeyID returns an 8-character key identifier.
func NewKeyID() string {
	return randomFrom(idAlphabet, keyIDChars)
}

// NewSecret returns a 32-character token secret.
func NewSecret() string {
	return randomFrom(secretAlphabet, secretChars)
}

// NewMemoryID returns a memory identifier: the "mem_" prefix plus 6 characters.
func NewMemoryID() string {
	return "mem_" + randomFrom(idAlphabet, memoryIDChars)
}

// NewToken builds a plaintext token from a key id and a fresh secret.
func NewToken(keyID string) string {
	return "capsa_" + keyID + "_" + NewSecret()
}

// HashToken returns the lowercase hex SHA-256 digest of a plaintext token.
func HashToken(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}

// randomFrom draws n characters from alphabet using rejection sampling to keep
// the distribution uniform. crypto/rand.Read never fails on supported systems.
func randomFrom(alphabet string, n int) string {
	limit := 256 - (256 % len(alphabet))
	buffer := make([]byte, n*2)
	out := make([]byte, 0, n)
	for len(out) < n {
		_, _ = rand.Read(buffer)
		for _, b := range buffer {
			if len(out) >= n {
				break
			}
			if int(b) >= limit {
				continue
			}
			out = append(out, alphabet[int(b)%len(alphabet)])
		}
	}
	return string(out)
}
