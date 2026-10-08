// Package server assembles the HTTP surface: the MCP streamable endpoint, the
// Web REST API and the embedded SPA. Transport layers hold no SQL.
package server

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
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
	SearchLimit = 20
	PeekLimit   = 10
	ReadLimit   = 5

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

// NewMCPServer builds the MCP server with the seven memory tools.
func NewMCPServer() *mcpserver.MCPServer {
	instance := mcpserver.NewMCPServer("capsa", "1.0.0")

	instance.AddTool(mcp.NewTool("memory_groups",
		mcp.WithDescription("列出当前凭据可访问的分组、各分组活跃条目数与读写权限。"),
		mcp.WithReadOnlyHintAnnotation(true),
	), handleGroups)

	instance.AddTool(mcp.NewTool("memory_search",
		mcp.WithDescription("检索记忆条目（返回标题与元数据，不含正文）。仅在标题与摘要未命中特定代码、配置细节时，可开启 include_body=True 兜底召回。查看摘要请调用 memory_peek，获取正文请调用 memory_read。"),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithString("query", mcp.Description("关键词；省略时按置顶与更新时间倒序浏览")),
		mcp.WithString("group", mcp.Description("只检索该分组；省略时检索凭据可访问的全部分组")),
		mcp.WithInteger("limit", mcp.Description(fmt.Sprintf("返回条数上限，取值 1~%d", SearchLimit)), mcp.DefaultNumber(10)),
		mcp.WithBoolean("include_body", mcp.Description("是否把正文并入检索范围；正文命中权重低于标题与摘要，仅在元数据未命中时开启")),
	), handleSearch)

	instance.AddTool(mcp.NewTool("memory_peek",
		mcp.WithDescription(fmt.Sprintf("批量查看指定记忆条目的标题与摘要（ids 最多 %d 条）。获取完整正文请调用 memory_read。", PeekLimit)),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithArray("ids", mcp.Required(), mcp.Description(fmt.Sprintf("记忆 id 列表，最多 %d 条", PeekLimit)), mcp.WithStringItems()),
	), handlePeek)

	instance.AddTool(mcp.NewTool("memory_read",
		mcp.WithDescription(fmt.Sprintf("批量读取指定记忆条目的完整正文（ids 最多 %d 条）。单条正文过长时支持通过 offset 分页读取。", ReadLimit)),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithArray("ids", mcp.Required(), mcp.Description(fmt.Sprintf("记忆 id 列表，最多 %d 条", ReadLimit)), mcp.WithStringItems()),
		mcp.WithInteger("offset", mcp.Description(fmt.Sprintf("单条正文的字符起始偏移，负数按 0 处理；单条最多返回 %d 字符", formatters.MaxBodyChars)), mcp.DefaultNumber(0)),
	), handleRead)

	instance.AddTool(mcp.NewTool("memory_save",
		mcp.WithDescription(fmt.Sprintf("在指定分组新建记忆（需目标分组写权限）。标题 ≤ %d，摘要 ≤ %d，正文 ≤ %d 字符，超限拒绝写入且不截断。同分组存在相似标题时照常创建并提示。", TitleMax, SummaryMax, BodyMax)),
		mcp.WithDestructiveHintAnnotation(false),
		mcp.WithString("group", mcp.Required(), mcp.Description("目标分组 slug，需具备该分组的 rw 权限")),
		mcp.WithString("title", mcp.Required(), mcp.Description(fmt.Sprintf("标题，不超过 %d 字符", TitleMax))),
		mcp.WithString("summary", mcp.Required(), mcp.Description(fmt.Sprintf("摘要，不超过 %d 字符", SummaryMax))),
		mcp.WithString("body", mcp.Required(), mcp.Description(fmt.Sprintf("正文，不超过 %d 字符", BodyMax))),
		mcp.WithArray("tags", mcp.Description("标签列表；省略表示无标签"), mcp.WithStringItems()),
		mcp.WithString("review_at", mcp.Description("复核时间，ISO 8601；省略表示不设复核")),
	), handleSave)

	instance.AddTool(mcp.NewTool("memory_update",
		mcp.WithDescription("局部更新记忆条目（需目标分组写权限）。仅需传入待修改字段。"),
		mcp.WithIdempotentHintAnnotation(true),
		mcp.WithString("id", mcp.Required(), mcp.Description("目标记忆 id")),
		mcp.WithString("title", mcp.Description(fmt.Sprintf("新标题，不超过 %d 字符", TitleMax))),
		mcp.WithString("summary", mcp.Description(fmt.Sprintf("新摘要，不超过 %d 字符", SummaryMax))),
		mcp.WithString("body", mcp.Description(fmt.Sprintf("新正文，不超过 %d 字符", BodyMax))),
		mcp.WithArray("tags", mcp.Description("新标签列表；传 [] 清空标签"), mcp.WithStringItems()),
		mcp.WithString("review_at", mcp.Description("新复核时间，ISO 8601")),
		mcp.WithBoolean("clear_review_at", mcp.Description("置空复核时间；与 review_at 互斥"), mcp.DefaultBool(false)),
		mcp.WithBoolean("pinned", mcp.Description("是否置顶")),
	), handleUpdate)

	instance.AddTool(mcp.NewTool("memory_forget",
		mcp.WithDescription("软删除记忆条目并记录原因（需目标分组写权限）。条目移入回收站，可通过 CLI 恢复。"),
		mcp.WithDestructiveHintAnnotation(true),
		mcp.WithString("id", mcp.Required(), mcp.Description("目标记忆 id")),
		mcp.WithString("reason", mcp.Required(), mcp.Description("删除原因，写入回收站记录")),
	), handleForget)

	return instance
}

// NewMCPHandler wraps the streamable HTTP transport with a bearer guard that
// rejects unauthenticated requests before any protocol handling.
func NewMCPHandler(instance *mcpserver.MCPServer) http.Handler {
	streamable := mcpserver.NewStreamableHTTPServer(instance,
		mcpserver.WithEndpointPath("/mcp"),
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
		return header[len(prefix):]
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

func parseReviewAt(value string) (string, string) {
	normalized, err := retrieval.NormalizeReviewAt(value)
	if err != nil {
		return "", fmt.Sprintf("review_at 不是合法的 ISO 8601 时间：%s", value)
	}
	return normalized, ""
}

// locateWritable resolves the target entry and requires write permission on its
// group; the second return is an error message when the operation must stop.
func locateWritable(handle *sql.DB, memoryID string, grants map[string]string) (map[string]any, string) {
	results, err := dal.GetMemoriesBatchForAccess(handle, []string{memoryID}, grants)
	if err != nil || len(results) == 0 {
		return nil, fmt.Sprintf("记忆 %s 不存在或无权访问", memoryID)
	}
	item := results[0]
	if item["status"] != "authorized" {
		return nil, fmt.Sprintf("记忆 %s 不存在或无权访问", memoryID)
	}
	group := item["group_slug"].(string)
	if permissions.PermissionFor(grants, group) != "rw" {
		return nil, fmt.Sprintf("对分组 %s 只有只读权限，拒绝修改", group)
	}
	return item, ""
}

func handleGroups(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	handle, err := db.Connect()
	if err != nil {
		return toolError("服务内部错误")
	}
	defer handle.Close()
	groups, err := dal.ListGroupsWithCounts(handle, GrantsFrom(ctx))
	if err != nil {
		return toolError("服务内部错误")
	}
	return toolText(formatters.FormatGroups(groups))
}

func handleSearch(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	limit := request.GetInt("limit", 10)
	if limit < 1 || limit > SearchLimit {
		return toolError(fmt.Sprintf("limit 取值范围为 1~%d，本次传入 %d", SearchLimit, limit))
	}
	query := request.GetString("query", "")
	group := request.GetString("group", "")
	includeBody := request.GetBool("include_body", false)
	// 空 query 是浏览而非检索：正文只服务于关键词兜底，浏览一律不投影正文。
	loadBody := includeBody && strings.TrimSpace(query) != ""
	scopes := GrantsFrom(ctx)
	handle, err := db.Connect()
	if err != nil {
		return toolError("服务内部错误")
	}
	defer handle.Close()
	memories, err := dal.ListActiveMemoriesForSearch(handle, scopes, group, loadBody)
	if err != nil {
		return toolError("服务内部错误")
	}
	ranked := retrieval.RankMemories(memories, query, nowUTC(), loadBody)
	if len(ranked) > limit {
		ranked = ranked[:limit]
	}
	return toolText(formatters.FormatSearch(query, ranked, scopes, nowUTC()))
}

func handlePeek(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	ids := request.GetStringSlice("ids", nil)
	if message := rejectOverLimit(ids, PeekLimit); message != "" {
		return toolError(message)
	}
	handle, err := db.Connect()
	if err != nil {
		return toolError("服务内部错误")
	}
	defer handle.Close()
	items, err := dal.GetMemoriesBatchForAccess(handle, ids, GrantsFrom(ctx))
	if err != nil {
		return toolError("服务内部错误")
	}
	return toolText(formatters.FormatPeek(items))
}

func handleRead(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	ids := request.GetStringSlice("ids", nil)
	if message := rejectOverLimit(ids, ReadLimit); message != "" {
		return toolError(message)
	}
	offset := request.GetInt("offset", 0)
	handle, err := db.Connect()
	if err != nil {
		return toolError("服务内部错误")
	}
	defer handle.Close()
	items, err := dal.GetMemoriesBatchForAccess(handle, ids, GrantsFrom(ctx))
	if err != nil {
		return toolError("服务内部错误")
	}
	return toolText(formatters.FormatRead(items, offset))
}

func handleSave(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	grants := GrantsFrom(ctx)
	group := request.GetString("group", "")
	if permissions.PermissionFor(grants, group) != "rw" {
		return toolError(fmt.Sprintf("对分组 %s 没有写权限，拒绝写入", group))
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
	var stamp *string
	if value := request.GetString("review_at", ""); value != "" {
		normalized, message := parseReviewAt(value)
		if message != "" {
			return toolError(message)
		}
		stamp = &normalized
	}
	tags := request.GetStringSlice("tags", nil)
	handle, err := db.Connect()
	if err != nil {
		return toolError("服务内部错误")
	}
	defer handle.Close()
	candidates, err := dal.ListActiveMemoriesForSearch(handle, map[string]string{group: "rw"}, group, false)
	if err != nil {
		return toolError("服务内部错误")
	}
	similar := retrieval.FindSimilarMemories(candidates, title, retrieval.SimilarityThreshold)
	memoryID, err := dal.InsertMemory(handle, group, title, summary, body, tags, stamp, nil)
	if err != nil {
		return toolError(fmt.Sprintf("分组 %s 不存在，拒绝写入", group))
	}
	lines := []string{fmt.Sprintf("已新建记忆：%s | 分组 %s", memoryID, group)}
	if len(similar) > 0 {
		lines = append(lines, "检测到同分组相似标题（已照常创建，请自行判断是否重复）：")
		for _, item := range similar {
			lines = append(lines, fmt.Sprintf("- %s | 相似度 %v | %s",
				item["id"], item["similarity"], item["title"]))
		}
	}
	return toolText(strings.Join(lines, "\n"))
}

func handleUpdate(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	arguments := request.GetArguments()
	clearReview := request.GetBool("clear_review_at", false)
	rawReview, hasReview := arguments["review_at"]
	if clearReview && hasReview && rawReview != nil {
		if text, ok := rawReview.(string); ok && text != "" {
			return toolError("clear_review_at 与 review_at 不能同时给出")
		}
	}
	memoryID := request.GetString("id", "")
	handle, err := db.Connect()
	if err != nil {
		return toolError("服务内部错误")
	}
	defer handle.Close()
	if _, message := locateWritable(handle, memoryID, GrantsFrom(ctx)); message != "" {
		return toolError(message)
	}
	fields := map[string]any{}
	names := []string{}
	if value, ok := arguments["title"]; ok && value != nil {
		text, message := requireText(request.GetString("title", ""), TitleMax, "标题")
		if message != "" {
			return toolError(message)
		}
		fields["title"] = text
		names = append(names, "title")
	}
	if value, ok := arguments["summary"]; ok && value != nil {
		text, message := requireText(request.GetString("summary", ""), SummaryMax, "摘要")
		if message != "" {
			return toolError(message)
		}
		fields["summary"] = text
		names = append(names, "summary")
	}
	if value, ok := arguments["body"]; ok && value != nil {
		text, message := requireText(request.GetString("body", ""), BodyMax, "正文")
		if message != "" {
			return toolError(message)
		}
		fields["body"] = text
		names = append(names, "body")
	}
	if value, ok := arguments["tags"]; ok && value != nil {
		fields["tags"] = request.GetStringSlice("tags", nil)
		names = append(names, "tags")
	}
	if value, ok := arguments["pinned"]; ok && value != nil {
		fields["pinned"] = boolToInt(request.GetBool("pinned", false))
		names = append(names, "pinned")
	}
	if clearReview {
		fields["review_at"] = nil
		names = append(names, "review_at")
	} else if text := request.GetString("review_at", ""); text != "" {
		normalized, message := parseReviewAt(text)
		if message != "" {
			return toolError(message)
		}
		fields["review_at"] = normalized
		names = append(names, "review_at")
	}
	if len(fields) == 0 {
		return toolError("至少提供一个待更新字段")
	}
	updated, err := dal.UpdateMemory(handle, memoryID, fields)
	if err != nil {
		return toolError("服务内部错误")
	}
	if !updated {
		return toolError(fmt.Sprintf("记忆 %s 不存在或无权访问", memoryID))
	}
	return toolText(fmt.Sprintf("已更新记忆：%s | 字段: %s", memoryID, strings.Join(names, ", ")))
}

func handleForget(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	memoryID := request.GetString("id", "")
	handle, err := db.Connect()
	if err != nil {
		return toolError("服务内部错误")
	}
	defer handle.Close()
	if _, message := locateWritable(handle, memoryID, GrantsFrom(ctx)); message != "" {
		return toolError(message)
	}
	reason := strings.TrimSpace(request.GetString("reason", ""))
	if reason == "" {
		return toolError("删除原因不能为空")
	}
	deleted, err := dal.SoftDeleteMemory(handle, memoryID, reason)
	if err != nil {
		return toolError("服务内部错误")
	}
	if !deleted {
		return toolError(fmt.Sprintf("记忆 %s 不存在或无权访问", memoryID))
	}
	return toolText(fmt.Sprintf("已删除记忆：%s | 原因: %s | 可用 capsa memory restore %s 恢复", memoryID, reason, memoryID))
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
