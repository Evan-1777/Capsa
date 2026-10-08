package permissions

import "testing"

func TestPermissionFor(t *testing.T) {
	cases := []struct {
		name   string
		grants map[string]string
		group  string
		want   string
	}{
		{"wildcard rw covers all", map[string]string{"*": "rw"}, "anything", "rw"},
		{"explicit group wins over wildcard r", map[string]string{"*": "r", "proj": "rw"}, "proj", "rw"},
		{"wildcard r falls back", map[string]string{"*": "r"}, "other", "r"},
		{"explicit read", map[string]string{"proj": "r"}, "proj", "r"},
		{"no permission", map[string]string{"proj": "rw"}, "study", ""},
		{"empty grants", map[string]string{}, "proj", ""},
	}
	for _, testCase := range cases {
		if got := PermissionFor(testCase.grants, testCase.group); got != testCase.want {
			t.Fatalf("%s: PermissionFor = %q, want %q", testCase.name, got, testCase.want)
		}
	}
}

func TestAdminTokenTrim(t *testing.T) {
	t.Setenv(AdminTokenEnv, "  secret  ")
	if got := AdminToken(); got != "secret" {
		t.Fatalf("AdminToken = %q, want trimmed", got)
	}
	t.Setenv(AdminTokenEnv, "   ")
	if got := AdminToken(); got != "" {
		t.Fatalf("whitespace-only token must be disabled, got %q", got)
	}
}
