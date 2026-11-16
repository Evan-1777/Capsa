package server

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"path"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"

	"capsa/internal/auth"
	"capsa/internal/dal"
	"capsa/internal/db"
)

// GrepLimitDefault and GrepLimitMax bound doc_grep's line output.
const (
	GrepLimitDefault = 100
	GrepLimitMax     = 500
)

// publicReadOnlyMessage is the single refusal shared by every write primitive
// once the caller asks for the public scope.
const publicReadOnlyMessage = "公共文档区为只读，禁止修改"

type docIdentityContextKeyType struct{}

var docIdentityContextKey = docIdentityContextKeyType{}

func withDocIdentity(ctx context.Context, identity *auth.DocAccessIdentity) context.Context {
	return context.WithValue(ctx, docIdentityContextKey, identity)
}

// docIdentityFrom returns the verified document caller, or nil.
func docIdentityFrom(ctx context.Context) *auth.DocAccessIdentity {
	identity, _ := ctx.Value(docIdentityContextKey).(*auth.DocAccessIdentity)
	return identity
}

// NewDocsMCPServer builds the document workspace server with its seven
// file-like primitives.
func NewDocsMCPServer() *mcpserver.MCPServer {
	instance := mcpserver.NewMCPServer("capsa-docs", "1.0.0")

	instance.AddTool(mcp.NewTool("doc_glob",
		mcp.WithDescription("按路径通配或子串匹配列出文档，返回作用域、路径、字符数与更新日期。"),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithString("pattern", mcp.Description("路径模式：省略列出全部；不含 * ? [ 时按大小写不敏感子串匹配；含通配符时按 shell 风格匹配，不含 / 的模式也匹配文件名")),
		mcp.WithString("scope", mcp.Description("检索范围：all（默认，公共区与当前子项目）、category（仅当前子项目）、public（仅公共区）")),
	), handleDocGlob)

	instance.AddTool(mcp.NewTool("doc_grep",
		mcp.WithDescription(fmt.Sprintf("在文档正文中按关键词或正则检索，返回命中行所在文档、行号与行文本（默认最多 %d 行）。", GrepLimitDefault)),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithString("pattern", mcp.Required(), mcp.Description("检索词；is_regex 为 true 时按 Go 正则表达式解释")),
		mcp.WithBoolean("is_regex", mcp.Description("是否按正则表达式检索，默认 false"), mcp.DefaultBool(false)),
		mcp.WithString("scope", mcp.Description("检索范围：all（默认）、category、public")),
		mcp.WithString("path", mcp.Description("只检索该路径的单篇文档；省略时检索范围内全部文档")),
		mcp.WithInteger("limit", mcp.Description(fmt.Sprintf("返回匹配行上限，取值 1~%d", GrepLimitMax)), mcp.DefaultNumber(GrepLimitDefault)),
	), handleDocGrep)

	instance.AddTool(mcp.NewTool("doc_read",
		mcp.WithDescription("读取单篇文档正文。省略 offset 与 limit 时返回完整正文（不做字符截断）；给出其一则按行号区间分段返回并标注行号。"),
		mcp.WithReadOnlyHintAnnotation(true),
		mcp.WithString("path", mcp.Required(), mcp.Description("文档逻辑路径")),
		mcp.WithString("scope", mcp.Description("文档作用域：category（默认，当前子项目）或 public（所在工作区公共区）")),
		mcp.WithInteger("offset", mcp.Description("起始行号，1-based；省略表示从首行开始")),
		mcp.WithInteger("limit", mcp.Description("最多读取的行数；省略表示读到末尾")),
	), handleDocRead)

	instance.AddTool(mcp.NewTool("doc_create",
		mcp.WithDescription("在当前子项目新建文档；路径已存在时拒绝覆盖，需改走 doc_write。公共文档区只读。"),
		mcp.WithDestructiveHintAnnotation(false),
		mcp.WithString("path", mcp.Required(), mcp.Description("新文档的逻辑路径，允许斜杠分层")),
		mcp.WithString("content", mcp.Required(), mcp.Description("初始正文，允许空串")),
		mcp.WithString("scope", mcp.Description("仅接受 category；传入 public 会被拒绝")),
	), handleDocCreate)

	instance.AddTool(mcp.NewTool("doc_write",
		mcp.WithDescription("对当前子项目下已存在的文档执行全量正文覆盖；文档不存在时不会新建。公共文档区只读。"),
		mcp.WithIdempotentHintAnnotation(true),
		mcp.WithString("path", mcp.Required(), mcp.Description("目标文档的逻辑路径")),
		mcp.WithString("content", mcp.Required(), mcp.Description("完整新正文，允许空串")),
		mcp.WithString("scope", mcp.Description("仅接受 category；传入 public 会被拒绝")),
	), handleDocWrite)

	instance.AddTool(mcp.NewTool("doc_edit",
		mcp.WithDescription("在当前子项目下的文档正文中做精确文本替换，命中多处时默认拒绝。公共文档区只读。"),
		mcp.WithDestructiveHintAnnotation(false),
		mcp.WithString("path", mcp.Required(), mcp.Description("目标文档的逻辑路径")),
		mcp.WithString("old_string", mcp.Required(), mcp.Description("待替换的原文，不能为空")),
		mcp.WithString("new_string", mcp.Required(), mcp.Description("替换后的文本，允许空串以删除片段")),
		mcp.WithBoolean("replace_all", mcp.Description("是否替换全部匹配，默认 false 仅替换唯一匹配"), mcp.DefaultBool(false)),
		mcp.WithString("scope", mcp.Description("仅接受 category；传入 public 会被拒绝")),
	), handleDocEdit)

	instance.AddTool(mcp.NewTool("doc_delete",
		mcp.WithDescription("物理删除当前子项目下的指定文档，删除后不可恢复。公共文档区只读。"),
		mcp.WithDestructiveHintAnnotation(true),
		mcp.WithString("path", mcp.Required(), mcp.Description("目标文档的逻辑路径")),
		mcp.WithString("scope", mcp.Description("仅接受 category；传入 public 会被拒绝")),
	), handleDocDelete)

	return instance
}

// NewDocsMCPHandler wraps the streamable transport with the category guard so
// an unauthenticated request never reaches protocol handling.
func NewDocsMCPHandler(instance *mcpserver.MCPServer) http.Handler {
	streamable := mcpserver.NewStreamableHTTPServer(instance,
		mcpserver.WithEndpointPath("/mcp/docs"),
		mcpserver.WithSessionIdleTTL(30*time.Minute),
		mcpserver.WithDisableLocalhostProtection(true),
	)
	return docsBearerGuard(streamable)
}

func docsBearerGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
		if token == "" {
			unauthorized(w)
			return
		}
		identity, err := auth.VerifyDocAccessID(token)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if identity == nil {
			unauthorized(w)
			return
		}
		next.ServeHTTP(&streamResponseWriter{ResponseWriter: w},
			r.WithContext(withDocIdentity(r.Context(), identity)))
	})
}

// docsHandle returns the shared database handle and resolves the caller. A
// non-empty message is the tool-level failure to return.
func docsHandle(ctx context.Context) (*sql.DB, *auth.DocAccessIdentity, string) {
	identity := docIdentityFrom(ctx)
	if identity == nil {
		return nil, nil, "服务内部错误"
	}
	handle, err := db.Shared()
	if err != nil {
		return nil, nil, "服务内部错误"
	}
	return handle, identity, ""
}

func docDate(value any) string {
	text, _ := value.(string)
	if len(text) > 10 {
		return text[:10]
	}
	return text
}

// matchDocPath implements the glob contract: an empty pattern matches all, a
// pattern without wildcards is a case-insensitive substring, and a wildcard
// pattern uses path.Match so * never crosses a slash. A pattern without a slash
// also matches the base name, so "*.md" finds nested documents.
func matchDocPath(pattern, documentPath string) (bool, error) {
	if pattern == "" {
		return true, nil
	}
	lowerPattern := strings.ToLower(pattern)
	lowerPath := strings.ToLower(documentPath)
	if !strings.ContainsAny(pattern, "*?[") {
		return strings.Contains(lowerPath, lowerPattern), nil
	}
	if _, err := path.Match(lowerPattern, ""); err != nil {
		return false, err
	}
	if strings.Contains(pattern, "/") {
		return path.Match(lowerPattern, lowerPath)
	}
	if matched, _ := path.Match(lowerPattern, lowerPath); matched {
		return true, nil
	}
	return path.Match(lowerPattern, path.Base(lowerPath))
}

// docScopeIsValid accepts the three scope filters shared by glob and grep.
func docScopeIsValid(scope string) bool {
	return scope == "all" || scope == "category" || scope == "public"
}

func handleDocGlob(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	scope := request.GetString("scope", "all")
	if !docScopeIsValid(scope) {
		return toolError(fmt.Sprintf("scope 只接受 all / category / public，本次传入 %s", scope))
	}
	pattern := request.GetString("pattern", "")
	handle, identity, message := docsHandle(ctx)
	if message != "" {
		return toolError(message)
	}
	documents, err := dal.QueryDocuments(handle, dal.DocQuery{
		WorkspaceID: identity.WorkspaceID,
		ScopeFilter: scope,
		CategoryID:  identity.CategoryID,
	})
	if err != nil {
		return toolError("服务内部错误")
	}
	matched := []map[string]any{}
	for _, document := range documents {
		ok, err := matchDocPath(pattern, document["path"].(string))
		if err != nil {
			return toolError(fmt.Sprintf("通配模式非法：%s", pattern))
		}
		if ok {
			matched = append(matched, document)
		}
	}
	lines := []string{fmt.Sprintf(`# 文档匹配: "%s" | 范围: %s | 命中 %d 篇`, pattern, scope, len(matched))}
	for _, document := range matched {
		lines = append(lines, fmt.Sprintf("- [%v] %v | %v 字符 | 更新 %s",
			document["scope"], document["path"], document["char_count"], docDate(document["updated_at"])))
	}
	return toolText(strings.Join(lines, "\n"))
}

func handleDocGrep(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	pattern := request.GetString("pattern", "")
	if pattern == "" {
		return toolError("pattern 不能为空")
	}
	scope := request.GetString("scope", "all")
	if !docScopeIsValid(scope) {
		return toolError(fmt.Sprintf("scope 只接受 all / category / public，本次传入 %s", scope))
	}
	limit := request.GetInt("limit", GrepLimitDefault)
	if limit < 1 || limit > GrepLimitMax {
		return toolError(fmt.Sprintf("limit 取值范围为 1~%d，本次传入 %d", GrepLimitMax, limit))
	}
	var matcher *regexp.Regexp
	if request.GetBool("is_regex", false) {
		compiled, err := regexp.Compile(pattern)
		if err != nil {
			return toolError(fmt.Sprintf("正则表达式非法：%s", pattern))
		}
		matcher = compiled
	}
	handle, identity, message := docsHandle(ctx)
	if message != "" {
		return toolError(message)
	}
	documents, err := dal.QueryDocuments(handle, dal.DocQuery{
		WorkspaceID:    identity.WorkspaceID,
		ScopeFilter:    scope,
		CategoryID:     identity.CategoryID,
		ExactPath:      strings.TrimSpace(request.GetString("path", "")),
		IncludeContent: true,
	})
	if err != nil {
		return toolError("服务内部错误")
	}
	lines := []string{}
	truncated := false
	for _, document := range documents {
		content, _ := document["content"].(string)
		if content == "" {
			continue
		}
		rest := content
		lineNo := 1
		for {
			text, after, hasNewline := strings.Cut(rest, "\n")
			hit := strings.Contains(text, pattern)
			if matcher != nil {
				hit = matcher.MatchString(text)
			}
			if hit {
				if len(lines) >= limit {
					truncated = true
					break
				}
				lines = append(lines, fmt.Sprintf("[%v] %v:%d: %s",
					document["scope"], document["path"], lineNo, text))
			}
			if !hasNewline {
				break
			}
			rest = after
			lineNo++
		}
		if truncated {
			break
		}
	}
	header := fmt.Sprintf(`# 文档检索: "%s" | 范围: %s | 扫描 %d 篇 | 命中 %d 行`,
		pattern, scope, len(documents), len(lines))
	out := append([]string{header}, lines...)
	if truncated {
		out = append(out, fmt.Sprintf("> 已达 limit %d，结果被截断", limit))
	}
	return toolText(strings.Join(out, "\n"))
}

func handleDocRead(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	documentPath, message := dal.NormalizeDocPath(request.GetString("path", ""))
	if message != "" {
		return toolError(message)
	}
	scope := "category"
	if request.GetString("scope", "category") == "public" {
		scope = "public"
	}
	handle, identity, message := docsHandle(ctx)
	if message != "" {
		return toolError(message)
	}
	categoryID := ""
	if scope == "category" {
		categoryID = identity.CategoryID
	}
	document, err := dal.GetDocumentByPath(handle, identity.WorkspaceID, scope, categoryID, documentPath)
	if err != nil {
		return toolError("服务内部错误")
	}
	if document == nil {
		return toolError(fmt.Sprintf("[%s] 文档不存在：%s", scope, documentPath))
	}
	content, _ := document["content"].(string)
	header := fmt.Sprintf("===== [%s] %s | %d 字符 | 更新 %s =====",
		scope, documentPath, utf8.RuneCountInString(content), docDate(document["updated_at"]))
	total := strings.Count(content, "\n") + 1
	offset := request.GetInt("offset", 0)
	limit := request.GetInt("limit", 0)
	if offset == 0 && limit == 0 {
		body := content
		if body == "" {
			body = "（空文档）"
		}
		return toolText(strings.Join([]string{header, fmt.Sprintf("共 %d 行", total), "", body}, "\n"))
	}
	start := offset
	if start < 1 {
		start = 1
	}
	if start > total {
		return toolText(strings.Join([]string{header,
			fmt.Sprintf("共 %d 行，起始行 %d 已超出正文", total, start)}, "\n"))
	}
	end := total
	if limit > 0 && start+limit-1 < end {
		end = start + limit - 1
	}
	numbered := make([]string, 0, end-start+1)
	rest := content
	for lineNumber := 1; lineNumber <= end; lineNumber++ {
		lineText, after, hasNewline := strings.Cut(rest, "\n")
		if lineNumber >= start {
			numbered = append(numbered, fmt.Sprintf("%d: %s", lineNumber, lineText))
		}
		if !hasNewline {
			break
		}
		rest = after
	}
	return toolText(strings.Join(append([]string{header,
		fmt.Sprintf("第 %d~%d 行 / 共 %d 行", start, end, total)}, numbered...), "\n"))
}

func handleDocCreate(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if request.GetString("scope", "") == "public" {
		return toolError(publicReadOnlyMessage)
	}
	documentPath, message := dal.NormalizeDocPath(request.GetString("path", ""))
	if message != "" {
		return toolError(message)
	}
	handle, identity, message := docsHandle(ctx)
	if message != "" {
		return toolError(message)
	}
	_, status, err := dal.CreateDocument(handle, identity.WorkspaceID, "category",
		identity.CategoryID, documentPath, request.GetString("content", ""))
	if err != nil {
		return toolError("服务内部错误")
	}
	if status == "duplicate" {
		return toolError(fmt.Sprintf("文档已存在，拒绝覆盖：%s", documentPath))
	}
	return toolText(fmt.Sprintf("已新建文档：%s | 子项目 %s", documentPath, identity.CategoryName))
}

func handleDocWrite(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if request.GetString("scope", "") == "public" {
		return toolError(publicReadOnlyMessage)
	}
	documentPath, message := dal.NormalizeDocPath(request.GetString("path", ""))
	if message != "" {
		return toolError(message)
	}
	handle, identity, message := docsHandle(ctx)
	if message != "" {
		return toolError(message)
	}
	_, status, err := dal.OverwriteDocumentByPath(handle, identity.WorkspaceID,
		identity.CategoryID, documentPath, request.GetString("content", ""))
	if err != nil {
		return toolError("服务内部错误")
	}
	if status == "not_found" {
		return toolError(fmt.Sprintf("文档不存在，请先调用 doc_create：%s", documentPath))
	}
	return toolText(fmt.Sprintf("已覆盖文档：%s | 子项目 %s", documentPath, identity.CategoryName))
}

func handleDocEdit(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if request.GetString("scope", "") == "public" {
		return toolError(publicReadOnlyMessage)
	}
	documentPath, message := dal.NormalizeDocPath(request.GetString("path", ""))
	if message != "" {
		return toolError(message)
	}
	oldString := request.GetString("old_string", "")
	if oldString == "" {
		return toolError("old_string 不能为空")
	}
	newString := request.GetString("new_string", "")
	if oldString == newString {
		return toolError("old_string 与 new_string 相同，无需替换")
	}
	handle, identity, message := docsHandle(ctx)
	if message != "" {
		return toolError(message)
	}
	count, status, err := dal.EditDocumentByPath(handle, identity.WorkspaceID, identity.CategoryID,
		documentPath, oldString, newString, request.GetBool("replace_all", false))
	if err != nil {
		return toolError("服务内部错误")
	}
	switch status {
	case "not_found":
		return toolError(fmt.Sprintf("文档不存在：%s", documentPath))
	case "no_match":
		return toolError(fmt.Sprintf("未匹配到 old_string（0 处）：%s", documentPath))
	case "ambiguous":
		return toolError(fmt.Sprintf("old_string 匹配到 %d 处，未开启 replace_all 拒绝替换", count))
	}
	return toolText(fmt.Sprintf("已替换文档：%s | 替换 %d 处", documentPath, count))
}

func handleDocDelete(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	if request.GetString("scope", "") == "public" {
		return toolError(publicReadOnlyMessage)
	}
	documentPath, message := dal.NormalizeDocPath(request.GetString("path", ""))
	if message != "" {
		return toolError(message)
	}
	handle, identity, message := docsHandle(ctx)
	if message != "" {
		return toolError(message)
	}
	deleted, err := dal.DeleteDocumentByPath(handle, identity.WorkspaceID, identity.CategoryID, documentPath)
	if err != nil {
		return toolError("服务内部错误")
	}
	if !deleted {
		return toolError(fmt.Sprintf("文档不存在：%s", documentPath))
	}
	return toolText(fmt.Sprintf("已删除文档：%s | 子项目 %s", documentPath, identity.CategoryName))
}
