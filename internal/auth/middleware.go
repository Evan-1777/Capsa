package auth

import (
	"net/http"
	"strings"
	"unicode"
)

// QueryTokenAuth injects a Bearer header synthesized from a query parameter
// when no Authorization header is present. The header, when present, is the sole
// authority: it is neither overridden nor downgraded.
func QueryTokenAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, present := r.Header["Authorization"]; present {
			next.ServeHTTP(w, r)
			return
		}
		query := r.URL.Query()
		raw := ""
		for _, key := range []string{"token", "access_token"} {
			if values, ok := query[key]; ok && len(values) > 0 {
				candidate := strings.TrimSpace(values[0])
				if candidate != "" {
					raw = candidate
					break
				}
			}
		}
		// A non-ASCII or non-printable value is ignored so an empty, whitespace
		// or CRLF-laden parameter never reaches header construction; the request
		// falls through to the downstream 401.
		if raw == "" || !isASCIIPrintable(raw) {
			next.ServeHTTP(w, r)
			return
		}
		r.Header.Set("Authorization", "Bearer "+raw)
		next.ServeHTTP(w, r)
	})
}

func isASCIIPrintable(value string) bool {
	for _, r := range value {
		if r > unicode.MaxASCII || !unicode.IsPrint(r) {
			return false
		}
	}
	return true
}
