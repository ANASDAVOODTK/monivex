package ws

import (
	"context"
	"crypto/tls"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// ProxyDialer is the websocket.Dialer used for outbound connections to remote agents.
// Self-signed TLS certs are accepted (LAN deployments).
var ProxyDialer = &websocket.Dialer{
	HandshakeTimeout: 10 * time.Second,
	TLSClientConfig:  &tls.Config{InsecureSkipVerify: true},
}

// Proxy upgrades the incoming request to a WebSocket, dials the upstream
// WebSocket at baseURL+path (authenticated with apiKey), and pumps frames
// in both directions until either side closes.
//
// upstreamQuery is appended to the upstream URL (typically copied from r.URL.RawQuery).
func Proxy(w http.ResponseWriter, r *http.Request, baseURL, apiKey, path, upstreamQuery string) {
	u, err := url.Parse(strings.TrimRight(baseURL, "/") + path)
	if err != nil {
		http.Error(w, "bad upstream url", http.StatusBadGateway)
		return
	}
	switch strings.ToLower(u.Scheme) {
	case "https":
		u.Scheme = "wss"
	default:
		u.Scheme = "ws"
	}
	q, _ := url.ParseQuery(upstreamQuery)
	q.Del("token") // do not forward hub-side JWT
	q.Set("api_key", apiKey)
	u.RawQuery = q.Encode()

	// Dial upstream first — if it fails we can still return an HTTP error.
	upstream, resp, err := ProxyDialer.DialContext(r.Context(), u.String(), nil)
	if err != nil {
		status := http.StatusBadGateway
		if resp != nil {
			status = resp.StatusCode
		}
		http.Error(w, "upstream dial failed: "+err.Error(), status)
		return
	}
	defer upstream.Close()

	client, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer client.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// upstream -> client
	go func() {
		defer cancel()
		for {
			mt, data, err := upstream.ReadMessage()
			if err != nil {
				return
			}
			client.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := client.WriteMessage(mt, data); err != nil {
				return
			}
		}
	}()

	// client -> upstream
	go func() {
		defer cancel()
		for {
			mt, data, err := client.ReadMessage()
			if err != nil {
				return
			}
			upstream.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := upstream.WriteMessage(mt, data); err != nil {
				return
			}
		}
	}()

	<-ctx.Done()
}
