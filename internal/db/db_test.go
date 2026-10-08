package db

import (
	"path/filepath"
	"regexp"
	"testing"
)

func TestUtcNowFixedWidth(t *testing.T) {
	pattern := regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\+00:00$`)
	value := UtcNow()
	if !pattern.MatchString(value) {
		t.Fatalf("UtcNow() = %q, want fixed-width 6-digit UTC", value)
	}
}

func TestUtcNowLexicographicOrder(t *testing.T) {
	// Successive calls must never run backwards lexicographically, so SQL string
	// comparisons stay equivalent to chronological order.
	previous := UtcNow()
	for i := 0; i < 100; i++ {
		current := UtcNow()
		if current < previous {
			t.Fatalf("timestamp went backwards: %q < %q", current, previous)
		}
		previous = current
	}
}

func TestInitSchemaIdempotent(t *testing.T) {
	t.Setenv("CAPSA_DB_PATH", filepath.Join(t.TempDir(), "capsa.db"))
	handle, err := Connect()
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer handle.Close()
	if err := InitSchema(handle); err != nil {
		t.Fatalf("first init: %v", err)
	}
	if err := InitSchema(handle); err != nil {
		t.Fatalf("second init should be idempotent: %v", err)
	}
}

func TestCheckDBHealth(t *testing.T) {
	t.Setenv("CAPSA_DB_PATH", filepath.Join(t.TempDir(), "capsa.db"))
	if CheckDBHealth() {
		t.Fatal("health check should fail before schema bootstrap")
	}
	handle, err := Connect()
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := InitSchema(handle); err != nil {
		t.Fatalf("init: %v", err)
	}
	handle.Close()
	if !CheckDBHealth() {
		t.Fatal("health check should pass after schema bootstrap")
	}
}

func TestParseTimestampNaiveIsUTC(t *testing.T) {
	withOffset, err := ParseTimestamp("2026-01-01T08:00:00+08:00")
	if err != nil {
		t.Fatalf("parse offset: %v", err)
	}
	naive, err := ParseTimestamp("2026-01-01T00:00:00")
	if err != nil {
		t.Fatalf("parse naive: %v", err)
	}
	if !withOffset.Equal(naive) {
		t.Fatalf("expected same instant, got %v vs %v", withOffset, naive)
	}
}
