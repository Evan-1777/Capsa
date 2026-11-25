package integration

import (
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

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
	if data["key_id"] != "admin" || data["name"] != "Admin" {
		t.Fatalf("admin identity = %v", data)
	}

	// Database-backed wildcard admin key must also carry its name in /api/auth/me.
	handle, err := db.Shared()
	if err != nil {
		t.Fatalf("db.Shared: %v", err)
	}
	dbAdminID, dbAdminToken := auth.IssueKey()
	if err := dal.CreateKey(handle, dbAdminID, "db-admin", ids.HashToken(dbAdminToken), map[string]string{"*": "rw"}); err != nil {
		t.Fatalf("seed db admin key: %v", err)
	}
	dbAdminResp := env.request(t, "GET", "/api/auth/me", dbAdminToken, "")
	if dbAdminResp.StatusCode != 200 {
		t.Fatalf("db admin status = %d", dbAdminResp.StatusCode)
	}
	dbData, _ := decodeEnvelope(t, dbAdminResp)["data"].(map[string]any)
	if dbData["key_id"] != dbAdminID || dbData["name"] != "db-admin" {
		t.Fatalf("db admin identity = %v", dbData)
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

	blank := env.request(t, "POST", "/mcp", "   \t ", "{}")
	defer blank.Body.Close()
	if blank.StatusCode != 401 {
		t.Fatalf("whitespace bearer status = %d, want 401", blank.StatusCode)
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
	if len(tools) != 11 {
		t.Fatalf("expected 11 tools, got %d", len(tools))
	}
	for _, raw := range tools {
		tool, _ := raw.(map[string]any)
		if tool["name"] == "memory_peek" {
			t.Fatal("memory_peek must be removed")
		}
	}

	call := mcpCall(t, env, session, `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"memory_groups","arguments":{}}}`)
	callResult, _ := call["result"].(map[string]any)
	content, _ := callResult["content"].([]any)
	if len(content) == 0 {
		t.Fatal("memory_groups returned no content")
	}
	first, _ := content[0].(map[string]any)
	if !strings.HasPrefix(first["text"].(string), "# 可访问组别") {
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

func readGzipBody(t *testing.T, resp *http.Response) string {
	t.Helper()
	defer resp.Body.Close()
	if resp.Header.Get("Content-Encoding") != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", resp.Header.Get("Content-Encoding"))
	}
	reader, err := gzip.NewReader(resp.Body)
	if err != nil {
		t.Fatalf("gzip.NewReader: %v", err)
	}
	defer reader.Close()
	raw, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read gunzipped body: %v", err)
	}
	return string(raw)
}

func TestStaticCacheAndGzipIsolatedFromMCP(t *testing.T) {
	env := setup(t)
	// Disable transparent auto-decompression on Transport so we inspect wire Content-Encoding.
	rawClient := &http.Client{Transport: &http.Transport{DisableCompression: true}}

	// 1. Index HTML carries no-cache and on-demand gzip.
	reqIndex, _ := http.NewRequest("GET", env.server.URL+"/", nil)
	reqIndex.Header.Set("Accept-Encoding", "gzip")
	indexResp, err := rawClient.Do(reqIndex)
	if err != nil {
		t.Fatalf("get /: %v", err)
	}
	if indexResp.StatusCode != 200 {
		t.Fatalf("/ status = %d", indexResp.StatusCode)
	}
	if cc := indexResp.Header.Get("Cache-Control"); cc != "no-cache" {
		t.Fatalf("/ Cache-Control = %q, want no-cache", cc)
	}
	indexHTML := readGzipBody(t, indexResp)

	// SPA fallback route also serves no-cache + gzip.
	reqFallback, _ := http.NewRequest("GET", env.server.URL+"/workspaces/nonexistent", nil)
	reqFallback.Header.Set("Accept-Encoding", "gzip")
	fbResp, err := rawClient.Do(reqFallback)
	if err != nil {
		t.Fatalf("get fallback: %v", err)
	}
	if cc := fbResp.Header.Get("Cache-Control"); cc != "no-cache" {
		t.Fatalf("fallback Cache-Control = %q, want no-cache", cc)
	}
	_ = readGzipBody(t, fbResp)

	// 2. Hashed /assets/* JS bundle carries immutable Cache-Control and gzip.
	assetMatch := regexp.MustCompile(`/assets/[^"'\s>]+\.js`).FindString(indexHTML)
	if assetMatch == "" {
		t.Fatalf("could not locate /assets/*.js reference in index.html: %s", indexHTML)
	}
	reqAsset, _ := http.NewRequest("GET", env.server.URL+assetMatch, nil)
	reqAsset.Header.Set("Accept-Encoding", "gzip")
	assetResp, err := rawClient.Do(reqAsset)
	if err != nil {
		t.Fatalf("get %s: %v", assetMatch, err)
	}
	if assetResp.StatusCode != 200 {
		t.Fatalf("asset status = %d", assetResp.StatusCode)
	}
	if cc := assetResp.Header.Get("Cache-Control"); !strings.Contains(cc, "immutable") || !strings.Contains(cc, "max-age=31536000") {
		t.Fatalf("asset Cache-Control = %q, want immutable + max-age=31536000", cc)
	}
	if !strings.Contains(assetResp.Header.Get("Vary"), "Accept-Encoding") {
		t.Fatalf("asset Vary = %q, want Accept-Encoding", assetResp.Header.Get("Vary"))
	}
	if jsBody := readGzipBody(t, assetResp); len(jsBody) == 0 {
		t.Fatal("asset gunzipped body must not be empty")
	}

	// 3. /mcp and /mcp/docs stay uncompressed and preserve streaming headers even with Accept-Encoding: gzip.
	handle, err := db.Shared()
	if err != nil {
		t.Fatalf("db.Shared: %v", err)
	}
	ws, err := dal.CreateWorkspace(handle, "docs-ws", "", "docs", 0)
	if err != nil {
		t.Fatalf("create docs workspace: %v", err)
	}
	cat, err := dal.CreateDocCategory(handle, ws["id"].(string), "cat", "")
	if err != nil {
		t.Fatalf("create doc category: %v", err)
	}
	docAccessID := cat["access_id"].(string)

	for _, ep := range []struct {
		path  string
		token string
	}{
		{"/mcp", adminToken},
		{"/mcp/docs", docAccessID},
	} {
		reqMCP, _ := http.NewRequest("POST", env.server.URL+ep.path,
			strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}`))
		reqMCP.Header.Set("Authorization", "Bearer "+ep.token)
		reqMCP.Header.Set("Content-Type", "application/json")
		reqMCP.Header.Set("Accept", "application/json, text/event-stream")
		reqMCP.Header.Set("Accept-Encoding", "gzip")
		mcpResp, err := rawClient.Do(reqMCP)
		if err != nil {
			t.Fatalf("post %s: %v", ep.path, err)
		}
		mcpResp.Body.Close()
		if mcpResp.StatusCode != 200 {
			t.Fatalf("%s status = %d", ep.path, mcpResp.StatusCode)
		}
		if ce := mcpResp.Header.Get("Content-Encoding"); ce != "" {
			t.Fatalf("%s Content-Encoding = %q, want empty (uncompressed)", ep.path, ce)
		}
		if mcpResp.Header.Get("X-Accel-Buffering") != "no" {
			t.Fatalf("%s X-Accel-Buffering = %q, want no", ep.path, mcpResp.Header.Get("X-Accel-Buffering"))
		}
		if !strings.Contains(mcpResp.Header.Get("Cache-Control"), "no-transform") {
			t.Fatalf("%s Cache-Control = %q, want no-transform", ep.path, mcpResp.Header.Get("Cache-Control"))
		}
	}
}

func mcpCallWithToken(t *testing.T, env *testEnv, token, session, body string) map[string]any {
	t.Helper()
	request, err := http.NewRequest("POST", env.server.URL+"/mcp", strings.NewReader(body))
	if err != nil {
		t.Fatalf("new mcp request: %v", err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
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
	var payload map[string]any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode mcp: %v", err)
	}
	return payload
}

func mcpSessionForToken(t *testing.T, env *testEnv, token string) string {
	t.Helper()
	request, _ := http.NewRequest("POST", env.server.URL+"/mcp",
		strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}`))
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("initialize: %v", err)
	}
	defer response.Body.Close()
	return response.Header.Get("Mcp-Session-Id")
}

func mcpToolCall(t *testing.T, env *testEnv, token, session, name, argsJSON string) (string, bool) {
	t.Helper()
	body := fmt.Sprintf(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":%q,"arguments":%s}}`, name, argsJSON)
	payload := mcpCallWithToken(t, env, token, session, body)
	result, _ := payload["result"].(map[string]any)
	isError, _ := result["isError"].(bool)
	return mcpText(payload), isError
}

func TestMCPNewToolsAndLifecycle(t *testing.T) {
	env := setup(t)
	handle, err := db.Shared()
	if err != nil {
		t.Fatalf("db.Shared: %v", err)
	}
	// Seed a partial key (proj:rw, study:r) and a read-only key (proj:r).
	partialID, partialToken := auth.IssueKey()
	if err := dal.CreateKey(handle, partialID, "partial", ids.HashToken(partialToken), map[string]string{"proj": "rw", "study": "r"}); err != nil {
		t.Fatalf("seed partial key: %v", err)
	}
	roID, roToken := auth.IssueKey()
	if err := dal.CreateKey(handle, roID, "ro", ids.HashToken(roToken), map[string]string{"proj": "r"}); err != nil {
		t.Fatalf("seed ro key: %v", err)
	}

	adminSess := mcpSessionForToken(t, env, adminToken)
	partialSess := mcpSessionForToken(t, env, partialToken)
	roSess := mcpSessionForToken(t, env, roToken)

	future := time.Now().UTC().Add(48 * time.Hour).Format(time.RFC3339)
	past := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)

	// 1. Mutual exclusivity & past expires_at rejection on memory_save.
	if _, isErr := mcpToolCall(t, env, adminToken, adminSess, "memory_save",
		fmt.Sprintf(`{"group":"proj","title":"bad","summary":"s","body":"b","persistent":true,"expires_at":%q}`, future)); !isErr {
		t.Fatal("persistent+expires_at must fail")
	}
	if _, isErr := mcpToolCall(t, env, adminToken, adminSess, "memory_save",
		fmt.Sprintf(`{"group":"proj","title":"bad2","summary":"s","body":"b","expires_at":%q}`, past)); !isErr {
		t.Fatal("past expires_at must fail")
	}

	// 2. Seed persistent, temporary, shallow, deep memories.
	pID, err := dal.InsertMemory(handle, "proj", "持久条目", "持久摘要", "持久正文", []string{"pin"}, true, nil, nil)
	if err != nil {
		t.Fatalf("insert persistent: %v", err)
	}
	tID, err := dal.InsertMemory(handle, "proj", "临时条目", "临时摘要", "临时正文", []string{"tmp"}, false, &future, nil)
	if err != nil {
		t.Fatalf("insert temporary: %v", err)
	}
	sID, err := dal.InsertMemory(handle, "proj", "浅层条目", "浅层摘要", "BodyOnlyNeedle 浅层正文", []string{"TagOnlyNeedle"}, false, nil, nil)
	if err != nil {
		t.Fatalf("insert shallow: %v", err)
	}
	dID, err := dal.InsertMemory(handle, "proj", "深层条目", "深层摘要", "深层正文", []string{}, false, nil, nil)
	if err != nil {
		t.Fatalf("insert deep: %v", err)
	}
	fiveMonthsAgo := time.Now().UTC().AddDate(0, -5, 0).Format("2006-01-02T15:04:05.000000-07:00")
	if _, err := handle.Exec("UPDATE memories SET updated_at = ? WHERE id = ?", fiveMonthsAgo, dID); err != nil {
		t.Fatalf("backdate deep: %v", err)
	}

	// 3. memory_catalog four depths + unified order (persistent > temporary > shallow) + dynamic shallow_months.
	text, isErr := mcpToolCall(t, env, adminToken, adminSess, "memory_catalog", `{"depth":"shallow"}`)
	if isErr || !strings.Contains(text, "持久条目") || !strings.Contains(text, "临时条目") || !strings.Contains(text, "浅层条目") || strings.Contains(text, "深层条目") {
		t.Fatalf("catalog shallow unexpected: %s", text)
	}
	if strings.Index(text, "持久条目") > strings.Index(text, "临时条目") || strings.Index(text, "临时条目") > strings.Index(text, "浅层条目") {
		t.Fatalf("catalog order violated: %s", text)
	}
	deeperText, isErr := mcpToolCall(t, env, adminToken, adminSess, "memory_catalog", `{"depth":"deeper"}`)
	if isErr || !strings.Contains(deeperText, "深层条目") || strings.Contains(deeperText, "浅层条目") {
		t.Fatalf("catalog deeper unexpected: %s", deeperText)
	}
	// Raise default workspace shallow_months to 12 => dID becomes shallow immediately.
	status, payload := env.envelope(t, "PUT", "/api/workspaces/default", `{"shallow_months":12}`)
	mustStatus(t, "update shallow_months=12", status, 200, payload)
	text12, _ := mcpToolCall(t, env, adminToken, adminSess, "memory_catalog", `{"depth":"shallow"}`)
	if !strings.Contains(text12, "深层条目") {
		t.Fatalf("updating shallow_months=12 should promote 5-month-old entry: %s", text12)
	}
	// Restore shallow_months to 3.
	status, payload = env.envelope(t, "PUT", "/api/workspaces/default", `{"shallow_months":3}`)
	mustStatus(t, "restore shallow_months=3", status, 200, payload)

	// 4. memory_search search_in isolation (tags / body) & return_fields.
	tagHit, isErr := mcpToolCall(t, env, adminToken, adminSess, "memory_search", `{"query":"TagOnlyNeedle","search_in":["tags"]}`)
	if isErr || !strings.Contains(tagHit, sID) {
		t.Fatalf("search_in=[tags] should hit: %s", tagHit)
	}
	bodyMiss, _ := mcpToolCall(t, env, adminToken, adminSess, "memory_search", `{"query":"TagOnlyNeedle","search_in":["body"]}`)
	if strings.Contains(bodyMiss, sID) {
		t.Fatalf("search_in=[body] must not hit tags: %s", bodyMiss)
	}
	bodyHit, isErr := mcpToolCall(t, env, adminToken, adminSess, "memory_search", `{"query":"BodyOnlyNeedle","search_in":["body"],"return_fields":["title","summary"]}`)
	if isErr || !strings.Contains(bodyHit, "浅层摘要") {
		t.Fatalf("search_in=[body] with summary return_fields failed: %s", bodyHit)
	}

	// 5. memory_edit exact replace, ambiguity block, replace_all, and ro denial.
	if _, isErr := mcpToolCall(t, env, roToken, roSess, "memory_edit",
		fmt.Sprintf(`{"id":%q,"old_string":"浅层正文","new_string":"x"}`, sID)); !isErr {
		t.Fatal("ro key must not edit")
	}
	editOut, isErr := mcpToolCall(t, env, adminToken, adminSess, "memory_edit",
		fmt.Sprintf(`{"id":%q,"old_string":"浅层正文","new_string":"浅层正文-已改"}`, sID))
	if isErr || !strings.Contains(editOut, "替换 1 处") {
		t.Fatalf("memory_edit failed: %s", editOut)
	}
	// Editing deep memory promotes it back to shallow because updated_at refreshes.
	if _, isErr := mcpToolCall(t, env, adminToken, adminSess, "memory_edit",
		fmt.Sprintf(`{"id":%q,"old_string":"深层正文","new_string":"深层正文-刷新"}`, dID)); isErr {
		t.Fatal("edit deep memory failed")
	}
	afterPromote, _ := mcpToolCall(t, env, adminToken, adminSess, "memory_catalog", `{"depth":"shallow"}`)
	if !strings.Contains(afterPromote, "深层条目") {
		t.Fatalf("edited deep memory should promote to shallow: %s", afterPromote)
	}

	// 6. Trash read + permission masking + restore persistent with expires_at clears pinned.
	if _, isErr := mcpToolCall(t, env, adminToken, adminSess, "memory_forget",
		fmt.Sprintf(`{"id":%q,"reason":"归档测试"}`, pID)); isErr {
		t.Fatal("forget persistent failed")
	}
	// Unauthorized group (life) trash entry must return [无权访问] for partial key.
	lifeID, err := dal.InsertMemory(handle, "life", "私密生活", "摘要", "正文", nil, false, nil, nil)
	if err != nil {
		t.Fatalf("insert life: %v", err)
	}
	if _, err := dal.SoftDeleteMemory(handle, lifeID, "清理"); err != nil {
		t.Fatalf("soft delete life: %v", err)
	}
	readAuth, isErr := mcpToolCall(t, env, partialToken, partialSess, "memory_read", fmt.Sprintf(`{"ids":[%q,%q]}`, pID, lifeID))
	if isErr || !strings.Contains(readAuth, "持久正文") || !strings.Contains(readAuth, "[无权访问]") || strings.Contains(readAuth, "life") {
		t.Fatalf("memory_read trash masking failed: %s", readAuth)
	}
	// Restore persistent memory with expires_at => atomically clears pinned.
	if _, isErr := mcpToolCall(t, env, adminToken, adminSess, "memory_restore",
		fmt.Sprintf(`{"id":%q,"expires_at":%q}`, pID, future)); isErr {
		t.Fatal("restore persistent with expires_at failed")
	}
	row, _ := dal.GetMemoryForWeb(handle, pID)
	if row["pinned"] != int64(0) || row["expires_at"] == nil {
		t.Fatalf("restore with expires_at must clear pinned: pinned=%v expires_at=%v", row["pinned"], row["expires_at"])
	}

	// 7. memory_empty_trash scope isolation: partial key (proj:rw, study:r) must only empty proj.
	studyTrash, _ := dal.InsertMemory(handle, "study", "学习回收", "s", "b", nil, false, nil, nil)
	_, _ = dal.SoftDeleteMemory(handle, studyTrash, "del")
	_, _ = dal.SoftDeleteMemory(handle, tID, "del")
	if _, isErr := mcpToolCall(t, env, roToken, roSess, "memory_empty_trash", `{}`); !isErr {
		t.Fatal("ro key must not empty trash")
	}
	emptyOut, isErr := mcpToolCall(t, env, partialToken, partialSess, "memory_empty_trash", `{}`)
	if isErr || !strings.Contains(emptyOut, "1") {
		t.Fatalf("partial empty trash unexpected: %s", emptyOut)
	}
	if left, _ := dal.GetMemoryForWeb(handle, studyTrash); left == nil {
		t.Fatal("partial empty trash must not delete read-only group study")
	}
	if left, _ := dal.GetMemoryForWeb(handle, lifeID); left == nil {
		t.Fatal("partial empty trash must not delete unauthorized group life")
	}
}

func TestWebAPIv2Contracts(t *testing.T) {
	env := setup(t)
	handle, err := db.Shared()
	if err != nil {
		t.Fatalf("db.Shared: %v", err)
	}

	// 1. Workspace shallow_months strict validation.
	for _, body := range []string{
		`{"shallow_months":true}`,
		`{"shallow_months":1.5}`,
		`{"shallow_months":0}`,
		`{"shallow_months":121}`,
	} {
		status, payload := env.envelope(t, "PUT", "/api/workspaces/default", body)
		mustStatus(t, "invalid shallow_months "+body, status, 422, payload)
	}
	docsWs := newDocsWorkspace(t, env, "文档不可配N")
	status, payload := env.envelope(t, "PUT", "/api/workspaces/"+docsWs.workspaceID, `{"shallow_months":6}`)
	mustStatus(t, "docs workspace shallow_months rejected", status, 422, payload)

	// 2. status=overdue rejected; tier filtering works.
	status, payload = env.envelope(t, "GET", "/api/memories?status=overdue", "")
	mustStatus(t, "overdue status rejected", status, 422, payload)

	future := time.Now().UTC().Add(72 * time.Hour).Format(time.RFC3339)
	status, payload = env.envelope(t, "POST", "/api/memories",
		`{"group":"proj","title":"Web持久","summary":"s","body":"b","persistent":true}`)
	mustStatus(t, "create persistent", status, 200, payload)
	status, payload = env.envelope(t, "POST", "/api/memories",
		fmt.Sprintf(`{"group":"proj","title":"Web临时","summary":"s","body":"b","expires_at":%q}`, future))
	mustStatus(t, "create temporary", status, 200, payload)
	tempID := dataOf(payload)["id"].(string)

	status, payload = env.envelope(t, "GET", "/api/memories?tier=persistent", "")
	mustStatus(t, "tier persistent", status, 200, payload)
	if len(itemsOf(payload)) != 1 {
		t.Fatalf("tier=persistent count = %d, want 1", len(itemsOf(payload)))
	}
	firstItem := itemsOf(payload)[0].(map[string]any)
	if _, hasPinned := firstItem["pinned"]; hasPinned {
		t.Fatal("web response must not leak pinned column")
	}
	if _, hasShallow := firstItem["shallow_months"]; hasShallow {
		t.Fatal("web response must not leak shallow_months column")
	}

	// 3. Purge & empty trash (with empty JSON body).
	status, payload = env.envelope(t, "DELETE", "/api/memories/"+tempID+"/purge", "")
	mustStatus(t, "purge active must 404", status, 404, payload)
	status, payload = env.envelope(t, "DELETE", "/api/memories/"+tempID, `{"reason":"清理"}`)
	mustStatus(t, "soft delete", status, 200, payload)
	status, payload = env.envelope(t, "DELETE", "/api/memories/"+tempID+"/purge", "")
	mustStatus(t, "purge deleted", status, 200, payload)

	status, payload = env.envelope(t, "POST", "/api/memories/trash/empty", "")
	mustStatus(t, "empty trash with empty body", status, 200, payload)

	// 4. PUT /api/keys/{id}: online edit, revoked block, self-lock prevention.
	dbAdminID, dbAdminToken := auth.IssueKey()
	if err := dal.CreateKey(handle, dbAdminID, "WebAdmin", ids.HashToken(dbAdminToken), map[string]string{"*": "rw"}); err != nil {
		t.Fatalf("seed db admin: %v", err)
	}
	// Self-lock attempt must return 422.
	resp := env.request(t, "PUT", "/api/keys/"+dbAdminID, dbAdminToken, `{"scopes":{"proj":"rw"}}`)
	if resp.StatusCode != 422 {
		t.Fatalf("self-lock downgrade status = %d, want 422", resp.StatusCode)
	}
	resp.Body.Close()
	// Renaming current admin key succeeds and returns full KeyRecord.
	resp = env.request(t, "PUT", "/api/keys/"+dbAdminID, dbAdminToken, `{"name":"WebAdmin-New"}`)
	if resp.StatusCode != 200 {
		t.Fatalf("rename current admin key status = %d", resp.StatusCode)
	}
	keyData := dataOf(decodeEnvelope(t, resp))
	if keyData["name"] != "WebAdmin-New" || keyData["created_at"] == nil {
		t.Fatalf("updated key record incomplete: %v", keyData)
	}
	// Revoked key cannot be edited.
	agentID, agentToken := auth.IssueKey()
	if err := dal.CreateKey(handle, agentID, "Agent", ids.HashToken(agentToken), map[string]string{"proj": "r"}); err != nil {
		t.Fatalf("seed agent key: %v", err)
	}
	status, payload = env.envelope(t, "PUT", "/api/keys/"+agentID, `{"name":"Agent-RW","scopes":{"proj":"rw"}}`)
	mustStatus(t, "edit active agent key", status, 200, payload)
	status, payload = env.envelope(t, "POST", "/api/keys/"+agentID+"/revoke", "")
	mustStatus(t, "revoke agent key", status, 200, payload)
	status, payload = env.envelope(t, "PUT", "/api/keys/"+agentID, `{"name":"Blocked"}`)
	mustStatus(t, "edit revoked key rejected", status, 422, payload)
}
