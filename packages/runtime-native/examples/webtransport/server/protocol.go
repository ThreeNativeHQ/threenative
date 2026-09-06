// Package main implements the PRD-359 reference WebTransport server.
//
// protocol.go is the application adapter NORMATIVE contract in
// docs/PRDs/networking/PROTOCOL.md covers: the 8-byte big-endian envelope,
// HELLO/WELCOME on the first client-created bidirectional stream, per-channel
// BIND/BOUND on one stream per reliable channel, and single-frame DATA
// datagrams. It implements no reliability, replication, gameplay or native
// server FFI; each game supplies those through Config. Authentication stays
// fail-closed until task 4d supplies a credential validator: without one the
// adapter rejects every handshake with ErrUnavailable and allocates no game
// state.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"slices"
	"time"

	"github.com/quic-go/webtransport-go"
)

const (
	wireVersion byte = 1

	kindHello   byte = 1
	kindWelcome byte = 2
	kindBind    byte = 3
	kindBound   byte = 4
	kindData    byte = 16

	headerLen = 8

	// Reference game channel map (PROTOCOL.md). The smoke example and the
	// future reference gameplay share this map; task 5b owns payload schemas.
	channelInput   uint16 = 1
	channelState   uint16 = 2
	channelActions uint16 = 3
	channelClock   uint16 = 4

	maxChannels = 32
	maxHelloLen = 4096

	minConnectTimeout = time.Second
	maxConnectTimeout = 5 * time.Minute

	// Absolute ceilings a single declaration may carry. Negotiated limits apply
	// per direction and must sit at or below these.
	maxMessageBytesCeiling = 16 << 20  // 16 MiB
	maxQueuedBytesCeiling  = 256 << 20 // 256 MiB
	maxDatagramsCeiling    = 65536

	maxProtocolLen = 64
	minProtocolLen = 1
	maxChannelID   = 65535
	minChannelID   = 1
)

// ErrUnavailable reports that the game path is configured but not yet usable
// (task 4a): no credential validator has been injected, so authentication
// cannot complete. Task 4d wires the token validator that enables the live
// path. The message never carries a credential.
var ErrUnavailable = errors.New("game unavailable: no credential validator configured")

// ErrAuthentication reports a rejected handshake. The value never carries the
// presented credential.
var ErrAuthentication = errors.New("game authentication failed")

// SessionErrorCode values close a malformed or rejected session. They are the
// application's own codes, not webtransport-go transport codes.
const (
	closeMalformed      webtransport.SessionErrorCode = 0x544e0001
	closeAuthentication webtransport.SessionErrorCode = 0x544e0002
)

// Delivery names a channel's transport guarantee.
type Delivery string

const (
	// DeliveryUnreliable travels by datagram: one DATA frame per datagram,
	// oldest-dropped on saturation, never reassembled.
	DeliveryUnreliable Delivery = "unreliable"
	// DeliveryReliable travels by stream: one bidirectional stream per channel,
	// ordered within that channel only.
	DeliveryReliable Delivery = "reliable-ordered"
)

// Channel binds a 1-65535 channel ID to its delivery guarantee.
type Channel struct {
	ID       uint16
	Delivery Delivery
}

// Limits carries the three negotiated per-direction bounds from PROTOCOL.md.
type Limits struct {
	MaxReliableMessageBytes uint64
	MaxQueuedReliableBytes  uint64
	MaxQueuedDatagrams      uint64
}

// Defaults matches the connect defaults in PROTOCOL.md.
func defaultLimits() Limits {
	return Limits{
		MaxReliableMessageBytes: 65536,
		MaxQueuedReliableBytes:  1048576,
		MaxQueuedDatagrams:      256,
	}
}

// CredentialValidator decides whether a presented credential may join. It
// receives the credential from HELLO and reports acceptance; a nil validator
// (the default) rejects everything. Task 4d injects the token validator.
type CredentialValidator interface {
	ValidateCredential(credential string) bool
}

// CredentialValidatorFunc adapts a function to CredentialValidator.
type CredentialValidatorFunc func(credential string) bool

// ValidateCredential implements CredentialValidator.
func (f CredentialValidatorFunc) ValidateCredential(credential string) bool { return f(credential) }

// Config describes one /game endpoint. ApplicationProtocol must match the
// client's HELLO exactly; Channels is the exact channel map both sides use.
// A nil Validator keeps the endpoint fail-closed (ErrUnavailable).
type Config struct {
	ApplicationProtocol string
	Channels            []Channel
	Limits              Limits
	Validator           CredentialValidator
	ConnectTimeout      time.Duration
}

// Ready is the authenticated session task 4d+ rows build on. It carries the
// negotiated limits, the session ID sent in WELCOME, and the live session for
// per-channel DATA exchange. No game state is allocated before Ready exists.
type Ready struct {
	Session   *webtransport.Session
	Limits    Limits
	SessionID string
	Channels  []Channel
}

// validate checks the configured protocol, channel map and limits.
func (c Config) validate() error {
	if len(c.ApplicationProtocol) < minProtocolLen || len(c.ApplicationProtocol) > maxProtocolLen {
		return fmt.Errorf("application protocol length %d outside 1-64", len(c.ApplicationProtocol))
	}
	for i := 0; i < len(c.ApplicationProtocol); i++ {
		if c.ApplicationProtocol[i] < 0x20 || c.ApplicationProtocol[i] > 0x7e {
			return fmt.Errorf("application protocol is not printable ASCII")
		}
	}
	if len(c.Channels) < 1 || len(c.Channels) > maxChannels {
		return fmt.Errorf("channel count %d outside 1-32", len(c.Channels))
	}
	seen := make(map[uint16]bool, len(c.Channels))
	for _, ch := range c.Channels {
		if ch.ID < minChannelID {
			return fmt.Errorf("channel ID %d outside 1-65535", ch.ID)
		}
		if ch.Delivery != DeliveryUnreliable && ch.Delivery != DeliveryReliable {
			return fmt.Errorf("channel %d has unknown delivery %q", ch.ID, ch.Delivery)
		}
		if seen[ch.ID] {
			return fmt.Errorf("duplicate channel ID %d", ch.ID)
		}
		seen[ch.ID] = true
	}
	if err := checkLimits(c.Limits); err != nil {
		return err
	}
	if c.ConnectTimeout != 0 {
		if c.ConnectTimeout < minConnectTimeout || c.ConnectTimeout > maxConnectTimeout {
			return fmt.Errorf("connect timeout %s outside 1s-5m", c.ConnectTimeout)
		}
	}
	return nil
}

func checkLimits(l Limits) error {
	if l.MaxReliableMessageBytes < 1 || l.MaxReliableMessageBytes > maxMessageBytesCeiling {
		return fmt.Errorf("max reliable message bytes %d out of range", l.MaxReliableMessageBytes)
	}
	if l.MaxQueuedReliableBytes < 1 || l.MaxQueuedReliableBytes > maxQueuedBytesCeiling {
		return fmt.Errorf("max queued reliable bytes %d out of range", l.MaxQueuedReliableBytes)
	}
	if l.MaxQueuedDatagrams < 1 || l.MaxQueuedDatagrams > maxDatagramsCeiling {
		return fmt.Errorf("max queued datagrams %d out of range", l.MaxQueuedDatagrams)
	}
	if l.MaxReliableMessageBytes > l.MaxQueuedReliableBytes {
		return fmt.Errorf("message limit %d exceeds queue limit %d",
			l.MaxReliableMessageBytes, l.MaxQueuedReliableBytes)
	}
	return nil
}

// Frame is one decoded envelope: kind, channel and payload bytes.
type Frame struct {
	Kind    byte
	Channel uint16
	Payload []byte
}

// EncodeFrame serializes one frame with the 8-byte unsigned big-endian
// header: version 1, kind, channel uint16, payload length uint32.
func EncodeFrame(kind byte, channel uint16, payload []byte) []byte {
	out := make([]byte, headerLen+len(payload))
	out[0] = wireVersion
	out[1] = kind
	binary.BigEndian.PutUint16(out[2:4], channel)
	binary.BigEndian.PutUint32(out[4:8], uint32(len(payload)))
	copy(out[headerLen:], payload)
	return out
}

// DecodeDatagram decodes exactly one DATA frame from a datagram. The
// datagram's length must equal 8 plus the declared length: trailing bytes are
// an error, and so is any truncation. Datagrams never reassemble.
func DecodeDatagram(raw []byte) (Frame, error) {
	frame, rest, err := decodeOne(raw, 0)
	if err != nil {
		return Frame{}, err
	}
	if len(rest) != 0 {
		return Frame{}, fmt.Errorf("datagram has %d trailing bytes", len(rest))
	}
	if frame.Kind != kindData {
		return Frame{}, fmt.Errorf("datagram carries kind %d, want DATA", frame.Kind)
	}
	if frame.Channel == 0 {
		return Frame{}, fmt.Errorf("datagram DATA on channel 0")
	}
	return frame, nil
}

// Decoder incrementally decodes the repeated frames of a reliable stream,
// which may split or coalesce at any byte boundary. Trailing bytes may begin
// another frame and are not an error. Feed returns each complete frame.
type Decoder struct {
	buf []byte
	max uint64
}

// NewDecoder returns a stream decoder bounding the buffered partial frame to
// the negotiated message limit plus its 8-byte header.
func NewDecoder(messageLimit uint64) *Decoder {
	return &Decoder{max: messageLimit + headerLen}
}

// Feed consumes stream bytes and returns the complete frames they finish.
func (d *Decoder) Feed(chunk []byte) ([]Frame, error) {
	d.buf = append(d.buf, chunk...)
	var frames []Frame
	for len(d.buf) > 0 {
		// Bound only the incomplete frame. A reliable stream may coalesce any
		// number of complete frames in one read, so the total chunk is not a
		// message-size limit.
		if len(d.buf) < headerLen {
			break
		}
		declared := binary.BigEndian.Uint32(d.buf[4:8])
		if uint64(declared)+headerLen > d.max {
			return nil, fmt.Errorf("declared %d bytes exceed the message limit", declared)
		}
		if uint64(len(d.buf)) < uint64(headerLen)+uint64(declared) {
			break
		}
		frame, rest, err := decodeOne(d.buf, d.max)
		if err != nil {
			return nil, err
		}
		frames = append(frames, frame)
		d.buf = append([]byte(nil), rest...)
	}
	return frames, nil
}

var errTruncated = errors.New("truncated frame")

// decodeOne decodes the frame at the head of buf. max bounds the declared
// payload length when nonzero (stream decoding); datagram decoding passes 0
// and relies on the exact-length check instead.
func decodeOne(buf []byte, max uint64) (Frame, []byte, error) {
	if len(buf) < headerLen {
		return Frame{}, nil, errTruncated
	}
	if buf[0] != wireVersion {
		return Frame{}, nil, fmt.Errorf("wire version %d, want 1", buf[0])
	}
	kind := buf[1]
	switch kind {
	case kindHello, kindWelcome, kindBind, kindBound, kindData:
	default:
		return Frame{}, nil, fmt.Errorf("unknown kind %d", kind)
	}
	channel := binary.BigEndian.Uint16(buf[2:4])
	length := binary.BigEndian.Uint32(buf[4:8])
	if max != 0 && uint64(length)+headerLen > max {
		return Frame{}, nil, fmt.Errorf("declared %d bytes exceed the message limit", length)
	}
	// A 0xffffffff declaration on a stream would otherwise pre-allocate 4 GiB.
	if uint64(length) > maxMessageBytesCeiling {
		return Frame{}, nil, fmt.Errorf("declared %d bytes exceed the ceiling", length)
	}
	if uint64(len(buf)-headerLen) < uint64(length) {
		return Frame{}, nil, errTruncated
	}
	payload := append([]byte(nil), buf[headerLen:headerLen+int(length)]...)
	if err := checkChannelForKind(kind, channel); err != nil {
		return Frame{}, nil, err
	}
	return Frame{Kind: kind, Channel: channel, Payload: payload}, buf[headerLen+int(length):], nil
}

func checkChannelForKind(kind byte, channel uint16) error {
	switch kind {
	case kindHello, kindWelcome:
		if channel != 0 {
			return fmt.Errorf("kind %d on channel %d, want 0", kind, channel)
		}
	case kindBind, kindBound, kindData:
		if channel == 0 {
			return fmt.Errorf("kind %d on channel 0", kind)
		}
	}
	return nil
}

// handshakeJSON is the HELLO/WELCOME shape: strict UTF-8 JSON, no unknown
// keys, exact channel map. Credential is HELLO-only; SessionID is
// WELCOME-only and enforced by the parse functions below.
type handshakeJSON struct {
	ApplicationProtocol string           `json:"applicationProtocol"`
	Credential          string           `json:"credential,omitempty"`
	SessionID           string           `json:"sessionId,omitempty"`
	Channels            []channelJSON    `json:"channels"`
	Limits              negotiatedLimits `json:"-"`
}

type channelJSON struct {
	ID       uint16 `json:"id"`
	Delivery string `json:"delivery"`
}

type negotiatedLimits struct {
	MaxReliableMessageBytes uint64
	MaxQueuedReliableBytes  uint64
	MaxQueuedDatagrams      uint64
}

// parseHello decodes the client's HELLO payload: strict UTF-8, strict JSON
// with unknown-key rejection, exact protocol/channel match against cfg, and
// positive-integer limits. It never logs or returns the credential.
func parseHello(payload []byte, cfg Config) (credential string, clientLimits Limits, err error) {
	if len(payload) > maxHelloLen {
		return "", Limits{}, fmt.Errorf("HELLO payload %d bytes exceeds 4096", len(payload))
	}
	raw, limits, err := parseHandshakePayload(payload, true)
	if err != nil {
		return "", Limits{}, err
	}
	if raw.ApplicationProtocol != cfg.ApplicationProtocol {
		return "", Limits{}, fmt.Errorf("application protocol mismatch")
	}
	if err := matchChannels(raw.Channels, cfg.Channels); err != nil {
		return "", Limits{}, err
	}
	if raw.Credential == "" {
		return "", Limits{}, fmt.Errorf("empty credential")
	}
	return raw.Credential, limits, nil
}

// buildWelcome encodes the server's WELCOME payload: same protocol and
// channels, no credential, a fresh 32-lowercase-hex session ID, and the
// minimum of each client/server limit.
func buildWelcome(cfg Config, clientLimits Limits) (payload []byte, sessionID string, limits Limits, err error) {
	limits = Limits{
		MaxReliableMessageBytes: min(clientLimits.MaxReliableMessageBytes, cfg.Limits.MaxReliableMessageBytes),
		MaxQueuedReliableBytes:  min(clientLimits.MaxQueuedReliableBytes, cfg.Limits.MaxQueuedReliableBytes),
		MaxQueuedDatagrams:      min(clientLimits.MaxQueuedDatagrams, cfg.Limits.MaxQueuedDatagrams),
	}
	if limits.MaxReliableMessageBytes > limits.MaxQueuedReliableBytes {
		return nil, "", Limits{}, fmt.Errorf("negotiated message limit exceeds queue capacity")
	}
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return nil, "", Limits{}, fmt.Errorf("generating session ID: %w", err)
	}
	sessionID = hex.EncodeToString(random[:])
	channels := make([]channelJSON, len(cfg.Channels))
	for i, ch := range cfg.Channels {
		channels[i] = channelJSON{ID: ch.ID, Delivery: string(ch.Delivery)}
	}
	raw := map[string]any{
		"applicationProtocol":     cfg.ApplicationProtocol,
		"sessionId":               sessionID,
		"channels":                channels,
		"maxReliableMessageBytes": limits.MaxReliableMessageBytes,
		"maxQueuedReliableBytes":  limits.MaxQueuedReliableBytes,
		"maxQueuedDatagrams":      limits.MaxQueuedDatagrams,
	}
	payload, err = json.Marshal(raw)
	if err != nil {
		return nil, "", Limits{}, err
	}
	return payload, sessionID, limits, nil
}

// parseWelcome decodes the server's WELCOME payload (client-side helper kept
// beside the contract for symmetry; the Go server only encodes it).
func parseWelcome(payload []byte, cfg Config, sentChannels []Channel) (Limits, string, error) {
	if len(payload) > maxHelloLen {
		return Limits{}, "", fmt.Errorf("WELCOME payload %d bytes exceeds 4096", len(payload))
	}
	raw, limits, err := parseHandshakePayload(payload, false)
	if err != nil {
		return Limits{}, "", err
	}
	if raw.ApplicationProtocol != cfg.ApplicationProtocol {
		return Limits{}, "", fmt.Errorf("application protocol mismatch")
	}
	if err := matchChannels(raw.Channels, sentChannels); err != nil {
		return Limits{}, "", err
	}
	if !validSessionID(raw.SessionID) {
		return Limits{}, "", fmt.Errorf("invalid session ID")
	}
	return limits, raw.SessionID, nil
}

func validSessionID(id string) bool {
	if len(id) != 32 {
		return false
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

func matchChannels(got []channelJSON, want []Channel) error {
	if len(got) != len(want) {
		return fmt.Errorf("channel count %d, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i].ID != want[i].ID || Delivery(got[i].Delivery) != want[i].Delivery {
			return fmt.Errorf("channel %d mismatch at index %d", want[i].ID, i)
		}
	}
	return nil
}

// parseHandshakePayload enforces the shared shape: valid UTF-8, strict JSON
// object with exactly the expected keys, duplicate-ID rejection and
// positive-integer limits. wantCredential selects the HELLO key set
// (credential) versus the WELCOME key set (sessionId).
func parseHandshakePayload(payload []byte, wantCredential bool) (handshakeJSON, Limits, error) {
	var out handshakeJSON
	var limits Limits
	if !validUTF8(payload) {
		return out, limits, fmt.Errorf("handshake is not valid UTF-8")
	}
	dec := json.NewDecoder(bytes.NewReader(payload))
	dec.UseNumber()
	var top any
	if err := dec.Decode(&top); err != nil {
		return out, limits, fmt.Errorf("handshake is not valid JSON: %w", err)
	}
	var trailing any
	if err := dec.Decode(&trailing); err != io.EOF {
		if err == nil {
			return out, limits, fmt.Errorf("handshake has trailing JSON values")
		}
		return out, limits, fmt.Errorf("handshake is not valid JSON: %w", err)
	}
	obj, ok := top.(map[string]any)
	if !ok {
		return out, limits, fmt.Errorf("handshake is not a JSON object")
	}
	wantKeys := map[string]bool{
		"applicationProtocol": true, "channels": true,
		"maxReliableMessageBytes": true, "maxQueuedReliableBytes": true, "maxQueuedDatagrams": true,
	}
	if wantCredential {
		wantKeys["credential"] = true
	} else {
		wantKeys["sessionId"] = true
	}
	for key := range obj {
		if !wantKeys[key] {
			return out, limits, fmt.Errorf("handshake has unknown key %q", key)
		}
	}
	for key := range wantKeys {
		if _, present := obj[key]; !present {
			return out, limits, fmt.Errorf("handshake is missing key %q", key)
		}
	}
	// Duplicate object keys are rejected: re-encode each value is not enough,
	// so scan the raw payload for a repeated key spelling at this level.
	if err := rejectDuplicateKeys(payload); err != nil {
		return out, limits, err
	}
	protocol, ok := obj["applicationProtocol"].(string)
	if !ok {
		return out, limits, fmt.Errorf("applicationProtocol is not a string")
	}
	if len(protocol) < minProtocolLen || len(protocol) > maxProtocolLen || !printableASCII(protocol) {
		return out, limits, fmt.Errorf("applicationProtocol outside 1-64 printable ASCII")
	}
	out.ApplicationProtocol = protocol
	if wantCredential {
		credential, ok := obj["credential"].(string)
		if !ok {
			return out, limits, fmt.Errorf("credential is not a string")
		}
		out.Credential = credential
	} else {
		sessionID, ok := obj["sessionId"].(string)
		if !ok {
			return out, limits, fmt.Errorf("sessionId is not a string")
		}
		out.SessionID = sessionID
	}
	channels, ok := obj["channels"].([]any)
	if !ok {
		return out, limits, fmt.Errorf("channels is not an array")
	}
	if len(channels) < 1 || len(channels) > maxChannels {
		return out, limits, fmt.Errorf("channel count %d outside 1-32", len(channels))
	}
	seen := make(map[uint64]bool, len(channels))
	for i, entry := range channels {
		item, ok := entry.(map[string]any)
		if !ok {
			return out, limits, fmt.Errorf("channel %d is not an object", i)
		}
		if len(item) != 2 {
			return out, limits, fmt.Errorf("channel %d has %d keys, want id and delivery", i, len(item))
		}
		idRaw, idPresent := item["id"]
		deliveryRaw, deliveryPresent := item["delivery"]
		if !idPresent || !deliveryPresent {
			return out, limits, fmt.Errorf("channel %d needs id and delivery", i)
		}
		id, err := jsonNumberUint(idRaw)
		if err != nil || id < minChannelID || id > maxChannelID {
			return out, limits, fmt.Errorf("channel %d has invalid id", i)
		}
		delivery, ok := deliveryRaw.(string)
		if !ok || (Delivery(delivery) != DeliveryUnreliable && Delivery(delivery) != DeliveryReliable) {
			return out, limits, fmt.Errorf("channel %d has unknown delivery", i)
		}
		if seen[id] {
			return out, limits, fmt.Errorf("duplicate channel ID %d", id)
		}
		seen[id] = true
		out.Channels = append(out.Channels, channelJSON{ID: uint16(id), Delivery: delivery})
	}
	var err error
	if limits.MaxReliableMessageBytes, err = jsonNumberUint(obj["maxReliableMessageBytes"]); err != nil {
		return out, limits, fmt.Errorf("maxReliableMessageBytes is not a positive safe integer")
	}
	if limits.MaxQueuedReliableBytes, err = jsonNumberUint(obj["maxQueuedReliableBytes"]); err != nil {
		return out, limits, fmt.Errorf("maxQueuedReliableBytes is not a positive safe integer")
	}
	if limits.MaxQueuedDatagrams, err = jsonNumberUint(obj["maxQueuedDatagrams"]); err != nil {
		return out, limits, fmt.Errorf("maxQueuedDatagrams is not a positive safe integer")
	}
	if err := checkLimits(limits); err != nil {
		return out, limits, err
	}
	out.Limits = negotiatedLimits(limits)
	return out, limits, nil
}

// rejectDuplicateKeys reports a repeated key spelling inside the outermost
// JSON object. encoding/json keeps the last value silently, which would hide
// a conflicting duplicate instead of rejecting it.
func rejectDuplicateKeys(payload []byte) error {
	dec := json.NewDecoder(bytes.NewReader(payload))
	token, err := dec.Token()
	if err != nil {
		return fmt.Errorf("handshake is not valid JSON: %w", err)
	}
	if token != json.Delim('{') {
		return fmt.Errorf("handshake is not a JSON object")
	}
	seen := make(map[string]bool)
	for dec.More() {
		keyToken, err := dec.Token()
		if err != nil {
			return fmt.Errorf("handshake is not valid JSON: %w", err)
		}
		key, ok := keyToken.(string)
		if !ok {
			return fmt.Errorf("handshake key is not a string")
		}
		if seen[key] {
			return fmt.Errorf("handshake has duplicate key %q", key)
		}
		seen[key] = true
		var skip any
		if err := dec.Decode(&skip); err != nil {
			return fmt.Errorf("handshake is not valid JSON: %w", err)
		}
	}
	return nil
}

// jsonNumberUint accepts only JSON numbers that are positive safe integers:
// no strings, booleans, floats, or values outside 1..2^53-1.
func jsonNumberUint(value any) (uint64, error) {
	const maxSafeInteger = uint64(1<<53 - 1)
	number, ok := value.(json.Number)
	if !ok {
		return 0, fmt.Errorf("not a JSON number")
	}
	text := number.String()
	if text == "" {
		return 0, fmt.Errorf("not a JSON number")
	}
	for i := 0; i < len(text); i++ {
		if (text[i] < '0' || text[i] > '9') && !(i == 0 && text[i] == '+') {
			return 0, fmt.Errorf("not a positive integer")
		}
	}
	var result uint64
	for i := 0; i < len(text); i++ {
		if text[i] == '+' {
			continue
		}
		result = result*10 + uint64(text[i]-'0')
		if result > maxSafeInteger {
			return 0, fmt.Errorf("exceeds the safe integer range")
		}
	}
	if result < 1 {
		return 0, fmt.Errorf("not positive")
	}
	return result, nil
}

func printableASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < 0x20 || s[i] > 0x7e {
			return false
		}
	}
	return true
}

// validUTF8 reports whether payload is well-formed UTF-8, including rejection
// of overlong forms, surrogates and out-of-range code points. Go's range
// check accepts some non-minimal forms leniently, so decode by hand.
func validUTF8(payload []byte) bool {
	i := 0
	for i < len(payload) {
		c := payload[i]
		switch {
		case c < 0x80:
			i++
		case c>>5 == 0x06:
			if i+1 >= len(payload) || payload[i+1]>>6 != 0x02 || c < 0xc2 {
				return false
			}
			i += 2
		case c>>4 == 0x0e:
			if i+2 >= len(payload) || payload[i+1]>>6 != 0x02 || payload[i+2]>>6 != 0x02 {
				return false
			}
			if c == 0xe0 && payload[i+1] < 0xa0 {
				return false
			}
			if c == 0xed && payload[i+1] >= 0xa0 {
				return false
			}
			i += 3
		case c>>3 == 0x1e:
			if i+3 >= len(payload) || payload[i+1]>>6 != 0x02 ||
				payload[i+2]>>6 != 0x02 || payload[i+3]>>6 != 0x02 {
				return false
			}
			if c == 0xf0 && payload[i+1] < 0x90 {
				return false
			}
			if c == 0xf4 && payload[i+1] > 0x8f {
				return false
			}
			if c > 0xf4 {
				return false
			}
			i += 4
		default:
			return false
		}
	}
	return true
}

// Binder tracks per-channel BIND/BOUND pairing for one session. Both
// directions carry DATA for a channel only after its BOUND; duplicate
// bindings close the session.
type Binder struct {
	channels map[uint16]Delivery
	bound    map[uint16]bool
}

// NewBinder returns a binder for the exact negotiated channel map.
func NewBinder(channels []Channel) *Binder {
	m := make(map[uint16]Delivery, len(channels))
	for _, ch := range channels {
		m[ch.ID] = ch.Delivery
	}
	return &Binder{channels: m, bound: make(map[uint16]bool, len(channels))}
}

// Bind records the client's BIND for channel and reports whether it is the
// first. Unknown channels and duplicate bindings both fail.
func (b *Binder) Bind(channel uint16) error {
	if _, ok := b.channels[channel]; !ok {
		return fmt.Errorf("BIND on unknown channel %d", channel)
	}
	if b.bound[channel] {
		return fmt.Errorf("duplicate BIND on channel %d", channel)
	}
	b.bound[channel] = true
	return nil
}

// Complete reports whether every channel has bound.
func (b *Binder) Complete() bool { return len(b.bound) == len(b.channels) }

// CheckData reports whether DATA for channel may flow (bound, known channel).
func (b *Binder) CheckData(channel uint16) error {
	if _, ok := b.channels[channel]; !ok {
		return fmt.Errorf("DATA on unknown channel %d", channel)
	}
	if !b.bound[channel] {
		return fmt.Errorf("DATA on unbound channel %d", channel)
	}
	return nil
}

// Negotiate returns the per-direction limits both sides apply: the minimum of
// each client/server limit. A message limit above queue capacity is invalid.
func Negotiate(client, server Limits) (Limits, error) {
	out := Limits{
		MaxReliableMessageBytes: min(client.MaxReliableMessageBytes, server.MaxReliableMessageBytes),
		MaxQueuedReliableBytes:  min(client.MaxQueuedReliableBytes, server.MaxQueuedReliableBytes),
		MaxQueuedDatagrams:      min(client.MaxQueuedDatagrams, server.MaxQueuedDatagrams),
	}
	if out.MaxReliableMessageBytes > out.MaxQueuedReliableBytes {
		return Limits{}, fmt.Errorf("negotiated message limit %d exceeds queue capacity %d",
			out.MaxReliableMessageBytes, out.MaxQueuedReliableBytes)
	}
	return out, nil
}

// ServeGame runs the /game handshake over one WebTransport session: HELLO on
// the first client-created bidirectional stream, WELCOME in reply, then one
// BIND/BOUND per reliable channel in ascending ID order. Without a
// Validator the adapter stays fail-closed: it rejects with ErrUnavailable and
// allocates no game state. Task 4d injects the validator that enables the
// live path. Callers must not log the returned error's wrapped credential;
// errors never carry one.
func ServeGame(ctx context.Context, session *webtransport.Session, cfg Config) (*Ready, error) {
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	if cfg.Validator == nil {
		_ = session.CloseWithError(closeAuthentication, "game unavailable")
		return nil, ErrUnavailable
	}
	timeout := cfg.ConnectTimeout
	if timeout == 0 {
		timeout = 10 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	control, err := session.AcceptStream(ctx)
	if err != nil {
		return nil, fmt.Errorf("accepting the control stream: %w", err)
	}
	// No server-created application streams in v1: a second client stream
	// before the handshake finishes is malformed. Watch for it while HELLO
	// is in flight and fail the handshake if one arrives.
	extraStream := make(chan struct{}, 1)
	go func() {
		probe, err := session.AcceptStream(ctx)
		if err == nil && probe != nil {
			select {
			case extraStream <- struct{}{}:
			default:
			}
			probe.CancelRead(0)
			probe.CancelWrite(0)
		}
	}()
	// No unidirectional application streams in v1 either.
	go func() {
		uni, err := session.AcceptUniStream(ctx)
		if err == nil && uni != nil {
			select {
			case extraStream <- struct{}{}:
			default:
			}
			uni.CancelRead(0)
		}
	}()

	// HELLO is bounded by its own 4096-byte cap, not by the negotiated
	// message limit (negotiation has not happened yet when it arrives).
	hello, err := readControlFrame(ctx, control, maxHelloLen)
	select {
	case <-extraStream:
		_ = session.CloseWithError(closeMalformed, "unexpected stream during handshake")
		return nil, fmt.Errorf("unexpected stream during handshake")
	default:
	}
	if err != nil {
		_ = session.CloseWithError(closeMalformed, "malformed HELLO")
		return nil, fmt.Errorf("reading HELLO: %w", err)
	}
	if hello.Kind != kindHello || hello.Channel != 0 {
		_ = session.CloseWithError(closeMalformed, "first control frame is not HELLO")
		return nil, fmt.Errorf("first control frame is kind %d channel %d, want HELLO/0",
			hello.Kind, hello.Channel)
	}
	credential, clientLimits, err := parseHello(hello.Payload, cfg)
	if err != nil {
		_ = session.CloseWithError(closeAuthentication, "HELLO rejected")
		return nil, fmt.Errorf("%w: %v", ErrAuthentication, err)
	}
	if !cfg.Validator.ValidateCredential(credential) {
		_ = session.CloseWithError(closeAuthentication, "HELLO rejected")
		return nil, ErrAuthentication
	}
	welcomePayload, sessionID, limits, err := buildWelcome(cfg, clientLimits)
	if err != nil {
		_ = session.CloseWithError(closeMalformed, "cannot negotiate limits")
		return nil, err
	}
	if _, err := writeFull(ctx, control, EncodeFrame(kindWelcome, 0, welcomePayload)); err != nil {
		return nil, fmt.Errorf("writing WELCOME: %w", err)
	}

	binder := NewBinder(cfg.Channels)
	for _, ch := range slices.Sorted(maps.Keys(binder.channels)) {
		if binder.channels[ch] != DeliveryReliable {
			binder.bound[ch] = true // Unreliable channels need no stream.
			continue
		}
		bindStream, err := session.AcceptStream(ctx)
		if err != nil {
			return nil, fmt.Errorf("accepting the channel %d stream: %w", ch, err)
		}
		bind, err := readControlFrame(ctx, bindStream, limits.MaxReliableMessageBytes)
		if err != nil {
			_ = session.CloseWithError(closeMalformed, "malformed BIND")
			return nil, fmt.Errorf("reading BIND: %w", err)
		}
		if bind.Kind != kindBind || bind.Channel != ch || len(bind.Payload) != 0 {
			_ = session.CloseWithError(closeMalformed, "invalid BIND")
			return nil, fmt.Errorf("invalid BIND kind %d channel %d payload %d",
				bind.Kind, bind.Channel, len(bind.Payload))
		}
		if err := binder.Bind(ch); err != nil {
			_ = session.CloseWithError(closeMalformed, "duplicate BIND")
			return nil, err
		}
		if _, err := writeFull(ctx, bindStream, EncodeFrame(kindBound, ch, nil)); err != nil {
			return nil, fmt.Errorf("writing BOUND for channel %d: %w", ch, err)
		}
	}
	return &Ready{Session: session, Limits: limits, SessionID: sessionID, Channels: cfg.Channels}, nil
}

// readControlFrame reads exactly one frame from a control/binding stream: the
// 8-byte header may split arbitrarily, then the declared payload follows. A
// second frame on the same read is a protocol violation (duplicate HELLO or
// payload after BIND), as is any truncation at stream close.
func readControlFrame(ctx context.Context, stream *webtransport.Stream, maxPayload uint64) (Frame, error) {
	header := make([]byte, headerLen)
	if _, err := io.ReadFull(streamWithContext(ctx, stream), header); err != nil {
		return Frame{}, errTruncated
	}
	length := binary.BigEndian.Uint32(header[4:8])
	if uint64(length) > maxMessageBytesCeiling {
		return Frame{}, fmt.Errorf("declared %d bytes exceed the ceiling", length)
	}
	if maxPayload != 0 && uint64(length) > maxPayload {
		return Frame{}, fmt.Errorf("declared %d bytes exceed the message limit", length)
	}
	frameBytes := make([]byte, headerLen+int(length))
	copy(frameBytes, header)
	if _, err := io.ReadFull(streamWithContext(ctx, stream), frameBytes[headerLen:]); err != nil {
		return Frame{}, errTruncated
	}
	frame, rest, err := decodeOne(frameBytes, 0)
	if err != nil {
		return Frame{}, err
	}
	if len(rest) != 0 {
		return Frame{}, fmt.Errorf("control frame has trailing bytes")
	}
	return frame, nil
}

// streamWithContext binds stream reads to ctx cancellation (deadline or
// session close) so a silent peer cannot hold the handshake past the connect
// timeout.
func streamWithContext(ctx context.Context, stream *webtransport.Stream) io.Reader {
	return &cancelReader{ctx: ctx, stream: stream}
}

type cancelReader struct {
	ctx    context.Context
	stream *webtransport.Stream
}

func (r *cancelReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	type result struct {
		n   int
		err error
	}
	done := make(chan result, 1)
	go func() {
		n, err := r.stream.Read(p)
		done <- result{n: n, err: err}
	}()
	select {
	case <-r.ctx.Done():
		return 0, r.ctx.Err()
	case res := <-done:
		return res.n, res.err
	}
}

func writeFull(ctx context.Context, stream *webtransport.Stream, data []byte) (int, error) {
	total := 0
	for total < len(data) {
		select {
		case <-ctx.Done():
			return total, ctx.Err()
		default:
		}
		n, err := stream.Write(data[total:])
		total += n
		if err != nil {
			return total, err
		}
	}
	return total, nil
}
