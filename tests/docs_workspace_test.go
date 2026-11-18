package integration

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

type docsFixture struct {
	workspaceID  string
	categoryID   string
	accessID     string
	categoryName string
}

// envelope sends an admin-authenticated request and returns status plus body.
func (e *testEnv) envelope(t *testing.T, method, path, body string) (int, map[string]any) {
	t.Helper()
	response := e.request(t, method, path, adminToken, body)
	return response.StatusCode, decodeEnvelope(t, response)
}

func dataOf(payload map[string]any) map[string]any {
	data, _ := payload["data"].(map[string]any)
	return data
}

func itemsOf(payload map[string]any) []any {
	items, _ := dataOf(payload)["items"].([]any)
	return items
}

func mustStatus(t *testing.T, label string, got, want int, payload map[string]any) {
	t.Helper()
	if got != want {
		t.Fatalf("%s status = %d, want %d (payload=%v)", label, got, want, payload)
	}
}

func jsonObject(fields map[string]string) string {
	encoded, _ := json.Marshal(fields)
	return string(encoded)
}

func newDocsWorkspace(t *testing.T, env *testEnv, name string) docsFixture {
	t.Helper()
	status, payload := env.envelope(t, "POST", "/api/workspaces",
		jsonObject(map[string]string{"name": name, "description": "", "mode": "docs"}))
	mustStatus(t, "create docs workspace", status, 201, payload)
	workspaceID, _ := dataOf(payload)["id"].(string)
	if workspaceID == "" {
		t.Fatalf("workspace id missing: %v", payload)
	}
	status, payload = env.envelope(t, "POST", "/api/workspaces/"+workspaceID+"/categories",
		jsonObject(map[string]string{"name": "规范", "description": "公共规范"}))
	mustStatus(t, "create category", status, 201, payload)
	data := dataOf(payload)
	return docsFixture{
		workspaceID:  workspaceID,
		categoryID:   data["id"].(string),
		accessID:     data["access_id"].(string),
		categoryName: data["name"].(string),
	}
}

func createDoc(t *testing.T, env *testEnv, workspaceID, scope, categoryID, path, content string) map[string]any {
	t.Helper()
	status, payload := env.envelope(t, "POST", "/api/workspaces/"+workspaceID+"/docs",
		jsonObject(map[string]string{
			"scope": scope, "category_id": categoryID, "path": path, "content": content,
		}))
	mustStatus(t, "create document "+path, status, 201, payload)
	return dataOf(payload)
}

// docsMCPCall posts a JSON-RPC message to the document MCP endpoint.
func docsMCPCall(t *testing.T, env *testEnv, token, session, body string) map[string]any {
	t.Helper()
	request, err := http.NewRequest("POST", env.server.URL+"/mcp/docs", strings.NewReader(body))
	if err != nil {
		t.Fatalf("new docs mcp request: %v", err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	if session != "" {
		request.Header.Set("Mcp-Session-Id", session)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("docs mcp do: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		raw, _ := io.ReadAll(response.Body)
		t.Fatalf("docs mcp status = %d body=%s", response.StatusCode, raw)
	}
	if session == "" && response.Header.Get("Mcp-Session-Id") == "" {
		t.Fatal("docs initialize must set Mcp-Session-Id")
	}
	if response.Header.Get("X-Accel-Buffering") != "no" {
		t.Fatal("docs response must disable downstream buffering")
	}
	var payload map[string]any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode docs mcp: %v", err)
	}
	return payload
}

func docsMCPSession(t *testing.T, env *testEnv, token string) string {
	t.Helper()
	payload := docsMCPCall(t, env, token, "",
		"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"t\",\"version\":\"1\"}}}")
	if _, ok := payload["result"]; !ok {
		t.Fatalf("docs initialize failed: %v", payload)
	}
	request, _ := http.NewRequest("POST", env.server.URL+"/mcp/docs",
		strings.NewReader("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"t\",\"version\":\"1\"}}}"))
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("docs initialize: %v", err)
	}
	defer response.Body.Close()
	return response.Header.Get("Mcp-Session-Id")
}

// docsTool calls one document primitive and returns its text plus isError flag.
func docsTool(t *testing.T, env *testEnv, token, session, name, arguments string) (string, bool) {
	t.Helper()
	body := "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"" + name + "\",\"arguments\":" + arguments + "}}"
	payload := docsMCPCall(t, env, token, session, body)
	result, _ := payload["result"].(map[string]any)
	if result == nil {
		t.Fatalf("%s returned no result: %v", name, payload)
	}
	isError, _ := result["isError"].(bool)
	return mcpText(payload), isError
}

func matchedLines(text string) []string {
	lines := []string{}
	for _, line := range strings.Split(text, "\n") {
		if strings.HasPrefix(line, "- [") {
			lines = append(lines, line)
		}
	}
	return lines
}

func TestWorkspaceRESTCRUD(t *testing.T) {
	env := setup(t)

	_, payload := env.envelope(t, "GET", "/api/workspaces", "")
	items := itemsOf(payload)
	if len(items) != 1 || items[0].(map[string]any)["id"] != "default" {
		t.Fatalf("initial workspaces = %v", items)
	}

	status, payload := env.envelope(t, "POST", "/api/workspaces", "{\"name\":\"缺模式\"}")
	mustStatus(t, "missing mode", status, 422, payload)
	status, payload = env.envelope(t, "POST", "/api/workspaces", jsonObject(map[string]string{"name": "x", "mode": "hybrid"}))
	mustStatus(t, "bad mode", status, 422, payload)
	status, payload = env.envelope(t, "POST", "/api/workspaces", "{\"name\":\"x\",\"description\":null,\"mode\":\"memory\"}")
	mustStatus(t, "null description", status, 422, payload)
	status, payload = env.envelope(t, "POST", "/api/workspaces", jsonObject(map[string]string{"name": strings.Repeat("长", 61), "mode": "memory"}))
	mustStatus(t, "over long name", status, 422, payload)

	status, payload = env.envelope(t, "POST", "/api/workspaces", jsonObject(map[string]string{"name": "记忆二区", "mode": "memory"}))
	mustStatus(t, "create memory workspace", status, 201, payload)
	memoryID, _ := dataOf(payload)["id"].(string)

	status, payload = env.envelope(t, "PUT", "/api/workspaces/"+memoryID, jsonObject(map[string]string{"name": "记忆二区改名", "description": "说明"}))
	mustStatus(t, "edit workspace", status, 200, payload)
	if dataOf(payload)["name"] != "记忆二区改名" || dataOf(payload)["mode"] != "memory" {
		t.Fatalf("edited workspace = %v", dataOf(payload))
	}
	status, payload = env.envelope(t, "PUT", "/api/workspaces/"+memoryID, jsonObject(map[string]string{"mode": "memory"}))
	mustStatus(t, "mode immutable", status, 422, payload)
	status, payload = env.envelope(t, "PUT", "/api/workspaces/ws_missing", jsonObject(map[string]string{"name": "x"}))
	mustStatus(t, "edit missing workspace", status, 404, payload)

	status, payload = env.envelope(t, "DELETE", "/api/workspaces/default", "")
	mustStatus(t, "delete default workspace", status, 422, payload)

	// 迁移后默认记忆工作区仍承载预置分组。
	status, payload = env.envelope(t, "GET", "/api/groups?workspace_id=default", "")
	mustStatus(t, "groups of default workspace", status, 200, payload)
	if len(itemsOf(payload)) != 4 {
		t.Fatalf("default workspace groups = %v", itemsOf(payload))
	}
	status, payload = env.envelope(t, "GET", "/api/groups?workspace_id="+memoryID, "")
	mustStatus(t, "groups of empty memory workspace", status, 200, payload)
	if len(itemsOf(payload)) != 0 {
		t.Fatalf("new memory workspace must start empty: %v", itemsOf(payload))
	}
	status, payload = env.envelope(t, "GET", "/api/groups?workspace_id=ws_missing", "")
	mustStatus(t, "groups of missing workspace", status, 404, payload)

	fixture := newDocsWorkspace(t, env, "文档区")
	status, payload = env.envelope(t, "GET", "/api/groups?workspace_id="+fixture.workspaceID, "")
	mustStatus(t, "memory filter on docs workspace", status, 422, payload)

	status, payload = env.envelope(t, "DELETE", "/api/workspaces/"+memoryID, "")
	mustStatus(t, "delete empty memory workspace", status, 200, payload)
	status, payload = env.envelope(t, "DELETE", "/api/workspaces/"+fixture.workspaceID, "")
	mustStatus(t, "delete non-empty docs workspace", status, 422, payload)
}

func TestDocCategoryAndDocumentREST(t *testing.T) {
	env := setup(t)
	fixture := newDocsWorkspace(t, env, "文档区")

	status, payload := env.envelope(t, "GET", "/api/workspaces/ws_missing/categories", "")
	mustStatus(t, "categories of missing workspace", status, 404, payload)

	status, payload = env.envelope(t, "POST", "/api/workspaces/"+fixture.workspaceID+"/categories",
		jsonObject(map[string]string{"name": "规范", "description": "重名"}))
	mustStatus(t, "duplicate category name", status, 422, payload)
	if errMsg, _ := payload["error"].(map[string]any)["message"].(string); !strings.Contains(errMsg, "子项目名称") {
		t.Fatalf("duplicate error = %q, want 子项目名称", errMsg)
	}

	status, payload = env.envelope(t, "GET", "/api/workspaces/"+fixture.workspaceID+"/categories", "")
	mustStatus(t, "list categories", status, 200, payload)
	first := itemsOf(payload)[0].(map[string]any)
	if first["access_id"] == "" || first["doc_count"] != float64(0) {
		t.Fatalf("category listing = %v", first)
	}

	status, payload = env.envelope(t, "PUT", "/api/workspaces/"+fixture.workspaceID+"/categories/"+fixture.categoryID,
		jsonObject(map[string]string{"name": "规范二版"}))
	mustStatus(t, "rename category", status, 200, payload)
	if dataOf(payload)["name"] != "规范二版" {
		t.Fatalf("renamed category = %v", dataOf(payload))
	}

	public := createDoc(t, env, fixture.workspaceID, "public", "", "guides/setup.md", "public body")
	status, payload = env.envelope(t, "POST", "/api/workspaces/"+fixture.workspaceID+"/docs",
		jsonObject(map[string]string{"scope": "public", "path": "guides/setup.md", "content": "dup"}))
	mustStatus(t, "duplicate public path", status, 422, payload)
	status, payload = env.envelope(t, "POST", "/api/workspaces/"+fixture.workspaceID+"/docs",
		jsonObject(map[string]string{"scope": "public", "path": "../escape.md", "content": "bad"}))
	mustStatus(t, "path traversal", status, 422, payload)
	status, payload = env.envelope(t, "POST", "/api/workspaces/"+fixture.workspaceID+"/docs",
		jsonObject(map[string]string{"scope": "category", "path": "notes.md", "content": "cat"}))
	mustStatus(t, "category doc without category_id", status, 422, payload)
	status, payload = env.envelope(t, "POST", "/api/workspaces/"+fixture.workspaceID+"/docs",
		jsonObject(map[string]string{"scope": "category", "category_id": "cat_missing", "path": "notes.md", "content": "cat"}))
	mustStatus(t, "unknown category", status, 404, payload)

	status, payload = env.envelope(t, "GET", "/api/workspaces/"+fixture.workspaceID+"/docs?scope=category", "")
	mustStatus(t, "docs without category_id", status, 422, payload)
	status, payload = env.envelope(t, "GET", "/api/workspaces/"+fixture.workspaceID+"/docs?scope=all", "")
	mustStatus(t, "bad scope", status, 422, payload)

	categoryDoc := createDoc(t, env, fixture.workspaceID, "category", fixture.categoryID, "notes.md", "category body")

	status, payload = env.envelope(t, "GET", "/api/workspaces/"+fixture.workspaceID+"/docs/"+public["id"].(string), "")
	mustStatus(t, "document detail", status, 200, payload)
	if dataOf(payload)["content"] != "public body" {
		t.Fatalf("detail content = %v", dataOf(payload))
	}
	status, payload = env.envelope(t, "GET", "/api/workspaces/"+fixture.workspaceID+"/docs/doc_missing", "")
	mustStatus(t, "missing document detail", status, 404, payload)

	status, payload = env.envelope(t, "PUT", "/api/workspaces/"+fixture.workspaceID+"/docs/"+categoryDoc["id"].(string),
		jsonObject(map[string]string{"content": "edited body", "path": "notes-v2.md"}))
	mustStatus(t, "update document", status, 200, payload)
	if dataOf(payload)["content"] != "edited body" || dataOf(payload)["path"] != "notes-v2.md" {
		t.Fatalf("updated document = %v", dataOf(payload))
	}
	createDoc(t, env, fixture.workspaceID, "category", fixture.categoryID, "conflict.md", "x")
	status, payload = env.envelope(t, "PUT", "/api/workspaces/"+fixture.workspaceID+"/docs/"+categoryDoc["id"].(string),
		jsonObject(map[string]string{"path": "conflict.md"}))
	mustStatus(t, "rename conflict", status, 422, payload)

	status, payload = env.envelope(t, "DELETE", "/api/workspaces/"+fixture.workspaceID+"/categories/"+fixture.categoryID, "")
	mustStatus(t, "delete non-empty category", status, 422, payload)
	if errMsg, _ := payload["error"].(map[string]any)["message"].(string); errMsg != "子项目下仍有文档，禁止删除" {
		t.Fatalf("non-empty delete error = %q, want 子项目下仍有文档，禁止删除", errMsg)
	}
	status, payload = env.envelope(t, "DELETE", "/api/workspaces/"+fixture.workspaceID+"/docs/"+categoryDoc["id"].(string), "")
	mustStatus(t, "delete category document", status, 200, payload)
	status, payload = env.envelope(t, "GET", "/api/workspaces/"+fixture.workspaceID+"/docs?scope=category&category_id="+fixture.categoryID, "")
	mustStatus(t, "category docs after delete", status, 200, payload)
	if len(itemsOf(payload)) != 1 {
		t.Fatalf("remaining category docs = %v", itemsOf(payload))
	}

	status, payload = env.envelope(t, "POST", "/api/workspaces/"+fixture.workspaceID+"/categories/"+fixture.categoryID+"/rotate-token", "")
	mustStatus(t, "rotate access id", status, 200, payload)
	if dataOf(payload)["access_id"] == fixture.accessID {
		t.Fatal("rotation must change the access id")
	}
}

func TestDocsMCPAccessBoundary(t *testing.T) {
	env := setup(t)
	fixture := newDocsWorkspace(t, env, "文档区")

	// 未认证与错凭据在协议处理前即被拒。
	response := env.request(t, "POST", "/mcp/docs", "", "{}")
	if response.StatusCode != 401 || response.Header.Get("WWW-Authenticate") != "Bearer" {
		t.Fatalf("unauthenticated docs status = %d", response.StatusCode)
	}
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if len(body) != 0 {
		t.Fatalf("401 body must be empty, got %q", body)
	}
	for _, token := range []string{adminToken, env.rwKey, "capsa_doc_unknown_00000000000000000000000000"} {
		response = env.request(t, "POST", "/mcp/docs", token, "{}")
		if response.StatusCode != 401 {
			t.Fatalf("token %q must be rejected by /mcp/docs, got %d", token, response.StatusCode)
		}
		response.Body.Close()
	}
	// 分类访问 ID 不得反向接入传统记忆端点与管理台。
	response = env.request(t, "POST", "/mcp", fixture.accessID, "{}")
	if response.StatusCode != 401 {
		t.Fatalf("access id on /mcp status = %d", response.StatusCode)
	}
	response.Body.Close()
	response = env.request(t, "GET", "/api/workspaces", fixture.accessID, "")
	if response.StatusCode != 401 {
		t.Fatalf("access id on /api status = %d", response.StatusCode)
	}
	response.Body.Close()

	session := docsMCPSession(t, env, fixture.accessID)
	text, isError := docsTool(t, env, fixture.accessID, session, "doc_glob", "{}")
	if isError || !strings.Contains(text, "# 文档匹配") {
		t.Fatalf("doc_glob with access id failed: %q %v", text, isError)
	}

	// URL 查询参数通道与请求头等价。
	queryRequest, _ := http.NewRequest("POST", env.server.URL+"/mcp/docs?token="+fixture.accessID,
		bytes.NewReader([]byte("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"t\",\"version\":\"1\"}}}")))
	queryRequest.Header.Set("Content-Type", "application/json")
	queryRequest.Header.Set("Accept", "application/json, text/event-stream")
	queryResponse, err := http.DefaultClient.Do(queryRequest)
	if err != nil {
		t.Fatalf("query token docs initialize: %v", err)
	}
	queryResponse.Body.Close()
	if queryResponse.StatusCode != 200 {
		t.Fatalf("query token docs status = %d", queryResponse.StatusCode)
	}

	// 分类隔离：A 的访问 ID 不能看见或修改 B 与其他工作区的文档。
	status, payload := env.envelope(t, "POST", "/api/workspaces/"+fixture.workspaceID+"/categories",
		jsonObject(map[string]string{"name": "其他分类"}))
	mustStatus(t, "create sibling category", status, 201, payload)
	sibling := dataOf(payload)
	createDoc(t, env, fixture.workspaceID, "category", sibling["id"].(string), "sibling.md", "sibling body")

	other := newDocsWorkspace(t, env, "第二文档区")
	createDoc(t, env, other.workspaceID, "category", other.categoryID, "foreign.md", "foreign body")

	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_read",
		jsonObject(map[string]string{"path": "sibling.md"})); !isError || !strings.Contains(text, "文档不存在") {
		t.Fatalf("cross-category read must fail: %q %v", text, isError)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_read",
		jsonObject(map[string]string{"path": "foreign.md"})); !isError {
		t.Fatalf("cross-workspace read must fail: %q %v", text, isError)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_delete",
		jsonObject(map[string]string{"path": "sibling.md"})); !isError {
		t.Fatalf("cross-category delete must fail: %q %v", text, isError)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_move",
		jsonObject(map[string]string{"path": "sibling.md", "new_path": "stolen.md"})); !isError {
		t.Fatalf("cross-category move must fail: %q %v", text, isError)
	}
	if text, _ := docsTool(t, env, fixture.accessID, session, "doc_glob", "{}"); strings.Contains(text, "sibling.md") || strings.Contains(text, "foreign.md") {
		t.Fatalf("glob leaked other categories: %q", text)
	}

	// 轮换后旧访问 ID 立即失效，新访问 ID 立即生效。
	status, payload = env.envelope(t, "POST", "/api/workspaces/"+fixture.workspaceID+"/categories/"+fixture.categoryID+"/rotate-token", "")
	mustStatus(t, "rotate", status, 200, payload)
	rotated := dataOf(payload)["access_id"].(string)
	response = env.request(t, "POST", "/mcp/docs", fixture.accessID, "{}")
	if response.StatusCode != 401 {
		t.Fatalf("stale access id status = %d", response.StatusCode)
	}
	response.Body.Close()
	freshSession := docsMCPSession(t, env, rotated)
	if _, isError := docsTool(t, env, rotated, freshSession, "doc_glob", "{}"); isError {
		t.Fatal("rotated access id must authenticate immediately")
	}
}

func TestDocsMCPGlobContract(t *testing.T) {
	env := setup(t)
	fixture := newDocsWorkspace(t, env, "文档区")
	session := docsMCPSession(t, env, fixture.accessID)

	createDoc(t, env, fixture.workspaceID, "public", "", "guides/setup.md", "public")
	createDoc(t, env, fixture.workspaceID, "category", fixture.categoryID, "notes.md", "notes")
	createDoc(t, env, fixture.workspaceID, "category", fixture.categoryID, "guides/setup.md", "category setup")
	createDoc(t, env, fixture.workspaceID, "category", fixture.categoryID, "guides/sub/a.md", "deep")

	all, isError := docsTool(t, env, fixture.accessID, session, "doc_glob", "{}")
	if isError || len(matchedLines(all)) != 4 {
		t.Fatalf("empty pattern = %q %v", all, isError)
	}
	substring, _ := docsTool(t, env, fixture.accessID, session, "doc_glob", jsonObject(map[string]string{"pattern": "setup"}))
	if lines := matchedLines(substring); len(lines) != 2 {
		t.Fatalf("substring pattern hits = %v", lines)
	}
	star, _ := docsTool(t, env, fixture.accessID, session, "doc_glob", jsonObject(map[string]string{"pattern": "*.md", "scope": "category"}))
	if lines := matchedLines(star); len(lines) != 3 {
		t.Fatalf("*.md category hits = %v", lines)
	}
	single, _ := docsTool(t, env, fixture.accessID, session, "doc_glob", jsonObject(map[string]string{"pattern": "guides/*.md", "scope": "category"}))
	lines := matchedLines(single)
	if len(lines) != 1 || !strings.Contains(lines[0], "guides/setup.md") {
		t.Fatalf("guides/*.md hits = %v", lines)
	}
	if strings.Contains(single, "guides/sub/a.md") {
		t.Fatalf("guides/*.md must not cross a slash: %v", single)
	}
	publicOnly, _ := docsTool(t, env, fixture.accessID, session, "doc_glob", jsonObject(map[string]string{"pattern": "*.md", "scope": "public"}))
	if lines := matchedLines(publicOnly); len(lines) != 1 || !strings.Contains(lines[0], "[public]") {
		t.Fatalf("public scope hits = %v", lines)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_glob", jsonObject(map[string]string{"pattern": "[bad"})); !isError {
		t.Fatalf("invalid glob must fail: %q", text)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_glob", jsonObject(map[string]string{"scope": "nowhere"})); !isError {
		t.Fatalf("invalid scope must fail: %q", text)
	}
}

func TestDocsMCPGrepAndReadContract(t *testing.T) {
	env := setup(t)
	fixture := newDocsWorkspace(t, env, "文档区")
	session := docsMCPSession(t, env, fixture.accessID)
	long := strings.Repeat("payload line\n", 1000) + "TARGET-MARKER\n"
	createDoc(t, env, fixture.workspaceID, "category", fixture.categoryID, "long.md", long)
	createDoc(t, env, fixture.workspaceID, "category", fixture.categoryID, "other.md", "TARGET-MARKER elsewhere\n")

	full, isError := docsTool(t, env, fixture.accessID, session, "doc_read", jsonObject(map[string]string{"path": "long.md"}))
	if isError || !strings.Contains(full, "TARGET-MARKER") {
		t.Fatalf("full read must not truncate: %v", isError)
	}
	if len(full) < 12000 {
		t.Fatalf("full read length = %d, want the whole body", len(full))
	}
	ranged, isError := docsTool(t, env, fixture.accessID, session, "doc_read",
		jsonObject(map[string]string{"path": "long.md", "offset": "2", "limit": "3"}))
	if isError || !strings.Contains(ranged, "第 2~4 行") || !strings.Contains(ranged, "2: payload line") {
		t.Fatalf("ranged read = %q %v", ranged, isError)
	}
	if _, isError := docsTool(t, env, fixture.accessID, session, "doc_read", jsonObject(map[string]string{"path": "ghost.md"})); !isError {
		t.Fatal("reading a missing document must fail")
	}
	publicDoc := createDoc(t, env, fixture.workspaceID, "public", "", "public.md", "public body")
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_read",
		jsonObject(map[string]string{"path": "public.md", "scope": "public"})); isError || !strings.Contains(text, "public body") {
		t.Fatalf("public read = %q %v", text, isError)
	}
	_ = publicDoc

	grep, isError := docsTool(t, env, fixture.accessID, session, "doc_grep", jsonObject(map[string]string{"pattern": "TARGET-MARKER"}))
	if isError || !strings.Contains(grep, "long.md:1001: TARGET-MARKER") || !strings.Contains(grep, "other.md:1: TARGET-MARKER") {
		t.Fatalf("doc_grep hits = %q %v", grep, isError)
	}
	scoped, _ := docsTool(t, env, fixture.accessID, session, "doc_grep",
		jsonObject(map[string]string{"pattern": "TARGET-MARKER", "path": "other.md"}))
	if strings.Contains(scoped, "long.md") || !strings.Contains(scoped, "other.md") {
		t.Fatalf("doc_grep path filter = %q", scoped)
	}
	regex, isError := docsTool(t, env, fixture.accessID, session, "doc_grep",
		jsonObject(map[string]string{"pattern": "^payload line$", "is_regex": "true", "limit": "5"}))
	if isError || !strings.Contains(regex, "已达 limit 5") {
		t.Fatalf("regex grep + limit = %q %v", regex, isError)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_grep",
		jsonObject(map[string]string{"pattern": "[", "is_regex": "true"})); !isError {
		t.Fatalf("invalid regex must fail: %q", text)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_grep", jsonObject(map[string]string{"pattern": ""})); !isError {
		t.Fatalf("empty pattern must fail: %q", text)
	}
}

func TestDocsMCPWriteContract(t *testing.T) {
	env := setup(t)
	fixture := newDocsWorkspace(t, env, "文档区")
	session := docsMCPSession(t, env, fixture.accessID)
	createDoc(t, env, fixture.workspaceID, "public", "", "public.md", "public original")

	created, isError := docsTool(t, env, fixture.accessID, session, "doc_create",
		jsonObject(map[string]string{"path": "notes.md", "content": "alpha\nbeta\nalpha"}))
	if isError || !strings.Contains(created, "已新建文档") || !strings.Contains(created, "| 子项目 ") {
		t.Fatalf("doc_create = %q %v", created, isError)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_create",
		jsonObject(map[string]string{"path": "notes.md", "content": "again"})); !isError {
		t.Fatalf("duplicate create must fail: %q", text)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_create",
		jsonObject(map[string]string{"path": "blocked.md", "content": "x", "scope": "public"})); !isError || !strings.Contains(text, "公共文档区为只读") {
		t.Fatalf("public create must fail: %q %v", text, isError)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_create",
		jsonObject(map[string]string{"path": "a//b.md", "content": "x"})); !isError {
		t.Fatalf("bad path must fail: %q", text)
	}

	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_write",
		jsonObject(map[string]string{"path": "ghost.md", "content": "x"})); !isError {
		t.Fatalf("write on missing must fail: %q", text)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_write",
		jsonObject(map[string]string{"path": "public.md", "content": "hacked", "scope": "public"})); !isError {
		t.Fatalf("public write must fail: %q", text)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_write",
		jsonObject(map[string]string{"path": "notes.md", "content": "replaced"})); isError || !strings.Contains(text, "已覆盖文档") {
		t.Fatalf("doc_write = %q %v", text, isError)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_edit",
		jsonObject(map[string]string{"path": "notes.md", "old_string": "replaced", "new_string": "edited"})); isError {
		t.Fatalf("unique doc_edit = %q %v", text, isError)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_edit",
		jsonObject(map[string]string{"path": "notes.md", "old_string": "", "new_string": "x"})); !isError {
		t.Fatalf("empty old_string must fail: %q", text)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_edit",
		jsonObject(map[string]string{"path": "notes.md", "old_string": "same", "new_string": "same"})); !isError {
		t.Fatalf("identical strings must fail: %q", text)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_edit",
		jsonObject(map[string]string{"path": "notes.md", "old_string": "missing", "new_string": "x"})); !isError {
		t.Fatalf("no_match must fail: %q", text)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_edit",
		jsonObject(map[string]string{"path": "notes.md", "old_string": "e", "new_string": "3"})); !isError {
		t.Fatalf("ambiguous edit must fail: %q", text)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_edit",
		jsonObject(map[string]string{"path": "notes.md", "old_string": "e", "new_string": "3", "replace_all": "true"})); isError {
		t.Fatalf("replace_all edit = %q %v", text, isError)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_edit",
		jsonObject(map[string]string{"path": "public.md", "old_string": "original", "new_string": "x", "scope": "public"})); !isError {
		t.Fatalf("public edit must fail: %q", text)
	}

	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_delete",
		jsonObject(map[string]string{"path": "notes.md"})); isError {
		t.Fatalf("doc_delete = %q %v", text, isError)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_delete",
		jsonObject(map[string]string{"path": "notes.md"})); !isError {
		t.Fatalf("second delete must fail: %q", text)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_delete",
		jsonObject(map[string]string{"path": "public.md", "scope": "public"})); !isError {
		t.Fatalf("public delete must fail: %q", text)
	}

	// 公共文档经全部写原语尝试后仍保持原文。
	status, payload := env.envelope(t, "GET", "/api/workspaces/"+fixture.workspaceID+"/docs?scope=public", "")
	mustStatus(t, "public docs after write attempts", status, 200, payload)
	documentID := itemsOf(payload)[0].(map[string]any)["id"].(string)
	status, payload = env.envelope(t, "GET", "/api/workspaces/"+fixture.workspaceID+"/docs/"+documentID, "")
	mustStatus(t, "public detail", status, 200, payload)
	if dataOf(payload)["content"] != "public original" {
		t.Fatalf("public document was modified: %v", dataOf(payload))
	}
}

func TestMCPMemoryEndpointKeepsSevenTools(t *testing.T) {
	env := setup(t)
	session := mcpSession(t, env)
	list := mcpCall(t, env, session, "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\"}")
	result, _ := list["result"].(map[string]any)
	tools, _ := result["tools"].([]any)
	if len(tools) != 7 {
		t.Fatalf("memory endpoint tools = %d, want 7", len(tools))
	}
	for _, raw := range tools {
		name, _ := raw.(map[string]any)["name"].(string)
		if !strings.HasPrefix(name, "memory_") {
			t.Fatalf("unexpected tool on /mcp: %q", name)
		}
	}

	fixture := newDocsWorkspace(t, env, "文档区")
	docsSession := docsMCPSession(t, env, fixture.accessID)
	docsList := docsMCPCall(t, env, fixture.accessID, docsSession, "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\"}")
	docsResult, _ := docsList["result"].(map[string]any)
	docsTools, _ := docsResult["tools"].([]any)
	if len(docsTools) != 8 {
		t.Fatalf("docs endpoint tools = %d, want 8", len(docsTools))
	}
	for _, raw := range docsTools {
		name, _ := raw.(map[string]any)["name"].(string)
		if !strings.HasPrefix(name, "doc_") {
			t.Fatalf("unexpected tool on /mcp/docs: %q", name)
		}
	}
}

func TestDocsMCPMoveContract(t *testing.T) {
	env := setup(t)
	fixture := newDocsWorkspace(t, env, "文档区")
	session := docsMCPSession(t, env, fixture.accessID)
	createDoc(t, env, fixture.workspaceID, "public", "", "public.md", "public original")
	createDoc(t, env, fixture.workspaceID, "category", fixture.categoryID, "notes.md", "alpha body")
	createDoc(t, env, fixture.workspaceID, "category", fixture.categoryID, "target.md", "target original")

	// 公共文档区拒绝移动，公共正文不受任何影响。
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_move",
		`{"path":"public.md","new_path":"public-v2.md","scope":"public"}`); !isError || !strings.Contains(text, "公共文档区为只读") {
		t.Fatalf("public move must fail: %q %v", text, isError)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_move",
		`{"path":"notes.md","new_path":"notes.md"}`); !isError || !strings.Contains(text, "相同") {
		t.Fatalf("same path move must fail: %q %v", text, isError)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_move",
		`{"path":"notes.md","new_path":"a//b.md"}`); !isError {
		t.Fatalf("invalid target path must fail: %q %v", text, isError)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_move",
		`{"path":"ghost.md","new_path":"target.md","overwrite":true}`); !isError || !strings.Contains(text, "文档不存在") {
		t.Fatalf("missing source overwrite move must fail: %q %v", text, isError)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_read",
		`{"path":"target.md"}`); isError || !strings.Contains(text, "target original") {
		t.Fatalf("target doc must remain intact after missing source move: %q %v", text, isError)
	}

	// 单篇重命名与跨文件夹移动。
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_move",
		`{"path":"notes.md","new_path":"archive/notes-v2.md"}`); isError || !strings.Contains(text, "已移动文档：notes.md -> archive/notes-v2.md") {
		t.Fatalf("single doc_move = %q %v", text, isError)
	}
	if _, isError := docsTool(t, env, fixture.accessID, session, "doc_read", `{"path":"notes.md"}`); !isError {
		t.Fatal("old path must not exist after move")
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_read",
		`{"path":"archive/notes-v2.md"}`); isError || !strings.Contains(text, "alpha body") {
		t.Fatalf("read moved doc = %q %v", text, isError)
	}

	// 目标已存在时默认拒绝，显式 overwrite=true 覆盖成功。
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_move",
		`{"path":"archive/notes-v2.md","new_path":"target.md"}`); !isError || !strings.Contains(text, "拒绝覆盖") {
		t.Fatalf("duplicate move without overwrite must fail: %q %v", text, isError)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_move",
		`{"path":"archive/notes-v2.md","new_path":"target.md","overwrite":true}`); isError {
		t.Fatalf("overwrite doc_move = %q %v", text, isError)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_read",
		`{"path":"target.md"}`); isError || !strings.Contains(text, "alpha body") {
		t.Fatalf("read overwritten doc = %q %v", text, isError)
	}

	// 目录前缀批量移动：支持尾斜杠归一化、严守斜杠边界、向自身内部禁止、冲突回滚与覆盖。
	createDoc(t, env, fixture.workspaceID, "category", fixture.categoryID, "drafts/a.md", "draft a")
	createDoc(t, env, fixture.workspaceID, "category", fixture.categoryID, "drafts/sub/b.md", "draft b")
	createDoc(t, env, fixture.workspaceID, "category", fixture.categoryID, "drafts-other/c.md", "sibling dir")
	createDoc(t, env, fixture.workspaceID, "category", fixture.categoryID, "dest/keep.md", "keep me")
	createDoc(t, env, fixture.workspaceID, "category", fixture.categoryID, "dest/a.md", "old dest a")

	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_move",
		`{"path":"drafts","new_path":"drafts/sub","recursive":true}`); !isError || !strings.Contains(text, "源目录内部") {
		t.Fatalf("move into self must fail: %q %v", text, isError)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_move",
		`{"path":"drafts/","new_path":"dest/","recursive":true}`); !isError || !strings.Contains(text, "拒绝覆盖") {
		t.Fatalf("recursive conflict without overwrite must fail: %q %v", text, isError)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_read",
		`{"path":"drafts/sub/b.md"}`); isError || !strings.Contains(text, "draft b") {
		t.Fatalf("rollback must preserve drafts/sub/b.md: %q %v", text, isError)
	}
	if text, isError := docsTool(t, env, fixture.accessID, session, "doc_move",
		`{"path":"drafts/","new_path":"dest/","recursive":true,"overwrite":true}`); isError || !strings.Contains(text, "共 2 篇文档") {
		t.Fatalf("recursive overwrite doc_move = %q %v", text, isError)
	}
	for path, want := range map[string]string{
		"dest/a.md":         "draft a",
		"dest/sub/b.md":     "draft b",
		"dest/keep.md":      "keep me",
		"drafts-other/c.md": "sibling dir",
	} {
		if text, isError := docsTool(t, env, fixture.accessID, session, "doc_read",
			jsonObject(map[string]string{"path": path})); isError || !strings.Contains(text, want) {
			t.Fatalf("read %s = %q %v", path, text, isError)
		}
	}
}
