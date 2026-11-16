package auth

import (
	"crypto/subtle"
	"time"

	"capsa/internal/dal"
	"capsa/internal/db"
	"capsa/internal/ids"
	"capsa/internal/permissions"
)

const lastUsedTouchInterval = 60 * time.Second

// AccessToken is the verified identity of a caller: a key id, display name and grants.
type AccessToken struct {
	KeyID  string
	Name   string
	Grants map[string]string
}

// IssueKey generates a key id and its plaintext token. Pure generation, no
// database access.
func IssueKey() (string, string) {
	keyID := ids.NewKeyID()
	return keyID, ids.NewToken(keyID)
}

// DocAccessIdentity is the verified identity of a document MCP caller: one
// category inside one docs workspace.
type DocAccessIdentity struct {
	WorkspaceID   string
	WorkspaceName string
	CategoryID    string
	CategoryName  string
}

// VerifyDocAccessID resolves a category access id to its identity. Only the
// doc_categories.access_id column is consulted, so traditional key tokens and
// the environment admin token cannot reach /mcp/docs.
func VerifyDocAccessID(token string) (*DocAccessIdentity, error) {
	if token == "" {
		return nil, nil
	}
	handle, err := db.Shared()
	if err != nil {
		return nil, err
	}
	category, err := dal.FindDocCategoryByAccessID(handle, token)
	if err != nil || category == nil {
		return nil, err
	}
	return &DocAccessIdentity{
		WorkspaceID:   category["workspace_id"].(string),
		WorkspaceName: category["workspace_name"].(string),
		CategoryID:    category["category_id"].(string),
		CategoryName:  category["category_name"].(string),
	}, nil
}

func shouldTouchLastUsed(lastUsedRaw string, now time.Time) bool {
	if lastUsedRaw == "" {
		return true
	}
	lastUsed, err := db.ParseTimestamp(lastUsedRaw)
	if err != nil {
		return true
	}
	return now.Sub(lastUsed) >= lastUsedTouchInterval
}

// VerifyToken resolves a plaintext token to an identity. The admin token is
// checked in constant time before the database; otherwise the token hash is
// looked up on every request so revocation takes effect immediately, while
// last_used_at updates are throttled to once every 60 seconds.
func VerifyToken(token string) (*AccessToken, error) {
	if admin := permissions.AdminToken(); admin != "" && subtle.ConstantTimeCompare([]byte(token), []byte(admin)) == 1 {
		return &AccessToken{KeyID: permissions.AdminKeyID, Name: "Admin", Grants: permissions.AdminGrants}, nil
	}
	handle, err := db.Shared()
	if err != nil {
		return nil, err
	}
	key, err := dal.FindActiveKeyByHash(handle, ids.HashToken(token))
	if err != nil {
		return nil, err
	}
	if key == nil {
		return nil, nil
	}
	keyID := key["id"].(string)
	keyName, _ := key["name"].(string)
	lastUsedRaw, _ := key["last_used_at"].(string)
	if shouldTouchLastUsed(lastUsedRaw, time.Now().UTC()) {
		if err := dal.TouchLastUsedAt(handle, keyID); err != nil {
			return nil, err
		}
	}
	return &AccessToken{KeyID: keyID, Name: keyName, Grants: key["scopes"].(map[string]string)}, nil
}
