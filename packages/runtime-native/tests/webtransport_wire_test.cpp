// Wire contract for the WebTransport client implementation's internal protocol
// helpers: RFC 9000 §16 varints, the stream-header state machine, URL parsing,
// and the environment flag reader. The helpers live in an anonymous namespace
// inside webtransport.cpp, so this test includes the translation unit
// textually — the assertions then attribute coverage to the real source lines
// and cannot drift to a copy. It links quiche (the included TU requires it)
// and must NOT link mystral-runtime, which already defines the same TU.

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX  // This test imports quiche before the implementation TU.
#endif
#endif

#include <quiche.h>

// Rename only the two quiche DATAGRAM calls in this test translation unit. The
// production source still calls the real API; these seams let the regression
// provide a deterministic receive backlog and a deterministic hard send error.
using RealDgramRecv = decltype(&quiche_conn_dgram_recv);
using RealDgramSend = decltype(&quiche_conn_dgram_send);
using RealStreamSend = decltype(&quiche_conn_stream_send);
using RealIsClosed = decltype(&quiche_conn_is_closed);
using RealStreamShutdown = decltype(&quiche_conn_stream_shutdown);
using RealStreamRecv = decltype(&quiche_conn_stream_recv);
using RealReadable = decltype(&quiche_conn_readable);
using RealIterNext = decltype(&quiche_stream_iter_next);
using RealIterFree = decltype(&quiche_stream_iter_free);
RealDgramRecv g_realDgramRecv = &quiche_conn_dgram_recv;
RealDgramSend g_realDgramSend = &quiche_conn_dgram_send;
RealStreamSend g_realStreamSend = &quiche_conn_stream_send;
RealIsClosed g_realIsClosed = &quiche_conn_is_closed;
RealStreamShutdown g_realStreamShutdown = &quiche_conn_stream_shutdown;
RealStreamRecv g_realStreamRecv = &quiche_conn_stream_recv;
RealReadable g_realReadable = &quiche_conn_readable;
RealIterNext g_realIterNext = &quiche_stream_iter_next;
RealIterFree g_realIterFree = &quiche_stream_iter_free;
ssize_t testQuicheConnDgramRecv(quiche_conn*, uint8_t*, size_t);
ssize_t testQuicheConnDgramSend(quiche_conn*, const uint8_t*, size_t);
ssize_t testQuicheConnStreamSend(quiche_conn*, uint64_t, const uint8_t*, size_t, bool, uint64_t*);
bool testQuicheConnIsClosed(const quiche_conn*);
int testQuicheConnStreamShutdown(quiche_conn*, uint64_t, enum quiche_shutdown, uint64_t);
ssize_t testQuicheConnStreamRecv(quiche_conn*, uint64_t, uint8_t*, size_t, bool*, uint64_t*);
quiche_stream_iter* testQuicheConnReadable(const quiche_conn*);
bool testQuicheStreamIterNext(quiche_stream_iter*, uint64_t*);
void testQuicheStreamIterFree(quiche_stream_iter*);
#define quiche_conn_is_closed testQuicheConnIsClosed
#define quiche_conn_stream_shutdown testQuicheConnStreamShutdown
#define quiche_conn_stream_recv testQuicheConnStreamRecv
#define quiche_conn_readable testQuicheConnReadable
#define quiche_stream_iter_next testQuicheStreamIterNext
#define quiche_stream_iter_free testQuicheStreamIterFree
#define quiche_conn_dgram_recv testQuicheConnDgramRecv
#define quiche_conn_dgram_send testQuicheConnDgramSend
#define quiche_conn_stream_send testQuicheConnStreamSend
#include "../src/webtransport/webtransport.cpp"
#undef quiche_conn_dgram_recv
#undef quiche_conn_dgram_send
#undef quiche_conn_stream_send
#undef quiche_conn_is_closed
#undef quiche_conn_stream_shutdown
#undef quiche_conn_stream_recv
#undef quiche_conn_readable
#undef quiche_stream_iter_next
#undef quiche_stream_iter_free

// The impl's helpers are members of mystral::webtransport (the anonymous
// namespace nests inside it), and ::shutdown from <sys/socket.h> shares the
// name of the lifecycle call — the using-directive plus the arity-0 call site
// resolves every helper to the webtransport one.
using namespace mystral::webtransport;

#include <cstdint>
#include <cstdio>
#include <deque>
#include <filesystem>
#include <cstring>
#include <string>
#include <vector>

namespace {

int g_failures = 0;

void check(bool condition, const char* what) {
    if (!condition) {
        std::fprintf(stderr, "FAIL: %s\n", what);
        g_failures += 1;
    }
}

std::vector<uint8_t> encodeVarint(uint64_t v) {
    std::vector<uint8_t> out;
    varintEncode(out, v);
    return out;
}

quiche_conn* g_receiveSeamConn = nullptr;
std::deque<std::vector<uint8_t>> g_receiveSeamQueue;
quiche_conn* g_sendSeamConn = nullptr;
ssize_t g_sendSeamResult = QUICHE_ERR_DONE;
size_t g_sendSeamCalls = 0;

struct StreamSendCall {
    uint64_t streamId = 0;
    std::vector<uint8_t> offered;
    bool fin = false;
    ssize_t result = QUICHE_ERR_DONE;
};

quiche_conn* g_streamSendSeamConn = nullptr;
std::deque<ssize_t> g_streamSendResults;
std::vector<StreamSendCall> g_streamSendCalls;
std::vector<uint8_t> g_streamAcceptedBytes;
uint64_t g_streamSendErrorCode = 0;
struct StreamReceiveStep {
    std::vector<uint8_t> bytes;
    bool fin = false;
    ssize_t status = 0;
};
quiche_conn* g_streamReceiveConn = nullptr;
quiche_conn* g_forceNotClosedConn = nullptr;
std::map<uint64_t, std::deque<StreamReceiveStep>> g_streamReceiveQueues;
size_t g_streamReceivedBytes = 0;
std::vector<std::pair<uint64_t, enum quiche_shutdown>> g_streamShutdownCalls;
std::set<uint64_t> g_readShutdownIds;
std::set<uint64_t> g_writeShutdownIds;
struct TestReadableIterator { std::vector<uint64_t> ids; size_t cursor = 0; };
std::set<quiche_stream_iter*> g_testReadableIterators;

std::vector<uint8_t> framedDatagram(uint16_t sequence) {
    std::vector<uint8_t> packet = encodeVarint(0);
    packet.push_back(static_cast<uint8_t>(sequence & 0xff));
    packet.push_back(static_cast<uint8_t>(sequence >> 8));
    return packet;
}

void clearEvents() {
    while (!g_events.empty()) g_events.pop();
}

size_t countDatagramEvents(std::vector<std::vector<uint8_t>>* payloads) {
    size_t count = 0;
    while (!g_events.empty()) {
        Event event = std::move(g_events.front());
        g_events.pop();
        if (event.type != EventType::Datagram) continue;
        count += 1;
        if (payloads != nullptr) payloads->push_back(std::move(event.data));
    }
    return count;
}

void queueFramedDatagrams(uint16_t first, uint16_t count) {
    for (uint16_t i = 0; i < count; i += 1) {
        g_receiveSeamQueue.push_back(framedDatagram(static_cast<uint16_t>(first + i)));
    }
}

void checkDatagramSequence(const std::vector<std::vector<uint8_t>>& payloads, uint16_t first,
                           const char* what) {
    if (payloads.size() != 0) {
        check(payloads.size() <= 300, what);
    }
    for (size_t i = 0; i < payloads.size(); i += 1) {
        const uint16_t expected = static_cast<uint16_t>(first + i);
        const bool matches = payloads[i].size() == 2 && payloads[i][0] == (expected & 0xff) &&
                             payloads[i][1] == (expected >> 8);
        if (!matches) {
            check(false, what);
            return;
        }
    }
}

// A failed decode must return 0 without touching the output, so every decode
// starts from a sentinel instead of a zeroed value.
uint64_t sentinel = 0xdeadbeefdeadbeefull;

size_t decode(const std::vector<uint8_t>& bytes, uint64_t* out) {
    return varintDecode(bytes.data(), bytes.size(), out);
}

void checkRoundTrip(uint64_t v, size_t expectedLength) {
    const std::vector<uint8_t> bytes = encodeVarint(v);
    if (bytes.size() != expectedLength) {
        std::fprintf(stderr, "FAIL: varintEncode(%llu) length %zu != %zu\n",
                     static_cast<unsigned long long>(v), bytes.size(), expectedLength);
        g_failures += 1;
        return;
    }
    uint64_t out = sentinel;
    const size_t consumed = decode(bytes, &out);
    if (consumed != expectedLength || out != v) {
        std::fprintf(stderr, "FAIL: varint round-trip(%llu) consumed %zu out %llu\n",
                     static_cast<unsigned long long>(v), consumed,
                     static_cast<unsigned long long>(out));
        g_failures += 1;
    }
}

StreamState makeStream(bool isUni, std::vector<uint8_t> pending) {
    StreamState st;
    st.isUni = isUni;
    st.pending = std::move(pending);
    return st;
}

}  // namespace

ssize_t testQuicheConnDgramRecv(quiche_conn* conn, uint8_t* out, size_t cap) {
    if (conn == g_receiveSeamConn && !g_receiveSeamQueue.empty()) {
        std::vector<uint8_t> packet = std::move(g_receiveSeamQueue.front());
        g_receiveSeamQueue.pop_front();
        if (packet.size() > cap) return QUICHE_ERR_BUFFER_TOO_SHORT;
        std::memcpy(out, packet.data(), packet.size());
        return static_cast<ssize_t>(packet.size());
    }
    return g_realDgramRecv(conn, out, cap);
}

ssize_t testQuicheConnDgramSend(quiche_conn* conn, const uint8_t* data, size_t len) {
    if (conn == g_sendSeamConn) {
        g_sendSeamCalls += 1;
        return g_sendSeamResult;
    }
    return g_realDgramSend(conn, data, len);
}

ssize_t testQuicheConnStreamSend(quiche_conn* conn, uint64_t streamId, const uint8_t* data,
                                 size_t len, bool fin, uint64_t* errorCode) {
    if (conn == g_streamReceiveConn && g_writeShutdownIds.count(streamId)) {
        if (errorCode) *errorCode = 0x78;
        return QUICHE_ERR_STREAM_STOPPED;
    }
    if (conn != g_streamSendSeamConn) {
        return g_realStreamSend(conn, streamId, data, len, fin, errorCode);
    }

    const ssize_t result = g_streamSendResults.empty() ? QUICHE_ERR_DONE :
        [&]() {
            const ssize_t next = g_streamSendResults.front();
            g_streamSendResults.pop_front();
            return next;
        }();
    StreamSendCall call;
    call.streamId = streamId;
    call.fin = fin;
    call.result = result;
    if (data != nullptr && len > 0) call.offered.assign(data, data + len);
    g_streamSendCalls.push_back(std::move(call));
    if (result < 0) {
        if (errorCode != nullptr) *errorCode = g_streamSendErrorCode;
        return result;
    }
    const size_t accepted = static_cast<size_t>(result) < len ? static_cast<size_t>(result) : len;
    if (accepted > 0) g_streamAcceptedBytes.insert(g_streamAcceptedBytes.end(), data, data + accepted);
    return result;
}

void configureStreamSendSeam(quiche_conn* conn, std::deque<ssize_t> results,
                             uint64_t errorCode = 0) {
    g_streamSendSeamConn = conn;
    g_streamSendResults = std::move(results);
    g_streamSendCalls.clear();
    g_streamAcceptedBytes.clear();
    g_streamSendErrorCode = errorCode;
}

bool testQuicheConnIsClosed(const quiche_conn* conn) {
    return conn == g_forceNotClosedConn ? false : g_realIsClosed(conn);
}

int testQuicheConnStreamShutdown(quiche_conn* conn, uint64_t id, enum quiche_shutdown direction,
                                  uint64_t code) {
    if (conn != g_streamReceiveConn) return g_realStreamShutdown(conn, id, direction, code);
    g_streamShutdownCalls.emplace_back(id, direction);
    if (direction == QUICHE_SHUTDOWN_READ) g_readShutdownIds.insert(id);
    if (direction == QUICHE_SHUTDOWN_WRITE) g_writeShutdownIds.insert(id);
    return 0;
}

ssize_t testQuicheConnStreamRecv(quiche_conn* conn, uint64_t id, uint8_t* out,
                                 size_t capacity, bool* fin, uint64_t* errorCode) {
    if (conn != g_streamReceiveConn) return g_realStreamRecv(conn, id, out, capacity, fin, errorCode);
    *fin = false;
    *errorCode = 0;
    if (g_readShutdownIds.count(id)) return QUICHE_ERR_INVALID_STREAM_STATE;
    auto& queue = g_streamReceiveQueues[id];
    if (queue.empty()) return QUICHE_ERR_DONE;
    auto& next = queue.front();
    if (next.status < 0) {
        const ssize_t status = next.status;
        queue.pop_front();
        return status;
    }
    const size_t count = std::min(capacity, next.bytes.size());
    if (count == 0 && !next.bytes.empty()) return QUICHE_ERR_DONE;
    if (count > 0) std::memcpy(out, next.bytes.data(), count);
    next.bytes.erase(next.bytes.begin(), next.bytes.begin() + count);
    g_streamReceivedBytes += count;
    if (next.bytes.empty()) { *fin = next.fin; queue.pop_front(); }
    return static_cast<ssize_t>(count);
}

quiche_stream_iter* testQuicheConnReadable(const quiche_conn* conn) {
    if (conn != g_streamReceiveConn) return g_realReadable(conn);
    auto* iterator = new TestReadableIterator;
    for (const auto& [id, queue] : g_streamReceiveQueues) {
        if (!queue.empty()) iterator->ids.push_back(id);
    }
    auto* opaque = reinterpret_cast<quiche_stream_iter*>(iterator);
    g_testReadableIterators.insert(opaque);
    return opaque;
}

bool testQuicheStreamIterNext(quiche_stream_iter* opaque, uint64_t* id) {
    if (!g_testReadableIterators.count(opaque)) return g_realIterNext(opaque, id);
    auto* iterator = reinterpret_cast<TestReadableIterator*>(opaque);
    if (iterator->cursor == iterator->ids.size()) return false;
    *id = iterator->ids[iterator->cursor++];
    return true;
}

void testQuicheStreamIterFree(quiche_stream_iter* opaque) {
    if (!g_testReadableIterators.erase(opaque)) { g_realIterFree(opaque); return; }
    delete reinterpret_cast<TestReadableIterator*>(opaque);
}

int main() {
    // --- varint round-trips: one value per RFC 9000 §16 length class plus the
    // class boundaries, canonical encoding (1, 2, 4 or 8 bytes).
    checkRoundTrip(0, 1);
    checkRoundTrip(63, 1);
    checkRoundTrip(64, 2);
    checkRoundTrip(16383, 2);
    checkRoundTrip(16384, 4);
    checkRoundTrip(0x3FFFFFFFull, 4);
    checkRoundTrip(0x40000000ull, 8);
    checkRoundTrip(0x3FFFFFFFFFFFFFFFull, 8);

    // Canonical byte shapes (RFC 9000 §16 examples).
    check(encodeVarint(63) == std::vector<uint8_t>{0x3f}, "varintEncode(63) bytes");
    check(encodeVarint(15293) == std::vector<uint8_t>{0x7b, 0xbd}, "varintEncode(15293) bytes");

    // Truncated input: refuse, return 0, leave the output sentinel untouched.
    {
        const std::vector<uint8_t> twoByte = encodeVarint(16383);
        const std::vector<uint8_t> fourByte = encodeVarint(0x3FFFFFFFull);
        const std::vector<uint8_t> eightByte = encodeVarint(0x3FFFFFFFFFFFFFFFull);
        const std::vector<std::vector<uint8_t>> truncated = {
            {}, {twoByte[0]}, {fourByte[0], fourByte[1], fourByte[2]}, {eightByte[0]}};
        for (const auto& buf : truncated) {
            uint64_t out = sentinel;
            check(decode(buf, &out) == 0 && out == sentinel,
                  "truncated varint refused without consuming output");
        }
    }

    // --- environment flag: only the exact string "1" is truthy, everything
    // else (including "true" and "on") is off.
    check(isTruthyEnvironmentValue("1"), "env value \"1\" truthy");
    check(!isTruthyEnvironmentValue(nullptr), "unset env value falsy");
    check(!isTruthyEnvironmentValue(""), "empty env value falsy");
    check(!isTruthyEnvironmentValue("0"), "env value \"0\" falsy");
    check(!isTruthyEnvironmentValue("true"), "env value \"true\" falsy");
    check(!isTruthyEnvironmentValue("on"), "env value \"on\" falsy");

    // --- explicit process-local trust input. A supplied file that cannot be used
    // is refused; nothing supplied leaves quiche's own verify paths alone. This
    // block deliberately carries no certificate and no key: the positive load is
    // proven live against the real fixture server in
    // tests/webtransport/webtransport.test.ts.
    {
        quiche_config* trustConfig = quiche_config_new(QUICHE_PROTOCOL_VERSION);
        check(trustConfig != nullptr, "trust-input config allocated");
        std::string trustError;

        check(applyPeerTrust(trustConfig, nullptr, &trustError) && trustError.empty(),
              "unset trust file keeps quiche default verify paths");

        trustError.clear();
        check(!applyPeerTrust(trustConfig, "", &trustError),
              "empty trust file value refused");
        check(trustError.find("SSL_CERT_FILE") != std::string::npos,
              "empty trust file diagnostic names the variable");

        trustError.clear();
        const char* missingTrust = "/nonexistent/threenative-trust-absent.pem";
        check(!applyPeerTrust(trustConfig, missingTrust, &trustError),
              "unreadable trust file refused");
        check(trustError.find(missingTrust) != std::string::npos,
              "unreadable trust file diagnostic names the path");

        if (std::filesystem::exists("/etc/ssl/certs/ca-certificates.crt")) {
            trustError.clear();
            check(applyPeerTrust(trustConfig, "/etc/ssl/certs/ca-certificates.crt", &trustError),
                  "valid system trust bundle loaded");
        }

        trustError.clear();
        const char* malformedTrust = "webtransport-trust-malformed.pem";
        std::FILE* malformed = std::fopen(malformedTrust, "wb");
        check(malformed != nullptr, "malformed trust fixture written");
        if (malformed) {
            std::fputs("not a certificate\n", malformed);
            std::fclose(malformed);
            check(!applyPeerTrust(trustConfig, malformedTrust, &trustError),
                  "malformed trust file refused");
            std::remove(malformedTrust);
        }

        quiche_config_free(trustConfig);
    }

    // --- stream-header state machine. The header must name its owning
    // CONNECT session. The signal
    // constants are 2-byte varints on the wire, so fixtures are built with
    // varintEncode rather than raw first bytes.
    {
        Session headerSession;
        headerSession.connectStreamId = 7;
        // Client-initiated bidirectional WT stream: signal + session id 7.
        std::vector<uint8_t> bidi = encodeVarint(WT_STREAM_BIDI_SIGNAL);
        bidi.push_back(0x07);
        bidi.push_back('x');
        StreamState st = makeStream(false, bidi);
        check(consumeStreamHeader(&headerSession, 99, st), "bidi WT header consumed");
        check(st.headerConsumed && !st.isH3Owned && st.pending == std::vector<uint8_t>{'x'},
              "bidi WT header stripped, payload preserved");

        // Server-initiated unidirectional WT stream: signal + session id.
        std::vector<uint8_t> uni = encodeVarint(WT_STREAM_UNI_SIGNAL);
        uni.push_back(0x07);
        uni.push_back('h');
        uni.push_back('i');
        StreamState uniSt = makeStream(true, uni);
        check(consumeStreamHeader(&headerSession, 99, uniSt), "uni WT header consumed");
        check(uniSt.headerConsumed && !uniSt.isH3Owned &&
                  uniSt.pending == std::vector<uint8_t>{'h', 'i'},
              "uni WT header stripped, payload preserved");

        // HTTP/3-owned unidirectional streams are drained and ignored.
        for (uint64_t type : {H3_CONTROL_STREAM_TYPE, H3_PUSH_STREAM_TYPE,
                              H3_QPACK_ENCODER_STREAM_TYPE, H3_QPACK_DECODER_STREAM_TYPE}) {
            StreamState h3 = makeStream(true, {static_cast<uint8_t>(type), 0xaa, 0xbb});
            check(consumeStreamHeader(&headerSession, 99, h3), "h3-owned stream consumed");
            check(h3.isH3Owned && h3.headerConsumed && h3.pending.empty(),
                  "h3-owned stream drained");
        }

        // Unknown unidirectional stream type — ignored, not treated as WT.
        StreamState unknownUni = makeStream(true, {0x09, 0xaa});
        check(consumeStreamHeader(&headerSession, 99, unknownUni), "unknown uni stream consumed");
        check(unknownUni.isH3Owned && unknownUni.headerConsumed && unknownUni.pending.empty(),
              "unknown uni stream drained");

        // Bidirectional stream without the WT signal — ignored.
        StreamState foreignBidi = makeStream(false, {0x00, 0xaa});
        check(consumeStreamHeader(&headerSession, 99, foreignBidi), "non-WT bidi stream consumed");
        check(foreignBidi.isH3Owned && foreignBidi.headerConsumed, "non-WT bidi stream drained");

        // Truncated signal varint: need more bytes, nothing consumed.
        StreamState shortSignal = makeStream(true, {0x80, 0x00});  // declares 4 bytes, has 2
        check(!consumeStreamHeader(&headerSession, 99, shortSignal), "truncated signal refused");
        check(!shortSignal.headerConsumed && shortSignal.pending.size() == 2,
              "truncated signal left pending untouched");

        // Signal present but session id truncated: need more bytes.
        std::vector<uint8_t> shortSessionBytes = encodeVarint(WT_STREAM_UNI_SIGNAL);
        shortSessionBytes.push_back(0x40);  // session id varint declares 2, none follow
        StreamState shortSession = makeStream(true, shortSessionBytes);
        check(!consumeStreamHeader(&headerSession, 99, shortSession), "truncated session id refused");
        check(!shortSession.headerConsumed && shortSession.pending.size() == shortSessionBytes.size(),
              "truncated session id left pending untouched");

        // Idempotent: an already-consumed stream is a no-op even with no bytes.
        StreamState consumed = makeStream(false, {});
        consumed.headerConsumed = true;
        check(consumeStreamHeader(&headerSession, 99, consumed), "already-consumed stream is a no-op");
    }

    // A stream belonging to another CONNECT session must never be admitted as
    // this session's payload, even when its WT signal and varints are valid.
    {
        Session session;
        session.connectStreamId = 8;
        for (bool isUni : {false, true}) {
            std::vector<uint8_t> header = encodeVarint(
                isUni ? WT_STREAM_UNI_SIGNAL : WT_STREAM_BIDI_SIGNAL);
            varintEncode(header, 12);
            header.push_back(0x5a);
            StreamState foreign = makeStream(isUni, header);
            const bool accepted = consumeStreamHeader(&session, isUni ? 3 : 1, foreign);
            check(!accepted && !foreign.headerConsumed && session.failed,
                  "a wrong-session WT header is refused before payload admission");
        }
    }

    clearEvents();

    // --- URL parsing: https only, explicit bounded port, non-empty host.
    {
        std::string host;
        int port = 0;
        std::string path;
        check(parseUrl("https://example.com:4433/", host, port, path) && host == "example.com" &&
                  port == 4433 && path == "/",
              "plain https URL parses");
        check(parseUrl("https://example.com:4433/x/y", host, port, path) && path == "/x/y",
              "URL path preserved");
        check(parseUrl("https://example.com:4433", host, port, path) && path == "/",
              "missing slash defaults path to /");
        check(!parseUrl("", host, port, path), "empty URL refused");
        check(!parseUrl("not-a-url", host, port, path), "garbage URL refused");
        check(!parseUrl("http://example.com:4433/", host, port, path), "http scheme refused");
        check(!parseUrl("HTTPS://example.com:4433/", host, port, path), "scheme is case-sensitive");
        check(!parseUrl("https://example.com/", host, port, path), "missing port refused");
        check(!parseUrl("https://:4433/", host, port, path), "empty host refused");
        check(!parseUrl("https://example.com:0/", host, port, path), "port 0 refused");
        check(!parseUrl("https://example.com:65536/", host, port, path), "port 65536 refused");
    }

    // --- reports negotiated datagram capacity. The browser-style limit is
    // quiche's current writable DATAGRAM length minus the HTTP/3 session
    // framing this client prepends: the quarter-stream-id varint, whose width
    // grows with the CONNECT stream id. Nothing here is a constant.
    {
        check(datagramPayloadCapacity(1200, 0) == 1199,
              "capacity subtracts a 1-byte flow id");
        check(datagramPayloadCapacity(1200, 256) == 1198,
              "capacity subtracts a 2-byte flow id");
        check(datagramPayloadCapacity(1200, 65536) == 1196,
              "capacity subtracts a 4-byte flow id");
        // Unavailable datagram support and an unfinished session are both "no
        // capacity", never a guess.
        check(datagramPayloadCapacity(-1, 0) == 0, "quiche Done reports no capacity");
        check(datagramPayloadCapacity(0, 0) == 0, "zero writable length reports no capacity");
        check(datagramPayloadCapacity(1200, -1) == 0, "no CONNECT stream reports no capacity");
        // Framing that consumes the whole frame leaves nothing, and never wraps.
        check(datagramPayloadCapacity(1, 0) == 0, "framing consuming the frame leaves no capacity");
        check(datagramPayloadCapacity(2, 256) == 0, "2-byte framing in a 2-byte frame leaves none");

        // The explicit clamp only ever lowers the measured capacity. Unset means
        // no clamp; an explicit value that cannot be used is a configuration
        // error that fails closed, because keeping the negotiated number while
        // the operator believes a limit is in force is the same silent
        // substitution this whole change exists to remove.
        size_t clamped = 0;
        std::string clampError;
        check(clampDatagramCapacity(1199, "64", &clamped, &clampError) && clamped == 64,
              "clamp lowers capacity to 64");
        check(clampDatagramCapacity(1199, "1199", &clamped, &clampError) && clamped == 1199,
              "clamp equal to capacity is capacity");
        check(clampDatagramCapacity(1199, "9999", &clamped, &clampError) && clamped == 1199,
              "clamp never raises capacity");
        check(clampDatagramCapacity(1199, nullptr, &clamped, &clampError) && clamped == 1199,
              "unset clamp leaves capacity and is not an error");

        // Every malformed explicit value is rejected, and says which value.
        const char* rejected[] = {"", "0", "-5", "64x", "abc", " 64", "+", "99999999999999999999"};
        for (const char* value : rejected) {
            clamped = 12345;
            clampError.clear();
            const bool ok = clampDatagramCapacity(1199, value, &clamped, &clampError);
            check(!ok, "malformed clamp value is refused");
            check(!clampError.empty(), "a refused clamp explains itself");
            check(clampError.find(kMaxDatagramEnv) != std::string::npos,
                  "a refused clamp names the environment variable");
            check(clamped == 12345, "a refused clamp does not write a capacity");
        }
        // Overflow is a refusal, not a wrap to some usable-looking number.
        check(!clampDatagramCapacity(1199, "99999999999999999999", &clamped, &clampError),
              "a clamp past long long is refused rather than wrapped");
    }

    // --- rejects oversized datagram, and distinguishes closed session from
    // queue drop. Both are the same call shape from JS, so the status the
    // native side returns is the only thing that tells them apart.
    {
        check(classifyDatagramSend(true, 64, 64) == kDatagramAccepted,
              "a datagram at the limit is accepted");
        check(classifyDatagramSend(true, 64, 0) == kDatagramAccepted,
              "an empty datagram is accepted");
        check(classifyDatagramSend(true, 64, 65) == kDatagramTooLarge,
              "rejects oversized datagram: 65 bytes against a 64-byte capacity");
        check(classifyDatagramSend(false, 64, 8) == kDatagramInvalidSession,
              "a datagram on an unusable session is refused");
        // A closed session is refused as a closed session even when the payload
        // is also too large: the caller must not be told to shrink a write that
        // has nowhere to go.
        check(classifyDatagramSend(false, 64, 65) == kDatagramInvalidSession,
              "an unusable session outranks the size check");
        // Every status is distinct, or the JS side cannot tell them apart.
        const int statuses[] = {kDatagramAccepted, kDatagramInvalidSession, kDatagramTooLarge,
                                kDatagramDropped, kDatagramSendFailed};
        bool distinct = true;
        for (size_t i = 0; i < sizeof(statuses) / sizeof(statuses[0]); i += 1) {
            for (size_t j = i + 1; j < sizeof(statuses) / sizeof(statuses[0]); j += 1) {
                if (statuses[i] == statuses[j]) distinct = false;
            }
        }
        check(distinct, "datagram send statuses are mutually distinct");
    }

    // --- bounded outgoing queue: admitting past the bound discards the oldest
    // waiting datagram and reports exactly that one drop. Unreliable delivery,
    // so the newest message is the one worth keeping.
    {
        std::deque<std::vector<uint8_t>> queue;
        check(admitDatagram(queue, 2, {1}) == 0, "first datagram admitted without a drop");
        check(admitDatagram(queue, 2, {2}) == 0, "second datagram admitted without a drop");
        check(queue.size() == 2, "queue holds both datagrams at the bound");
        check(admitDatagram(queue, 2, {3}) == 1, "admitting past the bound drops exactly one");
        check(queue.size() == 2, "queue stays bounded after the drop");
        check(queue.front() == std::vector<uint8_t>{2} && queue.back() == std::vector<uint8_t>{3},
              "the oldest datagram is the one discarded");

        // A bound of zero would drop every datagram including the one being
        // admitted; the smallest usable queue is one.
        std::deque<std::vector<uint8_t>> single;
        check(admitDatagram(single, 0, {9}) == 0, "a zero bound still admits the new datagram");
        check(single.size() == 1 && single.front() == std::vector<uint8_t>{9},
              "a zero bound holds exactly the newest datagram");
    }

    // --- bounded receive across a whole poll tick. readDatagrams() runs once
    // per inbound UDP packet inside pumpSocket()'s recv loop, so a budget that
    // restarts on every call bounds nothing: a burst still pushes an unbounded
    // number of events at JS in one turn. The budget is therefore carried by
    // the session across the tick and only the remainder is offered here.
    {
        // A peer that always has another datagram waiting, framed for flow 0.
        size_t supplied = 0;
        auto endlessRecv = [&supplied](uint8_t* out, size_t cap) -> ssize_t {
            if (cap < 2) return -1;
            supplied += 1;
            out[0] = 0;  // flow id 0, one-byte varint
            out[1] = 7;  // payload
            return 2;
        };

        size_t emitted = 0;
        auto count = [&emitted](const uint8_t*, size_t) { emitted += 1; };

        // One call cannot exceed its own budget.
        check(drainDatagramReads(endlessRecv, 0, 4, count) == 4, "one drain stops at its budget");
        check(emitted == 4, "a bounded drain emits exactly what it read");

        // Ten calls through the production carry helper — the shape pumpSocket
        // produces when ten UDP packets arrive in one tick — admit one tick
        // budget, not ten times it. `used` is the session's counter, and only
        // processEvents() may reset it.
        supplied = 0;
        emitted = 0;
        size_t used = 0;
        for (int call = 0; call < 10; call += 1) {
            readDatagramsBudgeted(used, kDatagramQueueLimit, endlessRecv, 0, count);
        }
        check(used == kDatagramQueueLimit, "a burst across ten calls admits one tick budget");
        check(emitted == kDatagramQueueLimit, "a burst emits one tick budget of events");
        check(supplied == kDatagramQueueLimit, "an exhausted budget stops reading the socket");

        // A fresh tick gets a fresh budget, and only a reset produces one.
        used = 0;
        emitted = 0;
        readDatagramsBudgeted(used, kDatagramQueueLimit, endlessRecv, 0, count);
        check(used == kDatagramQueueLimit && emitted == kDatagramQueueLimit,
              "the next tick starts from a full budget");

        // An exhausted budget is a no-op rather than an unbounded read.
        check(drainDatagramReads(endlessRecv, 0, 0, count) == 0, "a zero budget reads nothing");

        // A datagram for another session is consumed but never emitted, and it
        // still costs budget: the bound is on work done, not only on events.
        emitted = 0;
        auto foreignRecv = [](uint8_t* out, size_t cap) -> ssize_t {
            if (cap < 2) return -1;
            out[0] = 9;  // flow id 9
            out[1] = 7;
            return 2;
        };
        check(drainDatagramReads(foreignRecv, 0, 3, count) == 3, "a foreign flow costs budget");
        check(emitted == 0, "a foreign flow emits nothing");

        // Nothing waiting ends the drain immediately (quiche's Done).
        auto doneRecv = [](uint8_t*, size_t) -> ssize_t { return QUICHE_ERR_DONE; };
        check(drainDatagramReads(doneRecv, 0, 8, count) == 0, "Done ends the drain at once");
    }

    // --- idle receive: a real non-blocking session socket can be empty while
    // quiche still has datagrams queued. The first readDatagrams() consumes one
    // tick's 256-read budget; after the runtime resets that budget, an empty
    // pumpSocket() must still drain the remaining 44 through its post-loop
    // production call. Calling pumpSocket() twice in one tick must stay capped.
    {
        init();
        socket_t peerGuard = ::socket(AF_INET, SOCK_DGRAM, 0);
        uint16_t peerPort = 0;
        if (peerGuard != kInvalidSocket) {
            sockaddr_in guardAddress{};
            guardAddress.sin_family = AF_INET;
            guardAddress.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
            guardAddress.sin_port = htons(0);
            if (::bind(peerGuard, reinterpret_cast<const sockaddr*>(&guardAddress),
                       sizeof(guardAddress)) == 0) {
                socklen_t guardLength = sizeof(guardAddress);
                if (::getsockname(peerGuard, reinterpret_cast<sockaddr*>(&guardAddress),
                                  &guardLength) == 0) {
                    peerPort = ntohs(guardAddress.sin_port);
                }
            }
        }
        check(peerGuard != kInvalidSocket && peerPort != 0,
              "idle receive regression owns an unused loopback peer port");
        const uint32_t sessionId =
            peerPort == 0 ? 0 : connectSession("https://127.0.0.1:" + std::to_string(peerPort) + "/");
        Session* session = findSession(sessionId);
        check(session != nullptr && session->conn != nullptr,
              "idle receive regression creates a real quiche session");
        if (session != nullptr && session->conn != nullptr) {
            session->wtReady = true;
            session->connectStreamId = 0;
            g_receiveSeamConn = session->conn;

            // The socket has no peer traffic. The queued values come only from
            // the test-only quiche DATAGRAM receive seam, so pumpSocket's
            // recvfrom path remains the real empty non-blocking path.
            queueFramedDatagrams(0, 300);
            session->datagramReadsThisTick = 0;
            readDatagrams(session);
            std::vector<std::vector<uint8_t>> firstTick;
            check(session->datagramReadsThisTick == kDatagramQueueLimit,
                  "first receive tick spends the 256-read budget");
            check(g_receiveSeamQueue.size() == 44,
                  "first receive tick leaves the 44-datagram backlog");
            check(countDatagramEvents(&firstTick) == kDatagramQueueLimit,
                  "first receive tick emits 256 datagrams");
            checkDatagramSequence(firstTick, 0, "first receive tick preserves datagram order");

            session->datagramReadsThisTick = 0;
            pumpSocket(session);
            std::vector<std::vector<uint8_t>> secondTick;
            check(session->datagramReadsThisTick == 44,
                  "an empty socket tick spends only the remaining 44 reads");
            check(g_receiveSeamQueue.empty(),
                  "an empty socket tick drains the queued datagram backlog");
            check(countDatagramEvents(&secondTick) == 44,
                  "an empty socket tick emits the remaining 44 datagrams");
            checkDatagramSequence(secondTick, 256,
                                  "an empty socket tick preserves remaining datagram order");

            // A second empty pump in the same tick sees the exhausted shared
            // budget and cannot read a new burst beyond 256.
            queueFramedDatagrams(0, 300);
            session->datagramReadsThisTick = 0;
            pumpSocket(session);
            pumpSocket(session);
            std::vector<std::vector<uint8_t>> repeatedTick;
            check(session->datagramReadsThisTick == kDatagramQueueLimit,
                  "repeated empty pumps stay within one 256-read tick budget");
            check(g_receiveSeamQueue.size() == 44,
                  "repeated empty pumps leave only the post-cap remainder");
            check(countDatagramEvents(&repeatedTick) == kDatagramQueueLimit,
                  "repeated empty pumps emit at most 256 datagrams");
            checkDatagramSequence(repeatedTick, 0,
                                  "repeated empty pumps preserve datagram order");

            g_receiveSeamQueue.clear();
            g_receiveSeamConn = nullptr;
            clearEvents();

            // Exercise the production pumpDatagramSends(Session*) caller. A
            // hard quiche error fails the session, while the legitimate local
            // backlog-drop counter must remain unchanged.
            session->outgoingDatagrams.push_back({0x42});
            session->droppedDatagrams = 17;
            session->datagramSendFailed = false;
            session->failed = false;
            g_sendSeamConn = session->conn;
            g_sendSeamResult = -7;
            g_sendSeamCalls = 0;
            pumpDatagramSends(session);
            check(g_sendSeamCalls == 1, "hard send regression calls quiche once");
            check(session->outgoingDatagrams.empty(),
                  "hard send regression removes only the refused frame");
            check(session->droppedDatagrams == 17,
                  "hard send failure does not increment local drop count");
            check(session->datagramSendFailed,
                  "hard send failure marks the datagram path failed");
            check(session->failed, "hard send failure marks the session failed");
            bool sawDatagramError = false;
            while (!g_events.empty()) {
                Event event = std::move(g_events.front());
                g_events.pop();
                if (event.type == EventType::Error &&
                    event.message.find("Datagram send failed") != std::string::npos) {
                    sawDatagramError = true;
                }
            }
            check(sawDatagramError, "hard send failure emits a datagram error event");
            g_sendSeamConn = nullptr;
            g_sendSeamResult = QUICHE_ERR_DONE;
        }
        if (peerGuard != kInvalidSocket) closeSocket(peerGuard);
        shutdown();
    }

    // --- outgoing queue pressure through the production drain, with an
    // injected sender. Loopback will not reliably refuse a datagram on demand,
    // so the seam is the sender itself: this proves the drain's contract, not
    // that a real path produced these answers.
    {
        std::deque<std::vector<uint8_t>> queue;
        // 300 admissions against a 256-deep queue: 44 oldest are discarded.
        size_t dropped = 0;
        for (int i = 0; i < 300; i += 1) {
            dropped += admitDatagram(queue, kDatagramQueueLimit,
                                     {static_cast<uint8_t>(i & 0xff)});
        }
        check(dropped == 300 - kDatagramQueueLimit, "300 admissions into 256 drop exactly 44");
        check(queue.size() == kDatagramQueueLimit, "the queue never exceeds its bound");
        check(queue.front() == std::vector<uint8_t>{44 & 0xff},
              "the surviving queue starts at the 45th datagram");

        // Done means "no room right now": the queue is left intact for the next
        // frame and nothing is counted as dropped or failed.
        auto alwaysDone = [](const uint8_t*, size_t) -> ssize_t { return QUICHE_ERR_DONE; };
        DatagramDrainResult r = drainDatagramQueue(queue, alwaysDone);
        check(r.sent == 0 && r.hardErrors == 0 && r.lastError == 0,
              "Done sends nothing and fails nothing");
        check(queue.size() == kDatagramQueueLimit, "Done leaves the queue intact for a retry");

        // A hard quiche error is not backlog. It stops the drain, is reported
        // once with the error it saw, and never increments the legitimate
        // local-drop count — the caller fails the session instead.
        auto hardError = [](const uint8_t*, size_t) -> ssize_t { return -7; };
        const size_t beforeHardError = dropped;
        r = drainDatagramQueue(queue, hardError);
        check(r.hardErrors == 1, "a hard error is reported exactly once");
        check(r.lastError == -7, "a hard error carries the quiche error it saw");
        check(r.sent == 0, "a hard error sends nothing");
        check(dropped == beforeHardError, "a hard error does not count as a backlog drop");
        check(queue.size() == kDatagramQueueLimit - 1,
              "a hard error discards only the frame that failed and stops");

        // A path with room drains everything that is waiting.
        size_t sentBytes = 0;
        auto accepts = [&sentBytes](const uint8_t*, size_t n) -> ssize_t {
            sentBytes += n;
            return static_cast<ssize_t>(n);
        };
        r = drainDatagramQueue(queue, accepts);
        check(r.sent == kDatagramQueueLimit - 1, "a clear path drains the whole queue");
        check(r.hardErrors == 0 && r.lastError == 0, "a clear path reports no failure");
        check(queue.empty(), "a drained queue is empty");
        check(sentBytes == kDatagramQueueLimit - 1, "every queued datagram reached the sender");
    }

    // --- reliable stream send admission and pump. The seam drives the real
    // quiche Session through Done/short-write/Done/resume, and records the
    // bytes offered to quiche so this checks the production buffer rather than
    // replaying a second implementation in the test.
    {
        init();
        socket_t peerGuard = ::socket(AF_INET, SOCK_DGRAM, 0);
        uint16_t peerPort = 0;
        if (peerGuard != kInvalidSocket) {
            sockaddr_in guardAddress{};
            guardAddress.sin_family = AF_INET;
            guardAddress.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
            guardAddress.sin_port = htons(0);
            if (::bind(peerGuard, reinterpret_cast<const sockaddr*>(&guardAddress),
                       sizeof(guardAddress)) == 0) {
                socklen_t guardLength = sizeof(guardAddress);
                if (::getsockname(peerGuard, reinterpret_cast<sockaddr*>(&guardAddress),
                                  &guardLength) == 0) {
                    peerPort = ntohs(guardAddress.sin_port);
                }
            }
        }
        check(peerGuard != kInvalidSocket && peerPort != 0,
              "stream send regression owns an unused loopback peer port");
        const uint32_t sessionId =
            peerPort == 0 ? 0 : connectSession("https://127.0.0.1:" + std::to_string(peerPort) + "/");
        Session* session = findSession(sessionId);
        check(session != nullptr && session->conn != nullptr,
              "stream send regression creates a real quiche session");
        if (session != nullptr && session->conn != nullptr) {
            session->wtReady = true;
            session->connectStreamId = 0;
            g_streamSendSeamConn = session->conn;

            // Done, a one-byte short write, Done, then the remaining two bytes.
            // The FIN is passed on each attempt but is sent only with the final
            // accepted prefix.
            configureStreamSendSeam(session->conn,
                                    {QUICHE_ERR_DONE, 1, QUICHE_ERR_DONE, 2});
            StreamState sequence;
            sequence.isOutgoing = true;
            sequence.outBuf = {'a', 'b', 'c'};
            sequence.outFin = true;
            pumpStream(session, 4, sequence);
            check(sequence.outBuf == std::vector<uint8_t>{'a', 'b', 'c'} &&
                      !sequence.finSent,
                  "Done leaves a blocked stream buffer and FIN pending");
            pumpStream(session, 4, sequence);
            check(sequence.outBuf == std::vector<uint8_t>{'b', 'c'} &&
                      !sequence.finSent,
                  "a short stream write removes exactly its accepted prefix");
            pumpStream(session, 4, sequence);
            check(sequence.outBuf == std::vector<uint8_t>{'b', 'c'} &&
                      !sequence.finSent,
                  "a second Done preserves the remaining stream bytes");
            pumpStream(session, 4, sequence);
            check(sequence.outBuf.empty() && sequence.finSent,
                  "the final accepted stream write sends FIN");
            check(sequence.outBuf.capacity() == 0,
                  "a fully drained stream releases its native buffer storage");
            check(g_streamAcceptedBytes == std::vector<uint8_t>{'a', 'b', 'c'},
                  "partial stream writes preserve exact accepted byte order");
            check(g_streamSendCalls.size() == 4 && g_streamSendCalls.back().streamId == 4 &&
                      g_streamSendCalls.back().offered == std::vector<uint8_t>{'b', 'c'} &&
                      g_streamSendCalls.back().result == 2 && g_streamSendCalls.back().fin,
                  "the final stream call carries the remaining bytes and FIN");
            processEvents();
            clearEvents();

            // Positive partial writes without an intervening Done still free
            // capacity and therefore wake a waiting writer once per session.
            configureStreamSendSeam(session->conn, {1, 2});
            StreamState partial;
            partial.isOutgoing = true;
            partial.outBuf = {'d', 'e', 'f'};
            pumpStream(session, 5, partial);
            check(partial.outBuf == std::vector<uint8_t>{'e', 'f'},
                  "a positive partial write without Done removes its prefix");
            check(g_streamAcceptedBytes == std::vector<uint8_t>{'d'},
                  "a positive partial write records exactly its accepted byte");
            size_t partialWritableEvents = 0;
            for (std::queue<Event> pending = g_events; !pending.empty(); pending.pop()) {
                if (pending.front().type == EventType::Writable) partialWritableEvents += 1;
            }
            check(partialWritableEvents == 1,
                  "positive partial stream progress queues recovery before the buffer empties");
            pumpStream(session, 5, partial);
            check(partial.outBuf.empty() &&
                      g_streamAcceptedBytes == std::vector<uint8_t>{'d', 'e', 'f'},
                  "successive positive partial writes preserve byte order");
            partialWritableEvents = 0;
            for (std::queue<Event> pending = g_events; !pending.empty(); pending.pop()) {
                if (pending.front().type == EventType::Writable) partialWritableEvents += 1;
            }
            check(partialWritableEvents == 1,
                  "positive partial stream progress queues one recovery event");
            processEvents();
            clearEvents();

            // Two streams share one 1 MiB native admission budget. A refused
            // write must leave both the existing and incoming buffers intact.
            constexpr size_t kExpectedStreamLimit = 1024 * 1024;
            const std::vector<uint8_t> firstData(600 * 1024, 0x11);
            const std::vector<uint8_t> secondData(424 * 1024, 0x22);
            auto& first = session->streams[8];
            first.isOutgoing = true;
            auto& second = session->streams[12];
            second.isOutgoing = true;
            configureStreamSendSeam(session->conn, {QUICHE_ERR_DONE});
            check(streamWrite(sessionId, 8, firstData.data(), firstData.size(), false) ==
                      static_cast<int64_t>(firstData.size()),
                  "a stream write under the session bound is accepted");
            const std::vector<uint8_t> firstBeforeSaturation = first.outBuf;
            check(first.outBuf == firstData && first.outBuf.size() < kExpectedStreamLimit,
                  "the first stream keeps its admitted bytes while blocked");
            check(streamWrite(sessionId, 12, secondData.data(), secondData.size(), false) ==
                      static_cast<int64_t>(secondData.size()),
                  "a second stream fills the session byte bound exactly");
            check(first.outBuf == firstBeforeSaturation && second.outBuf == secondData &&
                      first.outBuf.size() + second.outBuf.size() == kExpectedStreamLimit,
                  "two streams retain exactly 1 MiB of admitted bytes");

            const uint8_t overflowByte = 0x43;
            const std::vector<uint8_t> secondBeforeOverflow = second.outBuf;
            check(streamWrite(sessionId, 12, &overflowByte, 1, false) == -2,
                  "a second stream refuses a byte beyond the session bound");
            check(first.outBuf == firstBeforeSaturation && second.outBuf == secondBeforeOverflow,
                  "a saturated write preserves both existing stream buffers");

            const uint64_t nextBidiBeforeFullCreate = session->nextClientBidi;
            check(createStream(sessionId, true) == -2,
                  "a full session refuses a stream header before map insertion");
            check(session->nextClientBidi == nextBidiBeforeFullCreate &&
                      session->streams.find(nextBidiBeforeFullCreate) == session->streams.end(),
                  "a refused stream header does not consume an id or buffer space");

            auto& saturated = session->streams[16];
            saturated.isOutgoing = true;
            const uint8_t nextByte = 0x44;
            check(streamWrite(sessionId, 16, &nextByte, 1, false) == -2,
                  "the next byte is refused at the exact session bound");
            check(saturated.outBuf.empty(), "the next byte leaves the refused stream unchanged");

            // Pumping the first stream frees its bytes; the previously refused
            // write can then be admitted without changing its byte order.
            configureStreamSendSeam(session->conn,
                                    {static_cast<ssize_t>(firstData.size())});
            pumpStream(session, 8, first);
            check(first.outBuf.empty(), "a successful pump frees the first stream buffer");
            processEvents();
            configureStreamSendSeam(session->conn, {QUICHE_ERR_DONE});
            check(streamWrite(sessionId, 16, &nextByte, 1, false) == 1,
                  "a previously saturated stream succeeds after capacity recovers");
            check(saturated.outBuf == std::vector<uint8_t>{nextByte},
                  "the recovered stream retains the retried byte");

            // A stream whose initial WT header hits a quiche hard error is not
            // a successfully created stream. Its consumed id must stay retired
            // so a later retry cannot receive the failed stream's queued error.
            session->nextClientBidi = 100;
            const uint64_t nextBidiBeforeSendError = session->nextClientBidi;
            clearEvents();
            configureStreamSendSeam(session->conn, {-8}, 0x66);
            check(createStream(sessionId, true) == -1,
                  "a hard header send error refuses stream creation");
            check(session->nextClientBidi == nextBidiBeforeSendError + 4 &&
                      session->streams.find(nextBidiBeforeSendError) == session->streams.end(),
                  "a failed header send keeps its consumed stream id retired");
            bool sawHeaderStreamWriteError = false;
            for (std::queue<Event> pending = g_events; !pending.empty(); pending.pop()) {
                if (pending.front().type == EventType::StreamWriteError &&
                    pending.front().streamId == static_cast<int64_t>(nextBidiBeforeSendError) &&
                    pending.front().code == 0x66) {
                    sawHeaderStreamWriteError = true;
                }
            }
            check(sawHeaderStreamWriteError,
                  "a failed header send carries the created stream id and peer code");
            processEvents();
            clearEvents();
            configureStreamSendSeam(session->conn, {QUICHE_ERR_DONE});
            check(createStream(sessionId, true) == static_cast<int64_t>(nextBidiBeforeSendError + 4),
                  "the next stream uses the next fresh id after a failed header");

            auto& oversizedTarget = session->streams[20];
            oversizedTarget.isOutgoing = true;
            const std::vector<uint8_t> oversized(kExpectedStreamLimit + 1, 0x33);
            check(streamWrite(sessionId, 20, oversized.data(), oversized.size(), false) == -3,
                  "an oversized single stream write is refused before admission");
            check(oversizedTarget.outBuf.empty(),
                  "an oversized write does not allocate into the buffer");

            // Empty FIN is valid on an open write side, and closes admission for
            // every subsequent write even if that FIN had not reached quiche.
            const uint8_t emptyMarker = 0;
            auto& emptyFin = session->streams[24];
            emptyFin.isOutgoing = true;
            check(streamWrite(sessionId, 24, &emptyMarker, 0, true) == 0,
                  "an empty FIN is accepted on an open stream");
            check(emptyFin.outFin && !emptyFin.finSent,
                  "an empty FIN remains pending behind quiche");
            check(streamWrite(sessionId, 24, &emptyMarker, 1, false) == -1,
                  "a write after a requested FIN is refused");

            auto& finished = session->streams[28];
            finished.isOutgoing = true;
            configureStreamSendSeam(session->conn, {1});
            check(streamWrite(sessionId, 28, &emptyMarker, 1, true) == 1,
                  "a final stream write reports its accepted byte count");
            check(finished.finSent, "a fully accepted final write records FIN sent");
            check(streamWrite(sessionId, 28, &emptyMarker, 1, false) == -1,
                  "a write after FIN was sent is refused");
            processEvents();
            clearEvents();

            auto& invalid = session->streams[32];
            invalid.isOutgoing = true;
            session->failed = true;
            check(streamWrite(sessionId, 32, &emptyMarker, 1, false) == -1,
                  "a write on a failed session is refused");
            session->failed = false;
            session->wantClose = true;
            check(streamWrite(sessionId, 32, &emptyMarker, 1, false) == -1,
                  "a write on a session requesting close is refused");
            session->wantClose = false;

            // A quiche stream reset/error is a reliable send failure. It must
            // release the pending bytes, carry the peer error code, and leave
            // the unrelated datagram-drop metric untouched.
            auto& hardFailure = session->streams[36];
            hardFailure.isOutgoing = true;
            session->droppedDatagrams = 17;
            clearEvents();
            configureStreamSendSeam(session->conn, {-7}, 0x55);
            check(streamWrite(sessionId, 36, &emptyMarker, 1, false) == -1,
                  "a hard stream send error is not reported as a successful write");
            check(hardFailure.sendError && hardFailure.outBuf.empty(),
                  "a hard stream send error releases pending bytes");
            check(hardFailure.outBuf.capacity() == 0,
                  "a hard stream send error releases native buffer storage");
            check(session->droppedDatagrams == 17,
                  "a hard stream send error does not increment datagram drops");
            bool sawStreamWriteError = false;
            bool sawWritableAfterHardError = false;
            for (std::queue<Event> pending = g_events; !pending.empty(); pending.pop()) {
                const Event& event = pending.front();
                if (event.type == EventType::StreamWriteError && event.streamId == 36 &&
                    event.code == 0x55) {
                    sawStreamWriteError = true;
                }
                if (event.type == EventType::Writable) sawWritableAfterHardError = true;
            }
            check(sawStreamWriteError,
                  "a hard stream send error carries stream id and peer error code");
            check(sawWritableAfterHardError,
                  "a hard stream send error releases capacity to waiting writers");
            processEvents();
            clearEvents();

            // A recovery notification is session-wide and coalesced across
            // streams.
            auto& writableA = session->streams[40];
            writableA.isOutgoing = true;
            writableA.outBuf = {0xa1};
            auto& writableB = session->streams[44];
            writableB.isOutgoing = true;
            writableB.outBuf = {0xb2};
            clearEvents();
            configureStreamSendSeam(session->conn, {QUICHE_ERR_DONE});
            pumpStream(session, 40, writableA);
            pumpStream(session, 44, writableB);
            clearEvents();
            configureStreamSendSeam(session->conn, {1, 1});
            pumpStream(session, 40, writableA);
            pumpStream(session, 44, writableB);
            size_t writableEvents = 0;
            for (std::queue<Event> pending = g_events; !pending.empty(); pending.pop()) {
                const Event& event = pending.front();
                if (event.type == EventType::Writable && event.streamId == -1 &&
                    event.code == 0 && event.data.empty() && event.message.empty()) {
                    writableEvents += 1;
                }
            }
            check(writableEvents == 1,
                  "draining multiple streams queues one session-wide writable event");
            processEvents();
            clearEvents();
            writableA.outBuf = {0xc3};
            configureStreamSendSeam(session->conn, {QUICHE_ERR_DONE});
            pumpStream(session, 40, writableA);
            configureStreamSendSeam(session->conn, {1});
            pumpStream(session, 40, writableA);
            writableEvents = 0;
            for (std::queue<Event> pending = g_events; !pending.empty(); pending.pop()) {
                if (pending.front().type == EventType::Writable) writableEvents += 1;
            }
            check(writableEvents == 1,
                  "processing a writable event clears coalescing for the next recovery");

            // A readable existing bidi stream starts without application credit.
            // The sender's bytes must remain in quiche until a JS reader grants it.
            clearEvents();
            g_streamReceiveConn = session->conn;
            auto& readBlocked = session->streams[80];
            readBlocked.isOutgoing = true;
            readBlocked.headerConsumed = true;
            g_streamReceiveQueues[80].push_back({{'a','b','c','d','e','f','g','h'}, false, 0});
            g_streamReceivedBytes = 0;
            readStream(session, 80);
            check(g_streamReceivedBytes == 0,
                  "a stream without application credit leaves payload in quiche");
            bool leakedPayload = false;
            for (auto pending = g_events; !pending.empty(); pending.pop()) {
                if (pending.front().type == EventType::StreamData && !pending.front().data.empty())
                    leakedPayload = true;
            }
            check(!leakedPayload, "a stream without credit emits no payload event");
            check(streamReadCredit(sessionId, 80, 4) == 0,
                  "the application grants four bytes through the native credit path");
            pumpSocket(session);
            check(g_streamReceivedBytes == 4 && readBlocked.inFlightReadBytes == 4,
                  "an idle socket drains exactly the granted payload bytes");
            std::vector<uint8_t> firstRead;
            for (auto pending = g_events; !pending.empty(); pending.pop()) {
                if (pending.front().type == EventType::StreamData)
                    firstRead.insert(firstRead.end(), pending.front().data.begin(), pending.front().data.end());
            }
            check(firstRead == std::vector<uint8_t>{'a','b','c','d'},
                  "the first read grant preserves the exact payload prefix");
            check(streamReadCredit(sessionId, 80, 4) == 0 && readBlocked.readCredit == 0,
                  "a refreshed desired size subtracts already queued native events");
            pumpSocket(session);
            check(g_streamReceivedBytes == 4,
                  "queued in-flight bytes cannot be granted twice before dispatch");
            processEvents();
            check(readBlocked.inFlightReadBytes == 0,
                  "production event dispatch releases its in-flight byte accounting");
            check(streamReadCredit(sessionId, 80, 4) == 0,
                  "a resumed reader can grant new capacity after event dispatch");
            pumpSocket(session);
            check(g_streamReceivedBytes == 8,
                  "fresh credit resumes the remaining bytes without a new UDP packet");
            std::vector<uint8_t> finalRead;
            for (auto pending = g_events; !pending.empty(); pending.pop()) {
                if (pending.front().type == EventType::StreamData)
                    finalRead.insert(finalRead.end(), pending.front().data.begin(), pending.front().data.end());
            }
            check(finalRead == std::vector<uint8_t>{'e','f','g','h'},
                  "resumed reads preserve the exact unread suffix");
            check(g_testReadableIterators.empty(), "bounded receive frees every readable iterator");
            processEvents();
            // The existing bridge is called by WritableStream.abort: its
            // default direction must stop writing while the bidi reply still works.
            g_streamShutdownCalls.clear();
            g_readShutdownIds.clear();
            g_writeShutdownIds.clear();
            streamShutdown(sessionId, 80, 0x77);
            check(g_streamShutdownCalls.size() == 1 &&
                      g_streamShutdownCalls[0].second == QUICHE_SHUTDOWN_WRITE,
                  "writer abort shuts down only the write direction");
            g_streamReceiveQueues[80].push_back({{'r'}, false, 0});
            check(streamReadCredit(sessionId, 80, 1) == 0,
                  "the bidi reply still accepts credit after writer abort");
            const size_t beforeReply = g_streamReceivedBytes;
            readStream(session, 80);
            check(g_streamReceivedBytes == beforeReply + 1,
                  "the opposite bidi read direction still receives after writer abort");
            processEvents();
            g_streamShutdownCalls.clear();
            g_readShutdownIds.clear();
            g_writeShutdownIds.clear();
            auto& readCancelled = session->streams[84];
            readCancelled.isOutgoing = true;
            readCancelled.headerConsumed = true;
            streamShutdown(sessionId, 84, 0x78, QUICHE_SHUTDOWN_READ);
            check(g_streamShutdownCalls.size() == 1 &&
                      g_streamShutdownCalls[0].second == QUICHE_SHUTDOWN_READ,
                  "reader cancellation shuts down only the read direction");
            configureStreamSendSeam(session->conn, {1});
            const uint8_t replyByte = 0x79;
            check(streamWrite(sessionId, 84, &replyByte, 1, false) == 1 &&
                      g_streamAcceptedBytes == std::vector<uint8_t>{replyByte},
                  "the opposite bidi write direction still sends after reader cancellation");
            processEvents();
            g_streamShutdownCalls.clear();
            g_readShutdownIds.clear();
            g_writeShutdownIds.clear();

            // A completed incoming stream stays counted until its JS reader drains
            // the final payload and explicitly releases the read half.
            std::vector<uint8_t> incomingHeader = encodeVarint(WT_STREAM_UNI_SIGNAL);
            varintEncode(incomingHeader, 0);
            incomingHeader.insert(incomingHeader.end(), {'u','n','i'});
            g_streamReceiveQueues[83].push_back({incomingHeader, true, 0});
            readStream(session, 83);
            check(session->streams.count(83) == 1 && !session->streams.at(83).finDelivered,
                  "an incoming stream announces before consuming uncredited payload");
            check(streamReadCredit(sessionId, 83, 3) == 0,
                  "an announced incoming stream accepts measured read capacity");
            readStream(session, 83);
            check(session->streams.at(83).finDelivered,
                  "incoming FIN is recorded after its final credited payload");
            processEvents();
            check(session->streams.count(83) == 1,
                  "FIN and event dispatch do not free an undrained application stream");
            check(streamReleaseRead(sessionId, 83) == 0,
                  "a drained application stream releases its completed native read half");
            processEvents();
            check(session->streams.count(83) == 0,
                  "a fully released incoming uni stream returns its native slot");
            // Per-tick byte limits aggregate across streams, rather than being
            // restarted for each stream or each idle-socket read pass.
            g_streamReceiveQueues.clear();
            for (uint64_t index = 0; index < 32; ++index) {
                const uint64_t id = 400 + index * 4;
                auto& stream = session->streams[id];
                stream.isOutgoing = true;
                stream.headerConsumed = true;
                g_streamReceiveQueues[id].push_back({std::vector<uint8_t>(16 * 1024, index), false, 0});
                check(streamReadCredit(sessionId, id, 16 * 1024) == 0,
                      "each independent stream reserves its measured receive capacity");
            }
            g_streamReceivedBytes = 0;
            processEvents();
            check(g_streamReceivedBytes == 256 * 1024 && session->streamReadBytesThisTick == 256 * 1024,
                  "one poll admits at most 256 KiB across all reliable streams");
            processEvents();
            check(g_streamReceivedBytes == 512 * 1024,
                  "the following poll fairly drains streams left by the byte budget");

            // Tiny chunks are bounded by work/event count even though their total
            // bytes are much smaller than the receive byte allowance.
            g_streamReceiveQueues.clear();
            auto& tiny = session->streams[600];
            tiny.isOutgoing = true;
            tiny.headerConsumed = true;
            check(streamReadCredit(sessionId, 600, 1024) == 0,
                  "the tiny-chunk stream reserves its read capacity");
            for (size_t index = 0; index < 300; ++index)
                g_streamReceiveQueues[600].push_back({{static_cast<uint8_t>(index)}, false, 0});
            session->streamReadCallsThisTick = 0;
            session->streamReadBytesThisTick = 0;
            g_streamReceivedBytes = 0;
            readStream(session, 600);
            size_t tinyEvents = 0;
            for (auto pending = g_events; !pending.empty(); pending.pop())
                if (pending.front().type == EventType::StreamData && pending.front().streamId == 600) ++tinyEvents;
            check(g_streamReceivedBytes == 256 && tinyEvents == 256,
                  "tiny chunks cannot exceed 256 reliable receive operations in a tick");
            readStream(session, 600);
            check(g_streamReceivedBytes == 256,
                  "another reader call cannot reset the per-tick operation budget");
            processEvents();
            check(g_streamReceivedBytes == 300,
                  "the next tick resumes tiny chunks without losing the unread suffix");

            while (session->streams.size() < 64) {
                const int64_t id = createStream(sessionId, true);
                check(id >= 0, "stream slots below the hard count limit remain available");
                if (id < 0) break;
            }
            const size_t fullStreamCount = session->streams.size();
            check(fullStreamCount == 64 && createStream(sessionId, true) == -2 &&
                      session->streams.size() == fullStreamCount,
                  "stream-count saturation refuses before allocating another stream");
            g_streamReceiveConn = nullptr;
            g_streamReceiveQueues.clear();
            clearEvents();

            // Drive split foreign headers through the real idle socket/readable
            // iteration path. Neither the partial header nor foreign payload may
            // announce a stream to the application.
            for (bool isUni : {false, true}) {
                const uint32_t foreignId = connectSession("https://127.0.0.1:" + std::to_string(peerPort) + "/");
                Session* foreignSession = findSession(foreignId);
                check(foreignSession && foreignSession->conn, "the foreign-header fixture owns a real session");
                if (!foreignSession || !foreignSession->conn) continue;
                foreignSession->wtReady = true;
                foreignSession->connectStreamId = 0;
                g_streamReceiveConn = foreignSession->conn;
                const uint64_t streamId = isUni ? 3 : 1;
                auto signal = encodeVarint(isUni ? WT_STREAM_UNI_SIGNAL : WT_STREAM_BIDI_SIGNAL);
                g_streamReceiveQueues[streamId].push_back({{signal[0]}, false, 0});
                g_streamReceiveQueues[streamId].push_back({{}, false, QUICHE_ERR_DONE});
                std::vector<uint8_t> rest(signal.begin() + 1, signal.end());
                varintEncode(rest, 4);
                rest.insert(rest.end(), {'w','r','o','n','g'});
                g_streamReceiveQueues[streamId].push_back({rest, true, 0});
                pumpSocket(foreignSession);
                check(!foreignSession->failed && foreignSession->streams.count(streamId) == 1 &&
                          !foreignSession->streams.at(streamId).announced &&
                          foreignSession->streams.at(streamId).pending.size() == 1,
                      "a split WT signal stays pending without an incoming-stream announcement");
                pumpSocket(foreignSession);
                bool admittedForeign = false;
                for (auto pending = g_events; !pending.empty(); pending.pop()) {
                    const auto& event = pending.front();
                    if (event.sessionId == foreignId &&
                        (event.type == EventType::IncomingBidi || event.type == EventType::IncomingUni ||
                         event.type == EventType::StreamData)) admittedForeign = true;
                }
                check(foreignSession->failed && !admittedForeign,
                      "a completed foreign-session header fails before any application event");
                g_streamReceiveConn = nullptr;
                g_streamReceiveQueues.clear();
                processEvents();
                check(findSession(foreignId) == nullptr,
                      "a foreign-session protocol failure releases its native session");
            }

            // quiche's actual closed state is also an invalid write side.
            quiche_conn_close(session->conn, true, 0, nullptr, 0);
            check(streamWrite(sessionId, 32, &emptyMarker, 1, false) == -1,
                  "a write on a closed session is refused");
            // Simulate a peer that never finishes the QUIC close exchange.
            // Local close must release its session without that acknowledgment.
            g_forceNotClosedConn = session->conn;
            closeSession(sessionId, 0, "local close");
            processEvents();
            check(findSession(sessionId) == nullptr,
                  "local close releases the session without peer acknowledgment");
            g_forceNotClosedConn = nullptr;
        }
        g_streamSendSeamConn = nullptr;
        g_streamSendResults.clear();
        clearEvents();
        if (peerGuard != kInvalidSocket) closeSocket(peerGuard);
        shutdown();
    }

    // --- public lifecycle: idempotent init/shutdown, no sessions without a
    // connect, and processEvents() is safe with nothing to drive.
    check(!hasActiveSessions(), "no active sessions before any connect");
    init();
    init();
    processEvents();
    check(!hasActiveSessions(), "no active sessions after idle pump");

    // Test varintEncodeLength
    check(varintLength(0) == 1, "varintLength(0)");
    check(varintLength(63) == 1, "varintLength(63)");
    check(varintLength(64) == 2, "varintLength(64)");
    check(varintLength(16383) == 2, "varintLength(16383)");
    check(varintLength(16384) == 4, "varintLength(16384)");
    check(varintLength(0x3FFFFFFFull) == 4, "varintLength(0x3FFFFFFFull)");
    check(varintLength(0x40000000ull) == 8, "varintLength(0x40000000ull)");

    // Test classifyDatagramSend
    check(classifyDatagramSend(false, 200, 100) == kDatagramInvalidSession, "classifyDatagramSend invalid session");
    check(classifyDatagramSend(true, 200, 100) == kDatagramAccepted, "classifyDatagramSend accepted");
    check(classifyDatagramSend(true, 200, 300) == kDatagramTooLarge, "classifyDatagramSend too large");

    // Test parseUrl edge cases
    std::string testH, testP; int testPort = 0;
    check(parseUrl("https://example.com:443/test", testH, testPort, testP), "parseUrl valid");
    check(!parseUrl("http://example.com:443/test", testH, testPort, testP), "parseUrl not https");
    check(!parseUrl("https://example.com/no_port", testH, testPort, testP), "parseUrl no port");
    check(!parseUrl("https://example.com:abc/path", testH, testPort, testP), "parseUrl invalid port abc");
    check(!parseUrl("https://example.com:99999/path", testH, testPort, testP), "parseUrl port overflow");
    check(!parseUrl("https://[invalid_ipv6]:443/path", testH, testPort, testP), "parseUrl invalid ipv6 literal");
    check(parseUrl("https://[2001:db8::1]:4433/path", testH, testPort, testP), "parseUrl valid ipv6 literal");

    // Test DNS delay environment parsing
    setenv("MYSTRAL_WEBTRANSPORT_TEST_DNS_DELAY_MS", "50", 1);
    connectSession("https://127.0.0.1:4433/test_dns");
    setenv("MYSTRAL_WEBTRANSPORT_TEST_DNS_DELAY_MS", "invalid", 1);
    connectSession("https://127.0.0.1:4433/test_dns2");
    setenv("MYSTRAL_WEBTRANSPORT_TEST_DNS_DELAY_MS", "5000", 1);
    connectSession("https://127.0.0.1:4433/test_dns3");
    unsetenv("MYSTRAL_WEBTRANSPORT_TEST_DNS_DELAY_MS");

    // URL parsing and resolver test seams
    setResolverDelayForTesting(10);
    activeResolutionsForTesting();
    setResolverDelayForTesting(0);
    connectSession("https://[::1]:4433/ipv6_test");
    connectSession("https://localhost:4433/host_test");
    connectSession("http://not_https:4433/bad");
    connectSession("not_a_url");
    connectSession("https://" + std::string(260, 'x') + ":4433/too_long");

    // Invalid session query checks
    sendDatagram(9999, nullptr, 0);
    createStream(9999, true);
    createStream(9999, false);
    streamWrite(9999, 0, nullptr, 0, false);
    streamShutdown(9999, 0, 0);
    streamReadCredit(9999, 0, 100);
    streamReleaseRead(9999, 0);

    // Connect session to test socket and session operations
    uint32_t sessId = connectSession("https://127.0.0.1:4433/wt_test");
    if (sessId != 0) {
        check(hasActiveSessions(), "active session after connect");
        Session* requestSession = findSession(sessId);
        if (requestSession != nullptr && requestSession->conn != nullptr &&
            requestSession->h3config != nullptr) {
            requestSession->h3 =
                quiche_h3_conn_new_with_transport(requestSession->conn, requestSession->h3config);
            if (requestSession->h3 != nullptr) {
                requestSession->h3Created = true;
                sendConnectRequest(requestSession);
                check(requestSession->connectStreamId >= 0,
                      "a live h3 connection accepts the CONNECT request");

                std::string capacityError;
                setenv(kMaxDatagramEnv, "not-a-byte-count", 1);
                check(refreshDatagramCapacity(requestSession, &capacityError) ==
                          CapacityUpdate::Invalid && !capacityError.empty(),
                      "an invalid datagram clamp fails a live session closed");
                unsetenv(kMaxDatagramEnv);
                requestSession->failed = false;
                capacityError.clear();
                const CapacityUpdate capacity =
                    refreshDatagramCapacity(requestSession, &capacityError);
                check(capacity != CapacityUpdate::Invalid,
                      "a live session recomputes datagram capacity after the clamp is removed");
            }
        }
        uint8_t dgram[] = { 1, 2, 3 };
        sendDatagram(sessId, dgram, sizeof(dgram));
        int64_t bidiId = createStream(sessId, true);
        if (bidiId >= 0) {
            uint8_t sdata[] = { 'h', 'e', 'l', 'l', 'o' };
            streamWrite(sessId, static_cast<uint64_t>(bidiId), sdata, sizeof(sdata), false);
            streamShutdown(sessId, static_cast<uint64_t>(bidiId), 0);
        }
        int64_t uniId = createStream(sessId, false);
        if (uniId >= 0) {
            uint8_t sdata[] = { 'u', 'n', 'i' };
            streamWrite(sessId, static_cast<uint64_t>(uniId), sdata, sizeof(sdata), true);
            streamShutdown(sessId, static_cast<uint64_t>(uniId), 0);
        }
        processEvents();
        closeSession(sessId, 0, "normal close");
        processEvents();
    }

    shutdown();
    shutdown();
    check(!hasActiveSessions(), "no active sessions after shutdown");

    // Resolver controls are process-local and intentionally bypass getaddrinfo only for the
    // named test hostname. Exercise every validation branch and one real worker completion so
    // this contract proves the bounded resolver rather than only its numeric fast path.
    {
        Resolution options;
        options.host = "networking-test.invalid";
        options.port = 4433;
        setenv("MYSTRAL_WEBTRANSPORT_TEST_DNS_DELAY_MS", "12", 1);
        setenv("MYSTRAL_WEBTRANSPORT_TEST_DNS_ADDRESSES", "127.0.0.1,::1", 1);
        check(readResolverTestOptions(options) && options.delayMs == 12 &&
                  options.useTestAddresses && options.candidates.size() == 2,
              "resolver test controls accept bounded numeric addresses");

        Resolution badDelay;
        badDelay.host = options.host;
        badDelay.port = options.port;
        setenv("MYSTRAL_WEBTRANSPORT_TEST_DNS_DELAY_MS", "12x", 1);
        check(!readResolverTestOptions(badDelay), "resolver rejects a non-numeric delay");
        setenv("MYSTRAL_WEBTRANSPORT_TEST_DNS_DELAY_MS", "2001", 1);
        check(!readResolverTestOptions(badDelay), "resolver rejects an excessive delay");

        Resolution badAddress;
        badAddress.host = options.host;
        badAddress.port = options.port;
        setenv("MYSTRAL_WEBTRANSPORT_TEST_DNS_DELAY_MS", "0", 1);
        setenv("MYSTRAL_WEBTRANSPORT_TEST_DNS_ADDRESSES", "127.0.0.1,", 1);
        check(!readResolverTestOptions(badAddress), "resolver rejects an empty address entry");

        unsetenv("MYSTRAL_WEBTRANSPORT_TEST_DNS_DELAY_MS");
        unsetenv("MYSTRAL_WEBTRANSPORT_TEST_DNS_ADDRESSES");
        Resolution ordinary;
        ordinary.host = "example.com";
        ordinary.port = 443;
        check(readResolverTestOptions(ordinary) && ordinary.candidates.empty(),
              "ordinary hostnames do not consume the test-only resolver controls");

        ResolvedPeer ipv4;
        ResolvedPeer ipv6;
        check(numericPeer("127.0.0.1", 4433, ipv4) && ipv4.length == sizeof(sockaddr_in),
              "resolver recognizes IPv4 literals");
        check(numericPeer("::1", 4433, ipv6) && ipv6.length == sizeof(sockaddr_in6),
              "resolver recognizes IPv6 literals");
        check(!numericPeer("not-an-ip", 4433, ipv4), "resolver rejects non-numeric literals");
        const auto localhostAddresses = resolveAddresses("localhost", 4433);
        check(localhostAddresses.size() <= kResolverCandidateLimit,
              "resolver bounds ordinary hostname candidates");

        setenv("MYSTRAL_WEBTRANSPORT_TEST_DNS_DELAY_MS", "1", 1);
        setenv("MYSTRAL_WEBTRANSPORT_TEST_DNS_ADDRESSES", "127.0.0.1", 1);
        auto job = startResolution("networking-test.invalid", 4433);
        check(job != nullptr, "resolver admits a bounded test job");
        if (job != nullptr) {
            const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
            while (!job->done.load(std::memory_order_acquire) &&
                   std::chrono::steady_clock::now() < deadline) {
                std::this_thread::sleep_for(std::chrono::milliseconds(1));
            }
            check(job->done.load(std::memory_order_acquire) && job->candidates.size() == 1,
                  "resolver worker completes the bounded address fixture");
            cancelResolution(job);
        }
        unsetenv("MYSTRAL_WEBTRANSPORT_TEST_DNS_DELAY_MS");
        unsetenv("MYSTRAL_WEBTRANSPORT_TEST_DNS_ADDRESSES");
    }

    if (g_failures != 0) {
        std::fprintf(stderr, "webtransport wire contract: %d failure(s)\n", g_failures);
        return 1;
    }
    std::printf("webtransport wire contract passed\n");
    return 0;
}
