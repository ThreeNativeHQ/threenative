// Package main implements the PRD-359 reference WebTransport server.
//
// auth.go is the task-4d development credential issuer: random 32-byte
// one-time tokens bound to a room and player, 60-second expiry, hash-only
// storage and atomic consume on HELLO validation. Issuance is exposed only
// through the loopback admin listener (POST /token); /game validation never
// consults Origin. Nothing here logs a token or credential.
package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"regexp"
	"sync"
	"time"
)

// tokenLifetime is the PROTOCOL.md join-token validity window.
const tokenLifetime = 60 * time.Second

// maxTokenRequestBytes bounds the admin issuance body.
const maxTokenRequestBytes = 4096

var validPlayerID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// tokenResponse is the POST /token success shape.
type tokenResponse struct {
	Credential string `json:"credential"`
	ExpiresAt  string `json:"expiresAt"`
}

// tokenRequest is the POST /token request shape.
type tokenRequest struct {
	Room     string `json:"room"`
	PlayerID string `json:"playerId"`
}

type tokenRecord struct {
	room      string
	playerID  string
	expiresAt time.Time
	consumed  bool
}

// tokenStore mints and validates one-time join tokens. Only the SHA-256 hash
// of each credential is stored; the credential itself leaves the process once,
// inside the issuance response.
type tokenStore struct {
	mu     sync.Mutex
	tokens map[[32]byte]tokenRecord
	now    func() time.Time
}

func newTokenStore(now func() time.Time) *tokenStore {
	if now == nil {
		now = time.Now
	}
	return &tokenStore{tokens: make(map[[32]byte]tokenRecord), now: now}
}

func hashCredential(credential string) [32]byte {
	return sha256.Sum256([]byte(credential))
}

// issue mints one credential bound to room/player with a 60-second expiry.
func (s *tokenStore) issue(room, playerID string) (tokenResponse, error) {
	if room == "" || len(room) > 64 {
		return tokenResponse{}, fmt.Errorf("room outside 1-64 characters")
	}
	if !validPlayerID.MatchString(playerID) {
		return tokenResponse{}, fmt.Errorf("invalid player ID")
	}
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return tokenResponse{}, fmt.Errorf("generating credential: %w", err)
	}
	credential := base64.RawURLEncoding.EncodeToString(raw[:])
	expiresAt := s.now().UTC().Add(tokenLifetime)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweepLocked(s.now().UTC())
	s.tokens[hashCredential(credential)] = tokenRecord{
		room:      room,
		playerID:  playerID,
		expiresAt: expiresAt,
	}
	return tokenResponse{
		Credential: credential,
		ExpiresAt:  expiresAt.Format(time.RFC3339Nano),
	}, nil
}

// consume atomically validates a credential for the configured room and marks
// it consumed. Room binding is compared before consumption so a wrong-room
// attempt neither consumes the token nor allocates a player.
func (s *tokenStore) consume(credential, room string) (string, string, bool) {
	if credential == "" {
		return "", "", false
	}
	key := hashCredential(credential)
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.tokens[key]
	if !ok || record.consumed {
		return "", "", false
	}
	if now.After(record.expiresAt) {
		delete(s.tokens, key)
		return "", "", false
	}
	if record.room != room {
		return "", "", false
	}
	record.consumed = true
	s.tokens[key] = record
	return record.room, record.playerID, true
}

// validator binds this store to one configured room for /game HELLO checks.
func (s *tokenStore) validator(room string) CredentialValidator {
	return CredentialValidatorFunc(func(credential string) (string, string, bool) {
		return s.consume(credential, room)
	})
}

func (s *tokenStore) sweepLocked(now time.Time) {
	for key, record := range s.tokens {
		if record.consumed || now.After(record.expiresAt) {
			delete(s.tokens, key)
		}
	}
}

// serveToken implements POST /token on the loopback-only admin listener. It
// rejects non-loopback peers, forwarded requests, non-POST methods and any
// JSON outside the {room,playerId} contract. Errors never carry a credential.
func (s *tokenStore) serveToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !isLoopbackPeer(r) {
		http.Error(w, "admin listener is loopback-only", http.StatusForbidden)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxTokenRequestBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var req tokenRequest
	if err := dec.Decode(&req); err != nil {
		http.Error(w, "invalid token request", http.StatusBadRequest)
		return
	}
	var trailing any
	if err := dec.Decode(&trailing); err != io.EOF {
		http.Error(w, "invalid token request", http.StatusBadRequest)
		return
	}
	issued, err := s.issue(req.Room, req.PlayerID)
	if err != nil {
		http.Error(w, "invalid token request", http.StatusBadRequest)
		return
	}
	raw, err := json.Marshal(issued)
	if err != nil {
		http.Error(w, "cannot encode token", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}

// isLoopbackPeer reports whether r arrived over loopback without forwarding.
// Any forwarding header rejects: behind a proxy RemoteAddr names the proxy,
// not the client, so the loopback check alone would misidentify the peer.
func isLoopbackPeer(r *http.Request) bool {
	if r.Header.Get("X-Forwarded-For") != "" ||
		r.Header.Get("X-Real-Ip") != "" ||
		r.Header.Get("Forwarded") != "" {
		return false
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return false
	}
	addr := net.ParseIP(host)
	if addr == nil {
		// Loopback hostnames resolve locally; anything else is not loopback.
		return host == "localhost"
	}
	return addr.IsLoopback()
}

// isLoopbackListen reports whether a configured listen address binds
// loopback only. "localhost" counts; an unresolvable host does not.
func isLoopbackListen(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return false
	}
	if host == "" {
		return false
	}
	if host == "localhost" {
		return true
	}
	parsed := net.ParseIP(host)
	if parsed == nil {
		return false
	}
	return parsed.IsLoopback()
}
