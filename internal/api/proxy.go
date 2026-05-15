package api

import (
	"crypto/tls"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// hopByHopHeaders are stripped from both directions of a proxy.
var hopByHopHeaders = map[string]bool{
	"Connection":          true,
	"Keep-Alive":          true,
	"Proxy-Authenticate":  true,
	"Proxy-Authorization": true,
	"Te":                  true,
	"Trailer":             true,
	"Transfer-Encoding":   true,
	"Upgrade":             true,
}

// remoteHTTPClient is a *http.Client tuned for talking to remote agents on the LAN.
// Self-signed certificates are accepted because LAN deployments commonly use them.
var remoteHTTPClient = &http.Client{
	Timeout: 30 * time.Second,
	Transport: &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		MaxIdleConns:          50,
		IdleConnTimeout:       90 * time.Second,
		TLSClientConfig:       &tls.Config{InsecureSkipVerify: true},
		ResponseHeaderTimeout: 25 * time.Second,
	},
}

// proxyHTTP issues a request to baseURL+path on the remote agent using apiKey for auth
// and streams the response back to w.
func proxyHTTP(w http.ResponseWriter, r *http.Request, baseURL, apiKey, path string) {
	u, err := url.Parse(strings.TrimRight(baseURL, "/") + path)
	if err != nil {
		writeErr(w, 502, "bad agent url")
		return
	}
	u.RawQuery = r.URL.RawQuery

	req, err := http.NewRequestWithContext(r.Context(), r.Method, u.String(), r.Body)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	// Copy a small allowlist of request headers.
	for _, k := range []string{"Content-Type", "Accept", "User-Agent"} {
		if v := r.Header.Get(k); v != "" {
			req.Header.Set(k, v)
		}
	}
	req.Header.Set("X-API-Key", apiKey)

	resp, err := remoteHTTPClient.Do(req)
	if err != nil {
		writeErr(w, 502, "agent unreachable: "+err.Error())
		return
	}
	defer resp.Body.Close()

	for k, vs := range resp.Header {
		if hopByHopHeaders[k] {
			continue
		}
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}
