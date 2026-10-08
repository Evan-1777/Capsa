// Package formatters renders the fixed plain-text contracts for the read tools
// and the group listing. capsa/formatters.py is the single source of truth; the
// output here must match it byte for byte.
package formatters

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"capsa/internal/retrieval"
)

const (
	// MaxBodyChars bounds the body characters returned per entry.
	MaxBodyChars = 4000
	// MaxResponseChars bounds the total body characters returned per call.
	MaxResponseChars = 20000
)

func idsLiteral(ids []string) string {
	parts := make([]string, len(ids))
	for i, id := range ids {
		encoded, _ := json.Marshal(id)
		parts[i] = string(encoded)
	}
	return "[" + strings.Join(parts, ", ") + "]"
}

func date(value any) string {
	text, _ := value.(string)
	if len(text) > 10 {
		return text[:10]
	}
	return text
}

func tagsLiteral(raw any) string {
	tags := []string{}
	switch value := raw.(type) {
	case string:
		if value != "" {
			_ = json.Unmarshal([]byte(value), &tags)
		}
	case []string:
		tags = value
	case []any:
		for _, item := range value {
			if text, ok := item.(string); ok {
				tags = append(tags, text)
			}
		}
	}
	if len(tags) == 0 {
		return "-"
	}
	return strings.Join(tags, ",")
}

func statusOf(item map[string]any) string {
	text, _ := item["status"].(string)
	return text
}

func stringOf(item map[string]any, key string) string {
	text, _ := item[key].(string)
	return text
}

func reviewAtPtr(item map[string]any) *string {
	if text, ok := item["review_at"].(string); ok {
		return &text
	}
	return nil
}

// FormatGroups renders the accessible group listing.
func FormatGroups(groups []map[string]any) string {
	lines := []string{"# 可访问分组"}
	for _, group := range groups {
		lines = append(lines, fmt.Sprintf("- %s | %s | %s | %v 条 | %s",
			stringOf(group, "slug"), stringOf(group, "name"), stringOf(group, "permission"),
			group["count"], stringOf(group, "description")))
	}
	return strings.Join(lines, "\n")
}

// FormatSearch renders the search result listing.
func FormatSearch(query string, ranked []map[string]any, scopes map[string]string, now time.Time) string {
	scopeNames := make([]string, 0, len(scopes))
	for name := range scopes {
		scopeNames = append(scopeNames, name)
	}
	sort.Strings(scopeNames)
	lines := []string{fmt.Sprintf(`# 记忆检索: "%s" | 命中 %d 条 | 范围: %s`,
		query, len(ranked), strings.Join(scopeNames, ","))}
	ids := []string{}
	for index, item := range ranked {
		position := index + 1
		if statusOf(item) == "forbidden" {
			lines = append(lines, fmt.Sprintf("[%d] %s | [无权访问]", position, stringOf(item, "id")))
			continue
		}
		expired := ""
		if retrieval.IsExpired(reviewAtPtr(item), now) {
			expired = "（复核已过期）"
		}
		lines = append(lines, fmt.Sprintf("[%d] %s | %s | %s | 标签: %s",
			position, stringOf(item, "id"), stringOf(item, "group_slug"),
			date(item["updated_at"]), tagsLiteral(item["tags"])))
		lines = append(lines, fmt.Sprintf("    %s%s", stringOf(item, "title"), expired))
		ids = append(ids, stringOf(item, "id"))
	}
	if len(ids) > 0 {
		lines = append(lines, fmt.Sprintf("> 下一步: memory_peek(ids=%s)", idsLiteral(ids)))
	}
	return strings.Join(lines, "\n")
}

// FormatPeek renders the summary listing.
func FormatPeek(items []map[string]any) string {
	lines := []string{}
	ids := []string{}
	for index, item := range items {
		position := index + 1
		switch statusOf(item) {
		case "forbidden":
			lines = append(lines, fmt.Sprintf("[%d] %s | [无权访问]", position, stringOf(item, "id")))
			continue
		case "not_found":
			lines = append(lines, fmt.Sprintf("[%d] %s | [不存在]", position, stringOf(item, "id")))
			continue
		}
		lines = append(lines, fmt.Sprintf("[%d] %s | %s | 更新 %s",
			position, stringOf(item, "id"), stringOf(item, "group_slug"), date(item["updated_at"])))
		lines = append(lines, fmt.Sprintf("    标题: %s", stringOf(item, "title")))
		lines = append(lines, fmt.Sprintf("    摘要: %s", stringOf(item, "summary")))
		ids = append(ids, stringOf(item, "id"))
	}
	if len(ids) > 0 {
		lines = append(lines, fmt.Sprintf("> 下一步: memory_read(ids=%s)", idsLiteral(ids)))
	}
	return strings.Join(lines, "\n")
}

// FormatRead renders full bodies with per-entry and per-call truncation. Offsets
// and lengths are counted in characters (runes), matching the Python contract.
func FormatRead(items []map[string]any, offset int) string {
	if offset < 0 {
		offset = 0
	}
	lines := []string{}
	consumed := 0
	truncated := []string{}
	for index, item := range items {
		position := index + 1
		switch statusOf(item) {
		case "forbidden":
			lines = append(lines, fmt.Sprintf("[%d] %s | [无权访问]", position, stringOf(item, "id")))
			continue
		case "not_found":
			lines = append(lines, fmt.Sprintf("[%d] %s | [不存在]", position, stringOf(item, "id")))
			continue
		}
		if consumed >= MaxResponseChars {
			break
		}
		body := []rune(stringOf(item, "body"))
		start := offset
		if start > len(body) {
			start = len(body)
		}
		available := len(body) - start
		take := min(MaxBodyChars, available, MaxResponseChars-consumed)
		consumed += take
		header := fmt.Sprintf("===== %s | %s | 更新 %s =====",
			stringOf(item, "id"), stringOf(item, "group_slug"), date(item["updated_at"]))
		if available > take {
			header += fmt.Sprintf(" [截断: 本条剩余 %d 字符未返回]", available-take)
			truncated = append(truncated, stringOf(item, "id"))
		}
		lines = append(lines, header)
		lines = append(lines, fmt.Sprintf("# %s", stringOf(item, "title")))
		lines = append(lines, "")
		section := string(body[start : start+take])
		if section == "" {
			section = "（正文已到结尾，无更多内容）"
		}
		lines = append(lines, section)
		lines = append(lines, "")
	}
	if len(truncated) > 0 {
		lines = append(lines, fmt.Sprintf("> 续读: memory_read(ids=%s, offset=%d)",
			idsLiteral(truncated), offset+MaxBodyChars))
	}
	return strings.Join(lines, "\n")
}
