package dal

import "testing"

func TestWorkspaceLifecycle(t *testing.T) {
	handle := newTestDB(t)

	list, err := ListWorkspaces(handle)
	if err != nil || len(list) != 1 || list[0]["id"] != "default" {
		t.Fatalf("initial workspaces = %v err=%v", list, err)
	}

	memory, err := CreateWorkspace(handle, "记忆二区", "第二记忆区", "memory")
	if err != nil || memory == nil {
		t.Fatalf("create memory workspace: %v %v", memory, err)
	}
	docs, err := CreateWorkspace(handle, "文档区", "", "docs")
	if err != nil || docs == nil {
		t.Fatalf("create docs workspace: %v %v", docs, err)
	}
	memoryID := memory["id"].(string)
	docsID := docs["id"].(string)

	list, err = ListWorkspaces(handle)
	if err != nil || len(list) != 3 || list[0]["id"] != "default" {
		t.Fatalf("workspace order = %v err=%v", list, err)
	}

	if updated, err := UpdateWorkspace(handle, memoryID, "改名工作区", "新描述"); err != nil || !updated {
		t.Fatalf("update workspace: %v %v", updated, err)
	}
	reloaded, err := GetWorkspace(handle, memoryID)
	if err != nil || reloaded["name"] != "改名工作区" || reloaded["mode"] != "memory" {
		t.Fatalf("reloaded workspace = %v err=%v", reloaded, err)
	}

	if status, err := DeleteEmptyWorkspace(handle, "default"); err != nil || status != "is_default" {
		t.Fatalf("default delete: %q %v", status, err)
	}
	if status, err := DeleteEmptyWorkspace(handle, "ws_missing"); err != nil || status != "not_found" {
		t.Fatalf("missing delete: %q %v", status, err)
	}
	if status, err := AddGroupInWorkspace(handle, memoryID, "alpha", "A", ""); err != nil || status != "inserted" {
		t.Fatalf("add group in workspace: %q %v", status, err)
	}
	if status, err := DeleteEmptyWorkspace(handle, memoryID); err != nil || status != "not_empty" {
		t.Fatalf("non-empty delete: %q %v", status, err)
	}
	if status, err := DeleteEmptyWorkspace(handle, docsID); err != nil || status != "deleted" {
		t.Fatalf("empty docs delete: %q %v", status, err)
	}
	if gone, err := GetWorkspace(handle, docsID); err != nil || gone != nil {
		t.Fatalf("deleted workspace still visible: %v err=%v", gone, err)
	}
}

func TestMemoryWorkspaceIsolation(t *testing.T) {
	handle := newTestDB(t)
	workspaceA, err := CreateWorkspace(handle, "记忆 A", "", "memory")
	if err != nil {
		t.Fatalf("create A: %v", err)
	}
	workspaceB, err := CreateWorkspace(handle, "记忆 B", "", "memory")
	if err != nil {
		t.Fatalf("create B: %v", err)
	}
	workspaceDocs, err := CreateWorkspace(handle, "文档 D", "", "docs")
	if err != nil {
		t.Fatalf("create D: %v", err)
	}
	idA := workspaceA["id"].(string)
	idB := workspaceB["id"].(string)
	idDocs := workspaceDocs["id"].(string)

	if status, err := AddGroupInWorkspace(handle, idA, "alpha", "A", ""); err != nil || status != "inserted" {
		t.Fatalf("group in A: %q %v", status, err)
	}
	if status, err := AddGroupInWorkspace(handle, idB, "beta", "B", ""); err != nil || status != "inserted" {
		t.Fatalf("group in B: %q %v", status, err)
	}
	// 分组短标识全局唯一：跨记忆工作区重名必须拒绝，避免无工作区入参的寻址歧义。
	if status, _ := AddGroupInWorkspace(handle, idB, "alpha", "A", ""); status != "duplicate" {
		t.Fatalf("cross-workspace duplicate slug: %q", status)
	}
	if status, _ := AddGroupInWorkspace(handle, idDocs, "gamma", "G", ""); status != "wrong_mode" {
		t.Fatalf("docs workspace must refuse groups: %q", status)
	}
	if status, _ := AddGroupInWorkspace(handle, "ws_missing", "x", "x", ""); status != "workspace_not_found" {
		t.Fatalf("missing workspace: %q", status)
	}

	mustInsertMemory(t, handle, "alpha", "A 条目")
	mustInsertMemory(t, handle, "beta", "B 条目")

	groupsA, err := ListGroupsWithCountsInWorkspace(handle, map[string]string{"*": "rw"}, idA)
	if err != nil || len(groupsA) != 1 || groupsA[0]["slug"] != "alpha" {
		t.Fatalf("groups in A = %v err=%v", groupsA, err)
	}
	groupsB, err := ListGroupsWithCountsInWorkspace(handle, map[string]string{"*": "rw"}, idB)
	if err != nil || len(groupsB) != 1 || groupsB[0]["slug"] != "beta" {
		t.Fatalf("groups in B = %v err=%v", groupsB, err)
	}
	plainA, err := ListGroupsInWorkspace(handle, idA)
	if err != nil || len(plainA) != 1 || plainA[0]["workspace_id"] != idA {
		t.Fatalf("plain group list in A = %v err=%v", plainA, err)
	}

	searchA, err := ListActiveMemoriesForSearchInWorkspace(handle, map[string]string{"*": "rw"}, idA, "", false)
	if err != nil || len(searchA) != 1 || searchA[0]["group_slug"] != "alpha" {
		t.Fatalf("search in A = %v err=%v", searchA, err)
	}
	webB, total, err := ListMemoriesForWebInWorkspace(handle, map[string]string{"*": "rw"}, idB, "active", "", 0, 20)
	if err != nil || total != 1 || webB[0]["group_slug"] != "beta" {
		t.Fatalf("web list in B = total %d rows %v err=%v", total, webB, err)
	}

	// 无工作区入参的既有契约（/mcp 与 CLI）保持全局可见。
	all, err := ListActiveMemoriesForSearch(handle, map[string]string{"*": "rw"}, "", false)
	if err != nil || len(all) != 2 {
		t.Fatalf("workspace-less search = %v err=%v", all, err)
	}
	everyGroup, err := ListGroups(handle)
	if err != nil || len(everyGroup) != 2 {
		t.Fatalf("workspace-less groups = %v err=%v", everyGroup, err)
	}
}

func TestListWorkspacesCounters(t *testing.T) {
	handle := newTestDB(t)
	workspace, err := CreateWorkspace(handle, "文档区", "", "docs")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	workspaceID := workspace["id"].(string)
	category, err := CreateDocCategory(handle, workspaceID, "规范", "")
	if err != nil {
		t.Fatalf("category: %v", err)
	}
	if _, status, err := CreateDocument(handle, workspaceID, "public", "", "notes.md", "x"); err != nil || status != "created" {
		t.Fatalf("public doc: %q %v", status, err)
	}
	if _, status, err := CreateDocument(handle, workspaceID, "category", category["id"].(string), "cat.md", "y"); err != nil || status != "created" {
		t.Fatalf("category doc: %q %v", status, err)
	}
	reloaded, err := GetWorkspace(handle, workspaceID)
	if err != nil || reloaded == nil {
		t.Fatalf("reload: %v %v", reloaded, err)
	}
	if reloaded["category_count"] != int64(1) || reloaded["public_doc_count"] != int64(1) {
		t.Fatalf("counters = %v", reloaded)
	}
}
