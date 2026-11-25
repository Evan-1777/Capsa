// Package formatters renders the fixed plain-text contracts for the memory
// MCP read tools and group listing.
package formatters

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

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
	tags := retrieval.DecodeTags(raw)
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

func sortedScopes(scopes map[string]string) string {
	names := make([]string, 0, len(scopes))
	for name := range scopes {
		names = append(names, name)
	}
	sort.Strings(names)
	return strings.Join(names, ",")
}

func tierTag(item map[string]any, now time.Time) string {
	if deletedAt := stringOf(item, "deleted_at"); deletedAt != "" {
		reason := strings.TrimSpace(stringOf(item, "deleted_reason"))
		if reason == "" {
			reason = "-"
		}
		return fmt.Sprintf("[已归档/垃圾桶 归档于 %s | 原因: %s]", date(deletedAt), reason)
	}
	switch retrieval.ComputeTier(item, now) {
	case retrieval.TierPersistent:
		return "[持久]"
	case retrieval.TierTemporary:
		return fmt.Sprintf("[临时 到期 %s]", date(item["expires_at"]))
	case retrieval.TierDeep:
		return "[深层]"
	default:
		return "[浅层]"
	}
}

func depthLabel(depth string) string {
	switch depth {
	case "lighter":
		return "较浅(浅层标题)"
	case "shallow":
		return "浅层(浅层标题+摘要)"
	case "deeper":
		return "更深(深层标题)"
	case "full":
		return "完全(浅层+深层标题)"
	default:
		return depth
	}
}

// FormatGroups renders the accessible group listing.
func FormatGroups(groups []map[string]any) string {
	lines := []string{"# 可访问组别"}
	for _, group := range groups {
		lines = append(lines, fmt.Sprintf("- %s | %s | %s | %v 条 | %s",
			stringOf(group, "slug"), stringOf(group, "name"), stringOf(group, "permission"),
			group["count"], stringOf(group, "description")))
	}
	return strings.Join(lines, "\n")
}

// FormatCatalog renders the four-depth active memory catalog listing.
func FormatCatalog(depth string, items []map[string]any, total, offset int, scopes map[string]string, now time.Time) string {
	header := fmt.Sprintf("# 记忆目录: %s | 共 %d 条 | 范围: %s",
		depthLabel(depth), total, sortedScopes(scopes))
	if len(items) > 0 {
		header = fmt.Sprintf("# 记忆目录: %s | 共 %d 条 (展示 %d-%d) | 范围: %s",
			depthLabel(depth), total, offset+1, offset+len(items), sortedScopes(scopes))
	}
	lines := []string{header}
	for index, item := range items {
		position := offset + index + 1
		lines = append(lines, fmt.Sprintf("[%d] %s | %s | %s | %s | 标签: %s",
			position, stringOf(item, "id"), stringOf(item, "group_slug"),
			tierTag(item, now), date(item["updated_at"]), tagsLiteral(item["tags"])))
		lines = append(lines, fmt.Sprintf("    %s", stringOf(item, "title")))
		if depth == "shallow" {
			lines = append(lines, fmt.Sprintf("    摘要: %s", stringOf(item, "summary")))
		}
	}
	if offset+len(items) < total {
		lines = append(lines, fmt.Sprintf("> 更多: memory_catalog(depth=%q, offset=%d)", depth, offset+len(items)))
	}
	return strings.Join(lines, "\n")
}

// FormatSearch renders the multi-layer search result listing.
func FormatSearch(query string, ranked []map[string]any, scopes map[string]string, layers, searchIn []string, returnTitle, returnSummary bool, now time.Time) string {
	lines := []string{fmt.Sprintf(`# 记忆检索: "%s" | 命中 %d 条 | 层级: %s | 区域: %s | 范围: %s`,
		query, len(ranked), strings.Join(layers, ","), strings.Join(searchIn, ","), sortedScopes(scopes))}
	ids := []string{}
	for index, item := range ranked {
		position := index + 1
		if statusOf(item) == "forbidden" {
			lines = append(lines, fmt.Sprintf("[%d] %s | [无权访问]", position, stringOf(item, "id")))
			continue
		}
		lines = append(lines, fmt.Sprintf("[%d] %s | %s | %s | %s | 标签: %s",
			position, stringOf(item, "id"), stringOf(item, "group_slug"),
			tierTag(item, now), date(item["updated_at"]), tagsLiteral(item["tags"])))
		if returnTitle {
			lines = append(lines, fmt.Sprintf("    %s", stringOf(item, "title")))
		}
		if returnSummary {
			lines = append(lines, fmt.Sprintf("    摘要: %s", stringOf(item, "summary")))
		}
		ids = append(ids, stringOf(item, "id"))
	}
	if len(ids) > 0 {
		lines = append(lines, fmt.Sprintf("> 正文读取: memory_read(ids=%s)", idsLiteral(ids)))
	}
	return strings.Join(lines, "\n")
}

func sliceRunes(s string, offset, limit int) (string, int) {
	startByte := len(s)
	endByte := len(s)
	runeIdx := 0
	for i := 0; i < len(s); {
		if runeIdx == offset {
			startByte = i
		}
		if limit >= 0 && runeIdx == offset+limit {
			endByte = i
		}
		_, size := utf8.DecodeRuneInString(s[i:])
		i += size
		runeIdx++
	}
	if runeIdx <= offset {
		return "", runeIdx
	}
	if endByte < startByte {
		endByte = len(s)
	}
	return s[startByte:endByte], runeIdx
}

// FormatRead renders full bodies with per-entry and per-call truncation,
// including archive annotations for recycle-bin entries.
func FormatRead(items []map[string]any, offset int, now time.Time) string {
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
		maxTake := min(MaxBodyChars, MaxResponseChars-consumed)
		section, totalRunes := sliceRunes(stringOf(item, "body"), offset, maxTake)
		start := min(offset, totalRunes)
		available := totalRunes - start
		take := min(maxTake, available)
		consumed += take
		header := fmt.Sprintf("===== %s | %s | %s | 更新 %s =====",
			stringOf(item, "id"), stringOf(item, "group_slug"), tierTag(item, now), date(item["updated_at"]))
		if available > take {
			header += fmt.Sprintf(" [截断: 本条剩余 %d 字符未返回]", available-take)
			truncated = append(truncated, stringOf(item, "id"))
		}
		lines = append(lines, header)
		lines = append(lines, fmt.Sprintf("# %s", stringOf(item, "title")))
		lines = append(lines, "")
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
