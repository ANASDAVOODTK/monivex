// Package pairing encodes/decodes the one-string token an agent prints from
// `server-monitor-agent pair`. The user pastes this single string into the
// hub's "Add server" form instead of copying URL + API key separately.
//
// Format: "sm://" + base64url(JSON{v:1, url, key}).
package pairing

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
)

const Prefix = "sm://"

type payload struct {
	V    int    `json:"v"`
	URL  string `json:"url"`
	Key  string `json:"key"`
	Note string `json:"note,omitempty"`
}

// Encode returns the pairing string for a (url, apiKey) pair.
func Encode(url, apiKey, note string) (string, error) {
	if url == "" || apiKey == "" {
		return "", errors.New("url and api key are required")
	}
	b, err := json.Marshal(payload{V: 1, URL: url, Key: apiKey, Note: note})
	if err != nil {
		return "", err
	}
	return Prefix + base64.RawURLEncoding.EncodeToString(b), nil
}

// Decoded is the result of Decode.
type Decoded struct {
	URL  string
	Key  string
	Note string
}

// Decode parses a pairing string.
func Decode(s string) (*Decoded, error) {
	s = strings.TrimSpace(s)
	if !strings.HasPrefix(s, Prefix) {
		return nil, errors.New("missing sm:// prefix")
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(s, Prefix))
	if err != nil {
		return nil, errors.New("bad base64")
	}
	var p payload
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, errors.New("bad json")
	}
	if p.V != 1 {
		return nil, errors.New("unsupported version")
	}
	if p.URL == "" || p.Key == "" {
		return nil, errors.New("incomplete token")
	}
	return &Decoded{URL: p.URL, Key: p.Key, Note: p.Note}, nil
}
