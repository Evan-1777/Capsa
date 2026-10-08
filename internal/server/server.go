package server

import (
	"encoding/json"
	"errors"
	"net/http"

	"capsa/internal/auth"
	"capsa/internal/db"
)

// MaxRequestBytes bounds the request body to 1 MiB.
const MaxRequestBytes = 1048576

// errPayloadTooLarge signals that a streamed body exceeded the limit.
var errPayloadTooLarge = errors.New("payload too large")

// NewHandler assembles the root handler: /healthz, /mcp, /api and the SPA.
// Route order is fixed so the static root never hijacks the API prefixes.
func NewHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", healthz)

	mcpHandler := NewMCPHandler(NewMCPServer())
	mux.Handle("GET /mcp", mcpHandler)
	mux.Handle("POST /mcp", mcpHandler)
	mux.Handle("DELETE /mcp", mcpHandler)

	mux.Handle("/api/", AdminGuard(NewWebHandler()))
	mux.Handle("/", staticHandler())

	// Query-parameter credentials are handled at the outermost boundary so the
	// synthesized Bearer header reaches both transports; the body limit runs
	// just inside it.
	return auth.QueryTokenAuth(bodyLimit(mux))
}

func healthz(w http.ResponseWriter, r *http.Request) {
	if db.CheckDBHealth() {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "ok"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusServiceUnavailable)
	_ = json.NewEncoder(w).Encode(map[string]any{"status": "error", "message": "database unavailable"})
}

// bodyLimit rejects oversize bodies. A declared Content-Length is checked up
// front; a streamed body is capped so the read fails as errPayloadTooLarge.
func bodyLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.ContentLength > MaxRequestBytes {
			writePayloadTooLarge(w)
			return
		}
		if r.Body != nil {
			r.Body = http.MaxBytesReader(w, r.Body, MaxRequestBytes)
		}
		next.ServeHTTP(w, r)
	})
}

func writePayloadTooLarge(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusRequestEntityTooLarge)
	_, _ = w.Write([]byte("Request body too large"))
}
