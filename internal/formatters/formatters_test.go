package formatters

import (
	"strings"
	"testing"
	"time"
)

var testNow = time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)

func TestFormatGroupsMatchesPython(t *testing.T) {
	groups := []map[string]any{
		{"slug": "proj", "name": "项目", "permission": "rw", "count": int64(3), "description": "d1"},
		{"slug": "study", "name": "学习", "permission": "r", "count": int64(0), "description": "d2"},
	}
	want := "# 可访问分组\n- proj | 项目 | rw | 3 条 | d1\n- study | 学习 | r | 0 条 | d2"
	if got := FormatGroups(groups); got != want {
		t.Fatalf("FormatGroups mismatch:\n got %q\nwant %q", got, want)
	}
}

func TestFormatSearchMatchesPython(t *testing.T) {
	ranked := []map[string]any{
		{"status": "forbidden", "id": "mem_abc123"},
		{"status": "authorized", "id": "mem_1", "group_slug": "proj",
			"updated_at": "2026-10-01T00:00:00.000000+00:00", "tags": `["α","β"]`, "title": "标题一"},
		{"status": "authorized", "id": "mem_2", "group_slug": "proj",
			"updated_at": "2026-09-01T03:04:05.000000+00:00", "tags": `[]`, "title": "过期标题",
			"review_at": "2026-09-15T00:00:00.000000+00:00"},
	}
	want := "# 记忆检索: \"关键词\" | 命中 3 条 | 范围: proj,study\n" +
		"[1] mem_abc123 | [无权访问]\n" +
		"[2] mem_1 | proj | 2026-10-01 | 标签: α,β\n    标题一\n" +
		"[3] mem_2 | proj | 2026-09-01 | 标签: -\n    过期标题（复核已过期）\n" +
		"> 下一步: memory_peek(ids=[\"mem_1\", \"mem_2\"])"
	got := FormatSearch("关键词", ranked, map[string]string{"proj": "rw", "study": "r"}, testNow)
	if got != want {
		t.Fatalf("FormatSearch mismatch:\n got %q\nwant %q", got, want)
	}
}

func TestFormatPeekMatchesPython(t *testing.T) {
	items := []map[string]any{
		{"status": "forbidden", "id": "mem_z"},
		{"status": "not_found", "id": "mem_y"},
		{"status": "authorized", "id": "mem_1", "group_slug": "proj",
			"updated_at": "2026-10-01T00:00:00.000000+00:00", "title": "标题一", "summary": "摘要一"},
	}
	want := "[1] mem_z | [无权访问]\n" +
		"[2] mem_y | [不存在]\n" +
		"[3] mem_1 | proj | 更新 2026-10-01\n    标题: 标题一\n    摘要: 摘要一\n" +
		"> 下一步: memory_read(ids=[\"mem_1\"])"
	if got := FormatPeek(items); got != want {
		t.Fatalf("FormatPeek mismatch:\n got %q\nwant %q", got, want)
	}
}

func TestFormatReadTruncation(t *testing.T) {
	body := strings.Repeat("中", 3999) + "end"
	item := map[string]any{"status": "authorized", "id": "mem_1", "group_slug": "proj",
		"updated_at": "2026-10-01T00:00:00.000000+00:00", "title": "标题一", "body": body}
	want := "===== mem_1 | proj | 更新 2026-10-01 ===== [截断: 本条剩余 2 字符未返回]\n" +
		"# 标题一\n\n" + strings.Repeat("中", 3999) + "e\n\n" +
		"> 续读: memory_read(ids=[\"mem_1\"], offset=4000)"
	got := FormatRead([]map[string]any{item}, 0)
	if got != want {
		t.Fatalf("FormatRead(0) mismatch:\n got %q\nwant %q", got, want)
	}
}

func TestFormatReadOffsetTail(t *testing.T) {
	body := strings.Repeat("中", 3999) + "end"
	item := map[string]any{"status": "authorized", "id": "mem_1", "group_slug": "proj",
		"updated_at": "2026-10-01T00:00:00.000000+00:00", "title": "标题一", "body": body}
	want := "===== mem_1 | proj | 更新 2026-10-01 =====\n# 标题一\n\nnd\n"
	if got := FormatRead([]map[string]any{item}, 4000); got != want {
		t.Fatalf("FormatRead(4000) mismatch:\n got %q\nwant %q", got, want)
	}
}

func TestFormatReadEndOfBody(t *testing.T) {
	item := map[string]any{"status": "authorized", "id": "mem_1", "group_slug": "proj",
		"updated_at": "2026-10-01T00:00:00.000000+00:00", "title": "标题一", "body": "短正文"}
	want := "===== mem_1 | proj | 更新 2026-10-01 =====\n# 标题一\n\n短正文\n"
	if got := FormatRead([]map[string]any{item}, 0); got != want {
		t.Fatalf("FormatRead short mismatch:\n got %q\nwant %q", got, want)
	}
}

func TestFormatReadMissingBodyPlaceholder(t *testing.T) {
	item := map[string]any{"status": "authorized", "id": "mem_1", "group_slug": "proj",
		"updated_at": "2026-10-01T00:00:00.000000+00:00", "title": "标题一", "body": ""}
	want := "===== mem_1 | proj | 更新 2026-10-01 =====\n# 标题一\n\n（正文已到结尾，无更多内容）\n"
	if got := FormatRead([]map[string]any{item}, 0); got != want {
		t.Fatalf("FormatRead empty mismatch:\n got %q\nwant %q", got, want)
	}
}
