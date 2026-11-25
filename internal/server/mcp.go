// Package server assembles the HTTP surface: the MCP streamable endpoint, the
// Web REST API and the embedded SPA. Transport layers hold no SQL.
package server

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	mcpserver "github.com/mark3labs/mcp-go/server"

	"capsa/internal/auth"
	"capsa/internal/dal"
	"capsa/internal/db"
	"capsa/internal/formatters"
	"capsa/internal/permissions"
	"capsa/internal/retrieval"

	"github.com/mark3labs/mcp-go/mcp"
)

func nowUTC() time.Time { return time.Now().UTC() }

// Tool limits and field length caps, shared with the Web layer.
const (
	CatalogLimit = 200
	SearchLimit  = 20
	ReadLimit    = 5

	// TitleMax, SummaryMax and BodyMax mirror the storage CHECK constraints.
	TitleMax   = 60
	SummaryMax = 200
	BodyMax    = 64000
)

type tokenContextKeyType struct{}

var tokenContextKey = tokenContextKeyType{}

func withAccessToken(ctx context.Context, token *auth.AccessToken) context.Context {
	return context.WithValue(ctx, tokenContextKey, token)
}

// GrantsFrom returns the grant map of the verified caller, or an empty map.
func GrantsFrom(ctx context.Context) map[string]string {
	token, _ := ctx.Value(tokenContextKey).(*auth.AccessToken)
	if token == nil || token.Grants == nil {
		return map[string]string{}
	}
	return token.Grants
}

// AccessTokenFrom returns the verified caller identity, or nil.
func AccessTokenFrom(ctx context.Context) *auth.AccessToken {
	token, _ := ctx.Value(tokenContextKey).(*auth.AccessToken)
	return token
}

// withMemoryDB opens the shared handle and lazily archives any expired
// temporary memories before running fn. All memory MCP tools and memory Web
// REST endpoints share this entry point so expiration is never missed.
func withMemoryDB(fn func(handle *sql.DB) error) error {
	handle, err := db.Shared()
	if err != nil {
		return err
	}
	if _, err := dal.ArchiveExpiredMemories(handle, db.UtcNow()); err != nil {
		return err
	}
	return fn(handle)
}

// parseFutureExpiresAt validates an ISO 8601 timestamp and requires it to be
// strictly later than now. Shared between MCP and Web layers.
func parseFutureExpiresAt(raw string, now time.Time) (string, string) {
	normalized, err := retrieval.NormalizeTimestamp(raw)
	if err != nil {
		return "", fmt.Sprintf("expires_at 不是合法的 ISO 8601 时间：%s", raw)
	}
	moment, err := db.ParseTimestamp(normalized)
	if err != nil || !moment.After(now) {
		return "", "expires_at 必须晚于当前时间"
	}
	return normalized, ""
}

// validateMemoryLifecycleUpdate resolves persistent / expires_at /
// clear_expires_at mutations against an existing memory row, enforcing the
// mutual exclusivity invariant consistently across MCP and Web layers.
func validateMemoryLifecycleUpdate(existing map[string]any, hasPersistent, persistent, hasExpires bool, expiresVal string, clearExpires bool, now time.Time) (map[string]any, string) {
	if clearExpires && hasExpires {
		return nil, "clear_expires_at 与 expires_at 不能同时给出"
	}
	if hasPersistent && persistent && hasExpires {
		return nil, "持久记忆与临时记忆（expires_at）互斥，不能同时设置"
	}
	fields := map[string]any{}
	currentlyPersistent := retrieval.IsPersistent(existing)
	if hasExpires {
		if currentlyPersistent && !(hasPersistent && !persistent) {
			return nil, "当前为持久记忆，设置 expires_at 前需同时取消持久标记（persistent=false）"
		}
		normalized, msg := parseFutureExpiresAt(expiresVal, now)
		if msg != "" {
			return nil, msg
		}
		fields["expires_at"] = normalized
		if hasPersistent {
			fields["pinned"] = boolToInt(persistent)
		}
		return fields, ""
	}
	if hasPersistent {
		fields["pinned"] = boolToInt(persistent)
		if persistent {
			fields["expires_at"] = nil
		} else if clearExpires {
			fields["expires_at"] = nil
		}
		return fields, ""
	}
	if clearExpires {
		fields["expires_at"] = nil
	}
	return fields, ""
}

// writableScopesFrom returns whether the caller has wildcard write permission
// or the sorted list of explicit group slugs with "rw" permission.
func writableScopesFrom(grants map[string]string) (bool, []string) {
	if grants["*"] == "rw" {
		return true, nil
	}
	slugs := []string{}
	for slug, perm := range grants {
		if slug != "*" && perm == "rw" {
			slugs = append(slugs, slug)
		}
	}
	sort.Strings(slugs)
	return false, slugs
}

// NewMCPServer builds the MCP server with the 11 memory tools.
func NewMCPServer() *mcpserver.MCPServer {
	instance := mcpserver.NewMCPServer("capsa", "2.0.0")

	instance.AddTool(mcp.NewTool("memory_groups",
		mcp.WithDescription("列出当前凭据可访问的组别（隔离记忆区）、各组别活跃记忆数与读写权限。"),
		mcp.WithReadOnlyHintAnnotation(true),
	), handleGroups)

	instance.AddTool(mcp.NewTool("memory_catalog",
		mcp.WithDescription(fmt.Sprintf("按四档深度浏览活跃记忆目录（按持久→临时→最近更新时间排序）。默认 shallow 档返回浅层记忆的标题与摘要，适合快速了解用户背景与偏好；lighter 仅返回浅层标题，deeper 返回深层标题，full 返回全部浅层与深层标题。单次最多返回 %d 条。", CatalogLimit)),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithString("depth", mcp.Description("目录深度：lighter / shallow（默认）/ deeper / full"), mcp.DefaultString("shallow")),
		mcp.WithString("group", mcp.Description("只浏览该组别（隔离记忆区）；省略时浏览凭据可访问的全部组别")),
		mcp.WithInteger("limit", mcp.Description(fmt.Sprintf("返回条数上限，取值 1~%d", CatalogLimit)), mcp.DefaultNumber(50)),
		mcp.WithInteger("offset", mcp.Description("分页起始偏移，默认 0"), mcp.DefaultNumber(0)),
	), handleCatalog)

	instance.AddTool(mcp.NewTool("memory_search",
		mcp.WithDescription(fmt.Sprintf("按关键词、层级（shallow/deep/trash）、搜索区域（title/summary/tags/body）与返回字段检索记忆。默认在 shallow 层的标题、摘要与标签中检索并返回标题；仅当 search_in 含 body 且 query 非空时加载正文参与打分。多词关键词按全部词项在指定搜索区域内命中判定。单次最多返回 %d 条。", SearchLimit)),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithString("query", mcp.Description("关键词；省略时按持久→临时→最近更新时间浏览")),
		mcp.WithString("group", mcp.Description("只检索该组别（隔离记忆区）；省略时检索凭据可访问的全部组别")),
		mcp.WithInteger("limit", mcp.Description(fmt.Sprintf("返回条数上限，取值 1~%d", SearchLimit)), mcp.DefaultNumber(10)),
		mcp.WithArray("layers", mcp.Description("检索层级数组，默认 [\"shallow\"]，允许值：shallow / deep / trash"), mcp.WithStringEnumItems([]string{"shallow", "deep", "trash"})),
		mcp.WithArray("search_in", mcp.Description("搜索区域数组，默认 [\"title\",\"summary\",\"tags\"]，允许值：title / summary / tags / body"), mcp.WithStringEnumItems([]string{"title", "summary", "tags", "body"})),
		mcp.WithArray("return_fields", mcp.Description("返回字段数组，默认 [\"title\"]，允许值：title / summary"), mcp.WithStringEnumItems([]string{"title", "summary"})),
	), handleSearch)

	instance.AddTool(mcp.NewTool("memory_read",
		mcp.WithDescription(fmt.Sprintf("批量读取指定记忆条目的完整正文（ids 最多 %d 条），支持读取有权限的垃圾桶条目并标注归档状态。单条正文过长时支持通过 offset 分页读取。", ReadLimit)),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithArray("ids", mcp.Required(), mcp.Description(fmt.Sprintf("记忆 id 列表，最多 %d 条", ReadLimit)), mcp.WithStringItems()),
		mcp.WithInteger("offset", mcp.Description(fmt.Sprintf("单条正文的字符起始偏移，负数按 0 处理；单条最多返回 %d 字符", formatters.MaxBodyChars)), mcp.DefaultNumber(0)),
	), handleRead)

	instance.AddTool(mcp.NewTool("memory_save",
		mcp.WithDescription(fmt.Sprintf("在指定组别（隔离记忆区）新建记忆（需目标组别写权限）。标题 ≤ %d，摘要 ≤ %d，正文 ≤ %d 字符，超限拒绝写入且不截断。persistent 与 expires_at 互斥；同组别存在相似标题时照常创建并提示。", TitleMax, SummaryMax, BodyMax)),
		mcp.WithDestructiveHintAnnotation(false),
		mcp.WithString("group", mcp.Required(), mcp.Description("目标组别 slug，需具备该组别的 rw 权限")),
		mcp.WithString("title", mcp.Required(), mcp.Description(fmt.Sprintf("标题，不超过 %d 字符", TitleMax))),
		mcp.WithString("summary", mcp.Required(), mcp.Description(fmt.Sprintf("摘要，不超过 %d 字符", SummaryMax))),
		mcp.WithString("body", mcp.Required(), mcp.Description(fmt.Sprintf("正文，不超过 %d 字符", BodyMax))),
		mcp.WithArray("tags", mcp.Description("标签列表；省略表示无标签"), mcp.WithStringItems()),
		mcp.WithBoolean("persistent", mcp.Description("是否设为持久记忆（置顶且永不下沉至深层）；与 expires_at 互斥"), mcp.DefaultBool(false)),
		mcp.WithString("expires_at", mcp.Description("临时记忆自动归档时间，ISO 8601 且须晚于当前时间；与 persistent=true 互斥")),
	), handleSave)

	instance.AddTool(mcp.NewTool("memory_update",
		mcp.WithDescription("局部更新活跃记忆条目（需目标组别写权限）。仅需传入待修改字段；将临时记忆设为 persistent=true 时自动清除 expires_at，为持久记忆设置 expires_at 需同时传 persistent=false。"),
		mcp.WithIdempotentHintAnnotation(true),
		mcp.WithString("id", mcp.Required(), mcp.Description("目标记忆 id")),
		mcp.WithString("title", mcp.Description(fmt.Sprintf("新标题，不超过 %d 字符", TitleMax))),
		mcp.WithString("summary", mcp.Description(fmt.Sprintf("新摘要，不超过 %d 字符", SummaryMax))),
		mcp.WithString("body", mcp.Description(fmt.Sprintf("新正文，不超过 %d 字符", BodyMax))),
		mcp.WithArray("tags", mcp.Description("新标签列表；传 [] 清空标签"), mcp.WithStringItems()),
		mcp.WithBoolean("persistent", mcp.Description("是否设为持久记忆；与 expires_at 互斥")),
		mcp.WithString("expires_at", mcp.Description("新自动归档时间，ISO 8601 且须晚于当前时间")),
		mcp.WithBoolean("clear_expires_at", mcp.Description("清除自动归档时间转为常规记忆；与 expires_at 互斥"), mcp.DefaultBool(false)),
	), handleUpdate)

	instance.AddTool(mcp.NewTool("memory_edit",
		mcp.WithDescription("对活跃记忆正文执行精确局部文本替换（需目标组别写权限）。默认要求 old_string 唯一命中，传 replace_all=true 可替换全部命中。"),
		mcp.WithIdempotentHintAnnotation(false),
		mcp.WithString("id", mcp.Required(), mcp.Description("目标记忆 id")),
		mcp.WithString("old_string", mcp.Required(), mcp.Description("待替换的原文片段，不能为空")),
		mcp.WithString("new_string", mcp.Required(), mcp.Description("替换后的文本")),
		mcp.WithBoolean("replace_all", mcp.Description("是否替换全部匹配，默认 false 仅允许唯一匹配"), mcp.DefaultBool(false)),
	), handleEdit)

	instance.AddTool(mcp.NewTool("memory_forget",
		mcp.WithDescription("软删除活跃记忆条目并记录原因（需目标组别写权限）。条目移入垃圾桶，可通过 memory_restore 恢复或 memory_purge 永久删除。"),
		mcp.WithDestructiveHintAnnotation(true),
		mcp.WithString("id", mcp.Required(), mcp.Description("目标记忆 id")),
		mcp.WithString("reason", mcp.Required(), mcp.Description("删除原因，写入垃圾桶记录")),
	), handleForget)

	instance.AddTool(mcp.NewTool("memory_restore",
		mcp.WithDescription("从垃圾桶恢复指定记忆条目（需目标组别写权限）。未传入 expires_at 时，已到期的临时记忆自动清除归档时限；传入未来 expires_at 时原子转为临时记忆并清除持久标记。"),
		mcp.WithDestructiveHintAnnotation(false),
		mcp.WithString("id", mcp.Required(), mcp.Description("目标垃圾桶记忆 id")),
		mcp.WithString("expires_at", mcp.Description("可选，为恢复后的记忆重设未来自动归档时间（ISO 8601）")),
	), handleRestore)

	instance.AddTool(mcp.NewTool("memory_purge",
		mcp.WithDescription("永久物理删除垃圾桶中的单条记忆（不可逆，需目标组别写权限）。仅对垃圾桶条目生效。"),
		mcp.WithDestructiveHintAnnotation(true),
		mcp.WithString("id", mcp.Required(), mcp.Description("目标垃圾桶记忆 id")),
	), handlePurge)

	instance.AddTool(mcp.NewTool("memory_empty_trash",
		mcp.WithDescription("永久清空当前凭据具备写权限（rw）组别的垃圾桶条目（不可逆）。未授权或只读组别的垃圾桶条目不受影响。"),
		mcp.WithDestructiveHintAnnotation(true),
		mcp.WithString("group", mcp.Description("可选，仅清空该组别（需具备该组别 rw 权限）；省略时清空全部具备 rw 权限的组别")),
	), handleEmptyTrash)

	return instance
}

// NewMCPHandler wraps the streamable HTTP transport with a bearer guard that
// rejects unauthenticated requests before any protocol handling.
func NewMCPHandler(instance *mcpserver.MCPServer) http.Handler {
	streamable := mcpserver.NewStreamableHTTPServer(instance,
		mcpserver.WithEndpointPath("/mcp"),
		mcpserver.WithSessionIdleTTL(30*time.Minute),
		// Capsa authenticates every MCP request with a bearer token; DNS-rebinding
		// protection would otherwise reject legitimate reverse-proxy traffic whose
		// Host header is not localhost.
		mcpserver.WithDisableLocalhostProtection(true),
	)
	return bearerGuard(streamable)
}

func bearerGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
		if token == "" {
			unauthorized(w)
			return
		}
		access, err := auth.VerifyToken(token)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if access == nil {
			unauthorized(w)
			return
		}
		next.ServeHTTP(&streamResponseWriter{ResponseWriter: w}, r.WithContext(withAccessToken(r.Context(), access)))
	})
}

func bearerToken(r *http.Request) string {
	header := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if len(header) >= len(prefix) && strings.EqualFold(header[:len(prefix)], prefix) {
		return strings.TrimSpace(header[len(prefix):])
	}
	return ""
}

func unauthorized(w http.ResponseWriter) {
	w.Header().Set("WWW-Authenticate", "Bearer")
	w.WriteHeader(http.StatusUnauthorized)
}

// streamResponseWriter advertises unbuffered downstream delivery, matching the
// streaming contract expected by the MCP transport.
type streamResponseWriter struct {
	http.ResponseWriter
	wroteHeader bool
}

func (w *streamResponseWriter) WriteHeader(status int) {
	if !w.wroteHeader {
		w.wroteHeader = true
		header := w.Header()
		header.Set("X-Accel-Buffering", "no")
		if cacheControl := header.Get("Cache-Control"); cacheControl == "" {
			header.Set("Cache-Control", "no-cache, no-transform")
		} else if !strings.Contains(cacheControl, "no-transform") {
			header.Set("Cache-Control", cacheControl+", no-transform")
		}
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *streamResponseWriter) Write(b []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(b)
}

func (w *streamResponseWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

// Unwrap lets http.ResponseController reach the underlying writer.
func (w *streamResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func toolError(message string) (*mcp.CallToolResult, error) {
	return mcp.NewToolResultError(message), nil
}

func toolText(message string) (*mcp.CallToolResult, error) {
	return mcp.NewToolResultText(message), nil
}

// requireText applies the shared non-empty and length check, counting characters.
func requireText(value string, limit int, label string) (string, string) {
	if strings.TrimSpace(value) == "" {
		return "", label + "不能为空"
	}
	if utf8.RuneCountInString(value) > limit {
		return "", fmt.Sprintf("%s超长 (当前 %d 字符，上限 %d 字符，拒绝写入)",
			label, utf8.RuneCountInString(value), limit)
	}
	return value, ""
}

func rejectOverLimit(ids []string, limit int) string {
	if len(ids) > limit {
		return fmt.Sprintf("ids 上限为 %d，本次传入 %d 条", limit, len(ids))
	}
	return ""
}

func parseEnumListArg(arguments map[string]any, key string, defaults []string, allowed map[string]bool) ([]string, string) {
	raw, exists := arguments[key]
	if !exists || raw == nil {
		return defaults, ""
	}
	var items []string
	switch typed := raw.(type) {
	case []string:
		items = typed
	case []any:
		items = make([]string, 0, len(typed))
		for _, elem := range typed {
			text, ok := elem.(string)
			if !ok {
				return nil, fmt.Sprintf("%s 必须是非空字符串数组", key)
			}
			items = append(items, text)
		}
	default:
		return nil, fmt.Sprintf("%s 必须是非空字符串数组", key)
	}
	if len(items) == 0 {
		return nil, fmt.Sprintf("%s 不能为空数组", key)
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(items))
	for _, item := range items {
		if !allowed[item] {
			return nil, fmt.Sprintf("%s 包含不支持的取值：%s", key, item)
		}
		if !seen[item] {
			seen[item] = true
			out = append(out, item)
		}
	}
	return out, ""
}

// locateWritable resolves an active entry and requires write permission on its
// group; the second return is an error message when the operation must stop.
func locateWritable(handle *sql.DB, memoryID string, grants map[string]string) (map[string]any, string) {
	results, err := dal.GetMemoriesBatchForAccess(handle, []string{memoryID}, grants, false)
	if err != nil || len(results) == 0 {
		return nil, fmt.Sprintf("记忆 %s 不存在或无权访问", memoryID)
	}
	item := results[0]
	if item["status"] != "authorized" {
		return nil, fmt.Sprintf("记忆 %s 不存在或无权访问", memoryID)
	}
	group := item["group_slug"].(string)
	if permissions.PermissionFor(grants, group) != "rw" {
		return nil, fmt.Sprintf("对组别 %s 只有只读权限，拒绝修改", group)
	}
	return item, ""
}

// locateDeletedWritable resolves a recycle-bin entry and requires write
// permission on its group without leaking unauthorized group names.
func locateDeletedWritable(handle *sql.DB, memoryID string, grants map[string]string) (map[string]any, string) {
	results, err := dal.GetMemoriesBatchForAccess(handle, []string{memoryID}, grants, true)
	if err != nil || len(results) == 0 {
		return nil, fmt.Sprintf("记忆 %s 不存在、不在垃圾桶或无权访问", memoryID)
	}
	item := results[0]
	if item["status"] != "authorized" || item["deleted_at"] == nil {
		return nil, fmt.Sprintf("记忆 %s 不存在、不在垃圾桶或无权访问", memoryID)
	}
	group := item["group_slug"].(string)
	if permissions.PermissionFor(grants, group) != "rw" {
		return nil, fmt.Sprintf("对组别 %s 只有只读权限，拒绝修改", group)
	}
	return item, ""
}

func handleGroups(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	var groups []map[string]any
	if err := withMemoryDB(func(handle *sql.DB) error {
		var err error
		groups, err = dal.ListGroupsWithCounts(handle, GrantsFrom(ctx))
		return err
	}); err != nil {
		return toolError("服务内部错误")
	}
	return toolText(formatters.FormatGroups(groups))
}

var validCatalogDepths = map[string]bool{
	"lighter": true, "shallow": true, "deeper": true, "full": true,
}

func handleCatalog(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	depth := request.GetString("depth", "shallow")
	if !validCatalogDepths[depth] {
		return toolError(fmt.Sprintf("depth 取值必须为 lighter / shallow / deeper / full，本次传入 %s", depth))
	}
	limit := request.GetInt("limit", 50)
	if limit < 1 || limit > CatalogLimit {
		return toolError(fmt.Sprintf("limit 取值范围为 1~%d，本次传入 %d", CatalogLimit, limit))
	}
	offset := request.GetInt("offset", 0)
	if offset < 0 {
		return toolError(fmt.Sprintf("offset 不能为负数，本次传入 %d", offset))
	}
	group := request.GetString("group", "")
	scopes := GrantsFrom(ctx)
	var rows []map[string]any
	if err := withMemoryDB(func(handle *sql.DB) error {
		var err error
		rows, err = dal.ListMemoriesForCatalogAndSearch(handle, scopes, "", group, true, false, false)
		return err
	}); err != nil {
		return toolError("服务内部错误")
	}
	now := nowUTC()
	filtered := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		layer := retrieval.LayerOf(row, now)
		switch depth {
		case "lighter", "shallow":
			if layer == "shallow" {
				filtered = append(filtered, row)
			}
		case "deeper":
			if layer == "deep" {
				filtered = append(filtered, row)
			}
		case "full":
			if layer == "shallow" || layer == "deep" {
				filtered = append(filtered, row)
			}
		}
	}
	total := len(filtered)
	var page []map[string]any
	if offset < total {
		end := min(offset+limit, total)
		page = filtered[offset:end]
	}
	return toolText(formatters.FormatCatalog(depth, page, total, offset, scopes, now))
}

var (
	validSearchLayers = map[string]bool{"shallow": true, "deep": true, "trash": true}
	validSearchIn     = map[string]bool{"title": true, "summary": true, "tags": true, "body": true}
	validReturnFields = map[string]bool{"title": true, "summary": true}
)

func handleSearch(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	limit := request.GetInt("limit", 10)
	if limit < 1 || limit > SearchLimit {
		return toolError(fmt.Sprintf("limit 取值范围为 1~%d，本次传入 %d", SearchLimit, limit))
	}
	arguments := request.GetArguments()
	layers, msg := parseEnumListArg(arguments, "layers", []string{"shallow"}, validSearchLayers)
	if msg != "" {
		return toolError(msg)
	}
	searchIn, msg := parseEnumListArg(arguments, "search_in", []string{"title", "summary", "tags"}, validSearchIn)
	if msg != "" {
		return toolError(msg)
	}
	returnFields, msg := parseEnumListArg(arguments, "return_fields", []string{"title"}, validReturnFields)
	if msg != "" {
		return toolError(msg)
	}

	layerSet := map[string]bool{}
	for _, l := range layers {
		layerSet[l] = true
	}
	fields := retrieval.SearchFields{}
	for _, f := range searchIn {
		switch f {
		case "title":
			fields.Title = true
		case "summary":
			fields.Summary = true
		case "tags":
			fields.Tags = true
		case "body":
			fields.Body = true
		}
	}
	returnTitle, returnSummary := false, false
	for _, f := range returnFields {
		if f == "title" {
			returnTitle = true
		} else if f == "summary" {
			returnSummary = true
		}
	}

	query := request.GetString("query", "")
	group := request.GetString("group", "")
	// 空 query 是浏览而非检索：正文只服务于关键词检索，浏览一律不投影正文。
	loadBody := fields.Body && strings.TrimSpace(query) != ""
	includeActive := layerSet["shallow"] || layerSet["deep"]
	includeDeleted := layerSet["trash"]
	scopes := GrantsFrom(ctx)

	var memories []map[string]any
	if err := withMemoryDB(func(handle *sql.DB) error {
		var err error
		memories, err = dal.ListMemoriesForCatalogAndSearch(handle, scopes, "", group, includeActive, includeDeleted, loadBody)
		return err
	}); err != nil {
		return toolError("服务内部错误")
	}

	now := nowUTC()
	filtered := make([]map[string]any, 0, len(memories))
	for _, row := range memories {
		if layerSet[retrieval.LayerOf(row, now)] {
			filtered = append(filtered, row)
		}
	}
	ranked := retrieval.RankMemoriesWithFields(filtered, query, fields)
	if len(ranked) > limit {
		ranked = ranked[:limit]
	}
	return toolText(formatters.FormatSearch(query, ranked, scopes, layers, searchIn, returnTitle, returnSummary, now))
}

func handleRead(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	ids := request.GetStringSlice("ids", nil)
	if message := rejectOverLimit(ids, ReadLimit); message != "" {
		return toolError(message)
	}
	offset := request.GetInt("offset", 0)
	var items []map[string]any
	if err := withMemoryDB(func(handle *sql.DB) error {
		var err error
		items, err = dal.GetMemoriesBatchForAccess(handle, ids, GrantsFrom(ctx), true)
		return err
	}); err != nil {
		return toolError("服务内部错误")
	}
	return toolText(formatters.FormatRead(items, offset, nowUTC()))
}

func handleSave(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	grants := GrantsFrom(ctx)
	group := request.GetString("group", "")
	if permissions.PermissionFor(grants, group) != "rw" {
		return toolError(fmt.Sprintf("对组别 %s 没有写权限，拒绝写入", group))
	}
	title, message := requireText(request.GetString("title", ""), TitleMax, "标题")
	if message != "" {
		return toolError(message)
	}
	summary, message := requireText(request.GetString("summary", ""), SummaryMax, "摘要")
	if message != "" {
		return toolError(message)
	}
	body, message := requireText(request.GetString("body", ""), BodyMax, "正文")
	if message != "" {
		return toolError(message)
	}
	persistent := request.GetBool("persistent", false)
	var expiresAt *string
	if value := strings.TrimSpace(request.GetString("expires_at", "")); value != "" {
		if persistent {
			return toolError("持久记忆与临时记忆（expires_at）互斥，不能同时设置")
		}
		normalized, msg := parseFutureExpiresAt(value, nowUTC())
		if msg != "" {
			return toolError(msg)
		}
		expiresAt = &normalized
	}
	tags := request.GetStringSlice("tags", nil)
	var (
		memoryID string
		similar  []map[string]any
		saveErr  string
	)
	if err := withMemoryDB(func(handle *sql.DB) error {
		candidates, err := dal.ListActiveTitlesByGroup(handle, group)
		if err != nil {
			return err
		}
		similar = retrieval.FindSimilarMemories(candidates, title, retrieval.SimilarityThreshold)
		memoryID, err = dal.InsertMemory(handle, group, title, summary, body, tags, persistent, expiresAt, nil)
		if err != nil {
			saveErr = fmt.Sprintf("组别 %s 不存在，拒绝写入", group)
			return nil
		}
		return nil
	}); err != nil {
		return toolError("服务内部错误")
	}
	if saveErr != "" {
		return toolError(saveErr)
	}
	lines := []string{fmt.Sprintf("已新建记忆：%s | 组别 %s", memoryID, group)}
	if len(similar) > 0 {
		lines = append(lines, "检测到同组别相似标题（已照常创建，请自行判断是否重复）：")
		for _, item := range similar {
			lines = append(lines, fmt.Sprintf("- %s | 相似度 %v | %s",
				item["id"], item["similarity"], item["title"]))
		}
	}
	return toolText(strings.Join(lines, "\n"))
}

func handleUpdate(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	arguments := request.GetArguments()
	memoryID := request.GetString("id", "")

	var (
		toolErrMsg string
		names      []string
	)
	if err := withMemoryDB(func(handle *sql.DB) error {
		existing, message := locateWritable(handle, memoryID, GrantsFrom(ctx))
		if message != "" {
			toolErrMsg = message
			return nil
		}
		fields := map[string]any{}
		if value, ok := arguments["title"]; ok && value != nil {
			text, msg := requireText(request.GetString("title", ""), TitleMax, "标题")
			if msg != "" {
				toolErrMsg = msg
				return nil
			}
			fields["title"] = text
			names = append(names, "title")
		}
		if value, ok := arguments["summary"]; ok && value != nil {
			text, msg := requireText(request.GetString("summary", ""), SummaryMax, "摘要")
			if msg != "" {
				toolErrMsg = msg
				return nil
			}
			fields["summary"] = text
			names = append(names, "summary")
		}
		if value, ok := arguments["body"]; ok && value != nil {
			text, msg := requireText(request.GetString("body", ""), BodyMax, "正文")
			if msg != "" {
				toolErrMsg = msg
				return nil
			}
			fields["body"] = text
			names = append(names, "body")
		}
		if value, ok := arguments["tags"]; ok && value != nil {
			fields["tags"] = request.GetStringSlice("tags", nil)
			names = append(names, "tags")
		}

		rawPersistent, hasPersistent := arguments["persistent"]
		hasPersistent = hasPersistent && rawPersistent != nil
		persistentVal := request.GetBool("persistent", false)

		rawExpires, hasExpires := arguments["expires_at"]
		expiresVal := ""
		if hasExpires && rawExpires != nil {
			if text, ok := rawExpires.(string); ok && strings.TrimSpace(text) != "" {
				expiresVal = strings.TrimSpace(text)
			} else {
				hasExpires = false
			}
		} else {
			hasExpires = false
		}
		clearExpires := request.GetBool("clear_expires_at", false)

		lifecycleFields, msg := validateMemoryLifecycleUpdate(existing, hasPersistent, persistentVal, hasExpires, expiresVal, clearExpires, nowUTC())
		if msg != "" {
			toolErrMsg = msg
			return nil
		}
		if v, ok := lifecycleFields["pinned"]; ok {
			fields["pinned"] = v
			names = append(names, "persistent")
		}
		if v, ok := lifecycleFields["expires_at"]; ok {
			fields["expires_at"] = v
			names = append(names, "expires_at")
		}
		if len(fields) == 0 {
			toolErrMsg = "至少提供一个待更新字段"
			return nil
		}
		updated, err := dal.UpdateMemory(handle, memoryID, fields)
		if err != nil {
			return err
		}
		if !updated {
			toolErrMsg = fmt.Sprintf("记忆 %s 不存在或无权访问", memoryID)
		}
		return nil
	}); err != nil {
		return toolError("服务内部错误")
	}
	if toolErrMsg != "" {
		return toolError(toolErrMsg)
	}
	return toolText(fmt.Sprintf("已更新记忆：%s | 字段: %s", memoryID, strings.Join(names, ", ")))
}

func handleEdit(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	memoryID := request.GetString("id", "")
	oldString := request.GetString("old_string", "")
	newString := request.GetString("new_string", "")
	replaceAll := request.GetBool("replace_all", false)

	var (
		toolErrMsg string
		count      int
	)
	if err := withMemoryDB(func(handle *sql.DB) error {
		if _, message := locateWritable(handle, memoryID, GrantsFrom(ctx)); message != "" {
			toolErrMsg = message
			return nil
		}
		var (
			status string
			err    error
		)
		count, status, err = dal.EditMemoryBody(handle, memoryID, oldString, newString, replaceAll, BodyMax)
		if err != nil {
			return err
		}
		switch status {
		case "empty_match":
			toolErrMsg = "old_string 不能为空"
		case "not_found":
			toolErrMsg = fmt.Sprintf("记忆 %s 不存在或无权访问", memoryID)
		case "no_match":
			toolErrMsg = "未在正文中找到 old_string 匹配片段"
		case "ambiguous":
			toolErrMsg = fmt.Sprintf("old_string 命中 %d 处，请提供更具体片段或设置 replace_all=true", count)
		case "empty_body":
			toolErrMsg = "替换后正文不能为空白"
		case "body_too_long":
			toolErrMsg = fmt.Sprintf("替换后正文超出上限（%d 字符），拒绝写入", BodyMax)
		}
		return nil
	}); err != nil {
		return toolError("服务内部错误")
	}
	if toolErrMsg != "" {
		return toolError(toolErrMsg)
	}
	return toolText(fmt.Sprintf("已局部编辑记忆：%s | 替换 %d 处", memoryID, count))
}

func handleForget(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	memoryID := request.GetString("id", "")
	reason := strings.TrimSpace(request.GetString("reason", ""))
	if reason == "" {
		return toolError("删除原因不能为空")
	}
	var toolErrMsg string
	if err := withMemoryDB(func(handle *sql.DB) error {
		if _, message := locateWritable(handle, memoryID, GrantsFrom(ctx)); message != "" {
			toolErrMsg = message
			return nil
		}
		deleted, err := dal.SoftDeleteMemory(handle, memoryID, reason)
		if err != nil {
			return err
		}
		if !deleted {
			toolErrMsg = fmt.Sprintf("记忆 %s 不存在或无权访问", memoryID)
		}
		return nil
	}); err != nil {
		return toolError("服务内部错误")
	}
	if toolErrMsg != "" {
		return toolError(toolErrMsg)
	}
	return toolText(fmt.Sprintf("已移入垃圾桶：%s | 原因: %s | 可通过 memory_restore 恢复或 memory_purge 永久删除", memoryID, reason))
}

func handleRestore(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	memoryID := request.GetString("id", "")
	var newExpiresAt *string
	if raw := strings.TrimSpace(request.GetString("expires_at", "")); raw != "" {
		normalized, msg := parseFutureExpiresAt(raw, nowUTC())
		if msg != "" {
			return toolError(msg)
		}
		newExpiresAt = &normalized
	}
	var toolErrMsg string
	if err := withMemoryDB(func(handle *sql.DB) error {
		if _, message := locateDeletedWritable(handle, memoryID, GrantsFrom(ctx)); message != "" {
			toolErrMsg = message
			return nil
		}
		restored, err := dal.RestoreMemory(handle, memoryID, newExpiresAt, db.UtcNow())
		if err != nil {
			return err
		}
		if !restored {
			toolErrMsg = fmt.Sprintf("记忆 %s 不存在、不在垃圾桶或无权访问", memoryID)
		}
		return nil
	}); err != nil {
		return toolError("服务内部错误")
	}
	if toolErrMsg != "" {
		return toolError(toolErrMsg)
	}
	if newExpiresAt != nil {
		return toolText(fmt.Sprintf("已恢复记忆：%s | 新自动归档时间: %s", memoryID, *newExpiresAt))
	}
	return toolText(fmt.Sprintf("已恢复记忆：%s", memoryID))
}

func handlePurge(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	memoryID := request.GetString("id", "")
	var toolErrMsg string
	if err := withMemoryDB(func(handle *sql.DB) error {
		if _, message := locateDeletedWritable(handle, memoryID, GrantsFrom(ctx)); message != "" {
			toolErrMsg = message
			return nil
		}
		purged, err := dal.PurgeMemory(handle, memoryID)
		if err != nil {
			return err
		}
		if !purged {
			toolErrMsg = fmt.Sprintf("记忆 %s 不存在、不在垃圾桶或无权访问", memoryID)
		}
		return nil
	}); err != nil {
		return toolError("服务内部错误")
	}
	if toolErrMsg != "" {
		return toolError(toolErrMsg)
	}
	return toolText(fmt.Sprintf("已永久删除记忆：%s", memoryID))
}

func handleEmptyTrash(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	grants := GrantsFrom(ctx)
	group := strings.TrimSpace(request.GetString("group", ""))

	var (
		wildcard bool
		slugs    []string
	)
	if group != "" {
		if permissions.PermissionFor(grants, group) != "rw" {
			return toolError(fmt.Sprintf("对组别 %s 没有写权限，拒绝清空垃圾桶", group))
		}
		slugs = []string{group}
	} else {
		wildcard, slugs = writableScopesFrom(grants)
		if !wildcard && len(slugs) == 0 {
			return toolError("当前凭据对任何组别均无写权限，拒绝清空垃圾桶")
		}
	}

	var deletedCount int64
	if err := withMemoryDB(func(handle *sql.DB) error {
		var err error
		deletedCount, err = dal.EmptyTrashMemories(handle, slugs, wildcard, "", group)
		return err
	}); err != nil {
		return toolError("服务内部错误")
	}
	if group != "" {
		return toolText(fmt.Sprintf("已清空组别 %s 的垃圾桶：共永久删除 %d 条记忆", group, deletedCount))
	}
	return toolText(fmt.Sprintf("已清空授权可写组别的垃圾桶：共永久删除 %d 条记忆", deletedCount))
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
