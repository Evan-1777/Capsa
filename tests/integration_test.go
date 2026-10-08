package integration

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"capsa/internal/auth"
	"capsa/internal/dal"
	"capsa/internal/db"
	"capsa/internal/ids"
	"capsa/internal/server"
)

const adminToken = "admin-secret"

type testEnv struct {
	server *httptest.Server
	rwKey  string
}

func setup(t *testing.T) *testEnv {
	t.Helper()
	t.Setenv("CAPSA_DB_PATH", filepath.Join(t.TempDir(), "capsa.db"))
	t.Setenv("CAPSA_ADMIN_TOKEN", adminToken)

	handle, err := db.Connect()
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := db.InitSchema(handle); err != nil {
		t.Fatalf("init: %v", err)
	}
	for _, slug := range []string{"proj", "study", "life", "track"} {
		if _, err := dal.AddGroup(handle, slug, slug, "d"); err != nil {
			t.Fatalf("seed group: %v", err)
		}
	}
	rwID, rwToken := auth.IssueKey()
	if err := dal.CreateKey(handle, rwID, "rw", ids.HashToken(rwToken), map[string]string{"proj": "rw"}); err != nil {
		t.Fatalf("seed key: %v", err)
	}
	handle.Close()

	ts := httptest.NewServer(server.NewHandler())
	t.Cleanup(ts.Close)
	return &testEnv{server: ts, rwKey: rwToken}
}

func (e *testEnv) request(t *testing.T, method, path, token, body string) *http.Response {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	request, err := http.NewRequest(method, e.server.URL+path, reader)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	return response
}

func decodeEnvelope(t *testing.T, response *http.Response) map[string]any {
	t.Helper()
	defer response.Body.Close()
	var payload map[string]any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	return payload
}

func errorCode(payload map[string]any) string {
	nested, _ := payload["error"].(map[string]any)
	code, _ := nested["code"].(string)
	return code
}

func TestHealthz(t *testing.T) {
	env := setup(t)
	response := env.request(t, "GET", "/healthz", "", "")
	if response.StatusCode != 200 {
		t.Fatalf("healthz status = %d", response.StatusCode)
	}
	response.Body.Close()
}

func TestWebAuthGates(t *testing.T) {
	env := setup(t)

	unauth := env.request(t, "GET", "/api/auth/me", "", "")
	if unauth.StatusCode != 401 {
		t.Fatalf("unauthenticated status = %d", unauth.StatusCode)
	}
	if code := errorCode(decodeEnvelope(t, unauth)); code != server.CodeUnauthorized {
		t.Fatalf("unauthenticated code = %q", code)
	}

	forbidden := env.request(t, "GET", "/api/auth/me", env.rwKey, "")
	if forbidden.StatusCode != 403 {
		t.Fatalf("non-admin status = %d", forbidden.StatusCode)
	}
	payload := decodeEnvelope(t, forbidden)
	if code := errorCode(payload); code != server.CodeForbidden {
		t.Fatalf("non-admin code = %q", code)
	}

	admin := env.request(t, "GET", "/api/auth/me", adminToken, "")
	if admin.StatusCode != 200 {
		t.Fatalf("admin status = %d", admin.StatusCode)
	}
	data, _ := decodeEnvelope(t, admin)["data"].(map[string]any)
	if data["key_id"] != "admin" {
		t.Fatalf("admin identity = %v", data)
	}
}

func TestMCPRequiresBearer(t *testing.T) {
	env := setup(t)
	response := env.request(t, "POST", "/mcp", "", "{}")
	defer response.Body.Close()
	if response.StatusCode != 401 {
		t.Fatalf("mcp status = %d", response.StatusCode)
	}
	if response.Header.Get("WWW-Authenticate") != "Bearer" {
		t.Fatalf("missing WWW-Authenticate: %q", response.Header.Get("WWW-Authenticate"))
	}
	body, _ := io.ReadAll(response.Body)
	if len(body) != 0 {
		t.Fatalf("401 body must be empty, got %q", body)
	}
}

func mcpCall(t *testing.T, env *testEnv, session, body string) map[string]any {
	t.Helper()
	request, err := http.NewRequest("POST", env.server.URL+"/mcp", strings.NewReader(body))
	if err != nil {
		t.Fatalf("new mcp request: %v", err)
	}
	request.Header.Set("Authorization", "Bearer "+adminToken)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	if session != "" {
		request.Header.Set("Mcp-Session-Id", session)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("mcp do: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		raw, _ := io.ReadAll(response.Body)
		t.Fatalf("mcp status = %d body=%s", response.StatusCode, raw)
	}
	if session == "" {
		if response.Header.Get("Mcp-Session-Id") == "" {
			t.Fatal("initialize must set Mcp-Session-Id")
		}
	}
	if response.Header.Get("X-Accel-Buffering") != "no" {
		t.Fatal("response must disable downstream buffering")
	}
	var payload map[string]any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode mcp: %v", err)
	}
	return payload
}

func TestMCPInitializeAndTools(t *testing.T) {
	env := setup(t)
	init := mcpCall(t, env, "", `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}`)
	result, _ := init["result"].(map[string]any)
	if result["protocolVersion"] != "2024-11-05" {
		t.Fatalf("protocol version = %v", result["protocolVersion"])
	}

	// Reuse the session via a fresh initialize to read the header, then list tools.
	request, _ := http.NewRequest("POST", env.server.URL+"/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}`))
	request.Header.Set("Authorization", "Bearer "+adminToken)
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("initialize: %v", err)
	}
	session := response.Header.Get("Mcp-Session-Id")
	response.Body.Close()

	list := mcpCall(t, env, session, `{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)
	listResult, _ := list["result"].(map[string]any)
	tools, _ := listResult["tools"].([]any)
	if len(tools) != 7 {
		t.Fatalf("expected 7 tools, got %d", len(tools))
	}

	call := mcpCall(t, env, session, `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"memory_groups","arguments":{}}}`)
	callResult, _ := call["result"].(map[string]any)
	content, _ := callResult["content"].([]any)
	if len(content) == 0 {
		t.Fatal("memory_groups returned no content")
	}
	first, _ := content[0].(map[string]any)
	if !strings.HasPrefix(first["text"].(string), "# 可访问分组") {
		t.Fatalf("unexpected groups text: %v", first["text"])
	}
}

func TestPayloadTooLarge(t *testing.T) {
	env := setup(t)
	oversize := strings.Repeat("a", server.MaxRequestBytes+100)
	response := env.request(t, "POST", "/api/groups", adminToken, oversize)
	defer response.Body.Close()
	if response.StatusCode != 413 {
		t.Fatalf("oversize status = %d", response.StatusCode)
	}
}

func TestValidationAndSideChannel(t *testing.T) {
	env := setup(t)

	bad := env.request(t, "POST", "/api/groups", adminToken, `{"slug":"-bad","name":"x"}`)
	if bad.StatusCode != 422 {
		t.Fatalf("bad slug status = %d", bad.StatusCode)
	}
	if code := errorCode(decodeEnvelope(t, bad)); code != server.CodeValidationError {
		t.Fatalf("bad slug code = %q", code)
	}

	missing := env.request(t, "GET", "/api/memories/mem_zzzzzz", adminToken, "")
	if missing.StatusCode != 404 {
		t.Fatalf("missing detail status = %d", missing.StatusCode)
	}
	payload := decodeEnvelope(t, missing)
	nested, _ := payload["error"].(map[string]any)
	if nested["message"] != "记忆不存在或无权访问" {
		t.Fatalf("unexpected 404 message: %v", nested["message"])
	}
}

func TestMemoryLifecycle(t *testing.T) {
	env := setup(t)

	create := env.request(t, "POST", "/api/memories", adminToken,
		`{"group":"proj","title":"标题","summary":"摘要","body":"正文"}`)
	if create.StatusCode != 200 {
		raw, _ := io.ReadAll(create.Body)
		t.Fatalf("create status = %d body=%s", create.StatusCode, raw)
	}
	data, _ := decodeEnvelope(t, create)["data"].(map[string]any)
	memoryID, _ := data["id"].(string)
	if !strings.HasPrefix(memoryID, "mem_") {
		t.Fatalf("unexpected memory id: %q", memoryID)
	}

	detail := env.request(t, "GET", "/api/memories/"+memoryID, adminToken, "")
	if detail.StatusCode != 200 {
		t.Fatalf("detail status = %d", detail.StatusCode)
	}
	detailData, _ := decodeEnvelope(t, detail)["data"].(map[string]any)
	if detailData["title"] != "标题" {
		t.Fatalf("unexpected title: %v", detailData["title"])
	}

	del := env.request(t, "DELETE", "/api/memories/"+memoryID, adminToken, `{"reason":"清理"}`)
	if del.StatusCode != 200 {
		t.Fatalf("delete status = %d", del.StatusCode)
	}

	// After deletion the detail returns the neutral 404.
	after := env.request(t, "GET", "/api/memories/"+memoryID, adminToken, "")
	if after.StatusCode != 404 {
		t.Fatalf("deleted detail status = %d", after.StatusCode)
	}
	after.Body.Close()

	restore := env.request(t, "POST", "/api/memories/"+memoryID+"/restore", adminToken, "")
	if restore.StatusCode != 200 {
		t.Fatalf("restore status = %d", restore.StatusCode)
	}
	restore.Body.Close()
}

func TestQueryTokenAuth(t *testing.T) {
	env := setup(t)
	// The admin token supplied via URL must authenticate /api/auth/me.
	response := env.request(t, "GET", "/api/auth/me?token="+adminToken, "", "")
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("query-token status = %d", response.StatusCode)
	}
}

func mcpText(payload map[string]any) string {
	result, _ := payload["result"].(map[string]any)
	content, _ := result["content"].([]any)
	if len(content) == 0 {
		return ""
	}
	first, _ := content[0].(map[string]any)
	text, _ := first["text"].(string)
	return text
}

func mcpSession(t *testing.T, env *testEnv) string {
	t.Helper()
	request, _ := http.NewRequest("POST", env.server.URL+"/mcp",
		strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}`))
	request.Header.Set("Authorization", "Bearer "+adminToken)
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("initialize: %v", err)
	}
	defer response.Body.Close()
	return response.Header.Get("Mcp-Session-Id")
}

func groupDescription(t *testing.T, env *testEnv, slug string) string {
	t.Helper()
	response := env.request(t, "GET", "/api/groups", adminToken, "")
	payload := decodeEnvelope(t, response)
	data, _ := payload["data"].(map[string]any)
	items, _ := data["items"].([]any)
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		if item["slug"] == slug {
			text, _ := item["description"].(string)
			return text
		}
	}
	t.Fatalf("group %s not found", slug)
	return ""
}

func TestGroupUpdateNullDoesNotClear(t *testing.T) {
	env := setup(t)
	before := groupDescription(t, env, "proj")
	response := env.request(t, "PUT", "/api/groups/proj", adminToken, `{"description":null}`)
	if response.StatusCode != 422 {
		raw, _ := io.ReadAll(response.Body)
		response.Body.Close()
		t.Fatalf("null description status = %d body=%s", response.StatusCode, raw)
	}
	response.Body.Close()
	if after := groupDescription(t, env, "proj"); after != before {
		t.Fatalf("description must not be cleared: %q -> %q", before, after)
	}
}

func TestMemoriesListEmptyStatusRejected(t *testing.T) {
	env := setup(t)
	response := env.request(t, "GET", "/api/memories?status=", adminToken, "")
	defer response.Body.Close()
	if response.StatusCode != 422 {
		t.Fatalf("empty status must be rejected, got %d", response.StatusCode)
	}
}

func TestMCPUpdateNullTagsAndFieldOrder(t *testing.T) {
	env := setup(t)
	create := env.request(t, "POST", "/api/memories", adminToken,
		`{"group":"proj","title":"原标题","summary":"原摘要","body":"正文","tags":["a","b"]}`)
	data, _ := decodeEnvelope(t, create)["data"].(map[string]any)
	memoryID, _ := data["id"].(string)
	session := mcpSession(t, env)

	tagsOf := func() []any {
		detail := env.request(t, "GET", "/api/memories/"+memoryID, adminToken, "")
		detailData, _ := decodeEnvelope(t, detail)["data"].(map[string]any)
		tags, _ := detailData["tags"].([]any)
		return tags
	}

	// tags: null is a no-op, and the field echo must not mention tags.
	nullTags := mcpCall(t, env, session,
		fmt.Sprintf(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"memory_update","arguments":{"id":%q,"title":"改后","tags":null}}}`, memoryID))
	if text := mcpText(nullTags); text != "已更新记忆："+memoryID+" | 字段: title" {
		t.Fatalf("tags:null must be a no-op, got %q", text)
	}
	if tags := tagsOf(); len(tags) != 2 {
		t.Fatalf("tags must be unchanged after null, got %v", tags)
	}

	// Field echo preserves insertion order (title before summary), matching Python.
	order := mcpCall(t, env, session,
		fmt.Sprintf(`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"memory_update","arguments":{"id":%q,"summary":"s2","title":"t2"}}}`, memoryID))
	if text := mcpText(order); !strings.HasSuffix(text, "字段: title, summary") {
		t.Fatalf("field order mismatch, got %q", text)
	}

	// tags: [] clears the list.
	mcpCall(t, env, session,
		fmt.Sprintf(`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"memory_update","arguments":{"id":%q,"tags":[]}}}`, memoryID))
	if tags := tagsOf(); len(tags) != 0 {
		t.Fatalf("tags:[] must clear, got %v", tags)
	}
}
