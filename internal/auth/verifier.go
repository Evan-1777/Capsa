package auth

import (
	"capsa/internal/dal"
	"capsa/internal/db"
	"capsa/internal/ids"
	"capsa/internal/permissions"
)

// AccessToken is the verified identity of a caller: a key id and its grants.
type AccessToken struct {
	Token  string
	KeyID  string
	Grants map[string]string
}

// IssueKey generates a key id and its plaintext token. Pure generation, no
// database access.
func IssueKey() (string, string) {
	keyID := ids.NewKeyID()
	return keyID, ids.NewToken(keyID)
}

// VerifyToken resolves a plaintext token to an identity. The admin token is
// checked before the database; otherwise the token hash is looked up on every
// request so revocation takes effect immediately.
func VerifyToken(token string) (*AccessToken, error) {
	if admin := permissions.AdminToken(); admin != "" && token == admin {
		return &AccessToken{Token: token, KeyID: permissions.AdminKeyID, Grants: permissions.AdminGrants}, nil
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
	return &AccessToken{Token: token, KeyID: keyID, Grants: key["scopes"].(map[string]string)}, nil
}
