package auth

import (
	"capsa/internal/dal"
	"capsa/internal/db"
	"capsa/internal/ids"
	"capsa/internal/permissions"
)

// AccessToken is the verified identity of a caller: a key id and its grants.
type AccessToken struct {
	KeyID  string
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
	handle, err := db.Connect()
	if err != nil {
		return nil, err
	}
	defer handle.Close()
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

// VerifyToken resolves a plaintext token to an identity. The admin token is
// checked before the database; otherwise the token hash is looked up on every
// request so revocation takes effect immediately.
func VerifyToken(token string) (*AccessToken, error) {
	if admin := permissions.AdminToken(); admin != "" && token == admin {
		return &AccessToken{KeyID: permissions.AdminKeyID, Grants: permissions.AdminGrants}, nil
	}
	handle, err := db.Connect()
	if err != nil {
		return nil, err
	}
	defer handle.Close()
	key, err := dal.FindActiveKeyByHash(handle, ids.HashToken(token))
	if err != nil {
		return nil, err
	}
	if key == nil {
		return nil, nil
	}
	keyID := key["id"].(string)
	if err := dal.TouchLastUsedAt(handle, keyID); err != nil {
		return nil, err
	}
	return &AccessToken{KeyID: keyID, Grants: key["scopes"].(map[string]string)}, nil
}
