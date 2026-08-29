// Wire contract for the WebTransport client implementation's internal protocol
// helpers: RFC 9000 §16 varints, the stream-header state machine, URL parsing,
// and the environment flag reader. The helpers live in an anonymous namespace
// inside webtransport.cpp, so this test includes the translation unit
// textually — the assertions then attribute coverage to the real source lines
// and cannot drift to a copy. It links quiche (the included TU requires it)
// and must NOT link mystral-runtime, which already defines the same TU.

#include "../src/webtransport/webtransport.cpp"

// The impl's helpers are members of mystral::webtransport (the anonymous
// namespace nests inside it), and ::shutdown from <sys/socket.h> shares the
// name of the lifecycle call — the using-directive plus the arity-0 call site
// resolves every helper to the webtransport one.
using namespace mystral::webtransport;

#include <cstdint>
#include <cstdio>
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
