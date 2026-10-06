// tn-native-engine-player-v8 (PRD-531 phase 3): the native-engine desktop player with a game on V8.
// It links the V8 adapter, so it is a JS artifact and never an engine target; the JS-free player
// stays tn-native-engine-player. The window, loop, mailbox, render and screenshot path are the same
// `player::run`, so both players differ only in what builds the scene.
//
//   tn-native-engine-player-v8 <game.js>
//
// The host object a game bundle talks to (the minimal shape; the adapter installs the engine's
// classes as globals, so `THREE` is just the global object):
//
//   const THREE = globalThis;              // new THREE.Scene() is new Scene()
//   const scene = new THREE.Scene();
//   const camera = new THREE.PerspectiveCamera(50, 1280 / 720, 0.1, 200);
//   const player = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), new THREE.MeshStandardMaterial());
//   player.name = "player"; scene.add(player);
//   THREE.tn.scene = scene;                // the world the renderer draws and the endpoint samples
//   THREE.tn.camera = camera;              // the camera it draws it with
//   THREE.tn.onUpdate((dt) => {            // once per fixed tick; dt is the step in seconds
//     if (THREE.tn.input.isDown("w")) player.position.z -= 6 * dt;
//   });
//
// `tn.input.isDown(key)` is true while `key` is held; `key` is a DOM key ("w", "ArrowLeft", ...),
// the names the endpoint's injected input carries.
// `tn.children(object)` and `tn.traverse(object, callback, visibleOnly)` expose the native scene
// walk to the core import shim. They enumerate native objects; no JS scene graph is maintained.
#include <libplatform/libplatform.h>

#include <cstdint>
#include <cstdio>
#include <fstream>
#include <memory>
#include <set>
#include <sstream>
#include <string>
#include <vector>

#include "adapters/v8/adapter.h"
#include "engine/abi/abi_internal.h"
#include "engine/inspect/endpoint.h"
#include "engine/player/run.h"
#include "engine/scene/camera.h"
#include "engine/scene/nodes.h"

using namespace tn::engine;

namespace {

v8::Local<v8::String> v8str(v8::Isolate* isolate, const std::string& s) {
    return v8::String::NewFromUtf8(isolate, s.c_str(), v8::NewStringType::kNormal, static_cast<int>(s.size()))
        .ToLocalChecked();
}

// The host object, defined before the bundle so the bundle imports nothing. `isDown` reads the
// held-key set; `onUpdate`, `scene` and `camera` are plain JS properties the host reads.
constexpr const char* kPrelude = R"JS(
globalThis.tn = {
  __update: null,
  onUpdate(fn) { globalThis.tn.__update = fn; },
  input: { isDown(key) { return __tnIsDown(String(key)); } },
};
)JS";

void isDownCallback(const v8::FunctionCallbackInfo<v8::Value>& info) {
    auto* held = static_cast<std::set<std::string>*>(info.Data().As<v8::External>()->Value());
    v8::String::Utf8Value key(info.GetIsolate(), info[0]);
    const std::string name = *key ? *key : "";
    info.GetReturnValue().Set(held->count(name) != 0);
}

void sceneWalkCallback(const v8::FunctionCallbackInfo<v8::Value>& info) {
    auto& adapter = *static_cast<tn::adapters::v8adapter::Adapter*>(info.Data().As<v8::External>()->Value());
    auto* isolate = info.GetIsolate();
    const auto ctx = isolate->GetCurrentContext();
    tn_handle_t root{};
    if (!adapter.unwrap(info[0], root)) {
        isolate->ThrowException(v8::Exception::TypeError(v8str(isolate, "TN_CORE_SCENE: expected a native Object3D")));
        return;
    }
    auto* binding = tn::abi::objectOf(root);
    // Only scene classes carry the parent's member; reject math/material handles before casting.
    tn_value_t parent{};
    tn_diagnostic_t diagnostic{nullptr, 0};
    if (binding == nullptr || tn_get(root, "parent", &parent, &diagnostic) != TN_OK) {
        tn_diagnostic_release(&diagnostic);
        isolate->ThrowException(v8::Exception::TypeError(v8str(isolate, "TN_CORE_SCENE: expected a scene object")));
        return;
    }
    tn_diagnostic_release(&diagnostic);
    auto* object = static_cast<Object3D*>(binding->ptr.get());
    const bool walking = info.Length() > 1;
    if (walking && !info[1]->IsFunction()) {
        isolate->ThrowException(v8::Exception::TypeError(v8str(isolate, "TN_CORE_SCENE: expected a traversal callback")));
        return;
    }
    std::vector<Object3D*> objects;
    if (walking) {
        const auto collect = [](Object3D& child, void* out) {
            static_cast<std::vector<Object3D*>*>(out)->push_back(&child);
        };
        if (info[2]->IsTrue()) object->traverseVisible(collect, &objects);
        else object->traverse(collect, &objects);
    } else objects = object->children;
    auto array = v8::Array::New(isolate, static_cast<int>(objects.size()));
    // ponytail: O(n²) ID lookup for this tiny scene; add bulk reflection if traversal cost matters.
    for (size_t i = 0; i < objects.size(); ++i) {
        tn_value_t id{};
        id.kind = TN_VALUE_NUMBER;
        id.number = static_cast<double>(objects[i]->id());
        tn_value_t result{};
        if (tn_invoke(root, "getObjectById", &id, 1, &result, &diagnostic) != TN_OK || result.kind != TN_VALUE_HANDLE) {
            tn_diagnostic_release(&diagnostic);
            isolate->ThrowException(v8::Exception::Error(v8str(isolate, "TN_CORE_SCENE: child lookup failed")));
            return;
        }
        tn_diagnostic_release(&diagnostic);
        auto child = adapter.wrap(result.handle);
        if (!array->Set(ctx, static_cast<uint32_t>(i), child).FromMaybe(false)) return;
    }
    // Root every wrapper before callbacks: a callback may detach a later child from the scene.
    if (walking) {
        for (uint32_t i = 0; i < array->Length(); ++i) {
            v8::Local<v8::Value> child;
            if (!array->Get(ctx, i).ToLocal(&child)) return;
            v8::Local<v8::Value> ignored;
            if (!info[1].As<v8::Function>()->Call(ctx, info[0], 1, &child).ToLocal(&ignored)) return;
        }
    } else info.GetReturnValue().Set(array);
}

void logCallback(const v8::FunctionCallbackInfo<v8::Value>& info) {
    for (int i = 0; i < info.Length(); ++i) {
        v8::String::Utf8Value message(info.GetIsolate(), info[i]);
        std::printf("%s%s", i == 0 ? "" : " ", *message ? *message : "?");
    }
    std::printf("\n");
}

/** A game bundle on V8: the isolate, the adapter, the `tn` host object and the native world it built. */
class V8Game {
  public:
    bool start(const std::string& path, std::string& error);
    ~V8Game();

    void attach(inspect::Endpoint& endpoint) { endpoint_ = &endpoint; }
    void tick(double dt);
    void safePoint();
    json::Value resource(const std::string& id, uint64_t tick) const;

    Object3D* scene() const { return scene_; }
    Camera* camera() const { return camera_; }

  private:
    std::unique_ptr<v8::Platform> platform_;
    std::unique_ptr<v8::ArrayBuffer::Allocator> allocator_;
    v8::Isolate* isolate_ = nullptr;
    tn_context_t* context_ = nullptr;  // the engine's context (engine objects), not the JS one
    std::unique_ptr<tn::adapters::v8adapter::Adapter> adapter_;
    v8::Global<v8::Context> js_;
    v8::Global<v8::Function> update_;
    Object3D* scene_ = nullptr;
    Camera* camera_ = nullptr;
    // The host co-owns the world: the JS `tn.scene`/`tn.camera` is garbage after start(), and a
    // collected wrapper releases its handle, which must not free the scene under the frame loop.
    std::shared_ptr<void> sceneHold_, cameraHold_;
    std::set<std::string> held_;  // keys the game sees as held, filled from the endpoint each tick
    inspect::Endpoint* endpoint_ = nullptr;
};

bool V8Game::start(const std::string& path, std::string& error) {
    platform_ = v8::platform::NewDefaultPlatform();
    v8::V8::InitializePlatform(platform_.get());
    v8::V8::Initialize();
    allocator_.reset(v8::ArrayBuffer::Allocator::NewDefaultAllocator());
    v8::Isolate::CreateParams params;
    params.array_buffer_allocator = allocator_.get();
    isolate_ = v8::Isolate::New(params);

    const tn_version_info_t own = tn_engine_version();
    tn_diagnostic_t diagnostic{nullptr, 0};
    if (tn_context_create(&context_, &own, &diagnostic) != TN_OK)
        return error = "no engine context", false;

    v8::Isolate::Scope isolateScope(isolate_);
    v8::HandleScope scope(isolate_);
    adapter_ = std::make_unique<tn::adapters::v8adapter::Adapter>(isolate_, context_);
    v8::Local<v8::Context> ctx = v8::Context::New(isolate_);
    js_.Reset(isolate_, ctx);
    v8::Context::Scope contextScope(ctx);
    adapter_->install(ctx, ctx->Global());

    v8::Local<v8::External> held = v8::External::New(isolate_, &held_);
    ctx->Global()
        ->Set(ctx, v8str(isolate_, "__tnIsDown"), v8::Function::New(ctx, &isDownCallback, held).ToLocalChecked())
        .Check();

    std::ifstream file(path);
    if (!file)
        return error = "cannot read " + path, false;
    std::stringstream source;
    source << file.rdbuf();

    v8::TryCatch tryCatch(isolate_);
    v8::Local<v8::Script> prelude;
    v8::Local<v8::Value> ignored;
    if (!v8::Script::Compile(ctx, v8str(isolate_, kPrelude)).ToLocal(&prelude) || !prelude->Run(ctx).ToLocal(&ignored))
        return error = "host prelude failed", false;
    const auto host = ctx->Global()->Get(ctx, v8str(isolate_, "tn")).ToLocalChecked().As<v8::Object>();
    const auto sceneWalk = v8::Function::New(ctx, &sceneWalkCallback, v8::External::New(isolate_, adapter_.get())).ToLocalChecked();
    host->Set(ctx, v8str(isolate_, "children"), sceneWalk).Check();
    host->Set(ctx, v8str(isolate_, "traverse"), sceneWalk).Check();
    host->Set(ctx, v8str(isolate_, "log"), v8::Function::New(ctx, &logCallback).ToLocalChecked()).Check();
    v8::Local<v8::Script> script;
    if (!v8::Script::Compile(ctx, v8str(isolate_, source.str())).ToLocal(&script) || !script->Run(ctx).ToLocal(&ignored)) {
        v8::String::Utf8Value message(isolate_, tryCatch.Exception());
        return error = std::string("the game bundle failed: ") + (*message ? *message : "?"), false;
    }
    isolate_->PerformMicrotaskCheckpoint();
    v8::Local<v8::Value> startupError;
    if (host->Get(ctx, v8str(isolate_, "__startupError")).ToLocal(&startupError) && !startupError->IsUndefined()) {
        v8::String::Utf8Value message(isolate_, startupError);
        return error = std::string("core startup failed: ") + (*message ? *message : "?"), false;
    }

    v8::Local<v8::Value> tnValue;
    if (!ctx->Global()->Get(ctx, v8str(isolate_, "tn")).ToLocal(&tnValue) || !tnValue->IsObject())
        return error = "the game bundle left no `tn` host object", false;
    v8::Local<v8::Object> tn = tnValue.As<v8::Object>();
    const auto binding = [&](const char* field, tn::binding::Object*& out) {
        v8::Local<v8::Value> value;
        tn_handle_t handle{};
        if (!tn->Get(ctx, v8str(isolate_, field)).ToLocal(&value) || !adapter_->unwrap(value, handle))
            return false;
        out = tn::abi::objectOf(handle);
        return out != nullptr;
    };
    tn::binding::Object* scene = nullptr;
    tn::binding::Object* camera = nullptr;
    if (!binding("scene", scene) || scene->cls != "Scene")
        return error = "tn.scene is not a Scene", false;
    if (!binding("camera", camera) || (camera->cls != "PerspectiveCamera" && camera->cls != "OrthographicCamera"))
        return error = "tn.camera is not a camera", false;
    v8::Local<v8::Value> update;
    if (!tn->Get(ctx, v8str(isolate_, "__update")).ToLocal(&update) || !update->IsFunction())
        return error = "the game bundle registered no tn.onUpdate(fn)", false;
    update_.Reset(isolate_, update.As<v8::Function>());

    sceneHold_ = scene->ptr;
    cameraHold_ = camera->ptr;
    scene_ = static_cast<Scene*>(scene->ptr.get());
    camera_ = camera->cls == "PerspectiveCamera"
                  ? static_cast<Camera*>(static_cast<PerspectiveCamera*>(camera->ptr.get()))
                  : static_cast<Camera*>(static_cast<OrthographicCamera*>(camera->ptr.get()));
    return true;
}

V8Game::~V8Game() {
    if (isolate_ == nullptr)
        return;
    {
        v8::Isolate::Scope isolateScope(isolate_);
        v8::HandleScope scope(isolate_);
        // The adapter and the module-level globals die with the isolate; the engine context keeps
        // its own objects until it is released below.
        update_.Reset();
        js_.Reset();
        adapter_.reset();
    }
    if (context_ != nullptr) {
        tn_diagnostic_t diagnostic{nullptr, 0};
        tn_context_destroy(context_, &diagnostic);
        tn_diagnostic_release(&diagnostic);
    }
    isolate_->Dispose();
}

void V8Game::tick(double dt) {
    v8::Isolate::Scope isolateScope(isolate_);
    v8::HandleScope scope(isolate_);
    v8::Local<v8::Context> ctx = js_.Get(isolate_);
    v8::Context::Scope contextScope(ctx);
    if (endpoint_ != nullptr) {
        // The tick boundary: input queued since the last tick is applied to the key set before the
        // game's update reads it, so input injected for tick N is seen by tick N.
        for (const inspect::InputEvent& event : endpoint_->takeInput()) {
            if (event.type == "keydown")
                held_.insert(event.key);
            else if (event.type == "keyup")
                held_.erase(event.key);
        }
    }
    v8::TryCatch tryCatch(isolate_);
    v8::Local<v8::Value> argument = v8::Number::New(isolate_, dt);
    v8::Local<v8::Value> ignored;
    if (!update_.Get(isolate_)->Call(ctx, ctx->Global(), 1, &argument).ToLocal(&ignored)) {
        v8::String::Utf8Value message(isolate_, tryCatch.Exception());
        std::printf("[Playtest] TN_V8_UPDATE_FAILED: %s\n", *message ? *message : "the update threw");
    }
}

void V8Game::safePoint() {
    v8::Isolate::Scope isolateScope(isolate_);
    v8::HandleScope scope(isolate_);
    adapter_->collect();
}

json::Value V8Game::resource(const std::string& id, uint64_t tick) const {
    if (id == "state" && scene_ != nullptr) {
        const Object3D* player = scene_->getObjectByName("player");
        if (player != nullptr) {
            const Vector3 at = player->position;
            return json::Value::makeObject({{"playerX", json::Value::makeNumber(at.x)},
                                            {"playerY", json::Value::makeNumber(at.y)},
                                            {"playerZ", json::Value::makeNumber(at.z)},
                                            {"tick", json::Value::makeNumber(double(tick))}});
        }
    }
    return json::Value::makeNull();
}

}  // namespace

int main(int argc, char** argv) {
    std::string gamePath;
    for (int i = 1; i < argc; ++i) {
        const std::string argument = argv[i];
        if ((argument == "--game" || argument == "--bundle") && i + 1 < argc)
            gamePath = argv[++i];
        else if (argument.rfind("--", 0) != 0)
            gamePath = argument;
        else
            return std::fprintf(stderr, "TN_PLAYER_V8_ARGS: unknown argument %s\n", argument.c_str()), 2;
    }
    if (gamePath.empty())
        return std::fprintf(stderr, "TN_PLAYER_V8_ARGS: a game bundle path is required\n"), 2;

    V8Game game;
    std::string error;
    if (!game.start(gamePath, error))
        return std::fprintf(stderr, "TN_PLAYER_V8_GAME: %s\n", error.c_str()), 1;

    player::Game configured;
    configured.name = "game-v8-demo";
    configured.scene = game.scene();
    configured.camera = game.camera();
    configured.gameRuntime = "v8";
    configured.update = [&game](double dt) { game.tick(dt); };
    configured.resource = [&game](const std::string& id, uint64_t tick) { return game.resource(id, tick); };
    configured.afterRender = [&game] { game.safePoint(); };
    configured.attach = [&game](inspect::Endpoint& endpoint) { game.attach(endpoint); };
    return player::run(configured);
}
