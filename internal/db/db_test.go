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
