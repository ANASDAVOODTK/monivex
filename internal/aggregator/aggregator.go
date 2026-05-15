// Package aggregator maintains live metric streams for every server in the
// hub's registry. For the self server it subscribes directly to the local
// hub.Hub. For each remote server it maintains a long-lived WebSocket
// connection to the agent's /ws/metrics endpoint and pumps snapshots into
// memory. Consumers (the HTTP/WS API layer) read the latest snapshot or
// subscribe to a per-server channel for fan-out to browser clients.
package aggregator

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/ANASDAVOODTK/server-monitor/internal/hub"
	"github.com/ANASDAVOODTK/server-monitor/internal/metrics"
	"github.com/ANASDAVOODTK/server-monitor/internal/servers"
	"github.com/ANASDAVOODTK/server-monitor/internal/store"
)

// State captures the most recent connection result for a server.
type State struct {
	ServerID  string
	Name      string
	BaseURL   string
	IsSelf    bool
	Enabled   bool
	Connected bool
	LastSeen  time.Time
	LastError string
	Snapshot  *metrics.Snapshot
}

type entry struct {
	state    State
	subs     map[chan *metrics.Snapshot]struct{}
	cancel   context.CancelFunc
}

type Aggregator struct {
	registry *servers.Registry
	hub      *hub.Hub

	mu      sync.RWMutex
	entries map[string]*entry

	runCtx    context.Context
	runCancel context.CancelFunc
}

func New(reg *servers.Registry, h *hub.Hub) *Aggregator {
	return &Aggregator{
		registry: reg,
		hub:      h,
		entries:  map[string]*entry{},
	}
}

// Run starts the aggregator: starts a pump for every enabled server and
// reconciles whenever the registry changes. Blocks until ctx is cancelled.
func (a *Aggregator) Run(ctx context.Context) {
	a.runCtx, a.runCancel = context.WithCancel(ctx)
	defer a.runCancel()

	unsub := a.registry.Subscribe(func() {
		a.reconcile()
	})
	defer unsub()

	a.reconcile()
	<-a.runCtx.Done()
	a.stopAll()
}

func (a *Aggregator) reconcile() {
	if a.runCtx == nil {
		return
	}
	list, err := a.registry.List(a.runCtx)
	if err != nil {
		log.Printf("aggregator: list servers: %v", err)
		return
	}
	want := map[string]store.Server{}
	for _, sv := range list {
		want[sv.ID] = sv
	}

	a.mu.Lock()
	// Stop pumps for servers that no longer exist or are disabled.
	for id, e := range a.entries {
		sv, ok := want[id]
		if !ok || !sv.Enabled {
			if e.cancel != nil {
				e.cancel()
			}
			delete(a.entries, id)
		}
	}
	// Start pumps for new/enabled servers.
	for id, sv := range want {
		if !sv.Enabled {
			continue
		}
		if _, ok := a.entries[id]; ok {
			a.entries[id].state.Name = sv.Name
			a.entries[id].state.BaseURL = sv.BaseURL
			continue
		}
		pumpCtx, cancel := context.WithCancel(a.runCtx)
		e := &entry{
			state: State{
				ServerID: sv.ID,
				Name:     sv.Name,
				BaseURL:  sv.BaseURL,
				IsSelf:   sv.IsSelf,
				Enabled:  true,
			},
			subs:   map[chan *metrics.Snapshot]struct{}{},
			cancel: cancel,
		}
		a.entries[id] = e
		if sv.IsSelf {
			go a.pumpLocal(pumpCtx, id)
		} else {
			go a.pumpRemote(pumpCtx, sv)
		}
	}
	a.mu.Unlock()
}

func (a *Aggregator) stopAll() {
	a.mu.Lock()
	for _, e := range a.entries {
		if e.cancel != nil {
			e.cancel()
		}
	}
	a.entries = map[string]*entry{}
	a.mu.Unlock()
}

// ---------- Public API ----------

// Snapshot returns the latest snapshot for a server.
func (a *Aggregator) Snapshot(id string) *metrics.Snapshot {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if e, ok := a.entries[id]; ok {
		return e.state.Snapshot
	}
	return nil
}

// SnapshotForSelf returns the local Hub's latest snapshot (used when bypassing the pump).
func (a *Aggregator) SnapshotForSelf() *metrics.Snapshot {
	return a.hub.Last()
}

// StatesByID returns the current state of every server.
func (a *Aggregator) StatesByID() map[string]State {
	a.mu.RLock()
	defer a.mu.RUnlock()
	out := make(map[string]State, len(a.entries))
	for id, e := range a.entries {
		out[id] = e.state
	}
	return out
}

// State returns the latest state for one server, or nil.
func (a *Aggregator) State(id string) *State {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if e, ok := a.entries[id]; ok {
		st := e.state
		return &st
	}
	return nil
}

// Subscribe returns a channel of snapshots for one server. The caller MUST call
// the returned unsubscribe func when done. The latest snapshot is sent
// immediately if available.
func (a *Aggregator) Subscribe(id string) (<-chan *metrics.Snapshot, func(), bool) {
	a.mu.Lock()
	e, ok := a.entries[id]
	if !ok {
		a.mu.Unlock()
		return nil, nil, false
	}
	ch := make(chan *metrics.Snapshot, 4)
	e.subs[ch] = struct{}{}
	last := e.state.Snapshot
	a.mu.Unlock()
	if last != nil {
		select {
		case ch <- last:
		default:
		}
	}
	return ch, func() {
		a.mu.Lock()
		if e2, ok := a.entries[id]; ok {
			delete(e2.subs, ch)
		}
		a.mu.Unlock()
		close(ch)
	}, true
}

// ---------- Pumps ----------

func (a *Aggregator) pumpLocal(ctx context.Context, id string) {
	ch := a.hub.Subscribe()
	defer a.hub.Unsubscribe(ch)
	for {
		select {
		case <-ctx.Done():
			return
		case snap, ok := <-ch:
			if !ok {
				return
			}
			a.publish(id, snap, true, "")
		}
	}
}

func (a *Aggregator) pumpRemote(ctx context.Context, sv store.Server) {
	backoff := time.Second
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		err := a.connectAndStream(ctx, sv)
		if err != nil {
			a.publishStatus(sv.ID, false, err.Error())
			_ = a.registry.SetStatus(ctx, sv.ID, nil, err.Error())
		} else {
			a.publishStatus(sv.ID, false, "")
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff *= 2
		if backoff > 60*time.Second {
			backoff = 60 * time.Second
		}
	}
}

func (a *Aggregator) connectAndStream(ctx context.Context, sv store.Server) error {
	apiKey, err := a.registry.DecryptKey(&sv)
	if err != nil {
		return err
	}
	u, err := url.Parse(sv.BaseURL)
	if err != nil {
		return err
	}
	switch strings.ToLower(u.Scheme) {
	case "https":
		u.Scheme = "wss"
	default:
		u.Scheme = "ws"
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/ws/metrics"
	q := u.Query()
	q.Set("api_key", apiKey)
	u.RawQuery = q.Encode()

	dialer := *websocket.DefaultDialer
	dialer.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} // LAN-only; agent certs typically self-signed
	dialer.HandshakeTimeout = 10 * time.Second

	conn, resp, err := dialer.DialContext(ctx, u.String(), nil)
	if err != nil {
		if resp != nil {
			return wsDialErr(resp.StatusCode, err)
		}
		return err
	}
	defer conn.Close()

	// Connected — reset the published state.
	now := time.Now()
	a.publishStatus(sv.ID, true, "")
	_ = a.registry.SetStatus(ctx, sv.ID, &now, "")

	conn.SetReadLimit(2 << 20) // 2 MB max
	conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	stop := make(chan struct{})
	defer close(stop)
	go func() {
		t := time.NewTicker(20 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-stop:
				return
			case <-t.C:
				conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					return
				}
			}
		}
	}()

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return err
		}
		var snap metrics.Snapshot
		if err := json.Unmarshal(data, &snap); err != nil {
			continue
		}
		a.publish(sv.ID, &snap, true, "")
		ts := time.Now()
		_ = a.registry.SetStatus(ctx, sv.ID, &ts, "")
	}
}

func wsDialErr(status int, err error) error {
	switch status {
	case http.StatusUnauthorized, http.StatusForbidden:
		return errAuth{err}
	}
	return err
}

type errAuth struct{ err error }

func (e errAuth) Error() string { return "agent rejected the api key" }
func (e errAuth) Unwrap() error { return e.err }

func (a *Aggregator) publish(id string, snap *metrics.Snapshot, connected bool, errMsg string) {
	a.mu.Lock()
	e, ok := a.entries[id]
	if !ok {
		a.mu.Unlock()
		return
	}
	e.state.Snapshot = snap
	e.state.Connected = connected
	e.state.LastSeen = time.Now()
	e.state.LastError = errMsg
	for ch := range e.subs {
		select {
		case ch <- snap:
		default:
		}
	}
	a.mu.Unlock()
}

func (a *Aggregator) publishStatus(id string, connected bool, errMsg string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	e, ok := a.entries[id]
	if !ok {
		return
	}
	e.state.Connected = connected
	e.state.LastError = errMsg
}
