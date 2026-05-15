package supabase

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// GenerateConfig produces a fully populated set of Supabase credentials:
// a 32-byte JWT secret (hex encoded), matching anon and service_role JWTs,
// a Studio admin password and the Postgres password. Implements the
// templates.DefaultGenerator capability so the UI can prefill the form.
func (d *Driver) GenerateConfig() (map[string]string, error) {
	jwtSecret, err := randomHex(32)
	if err != nil {
		return nil, err
	}
	anonJWT, err := issueSupabaseJWT([]byte(jwtSecret), "anon")
	if err != nil {
		return nil, err
	}
	serviceJWT, err := issueSupabaseJWT([]byte(jwtSecret), "service_role")
	if err != nil {
		return nil, err
	}
	dashboardPw, err := randomPassword(20)
	if err != nil {
		return nil, err
	}
	postgresPw, err := randomPassword(24)
	if err != nil {
		return nil, err
	}
	return map[string]string{
		"jwt_secret":         jwtSecret,
		"anon_key":           anonJWT,
		"service_role_key":   serviceJWT,
		"dashboard_password": dashboardPw,
		"postgres_password":  postgresPw,
	}, nil
}

// GenerateConfigWithPorts is the port-aware companion to GenerateConfig: it
// builds the secret values AND fills URL-shaped fields (Site URL, Public
// API URL) using the host ports actually assigned to this deployment, so a
// second project that gets bumped to Kong port 8001 sees a default of
// http://localhost:8001 instead of the hardcoded :8000.
func (d *Driver) GenerateConfigWithPorts(ports map[string]int) (map[string]string, error) {
	cfg, err := d.GenerateConfig()
	if err != nil {
		return nil, err
	}
	kongPort := ports["kong_http"]
	if kongPort > 0 {
		cfg["public_api_url"] = fmt.Sprintf("http://localhost:%d", kongPort)
		// Site URL is the user's frontend, not us — keep localhost:3000 only
		// if no better hint exists. We don't know the frontend port; offer
		// the same Kong host so users at least get something reachable to
		// edit. They can change it any time before deploy.
		if cfg["site_url"] == "" || cfg["site_url"] == "http://localhost:3000" {
			cfg["site_url"] = fmt.Sprintf("http://localhost:%d", kongPort)
		}
	}
	return cfg, nil
}

func issueSupabaseJWT(secret []byte, role string) (string, error) {
	now := time.Now()
	// 10-year lifetime so the generated keys behave like Supabase Cloud keys.
	exp := now.AddDate(10, 0, 0)
	claims := jwt.MapClaims{
		"iss":  "supabase",
		"role": role,
		"iat":  now.Unix(),
		"exp":  exp.Unix(),
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return tok.SignedString(secret)
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("random: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// randomPassword returns a URL-safe random string of approximately n bytes of
// entropy. The result is filtered to avoid characters that would need escaping
// inside a .env file.
func randomPassword(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("random: %w", err)
	}
	enc := base64.RawURLEncoding.EncodeToString(buf)
	enc = strings.NewReplacer("-", "A", "_", "B").Replace(enc)
	if len(enc) > n+8 {
		enc = enc[:n+8]
	}
	return enc, nil
}
