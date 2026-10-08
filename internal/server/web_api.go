package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"capsa/internal/auth"
	"capsa/internal/dal"
	"capsa/internal/db"
	"capsa/internal/ids"
	"capsa/internal/permissions"
	"capsa/internal/retrieval"
)

// Error codes carried in the unified envelope.
const (
	CodeUnauthorized    = "UNAUTHORIZED"
	CodeForbidden       = "FORBIDDEN"
	CodeNotFound        = "NOT_FOUND"
	CodeValidationError = "VALIDATION_ERROR"
	CodeInternalError   = "INTERNAL_ERROR"
)

// missingMessage is the fixed 404 text. It must be byte-identical for missing,
// deleted and unauthorized entries so the response is not a side channel.
const missingMessage = "记忆不存在或无权访问"

const (
	groupNameMax = 60
	groupDescMax = 200
	keyNameMax   = 60
)

// slugPattern requires an alphanumeric first character; the slug is the memory
// foreign key and is immutable after creation.
var slugPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$`)

type apiError struct {
	status  int
	code    string
	message string
}

func (e apiError) Error() string { return e.message }

type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type envelope struct {
	Success bool       `json:"success"`
	Data    any        `json:"data"`
	Error   *errorBody `json:"error"`
}

type apiHandler func(w http.ResponseWriter, r *http.Request) error

func (h apiHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if err := h(w, r); err != nil {
		if errors.Is(err, errPayloadTooLarge) {
			writePayloadTooLarge(w)
			return
		}
		if apiErr, ok := err.(apiError); ok {
			writeEnvelope(w, apiErr.status, envelope{Error: &errorBody{Code: apiErr.code, Message: apiErr.message}})
			return
		}
		log.Printf("Web API 未处理异常: %v", err)
		writeEnvelope(w, 500, envelope{Error: &errorBody{Code: CodeInternalError, Message: "服务内部错误"}})
	}
}

func ok(w http.ResponseWriter, data any) error {
	writeEnvelope(w, 200, envelope{Success: true, Data: data})
	return nil
}

func okStatus(w http.ResponseWriter, data any, status int) error {
	writeEnvelope(w, status, envelope{Success: true, Data: data})
	return nil
}

func fail(code, message string, status int) error {
	return apiError{status: status, code: code, message: message}
}

func validation(message string) error {
	return apiError{status: 422, code: CodeValidationError, message: message}
}

func writeEnvelope(w http.ResponseWriter, status int, body envelope) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// AdminGuard rejects unauthenticated requests with a 401 envelope and
// non-admin credentials with a 403 envelope before any handler runs.
func AdminGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
		if token == "" {
			writeEnvelope(w, 401, envelope{Error: &errorBody{Code: CodeUnauthorized, Message: "缺少或无效的 Bearer 令牌"}})
			return
		}
		access, err := auth.VerifyToken(token)
		if err != nil {
			writeEnvelope(w, 500, envelope{Error: &errorBody{Code: CodeInternalError, Message: "服务内部错误"}})
			return
		}
		if access == nil {
			writeEnvelope(w, 401, envelope{Error: &errorBody{Code: CodeUnauthorized, Message: "缺少或无效的 Bearer 令牌"}})
			return
		}
		if access.Grants["*"] != "rw" {
			writeEnvelope(w, 403, envelope{Error: &errorBody{Code: CodeForbidden, Message: "Web 管理台仅支持管理员凭据访问"}})
			return
		}
		next.ServeHTTP(w, r.WithContext(withAccessToken(r.Context(), access)))
	})
}

// NewWebHandler builds the /api mux (patterns include the /api prefix).
func NewWebHandler() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /api/auth/me", apiHandler(authMe))
	mux.Handle("GET /api/groups", apiHandler(listGroups))
	mux.Handle("POST /api/groups", apiHandler(groupCreate))
	mux.Handle("PUT /api/groups/{slug}", apiHandler(groupUpdate))
	mux.Handle("DELETE /api/groups/{slug}", apiHandler(groupDelete))
	mux.Handle("GET /api/memories", apiHandler(memoriesList))
	mux.Handle("POST /api/memories", apiHandler(memoryCreate))
	mux.Handle("GET /api/memories/{id}", apiHandler(memoryDetail))
	mux.Handle("PUT /api/memories/{id}", apiHandler(memoryUpdate))
	mux.Handle("DELETE /api/memories/{id}", apiHandler(memoryDelete))
	mux.Handle("POST /api/memories/{id}/restore", apiHandler(memoryRestore))
	mux.Handle("GET /api/keys", apiHandler(keyList))
	mux.Handle("POST /api/keys", apiHandler(keyCreate))
	mux.Handle("POST /api/keys/{id}/revoke", apiHandler(keyRevoke))
	mux.Handle("DELETE /api/keys/{id}", apiHandler(keyDelete))
	return mux
}

func grantsOf(r *http.Request) map[string]string {
	if token := AccessTokenFrom(r.Context()); token != nil {
		return token.Grants
	}
	return map[string]string{}
}

func listItem(row map[string]any, grants map[string]string) map[string]any {
	item := map[string]any{}
	for _, field := range dal.WebListFields {
		item[field] = row[field]
	}
	item["tags"] = decodeTags(item["tags"])
	item["permission"] = permissions.PermissionFor(grants, row["group_slug"].(string))
	item["is_overdue"] = retrieval.IsExpired(reviewAtOf(row), nowUTC())
	return item
}

func detailItem(row map[string]any, grants map[string]string) map[string]any {
	item := map[string]any{}
	for _, field := range dal.WebItemFields {
		item[field] = row[field]
	}
	item["tags"] = decodeTags(item["tags"])
	item["permission"] = permissions.PermissionFor(grants, row["group_slug"].(string))
	item["is_overdue"] = retrieval.IsExpired(reviewAtOf(row), nowUTC())
	return item
}

func decodeTags(raw any) []string {
	text, _ := raw.(string)
	out := []string{}
	if text == "" {
		return out
	}
	_ = json.Unmarshal([]byte(text), &out)
	return out
}

func reviewAtOf(row map[string]any) *string {
	if text, ok := row["review_at"].(string); ok {
		return &text
	}
	return nil
}

func boundedInt(r *http.Request, name string, fallback, minimum, maximum int) (int, error) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return 0, validation(fmt.Sprintf("%s 必须是整数", name))
	}
	if value < minimum || (maximum >= 0 && value > maximum) {
		ceiling := "无上限"
		if maximum >= 0 {
			ceiling = strconv.Itoa(maximum)
		}
		return 0, validation(fmt.Sprintf("%s 取值范围为 %d~%s，本次传入 %d", name, minimum, ceiling, value))
	}
	return value, nil
}

func jsonBody(r *http.Request) (map[string]any, error) {
	var payload map[string]any
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(&payload); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return nil, errPayloadTooLarge
		}
		return nil, validation("请求体不是合法的 JSON")
	}
	if payload == nil {
		return nil, validation("请求体必须是 JSON 对象")
	}
	return payload, nil
}

func reviewAtValue(value any) (*string, error) {
	if value == nil {
		return nil, nil
	}
	text, ok := value.(string)
	if !ok {
		return nil, validation(fmt.Sprintf("review_at 不是合法的 ISO 8601 时间：%v", value))
	}
	normalized, err := retrieval.NormalizeReviewAt(text)
	if err != nil {
		return nil, validation(fmt.Sprintf("review_at 不是合法的 ISO 8601 时间：%s", text))
	}
	return &normalized, nil
}

func tagsValue(value any) ([]string, error) {
	if value == nil {
		return []string{}, nil
	}
	list, ok := value.([]any)
	if !ok {
		return nil, validation("tags 必须是字符串数组")
	}
	out := make([]string, 0, len(list))
	for _, item := range list {
		text, ok := item.(string)
		if !ok {
			return nil, validation("tags 必须是字符串数组")
		}
		out = append(out, text)
	}
	return out, nil
}

func groupDescription(value any) (string, error) {
	if value == nil {
		return "", nil
	}
	text, ok := value.(string)
	if !ok {
		return "", validation("分类描述必须是字符串")
	}
	if utf8.RuneCountInString(text) > groupDescMax {
		return "", validation(fmt.Sprintf("分类描述超长 (当前 %d 字符，上限 %d 字符)", utf8.RuneCountInString(text), groupDescMax))
	}
	return text, nil
}

func toInt(value any) (int, bool) {
	switch typed := value.(type) {
	case bool:
		if typed {
			return 1, true
		}
		return 0, true
	case float64:
		return int(typed), true
	case int:
		return typed, true
	case int64:
		return int(typed), true
	default:
		return 0, false
	}
}

func authMe(w http.ResponseWriter, r *http.Request) error {
	token := AccessTokenFrom(r.Context())
	keyID := ""
	if token != nil {
		keyID = token.KeyID
	}
	handle, err := db.Connect()
	if err != nil {
		return err
	}
	defer handle.Close()
	key, err := dal.GetKey(handle, keyID)
	if err != nil {
		return err
	}
	if key == nil {
		return fail(CodeUnauthorized, "凭据无效或已被吊销", 401)
	}
	return ok(w, map[string]any{"key_id": key["id"], "name": key["name"], "scopes": key["scopes"]})
}

func withDB(fn func(handle *sql.DB) error) error {
	handle, err := db.Connect()
	if err != nil {
		return err
	}
	defer handle.Close()
	return fn(handle)
}

func listGroups(w http.ResponseWriter, r *http.Request) error {
	var items []map[string]any
	if err := withDB(func(handle *sql.DB) error {
		var err error
		items, err = dal.ListGroupsWithCounts(handle, grantsOf(r))
		return err
	}); err != nil {
		return err
	}
	return ok(w, map[string]any{"items": items, "total": len(items), "offset": 0, "limit": len(items)})
}

func groupCreate(w http.ResponseWriter, r *http.Request) error {
	payload, err := jsonBody(r)
	if err != nil {
		return err
	}
	slug, _ := payload["slug"].(string)
	if !slugPattern.MatchString(slug) {
		return validation("slug 只能使用字母、数字、下划线与连字符，长度 1~32 且首字符不能是连字符")
	}
	name, message := requireText(stringValue(payload["name"]), groupNameMax, "分类名称")
	if message != "" {
		return validation(message)
	}
	description, err := groupDescription(payload["description"])
	if err != nil {
		return err
	}
	var created map[string]any
	if err := withDB(func(handle *sql.DB) error {
		inserted, err := dal.AddGroup(handle, slug, name, description)
		if err != nil {
			return err
		}
		if !inserted {
			return validation(fmt.Sprintf("分组 %s 已存在", slug))
		}
		groups, err := dal.ListGroupsWithCounts(handle, map[string]string{slug: "rw"})
		if err != nil || len(groups) == 0 {
			return err
		}
		created = groups[0]
		return nil
	}); err != nil {
		return err
	}
	return ok(w, created)
}

func groupUpdate(w http.ResponseWriter, r *http.Request) error {
	slug := r.PathValue("slug")
	payload, err := jsonBody(r)
	if err != nil {
		return err
	}
	name := payload["name"]
	description := payload["description"]
	if name == nil && description == nil {
		return validation("至少提供一个待更新字段")
	}
	var updated map[string]any
	if err := withDB(func(handle *sql.DB) error {
		group, err := dal.GetGroup(handle, slug)
		if err != nil {
			return err
		}
		if group == nil {
			return fail(CodeNotFound, fmt.Sprintf("分组 %s 不存在", slug), 404)
		}
		nextName := group["name"].(string)
		nextDescription := group["description"].(string)
		if name != nil {
			value, message := requireText(stringValue(name), groupNameMax, "分类名称")
			if message != "" {
				return validation(message)
			}
			nextName = value
		}
		if description != nil {
			value, err := groupDescription(description)
			if err != nil {
				return err
			}
			nextDescription = value
		}
		if _, err := dal.UpdateGroup(handle, slug, nextName, nextDescription); err != nil {
			return err
		}
		groups, err := dal.ListGroupsWithCounts(handle, map[string]string{slug: "rw"})
		if err != nil || len(groups) == 0 {
			return err
		}
		updated = groups[0]
		return nil
	}); err != nil {
		return err
	}
	return ok(w, updated)
}

func groupDelete(w http.ResponseWriter, r *http.Request) error {
	slug := r.PathValue("slug")
	var status string
	if err := withDB(func(handle *sql.DB) error {
		var err error
		status, err = dal.DeleteEmptyGroup(handle, slug)
		return err
	}); err != nil {
		return err
	}
	switch status {
	case "not_found":
		return fail(CodeNotFound, fmt.Sprintf("分组 %s 不存在", slug), 404)
	case "has_memories":
		return validation(fmt.Sprintf("分类 %s 下仍有记忆（含回收站），禁止删除", slug))
	}
	return ok(w, map[string]any{"slug": slug, "action": "deleted"})
}

func memoriesList(w http.ResponseWriter, r *http.Request) error {
	query := r.URL.Query()
	status := "active"
	if query.Has("status") {
		status = query.Get("status")
	}
	if status != "active" && status != "overdue" && status != "deleted" {
		return validation(fmt.Sprintf("status 只接受 active / overdue / deleted，本次传入 %s", status))
	}
	limit, err := boundedInt(r, "limit", 20, 1, 100)
	if err != nil {
		return err
	}
	offset, err := boundedInt(r, "offset", 0, 0, -1)
	if err != nil {
		return err
	}
	group := query.Get("group")
	keyword := strings.TrimSpace(query.Get("query"))
	if keyword != "" && status != "active" {
		return validation("关键词检索只作用于活跃条目，status 需为 active")
	}
	grants := grantsOf(r)
	var rows []map[string]any
	var total int
	if err := withDB(func(handle *sql.DB) error {
		if keyword != "" {
			candidates, err := dal.ListActiveMemoriesForSearch(handle, grants, group, false)
			if err != nil {
				return err
			}
			ranked := retrieval.RankMemories(candidates, keyword, nowUTC(), false)
			total = len(ranked)
			start := offset
			if start > len(ranked) {
				start = len(ranked)
			}
			end := start + limit
			if end > len(ranked) {
				end = len(ranked)
			}
			rows = ranked[start:end]
			return nil
		}
		var err error
		rows, total, err = dal.ListMemoriesForWeb(handle, grants, status, group, offset, limit)
		return err
	}); err != nil {
		return err
	}
	items := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		items = append(items, listItem(row, grants))
	}
	return ok(w, map[string]any{"items": items, "total": total, "offset": offset, "limit": limit})
}

func memoryDetail(w http.ResponseWriter, r *http.Request) error {
	memoryID := r.PathValue("id")
	grants := grantsOf(r)
	var row map[string]any
	if err := withDB(func(handle *sql.DB) error {
		var err error
		row, err = dal.GetMemoryForWeb(handle, memoryID)
		return err
	}); err != nil {
		return err
	}
	if row == nil || row["deleted_at"] != nil || permissions.PermissionFor(grants, row["group_slug"].(string)) == "" {
		return fail(CodeNotFound, missingMessage, 404)
	}
	return ok(w, detailItem(row, grants))
}

func memoryCreate(w http.ResponseWriter, r *http.Request) error {
	payload, err := jsonBody(r)
	if err != nil {
		return err
	}
	group, _ := payload["group"].(string)
	if group == "" {
		return validation("group 不能为空")
	}
	if permissions.PermissionFor(grantsOf(r), group) != "rw" {
		return fail(CodeForbidden, fmt.Sprintf("对分组 %s 没有写权限，拒绝写入", group), 403)
	}
	title, message := requireText(stringValue(payload["title"]), TitleMax, "标题")
	if message != "" {
		return validation(message)
	}
	summary, message := requireText(stringValue(payload["summary"]), SummaryMax, "摘要")
	if message != "" {
		return validation(message)
	}
	body, message := requireText(stringValue(payload["body"]), BodyMax, "正文")
	if message != "" {
		return validation(message)
	}
	tags, err := tagsValue(payload["tags"])
	if err != nil {
		return err
	}
	stamp, err := reviewAtValue(payload["review_at"])
	if err != nil {
		return err
	}
	var memoryID string
	var similar []map[string]any
	if err := withDB(func(handle *sql.DB) error {
		candidates, err := dal.ListActiveMemoriesForSearch(handle, map[string]string{group: "rw"}, group, false)
		if err != nil {
			return err
		}
		similar = retrieval.FindSimilarMemories(candidates, title, retrieval.SimilarityThreshold)
		memoryID, err = dal.InsertMemory(handle, group, title, summary, body, tags, stamp, nil)
		if err != nil {
			return validation(fmt.Sprintf("分组 %s 不存在，拒绝写入", group))
		}
		return nil
	}); err != nil {
		return err
	}
	items := make([]map[string]any, 0, len(similar))
	for _, item := range similar {
		items = append(items, map[string]any{"id": item["id"], "title": item["title"], "similarity": item["similarity"]})
	}
	return ok(w, map[string]any{"id": memoryID, "similar_items": items})
}

// locateWritableWeb resolves the target and its write permission; a non-nil
// result is the refusal to return.
func locateWritableWeb(handle *sql.DB, memoryID string, grants map[string]string) error {
	results, err := dal.GetMemoriesBatchForAccess(handle, []string{memoryID}, grants)
	if err != nil {
		return err
	}
	if len(results) == 0 || results[0]["status"] != "authorized" {
		return fail(CodeNotFound, missingMessage, 404)
	}
	group := results[0]["group_slug"].(string)
	if permissions.PermissionFor(grants, group) != "rw" {
		return fail(CodeForbidden, fmt.Sprintf("对分组 %s 只有只读权限，拒绝修改", group), 403)
	}
	return nil
}

func memoryUpdate(w http.ResponseWriter, r *http.Request) error {
	memoryID := r.PathValue("id")
	payload, err := jsonBody(r)
	if err != nil {
		return err
	}
	clearReview, _ := payload["clear_review_at"].(bool)
	if clearReview && payload["review_at"] != nil {
		return validation("clear_review_at 与 review_at 不能同时给出")
	}
	grants := grantsOf(r)
	return withDB(func(handle *sql.DB) error {
		if refusal := locateWritableWeb(handle, memoryID, grants); refusal != nil {
			return refusal
		}
		fields := map[string]any{}
		if payload["title"] != nil {
			value, message := requireText(stringValue(payload["title"]), TitleMax, "标题")
			if message != "" {
				return validation(message)
			}
			fields["title"] = value
		}
		if payload["summary"] != nil {
			value, message := requireText(stringValue(payload["summary"]), SummaryMax, "摘要")
			if message != "" {
				return validation(message)
			}
			fields["summary"] = value
		}
		if payload["body"] != nil {
			value, message := requireText(stringValue(payload["body"]), BodyMax, "正文")
			if message != "" {
				return validation(message)
			}
			fields["body"] = value
		}
		if payload["tags"] != nil {
			value, err := tagsValue(payload["tags"])
			if err != nil {
				return err
			}
			fields["tags"] = value
		}
		if payload["pinned"] != nil {
			value, valid := toInt(payload["pinned"])
			if !valid {
				return validation("pinned 必须是布尔或整数")
			}
			fields["pinned"] = value
		}
		if clearReview {
			fields["review_at"] = nil
		} else if payload["review_at"] != nil {
			value, err := reviewAtValue(payload["review_at"])
			if err != nil {
				return err
			}
			fields["review_at"] = *value
		}
		if len(fields) == 0 {
			return validation("至少提供一个待更新字段")
		}
		updated, err := dal.UpdateMemory(handle, memoryID, fields)
		if err != nil {
			return err
		}
		if !updated {
			return fail(CodeNotFound, missingMessage, 404)
		}
		return ok(w, map[string]any{"id": memoryID, "action": "updated"})
	})
}

func memoryDelete(w http.ResponseWriter, r *http.Request) error {
	memoryID := r.PathValue("id")
	payload, err := jsonBody(r)
	if err != nil {
		return err
	}
	grants := grantsOf(r)
	return withDB(func(handle *sql.DB) error {
		if refusal := locateWritableWeb(handle, memoryID, grants); refusal != nil {
			return refusal
		}
		reason, _ := payload["reason"].(string)
		if strings.TrimSpace(reason) == "" {
			return validation("删除原因不能为空")
		}
		deleted, err := dal.SoftDeleteMemory(handle, memoryID, strings.TrimSpace(reason))
		if err != nil {
			return err
		}
		if !deleted {
			return fail(CodeNotFound, missingMessage, 404)
		}
		return ok(w, map[string]any{"id": memoryID, "action": "deleted"})
	})
}

func memoryRestore(w http.ResponseWriter, r *http.Request) error {
	memoryID := r.PathValue("id")
	grants := grantsOf(r)
	return withDB(func(handle *sql.DB) error {
		row, err := dal.GetMemoryForWeb(handle, memoryID)
		if err != nil {
			return err
		}
		if row == nil || permissions.PermissionFor(grants, row["group_slug"].(string)) == "" {
			return fail(CodeNotFound, missingMessage, 404)
		}
		group := row["group_slug"].(string)
		if permissions.PermissionFor(grants, group) != "rw" {
			return fail(CodeForbidden, fmt.Sprintf("对分组 %s 只有只读权限，拒绝修改", group), 403)
		}
		if row["deleted_at"] == nil {
			return fail(CodeNotFound, missingMessage, 404)
		}
		if _, err := dal.RestoreMemory(handle, memoryID); err != nil {
			return err
		}
		return ok(w, map[string]any{"id": memoryID, "action": "restored"})
	})
}

func checkKeyGuard(r *http.Request, targetID string) error {
	token := AccessTokenFrom(r.Context())
	currentID := ""
	if token != nil {
		currentID = token.KeyID
	}
	if currentID == targetID {
		return validation("禁止对当前正在使用的管理凭据执行吊销或删除操作")
	}
	if targetID == permissions.AdminKeyID {
		return validation("环境变量管理员凭据不受管理接口支持，请通过环境变量变更或重启服务完成轮换")
	}
	return nil
}

func keyList(w http.ResponseWriter, r *http.Request) error {
	var items []map[string]any
	if err := withDB(func(handle *sql.DB) error {
		var err error
		items, err = dal.ListKeys(handle)
		return err
	}); err != nil {
		return err
	}
	return ok(w, map[string]any{"items": items, "total": len(items), "offset": 0, "limit": len(items)})
}

func keyCreate(w http.ResponseWriter, r *http.Request) error {
	payload, err := jsonBody(r)
	if err != nil {
		return err
	}
	name, message := requireText(stringValue(payload["name"]), keyNameMax, "Key 名称")
	if message != "" {
		return validation(message)
	}
	rawScopes, ok := payload["scopes"].(map[string]any)
	if !ok || len(rawScopes) == 0 {
		return validation("scopes 必须是非空字典")
	}
	scopes := map[string]string{}
	var keyID, plain string
	if err := withDB(func(handle *sql.DB) error {
		groups, err := dal.ListGroups(handle)
		if err != nil {
			return err
		}
		existing := map[string]bool{}
		for _, group := range groups {
			existing[group["slug"].(string)] = true
		}
		for slug, raw := range rawScopes {
			if slug != "*" && !existing[slug] {
				return validation(fmt.Sprintf("分组 %s 不存在", slug))
			}
			permission, _ := raw.(string)
			if permission != "r" && permission != "rw" {
				return validation(fmt.Sprintf("权限值必须是 r 或 rw，本次传入 %v", raw))
			}
			scopes[slug] = permission
		}
		keyID, plain = auth.IssueKey()
		if err := dal.CreateKey(handle, keyID, name, ids.HashToken(plain), scopes); err != nil {
			return err
		}
		return nil
	}); err != nil {
		return err
	}
	return okStatus(w, map[string]any{
		"id": keyID, "name": name, "token": plain, "scopes": scopes, "created_at": db.UtcNow(),
	}, 201)
}

func keyRevoke(w http.ResponseWriter, r *http.Request) error {
	targetID := r.PathValue("id")
	if err := checkKeyGuard(r, targetID); err != nil {
		return err
	}
	var status string
	if err := withDB(func(handle *sql.DB) error {
		var err error
		status, err = dal.RevokeKey(handle, targetID)
		return err
	}); err != nil {
		return err
	}
	switch status {
	case "not_found":
		return fail(CodeNotFound, fmt.Sprintf("Key %s 不存在", targetID), 404)
	case "already_revoked":
		return validation(fmt.Sprintf("Key %s 已经处于吊销状态", targetID))
	}
	return ok(w, map[string]any{"id": targetID, "action": "revoked"})
}

func keyDelete(w http.ResponseWriter, r *http.Request) error {
	targetID := r.PathValue("id")
	if err := checkKeyGuard(r, targetID); err != nil {
		return err
	}
	var status string
	if err := withDB(func(handle *sql.DB) error {
		var err error
		status, err = dal.DeleteRevokedKey(handle, targetID)
		return err
	}); err != nil {
		return err
	}
	switch status {
	case "not_found":
		return fail(CodeNotFound, fmt.Sprintf("Key %s 不存在", targetID), 404)
	case "still_active":
		return validation(fmt.Sprintf("Key %s 仍处于有效状态，请先吊销后再删除", targetID))
	}
	return ok(w, map[string]any{"id": targetID, "action": "deleted"})
}

func stringValue(value any) string {
	text, _ := value.(string)
	return text
}
