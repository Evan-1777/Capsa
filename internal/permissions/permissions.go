// Package permissions is the one place that decides effective permission and
// the admin identity. It sits below dal/auth in the import graph so every layer
// can share the same rule without importing the others, mirroring
// capsa/permissions.py and avoiding an import cycle.
package permissions

import (
	"os"
	"strings"
)

const (
	// AdminTokenEnv names the environment variable holding the admin token.
	AdminTokenEnv = "CAPSA_ADMIN_TOKEN"
	// AdminKeyID is the fixed identity of the environment-variable admin.
	AdminKeyID = "admin"
)

// AdminGrants is the fixed grant set of the admin identity: full write on all groups.
var AdminGrants = map[string]string{"*": "rw"}

// AdminToken reads the admin token on every call: rotation is an env change and
// a restart. An empty or whitespace-only value disables the admin channel.
func AdminToken() string {
	return strings.TrimSpace(os.Getenv(AdminTokenEnv))
}

// PermissionFor returns the effective permission for a group: a wildcard "rw"
// covers everything, an explicit group key wins over a wildcard fallback, and a
// wildcard "r" only covers groups without an explicit entry. It returns "" when
// no permission applies.
func PermissionFor(grants map[string]string, group string) string {
	if grants["*"] == "rw" {
		return "rw"
	}
	if permission, ok := grants[group]; ok {
		return permission
	}
	if grants["*"] == "r" {
		return "r"
	}
	return ""
}
