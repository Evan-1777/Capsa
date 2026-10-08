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

func TestScoreMatchesPython(t *testing.T) {
	memory := map[string]any{
		"id": "mem_a", "title": "架构设计要点", "summary": "关于架构",
		"tags": `["设计","arch"]`, "body": "正文架构", "pinned": int64(1),
		"review_at": "2026-09-01T00:00:00.000000+00:00",
	}
	terms := Tokenize("架构")
	if got := Score(memory, terms, refNow, false); got != 6 {
		t.Fatalf("Score meta = %v, want 6", got)
	}
	if got := Score(memory, terms, refNow, true); got != 6.2 {
		t.Fatalf("Score body = %v, want 6.2", got)
	}
}

func rankIDs(memories []map[string]any, query string) []string {
	ranked := RankMemories(memories, query, refNow, false)
	out := make([]string, len(ranked))
	for i, memory := range ranked {
		out[i] = memory["id"].(string)
	}
	return out
}

func fixtureMemories() []map[string]any {
	return []map[string]any{
		{"id": "mem_1", "title": "无关", "summary": "", "tags": `[]`,
			"updated_at": "2026-10-02T00:00:00.000000+00:00", "pinned": int64(0)},
		{"id": "mem_2", "title": "架构设计", "summary": "", "tags": `[]`,
			"updated_at": "2026-10-01T00:00:00.000000+00:00", "pinned": int64(0)},
		{"id": "mem_3", "title": "架构", "summary": "", "tags": `[]`,
			"updated_at": "2026-10-03T00:00:00.000000+00:00", "pinned": int64(1)},
	}
}

func TestRankEmptyQueryBrowses(t *testing.T) {
	want := []string{"mem_3", "mem_1", "mem_2"}
	if got := rankIDs(fixtureMemories(), ""); !equalStrings(got, want) {
		t.Fatalf("browse order = %v, want %v", got, want)
	}
}

func TestRankKeywordFiltersAndOrders(t *testing.T) {
	want := []string{"mem_3", "mem_2"}
	if got := rankIDs(fixtureMemories(), "架构"); !equalStrings(got, want) {
		t.Fatalf("ranked order = %v, want %v", got, want)
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

func TestIsExpired(t *testing.T) {
	past := "2026-09-01T00:00:00.000000+00:00"
	future := "2026-11-01T00:00:00.000000+00:00"
	if !IsExpired(&past, refNow) {
		t.Fatal("past review_at must be expired")
	}
	if IsExpired(&future, refNow) {
		t.Fatal("future review_at must not be expired")
	}
	if IsExpired(nil, refNow) {
		t.Fatal("nil review_at must not be expired")
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
