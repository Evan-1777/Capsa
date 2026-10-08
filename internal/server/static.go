package server

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

// staticFiles embeds the built SPA. The directory is a build artifact and is
// not committed; a build without it fails at compile time, which is intended.
//
//go:embed all:static
var staticFiles embed.FS

func staticSubFS() fs.FS {
	sub, err := fs.Sub(staticFiles, "static")
	if err != nil {
		panic(err)
	}
	return sub
}

// staticHandler serves embedded files and falls back to index.html so client
// routes resolve on refresh.
func staticHandler() http.Handler {
	sub := staticSubFS()
	fileServer := http.FileServerFS(sub)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requested := strings.TrimPrefix(r.URL.Path, "/")
		if requested == "" {
			requested = "index.html"
		}
		if _, err := fs.Stat(sub, requested); err != nil {
			serveIndex(w, r, sub)
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}

func serveIndex(w http.ResponseWriter, r *http.Request, sub fs.FS) {
	data, err := fs.ReadFile(sub, "index.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(data)
}
