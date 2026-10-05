#include "adapters/v8/adapter.h"
#include "check.h"

#include <libplatform/libplatform.h>

#include <cstdio>
#include <memory>
#include <string>

using tn::adapters::v8adapter::Adapter;

namespace {

struct Runtime {
    std::unique_ptr<v8::Platform> platform;
    v8::Isolate* isolate = nullptr;
    v8::ArrayBuffer::Allocator* allocator = nullptr;
    tn_context_t* context = nullptr;
    Runtime() {
        v8::V8::SetFlagsFromString("--expose-gc");
        platform = v8::platform::NewDefaultPlatform();
        v8::V8::InitializePlatform(platform.get());
        v8::V8::Initialize();
        allocator = v8::ArrayBuffer::Allocator::NewDefaultAllocator();
        v8::Isolate::CreateParams params;
        params.array_buffer_allocator = allocator;
        isolate = v8::Isolate::New(params);
        const tn_version_info_t own = tn_engine_version();
        tn_diagnostic_t d{nullptr, 0};
        tn_context_create(&context, &own, &d);
    }
    ~Runtime() {
        isolate->Dispose();
        tn_diagnostic_t d{nullptr, 0};
        tn_context_destroy(context, &d);
        delete allocator;
        v8::V8::Dispose();
        v8::V8::DisposePlatform();
    }
};

// Runs a script in a fresh context with the engine installed; returns the script's string result.
std::string run(Runtime& rt, Adapter& adapter, const char* source) {
    v8::HandleScope scope(rt.isolate);
    v8::Local<v8::Context> ctx = v8::Context::New(rt.isolate);
    v8::Context::Scope contextScope(ctx);
    adapter.install(ctx, ctx->Global());
    v8::TryCatch tryCatch(rt.isolate);
    v8::Local<v8::String> code = v8::String::NewFromUtf8(rt.isolate, source).ToLocalChecked();
    v8::Local<v8::Script> script;
    v8::Local<v8::Value> result;
    if (!v8::Script::Compile(ctx, code).ToLocal(&script) || !script->Run(ctx).ToLocal(&result)) {
        v8::String::Utf8Value error(rt.isolate, tryCatch.Exception());
        return std::string("THROWN ") + (*error ? *error : "?");
    }
    v8::String::Utf8Value text(rt.isolate, result);
    return *text ? *text : "";
}

Runtime& runtime() {
    static Runtime rt;
    return rt;
}

void handles() {
    Runtime& rt = runtime();
    v8::Isolate::Scope isolateScope(rt.isolate);
    Adapter adapter(rt.isolate, rt.context);
    const std::string got = run(rt, adapter, R"JS(
        const v = new Vector3(1, 2, 3);
        const m = new Matrix4();
        const checks = [
            m.makeTranslation(10, 0, -5) === m,       // chaining returns the same wrapper
            v.applyMatrix4(m) === v,
            v.x === 11 && v.y === 2 && v.z === -2,
            m.elements[12] === 10 && m.elements.length === 16,
            v.clone() !== v && v.clone().x === 11,
            (v.y = 7, v.y === 7),
            v instanceof Vector3,
        ];
        checks.map(Number).join("")
    )JS");
    CHECK(got == "1111111");
    if (got != "1111111") std::fprintf(stderr, "got %s\n", got.c_str());

    // Handles cross into JS and back with every bit, through the wrapper, never as a JS number.
    v8::HandleScope scope(rt.isolate);
    v8::Local<v8::Context> ctx = v8::Context::New(rt.isolate);
    v8::Context::Scope contextScope(ctx);
    adapter.install(ctx, ctx->Global());
    for (int i = 0; i < 2000; ++i) {
        tn_handle_t h{};
        tn_diagnostic_t d{nullptr, 0};
        CHECK(tn_construct(rt.context, "Quaternion", nullptr, 0, &h, &d) == TN_OK);
        if (i % 3 == 0) {  // churn the slots so generations climb
            tn_object_release(h, &d);
            CHECK(tn_construct(rt.context, "Quaternion", nullptr, 0, &h, &d) == TN_OK);
        }
        v8::Local<v8::Value> wrapped = adapter.wrap(h);
        ctx->Global()->Set(ctx, v8::String::NewFromUtf8Literal(rt.isolate, "held"), wrapped).Check();
        v8::Local<v8::Value> back = ctx->Global()->Get(ctx, v8::String::NewFromUtf8Literal(rt.isolate, "held")).ToLocalChecked();
        tn_handle_t out{};
        CHECK(adapter.unwrap(back, out));
        CHECK(out.type == h.type && out.context == h.context && out.index == h.index && out.generation == h.generation);
        CHECK(adapter.wrap(h) == wrapped);  // one wrapper per handle
    }
}

void unsupported() {
    Runtime& rt = runtime();
    v8::Isolate::Scope isolateScope(rt.isolate);
    Adapter adapter(rt.isolate, rt.context);
    CHECK(run(rt, adapter, "typeof new Vector3().teleport") == "undefined");
    const std::string thrown = run(rt, adapter, "const v = new Vector3(); v.applyMatrix4(v)");
    CHECK(thrown.rfind("THROWN TypeError: TN_NATIVE_UNSUPPORTED", 0) == 0);
    if (thrown.rfind("THROWN TypeError: TN_NATIVE_UNSUPPORTED", 0) != 0) std::fprintf(stderr, "%s\n", thrown.c_str());
    CHECK(run(rt, adapter, "Vector3(1,2,3)").rfind("THROWN TypeError", 0) == 0);  // not a construct call
}

void gcRelease() {
    Runtime& rt = runtime();
    v8::Isolate::Scope isolateScope(rt.isolate);
    Adapter adapter(rt.isolate, rt.context);
    tn_handle_t first{};
    {
        v8::HandleScope scope(rt.isolate);
        v8::Local<v8::Context> ctx = v8::Context::New(rt.isolate);
        v8::Context::Scope contextScope(ctx);
        adapter.install(ctx, ctx->Global());
        v8::Local<v8::Value> v =
            v8::Script::Compile(ctx, v8::String::NewFromUtf8Literal(rt.isolate,
                "for (let i = 0; i < 5000; i++) new Vector3(i, i, i); new Vector3(1, 2, 3)"))
                .ToLocalChecked()->Run(ctx).ToLocalChecked();
        CHECK(adapter.unwrap(v, first));
        CHECK(adapter.liveWrappers() > 0);
    }
    for (int i = 0; i < 4; ++i) rt.isolate->LowMemoryNotification();
    // Unreachable wrappers were collected, and each released its native object.
    CHECK(adapter.liveWrappers() < 100);
    tn_value_t result{};
    tn_diagnostic_t d{nullptr, 0};
    CHECK(tn_get(first, "x", &result, &d) == TN_ERROR_INVALID_HANDLE);
    tn_diagnostic_release(&d);
}

long residentKb() {
    std::FILE* f = std::fopen("/proc/self/statm", "r");
    long pages = 0, resident = 0;
    if (f) {
        if (std::fscanf(f, "%ld %ld", &pages, &resident) != 2) resident = 0;
        std::fclose(f);
    }
    return resident * 4;
}

// Whole runtimes created and destroyed repeatedly leave no native objects and no memory growth.
void runtimeChurn() {
    Runtime& rt = runtime();  // V8 is initialized once per process; isolates come and go below
    long afterWarmup = 0;
    for (int cycle = 0; cycle < 50; ++cycle) {
        v8::Isolate::CreateParams params;
        params.array_buffer_allocator = rt.allocator;
        v8::Isolate* isolate = v8::Isolate::New(params);
        tn_context_t* context = nullptr;
        const tn_version_info_t own = tn_engine_version();
        tn_diagnostic_t d{nullptr, 0};
        CHECK(tn_context_create(&context, &own, &d) == TN_OK);
        tn_handle_t probe{};
        {
            v8::Isolate::Scope isolateScope(isolate);
            Adapter adapter(isolate, context);
            v8::HandleScope scope(isolate);
            v8::Local<v8::Context> ctx = v8::Context::New(isolate);
            v8::Context::Scope contextScope(ctx);
            adapter.install(ctx, ctx->Global());
            v8::Script::Compile(ctx, v8::String::NewFromUtf8Literal(isolate,
                "const keep = []; for (let i = 0; i < 10000; i++) keep.push(new Vector3(i, 0, 0).clone()); keep.length"))
                .ToLocalChecked()->Run(ctx).ToLocalChecked();
            CHECK(tn_construct(context, "Vector3", nullptr, 0, &probe, &d) == TN_OK);
        }
        isolate->Dispose();
        CHECK(tn_context_destroy(context, &d) == TN_OK);
        // The context is gone and took every object with it: its handles resolve to nothing.
        tn_value_t result{};
        CHECK(tn_get(probe, "x", &result, &d) == TN_ERROR_INVALID_HANDLE);
        tn_diagnostic_release(&d);
        if (cycle == 9) afterWarmup = residentKb();
    }
    const long growthKb = residentKb() - afterWarmup;
    std::printf("runtime churn: 40 cycles after warm-up, resident growth %ld KiB\n", growthKb);
    CHECK(growthKb < 16 * 1024);  // 40 cycles x 20,000 objects; a per-cycle leak would show here
}

// Reports the per-call cost of one property write and one method call through the adapter
// (PRD-531 phase 3). CP1 reads these to decide whether bulk paths are needed (decision 9).
void crossingBench() {
    Runtime& rt = runtime();
    v8::Isolate::Scope isolateScope(rt.isolate);
    Adapter adapter(rt.isolate, rt.context);
    const std::string got = run(rt, adapter, R"JS(
        const v = new Vector3(), w = new Vector3(1, 2, 3);
        const N = 1000000;
        for (let i = 0; i < 100000; i++) { v.x = i; v.add(w); }      // warm-up: let the JIT settle
        let t0 = Date.now();
        for (let i = 0; i < N; i++) v.x = i;
        const write = (Date.now() - t0) * 1e6 / N;
        t0 = Date.now();
        for (let i = 0; i < N; i++) v.add(w);
        const call = (Date.now() - t0) * 1e6 / N;
        t0 = Date.now();
        let s = 0;
        for (let i = 0; i < N; i++) s += v.x;
        const read = (Date.now() - t0) * 1e6 / N;
        `write ${write.toFixed(1)} ns, call ${call.toFixed(1)} ns, read ${read.toFixed(1)} ns`
    )JS");
    std::printf("TN_V8_CROSSING %s (V8 13.1 -> C ABI -> binding registry)\n", got.c_str());
    CHECK(got.rfind("write ", 0) == 0);
}

// The scene graph through V8: member objects are properties, `mesh.position` is the same wrapper on
// every read, writes through it reach the native object, and the transform matches three's.
void scene() {
    Runtime& rt = runtime();
    v8::Isolate::Scope isolateScope(rt.isolate);
    Adapter adapter(rt.isolate, rt.context);
    const std::string got = run(rt, adapter, R"JS(
        const parent = new Object3D(), child = new Object3D();
        parent.add(child);
        const p = child.position;
        p.x = 2;
        parent.position.y = 3;
        parent.updateMatrixWorld(true);
        const e = child.matrixWorld.elements;
        const checks = [
            child.position === p,
            child.position.x === 2,
            e[12] === 2 && e[13] === 3 && e[14] === 0,
            child.matrixWorld === child.matrixWorld,
        ];
        checks.map(Number).join("")
    )JS");
    CHECK(got == "1111");
    if (got != "1111") std::fprintf(stderr, "got %s\n", got.c_str());
}

}  // namespace

TN_TEST_MAIN({"handles", handles}, {"unsupported", unsupported}, {"gc_release", gcRelease},
             {"runtime_churn", runtimeChurn},
             {"crossing_bench", crossingBench},
             {"scene", scene})
