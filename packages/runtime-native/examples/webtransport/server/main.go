// Command tn-network-server is the PRD-359 reference WebTransport server.
//
// /echo is transport conformance only: it returns every datagram,
// bidirectional stream and unidirectional stream exactly as it arrived, which
// is what the native runtime's quiche client and a real browser are measured
// against. /echo carries no authentication and no application protocol; /game
// is the authenticated application endpoint, gated by the loopback token
// issuer (POST /token on --admin-listen) and the --room it validates against.
//
// Two clients drive it:
//   - packages/runtime-native/tests/webtransport/webtransport.test.ts, which builds
//     this module to an explicit executable path and starts it with --dev-self-signed.
//   - ../client.html, a real browser page proving 64 KiB stream echo and datagrams.
//
// Nothing here prints a private key. The development certificate's SHA-256 digest is
// public information and is printed so a browser can pin it with serverCertificateHashes.
package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"slices"
	"strings"
	"syscall"
	"time"

	"github.com/quic-go/quic-go"
	"github.com/quic-go/quic-go/http3"
	"github.com/quic-go/webtransport-go"
)

const (
	// echoPath is transport conformance only. It never allocates game state.
	echoPath = "/echo"

	// gamePath is the authenticated application endpoint. It routes through
	// the protocol adapter; without a credential validator (task 4d) the
	// adapter stays fail-closed and rejects every handshake.
	gamePath = "/game"

	// SIGTERM stops acceptance, closes live sessions and exits inside this budget.
	shutdownTimeout = 5 * time.Second

	// The W3C serverCertificateHashes API refuses a certificate valid for two weeks or
	// more, so the development certificate is deliberately short-lived.
	devCertValidity = 13 * 24 * time.Hour
)

// errUsagePrinted marks a command line the flag package has already reported, so the
// operator sees one message and its usage block rather than the same text twice.
var errUsagePrinted = errors.New("invalid command line")

func main() {
	opts, err := parseOptions(os.Args[1:])
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			os.Exit(0)
		}
		if !errors.Is(err, errUsagePrinted) {
			fmt.Fprintf(os.Stderr, "tn-network-server: %v\n", err)
		}
		os.Exit(2)
	}
	if err := run(opts); err != nil {
		fmt.Fprintf(os.Stderr, "tn-network-server: %v\n", err)
		os.Exit(1)
	}
}

type options struct {
	listen        string
	certPath      string
	keyPath       string
	devSelfSigned bool
	allowOrigins  []string
	adminListen   string
	room          string
}

// originList collects a repeatable --allow-origin, normalizing each value as it is
// parsed so an unusable origin fails the command line rather than a later handshake.
type originList []string

func (o *originList) String() string { return strings.Join(*o, ",") }

func (o *originList) Set(value string) error {
	normalized, err := normalizeOrigin(value)
	if err != nil {
		return err
	}
	*o = append(*o, normalized)
	return nil
}

func parseOptions(args []string) (*options, error) {
	fs := flag.NewFlagSet("tn-network-server", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	var (
		opts    options
		origins originList
	)
	fs.StringVar(&opts.listen, "listen", "", "required; UDP WebTransport bind address as host:port")
	fs.StringVar(&opts.certPath, "cert", "", "PEM certificate chain; required for verified mode")
	fs.StringVar(&opts.keyPath, "key", "", "PEM private key; required for verified mode")
	fs.BoolVar(&opts.devSelfSigned, "dev-self-signed", false,
		"explicit alternative to --cert/--key, echo probes only")
	fs.Var(&origins, "allow-origin",
		"repeatable; exact normalized scheme/host/port a browser may connect from")
	fs.StringVar(&opts.adminListen, "admin-listen", "127.0.0.1:0",
		"loopback-only HTTP token issuer bind address as host:port")
	fs.StringVar(&opts.room, "room", "networking-proof", "served room /game validates tokens against")

	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil, flag.ErrHelp
		}
		return nil, errUsagePrinted
	}
	if fs.NArg() > 0 {
		return nil, fmt.Errorf("unexpected positional argument %q", fs.Arg(0))
	}
	opts.allowOrigins = origins
	if err := opts.validate(); err != nil {
		return nil, err
	}
	return &opts, nil
}

func (o *options) validate() error {
	if o.listen == "" {
		return errors.New("--listen is required, for example --listen 127.0.0.1:4433")
	}
	if _, err := net.ResolveUDPAddr("udp", o.listen); err != nil {
		return fmt.Errorf("--listen %q is not a resolvable host:port UDP address: %w", o.listen, err)
	}
	suppliedKeyPair := o.certPath != "" || o.keyPath != ""
	switch {
	case suppliedKeyPair && o.devSelfSigned:
		return errors.New("--dev-self-signed cannot be combined with --cert/--key")
	case o.certPath == "" && o.keyPath == "" && !o.devSelfSigned:
		return errors.New(
			"verified mode requires --cert and --key; pass --dev-self-signed for echo probes instead")
	case suppliedKeyPair && (o.certPath == "" || o.keyPath == ""):
		return errors.New("--cert and --key must be supplied together")
	}
	if o.adminListen == "" {
		return errors.New("--admin-listen must name a loopback host:port, for example 127.0.0.1:0")
	}
	if !isLoopbackListen(o.adminListen) {
		return fmt.Errorf("--admin-listen %q must bind loopback only", o.adminListen)
	}
	if o.room == "" || len(o.room) > 64 {
		return errors.New("--room must be 1-64 characters")
	}
	return nil
}

// tlsConfig loads the operator's certificate, or mints the development one and prints
// only its digest so a browser page can pin it.
func (o *options) tlsConfig(stdout io.Writer) (*tls.Config, error) {
	if !o.devSelfSigned {
		certificate, err := tls.LoadX509KeyPair(o.certPath, o.keyPath)
		if err != nil {
			return nil, fmt.Errorf("loading --cert %q with --key %q: %w", o.certPath, o.keyPath, err)
		}
		return &tls.Config{Certificates: []tls.Certificate{certificate}}, nil
	}
	certificate, der, err := generateDevCertificate()
	if err != nil {
		return nil, fmt.Errorf("generating the --dev-self-signed certificate: %w", err)
	}
	digest := sha256.Sum256(der)
	fmt.Fprintf(stdout, "CERT_SHA256 %s\n", base64.RawStdEncoding.EncodeToString(digest[:]))
	return &tls.Config{Certificates: []tls.Certificate{certificate}}, nil
}

func generateDevCertificate() (tls.Certificate, []byte, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	now := time.Now().UTC()
	template := x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "localhost"},
		NotBefore:             now.Add(-time.Hour),
		NotAfter:              now.Add(devCertValidity),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              []string{"localhost"},
		IPAddresses:           []net.IP{net.IPv4(127, 0, 0, 1), net.IPv6loopback},
	}
	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}, der, nil
}

func run(opts *options) error {
	tlsConf, err := opts.tlsConfig(os.Stdout)
	if err != nil {
		return err
	}

	// Bind the socket here rather than through ListenAndServe so the resolved address —
	// including the port the kernel chose for :0 — is the one actually announced.
	udpAddr, err := net.ResolveUDPAddr("udp", opts.listen)
	if err != nil {
		return fmt.Errorf("resolving --listen %q: %w", opts.listen, err)
	}
	packetConn, err := net.ListenUDP("udp", udpAddr)
	if err != nil {
		return fmt.Errorf("binding UDP %s: %w", opts.listen, err)
	}
	defer packetConn.Close()

	h3 := &http3.Server{
		Addr:      opts.listen,
		TLSConfig: http3.ConfigureTLSConfig(tlsConf),
		QUICConfig: &quic.Config{
			EnableDatagrams:                  true,
			EnableStreamResetPartialDelivery: true,
			// The reference game must remove an abruptly dead player promptly enough for
			// the live peer-loss proof to observe the simulation membership change.
			MaxIdleTimeout: 5 * time.Second,
			// Keep an otherwise idle surviving subject transport alive during that proof;
			// a killed peer stops acknowledging these packets and still reaches the idle timeout.
			KeepAlivePeriod: 2 * time.Second,
		},
	}
	webtransport.ConfigureHTTP3Server(h3)
	mux := http.NewServeMux()
	h3.Handler = mux
	server := &webtransport.Server{H3: h3, CheckOrigin: originChecker(opts.allowOrigins)}

	mux.HandleFunc(echoPath, func(w http.ResponseWriter, r *http.Request) {
		session, err := server.Upgrade(w, r)
		if err != nil {
			log.Printf("echo: upgrade rejected: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		// Upgrade keeps the session alive past this handler, so echoing runs beside it.
		go serveEcho(session)
	})

	// The token store backs both the loopback admin issuer and /game HELLO
	// validation. /game compares the token's bound room to --room before
	// atomic one-time consumption, and allocates no game state before that.
	store := newTokenStore(time.Now)
	adminListener, err := net.Listen("tcp", opts.adminListen)
	if err != nil {
		return fmt.Errorf("binding admin %s: %w", opts.adminListen, err)
	}
	// Refuse a non-loopback resolved address even if the listen string
	// passed validation textually: the issuer must stay loopback-only.
	if addr, ok := adminListener.Addr().(*net.TCPAddr); !ok || !addr.IP.IsLoopback() {
		adminListener.Close()
		return fmt.Errorf("admin listener %s is not loopback-only", adminListener.Addr())
	}
	adminMux := http.NewServeMux()
	adminMux.HandleFunc("/token", store.serveToken)
	adminServer := &http.Server{
		Handler:           adminMux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		if err := adminServer.Serve(adminListener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("admin: serving failed: %v", err)
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	simulation := NewGameSimulation(time.Now())
	go simulation.Run(ctx)

	gameConfig := Config{
		ApplicationProtocol: "threenative-smoke/1",
		Channels: []Channel{
			{ID: channelInput, Delivery: DeliveryUnreliable},
			{ID: channelState, Delivery: DeliveryUnreliable},
			{ID: channelActions, Delivery: DeliveryReliable},
			{ID: channelClock, Delivery: DeliveryReliable},
		},
		Limits:    defaultLimits(),
		Validator: store.validator(opts.room),
	}
	mux.HandleFunc(gamePath, func(w http.ResponseWriter, r *http.Request) {
		session, err := server.Upgrade(w, r)
		if err != nil {
			log.Printf("game: upgrade rejected: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		// Upgrade keeps the session alive past this handler, so the
		// handshake runs beside it.
		go func() {
			ready, err := ServeGame(session.Context(), session, gameConfig)
			if err != nil {
				log.Printf("game: handshake rejected: %v", err)
				return
			}
			log.Printf("game: player connected player=%s session=%s", ready.PlayerID, ready.SessionID)
			if err := ServeReferenceGame(session.Context(), ready, simulation); err != nil &&
				session.Context().Err() == nil && !errors.Is(err, context.Canceled) {
				log.Printf("game: player session ended player=%s session=%s: %v", ready.PlayerID, ready.SessionID, err)
			}
		}()
	})

	served := make(chan error, 1)
	go func() { served <- server.Serve(packetConn) }()
	fmt.Printf("LISTENING udp=%s admin=%s room=%s path=%s,%s\n",
		packetConn.LocalAddr(), adminListener.Addr(), opts.room, echoPath, gamePath)

	select {
	case err := <-served:
		if err == nil {
			return nil
		}
		return fmt.Errorf("serving %s: %w", packetConn.LocalAddr(), err)
	case <-ctx.Done():
	}

	closed := make(chan error, 1)
	go func() { closed <- server.Close() }()
	adminClosed := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		adminClosed <- adminServer.Shutdown(ctx)
	}()
	timer := time.NewTimer(shutdownTimeout)
	defer timer.Stop()
	var serveErr error
	select {
	case err := <-closed:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr = fmt.Errorf("shutting down: %w", err)
		}
	case <-timer.C:
		return fmt.Errorf("shutdown exceeded %s", shutdownTimeout)
	}
	select {
	case err := <-adminClosed:
		if serveErr != nil {
			return serveErr
		}
		if err != nil {
			return fmt.Errorf("shutting down admin: %w", err)
		}
		return nil
	case <-timer.C:
		return fmt.Errorf("shutdown exceeded %s", shutdownTimeout)
	}
}

// originChecker keeps webtransport-go's safe default and layers --allow-origin on top.
// A request with no Origin header is a non-browser client, whose identity this header
// never established either way. An Origin equal to the request's own authority is
// same-origin, which is what the native runtime sends and is never cross-site request
// forgery. Anything else is a browser reaching across origins and must be listed
// exactly, so an unconfigured server is reachable by the native runtime and by no
// third-party page.
func originChecker(allowed []string) func(*http.Request) bool {
	return func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}
		normalized, err := normalizeOrigin(origin)
		if err != nil {
			return false
		}
		// WebTransport is https-only, so the request's own origin is its authority.
		if own, err := normalizeOrigin("https://" + r.Host); err == nil && own == normalized {
			return true
		}
		return slices.Contains(allowed, normalized)
	}
}

// normalizeOrigin reduces an origin to lowercase scheme, host and explicit port so the
// allowlist comparison is exact rather than textual.
func normalizeOrigin(raw string) (string, error) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("origin %q is not a URL: %w", raw, err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("origin %q needs a scheme and a host, for example https://example.test", raw)
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" ||
		(parsed.Path != "" && parsed.Path != "/") {
		return "", fmt.Errorf("origin %q must carry no userinfo, path, query or fragment", raw)
	}
	scheme := strings.ToLower(parsed.Scheme)
	port := parsed.Port()
	if port == "" {
		switch scheme {
		case "https":
			port = "443"
		case "http":
			port = "80"
		default:
			return "", fmt.Errorf("origin %q needs an explicit port for scheme %q", raw, scheme)
		}
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "" {
		return "", fmt.Errorf("origin %q needs a host", raw)
	}
	return scheme + "://" + net.JoinHostPort(host, port), nil
}

func serveEcho(session *webtransport.Session) {
	ctx := session.Context()
	go echoDatagrams(ctx, session)
	go echoUniStreams(ctx, session)
	echoBidiStreams(ctx, session)
}

func echoDatagrams(ctx context.Context, session *webtransport.Session) {
	for {
		payload, err := session.ReceiveDatagram(ctx)
		if err != nil {
			return
		}
		if err := session.SendDatagram(payload); err != nil {
			log.Printf("echo: sending a %d byte datagram back failed: %v", len(payload), err)
		}
	}
}

func echoBidiStreams(ctx context.Context, session *webtransport.Session) {
	for {
		stream, err := session.AcceptStream(ctx)
		if err != nil {
			return
		}
		go func() {
			// Copying in chunks keeps a 64 KiB transfer moving while the peer is still
			// writing, instead of buffering the whole message before answering.
			if _, err := io.Copy(stream, stream); err != nil {
				log.Printf("echo: bidirectional copy failed: %v", err)
			}
			if err := stream.Close(); err != nil {
				log.Printf("echo: closing the bidirectional stream failed: %v", err)
			}
		}()
	}
}

func echoUniStreams(ctx context.Context, session *webtransport.Session) {
	for {
		incoming, err := session.AcceptUniStream(ctx)
		if err != nil {
			return
		}
		go func() {
			outgoing, err := session.OpenUniStreamSync(ctx)
			if err != nil {
				log.Printf("echo: opening the return unidirectional stream failed: %v", err)
				return
			}
			if _, err := io.Copy(outgoing, incoming); err != nil {
				log.Printf("echo: unidirectional copy failed: %v", err)
			}
			if err := outgoing.Close(); err != nil {
				log.Printf("echo: closing the return unidirectional stream failed: %v", err)
			}
		}()
	}
}
