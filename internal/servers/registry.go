// Package servers manages the hub's registry of monitored servers. The self
// row represents the local instance; all other rows are remote agents
// reachable over HTTPS using their per-server API key. API keys are
// AES-GCM encrypted at rest using a derivation of the hub's JWT secret.
package servers

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/ANASDAVOODTK/server-monitor/internal/metrics"
	"github.com/ANASDAVOODTK/server-monitor/internal/store"
)

// Registry wraps the store with API key encryption + helpers.
type Registry struct {
	store *store.Store
	gcm   cipher.AEAD
	// listeners receive a notification on any registry mutation.
	mu        sync.Mutex
	listeners []func()
}

// New returns a Registry. encSecret is any high-entropy bytes (we derive an
// AES key via sha256). Pass the hub's JWT secret here.
func New(s *store.Store, encSecret []byte) (*Registry, error) {
	if len(encSecret) == 0 {
		return nil, errors.New("encryption secret required")
	}
	derived := sha256.Sum256(append([]byte("server-monitor.registry.v1\x00"), encSecret...))
	block, err := aes.NewCipher(derived[:])
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Registry{store: s, gcm: gcm}, nil
}

// Subscribe registers a callback fired after any List-affecting mutation.
// Returned func unsubscribes.
func (r *Registry) Subscribe(fn func()) func() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.listeners = append(r.listeners, fn)
	idx := len(r.listeners) - 1
	return func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		if idx < len(r.listeners) {
			r.listeners[idx] = nil
		}
	}
}

func (r *Registry) notify() {
	r.mu.Lock()
	fns := append([]func(){}, r.listeners...)
	r.mu.Unlock()
	for _, fn := range fns {
		if fn != nil {
			go fn()
		}
	}
}

// EnsureSelf creates the self row if missing.
func (r *Registry) EnsureSelf(ctx context.Context, name string) (*store.Server, error) {
	sv, err := r.store.GetSelfServer(ctx)
	if err != nil {
		return nil, err
	}
	if sv != nil {
		return sv, nil
	}
	id := newID("self")
	row := store.Server{
		ID:      id,
		Name:    name,
		BaseURL: "",
		IsSelf:  true,
		Enabled: true,
	}
	if err := r.store.CreateServer(ctx, row); err != nil {
		return nil, err
	}
	r.notify()
	return r.store.GetServer(ctx, id)
}

// Create inserts a new remote server.
func (r *Registry) Create(ctx context.Context, name, baseURL, apiKey string) (*store.Server, error) {
	name = strings.TrimSpace(name)
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	apiKey = strings.TrimSpace(apiKey)
	if name == "" {
		return nil, errors.New("name is required")
	}
	if baseURL == "" {
		return nil, errors.New("base_url is required")
	}
	if _, err := url.Parse(baseURL); err != nil {
		return nil, fmt.Errorf("base_url: %w", err)
	}
	if apiKey == "" {
		return nil, errors.New("api_key is required")
	}
	enc, err := r.encrypt(apiKey)
	if err != nil {
		return nil, err
	}
	id := newID("srv")
	sv := store.Server{
		ID:        id,
		Name:      name,
		BaseURL:   baseURL,
		APIKeyEnc: enc,
		IsSelf:    false,
		Enabled:   true,
	}
	if err := r.store.CreateServer(ctx, sv); err != nil {
		return nil, err
	}
	r.notify()
	return r.store.GetServer(ctx, id)
}

// Update mutates an existing server. apiKey is only re-encrypted if non-empty.
func (r *Registry) Update(ctx context.Context, id string, name, baseURL, apiKey string, enabled bool) (*store.Server, error) {
	current, err := r.store.GetServer(ctx, id)
	if err != nil || current == nil {
		return nil, errors.New("not found")
	}
	if name != "" {
		current.Name = strings.TrimSpace(name)
	}
	if baseURL != "" && !current.IsSelf {
		current.BaseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	}
	if apiKey != "" && !current.IsSelf {
		enc, err := r.encrypt(apiKey)
		if err != nil {
			return nil, err
		}
		current.APIKeyEnc = enc
	}
	current.Enabled = enabled
	if err := r.store.UpdateServer(ctx, *current); err != nil {
		return nil, err
	}
	r.notify()
	return r.store.GetServer(ctx, id)
}

// Delete removes a server. Refuses to delete self.
func (r *Registry) Delete(ctx context.Context, id string) error {
	sv, err := r.store.GetServer(ctx, id)
	if err != nil {
		return err
	}
	if sv == nil {
		return errors.New("not found")
	}
	if sv.IsSelf {
		return errors.New("cannot delete the self server")
	}
	if err := r.store.DeleteServer(ctx, id); err != nil {
		return err
	}
	r.notify()
	return nil
}

// List returns all servers (self first).
func (r *Registry) List(ctx context.Context) ([]store.Server, error) {
	return r.store.ListServers(ctx)
}

// Get returns one server by id.
func (r *Registry) Get(ctx context.Context, id string) (*store.Server, error) {
	return r.store.GetServer(ctx, id)
}

// DecryptKey returns the plaintext API key for a server. Returns empty for self.
func (r *Registry) DecryptKey(sv *store.Server) (string, error) {
	if sv == nil || sv.IsSelf || sv.APIKeyEnc == "" {
		return "", nil
	}
	return r.decrypt(sv.APIKeyEnc)
}

// SetStatus updates the cached connection state for a server.
func (r *Registry) SetStatus(ctx context.Context, id string, okAt *time.Time, errMsg string) error {
	return r.store.SetServerStatus(ctx, id, okAt, errMsg)
}

// TestConnection contacts the agent's /snapshot endpoint and returns its host metadata
// on success. Used by the UI to verify a (base_url, api_key) pair before saving.
func (r *Registry) TestConnection(ctx context.Context, baseURL, apiKey string) (*metrics.Host, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	req, err := http.NewRequestWithContext(ctx, "GET", baseURL+"/api/v1/snapshot", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-API-Key", apiKey)
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		return nil, errors.New("agent rejected the api key")
	}
	if resp.StatusCode == http.StatusServiceUnavailable {
		// Agent is up but warming. That's fine — return a stub Host so the caller knows it's reachable.
		return &metrics.Host{Hostname: "(warming up)"}, nil
	}
	if resp.StatusCode/100 != 2 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("agent returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var snap metrics.Snapshot
	if err := json.NewDecoder(resp.Body).Decode(&snap); err != nil {
		return nil, fmt.Errorf("decode snapshot: %w", err)
	}
	return &snap.Host, nil
}

// ---------- crypto helpers ----------

func (r *Registry) encrypt(plaintext string) (string, error) {
	nonce := make([]byte, r.gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	ct := r.gcm.Seal(nil, nonce, []byte(plaintext), nil)
	return base64.RawStdEncoding.EncodeToString(nonce) + ":" + base64.RawStdEncoding.EncodeToString(ct), nil
}

func (r *Registry) decrypt(blob string) (string, error) {
	parts := strings.SplitN(blob, ":", 2)
	if len(parts) != 2 {
		return "", errors.New("malformed ciphertext")
	}
	nonce, err := base64.RawStdEncoding.DecodeString(parts[0])
	if err != nil {
		return "", err
	}
	ct, err := base64.RawStdEncoding.DecodeString(parts[1])
	if err != nil {
		return "", err
	}
	pt, err := r.gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", err
	}
	return string(pt), nil
}

func newID(prefix string) string {
	buf := make([]byte, 8)
	_, _ = rand.Read(buf)
	return prefix + "_" + hex.EncodeToString(buf)
}
