package auth

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"capsa/internal/dal"
	"capsa/internal/db"
	"capsa/internal/ids"
)

// captureAuth returns a handler that records the Authorization header it sees.
func captureAuth(seen *string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*seen = r.Header.Get("Authorization")
	})
}

func TestQueryTokenInjection(t *testing.T) {
	cases := []struct {
		name   string
		target string
		header string
		want   string
	}{
		{"token injected", "/mcp?token=abc123", "", "Bearer abc123"},
		{"access_token fallback", "/mcp?access_token=xyz", "", "Bearer xyz"},
		{"token wins over access_token", "/mcp?token=first&access_token=second", "", "Bearer first"},
		{"header has priority", "/mcp?token=abc", "Bearer real", "Bearer real"},
		{"empty value ignored", "/mcp?token=", "", ""},
		{"whitespace ignored", "/mcp?token=%20%20", "", ""},
		{"crlf ignored", "/mcp?token=abc%0d%0aevil", "", ""},
		{"non-ascii ignored", "/mcp?token=%E4%B8%AD", "", ""},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			var seen string
			handler := QueryTokenAuth(captureAuth(&seen))
			request := httptest.NewRequest("POST", testCase.target, nil)
			if testCase.header != "" {
				request.Header.Set("Authorization", testCase.header)
			}
			handler.ServeHTTP(httptest.NewRecorder(), request)
			if seen != testCase.want {
				t.Fatalf("Authorization = %q, want %q", seen, testCase.want)
			}
		})
	}
}

func TestVerifyTokenAdmin(t *testing.T) {
	t.Setenv("CAPSA_DB_PATH", filepath.Join(t.TempDir(), "capsa.db"))
	t.Setenv("CAPSA_ADMIN_TOKEN", "admin-secret")
	token, err := VerifyToken("admin-secret")
	if err != nil || token == nil {
		t.Fatalf("admin verify: %v %v", token, err)
	}
	if token.KeyID != "admin" || token.Grants["*"] != "rw" {
		t.Fatalf("unexpected admin identity: %#v", token)
	}
}

func TestVerifyTokenDatabaseKey(t *testing.T) {
	t.Setenv("CAPSA_DB_PATH", filepath.Join(t.TempDir(), "capsa.db"))
	t.Setenv("CAPSA_ADMIN_TOKEN", "")
	handle, err := db.Connect()
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer handle.Close()
	if err := db.InitSchema(handle); err != nil {
		t.Fatalf("init: %v", err)
	}
	plain := "capsa_deadbeef_secretsecretsecretsecretsecret"
	if err := dal.CreateKey(handle, "deadbeef", "name", ids.HashToken(plain), map[string]string{"proj": "rw"}); err != nil {
		t.Fatalf("create key: %v", err)
	}

	token, err := VerifyToken(plain)
	if err != nil || token == nil {
		t.Fatalf("verify: %v %v", token, err)
	}
	if token.KeyID != "deadbeef" || token.Grants["proj"] != "rw" {
		t.Fatalf("unexpected identity: %#v", token)
	}

	// The refresh must have recorded the access time.
	keys, err := dal.ListKeys(handle)
	if err != nil || len(keys) != 1 {
		t.Fatalf("list keys: %v %v", keys, err)
	}
	if keys[0]["last_used_at"] == nil {
		t.Fatal("last_used_at must be set after verification")
	}

	unknown, err := VerifyToken("capsa_nope_nope")
	if err != nil || unknown != nil {
		t.Fatalf("unknown token must not verify: %v %v", unknown, err)
	}
}
