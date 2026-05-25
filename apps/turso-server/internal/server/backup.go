package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

// Backup produces a consistent snapshot of `namespace` by issuing
// `VACUUM INTO` against the running `tursodb` process. The snapshot is a
// regular SQLite-compatible file that can be downloaded over HTTP, copied to
// object storage, or restored later.
//
// Why this works while Litestream does not:
//
// Litestream opens the `.db` file with a separate sqlite3 connection to read
// WAL frames; `tursodb --sync-server` holds the file in exclusive mode (CDC +
// MVCC), so the second connection cannot acquire any lock. `VACUUM INTO`
// runs inside the SAME connection the sync-server already owns — there is
// no lock contention, and the resulting file is a transactionally consistent
// SQLite snapshot.
//
// Wire protocol: `tursodb --sync-server` exposes a single HTTP endpoint
// `POST /v2/pipeline` (Hrana protocol). The body is a list of execute
// requests; here we send one with the `VACUUM INTO` SQL.
//
// The destination path must be writable by the tursodb process and must
// live on the same filesystem as the source database — `VACUUM INTO` does a
// page-by-page copy locally; cross-fs copies should be handled by the caller
// after the snapshot is produced.
func (s *Supervisor) Backup(ctx context.Context, namespace, destPath string) error {
	if err := ValidateNamespaceName(namespace); err != nil {
		return err
	}
	port := s.Lookup(namespace)
	if port == 0 {
		return fmt.Errorf("namespace %q is not running", namespace)
	}

	// Ensure destination directory exists.
	if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
		return fmt.Errorf("create dest dir: %w", err)
	}

	// Refuse to overwrite an existing file — callers can include a
	// timestamp suffix to avoid collisions. Snapshot uniqueness is
	// the caller's responsibility.
	if _, err := os.Stat(destPath); err == nil {
		return fmt.Errorf("destination already exists: %s", destPath)
	}

	// Hrana pipeline request: one execute step with `VACUUM INTO '<path>'`.
	// VACUUM INTO only accepts a literal path (not bound parameter), so we
	// must escape single quotes in the path. The validation above
	// (ValidateNamespaceName) plus the dir creation prevent surprises in
	// practice — destPath always ends with `<name>-<ts>.db` from the admin
	// handler — but we sanitize defensively anyway.
	sql := "VACUUM INTO '" + escapeSQLLiteral(destPath) + "'"
	reqBody := map[string]any{
		"requests": []map[string]any{
			{
				"type": "execute",
				"stmt": map[string]any{"sql": sql},
			},
		},
	}
	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}

	url := "http://127.0.0.1:" + strconv.Itoa(port) + "/v2/pipeline"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("call tursodb pipeline: %w", err)
	}
	defer resp.Body.Close()

	respBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("tursodb pipeline returned %d: %s", resp.StatusCode, string(respBytes))
	}

	// Parse the Hrana response shape:
	//   { "results": [ { "type": "ok" | "error", ... } ] }
	var parsed struct {
		Results []struct {
			Type  string `json:"type"`
			Error struct {
				Message string `json:"message"`
				Code    string `json:"code"`
			} `json:"error"`
		} `json:"results"`
	}
	if err := json.Unmarshal(respBytes, &parsed); err != nil {
		return fmt.Errorf("parse pipeline response: %w (body=%s)", err, string(respBytes))
	}
	if len(parsed.Results) == 0 {
		return fmt.Errorf("pipeline returned no results (body=%s)", string(respBytes))
	}
	if parsed.Results[0].Type == "error" {
		return fmt.Errorf("VACUUM INTO failed: %s (%s)",
			parsed.Results[0].Error.Message, parsed.Results[0].Error.Code)
	}

	if _, err := os.Stat(destPath); err != nil {
		return fmt.Errorf("snapshot not present after VACUUM INTO: %w", err)
	}

	return nil
}

// BackupDir returns the directory where snapshot files are produced by the
// admin endpoint when no explicit destination is provided. Lives alongside
// the live databases so VACUUM INTO can write to the same filesystem.
func (s *Supervisor) BackupDir() string {
	return filepath.Join(s.cfg.DataDir, "_backups")
}

// escapeSQLLiteral doubles single quotes — the only character that needs
// escaping inside a single-quoted SQLite string literal.
func escapeSQLLiteral(s string) string {
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		if s[i] == '\'' {
			out = append(out, '\'', '\'')
		} else {
			out = append(out, s[i])
		}
	}
	return string(out)
}
