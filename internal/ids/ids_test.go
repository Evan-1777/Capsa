package ids

import (
	"regexp"
	"testing"
)

func TestIdentifierShapes(t *testing.T) {
	memoryPattern := regexp.MustCompile(`^mem_[a-z0-9]{6}$`)
	if !memoryPattern.MatchString(NewMemoryID()) {
		t.Fatalf("unexpected memory id: %q", NewMemoryID())
	}
	keyPattern := regexp.MustCompile(`^[a-z0-9]{8}$`)
	if !keyPattern.MatchString(NewKeyID()) {
		t.Fatalf("unexpected key id: %q", NewKeyID())
	}
	secretPattern := regexp.MustCompile(`^[A-Za-z0-9_-]{32}$`)
	if !secretPattern.MatchString(NewSecret()) {
		t.Fatalf("unexpected secret: %q", NewSecret())
	}
}

func TestNewTokenShape(t *testing.T) {
	keyID := NewKeyID()
	token := NewToken(keyID)
	pattern := regexp.MustCompile(`^capsa_[a-z0-9]{8}_[A-Za-z0-9_-]{32}$`)
	if !pattern.MatchString(token) {
		t.Fatalf("unexpected token: %q", token)
	}
	if len(token) != 47 {
		t.Fatalf("token length = %d, want 47", len(token))
	}
}

func TestHashTokenKnownVector(t *testing.T) {
	// SHA-256 of "abc".
	got := HashToken("abc")
	want := "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
	if got != want {
		t.Fatalf("HashToken(abc) = %q", got)
	}
	if len(HashToken("x")) != 64 {
		t.Fatal("hash must be 64 hex characters")
	}
}
