package qdrant

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
)

// GenerateConfig produces a random API key so deployments can be created
// quickly without manually inventing credentials.
func (d *Driver) GenerateConfig() (map[string]string, error) {
	k, err := randomAPIKey(36)
	if err != nil {
		return nil, err
	}
	return map[string]string{
		"api_key": k,
	}, nil
}

func randomAPIKey(n int) (string, error) {
	if n < 16 {
		n = 16
	}
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("random: %w", err)
	}
	return "qdrant_" + base64.RawURLEncoding.EncodeToString(buf), nil
}
