package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/ANASDAVOODTK/server-monitor/internal/store"
)

const (
	jwtSecretKey   = "jwt_secret"
	cookieName     = "sm_token"
	tokenLifetime  = 12 * time.Hour
	setupTokenSize = 24
)

var ErrUnauthorized = errors.New("unauthorized")

type Service struct {
	store      *store.Store
	secret     []byte
	setupToken string
	setupOnce  sync.Mutex
	setupDone  bool
}

type Claims struct {
	UserID   int64  `json:"uid"`
	Username string `json:"usr"`
	jwt.RegisteredClaims
}

func New(ctx context.Context, s *store.Store) (*Service, error) {
	svc := &Service{store: s}
	secretHex, err := s.GetSetting(ctx, jwtSecretKey)
	if err != nil {
		return nil, err
	}
	if secretHex == "" {
		buf := make([]byte, 32)
		if _, err := rand.Read(buf); err != nil {
			return nil, err
		}
		secretHex = hex.EncodeToString(buf)
		if err := s.SetSetting(ctx, jwtSecretKey, secretHex); err != nil {
			return nil, err
		}
	}
	svc.secret, err = hex.DecodeString(secretHex)
	if err != nil {
		return nil, err
	}

	count, err := s.UserCount(ctx)
	if err != nil {
		return nil, err
	}
	if count == 0 {
		buf := make([]byte, setupTokenSize)
		if _, err := rand.Read(buf); err != nil {
			return nil, err
		}
		svc.setupToken = hex.EncodeToString(buf)
		fmt.Println("=================================================================")
		fmt.Println("First-run setup required.")
		fmt.Println("Open http://<server>:8080/setup and use this one-time token:")
		fmt.Println("  " + svc.setupToken)
		fmt.Println("=================================================================")
	} else {
		svc.setupDone = true
	}
	return svc, nil
}

func (s *Service) NeedsSetup() bool { return !s.setupDone }

func (s *Service) ConsumeSetupToken(token string) bool {
	s.setupOnce.Lock()
	defer s.setupOnce.Unlock()
	if s.setupDone || s.setupToken == "" {
		return false
	}
	if subtleEq(token, s.setupToken) {
		s.setupToken = ""
		s.setupDone = true
		return true
	}
	return false
}

func subtleEq(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	var v byte
	for i := 0; i < len(a); i++ {
		v |= a[i] ^ b[i]
	}
	return v == 0
}

func (s *Service) Register(ctx context.Context, username, password string) (int64, error) {
	username = strings.TrimSpace(username)
	if len(username) < 3 || len(username) > 64 {
		return 0, errors.New("username must be 3-64 chars")
	}
	if len(password) < 8 {
		return 0, errors.New("password must be at least 8 chars")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return 0, err
	}
	return s.store.CreateUser(ctx, username, string(hash))
}

func (s *Service) Login(ctx context.Context, username, password string) (string, error) {
	u, err := s.store.GetUserByUsername(ctx, username)
	if err != nil {
		return "", ErrUnauthorized
	}
	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)); err != nil {
		return "", ErrUnauthorized
	}
	return s.issue(u.ID, u.Username)
}

func (s *Service) ChangePassword(ctx context.Context, username, oldPw, newPw string) error {
	if len(newPw) < 8 {
		return errors.New("password must be at least 8 chars")
	}
	u, err := s.store.GetUserByUsername(ctx, username)
	if err != nil {
		return ErrUnauthorized
	}
	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(oldPw)); err != nil {
		return ErrUnauthorized
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(newPw), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	return s.store.UpdateUserPassword(ctx, u.ID, string(hash))
}

func (s *Service) issue(uid int64, username string) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID:   uid,
		Username: username,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(tokenLifetime)),
			NotBefore: jwt.NewNumericDate(now),
			Subject:   username,
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return tok.SignedString(s.secret)
}

func (s *Service) Verify(token string) (*Claims, error) {
	c := &Claims{}
	_, err := jwt.ParseWithClaims(token, c, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, errors.New("bad alg")
		}
		return s.secret, nil
	})
	if err != nil {
		return nil, ErrUnauthorized
	}
	return c, nil
}

// CookieName returns the cookie name used for the JWT.
func CookieName() string { return cookieName }

// IssueCookie returns an *http.Cookie carrying the token.
func (s *Service) IssueCookie(token string, secure bool) *http.Cookie {
	return &http.Cookie{
		Name:     cookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Now().Add(tokenLifetime),
	}
}

func (s *Service) ClearCookie(secure bool) *http.Cookie {
	return &http.Cookie{
		Name:     cookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	}
}

// ExtractToken from cookie or Authorization header.
func ExtractToken(r *http.Request) string {
	if c, err := r.Cookie(cookieName); err == nil && c.Value != "" {
		return c.Value
	}
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	// Allow ?token= for WebSocket clients that can't set headers easily.
	if t := r.URL.Query().Get("token"); t != "" {
		return t
	}
	return ""
}

type ctxKey struct{}

// Middleware enforces a valid JWT.
func (s *Service) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tok := ExtractToken(r)
		if tok == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		claims, err := s.Verify(tok)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), ctxKey{}, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func ClaimsFrom(ctx context.Context) *Claims {
	c, _ := ctx.Value(ctxKey{}).(*Claims)
	return c
}
