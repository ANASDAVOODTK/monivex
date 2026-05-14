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
