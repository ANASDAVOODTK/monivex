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

// TemplateDeployment is one provisioned template instance (e.g. a Supabase project).
type TemplateDeployment struct {
	ID         string
	TemplateID string
	Name       string
	Slug       string
	Status     string
	Message    string
	ConfigJSON []byte
	PortsJSON  []byte
	WorkDir    string
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// TemplateDeploymentEvent captures a lifecycle action or status change.
type TemplateDeploymentEvent struct {
	ID           int64
	DeploymentID string
	Kind         string
	Message      string
	CreatedAt    time.Time
}

// TemplateDeploymentEnv holds one environment variable for a deployment.
type TemplateDeploymentEnv struct {
	Key    string
	Value  string
	Secret bool
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
		`CREATE TABLE IF NOT EXISTS template_deployments (
			id TEXT PRIMARY KEY,
			template_id TEXT NOT NULL,
			name TEXT NOT NULL,
			slug TEXT NOT NULL UNIQUE,
			status TEXT NOT NULL,
			message TEXT NOT NULL DEFAULT '',
			config_json BLOB NOT NULL,
			ports_json BLOB NOT NULL,
			work_dir TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_template_deployments_template ON template_deployments(template_id)`,
		`CREATE TABLE IF NOT EXISTS template_deployment_env (
			deployment_id TEXT NOT NULL,
			key TEXT NOT NULL,
			value TEXT NOT NULL,
			secret INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (deployment_id, key),
			FOREIGN KEY (deployment_id) REFERENCES template_deployments(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS template_deployment_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			deployment_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			message TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			FOREIGN KEY (deployment_id) REFERENCES template_deployments(id) ON DELETE CASCADE
		)`,
		`CREATE INDEX IF NOT EXISTS idx_template_events_dep ON template_deployment_events(deployment_id, id)`,
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

// ---------- Template deployments ----------

// CreateTemplateDeployment inserts a new deployment row plus its env list.
func (s *Store) CreateTemplateDeployment(ctx context.Context, d TemplateDeployment, env []TemplateDeploymentEnv) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := time.Now().Unix()
	_, err = tx.ExecContext(ctx, `INSERT INTO template_deployments
		(id, template_id, name, slug, status, message, config_json, ports_json, work_dir, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
		d.ID, d.TemplateID, d.Name, d.Slug, d.Status, d.Message, d.ConfigJSON, d.PortsJSON, d.WorkDir, now, now)
	if err != nil {
		return err
	}
	for _, e := range env {
		secret := 0
		if e.Secret {
			secret = 1
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO template_deployment_env (deployment_id, key, value, secret) VALUES (?,?,?,?)`,
			d.ID, e.Key, e.Value, secret); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// GetTemplateDeployment loads a deployment by ID. Returns nil if not found.
func (s *Store) GetTemplateDeployment(ctx context.Context, id string) (*TemplateDeployment, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id, template_id, name, slug, status, message, config_json, ports_json, work_dir, created_at, updated_at
		 FROM template_deployments WHERE id = ?`, id)
	var d TemplateDeployment
	var created, updated int64
	if err := row.Scan(&d.ID, &d.TemplateID, &d.Name, &d.Slug, &d.Status, &d.Message,
		&d.ConfigJSON, &d.PortsJSON, &d.WorkDir, &created, &updated); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	d.CreatedAt = time.Unix(created, 0)
	d.UpdatedAt = time.Unix(updated, 0)
	return &d, nil
}

// ListTemplateDeployments returns all deployments ordered by created_at desc.
func (s *Store) ListTemplateDeployments(ctx context.Context) ([]TemplateDeployment, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, template_id, name, slug, status, message, config_json, ports_json, work_dir, created_at, updated_at
		 FROM template_deployments ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TemplateDeployment
	for rows.Next() {
		var d TemplateDeployment
		var created, updated int64
		if err := rows.Scan(&d.ID, &d.TemplateID, &d.Name, &d.Slug, &d.Status, &d.Message,
			&d.ConfigJSON, &d.PortsJSON, &d.WorkDir, &created, &updated); err != nil {
			return nil, err
		}
		d.CreatedAt = time.Unix(created, 0)
		d.UpdatedAt = time.Unix(updated, 0)
		out = append(out, d)
	}
	return out, rows.Err()
}

// TemplateDeploymentSlugExists returns true if a deployment with that slug already exists.
func (s *Store) TemplateDeploymentSlugExists(ctx context.Context, slug string) (bool, error) {
	var n int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM template_deployments WHERE slug = ?`, slug).Scan(&n)
	return n > 0, err
}

// UpdateTemplateDeploymentStatus changes status/message and bumps updated_at.
func (s *Store) UpdateTemplateDeploymentStatus(ctx context.Context, id, status, message string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE template_deployments SET status = ?, message = ?, updated_at = ? WHERE id = ?`,
		status, message, time.Now().Unix(), id)
	return err
}

// DeleteTemplateDeployment removes the deployment and its env/events.
func (s *Store) DeleteTemplateDeployment(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM template_deployment_env WHERE deployment_id = ?`, id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM template_deployment_events WHERE deployment_id = ?`, id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM template_deployments WHERE id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

// GetTemplateDeploymentEnv returns all env vars for the deployment.
func (s *Store) GetTemplateDeploymentEnv(ctx context.Context, deploymentID string) ([]TemplateDeploymentEnv, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT key, value, secret FROM template_deployment_env WHERE deployment_id = ? ORDER BY key ASC`,
		deploymentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TemplateDeploymentEnv
	for rows.Next() {
		var e TemplateDeploymentEnv
		var secret int
		if err := rows.Scan(&e.Key, &e.Value, &secret); err != nil {
			return nil, err
		}
		e.Secret = secret != 0
		out = append(out, e)
	}
	return out, rows.Err()
}

// AppendTemplateDeploymentEvent records a status/lifecycle event.
func (s *Store) AppendTemplateDeploymentEvent(ctx context.Context, deploymentID, kind, message string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO template_deployment_events (deployment_id, kind, message, created_at) VALUES (?,?,?,?)`,
		deploymentID, kind, message, time.Now().Unix())
	return err
}

// ListTemplateDeploymentEvents returns the most recent events for the deployment.
func (s *Store) ListTemplateDeploymentEvents(ctx context.Context, deploymentID string, limit int) ([]TemplateDeploymentEvent, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, deployment_id, kind, message, created_at FROM template_deployment_events
		 WHERE deployment_id = ? ORDER BY id DESC LIMIT ?`, deploymentID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TemplateDeploymentEvent
	for rows.Next() {
		var e TemplateDeploymentEvent
		var created int64
		if err := rows.Scan(&e.ID, &e.DeploymentID, &e.Kind, &e.Message, &created); err != nil {
			return nil, err
		}
		e.CreatedAt = time.Unix(created, 0)
		out = append(out, e)
	}
	return out, rows.Err()
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
