package db

import (
	"database/sql"
	"os"
	"path/filepath"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

type DB struct {
	conn *sql.DB
}

type Server struct {
	ID         int64
	Name       string
	URL        string
	Token      *string
	Insecure   bool
	LastUsedAt *time.Time
	CreatedAt  time.Time
}

func New() (*DB, error) {
	dbPath, err := getDBPath()
	if err != nil {
		return nil, err
	}

	conn, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, err
	}

	db := &DB{conn: conn}
	if err := db.migrate(); err != nil {
		conn.Close()
		return nil, err
	}

	return db, nil
}

func (d *DB) Close() error {
	return d.conn.Close()
}

func getDBPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}

	dir := filepath.Join(home, ".buntime")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}

	return filepath.Join(dir, "config.db"), nil
}

func (d *DB) migrate() error {
	schema := `
	CREATE TABLE IF NOT EXISTS servers (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		url TEXT NOT NULL UNIQUE,
		token TEXT,
		insecure INTEGER NOT NULL DEFAULT 0,
		last_used_at INTEGER,
		created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
	);

	CREATE TABLE IF NOT EXISTS config (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);
	`
	_, err := d.conn.Exec(schema)
	return err
}

// Server CRUD operations

func (d *DB) ListServers() ([]Server, error) {
	rows, err := d.conn.Query(`
		SELECT id, name, url, token, insecure, last_used_at, created_at
		FROM servers
		ORDER BY last_used_at DESC NULLS LAST, created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var servers []Server
	for rows.Next() {
		var s Server
		var lastUsed, created sql.NullInt64
		var token sql.NullString
		var insecure int

		err := rows.Scan(&s.ID, &s.Name, &s.URL, &token, &insecure, &lastUsed, &created)
		if err != nil {
			return nil, err
		}

		if token.Valid {
			s.Token = &token.String
		}
		s.Insecure = insecure == 1

		if lastUsed.Valid {
			t := time.Unix(lastUsed.Int64, 0)
			s.LastUsedAt = &t
		}
		if created.Valid {
			s.CreatedAt = time.Unix(created.Int64, 0)
		}

		servers = append(servers, s)
	}

	return servers, nil
}

func (d *DB) GetServer(id int64) (*Server, error) {
	var s Server
	var lastUsed, created sql.NullInt64
	var token sql.NullString
	var insecure int

	err := d.conn.QueryRow(`
		SELECT id, name, url, token, insecure, last_used_at, created_at
		FROM servers WHERE id = ?
	`, id).Scan(&s.ID, &s.Name, &s.URL, &token, &insecure, &lastUsed, &created)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	if token.Valid {
		s.Token = &token.String
	}
	s.Insecure = insecure == 1

	if lastUsed.Valid {
		t := time.Unix(lastUsed.Int64, 0)
		s.LastUsedAt = &t
	}
	if created.Valid {
		s.CreatedAt = time.Unix(created.Int64, 0)
	}

	return &s, nil
}

func (d *DB) GetServerByURL(url string) (*Server, error) {
	var s Server
	var lastUsed, created sql.NullInt64
	var token sql.NullString
	var insecure int

	err := d.conn.QueryRow(`
		SELECT id, name, url, token, insecure, last_used_at, created_at
		FROM servers WHERE url = ?
	`, url).Scan(&s.ID, &s.Name, &s.URL, &token, &insecure, &lastUsed, &created)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	if token.Valid {
		s.Token = &token.String
	}
	s.Insecure = insecure == 1

	if lastUsed.Valid {
		t := time.Unix(lastUsed.Int64, 0)
		s.LastUsedAt = &t
	}
	if created.Valid {
		s.CreatedAt = time.Unix(created.Int64, 0)
	}

	return &s, nil
}

func (d *DB) CreateServer(name, url string, token *string, insecure bool) (*Server, error) {
	insecureInt := 0
	if insecure {
		insecureInt = 1
	}

	result, err := d.conn.Exec(`
		INSERT INTO servers (name, url, token, insecure)
		VALUES (?, ?, ?, ?)
	`, name, url, token, insecureInt)
	if err != nil {
		return nil, err
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}

	return d.GetServer(id)
}

func (d *DB) UpdateServer(id int64, name, url string, token *string, insecure bool) error {
	insecureInt := 0
	if insecure {
		insecureInt = 1
	}

	_, err := d.conn.Exec(`
		UPDATE servers
		SET name = ?, url = ?, token = ?, insecure = ?
		WHERE id = ?
	`, name, url, token, insecureInt, id)
	return err
}

func (d *DB) DeleteServer(id int64) error {
	_, err := d.conn.Exec(`DELETE FROM servers WHERE id = ?`, id)
	return err
}

func (d *DB) TouchServer(id int64) error {
	_, err := d.conn.Exec(`
		UPDATE servers SET last_used_at = strftime('%s', 'now') WHERE id = ?
	`, id)
	return err
}

func (d *DB) UpdateServerToken(id int64, token string) error {
	_, err := d.conn.Exec(`UPDATE servers SET token = ? WHERE id = ?`, token, id)
	return err
}

func (d *DB) ResetAll() error {
	_, err := d.conn.Exec(`DELETE FROM servers; DELETE FROM config;`)
	return err
}

// Config key-value store

func (d *DB) GetConfig(key string) (string, error) {
	var value string
	err := d.conn.QueryRow(`SELECT value FROM config WHERE key = ?`, key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return value, err
}

func (d *DB) SetConfig(key, value string) error {
	_, err := d.conn.Exec(`
		INSERT INTO config (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value
	`, key, value)
	return err
}
