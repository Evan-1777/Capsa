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

func sortedIDs(ids []string) []string {
	out := append([]string{}, ids...)
	sort.Strings(out)
	return out
}

func TestRankMultiTermAndWordBoundary(t *testing.T) {
	tagsOnly := SearchFields{Tags: true}
	tagMemories := []map[string]any{
		{"id": "mem_device", "tags": `["Windows 11","设备"]`},
		{"id": "mem_device_compact", "tags": `["Windows11"]`},
		{"id": "mem_nvidia_month", "tags": `["NVIDIA","2025-11"]`},
		{"id": "mem_nvidia_cuda", "tags": `["NVIDIA","CUDA11"]`},
		{"id": "mem_os", "tags": `["Windows","Linux"]`},
	}
	if got := sortedIDs(rankIDs(tagMemories, "Windows 11", tagsOnly)); !equalStrings(got, []string{"mem_device", "mem_device_compact"}) {
		t.Fatalf("tags Windows 11 = %v, want [mem_device mem_device_compact]", got)
	}

	bodyOnly := SearchFields{Body: true}
	loopMemories := []map[string]any{
		{"id": "mem_loop_target", "body": "使用 Loop Transformer 模型"},
		{"id": "mem_agent_loop", "body": "agent loop scheduler"},
		{"id": "mem_loopback", "body": "loopback interface"},
		{"id": "mem_transformer", "body": "html-transformer renderer"},
	}
	if got := rankIDs(loopMemories, "Loop Transformer", bodyOnly); !equalStrings(got, []string{"mem_loop_target"}) {
		t.Fatalf("body Loop Transformer = %v, want [mem_loop_target]", got)
	}

	gpqaMemories := []map[string]any{
		{"id": "mem_gpqa_hyphen", "body": "GPQA-Diamond 数据集"},
		{"id": "mem_gpqa_space", "body": "GPQA Diamond 数据集"},
		{"id": "mem_diamond", "body": "diamond benchmark"},
	}
	if got := sortedIDs(rankIDs(gpqaMemories, "GPQA-Diamond", bodyOnly)); !equalStrings(got, []string{"mem_gpqa_hyphen", "mem_gpqa_space"}) {
		t.Fatalf("body GPQA-Diamond = %v", got)
	}

	summaryOnly := SearchFields{Summary: true}
	serverMemories := []map[string]any{
		{"id": "mem_server", "summary": "个人VPS服务器"},
		{"id": "mem_service", "summary": "私人记忆与文档服务"},
		{"id": "mem_scattered", "summary": "服务...任务器"},
	}
	if got := rankIDs(serverMemories, "服务器", summaryOnly); !equalStrings(got, []string{"mem_server"}) {
		t.Fatalf("summary 服务器 = %v, want [mem_server]", got)
	}

	titleOnly := SearchFields{Title: true}
	boundaryCases := []struct {
		query string
		text  string
		want  bool
	}{
		{"GLM", "GLM", true},
		{"GLM", "GLM-4.5", true},
		{"GLM", "GLM4", true},
		{"GLM", "GLMX", false},
		{"Megaspeed", "Megaspeed", true},
		{"go", "Go 1.27", true},
		{"go", "Go语言", true},
		{"go", "google", false},
		{"go", "algorithm", false},
		{"ai", "AI助手", true},
		{"ai", "email", false},
		{"ai", "main", false},
		{"ai", "container", false},
	}
	for _, testCase := range boundaryCases {
		memories := []map[string]any{{"id": "mem_boundary", "title": testCase.text}}
		hit := len(rankIDs(memories, testCase.query, titleOnly)) == 1
		if hit != testCase.want {
			t.Fatalf("query %q against %q: hit=%v, want %v", testCase.query, testCase.text, hit, testCase.want)
		}
	}

	crossField := SearchFields{Title: true, Summary: true}
	crossMemories := []map[string]any{
		{"id": "mem_cross", "title": "架构要点", "summary": "设计说明"},
		{"id": "mem_partial", "title": "架构要点", "summary": "无关摘要"},
	}
	if got := rankIDs(crossMemories, "架构 设计", crossField); !equalStrings(got, []string{"mem_cross"}) {
		t.Fatalf("cross-field conjunction = %v, want [mem_cross]", got)
	}
}

func TestNormalizeNFKCAndSymbolOnlyQuery(t *testing.T) {
	bodyOnly := SearchFields{Body: true}
	wideQuery := []map[string]any{{"id": "mem_gpqa", "body": "GPQA-Diamond 数据集"}}
	if got := rankIDs(wideQuery, "ＧＰＱＡ－Ｄｉａｍｏｎｄ", bodyOnly); !equalStrings(got, []string{"mem_gpqa"}) {
		t.Fatalf("full-width query should match half-width text: %v", got)
	}
	wideStored := []map[string]any{{"id": "mem_wide", "body": "Ｗｉｎｄｏｗｓ　１１ 说明"}}
	if got := rankIDs(wideStored, "Windows 11", bodyOnly); !equalStrings(got, []string{"mem_wide"}) {
		t.Fatalf("half-width query should match full-width text: %v", got)
	}

	symbolMemories := []map[string]any{
		{"id": "mem_symbols", "body": "连接 --- 标记"},
		{"id": "mem_arrow", "body": "箭头 -> 右"},
		{"id": "mem_plain", "body": "连接标记"},
	}
	if got := rankIDs(symbolMemories, "---", bodyOnly); !equalStrings(got, []string{"mem_symbols"}) {
		t.Fatalf("symbol-only query --- = %v, want [mem_symbols]", got)
	}
	if got := rankIDs(symbolMemories, "->", bodyOnly); !equalStrings(got, []string{"mem_arrow"}) {
		t.Fatalf("symbol-only query -> = %v, want [mem_arrow]", got)
	}

	persistent := map[string]any{"id": "mem_p", "title": "其他标题", "pinned": int64(1)}
	if got := ScoreWithFields(persistent, Tokenize("架构"), titleOnlyFields()); got != 0 {
		t.Fatalf("persistent memory without a full hit must score 0, got %v", got)
	}
	if got := ScoreWithFields(persistent, nil, SearchFields{Title: true}); got != 0 {
		t.Fatalf("empty token set must score 0, got %v", got)
	}
}

func titleOnlyFields() SearchFields {
	return SearchFields{Title: true}
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
