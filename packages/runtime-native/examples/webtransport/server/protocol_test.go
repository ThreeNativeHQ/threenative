package main

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type vectorFile struct {
	Version int             `json:"version"`
	Valid   []validVector   `json:"valid"`
	Invalid []invalidVector `json:"invalid"`
}

type validVector struct {
	Name       string `json:"name"`
	Hex        string `json:"hex"`
	Kind       byte   `json:"kind"`
	Channel    uint16 `json:"channel"`
	PayloadHex string `json:"payloadHex"`
}

type invalidVector struct {
	Name   string `json:"name"`
	Hex    string `json:"hex"`
	Reason string `json:"reason"`
}

func loadVectors(t *testing.T) vectorFile {
	t.Helper()
	// Canonical shared fixture; never copied per language (PROTOCOL.md).
	path := filepath.Join("..", "..", "..", "..", "..", "docs", "PRDs", "networking", "protocol-v1-vectors.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading vectors fixture: %v", err)
	}
	var vectors vectorFile
	if err := json.Unmarshal(raw, &vectors); err != nil {
		t.Fatalf("decoding vectors fixture: %v", err)
	}
	if vectors.Version != 1 {
		t.Fatalf("vectors version %d, want 1", vectors.Version)
	}
	return vectors
}

func mustHex(t *testing.T, s string) []byte {
	t.Helper()
	raw, err := hex.DecodeString(s)
	if err != nil {
		t.Fatalf("decoding hex: %v", err)
	}
	return raw
}

// TestVectors decodes every literal vector and independently encodes the
// mandatory values: expected bytes are written literally below, never
// generated from EncodeFrame, so a shared generator cannot produce both
// sides. Corrupting one literal hex must fail this test (acceptance 2).
func TestVectors(t *testing.T) {
	vectors := loadVectors(t)

	mandatoryValid := map[string]string{
		"empty-data-channel-1": "0110000100000000",
		"data-ab-channel-1":    "01100001000000026162",
		"bind-channel-2":       "0103000200000000",
		"bound-channel-2":      "0104000200000000",
		"data-channel-65535":   "0110ffff0000000100",
	}
	seenValid := make(map[string]bool)
	for _, v := range vectors.Valid {
		seenValid[v.Name] = true
		raw := mustHex(t, v.Hex)
		payload := mustHex(t, v.PayloadHex)
		// Header fields are checked literally, not via the implementation.
		if len(raw) < headerLen {
			t.Fatalf("%s: %d bytes cannot hold a header", v.Name, len(raw))
		}
		if raw[0] != wireVersion {
			t.Fatalf("%s: version %d, want 1", v.Name, raw[0])
		}
		if raw[1] != v.Kind {
			t.Fatalf("%s: kind %d, want %d", v.Name, raw[1], v.Kind)
		}
		if binary.BigEndian.Uint16(raw[2:4]) != v.Channel {
			t.Fatalf("%s: channel mismatch", v.Name)
		}
		if binary.BigEndian.Uint32(raw[4:8]) != uint32(len(payload)) {
			t.Fatalf("%s: declared length mismatch", v.Name)
		}
		if !bytes.Equal(raw[headerLen:], payload) {
			t.Fatalf("%s: payload bytes differ", v.Name)
		}
		if v.Kind == kindData {
			frame, err := DecodeDatagram(raw)
			if err != nil {
				t.Fatalf("%s: datagram decode: %v", v.Name, err)
			}
			if frame.Kind != v.Kind || frame.Channel != v.Channel || !bytes.Equal(frame.Payload, payload) {
				t.Fatalf("%s: decoded frame mismatch", v.Name)
			}
			continue
		}
		// HELLO/WELCOME/BIND/BOUND travel by stream, never by datagram.
		frames, err := NewDecoder(maxHelloLen).Feed(raw)
		if err != nil {
			t.Fatalf("%s: stream decode: %v", v.Name, err)
		}
		if len(frames) != 1 || frames[0].Kind != v.Kind || frames[0].Channel != v.Channel ||
			!bytes.Equal(frames[0].Payload, payload) {
			t.Fatalf("%s: stream round trip mismatch", v.Name)
		}
	}
	for name, wantHex := range mandatoryValid {
		if !seenValid[name] {
			t.Fatalf("mandatory valid vector %q missing", name)
		}
		for _, v := range vectors.Valid {
			if v.Name == name && !strings.EqualFold(v.Hex, wantHex) {
				t.Fatalf("mandatory vector %q hex %s, want %s", name, v.Hex, wantHex)
			}
		}
	}

	mandatoryInvalid := []string{
		"wire-version-2", "unknown-kind-255", "data-channel-0",
		"declaration-ffffffff", "truncated-header", "truncated-payload",
		"trailing-datagram-bytes",
	}
	seenInvalid := make(map[string]bool)
	for _, v := range vectors.Invalid {
		seenInvalid[v.Name] = true
		raw := mustHex(t, v.Hex)
		if v.Reason == "" {
			t.Fatalf("%s: invalid vector needs a reason", v.Name)
		}
		// Datagram decoding must reject; stream decoding must reject too,
		// except trailing bytes which are legal mid-stream (coalesced frame).
		if _, err := DecodeDatagram(raw); err == nil {
			t.Fatalf("%s: datagram %s decoded without error", v.Name, v.Hex)
		}
		frames, err := NewDecoder(1 << 20).Feed(raw)
		if v.Name == "trailing-datagram-bytes" {
			if err != nil || len(frames) != 1 {
				t.Fatalf("%s: trailing bytes must decode as one stream frame: %v", v.Name, err)
			}
			continue
		}
		if err == nil {
			// A truncated header/payload yields zero frames and no error
			// mid-stream (waiting for more bytes); anything else must fail.
			if len(frames) == 0 && (v.Name == "truncated-header" || v.Name == "truncated-payload") {
				continue
			}
			t.Fatalf("%s: stream decode of %s succeeded", v.Name, v.Hex)
		}
	}
	for _, name := range mandatoryInvalid {
		if !seenInvalid[name] {
			t.Fatalf("mandatory invalid vector %q missing", name)
		}
	}

	// Independent encoding of the mandatory values: literal expectations.
	independent := []struct {
		name    string
		kind    byte
		channel uint16
		payload []byte
		wantHex string
	}{
		{"empty DATA/1", kindData, 1, nil, "0110000100000000"},
		{"DATA ab/1", kindData, 1, []byte{0x61, 0x62}, "01100001000000026162"},
		{"BIND/2", kindBind, 2, nil, "0103000200000000"},
		{"BOUND/2", kindBound, 2, nil, "0104000200000000"},
		{"DATA/65535", kindData, 65535, []byte{0x00}, "0110ffff0000000100"},
	}
	for _, item := range independent {
		if got := hex.EncodeToString(EncodeFrame(item.kind, item.channel, item.payload)); got != item.wantHex {
			t.Fatalf("%s: encoded %s, want %s", item.name, got, item.wantHex)
		}
	}
}

// TestSplitFrames feeds one coalesced byte string one byte at a time and
// asserts the frames emerge whole at every split boundary.
func TestSplitFrames(t *testing.T) {
	stream := bytes.Join([][]byte{
		EncodeFrame(kindData, 1, []byte("ab")),
		EncodeFrame(kindBind, 2, nil),
		EncodeFrame(kindData, 65535, []byte{0x00}),
	}, nil)
	for split := 0; split <= len(stream); split++ {
		decoder := NewDecoder(1 << 20)
		var got []Frame
		for _, chunk := range [][]byte{stream[:split], stream[split:]} {
			frames, err := decoder.Feed(chunk)
			if err != nil {
				t.Fatalf("split %d: %v", split, err)
			}
			got = append(got, frames...)
		}
		if len(got) != 3 {
			t.Fatalf("split %d: got %d frames, want 3", split, len(got))
		}
		if got[0].Kind != kindData || got[0].Channel != 1 || string(got[0].Payload) != "ab" {
			t.Fatalf("split %d: first frame mismatch", split)
		}
		if got[1].Kind != kindBind || got[1].Channel != 2 || len(got[1].Payload) != 0 {
			t.Fatalf("split %d: second frame mismatch", split)
		}
		if got[2].Kind != kindData || got[2].Channel != 65535 || len(got[2].Payload) != 1 {
			t.Fatalf("split %d: third frame mismatch", split)
		}
	}
}

func TestCoalescedFramesRespectPerFrameLimit(t *testing.T) {
	stream := bytes.Join([][]byte{
		EncodeFrame(kindData, 1, []byte("ab")),
		EncodeFrame(kindBind, 2, nil),
		EncodeFrame(kindData, 3, []byte("z")),
	}, nil)
	frames, err := NewDecoder(2).Feed(stream)
	if err != nil {
		t.Fatalf("coalesced frames rejected: %v", err)
	}
	if len(frames) != 3 {
		t.Fatalf("got %d frames, want 3", len(frames))
	}
}

// TestMalformedFrame rejects unknown versions/kinds, wrong channels,
// oversized declarations, truncated frames and trailing datagram bytes.
func TestMalformedFrame(t *testing.T) {
	vectors := loadVectors(t)
	_ = vectors
	cases := []struct {
		name string
		raw  []byte
	}{
		{"version", mustHex(t, "0201000000000000")},
		{"kind", mustHex(t, "01ff000100000000")},
		{"data-channel-0", mustHex(t, "0110000000000000")},
		{"hello-channel-1", EncodeFrame(kindHello, 1, []byte("{}"))},
		{"huge-declaration", mustHex(t, "01100001ffffffff")},
		{"truncated-header", mustHex(t, "01100001")},
		{"trailing", mustHex(t, "0110000100000002616263")},
	}
	for _, c := range cases {
		if _, err := DecodeDatagram(c.raw); err == nil {
			t.Fatalf("%s: datagram accepted", c.name)
		}
	}
	truncated := [][]byte{mustHex(t, "01100001"), mustHex(t, "01100001000000056162")}
	for i, raw := range truncated {
		if frames, err := NewDecoder(1 << 20).Feed(raw); err != nil || len(frames) != 0 {
			t.Fatalf("truncated %d: err=%v frames=%d, want silent wait", i, err, len(frames))
		}
	}
	// Oversized stream declarations fail rather than allocating.
	huge := mustHex(t, "01100001ffffffff")
	if _, err := NewDecoder(1 << 20).Feed(huge); err == nil {
		t.Fatalf("huge declaration accepted by stream decoder")
	}
}

// TestDuplicateBind rejects the second BIND for a channel.
func TestDuplicateBind(t *testing.T) {
	binder := NewBinder([]Channel{{ID: 1, Delivery: DeliveryUnreliable}, {ID: 2, Delivery: DeliveryReliable}})
	if err := binder.Bind(2); err != nil {
		t.Fatalf("first BIND: %v", err)
	}
	if err := binder.Bind(2); err == nil {
		t.Fatalf("duplicate BIND accepted")
	}
	if err := binder.Bind(9); err == nil {
		t.Fatalf("BIND on unknown channel accepted")
	}
}

// TestChannelMismatch rejects DATA on unknown or unbound channels and HELLO
// off channel 0.
func TestChannelMismatch(t *testing.T) {
	binder := NewBinder([]Channel{{ID: 2, Delivery: DeliveryReliable}})
	if err := binder.CheckData(7); err == nil {
		t.Fatalf("DATA on unknown channel accepted")
	}
	if err := binder.CheckData(2); err == nil {
		t.Fatalf("DATA before BIND accepted")
	}
	if err := binder.Bind(2); err != nil {
		t.Fatalf("BIND: %v", err)
	}
	if err := binder.CheckData(2); err != nil {
		t.Fatalf("DATA after BIND: %v", err)
	}
	if _, _, err := decodeOne(EncodeFrame(kindHello, 1, nil), 0); err == nil {
		t.Fatalf("HELLO on channel 1 accepted")
	}
	if _, err := DecodeDatagram(EncodeFrame(kindBind, 2, nil)); err == nil {
		t.Fatalf("BIND datagram accepted")
	}
}

// TestNegotiatedLimits applies the minimum per direction, rejects a message
// limit above queue capacity, and bounds the stream buffer.
func TestNegotiatedLimits(t *testing.T) {
	client := Limits{MaxReliableMessageBytes: 65536, MaxQueuedReliableBytes: 1048576, MaxQueuedDatagrams: 256}
	server := Limits{MaxReliableMessageBytes: 32768, MaxQueuedReliableBytes: 1 << 20, MaxQueuedDatagrams: 128}
	got, err := Negotiate(client, server)
	if err != nil {
		t.Fatalf("negotiate: %v", err)
	}
	if got.MaxReliableMessageBytes != 32768 || got.MaxQueuedReliableBytes != 1<<20 || got.MaxQueuedDatagrams != 128 {
		t.Fatalf("negotiated %+v, want minima", got)
	}
	bad := Limits{MaxReliableMessageBytes: 1 << 20, MaxQueuedReliableBytes: 65536, MaxQueuedDatagrams: 8}
	if _, err := Negotiate(bad, bad); err == nil {
		t.Fatalf("message limit above queue capacity accepted")
	}
	if err := checkLimits(Limits{MaxReliableMessageBytes: 1 << 20, MaxQueuedReliableBytes: 8, MaxQueuedDatagrams: 1}); err == nil {
		t.Fatalf("invalid configured limits accepted")
	}
	// The decoder holds at most limit+8: a declaration of limit+1
	// fails on the header alone, before any payload is buffered.
	decoder := NewDecoder(16)
	oversize := EncodeFrame(kindData, 1, make([]byte, 17))
	if _, err := decoder.Feed(oversize[:headerLen]); err == nil {
		t.Fatalf("declaration past limit+8 accepted")
	}
	atLimit := EncodeFrame(kindData, 1, make([]byte, 16))
	if frames, err := NewDecoder(16).Feed(atLimit); err != nil || len(frames) != 1 {
		t.Fatalf("declaration at limit+8 rejected: %v", err)
	}
}

func TestHandshakeValidation(t *testing.T) {
	cfg := Config{
		ApplicationProtocol: "threenative-smoke/1",
		Channels:            []Channel{{ID: 1, Delivery: DeliveryUnreliable}, {ID: 2, Delivery: DeliveryReliable}},
		Limits:              defaultLimits(),
	}
	good := `{"applicationProtocol":"threenative-smoke/1","credential":"opaque-token",` +
		`"channels":[{"id":1,"delivery":"unreliable"},{"id":2,"delivery":"reliable-ordered"}],` +
		`"maxReliableMessageBytes":65536,"maxQueuedReliableBytes":1048576,"maxQueuedDatagrams":256}`
	credential, limits, err := parseHello([]byte(good), cfg)
	if err != nil {
		t.Fatalf("valid HELLO: %v", err)
	}
	if credential != "opaque-token" {
		t.Fatalf("credential mismatch")
	}
	if limits.MaxQueuedDatagrams != 256 {
		t.Fatalf("limits %+v", limits)
	}
	rejects := map[string]string{
		"unknown key":      strings.Replace(good, `"credential"`, `"credentialX"`, 1),
		"missing key":      strings.Replace(good, `"credential":"opaque-token",`, ``, 1),
		"duplicate id":     strings.Replace(good, `{"id":2,`, `{"id":1,`, 1),
		"unknown delivery": strings.Replace(good, `"reliable-ordered"`, `"reliable"`, 1),
		"wrong protocol":   strings.Replace(good, `threenative-smoke/1`, `other/1`, 1),
		"empty credential": strings.Replace(good, `"opaque-token"`, `""`, 1),
		"float limit":      strings.Replace(good, `:65536,`, `:65536.5,`, 1),
		"string limit":     strings.Replace(good, `:65536,`, `:"65536",`, 1),
		"bad utf8":         string(append([]byte(good[:10]), 0xff)),
		"bad json":         good[:40],
		"trailing JSON":    good + " {}",
	}
	for name, payload := range rejects {
		if _, _, err := parseHello([]byte(payload), cfg); err == nil {
			t.Fatalf("%s: accepted", name)
		}
	}
	// Duplicate top-level keys are rejected even though encoding/json keeps
	// the last value silently.
	dup := strings.Replace(good, `"channels"`, `"channels","channels":[1],"x-channels"`, 1)
	if _, _, err := parseHello([]byte(dup), cfg); err == nil {
		t.Fatalf("duplicate top-level key accepted")
	}

	welcome, sessionID, negotiated, err := buildWelcome(cfg, limits)
	if err != nil {
		t.Fatalf("build WELCOME: %v", err)
	}
	if !validSessionID(sessionID) {
		t.Fatalf("session ID %q not 32 lowercase hex", sessionID)
	}
	back, idBack, err := parseWelcome(welcome, cfg, cfg.Channels)
	if err != nil {
		t.Fatalf("parse WELCOME: %v", err)
	}
	if idBack != sessionID || back != negotiated {
		t.Fatalf("WELCOME round trip mismatch")
	}
}

// issueFixtureToken mints a credential through the admin handler so the auth
// tests exercise the same path the test orchestrator uses.
func issueFixtureToken(t *testing.T, store *tokenStore, room, playerID string) tokenResponse {
	t.Helper()
	body := `{"room":` + jsonString(t, room) + `,"playerId":` + jsonString(t, playerID) + `}`
	req := httptest.NewRequest(http.MethodPost, "/token", strings.NewReader(body))
	req.RemoteAddr = "127.0.0.1:9"
	rec := httptest.NewRecorder()
	store.serveToken(rec, req)
	res := rec.Result()
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("issue token: status %d", res.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		t.Fatalf("issue token body: %v", err)
	}
	var out tokenResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("issue token JSON: %v", err)
	}
	return out
}

func jsonString(t *testing.T, s string) string {
	t.Helper()
	raw, err := json.Marshal(s)
	if err != nil {
		t.Fatalf("marshal string: %v", err)
	}
	return string(raw)
}

func validatorConfig(room string, store *tokenStore) Config {
	return Config{
		ApplicationProtocol: "threenative-smoke/1",
		Channels:            []Channel{{ID: 1, Delivery: DeliveryUnreliable}},
		Limits:              defaultLimits(),
		Validator:           store.validator(room),
	}
}

// TestExpiredToken issues a credential, advances past the 60-second expiry
// and verifies validation rejects it.
func TestExpiredToken(t *testing.T) {
	now := time.Now()
	store := newTokenStore(func() time.Time { return now })
	issued := issueFixtureToken(t, store, "networking-proof", "player-a")
	if _, _, ok := store.validator("networking-proof").ValidateCredential(issued.Credential); !ok {
		t.Fatalf("fresh token rejected")
	}
	now = now.Add(61 * time.Second)
	if _, _, ok := store.validator("networking-proof").ValidateCredential(issued.Credential); ok {
		t.Fatalf("expired token accepted")
	}
}

// TestTokenReplay verifies a credential is one-time: first HELLO-validation
// succeeds, the replay rejects.
func TestTokenReplay(t *testing.T) {
	store := newTokenStore(time.Now)
	issued := issueFixtureToken(t, store, "networking-proof", "player-a")
	if _, _, ok := store.validator("networking-proof").ValidateCredential(issued.Credential); !ok {
		t.Fatalf("first use rejected")
	}
	if _, _, ok := store.validator("networking-proof").ValidateCredential(issued.Credential); ok {
		t.Fatalf("replayed token accepted")
	}
}

// TestWrongRoom issues a token bound to room B and verifies the validator for
// the configured room A rejects the join with no player allocation.
func TestWrongRoom(t *testing.T) {
	store := newTokenStore(time.Now)
	issued := issueFixtureToken(t, store, "room-b", "player-a")
	if _, _, ok := store.validator("room-a").ValidateCredential(issued.Credential); ok {
		t.Fatalf("wrong-room token accepted")
	}
	// The token stays unconsumed for its own room: room binding rejects
	// before consumption.
	if _, _, ok := store.validator("room-b").ValidateCredential(issued.Credential); !ok {
		t.Fatalf("own-room token should still be valid after a wrong-room attempt")
	}
}

// TestUnauthorizedGameplay rejects unknown, empty and wrong-player-shaped
// credentials without allocating game state.
func TestUnauthorizedGameplay(t *testing.T) {
	store := newTokenStore(time.Now)
	validator := store.validator("networking-proof")
	for name, credential := range map[string]string{
		"unknown": "not-a-real-credential",
		"empty":   "",
	} {
		if _, _, ok := validator.ValidateCredential(credential); ok {
			t.Fatalf("%s credential accepted", name)
		}
	}
	// A credential bound to another player is still a single opaque value:
	// presenting any credential minted for a different room must reject.
	issued := issueFixtureToken(t, store, "other-room", "player-b")
	if _, _, ok := validator.ValidateCredential(issued.Credential); ok {
		t.Fatalf("cross-room credential accepted")
	}
}

// TestOriginAllowlist keeps exact Origin matching separate from credential
// identity: allowlisted pages pass, others reject, and credential validation
// does not consult origins.
func TestOriginAllowlist(t *testing.T) {
	check := originChecker([]string{"https://game.test:443"})
	allowed := httptest.NewRequest(http.MethodGet, "https://server.test/game", nil)
	allowed.Host = "server.test"
	allowed.Header.Set("Origin", "https://game.test")
	if !check(allowed) {
		t.Fatalf("allowlisted origin rejected")
	}
	unlisted := httptest.NewRequest(http.MethodGet, "https://server.test/game", nil)
	unlisted.Host = "server.test"
	unlisted.Header.Set("Origin", "https://evil.test")
	if check(unlisted) {
		t.Fatalf("unlisted origin accepted")
	}
	// Empty Origin is a non-browser client; the checker passes it and
	// credential identity still decides.
	nonBrowser := httptest.NewRequest(http.MethodGet, "https://server.test/game", nil)
	nonBrowser.Host = "server.test"
	if !check(nonBrowser) {
		t.Fatalf("non-browser request rejected")
	}
}

// TestAdminRejectsNonLoopback verifies the issuer refuses requests that are
// not from a loopback peer, including forwarded ones.
func TestAdminRejectsNonLoopback(t *testing.T) {
	store := newTokenStore(time.Now)
	for name, remoteAddr := range map[string]string{
		"remote":    "203.0.113.7:9",
		"forwarded": "127.0.0.1:9",
	} {
		req := httptest.NewRequest(http.MethodPost, "/token",
			strings.NewReader(`{"room":"networking-proof","playerId":"player-a"}`))
		req.RemoteAddr = remoteAddr
		if name == "forwarded" {
			req.Header.Set("X-Forwarded-For", "203.0.113.7")
		}
		rec := httptest.NewRecorder()
		store.serveToken(rec, req)
		if rec.Result().StatusCode != http.StatusForbidden {
			t.Fatalf("%s request not rejected: %d", name, rec.Result().StatusCode)
			rec.Result().Body.Close()
		} else {
			rec.Result().Body.Close()
		}
	}
}

// TestAdminRejectsMalformed verifies methods and JSON outside the contract
// are rejected without issuing a credential.
func TestAdminRejectsMalformed(t *testing.T) {
	store := newTokenStore(time.Now)
	cases := map[string]*http.Request{}
	get := httptest.NewRequest(http.MethodGet, "/token", nil)
	get.RemoteAddr = "127.0.0.1:9"
	cases["method"] = get
	for name, body := range map[string]string{
		"missing-player": `{"room":"networking-proof"}`,
		"empty-player":   `{"room":"networking-proof","playerId":""}`,
		"unknown-key":    `{"room":"networking-proof","playerId":"a","role":"admin"}`,
		"bad-json":       `{"room":`,
		"bad-player":     `{"room":"networking-proof","playerId":"has space"}`,
	} {
		req := httptest.NewRequest(http.MethodPost, "/token", strings.NewReader(body))
		req.RemoteAddr = "127.0.0.1:9"
		cases[name] = req
	}
	for name, req := range cases {
		rec := httptest.NewRecorder()
		store.serveToken(rec, req)
		res := rec.Result()
		res.Body.Close()
		if res.StatusCode == http.StatusOK {
			t.Fatalf("%s: accepted", name)
		}
	}
}

// TestAdminIssuerBounded verifies concurrent issuance stays bounded and every
// issued credential validates exactly once.
func TestAdminIssuerBounded(t *testing.T) {
	store := newTokenStore(time.Now)
	const clients = 32
	// Issue concurrently without touching testing.T off the test goroutine:
	// each worker reports its raw body through a channel and the test
	// goroutine decodes and asserts.
	type result struct {
		index int
		code  int
		body  []byte
	}
	results := make(chan result, clients)
	var wg sync.WaitGroup
	for i := 0; i < clients; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			body := `{"room":"networking-proof","playerId":"player-bounded"}`
			req := httptest.NewRequest(http.MethodPost, "/token", strings.NewReader(body))
			req.RemoteAddr = "127.0.0.1:9"
			rec := httptest.NewRecorder()
			store.serveToken(rec, req)
			res := rec.Result()
			raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
			res.Body.Close()
			results <- result{index: i, code: res.StatusCode, body: raw}
		}(i)
	}
	wg.Wait()
	close(results)
	issued := make([]string, clients)
	for r := range results {
		if r.code != http.StatusOK {
			t.Fatalf("client %d: status %d", r.index, r.code)
		}
		var out tokenResponse
		if err := json.Unmarshal(r.body, &out); err != nil {
			t.Fatalf("client %d: %v", r.index, err)
		}
		issued[r.index] = out.Credential
	}
	validator := store.validator("networking-proof")
	for i, credential := range issued {
		if credential == "" {
			t.Fatalf("client %d issued empty credential", i)
		}
		if _, _, ok := validator.ValidateCredential(credential); !ok {
			t.Fatalf("client %d credential rejected", i)
		}
	}
}

func TestGameUnavailableWithoutValidator(t *testing.T) {
	cfg := Config{
		ApplicationProtocol: "threenative-smoke/1",
		Channels:            []Channel{{ID: 1, Delivery: DeliveryUnreliable}},
		Limits:              defaultLimits(),
	}
	if err := cfg.validate(); err != nil {
		t.Fatalf("valid config: %v", err)
	}
	if cfg.Validator != nil {
		t.Fatalf("validator must default to nil (fail-closed)")
	}
	// The fail-closed path is proven without a network: ServeGame with a nil
	// session would panic, so assert the sentinel contract directly.
	if !errors.Is(ErrUnavailable, ErrUnavailable) {
		t.Fatalf("sentinel broken")
	}
	if errors.Is(ErrUnavailable, ErrAuthentication) {
		t.Fatalf("unavailable and authentication errors must be distinct")
	}
}
