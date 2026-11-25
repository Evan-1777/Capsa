package formatters

import (
	"strings"
	"testing"
	"time"
)

var testNow = time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)

func TestFormatGroups(t *testing.T) {
	groups := []map[string]any{
		{"slug": "proj", "name": "项目", "permission": "rw", "count": int64(3), "description": "d1"},
		{"slug": "study", "name": "学习", "permission": "r", "count": int64(0), "description": "d2"},
	}
	want := "# 可访问组别\n- proj | 项目 | rw | 3 条 | d1\n- study | 学习 | r | 0 条 | d2"
	if got := FormatGroups(groups); got != want {
		t.Fatalf("FormatGroups mismatch:\n got %q\nwant %q", got, want)
	}
}

func TestFormatCatalogDepths(t *testing.T) {
	items := []map[string]any{
		{"id": "mem_p", "group_slug": "proj", "pinned": int64(1),
			"updated_at": "2026-10-01T00:00:00.000000+00:00", "tags": `["core"]`, "title": "持久记忆", "summary": "持久摘要"},
		{"id": "mem_t", "group_slug": "proj", "expires_at": "2026-10-20T00:00:00.000000+00:00",
			"updated_at": "2026-10-02T00:00:00.000000+00:00", "tags": `[]`, "title": "临时记忆", "summary": "临时摘要"},
	}
	scopes := map[string]string{"proj": "rw"}

	shallow := FormatCatalog("shallow", items, 5, 0, scopes, testNow)
	if !strings.Contains(shallow, "浅层(浅层标题+摘要)") || !strings.Contains(shallow, "摘要: 持久摘要") ||
		!strings.Contains(shallow, "[持久]") || !strings.Contains(shallow, "[临时 到期 2026-10-20]") ||
		!strings.Contains(shallow, `> 更多: memory_catalog(depth="shallow", offset=2)`) {
		t.Fatalf("shallow catalog unexpected:\n%s", shallow)
	}
	if strings.Contains(shallow, "memory_peek") {
		t.Fatalf("catalog must not mention memory_peek:\n%s", shallow)
	}

	lighter := FormatCatalog("lighter", items, 2, 0, scopes, testNow)
	if !strings.Contains(lighter, "较浅(浅层标题)") || strings.Contains(lighter, "摘要:") || strings.Contains(lighter, "> 更多:") {
		t.Fatalf("lighter catalog unexpected:\n%s", lighter)
	}
}

func TestFormatSearchFieldsAndTrash(t *testing.T) {
	ranked := []map[string]any{
		{"status": "forbidden", "id": "mem_abc123"},
		{"status": "authorized", "id": "mem_1", "group_slug": "proj",
			"updated_at": "2026-10-01T00:00:00.000000+00:00", "tags": `["α","β"]`, "title": "标题一", "summary": "摘要一"},
		{"status": "authorized", "id": "mem_2", "group_slug": "proj",
			"updated_at": "2026-09-01T03:04:05.000000+00:00", "tags": `[]`, "title": "回收条目", "summary": "回收摘要",
			"deleted_at": "2026-10-05T00:00:00.000000+00:00", "deleted_reason": "临时记忆到期自动归档"},
	}
	got := FormatSearch("关键词", ranked, map[string]string{"proj": "rw", "study": "r"}, []string{"shallow", "trash"}, []string{"title", "summary", "tags"}, true, true, testNow)
	want := "# 记忆检索: \"关键词\" | 命中 3 条 | 层级: shallow,trash | 区域: title,summary,tags | 范围: proj,study\n" +
		"[1] mem_abc123 | [无权访问]\n" +
		"[2] mem_1 | proj | [浅层] | 2026-10-01 | 标签: α,β\n    标题一\n    摘要: 摘要一\n" +
		"[3] mem_2 | proj | [已归档/垃圾桶 归档于 2026-10-05 | 原因: 临时记忆到期自动归档] | 2026-09-01 | 标签: -\n    回收条目\n    摘要: 回收摘要\n" +
		"> 正文读取: memory_read(ids=[\"mem_1\", \"mem_2\"])"
	if got != want {
		t.Fatalf("FormatSearch mismatch:\n got %q\nwant %q", got, want)
	}

	summaryOnly := FormatSearch("关键词", ranked[1:2], map[string]string{"proj": "rw"}, []string{"shallow"}, []string{"summary"}, false, true, testNow)
	if strings.Contains(summaryOnly, "标题一") || !strings.Contains(summaryOnly, "摘要: 摘要一") {
		t.Fatalf("summary-only search unexpected:\n%s", summaryOnly)
	}
}

func TestFormatReadTruncationAndTrash(t *testing.T) {
	body := strings.Repeat("中", 3999) + "end"
	item := map[string]any{"status": "authorized", "id": "mem_1", "group_slug": "proj",
		"updated_at": "2026-10-01T00:00:00.000000+00:00", "title": "标题一", "body": body}
	want := "===== mem_1 | proj | [浅层] | 更新 2026-10-01 ===== [截断: 本条剩余 2 字符未返回]\n" +
		"# 标题一\n\n" + strings.Repeat("中", 3999) + "e\n\n" +
		"> 续读: memory_read(ids=[\"mem_1\"], offset=4000)"
	got := FormatRead([]map[string]any{item}, 0, testNow)
	if got != want {
		t.Fatalf("FormatRead(0) mismatch:\n got %q\nwant %q", got, want)
	}

	trash := map[string]any{"status": "authorized", "id": "mem_trash", "group_slug": "proj",
		"updated_at": "2026-10-01T00:00:00.000000+00:00", "deleted_at": "2026-10-06T00:00:00.000000+00:00",
		"deleted_reason": "手动删除", "title": "旧条", "body": "正文"}
	gotTrash := FormatRead([]map[string]any{
		{"status": "forbidden", "id": "mem_z"},
		{"status": "not_found", "id": "mem_y"},
		trash,
	}, 0, testNow)
	if !strings.Contains(gotTrash, "[1] mem_z | [无权访问]") ||
		!strings.Contains(gotTrash, "[2] mem_y | [不存在]") ||
		!strings.Contains(gotTrash, "[已归档/垃圾桶 归档于 2026-10-06 | 原因: 手动删除]") {
		t.Fatalf("FormatRead trash/three-state unexpected:\n%s", gotTrash)
	}
}

func TestFormatReadOffsetPastEnd(t *testing.T) {
	item := map[string]any{"status": "authorized", "id": "mem_1", "group_slug": "proj",
		"updated_at": "2026-10-01T00:00:00.000000+00:00", "title": "标题一", "body": "短正文"}
	want := "===== mem_1 | proj | [浅层] | 更新 2026-10-01 =====\n# 标题一\n\n（正文已到结尾，无更多内容）\n"
	if got := FormatRead([]map[string]any{item}, 999, testNow); got != want {
		t.Fatalf("FormatRead(999) mismatch:\n got %q\nwant %q", got, want)
	}
}
