// Wire contract for the WebTransport client implementation's internal protocol
// helpers: RFC 9000 §16 varints, the stream-header state machine, URL parsing,
// and the environment flag reader. The helpers live in an anonymous namespace
// inside webtransport.cpp, so this test includes the translation unit
// textually — the assertions then attribute coverage to the real source lines
// and cannot drift to a copy. It links quiche (the included TU requires it)
// and must NOT link mystral-runtime, which already defines the same TU.

#include <quiche.h>

// Rename only the two quiche DATAGRAM calls in this test translation unit. The
// production source still calls the real API; these seams let the regression
// provide a deterministic receive backlog and a deterministic hard send error.
using RealDgramRecv = decltype(&quiche_conn_dgram_recv);
using RealDgramSend = decltype(&quiche_conn_dgram_send);
RealDgramRecv g_realDgramRecv = &quiche_conn_dgram_recv;
RealDgramSend g_realDgramSend = &quiche_conn_dgram_send;
ssize_t testQuicheConnDgramRecv(quiche_conn*, uint8_t*, size_t);
ssize_t testQuicheConnDgramSend(quiche_conn*, const uint8_t*, size_t);
#define quiche_conn_dgram_recv testQuicheConnDgramRecv
#define quiche_conn_dgram_send testQuicheConnDgramSend
#include "../src/webtransport/webtransport.cpp"
#undef quiche_conn_dgram_recv
#undef quiche_conn_dgram_send

// The impl's helpers are members of mystral::webtransport (the anonymous
// namespace nests inside it), and ::shutdown from <sys/socket.h> shares the
// name of the lifecycle call — the using-directive plus the arity-0 call site
// resolves every helper to the webtransport one.
using namespace mystral::webtransport;

#include <cstdint>
#include <cstdio>
#include <deque>
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

    // --- stream-header state machine. The Session* parameter is not touched
    // by the header logic, so nullptr documents exactly that. The signal
    // constants are 2-byte varints on the wire, so fixtures are built with
    // varintEncode rather than raw first bytes.
    {
        // Client-initiated bidirectional WT stream: signal + session id 7.
        std::vector<uint8_t> bidi = encodeVarint(WT_STREAM_BIDI_SIGNAL);
        bidi.push_back(0x07);
        bidi.push_back('x');
        StreamState st = makeStream(false, bidi);
        check(consumeStreamHeader(nullptr, 99, st), "bidi WT header consumed");
        check(st.headerConsumed && !st.isH3Owned && st.pending == std::vector<uint8_t>{'x'},
              "bidi WT header stripped, payload preserved");

        // Server-initiated unidirectional WT stream: signal + session id.
        std::vector<uint8_t> uni = encodeVarint(WT_STREAM_UNI_SIGNAL);
        uni.push_back(0x07);
        uni.push_back('h');
        uni.push_back('i');
        StreamState uniSt = makeStream(true, uni);
        check(consumeStreamHeader(nullptr, 99, uniSt), "uni WT header consumed");
        check(uniSt.headerConsumed && !uniSt.isH3Owned &&
                  uniSt.pending == std::vector<uint8_t>{'h', 'i'},
              "uni WT header stripped, payload preserved");

        // HTTP/3-owned unidirectional streams are drained and ignored.
        for (uint64_t type : {H3_CONTROL_STREAM_TYPE, H3_PUSH_STREAM_TYPE,
                              H3_QPACK_ENCODER_STREAM_TYPE, H3_QPACK_DECODER_STREAM_TYPE}) {
            StreamState h3 = makeStream(true, {static_cast<uint8_t>(type), 0xaa, 0xbb});
            check(consumeStreamHeader(nullptr, 99, h3), "h3-owned stream consumed");
            check(h3.isH3Owned && h3.headerConsumed && h3.pending.empty(),
                  "h3-owned stream drained");
        }

        // Unknown unidirectional stream type — ignored, not treated as WT.
        StreamState unknownUni = makeStream(true, {0x09, 0xaa});
        check(consumeStreamHeader(nullptr, 99, unknownUni), "unknown uni stream consumed");
        check(unknownUni.isH3Owned && unknownUni.headerConsumed && unknownUni.pending.empty(),
              "unknown uni stream drained");

        // Bidirectional stream without the WT signal — ignored.
        StreamState foreignBidi = makeStream(false, {0x00, 0xaa});
        check(consumeStreamHeader(nullptr, 99, foreignBidi), "non-WT bidi stream consumed");
        check(foreignBidi.isH3Owned && foreignBidi.headerConsumed, "non-WT bidi stream drained");

        // Truncated signal varint: need more bytes, nothing consumed.
        StreamState shortSignal = makeStream(true, {0x80, 0x00});  // declares 4 bytes, has 2
        check(!consumeStreamHeader(nullptr, 99, shortSignal), "truncated signal refused");
        check(!shortSignal.headerConsumed && shortSignal.pending.size() == 2,
              "truncated signal left pending untouched");

        // Signal present but session id truncated: need more bytes.
        std::vector<uint8_t> shortSessionBytes = encodeVarint(WT_STREAM_UNI_SIGNAL);
        shortSessionBytes.push_back(0x40);  // session id varint declares 2, none follow
        StreamState shortSession = makeStream(true, shortSessionBytes);
        check(!consumeStreamHeader(nullptr, 99, shortSession), "truncated session id refused");
        check(!shortSession.headerConsumed && shortSession.pending.size() == shortSessionBytes.size(),
              "truncated session id left pending untouched");

        // Idempotent: an already-consumed stream is a no-op even with no bytes.
        StreamState consumed = makeStream(false, {});
        consumed.headerConsumed = true;
        check(consumeStreamHeader(nullptr, 99, consumed), "already-consumed stream is a no-op");
    }

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

    // --- public lifecycle: idempotent init/shutdown, no sessions without a
    // connect, and processEvents() is safe with nothing to drive.
    check(!hasActiveSessions(), "no active sessions before any connect");
    init();
    init();
    processEvents();
    check(!hasActiveSessions(), "no active sessions after idle pump");
    shutdown();
    shutdown();
    check(!hasActiveSessions(), "no active sessions after shutdown");

    if (g_failures != 0) {
        std::fprintf(stderr, "webtransport wire contract: %d failure(s)\n", g_failures);
        return 1;
    }
    std::printf("webtransport wire contract passed\n");
    return 0;
}
