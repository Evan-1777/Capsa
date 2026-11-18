package dal

import (
	"database/sql"
	"strings"
	"testing"
)

func newDocsFixture(t *testing.T, handle *sql.DB) (string, string) {
	t.Helper()
	workspace, err := CreateWorkspace(handle, "文档区", "", "docs")
	if err != nil || workspace == nil {
		t.Fatalf("create docs workspace: %v %v", workspace, err)
	}
	workspaceID := workspace["id"].(string)
	category, err := CreateDocCategory(handle, workspaceID, "规范", "公共规范")
	if err != nil || category == nil {
		t.Fatalf("create category: %v %v", category, err)
	}
	return workspaceID, category["id"].(string)
}

func TestNormalizeDocPath(t *testing.T) {
	for _, raw := range []string{"notes.md", "guides/setup.md", "a/b/c.txt"} {
		got, message := NormalizeDocPath(raw)
		if message != "" || got != raw {
			t.Fatalf("valid path %q rejected: %q %q", raw, got, message)
		}
	}
	invalid := []string{
		"",
		"   ",
		"\\windows\\path",
		"a//b",
		"/abs",
		"trail/",
		"./x",
		"x/../y",
		"..",
		"bad\nname",
		"bad\tname",
		strings.Repeat("长", 256),
	}
	for _, raw := range invalid {
		if _, message := NormalizeDocPath(raw); message == "" {
			t.Fatalf("path %q must be rejected", raw)
		}
	}
}

func TestDocumentTwoLevelUniqueness(t *testing.T) {
	handle := newTestDB(t)
	workspaceID, categoryID := newDocsFixture(t, handle)

	if _, status, err := CreateDocument(handle, workspaceID, "public", "", "notes.md", "pub"); err != nil || status != "created" {
		t.Fatalf("public create: %q %v", status, err)
	}
	if _, status, err := CreateDocument(handle, workspaceID, "public", "", "notes.md", "again"); err != nil || status != "duplicate" {
		t.Fatalf("public duplicate: %q %v", status, err)
	}
	// 公共区与分类区同名互不冲突，部分唯一索引只约束各自作用域。
	if _, status, err := CreateDocument(handle, workspaceID, "category", categoryID, "notes.md", "cat"); err != nil || status != "created" {
		t.Fatalf("category create: %q %v", status, err)
	}
	if _, status, err := CreateDocument(handle, workspaceID, "category", categoryID, "notes.md", "again"); err != nil || status != "duplicate" {
		t.Fatalf("category duplicate: %q %v", status, err)
	}

	public, err := GetDocumentByPath(handle, workspaceID, "public", "", "notes.md")
	if err != nil || public["content"] != "pub" {
		t.Fatalf("public document = %v err=%v", public, err)
	}
	categoryDoc, err := GetDocumentByPath(handle, workspaceID, "category", categoryID, "notes.md")
	if err != nil || categoryDoc["content"] != "cat" {
		t.Fatalf("category document = %v err=%v", categoryDoc, err)
	}
}

func TestEditDocumentByPathAtomicContract(t *testing.T) {
	handle := newTestDB(t)
	workspaceID, categoryID := newDocsFixture(t, handle)
	if _, status, err := CreateDocument(handle, workspaceID, "category", categoryID, "edit.md", "alpha\nbeta\nalpha"); err != nil || status != "created" {
		t.Fatalf("seed: %q %v", status, err)
	}

	count, status, err := EditDocumentByPath(handle, workspaceID, categoryID, "edit.md", "alpha", "gamma", false)
	if err != nil || status != "ambiguous" || count != 2 {
		t.Fatalf("ambiguous edit: count=%d status=%q err=%v", count, status, err)
	}
	count, status, err = EditDocumentByPath(handle, workspaceID, categoryID, "edit.md", "alpha", "gamma", true)
	if err != nil || status != "edited" || count != 2 {
		t.Fatalf("replace_all edit: count=%d status=%q err=%v", count, status, err)
	}
	document, err := GetDocumentByPath(handle, workspaceID, "category", categoryID, "edit.md")
	if err != nil || document["content"] != "gamma\nbeta\ngamma" {
		t.Fatalf("content after replace_all = %v err=%v", document, err)
	}

	if _, status, _ := EditDocumentByPath(handle, workspaceID, categoryID, "edit.md", "missing", "x", false); status != "no_match" {
		t.Fatalf("no_match status = %q", status)
	}
	if _, status, _ := EditDocumentByPath(handle, workspaceID, categoryID, "edit.md", "", "x", false); status != "empty_match" {
		t.Fatalf("empty old_string status = %q", status)
	}
	if _, status, _ := EditDocumentByPath(handle, workspaceID, categoryID, "ghost.md", "x", "y", false); status != "not_found" {
		t.Fatalf("missing document status = %q", status)
	}
}

func TestOverwriteAndDeleteDocumentByPath(t *testing.T) {
	handle := newTestDB(t)
	workspaceID, categoryID := newDocsFixture(t, handle)
	if _, status, err := CreateDocument(handle, workspaceID, "public", "", "pub.md", "public"); err != nil || status != "created" {
		t.Fatalf("public seed: %q %v", status, err)
	}
	if _, status, err := CreateDocument(handle, workspaceID, "category", categoryID, "cat.md", "v1"); err != nil || status != "created" {
		t.Fatalf("category seed: %q %v", status, err)
	}

	// 分类写原语绝不自动新建，也绝不触碰公共作用域。
	if _, status, _ := OverwriteDocumentByPath(handle, workspaceID, categoryID, "pub.md", "hacked"); status != "not_found" {
		t.Fatalf("overwrite of a public path = %q", status)
	}
	public, err := GetDocumentByPath(handle, workspaceID, "public", "", "pub.md")
	if err != nil || public["content"] != "public" {
		t.Fatalf("public document was modified: %v err=%v", public, err)
	}
	if _, status, _ := OverwriteDocumentByPath(handle, workspaceID, categoryID, "ghost.md", "x"); status != "not_found" {
		t.Fatalf("overwrite of a missing path = %q", status)
	}
	updated, status, err := OverwriteDocumentByPath(handle, workspaceID, categoryID, "cat.md", "v2")
	if err != nil || status != "updated" || updated["content"] != "v2" {
		t.Fatalf("overwrite: %q %v %v", status, updated, err)
	}

	if deleted, err := DeleteDocumentByPath(handle, workspaceID, categoryID, "cat.md"); err != nil || !deleted {
		t.Fatalf("delete: %v %v", deleted, err)
	}
	if deleted, err := DeleteDocumentByPath(handle, workspaceID, categoryID, "cat.md"); err != nil || deleted {
		t.Fatalf("second delete must be a no-op: %v %v", deleted, err)
	}
}

func TestDocCategoryLifecycleAndAccessID(t *testing.T) {
	handle := newTestDB(t)
	workspaceID, categoryID := newDocsFixture(t, handle)
	category, err := GetDocCategory(handle, workspaceID, categoryID)
	if err != nil || category == nil {
		t.Fatalf("get category: %v %v", category, err)
	}
	originalAccess := category["access_id"].(string)

	if status, err := UpdateDocCategory(handle, workspaceID, categoryID, "规范二版", "更新后的说明"); err != nil || status != "updated" {
		t.Fatalf("update category: %q %v", status, err)
	}
	if status, err := UpdateDocCategory(handle, workspaceID, "cat_missing", "x", ""); err != nil || status != "not_found" {
		t.Fatalf("update missing category: %q %v", status, err)
	}
	if _, err := CreateDocCategory(handle, workspaceID, "规范二版", ""); err == nil {
		t.Fatal("duplicate category name must be refused")
	}
	other, err := CreateDocCategory(handle, workspaceID, "其他", "")
	if err != nil {
		t.Fatalf("second category: %v", err)
	}
	if status, _ := UpdateDocCategory(handle, workspaceID, other["id"].(string), "规范二版", ""); status != "duplicate_name" {
		t.Fatalf("rename onto an existing name = %q", status)
	}

	rotated, err := RotateDocCategoryAccessID(handle, workspaceID, categoryID)
	if err != nil || rotated == nil {
		t.Fatalf("rotate: %v %v", rotated, err)
	}
	nextAccess := rotated["access_id"].(string)
	if nextAccess == originalAccess {
		t.Fatal("rotation must mint a new access id")
	}
	if found, err := FindDocCategoryByAccessID(handle, originalAccess); err != nil || found != nil {
		t.Fatalf("old access id still resolves: %v err=%v", found, err)
	}
	found, err := FindDocCategoryByAccessID(handle, nextAccess)
	if err != nil || found == nil || found["workspace_id"] != workspaceID || found["category_name"] != "规范二版" {
		t.Fatalf("new access id = %v err=%v", found, err)
	}

	// 记忆工作区下的分类行不参与 /mcp/docs 鉴权。
	memory, err := CreateWorkspace(handle, "记忆区", "", "memory")
	if err != nil {
		t.Fatalf("memory workspace: %v", err)
	}
	if _, err := handle.Exec("INSERT INTO doc_categories (id, workspace_id, name, description, access_id, created_at, updated_at) VALUES ('cat_synthetic', ?, '越界分类', '', 'capsa_doc_synthetic_probe', '2026-01-01T00:00:00.000000+00:00', '2026-01-01T00:00:00.000000+00:00')", memory["id"].(string)); err != nil {
		t.Fatalf("synthetic category: %v", err)
	}
	if found, err := FindDocCategoryByAccessID(handle, "capsa_doc_synthetic_probe"); err != nil || found != nil {
		t.Fatalf("memory workspace category authenticated: %v err=%v", found, err)
	}

	if _, status, err := CreateDocument(handle, workspaceID, "category", categoryID, "seed.md", "x"); err != nil || status != "created" {
		t.Fatalf("seed document: %q %v", status, err)
	}
	if status, err := DeleteEmptyDocCategory(handle, workspaceID, categoryID); err != nil || status != "has_documents" {
		t.Fatalf("non-empty category delete: %q %v", status, err)
	}
	if deleted, err := DeleteDocumentByPath(handle, workspaceID, categoryID, "seed.md"); err != nil || !deleted {
		t.Fatalf("cleanup document: %v %v", deleted, err)
	}
	if status, err := DeleteEmptyDocCategory(handle, workspaceID, categoryID); err != nil || status != "deleted" {
		t.Fatalf("empty category delete: %q %v", status, err)
	}
	if status, err := DeleteEmptyDocCategory(handle, workspaceID, categoryID); err != nil || status != "not_found" {
		t.Fatalf("missing category delete: %q %v", status, err)
	}
}

func TestQueryDocumentsScopeFilter(t *testing.T) {
	handle := newTestDB(t)
	workspaceID, categoryID := newDocsFixture(t, handle)
	if _, status, err := CreateDocument(handle, workspaceID, "public", "", "guides/setup.md", "public body"); err != nil || status != "created" {
		t.Fatalf("public seed: %q %v", status, err)
	}
	if _, status, err := CreateDocument(handle, workspaceID, "category", categoryID, "notes.md", "category body"); err != nil || status != "created" {
		t.Fatalf("category seed: %q %v", status, err)
	}

	all, err := QueryDocuments(handle, DocQuery{WorkspaceID: workspaceID, ScopeFilter: "all", CategoryID: categoryID})
	if err != nil || len(all) != 2 || all[0]["scope"] != "public" {
		t.Fatalf("all scope = %v err=%v", all, err)
	}
	if _, present := all[0]["content"]; present {
		t.Fatal("list projection must not load content")
	}
	publicOnly, err := QueryDocuments(handle, DocQuery{WorkspaceID: workspaceID, ScopeFilter: "public"})
	if err != nil || len(publicOnly) != 1 || publicOnly[0]["path"] != "guides/setup.md" {
		t.Fatalf("public scope = %v err=%v", publicOnly, err)
	}
	categoryOnly, err := QueryDocuments(handle, DocQuery{WorkspaceID: workspaceID, ScopeFilter: "category", CategoryID: categoryID})
	if err != nil || len(categoryOnly) != 1 || categoryOnly[0]["path"] != "notes.md" {
		t.Fatalf("category scope = %v err=%v", categoryOnly, err)
	}
	substring, err := QueryDocuments(handle, DocQuery{WorkspaceID: workspaceID, ScopeFilter: "all", CategoryID: categoryID, PathSubstring: "SETUP"})
	if err != nil || len(substring) != 1 || substring[0]["path"] != "guides/setup.md" {
		t.Fatalf("path substring = %v err=%v", substring, err)
	}
	withContent, err := QueryDocuments(handle, DocQuery{WorkspaceID: workspaceID, ScopeFilter: "all", CategoryID: categoryID, IncludeContent: true})
	if err != nil || len(withContent) != 2 {
		t.Fatalf("content projection = %v err=%v", withContent, err)
	}
	if _, present := withContent[0]["content"]; !present {
		t.Fatal("IncludeContent must project the body")
	}
	exact, err := QueryDocuments(handle, DocQuery{WorkspaceID: workspaceID, ScopeFilter: "all", CategoryID: categoryID, ExactPath: "notes.md"})
	if err != nil || len(exact) != 1 || exact[0]["scope"] != "category" {
		t.Fatalf("exact path = %v err=%v", exact, err)
	}
}

func TestMoveDocumentByPath(t *testing.T) {
	handle := newTestDB(t)
	workspaceID, categoryID := newDocsFixture(t, handle)
	if _, status, err := CreateDocument(handle, workspaceID, "public", "", "pub.md", "public body"); err != nil || status != "created" {
		t.Fatalf("public seed: %q %v", status, err)
	}
	created, status, err := CreateDocument(handle, workspaceID, "category", categoryID, "notes.md", "cat body")
	if err != nil || status != "created" {
		t.Fatalf("category seed: %q %v", status, err)
	}
	if _, status, err := CreateDocument(handle, workspaceID, "category", categoryID, "existing.md", "keep me"); err != nil || status != "created" {
		t.Fatalf("existing seed: %q %v", status, err)
	}

	if status, err := MoveDocumentByPath(handle, workspaceID, categoryID, "notes.md", "notes.md", false); err != nil || status != "same_path" {
		t.Fatalf("same path status = %q err=%v", status, err)
	}
	// 分类移动绝不触碰公共文档区。
	if status, err := MoveDocumentByPath(handle, workspaceID, categoryID, "pub.md", "pub-moved.md", false); err != nil || status != "not_found" {
		t.Fatalf("move public doc status = %q err=%v", status, err)
	}
	if status, err := MoveDocumentByPath(handle, workspaceID, categoryID, "ghost.md", "existing.md", true); err != nil || status != "not_found" {
		t.Fatalf("overwrite from missing source status = %q err=%v", status, err)
	}
	// 源不存在时，即使开启 overwrite 也不得误删已有目标文档。
	kept, err := GetDocumentByPath(handle, workspaceID, "category", categoryID, "existing.md")
	if err != nil || kept == nil || kept["content"] != "keep me" {
		t.Fatalf("existing target modified when source missing: %v err=%v", kept, err)
	}

	if status, err := MoveDocumentByPath(handle, workspaceID, categoryID, "notes.md", "existing.md", false); err != nil || status != "duplicate" {
		t.Fatalf("duplicate without overwrite status = %q err=%v", status, err)
	}
	if status, err := MoveDocumentByPath(handle, workspaceID, categoryID, "notes.md", "archive/notes-v2.md", false); err != nil || status != "moved" {
		t.Fatalf("move to folder status = %q err=%v", status, err)
	}
	if old, err := GetDocumentByPath(handle, workspaceID, "category", categoryID, "notes.md"); err != nil || old != nil {
		t.Fatalf("old path still exists: %v err=%v", old, err)
	}
	moved, err := GetDocumentByPath(handle, workspaceID, "category", categoryID, "archive/notes-v2.md")
	if err != nil || moved == nil || moved["id"] != created["id"] || moved["created_at"] != created["created_at"] || moved["content"] != "cat body" {
		t.Fatalf("moved doc mismatch: %v err=%v", moved, err)
	}

	// 显式覆盖目标路径：保留源 id 与内容，目标旧文档被替换。
	if status, err := MoveDocumentByPath(handle, workspaceID, categoryID, "archive/notes-v2.md", "existing.md", true); err != nil || status != "moved" {
		t.Fatalf("overwrite move status = %q err=%v", status, err)
	}
	overwritten, err := GetDocumentByPath(handle, workspaceID, "category", categoryID, "existing.md")
	if err != nil || overwritten == nil || overwritten["id"] != created["id"] || overwritten["content"] != "cat body" {
		t.Fatalf("overwritten doc = %v err=%v", overwritten, err)
	}
}

func TestMoveDocumentsByPrefix(t *testing.T) {
	handle := newTestDB(t)
	workspaceID, categoryID := newDocsFixture(t, handle)
	seeds := map[string]string{
		"规范/a.md":       "doc a",
		"规范/sub/b.md":   "doc b",
		"规范-other/c.md": "untouched sibling",
		"archive/x.md":  "existing archive x",
	}
	for p, body := range seeds {
		if _, status, err := CreateDocument(handle, workspaceID, "category", categoryID, p, body); err != nil || status != "created" {
			t.Fatalf("seed %s: %q %v", p, status, err)
		}
	}

	if _, _, status, err := MoveDocumentsByPrefix(handle, workspaceID, categoryID, "规范", "规范", false); err != nil || status != "same_path" {
		t.Fatalf("same prefix = %q err=%v", status, err)
	}
	if _, _, status, err := MoveDocumentsByPrefix(handle, workspaceID, categoryID, "规范", "规范/sub", false); err != nil || status != "into_self" {
		t.Fatalf("into self = %q err=%v", status, err)
	}
	if _, _, status, err := MoveDocumentsByPrefix(handle, workspaceID, categoryID, "empty", "dest", false); err != nil || status != "not_found" {
		t.Fatalf("missing prefix = %q err=%v", status, err)
	}

	// 超长目标路径触发整批原子回滚。
	longDest := strings.Repeat("d", DocPathMax-2)
	if _, _, status, err := MoveDocumentsByPrefix(handle, workspaceID, categoryID, "规范", longDest, false); err != nil || status != "invalid_path" {
		t.Fatalf("too long prefix = %q err=%v", status, err)
	}

	// 目标存在冲突且未开启覆盖时整批回滚。
	if _, status, err := CreateDocument(handle, workspaceID, "category", categoryID, "archive/a.md", "conflict"); err != nil || status != "created" {
		t.Fatalf("seed conflict: %q %v", status, err)
	}
	if _, detail, status, err := MoveDocumentsByPrefix(handle, workspaceID, categoryID, "规范", "archive", false); err != nil || status != "duplicate" || detail != "archive/a.md" {
		t.Fatalf("conflict without overwrite = %q %q err=%v", status, detail, err)
	}
	if stillThere, _ := GetDocumentByPath(handle, workspaceID, "category", categoryID, "规范/sub/b.md"); stillThere == nil {
		t.Fatal("failed prefix move must roll back all source documents")
	}

	// 显式覆盖仅替换碰撞文件，保留目标目录原有非碰撞文件且不影响相似前缀目录。
	moved, _, status, err := MoveDocumentsByPrefix(handle, workspaceID, categoryID, "规范", "archive", true)
	if err != nil || status != "moved" || moved != 2 {
		t.Fatalf("prefix overwrite move = moved=%d status=%q err=%v", moved, status, err)
	}
	if doc, _ := GetDocumentByPath(handle, workspaceID, "category", categoryID, "archive/a.md"); doc == nil || doc["content"] != "doc a" {
		t.Fatalf("overwritten archive/a.md = %v", doc)
	}
	if doc, _ := GetDocumentByPath(handle, workspaceID, "category", categoryID, "archive/sub/b.md"); doc == nil || doc["content"] != "doc b" {
		t.Fatalf("moved archive/sub/b.md = %v", doc)
	}
	if doc, _ := GetDocumentByPath(handle, workspaceID, "category", categoryID, "archive/x.md"); doc == nil || doc["content"] != "existing archive x" {
		t.Fatalf("non-colliding target doc must stay = %v", doc)
	}
	if doc, _ := GetDocumentByPath(handle, workspaceID, "category", categoryID, "规范-other/c.md"); doc == nil || doc["content"] != "untouched sibling" {
		t.Fatalf("similar prefix sibling must stay untouched = %v", doc)
	}

	// 验证子目录向父目录回迁（含 a/b/x.md 与 a/b/b/x.md）按短路径优先更新无唯一索引碰撞。
	for _, p := range []string{"a/b/x.md", "a/b/b/x.md"} {
		if _, status, err := CreateDocument(handle, workspaceID, "category", categoryID, p, p); err != nil || status != "created" {
			t.Fatalf("seed nested %s: %q %v", p, status, err)
		}
	}
	moved, _, status, err = MoveDocumentsByPrefix(handle, workspaceID, categoryID, "a/b", "a", false)
	if err != nil || status != "moved" || moved != 2 {
		t.Fatalf("move upward = moved=%d status=%q err=%v", moved, status, err)
	}
	if doc, _ := GetDocumentByPath(handle, workspaceID, "category", categoryID, "a/x.md"); doc == nil || doc["content"] != "a/b/x.md" {
		t.Fatalf("upward moved a/x.md = %v", doc)
	}
	if doc, _ := GetDocumentByPath(handle, workspaceID, "category", categoryID, "a/b/x.md"); doc == nil || doc["content"] != "a/b/b/x.md" {
		t.Fatalf("upward moved a/b/x.md = %v", doc)
	}
}
