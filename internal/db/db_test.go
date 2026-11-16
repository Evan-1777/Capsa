package db

import (
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
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

func TestTimestampLexicographicMatchesChronological(t *testing.T) {
	// Interleave the fixed-width layout with legacy Python isoformat() rows
	// (microseconds omitted when zero) to prove string ordering equals time
	// ordering across both storage generations.
	values := []string{
		"2025-12-31T23:59:59.999999+00:00",
		"2026-01-01T00:00:00+00:00",
		"2026-01-01T00:00:00.000001+00:00",
		"2026-01-01T00:00:00.500000+00:00",
		"2026-01-01T00:00:01+00:00",
		"2026-01-02T00:00:00+00:00",
	}
	byString := append([]string(nil), values...)
	sort.Strings(byString)
	byTime := append([]string(nil), values...)
	sort.Slice(byTime, func(i, j int) bool {
		left, err := ParseTimestamp(byTime[i])
		if err != nil {
			t.Fatalf("parse %q: %v", byTime[i], err)
		}
		right, err := ParseTimestamp(byTime[j])
		if err != nil {
			t.Fatalf("parse %q: %v", byTime[j], err)
		}
		return left.Before(right)
	})
	if !reflect.DeepEqual(byString, byTime) {
		t.Fatalf("lexicographic order != chronological order:\n string %v\n time   %v", byString, byTime)
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

func TestSharedHandleRotationAndPartialIndexes(t *testing.T) {
	t.Cleanup(func() { _ = CloseShared() })

	firstPath := filepath.Join(t.TempDir(), "first.db")
	t.Setenv("CAPSA_DB_PATH", firstPath)

	h1, err := Shared()
	if err != nil {
		t.Fatalf("first Shared(): %v", err)
	}
	h2, err := Shared()
	if err != nil {
		t.Fatalf("second Shared(): %v", err)
	}
	if h1 != h2 {
		t.Fatal("Shared() must return the cached handle when DBPath is unchanged")
	}

	if err := InitSchema(h1); err != nil {
		t.Fatalf("init schema: %v", err)
	}
	// Verify all three partial indexes exist in sqlite_master.
	for _, indexName := range []string{
		"idx_memories_active_global",
		"idx_memories_overdue",
		"idx_memories_deleted",
	} {
		var found string
		err := h1.QueryRow("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?", indexName).Scan(&found)
		if err != nil || found != indexName {
			t.Fatalf("missing partial index %s: %v", indexName, err)
		}
	}

	// Verify tuned PRAGMAs on shared connection.
	var tempStore, cacheSize int
	if err := h1.QueryRow("PRAGMA temp_store").Scan(&tempStore); err != nil || tempStore != 2 {
		t.Fatalf("PRAGMA temp_store = %d (%v), want 2 (MEMORY)", tempStore, err)
	}
	if err := h1.QueryRow("PRAGMA cache_size").Scan(&cacheSize); err != nil || cacheSize != -2000 {
		t.Fatalf("PRAGMA cache_size = %d (%v), want -2000", cacheSize, err)
	}

	// Switching CAPSA_DB_PATH rotates the shared handle and closes the old one.
	secondPath := filepath.Join(t.TempDir(), "second.db")
	t.Setenv("CAPSA_DB_PATH", secondPath)
	h3, err := Shared()
	if err != nil {
		t.Fatalf("rotated Shared(): %v", err)
	}
	if h3 == h1 {
		t.Fatal("Shared() must replace handle when DBPath changes")
	}
	if err := h1.Ping(); err == nil {
		t.Fatal("previous shared handle must be closed after path rotation")
	}
	if err := CloseShared(); err != nil {
		t.Fatalf("CloseShared(): %v", err)
	}
	if err := h3.Ping(); err == nil {
		t.Fatal("CloseShared() must close active shared handle")
	}
}
