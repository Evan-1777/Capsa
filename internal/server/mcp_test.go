package server

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"capsa/internal/auth"
	"capsa/internal/dal"
	"capsa/internal/db"

	"github.com/mark3labs/mcp-go/mcp"
)

func setupMCPTestDB(t *testing.T) {
	t.Helper()
	t.Cleanup(func() { _ = db.CloseShared() })
	t.Setenv("CAPSA_DB_PATH", filepath.Join(t.TempDir(), "capsa.db"))
	handle, err := db.Shared()
	if err != nil {
		t.Fatalf("shared db: %v", err)
	}
	if err := db.InitSchema(handle); err != nil {
		t.Fatalf("init schema: %v", err)
	}
	for _, slug := range []string{"proj", "study", "secret"} {
		if _, err := dal.AddGroup(handle, slug, "组-"+slug, "说明-"+slug); err != nil {
			t.Fatalf("add group %s: %v", slug, err)
		}
	}
}

func ctxWithGrants(grants map[string]string) context.Context {
	return withAccessToken(context.Background(), &auth.AccessToken{
		KeyID:  "testkey1",
		Name:   "test",
		Grants: grants,
	})
}

func callReq(args map[string]any) mcp.CallToolRequest {
	return mcp.CallToolRequest{
		Params: mcp.CallToolParams{
			Arguments: args,
		},
	}
}

func resultText(t *testing.T, res *mcp.CallToolResult) string {
	t.Helper()
	if res == nil || len(res.Content) == 0 {
		return ""
	}
	if tc, ok := res.Content[0].(mcp.TextContent); ok {
		return tc.Text
	}
	return ""
}

func TestMCPToolRegistryHasExact11Tools(t *testing.T) {
	srv := NewMCPServer()
	tools := srv.ListTools()
	expected := []string{
		"memory_groups",
		"memory_catalog",
		"memory_search",
		"memory_read",
		"memory_save",
		"memory_update",
		"memory_edit",
		"memory_forget",
		"memory_restore",
		"memory_purge",
		"memory_empty_trash",
	}
	if len(tools) != len(expected) {
		t.Fatalf("tool count = %d, want %d", len(tools), len(expected))
	}
	if _, hasPeek := tools["memory_peek"]; hasPeek {
		t.Fatal("memory_peek must be removed")
	}
	for _, name := range expected {
		tool, ok := tools[name]
		if !ok {
			t.Fatalf("missing tool %s", name)
		}
		if strings.Contains(tool.Tool.Description, "分组") || strings.Contains(tool.Tool.Description, "分类") {
			t.Fatalf("tool %s description still contains legacy term: %s", name, tool.Tool.Description)
		}
	}
}

func TestMCPCatalogSearchReadAndLifecycle(t *testing.T) {
	setupMCPTestDB(t)
	handle, _ := db.Shared()

	// Seed memories: persistent, temporary (future), shallow, deep, expired (auto-archived), secret.
	future := time.Now().UTC().Add(48 * time.Hour).Format("2006-01-02T15:04:05.000000-07:00")
	past := time.Now().UTC().Add(-2 * time.Hour).Format("2006-01-02T15:04:05.000000-07:00")
	oldTime := time.Now().UTC().AddDate(0, -6, 0).Format("2006-01-02T15:04:05.000000-07:00")

	persID, _ := dal.InsertMemory(handle, "proj", "持久架构", "持久摘要", "持久正文", []string{"arch"}, true, nil, nil)
	tempID, _ := dal.InsertMemory(handle, "proj", "临时方案", "临时摘要", "临时正文", []string{"tmp"}, false, &future, nil)
	deepID, _ := dal.InsertMemory(handle, "proj", "历史沉淀", "历史摘要", "深层暗语XYZ", []string{"oldtag"}, false, nil, nil)
	_, _ = handle.Exec("UPDATE memories SET updated_at = ? WHERE id = ?", oldTime, deepID)
	expID, _ := dal.InsertMemory(handle, "proj", "已到期临时", "到期摘要", "到期正文", []string{"exp"}, false, &past, nil)
	secretID, _ := dal.InsertMemory(handle, "secret", "机密", "机密摘要", "机密正文", nil, false, nil, nil)
	_, _ = dal.SoftDeleteMemory(handle, secretID, "隐藏")

	rwCtx := ctxWithGrants(map[string]string{"proj": "rw", "study": "r"})

	// 1. memory_catalog shallow triggers lazy expiration of expID and returns persistent + temporary only (not deep).
	catRes, _ := handleCatalog(rwCtx, callReq(map[string]any{"depth": "shallow"}))
	catText := resultText(t, catRes)
	if catRes.IsError || !strings.Contains(catText, persID) || !strings.Contains(catText, tempID) || strings.Contains(catText, deepID) || strings.Contains(catText, expID) {
		t.Fatalf("shallow catalog unexpected:\n%s", catText)
	}
	if strings.Index(catText, persID) > strings.Index(catText, tempID) {
		t.Fatalf("persistent must sort before temporary:\n%s", catText)
	}
	if !strings.Contains(catText, "摘要: 持久摘要") {
		t.Fatalf("shallow catalog must include summary:\n%s", catText)
	}

	// 2. deeper catalog returns deepID only.
	deepRes, _ := handleCatalog(rwCtx, callReq(map[string]any{"depth": "deeper"}))
	deepText := resultText(t, deepRes)
	if deepRes.IsError || !strings.Contains(deepText, deepID) || strings.Contains(deepText, persID) {
		t.Fatalf("deeper catalog unexpected:\n%s", deepText)
	}

	// 3. memory_search: tags isolation & body isolation & trash layer.
	tagRes, _ := handleSearch(rwCtx, callReq(map[string]any{
		"query":     "oldtag",
		"layers":    []any{"deep"},
		"search_in": []any{"tags"},
	}))
	if tagRes.IsError || !strings.Contains(resultText(t, tagRes), deepID) {
		t.Fatalf("tags search should find deepID:\n%s", resultText(t, tagRes))
	}
	titleOnlyRes, _ := handleSearch(rwCtx, callReq(map[string]any{
		"query":     "oldtag",
		"layers":    []any{"deep"},
		"search_in": []any{"title"},
	}))
	if titleOnlyRes.IsError || strings.Contains(resultText(t, titleOnlyRes), deepID) {
		t.Fatalf("title-only search must not match tags:\n%s", resultText(t, titleOnlyRes))
	}
	bodyRes, _ := handleSearch(rwCtx, callReq(map[string]any{
		"query":         "XYZ",
		"layers":        []any{"deep"},
		"search_in":     []any{"body"},
		"return_fields": []any{"title", "summary"},
	}))
	if bodyRes.IsError || !strings.Contains(resultText(t, bodyRes), deepID) || !strings.Contains(resultText(t, bodyRes), "摘要: 历史摘要") {
		t.Fatalf("body search unexpected:\n%s", resultText(t, bodyRes))
	}
	trashRes, _ := handleSearch(rwCtx, callReq(map[string]any{
		"query":  "到期",
		"layers": []any{"trash"},
	}))
	if trashRes.IsError || !strings.Contains(resultText(t, trashRes), expID) || !strings.Contains(resultText(t, trashRes), "临时记忆到期自动归档") {
		t.Fatalf("trash search should find auto-archived expID:\n%s", resultText(t, trashRes))
	}

	// 4. memory_read reads authorized trash and masks unauthorized trash.
	readRes, _ := handleRead(rwCtx, callReq(map[string]any{"ids": []any{expID, secretID}}))
	readText := resultText(t, readRes)
	if readRes.IsError || !strings.Contains(readText, "到期正文") || !strings.Contains(readText, "[无权访问]") || strings.Contains(readText, "secret") {
		t.Fatalf("memory_read trash/masking unexpected:\n%s", readText)
	}

	// 5. memory_edit partial replacement.
	editRes, _ := handleEdit(rwCtx, callReq(map[string]any{
		"id":         persID,
		"old_string": "持久正文",
		"new_string": "更新后的持久正文",
	}))
	if editRes.IsError {
		t.Fatalf("memory_edit failed: %s", resultText(t, editRes))
	}

	// 6. memory_save / memory_update mutual exclusivity.
	badSave, _ := handleSave(rwCtx, callReq(map[string]any{
		"group": "proj", "title": "t", "summary": "s", "body": "b",
		"persistent": true, "expires_at": future,
	}))
	if !badSave.IsError {
		t.Fatal("save with both persistent and expires_at must fail")
	}
	badUpd, _ := handleUpdate(rwCtx, callReq(map[string]any{
		"id": persID, "expires_at": future,
	}))
	if !badUpd.IsError {
		t.Fatal("setting expires_at on persistent memory without persistent=false must fail")
	}

	// 7. Restore persistent memory with expires_at atomically clears persistent.
	_, _ = handleForget(rwCtx, callReq(map[string]any{"id": persID, "reason": "测试"}))
	restRes, _ := handleRestore(rwCtx, callReq(map[string]any{"id": persID, "expires_at": future}))
	if restRes.IsError {
		t.Fatalf("restore with expires_at failed: %s", resultText(t, restRes))
	}
	row, _ := dal.GetMemoryForWeb(handle, persID)
	if row["pinned"] != int64(0) || row["expires_at"] != future {
		t.Fatalf("restored persistent with expires_at must have pinned=0: %v", row)
	}
}

func TestMCPTrashPermissionsAndEmptyTrash(t *testing.T) {
	setupMCPTestDB(t)
	handle, _ := db.Shared()

	projID, _ := dal.InsertMemory(handle, "proj", "p", "s", "b", nil, false, nil, nil)
	studyID, _ := dal.InsertMemory(handle, "study", "st", "s", "b", nil, false, nil, nil)
	secretID, _ := dal.InsertMemory(handle, "secret", "sc", "s", "b", nil, false, nil, nil)
	_, _ = dal.SoftDeleteMemory(handle, projID, "r")
	_, _ = dal.SoftDeleteMemory(handle, studyID, "r")
	_, _ = dal.SoftDeleteMemory(handle, secretID, "r")

	roCtx := ctxWithGrants(map[string]string{"proj": "r", "study": "r"})
	if res, _ := handleRestore(roCtx, callReq(map[string]any{"id": projID})); !res.IsError {
		t.Fatal("read-only key must not restore")
	}
	if res, _ := handlePurge(roCtx, callReq(map[string]any{"id": projID})); !res.IsError {
		t.Fatal("read-only key must not purge")
	}
	if res, _ := handleEmptyTrash(roCtx, callReq(map[string]any{})); !res.IsError {
		t.Fatal("read-only key must not empty trash")
	}

	// Partial write key (proj:rw, study:r) empties only proj trash; study and secret stay intact.
	partialCtx := ctxWithGrants(map[string]string{"proj": "rw", "study": "r"})
	if res, _ := handleEmptyTrash(partialCtx, callReq(map[string]any{"group": "study"})); !res.IsError {
		t.Fatal("empty_trash on read-only group must fail")
	}
	emptyRes, _ := handleEmptyTrash(partialCtx, callReq(map[string]any{}))
	if emptyRes.IsError || !strings.Contains(resultText(t, emptyRes), "1 条") {
		t.Fatalf("partial empty_trash unexpected: isErr=%v text=%s", emptyRes.IsError, resultText(t, emptyRes))
	}
	if row, _ := dal.GetMemoryForWeb(handle, projID); row != nil {
		t.Fatal("proj trash entry should be deleted")
	}
	if row, _ := dal.GetMemoryForWeb(handle, studyID); row == nil {
		t.Fatal("study (read-only) trash entry must remain")
	}
	if row, _ := dal.GetMemoryForWeb(handle, secretID); row == nil {
		t.Fatal("secret (unauthorized) trash entry must remain")
	}
}
