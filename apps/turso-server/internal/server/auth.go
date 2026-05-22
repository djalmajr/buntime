package server

import (
	"crypto/subtle"
	"net/http"
	"strings"
)

// bearerAuth wraps an http.Handler with `Authorization: Bearer <token>`
// validation. When `token` is the empty string, auth is disabled (intended
// for local dev only — production deployments must always set a token).
//
// The comparison uses `crypto/subtle.ConstantTimeCompare` to keep the
// check resistant to timing attacks. The `Authorization` header value is
// expected to be exactly `Bearer <token>` with no extra whitespace.
func bearerAuth(token string, next http.Handler) http.Handler {
	if token == "" {
		return next
	}
	expected := []byte("Bearer " + token)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Allow unauthenticated probes — kubelet/liveness/readiness call
		// `/healthz` and `/readyz` without credentials.
		if r.URL.Path == "/healthz" || r.URL.Path == "/readyz" {
			next.ServeHTTP(w, r)
			return
		}
		got := []byte(r.Header.Get("Authorization"))

		// Some libsql clients accept the token via query string. We only
		// honor the canonical header form to keep the surface small; if
		// future clients require the query form, extend here.

		if subtle.ConstantTimeCompare(got, expected) != 1 {
			// Try the lowercase variant some libsql clients used
			// historically; subtle.ConstantTimeCompare is happy to
			// short-circuit if lengths differ.
			lower := []byte("bearer " + token)
			if subtle.ConstantTimeCompare(got, lower) != 1 {
				w.Header().Set("WWW-Authenticate", `Bearer realm="turso-server"`)
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// stripPrefix splits the URL path into `(namespace, remainder)` where
// `namespace` is the first path segment. Returns ("", "") when the path
// has no leading segment.
func splitNamespacePath(path string) (string, string) {
	if path == "" || path == "/" {
		return "", ""
	}
	if path[0] == '/' {
		path = path[1:]
	}
	if i := strings.IndexByte(path, '/'); i >= 0 {
		return path[:i], "/" + path[i+1:]
	}
	return path, "/"
}
