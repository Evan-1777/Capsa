package retrieval

import (
	"sort"
	"testing"
	"time"
)

var refNow = time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)

func sortedTokens(query string) []string {
	terms := Tokenize(query)
	out := make([]string, 0, len(terms))
	for term := range terms {
		out = append(out, term)
	}
	sort.Strings(out)
	return out
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestTokenizeMatchesPython(t *testing.T) {
	cases := []struct {
		query string
		want  []string
	}{
		{"架构设计", []string{"构设", "架构", "设计"}},
		{"Hello 世界 A1", []string{"a1", "hello", "世界"}},
		{"中 x", []string{"x", "中"}},
	}
	for _, testCase := range cases {
		if got := sortedTokens(testCase.query); !equalStrings(got, testCase.want) {
			t.Fatalf("Tokenize(%q) = %v, want %v", testCase.query, got, testCase.want)
		}
	}
}

func TestScoreWithFields(t *testing.T) {
	memory := map[string]any{
		"id": "mem_a", "title": "架构设计要点", "summary": "关于架构",
		"tags": `["设计","arch"]`, "body": "正文架构", "pinned": int64(1),
	}
	terms := Tokenize("架构")
	if got := ScoreWithFields(memory, terms, DefaultSearchFields); got != 8 {
		t.Fatalf("Score meta (title 4 + summary 1 + persistent 3) = %v, want 8", got)
	}
	allFields := SearchFields{Title: true, Summary: true, Tags: true, Body: true}
	if got := ScoreWithFields(memory, terms, allFields); got != 8.2 {
		t.Fatalf("Score body = %v, want 8.2", got)
	}
}

func rankIDs(memories []map[string]any, query string, fields SearchFields) []string {
	ranked := RankMemoriesWithFields(memories, query, fields)
	out := make([]string, len(ranked))
	for i, memory := range ranked {
		out[i] = memory["id"].(string)
	}
	return out
}

func fixtureMemories() []map[string]any {
	return []map[string]any{
		{"id": "mem_1", "title": "无关", "summary": "摘要含架构", "tags": `["架构标签"]`, "body": "正文密钥",
			"updated_at": "2026-10-02T00:00:00.000000+00:00", "pinned": int64(0)},
		{"id": "mem_2", "title": "架构设计", "summary": "", "tags": `[]`, "body": "",
			"updated_at": "2026-10-01T00:00:00.000000+00:00", "pinned": int64(0),
			"expires_at": "2026-12-01T00:00:00.000000+00:00"},
		{"id": "mem_3", "title": "架构", "summary": "", "tags": `[]`, "body": "",
			"updated_at": "2026-10-03T00:00:00.000000+00:00", "pinned": int64(1)},
	}
}

func TestRankEmptyQueryUnifiedOrder(t *testing.T) {
	// Persistent (mem_3) > Temporary (mem_2) > Regular (mem_1)
	want := []string{"mem_3", "mem_2", "mem_1"}
	if got := rankIDs(fixtureMemories(), "", DefaultSearchFields); !equalStrings(got, want) {
		t.Fatalf("browse order = %v, want %v", got, want)
	}
}

func TestRankSearchFieldsIsolation(t *testing.T) {
	// Title-only must exclude mem_1 (which only matches in summary/tags).
	wantTitle := []string{"mem_3", "mem_2"}
	if got := rankIDs(fixtureMemories(), "架构", SearchFields{Title: true}); !equalStrings(got, wantTitle) {
		t.Fatalf("title-only = %v, want %v", got, wantTitle)
	}
	// Body-only matches mem_1 on 正文密钥.
	wantBody := []string{"mem_1"}
	if got := rankIDs(fixtureMemories(), "密钥", SearchFields{Body: true}); !equalStrings(got, wantBody) {
		t.Fatalf("body-only = %v, want %v", got, wantBody)
	}
}

func TestComputeTierAndLayerOf(t *testing.T) {
	oldUpdated := "2026-06-01T00:00:00.000000+00:00" // ~4 months before refNow (2026-10-08)
	recentUpdated := "2026-09-01T00:00:00.000000+00:00"

	persistentOld := map[string]any{"pinned": int64(1), "updated_at": oldUpdated, "shallow_months": int64(1)}
	if got := ComputeTier(persistentOld, refNow); got != TierPersistent {
		t.Fatalf("persistent tier = %q", got)
	}
	if got := LayerOf(persistentOld, refNow); got != "shallow" {
		t.Fatalf("persistent layer = %q", got)
	}

	tempOld := map[string]any{"expires_at": "2026-12-01T00:00:00.000000+00:00", "updated_at": oldUpdated, "shallow_months": int64(1)}
	if got := ComputeTier(tempOld, refNow); got != TierTemporary {
		t.Fatalf("temporary tier = %q", got)
	}
	if got := LayerOf(tempOld, refNow); got != "shallow" {
		t.Fatalf("temporary layer = %q", got)
	}

	regular := map[string]any{"updated_at": oldUpdated, "shallow_months": int64(3)}
	if got := ComputeTier(regular, refNow); got != TierDeep {
		t.Fatalf("3-month cutoff for 4-month-old memory = %q, want deep", got)
	}
	regular["shallow_months"] = int64(6)
	if got := ComputeTier(regular, refNow); got != TierShallow {
		t.Fatalf("6-month cutoff for 4-month-old memory = %q, want shallow", got)
	}

	recent := map[string]any{"updated_at": recentUpdated, "shallow_months": int64(3)}
	if got := ComputeTier(recent, refNow); got != TierShallow {
		t.Fatalf("recent tier = %q, want shallow", got)
	}

	deleted := map[string]any{"updated_at": recentUpdated, "deleted_at": "2026-10-05T00:00:00.000000+00:00"}
	if got := LayerOf(deleted, refNow); got != "trash" {
		t.Fatalf("deleted layer = %q, want trash", got)
	}
}

func TestTitleSimilarityAndFind(t *testing.T) {
	if got := TitleSimilarity("架构设计要点", "架构设计"); round2(got) != 0.6 {
		t.Fatalf("similarity = %v, want 0.6", got)
	}
	candidates := []map[string]any{
		{"id": "mem_2", "title": "架构设计"},
		{"id": "mem_1", "title": "完全无关"},
	}
	found := FindSimilarMemories(candidates, "架构设计要点", SimilarityThreshold)
	if len(found) != 1 || found[0]["id"] != "mem_2" || found[0]["similarity"].(float64) != 0.6 {
		t.Fatalf("find_similar = %#v", found)
	}
}

func TestNormalizeTimestamp(t *testing.T) {
	got, err := NormalizeTimestamp("2026-09-01T08:00:00+08:00")
	if err != nil {
		t.Fatalf("NormalizeTimestamp: %v", err)
	}
	if got != "2026-09-01T00:00:00.000000+00:00" {
		t.Fatalf("NormalizeTimestamp = %q", got)
	}
}

func TestRound2HalfToEven(t *testing.T) {
	// Python's round() rounds half to even; 0.625 (a reachable 5/8 Jaccard) must
	// resolve to 0.62, not the 0.63 that math.Round would produce.
	cases := []struct {
		in   float64
		want float64
	}{
		{0.625, 0.62},
		{0.375, 0.38},
		{0.875, 0.88},
		{0.627, 0.63},
	}
	for _, testCase := range cases {
		if got := round2(testCase.in); got != testCase.want {
			t.Fatalf("round2(%v) = %v, want %v", testCase.in, got, testCase.want)
		}
	}
}
