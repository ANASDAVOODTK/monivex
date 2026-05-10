package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

type User struct {
	ID           int64
	Username     string
	PasswordHash string
	CreatedAt    time.Time
}

type MetricRow struct {
	Timestamp time.Time
	Payload   []byte // JSON snapshot
}

func Open(dataDir string) (*Store, error) {
	dsn := filepath.Join(dataDir, "monitor.db") + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1) // sqlite single writer; reads still concurrent in WAL
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS metrics_short (
			ts INTEGER NOT NULL,
			payload BLOB NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_metrics_short_ts ON metrics_short(ts)`,
		`CREATE TABLE IF NOT EXISTS metrics_long (
			ts INTEGER NOT NULL,
			payload BLOB NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_metrics_long_ts ON metrics_long(ts)`,
	}
	for _, q := range stmts {
		if _, err := s.db.Exec(q); err != nil {
			return fmt.Errorf("migrate %q: %w", q, err)
		}
	}
	return nil
}

// ---------- Users ----------

func (s *Store) UserCount(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

func (s *Store) CreateUser(ctx context.Context, username, hash string) (int64, error) {
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)`,
		username, hash, time.Now().Unix())
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) GetUserByUsername(ctx context.Context, username string) (*User, error) {
	var u User
	var ts int64
	err := s.db.QueryRowContext(ctx,
		`SELECT id, username, password_hash, created_at FROM users WHERE username = ?`,
		username).Scan(&u.ID, &u.Username, &u.PasswordHash, &ts)
	if err != nil {
		return nil, err
	}
	u.CreatedAt = time.Unix(ts, 0)
	return &u, nil
}

func (s *Store) UpdateUserPassword(ctx context.Context, id int64, hash string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE users SET password_hash = ? WHERE id = ?`, hash, id)
	return err
}

// ---------- Settings ----------

func (s *Store) GetSetting(ctx context.Context, key string) (string, error) {
	var v string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, key).Scan(&v)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return v, err
}

func (s *Store) SetSetting(ctx context.Context, key, value string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
		key, value)
	return err
}

// ---------- Metrics ----------

func (s *Store) InsertShort(ctx context.Context, ts time.Time, payload any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO metrics_short(ts, payload) VALUES(?, ?)`, ts.Unix(), b)
	return err
}

func (s *Store) InsertLong(ctx context.Context, ts time.Time, payload any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO metrics_long(ts, payload) VALUES(?, ?)`, ts.Unix(), b)
	return err
}

func (s *Store) QueryRange(ctx context.Context, table string, from, to time.Time) ([]MetricRow, error) {
	if table != "metrics_short" && table != "metrics_long" {
		return nil, fmt.Errorf("invalid table")
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT ts, payload FROM `+table+` WHERE ts BETWEEN ? AND ? ORDER BY ts ASC`,
		from.Unix(), to.Unix())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MetricRow
	for rows.Next() {
		var ts int64
		var payload []byte
		if err := rows.Scan(&ts, &payload); err != nil {
			return nil, err
		}
		out = append(out, MetricRow{Timestamp: time.Unix(ts, 0), Payload: payload})
	}
	return out, rows.Err()
}

func (s *Store) Prune(ctx context.Context, table string, before time.Time) error {
	if table != "metrics_short" && table != "metrics_long" {
		return fmt.Errorf("invalid table")
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM `+table+` WHERE ts < ?`, before.Unix())
	return err
}

// LatestShort returns the most recent N rows from metrics_short.
func (s *Store) LatestShort(ctx context.Context, limit int) ([]MetricRow, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT ts, payload FROM metrics_short ORDER BY ts DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MetricRow
	for rows.Next() {
		var ts int64
		var payload []byte
		if err := rows.Scan(&ts, &payload); err != nil {
			return nil, err
		}
		out = append(out, MetricRow{Timestamp: time.Unix(ts, 0), Payload: payload})
	}
	return out, rows.Err()
}
