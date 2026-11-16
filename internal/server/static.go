package server

import (
	"compress/gzip"
	"embed"
	"io/fs"
	"net/http"
	"path"
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

func isCompressibleStatic(name string) bool {
	switch strings.ToLower(path.Ext(name)) {
	case ".html", ".js", ".mjs", ".css", ".svg", ".json", ".txt", ".xml", ".wasm", ".map":
		return true
	default:
		return false
	}
}

func acceptsGzip(r *http.Request) bool {
	for _, part := range strings.Split(strings.ToLower(r.Header.Get("Accept-Encoding")), ",") {
		part = strings.TrimSpace(part)
		encoding, params, _ := strings.Cut(part, ";")
		if strings.TrimSpace(encoding) != "gzip" {
			continue
		}
		if strings.ReplaceAll(strings.TrimSpace(params), " ", "") == "q=0" {
			return false
		}
		return true
	}
	return false
}

type gzipStaticWriter struct {
	http.ResponseWriter
	gz          *gzip.Writer
	wroteHeader bool
}

func (w *gzipStaticWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	if status == http.StatusOK {
		header := w.Header()
		header.Del("Content-Length")
		header.Del("Accept-Ranges")
		header.Set("Content-Encoding", "gzip")
		w.gz = gzip.NewWriter(w.ResponseWriter)
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *gzipStaticWriter) Write(p []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	if w.gz != nil {
		return w.gz.Write(p)
	}
	return w.ResponseWriter.Write(p)
}

func (w *gzipStaticWriter) Close() {
	if w.gz != nil {
		_ = w.gz.Close()
	}
}

// staticHandler serves embedded files and falls back to index.html so client
// routes resolve on refresh. Caching and on-demand gzip live strictly inside
// this handler so MCP/API endpoints stay untouched.
func staticHandler() http.Handler {
	sub := staticSubFS()
	fileServer := http.FileServerFS(sub)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requested := strings.TrimPrefix(r.URL.Path, "/")
		if requested == "" {
			requested = "index.html"
		}
		info, err := fs.Stat(sub, requested)
		isFallback := err != nil || info.IsDir()

		targetName := requested
		if isFallback {
			targetName = "index.html"
			w.Header().Set("Cache-Control", "no-cache")
		} else if strings.HasPrefix(requested, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else if requested == "index.html" {
			w.Header().Set("Cache-Control", "no-cache")
		}

		writer := w
		if isCompressibleStatic(targetName) {
			w.Header().Set("Vary", "Accept-Encoding")
			if r.Method == http.MethodGet && acceptsGzip(r) {
				gw := &gzipStaticWriter{ResponseWriter: w}
				defer gw.Close()
				writer = gw
			}
		}

		if isFallback {
			serveIndex(writer, r, sub)
			return
		}
		fileServer.ServeHTTP(writer, r)
	})
}

func serveIndex(w http.ResponseWriter, r *http.Request, sub fs.FS) {
	data, err := fs.ReadFile(sub, "index.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if r.Method == http.MethodHead {
		w.WriteHeader(http.StatusOK)
		return
	}
	_, _ = w.Write(data)
}
