package server

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"capsa/internal/dal"
)

// Field caps shared by the workspace and document console APIs.
const (
	workspaceNameMax = 60
	workspaceDescMax = 200
	categoryNameMax  = 60
	categoryDescMax  = 200
)

// registerWorkspaceRoutes mounts the workspace and document console endpoints on
// the /api mux. They sit behind the same AdminGuard as every other /api route.
func registerWorkspaceRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/workspaces", apiHandler(workspaceList))
	mux.Handle("POST /api/workspaces", apiHandler(workspaceCreate))
	mux.Handle("PUT /api/workspaces/{id}", apiHandler(workspaceUpdate))
	mux.Handle("DELETE /api/workspaces/{id}", apiHandler(workspaceDelete))

	mux.Handle("GET /api/workspaces/{ws_id}/categories", apiHandler(docCategoryList))
	mux.Handle("POST /api/workspaces/{ws_id}/categories", apiHandler(docCategoryCreate))
	mux.Handle("PUT /api/workspaces/{ws_id}/categories/{cat_id}", apiHandler(docCategoryUpdate))
	mux.Handle("DELETE /api/workspaces/{ws_id}/categories/{cat_id}", apiHandler(docCategoryDelete))
	mux.Handle("POST /api/workspaces/{ws_id}/categories/{cat_id}/rotate-token", apiHandler(docCategoryRotate))

	mux.Handle("GET /api/workspaces/{ws_id}/docs", apiHandler(docList))
	mux.Handle("POST /api/workspaces/{ws_id}/docs", apiHandler(docCreate))
	mux.Handle("GET /api/workspaces/{ws_id}/docs/{doc_id}", apiHandler(docDetail))
	mux.Handle("PUT /api/workspaces/{ws_id}/docs/{doc_id}", apiHandler(docUpdate))
	mux.Handle("DELETE /api/workspaces/{ws_id}/docs/{doc_id}", apiHandler(docDelete))
}

// requireWorkspaceMode resolves a workspace and enforces its mode: a missing
// workspace answers 404, the other mode answers 422. Cross-workspace requests
// therefore never reach a document query.
func requireWorkspaceMode(handle *sql.DB, workspaceID, mode string) error {
	workspace, err := dal.GetWorkspace(handle, workspaceID)
	if err != nil {
		return err
	}
	if workspace == nil {
		return fail(CodeNotFound, fmt.Sprintf("工作区 %s 不存在", workspaceID), 404)
	}
	if workspace["mode"] != mode {
		label := "记忆"
		if mode == "docs" {
			label = "文档"
		}
		return validation(fmt.Sprintf("工作区 %s 不是%s工作区", workspaceID, label))
	}
	return nil
}

// optionalDescription validates a free-text field whose presence the caller
// already established. A non-string value (null included) is a validation
// error rather than a silent clear, matching the group description contract.
func optionalDescription(value any, label string, limit int) (string, error) {
	text, ok := value.(string)
	if !ok {
		return "", validation(label + "必须是字符串")
	}
	if utf8.RuneCountInString(text) > limit {
		return "", validation(fmt.Sprintf("%s超长 (当前 %d 字符，上限 %d 字符)",
			label, utf8.RuneCountInString(text), limit))
	}
	return text, nil
}

func workspaceList(w http.ResponseWriter, r *http.Request) error {
	var items []map[string]any
	if err := withDB(func(handle *sql.DB) error {
		var err error
		items, err = dal.ListWorkspaces(handle)
		return err
	}); err != nil {
		return err
	}
	return ok(w, map[string]any{"items": items, "total": len(items), "offset": 0, "limit": len(items)})
}

func workspaceCreate(w http.ResponseWriter, r *http.Request) error {
	payload, err := jsonBody(r)
	if err != nil {
		return err
	}
	name, message := requireText(stringValue(payload["name"]), workspaceNameMax, "工作区名称")
	if message != "" {
		return validation(message)
	}
	description := ""
	if raw, present := payload["description"]; present {
		value, err := optionalDescription(raw, "工作区描述", workspaceDescMax)
		if err != nil {
			return err
		}
		description = value
	}
	mode := stringValue(payload["mode"])
	if mode != "memory" && mode != "docs" {
		return validation("mode 必须是 memory 或 docs")
	}
	var created map[string]any
	if err := withDB(func(handle *sql.DB) error {
		var err error
		created, err = dal.CreateWorkspace(handle, name, description, mode)
		return err
	}); err != nil {
		return err
	}
	return okStatus(w, created, 201)
}

func workspaceUpdate(w http.ResponseWriter, r *http.Request) error {
	workspaceID := r.PathValue("id")
	payload, err := jsonBody(r)
	if err != nil {
		return err
	}
	// 模式创建后固定：只要请求体带 mode 键，无论值与现值是否相同一律拒绝。
	if _, present := payload["mode"]; present {
		return validation("工作区模式创建后不可修改")
	}
	_, hasName := payload["name"]
	_, hasDescription := payload["description"]
	if !hasName && !hasDescription {
		return validation("至少提供一个待更新字段")
	}
	var updated map[string]any
	if err := withDB(func(handle *sql.DB) error {
		workspace, err := dal.GetWorkspace(handle, workspaceID)
		if err != nil {
			return err
		}
		if workspace == nil {
			return fail(CodeNotFound, fmt.Sprintf("工作区 %s 不存在", workspaceID), 404)
		}
		nextName := workspace["name"].(string)
		nextDescription := workspace["description"].(string)
		if hasName {
			value, message := requireText(stringValue(payload["name"]), workspaceNameMax, "工作区名称")
			if message != "" {
				return validation(message)
			}
			nextName = value
		}
		if hasDescription {
			value, err := optionalDescription(payload["description"], "工作区描述", workspaceDescMax)
			if err != nil {
				return err
			}
			nextDescription = value
		}
		if _, err := dal.UpdateWorkspace(handle, workspaceID, nextName, nextDescription); err != nil {
			return err
		}
		updated, err = dal.GetWorkspace(handle, workspaceID)
		return err
	}); err != nil {
		return err
	}
	return ok(w, updated)
}

func workspaceDelete(w http.ResponseWriter, r *http.Request) error {
	workspaceID := r.PathValue("id")
	var status string
	if err := withDB(func(handle *sql.DB) error {
		var err error
		status, err = dal.DeleteEmptyWorkspace(handle, workspaceID)
		return err
	}); err != nil {
		return err
	}
	switch status {
	case "is_default":
		return validation("默认工作区不可删除")
	case "not_empty":
		return validation("工作区下仍有内容，禁止删除")
	case "not_found":
		return fail(CodeNotFound, fmt.Sprintf("工作区 %s 不存在", workspaceID), 404)
	}
	return ok(w, map[string]any{"id": workspaceID, "action": "deleted"})
}

func docCategoryList(w http.ResponseWriter, r *http.Request) error {
	workspaceID := r.PathValue("ws_id")
	var items []map[string]any
	if err := withDB(func(handle *sql.DB) error {
		if refusal := requireWorkspaceMode(handle, workspaceID, "docs"); refusal != nil {
			return refusal
		}
		var err error
		items, err = dal.ListDocCategories(handle, workspaceID)
		return err
	}); err != nil {
		return err
	}
	return ok(w, map[string]any{"items": items, "total": len(items), "offset": 0, "limit": len(items)})
}

func docCategoryCreate(w http.ResponseWriter, r *http.Request) error {
	workspaceID := r.PathValue("ws_id")
	payload, err := jsonBody(r)
	if err != nil {
		return err
	}
	name, message := requireText(stringValue(payload["name"]), categoryNameMax, "子项目名称")
	if message != "" {
		return validation(message)
	}
	description := ""
	if raw, present := payload["description"]; present {
		value, err := optionalDescription(raw, "子项目描述", categoryDescMax)
		if err != nil {
			return err
		}
		description = value
	}
	var created map[string]any
	if err := withDB(func(handle *sql.DB) error {
		if refusal := requireWorkspaceMode(handle, workspaceID, "docs"); refusal != nil {
			return refusal
		}
		var err error
		created, err = dal.CreateDocCategory(handle, workspaceID, name, description)
		var duplicate dal.DuplicateDocNameError
		if errors.As(err, &duplicate) {
			return validation(fmt.Sprintf("子项目名称 %s 已存在", duplicate.Name))
		}
		return err
	}); err != nil {
		return err
	}
	return okStatus(w, created, 201)
}

func docCategoryUpdate(w http.ResponseWriter, r *http.Request) error {
	workspaceID := r.PathValue("ws_id")
	categoryID := r.PathValue("cat_id")
	payload, err := jsonBody(r)
	if err != nil {
		return err
	}
	_, hasName := payload["name"]
	_, hasDescription := payload["description"]
	if !hasName && !hasDescription {
		return validation("至少提供一个待更新字段")
	}
	var updated map[string]any
	if err := withDB(func(handle *sql.DB) error {
		if refusal := requireWorkspaceMode(handle, workspaceID, "docs"); refusal != nil {
			return refusal
		}
		category, err := dal.GetDocCategory(handle, workspaceID, categoryID)
		if err != nil {
			return err
		}
		if category == nil {
			return fail(CodeNotFound, fmt.Sprintf("子项目 %s 不存在", categoryID), 404)
		}
		nextName := category["name"].(string)
		nextDescription := category["description"].(string)
		if hasName {
			value, message := requireText(stringValue(payload["name"]), categoryNameMax, "子项目名称")
			if message != "" {
				return validation(message)
			}
			nextName = value
		}
		if hasDescription {
			value, err := optionalDescription(payload["description"], "子项目描述", categoryDescMax)
			if err != nil {
				return err
			}
			nextDescription = value
		}
		status, err := dal.UpdateDocCategory(handle, workspaceID, categoryID, nextName, nextDescription)
		if err != nil {
			return err
		}
		switch status {
		case "duplicate_name":
			return validation(fmt.Sprintf("子项目名称 %s 已存在", nextName))
		case "not_found":
			return fail(CodeNotFound, fmt.Sprintf("子项目 %s 不存在", categoryID), 404)
		}
		updated, err = dal.GetDocCategory(handle, workspaceID, categoryID)
		return err
	}); err != nil {
		return err
	}
	return ok(w, updated)
}

func docCategoryDelete(w http.ResponseWriter, r *http.Request) error {
	workspaceID := r.PathValue("ws_id")
	categoryID := r.PathValue("cat_id")
	var status string
	if err := withDB(func(handle *sql.DB) error {
		if refusal := requireWorkspaceMode(handle, workspaceID, "docs"); refusal != nil {
			return refusal
		}
		var err error
		status, err = dal.DeleteEmptyDocCategory(handle, workspaceID, categoryID)
		return err
	}); err != nil {
		return err
	}
	switch status {
	case "not_found":
		return fail(CodeNotFound, fmt.Sprintf("子项目 %s 不存在", categoryID), 404)
	case "has_documents":
		return validation("子项目下仍有文档，禁止删除")
	}
	return ok(w, map[string]any{"id": categoryID, "action": "deleted"})
}

func docCategoryRotate(w http.ResponseWriter, r *http.Request) error {
	workspaceID := r.PathValue("ws_id")
	categoryID := r.PathValue("cat_id")
	var category map[string]any
	if err := withDB(func(handle *sql.DB) error {
		if refusal := requireWorkspaceMode(handle, workspaceID, "docs"); refusal != nil {
			return refusal
		}
		var err error
		category, err = dal.RotateDocCategoryAccessID(handle, workspaceID, categoryID)
		return err
	}); err != nil {
		return err
	}
	if category == nil {
		return fail(CodeNotFound, fmt.Sprintf("子项目 %s 不存在", categoryID), 404)
	}
	return ok(w, category)
}

// docScopeInput validates the shared scope/category_id pair and confirms that
// the category belongs to this workspace.
func docScopeInput(handle *sql.DB, workspaceID, scope, categoryID string) error {
	if scope != "public" && scope != "category" {
		return validation("scope 只接受 public 或 category")
	}
	if scope == "public" {
		return nil
	}
	if categoryID == "" {
		return validation("scope 为 category 时 category_id 不能为空")
	}
	category, err := dal.GetDocCategory(handle, workspaceID, categoryID)
	if err != nil {
		return err
	}
	if category == nil {
		return fail(CodeNotFound, fmt.Sprintf("子项目 %s 不存在", categoryID), 404)
	}
	return nil
}

func docList(w http.ResponseWriter, r *http.Request) error {
	workspaceID := r.PathValue("ws_id")
	query := r.URL.Query()
	scope := query.Get("scope")
	categoryID := query.Get("category_id")
	pathQuery := strings.TrimSpace(query.Get("query"))
	var items []map[string]any
	if err := withDB(func(handle *sql.DB) error {
		if refusal := requireWorkspaceMode(handle, workspaceID, "docs"); refusal != nil {
			return refusal
		}
		if refusal := docScopeInput(handle, workspaceID, scope, categoryID); refusal != nil {
			return refusal
		}
		var err error
		items, err = dal.QueryDocuments(handle, dal.DocQuery{
			WorkspaceID:   workspaceID,
			ScopeFilter:   scope,
			CategoryID:    categoryID,
			PathSubstring: pathQuery,
		})
		return err
	}); err != nil {
		return err
	}
	return ok(w, map[string]any{"items": items, "total": len(items), "offset": 0, "limit": len(items)})
}

func docCreate(w http.ResponseWriter, r *http.Request) error {
	workspaceID := r.PathValue("ws_id")
	payload, err := jsonBody(r)
	if err != nil {
		return err
	}
	scope := stringValue(payload["scope"])
	categoryID := stringValue(payload["category_id"])
	documentPath, message := dal.NormalizeDocPath(stringValue(payload["path"]))
	if message != "" {
		return validation(message)
	}
	content, ok := payload["content"].(string)
	if !ok {
		return validation("content 必须是字符串")
	}
	var created map[string]any
	if err := withDB(func(handle *sql.DB) error {
		if refusal := requireWorkspaceMode(handle, workspaceID, "docs"); refusal != nil {
			return refusal
		}
		if refusal := docScopeInput(handle, workspaceID, scope, categoryID); refusal != nil {
			return refusal
		}
		document, status, err := dal.CreateDocument(handle, workspaceID, scope, categoryID, documentPath, content)
		if err != nil {
			return err
		}
		if status == "duplicate" {
			return validation(fmt.Sprintf("文档 %s 已存在", documentPath))
		}
		created = document
		return nil
	}); err != nil {
		return err
	}
	return okStatus(w, created, 201)
}

func docDetail(w http.ResponseWriter, r *http.Request) error {
	workspaceID := r.PathValue("ws_id")
	documentID := r.PathValue("doc_id")
	var document map[string]any
	if err := withDB(func(handle *sql.DB) error {
		if refusal := requireWorkspaceMode(handle, workspaceID, "docs"); refusal != nil {
			return refusal
		}
		var err error
		document, err = dal.GetDocumentByID(handle, workspaceID, documentID)
		return err
	}); err != nil {
		return err
	}
	if document == nil {
		return fail(CodeNotFound, fmt.Sprintf("文档 %s 不存在", documentID), 404)
	}
	return ok(w, document)
}

func docUpdate(w http.ResponseWriter, r *http.Request) error {
	workspaceID := r.PathValue("ws_id")
	documentID := r.PathValue("doc_id")
	payload, err := jsonBody(r)
	if err != nil {
		return err
	}
	var newPath *string
	var newContent *string
	if _, present := payload["path"]; present {
		normalized, message := dal.NormalizeDocPath(stringValue(payload["path"]))
		if message != "" {
			return validation(message)
		}
		newPath = &normalized
	}
	if _, present := payload["content"]; present {
		content, ok := payload["content"].(string)
		if !ok {
			return validation("content 必须是字符串")
		}
		newContent = &content
	}
	if newPath == nil && newContent == nil {
		return validation("至少提供一个待更新字段")
	}
	var document map[string]any
	if err := withDB(func(handle *sql.DB) error {
		if refusal := requireWorkspaceMode(handle, workspaceID, "docs"); refusal != nil {
			return refusal
		}
		updated, status, err := dal.UpdateDocumentByID(handle, workspaceID, documentID, newPath, newContent)
		if err != nil {
			return err
		}
		switch status {
		case "not_found":
			return fail(CodeNotFound, fmt.Sprintf("文档 %s 不存在", documentID), 404)
		case "duplicate":
			return validation("同作用域下已存在同名文档")
		}
		document = updated
		return nil
	}); err != nil {
		return err
	}
	return ok(w, document)
}

func docDelete(w http.ResponseWriter, r *http.Request) error {
	workspaceID := r.PathValue("ws_id")
	documentID := r.PathValue("doc_id")
	var deleted bool
	if err := withDB(func(handle *sql.DB) error {
		if refusal := requireWorkspaceMode(handle, workspaceID, "docs"); refusal != nil {
			return refusal
		}
		var err error
		deleted, err = dal.DeleteDocumentByID(handle, workspaceID, documentID)
		return err
	}); err != nil {
		return err
	}
	if !deleted {
		return fail(CodeNotFound, fmt.Sprintf("文档 %s 不存在", documentID), 404)
	}
	return ok(w, map[string]any{"id": documentID, "action": "deleted"})
}
