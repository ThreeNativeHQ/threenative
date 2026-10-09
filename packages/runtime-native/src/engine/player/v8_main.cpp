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

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <cmath>
#include <map>
#include <optional>
#include <filesystem>
#include <cstdlib>
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
#include "engine/scene/material.h"
#include "engine/scene/texture.h"
#include "engine/assets/package.h"
#include "engine/assets/gltf/loader.h"
#include "engine/assets/gltf/image_decode.h"
#include "engine/renderer/renderer.h"
#include "engine/renderer/render_database.h"
#include "mystral/webgpu_compat.h"
#include "adapters/v8/tsl.h"
#include "engine/shader/graph/serialized.h"
#include "mystral/audio/audio_bindings.h"
#include "mystral/js/engine.h"
#include "mystral/physics/native_bindings.h"

namespace mystral::js { std::unique_ptr<Engine> createV8Engine(); }

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
    void initialize(Renderer& renderer);
    bool observe(const std::string& method, const json::Value* argument, json::Value& result, std::string& error);
    json::Value resource(const std::string& id, uint64_t tick) const;

    /** Binds the scene and camera the game last published (`tn.scene`/`tn.camera`): 1 bound, 0 not
     *  published yet (an async boot still loading), -1 a startup error or a value of the wrong kind. */
    int view(std::string& error);
    Object3D* scene() const { return scene_; }
    Camera* camera() const { return camera_; }
    bool shadowMapEnabled() const { return shadowMap_; }
    int shadowMapType() const { return shadowMapType_; }

  private:
    std::unique_ptr<mystral::js::Engine> services_;
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
    std::string assetPath_;
    std::vector<uint8_t> assetBytes_;
    assets::Package assets_;
    shader::graph::Node post_;
    Renderer* renderer_ = nullptr;
    // three's renderer settings the game last set (WebGPURenderer's defaults until it does).
    OutputState output_{std::nullopt, 1, true};
    // The GPU adapter's `info` fields, read before the bundle boots; empty without a GPU (a check).
    std::vector<std::pair<std::string, std::string>> adapterInfo_;
    // The last frame the player drew: three's `renderer.info.render` draw calls and triangles.
    uint32_t drawCalls_ = 0;
    uint64_t triangles_ = 0;
    bool shadowMap_ = false;  // three's WebGPURenderer defaults: shadowMap off, PCFShadowMap
    int shadowMapType_ = 1;
    bool outputChanged_ = true;
    static void loadAsset(const v8::FunctionCallbackInfo<v8::Value>& info);
    static void setRendererState(const v8::FunctionCallbackInfo<v8::Value>& info);
    static void requestAdapter(const v8::FunctionCallbackInfo<v8::Value>& info);
    static void renderInfo(const v8::FunctionCallbackInfo<v8::Value>& info);
    v8::Local<v8::Value> adapterValue();
  public:
    void setAdapter(std::vector<std::pair<std::string, std::string>> info) { adapterInfo_ = std::move(info); }
    void frameDrawn(const Renderer& renderer) {
        drawCalls_ = renderer.lastFrame().draws;
        triangles_ = renderer.lastFrame().triangles;
    }
    void beforeRender(Renderer& renderer, RenderDatabase& database) {
        if (outputChanged_) renderer.setOutput(output_);
        outputChanged_ = false;
        database.shadowMapEnabled = shadowMap_;
        database.shadowMapType = shadowMapType_;
    }
  private:
    static void setPost(const v8::FunctionCallbackInfo<v8::Value>& info);
    static void decodeImage(const v8::FunctionCallbackInfo<v8::Value>& info);
};

void V8Game::loadAsset(const v8::FunctionCallbackInfo<v8::Value>& info) {
    auto& game = *static_cast<V8Game*>(info.Data().As<v8::External>()->Value());
    auto* isolate = info.GetIsolate();
    auto ctx = isolate->GetCurrentContext();
    const auto refuse = [&](const std::string& reason) {
        isolate->ThrowException(v8::Exception::Error(v8str(isolate, reason)));
    };
    if (info.Length() != 2 || !info[0]->IsString() || !info[1]->IsString())
        return refuse("TN_NATIVE_ASSET_INVALID: expected kind and logical path strings");
    v8::String::Utf8Value kindValue(isolate, info[0]), pathValue(isolate, info[1]);
    const std::string kind(*kindValue, kindValue.length()), path(*pathValue, pathValue.length());
    if (kind != "model" && kind != "texture" && kind != "audio" && kind != "buffer")
        return refuse("TN_NATIVE_ASSET_KIND_UNSUPPORTED: " + kind);
    if (game.assetBytes_.empty()) {
        std::ifstream file(game.assetPath_, std::ios::binary | std::ios::ate);
        const auto size = file.tellg();
        if (!file || size <= 0 || size > 512 * 1024 * 1024)
            return refuse("TN_NATIVE_ASSET_PACKAGE_MISSING: " + game.assetPath_);
        std::vector<uint8_t> bytes(static_cast<size_t>(size));
        file.seekg(0);
        if (!file.read(reinterpret_cast<char*>(bytes.data()), size))
            return refuse("TN_NATIVE_ASSET_PACKAGE_READ: " + game.assetPath_);
        assets::Package package;
        assets::PackageError error;
        if (!assets::parsePackage(bytes, package, error) ||
            !assets::verifyPackage(package, assets::targetDecoders(), error))
            return refuse(error.code + ": " + error.detail);
        game.assetBytes_ = std::move(bytes);
        game.assets_ = std::move(package);
        game.assets_.bytes = game.assetBytes_;
    }
    const assets::PackageEntry* entry = nullptr;
    for (const auto& candidate : game.assets_.entries)
        if (candidate.name == path) { entry = &candidate; break; }
    // As on the web, a relative path the cook does not name is a web-root URL: the package names
    // hand-placed web-root files `/` plus their path there (packages/assets nativePackageEntries).
    for (const auto& candidate : game.assets_.entries)
        if (!entry && !path.empty() && path[0] != '/' && candidate.name == "/" + path) entry = &candidate;
    if (!entry) return refuse("TN_NATIVE_ASSET_MISSING: " + path + " in " + game.assetPath_);
    auto data = game.assets_.data(*entry);
    v8::Local<v8::Value> value;
    if (kind == "model") {
#if TN_PLAYER_NATIVE_GLTF
        if (entry->kind != static_cast<uint16_t>(assets::EntryKind::Scene))
            return refuse("TN_NATIVE_ASSET_KIND_MISMATCH: model requires a Scene entry: " + path);
        auto loaded = gltf::load(data);
        if (!loaded.error.empty()) return refuse(loaded.error);
        bool undecoded = false;
        loaded.scene->traverse([](Object3D& object, void* result) {
            auto* mesh = dynamic_cast<Mesh*>(&object);
            if (!mesh || !mesh->material) return;
            for (const auto& [slot, map] : mesh->material->maps)
                if (map && !map->hasImage()) *static_cast<bool*>(result) = true;
        }, &undecoded);
        if (undecoded) return refuse("TN_NATIVE_GLTF_IMAGE_UNSUPPORTED: model has undecoded images: " + path);
        auto model = v8::Object::New(isolate);
        model->Set(ctx, v8str(isolate, "scene"), game.adapter_->wrap(
            tn::abi::shareObject(game.context_, "Group", loaded.scene))).Check();
        auto clips = v8::Array::New(isolate, static_cast<int>(loaded.animations.size()));
        for (uint32_t i = 0; i < loaded.animations.size(); ++i)
            clips->Set(ctx, i, game.adapter_->wrap(tn::abi::shareObject(
                game.context_, "AnimationClip", loaded.animations[i]))).Check();
        model->Set(ctx, v8str(isolate, "animations"), clips).Check();
        value = model;
#else
        return refuse("TN_NATIVE_GLTF_UNAVAILABLE: this player was built without cgltf");
#endif
    } else if (kind == "audio") {
        // The cooked package carries audio as its encoded bytes; WebAudio's decodeAudioData decodes them.
        if (entry->kind != static_cast<uint16_t>(assets::EntryKind::Buffer))
            return refuse("TN_NATIVE_ASSET_KIND_MISMATCH: audio requires a Buffer entry: " + path);
        auto bytes = v8::ArrayBuffer::New(isolate, data.size());
        std::copy(data.begin(), data.end(), static_cast<uint8_t*>(bytes->Data()));
        value = bytes;
    } else if (kind == "buffer") {
        // Raw bytes a JS decoder parses (an HDRLoader's .hdr), copied out of the package.
        if (entry->kind != static_cast<uint16_t>(assets::EntryKind::Buffer))
            return refuse("TN_NATIVE_ASSET_KIND_MISMATCH: buffer requires a Buffer entry: " + path);
        auto buffer = v8::ArrayBuffer::New(isolate, data.size());
        if (!data.empty()) std::memcpy(buffer->Data(), data.data(), data.size());
        value = buffer;
    } else {
        if (entry->kind != static_cast<uint16_t>(assets::EntryKind::Texture) || data.size() < 12)
            return refuse("TN_NATIVE_ASSET_KIND_MISMATCH: texture requires an RGBA8 Texture entry: " + path);
        const auto u32 = [&](size_t at) { return uint32_t(data[at]) | (uint32_t(data[at+1]) << 8) |
            (uint32_t(data[at+2]) << 16) | (uint32_t(data[at+3]) << 24); };
        const uint32_t width = u32(0), height = u32(4), format = u32(8);
        if (!width || !height || uint64_t(width) * height > (data.size() - 12) / 4 ||
            uint64_t(width) * height * 4 != data.size() - 12 ||
            (format != 18 && format != 19 && format != 22 && format != 23))
            return refuse("TN_NATIVE_ASSET_TEXTURE_INVALID: " + path);
        auto texture = std::make_shared<Texture>();
        texture->name = path;
        texture->width = width; texture->height = height;
        texture->colorSpace = format == 19 || format == 23 ? TextureColorSpace::SRGB : TextureColorSpace::None;
        texture->data.assign(data.begin() + 12, data.end());
        texture->needsUpdate();
        value = game.adapter_->wrap(tn::abi::shareObject(game.context_, "Texture", texture));
    }
    auto record = v8::Object::New(isolate);
    record->Set(ctx, v8str(isolate, "value"), value).Check();
    record->Set(ctx, v8str(isolate, "bytes"), v8::Number::New(isolate, static_cast<double>(entry->size))).Check();
    record->Set(ctx, v8str(isolate, "url"), v8str(isolate, game.assetPath_ + "#" + path)).Check();
    info.GetReturnValue().Set(record);
}

// `tn.setRendererState({toneMapping, toneMappingExposure, outputColorSpace, shadowMap: {enabled, type}})`:
// the facade's WebGPURenderer settings, applied before the next frame. A value the native renderer
// does not implement is refused by name, never mapped to a neighbour.
void V8Game::setRendererState(const v8::FunctionCallbackInfo<v8::Value>& info) {
    auto& game = *static_cast<V8Game*>(info.Data().As<v8::External>()->Value());
    auto* isolate = info.GetIsolate();
    const auto ctx = isolate->GetCurrentContext();
    const auto refuse = [&](const std::string& reason) {
        isolate->ThrowException(v8::Exception::TypeError(v8str(isolate, "TN_NATIVE_RENDERER_STATE: " + reason)));
    };
    if (info.Length() != 1 || !info[0]->IsObject()) return refuse("expected one settings object");
    const auto settings = info[0].As<v8::Object>();
    v8::Local<v8::Value> mapping, exposure, colorSpace, shadowMap, enabled, type;
    if (!settings->Get(ctx, v8str(isolate, "toneMapping")).ToLocal(&mapping) ||
        !settings->Get(ctx, v8str(isolate, "toneMappingExposure")).ToLocal(&exposure) ||
        !settings->Get(ctx, v8str(isolate, "outputColorSpace")).ToLocal(&colorSpace) ||
        !settings->Get(ctx, v8str(isolate, "shadowMap")).ToLocal(&shadowMap))
        return;
    if (!mapping->IsNumber() || !exposure->IsNumber() || !std::isfinite(exposure.As<v8::Number>()->Value()) ||
        !colorSpace->IsString() || !shadowMap->IsObject())
        return refuse("toneMapping, toneMappingExposure, outputColorSpace and shadowMap are required");
    if (!shadowMap.As<v8::Object>()->Get(ctx, v8str(isolate, "enabled")).ToLocal(&enabled) ||
        !shadowMap.As<v8::Object>()->Get(ctx, v8str(isolate, "type")).ToLocal(&type))
        return;
    // three's constants: NoToneMapping 0, Linear 1, Reinhard 2, Cineon 3, ACESFilmic 4, AgX 6, Neutral 7.
    static const std::map<double, std::optional<shader::ToneMapping>> mappings{
        {0, std::nullopt}, {1, shader::ToneMapping::Linear}, {2, shader::ToneMapping::Reinhard},
        {3, shader::ToneMapping::Cineon}, {4, shader::ToneMapping::ACESFilmic}, {6, shader::ToneMapping::AgX},
        {7, shader::ToneMapping::Neutral}};
    const auto tone = mappings.find(mapping.As<v8::Number>()->Value());
    if (tone == mappings.end()) return refuse("toneMapping " + std::to_string(mapping.As<v8::Number>()->Value()));
    v8::String::Utf8Value space(isolate, colorSpace);
    const std::string spaceText(*space, space.length());
    if (spaceText != "srgb" && spaceText != "srgb-linear") return refuse("outputColorSpace " + spaceText);
    // PCFShadowMap and PCFSoftShadowMap are the filters the engine draws (PCFShadowFilter, PCFSoftShadowFilter).
    if (!enabled->IsBoolean() || !type->IsNumber() || (type.As<v8::Number>()->Value() != 1 && type.As<v8::Number>()->Value() != 2))
        return refuse("shadowMap.enabled must be a boolean and shadowMap.type PCFShadowMap or PCFSoftShadowMap");
    const OutputState output{tone->second, exposure.As<v8::Number>()->Value(), spaceText == "srgb"};
    if (output.toneMapping != game.output_.toneMapping || output.toneMappingExposure != game.output_.toneMappingExposure ||
        output.srgb != game.output_.srgb) {
        game.output_ = output;
        game.outputChanged_ = true;
    }
    game.shadowMap_ = enabled->IsTrue();
    game.shadowMapType_ = static_cast<int>(type.As<v8::Number>()->Value());
}

// three's `adapter` as the facade backend hands it out: `{ info: { architecture, ... }, limits: {} }`,
// or null when this run has no GPU.
v8::Local<v8::Value> V8Game::adapterValue() {
    if (adapterInfo_.empty()) return v8::Null(isolate_);
    auto ctx = isolate_->GetCurrentContext();
    auto info = v8::Object::New(isolate_);
    for (const auto& [name, value] : adapterInfo_) info->Set(ctx, v8str(isolate_, name), v8str(isolate_, value)).Check();
    auto adapter = v8::Object::New(isolate_);
    adapter->Set(ctx, v8str(isolate_, "info"), info).Check();
    adapter->Set(ctx, v8str(isolate_, "limits"), v8::Object::New(isolate_)).Check();
    return adapter;
}

// `tn.renderInfo()`: { drawCalls, triangles } of the last frame the player drew.
void V8Game::renderInfo(const v8::FunctionCallbackInfo<v8::Value>& info) {
    auto& game = *static_cast<V8Game*>(info.Data().As<v8::External>()->Value());
    auto* isolate = info.GetIsolate();
    auto ctx = isolate->GetCurrentContext();
    auto record = v8::Object::New(isolate);
    record->Set(ctx, v8str(isolate, "drawCalls"), v8::Number::New(isolate, game.drawCalls_)).Check();
    record->Set(ctx, v8str(isolate, "triangles"), v8::Number::New(isolate, static_cast<double>(game.triangles_))).Check();
    info.GetReturnValue().Set(record);
}

void V8Game::requestAdapter(const v8::FunctionCallbackInfo<v8::Value>& info) {
    auto& game = *static_cast<V8Game*>(info.Data().As<v8::External>()->Value());
    auto ctx = info.GetIsolate()->GetCurrentContext();
    auto resolver = v8::Promise::Resolver::New(ctx).ToLocalChecked();
    resolver->Resolve(ctx, game.adapterValue()).Check();
    info.GetReturnValue().Set(resolver->GetPromise());
}

// createImageBitmap's decode: PNG or JPEG bytes through the engine's image decoder (PRD-515) into
// an RGBA8 Texture, rows as stored. `{ texture, width, height }`, or a TN_NATIVE_IMAGE_DECODE refusal.
void V8Game::decodeImage(const v8::FunctionCallbackInfo<v8::Value>& info) {
    auto& game = *static_cast<V8Game*>(info.Data().As<v8::External>()->Value());
    auto* isolate = info.GetIsolate();
    auto ctx = isolate->GetCurrentContext();
    std::vector<uint8_t> bytes;
    if (info.Length() == 1 && info[0]->IsArrayBufferView()) {
        auto view = info[0].As<v8::ArrayBufferView>();
        bytes.resize(view->ByteLength());
        view->CopyContents(bytes.data(), bytes.size());
    } else if (info.Length() == 1 && info[0]->IsArrayBuffer()) {
        auto buffer = info[0].As<v8::ArrayBuffer>();
        const auto* data = static_cast<const uint8_t*>(buffer->Data());
        bytes.assign(data, data + buffer->ByteLength());
    } else {
        isolate->ThrowException(v8::Exception::TypeError(v8str(isolate,
            "TN_NATIVE_IMAGE_DECODE: expected the encoded image as an ArrayBuffer or typed array")));
        return;
    }
#if TN_PLAYER_NATIVE_GLTF
    auto texture = std::make_shared<Texture>();
    if (gltf::imageFormat(bytes.data(), bytes.size()) == gltf::ImageFormat::Unknown ||
        !gltf::decodeImage(bytes.data(), bytes.size(), texture->width, texture->height, texture->data)) {
        isolate->ThrowException(v8::Exception::Error(v8str(isolate,
            "TN_NATIVE_IMAGE_DECODE: the bytes are not a PNG, JPEG or WebP this decoder reads, or the image is damaged or larger than 8192")));
        return;
    }
    texture->needsUpdate();
    const uint32_t width = texture->width, height = texture->height;
    auto record = v8::Object::New(isolate);
    record->Set(ctx, v8str(isolate, "texture"), game.adapter_->wrap(
        tn::abi::shareObject(game.context_, "Texture", std::move(texture)))).Check();
    record->Set(ctx, v8str(isolate, "width"), v8::Number::New(isolate, width)).Check();
    record->Set(ctx, v8str(isolate, "height"), v8::Number::New(isolate, height)).Check();
    info.GetReturnValue().Set(record);
#else
    (void)game; (void)ctx;
    isolate->ThrowException(v8::Exception::Error(v8str(isolate,
        "TN_NATIVE_IMAGE_DECODE: this player was built without the engine image decoder")));
#endif
}

void V8Game::setPost(const v8::FunctionCallbackInfo<v8::Value>& info) {
    try {
    auto& game = *static_cast<V8Game*>(info.Data().As<v8::External>()->Value());
    shader::graph::Node graph;
    const auto apply = [&](shader::graph::Node value) {
        if (value == game.post_) return;  // RenderPipeline.render() hands the same graph every frame
        if (game.renderer_) game.renderer_->setPostGraph(value);
        game.post_ = std::move(value);
    };
    if (info.Length() == 1 && info[0]->IsNull()) { apply({}); return; }
    if (info.Length() == 1 && game.adapter_->tsl().unwrap(info[0], graph)) { apply(graph); return; }
    if (info.Length() == 1 && info[0]->IsString()) {
        v8::String::Utf8Value source(info.GetIsolate(), info[0]);
        std::vector<std::string> errors;
        auto imported = shader::graph::importSerialized(std::string_view(*source, source.length()), errors);
        if (errors.empty() && imported) { apply(imported); return; }
        std::string reason = "TN_NATIVE_POST_INVALID";
        for (const auto& error : errors) reason += ": " + error;
        info.GetIsolate()->ThrowException(v8::Exception::Error(v8str(info.GetIsolate(), reason)));
        return;
    }
    info.GetIsolate()->ThrowException(v8::Exception::TypeError(v8str(info.GetIsolate(),
        "TN_NATIVE_POST_INVALID: expected a native TSL node or exported post graph")));
    } catch (const std::exception& error) {
        info.GetIsolate()->ThrowException(v8::Exception::Error(v8str(info.GetIsolate(),
            std::string("TN_NATIVE_POST_REFUSED: ") + error.what())));
    }
}

void V8Game::initialize(Renderer& renderer) {
    renderer_ = &renderer;
    if (post_) renderer.setPostGraph(post_);
}

bool V8Game::observe(const std::string& method, const json::Value* argument, json::Value& result, std::string& error) {
    v8::Isolate::Scope isolateScope(isolate_);
    v8::HandleScope scope(isolate_);
    auto ctx = js_.Get(isolate_);
    v8::Context::Scope contextScope(ctx);
    v8::TryCatch caught(isolate_);
    const auto fail = [&](const std::string& reason) { error = "TN_INSPECT_GAME_BRIDGE: " + reason; return false; };
    v8::Local<v8::Value> bridge;
    if (!ctx->Global()->Get(ctx, v8str(isolate_, "__THREENATIVE_PLAYTEST_BRIDGE__")).ToLocal(&bridge))
        return fail("cannot read installed bridge");
    if (bridge->IsUndefined()) return false;
    if (!bridge->IsObject()) return fail("installed bridge must be an object");
    v8::Local<v8::Value> fn, input, output;
    if (!bridge.As<v8::Object>()->Get(ctx, v8str(isolate_, method)).ToLocal(&fn) || !fn->IsFunction())
        return fail("missing method " + method);
    if (!v8::JSON::Parse(ctx, v8str(isolate_, argument ? json::stringify(*argument) : method == "sample" ? "{}" : "null")).ToLocal(&input))
        return fail("invalid request argument");
    if (!fn.As<v8::Function>()->Call(ctx, bridge, argument || method == "sample" ? 1 : 0, &input).ToLocal(&output)) {
        v8::String::Utf8Value message(isolate_, caught.Exception());
        return fail(*message ? *message : "bridge call failed");
    }
    isolate_->PerformMicrotaskCheckpoint();
    if (output->IsPromise()) {
        auto promise = output.As<v8::Promise>();
        if (promise->State() == v8::Promise::kPending) return fail("observation remains pending");
        if (promise->State() == v8::Promise::kRejected) {
            v8::String::Utf8Value reason(isolate_, promise->Result());
            return fail(*reason ? *reason : "observation rejected");
        }
        output = promise->Result();
    }
    v8::Local<v8::String> encoded;
    if (!v8::JSON::Stringify(ctx, output).ToLocal(&encoded)) return fail("observation is not JSON");
    v8::String::Utf8Value text(isolate_, encoded);
    json::Error parseError;
    if (!json::parse(std::string_view(*text, text.length()), result, parseError)) return fail("invalid JSON observation");
    return true;
}

bool V8Game::start(const std::string& path, std::string& error) {
    const char* configuredAssets = std::getenv("TN_NATIVE_ASSET_PACKAGE");
    assetPath_ = configuredAssets ? configuredAssets :
        (std::filesystem::path(path).parent_path() / "native/assets.tnpk").string();
    services_ = mystral::js::createV8Engine();
    if (!services_) return error = "TN_PLAYER_V8_SERVICES: no V8 engine", false;
    isolate_ = static_cast<v8::Isolate*>(services_->getRawContext());

    const tn_version_info_t own = tn_engine_version();
    tn_diagnostic_t diagnostic{nullptr, 0};
    if (tn_context_create(&context_, &own, &diagnostic) != TN_OK)
        return error = "no engine context", false;

    v8::Isolate::Scope isolateScope(isolate_);
    v8::HandleScope scope(isolate_);
    adapter_ = std::make_unique<tn::adapters::v8adapter::Adapter>(isolate_, context_);
    mystral::js::JSValueGuard global(*services_, services_->getGlobal());
    auto object = static_cast<v8::Persistent<v8::Value>*>(global.get().ptr)->Get(isolate_).As<v8::Object>();
    v8::Local<v8::Context> ctx = object->GetCreationContext().ToLocalChecked();
    js_.Reset(isolate_, ctx);
    v8::Context::Scope contextScope(ctx);
    adapter_->install(ctx, ctx->Global());
    // WebAudio is the legacy host's (SDL output, worker decode); the three audio classes sit on it.
    mystral::audio::initializeAudioBindings(services_.get());
#if TN_PLAYER_NATIVE_PHYSICS
    if (!mystral::physics::initializeNativePhysicsBindings(services_.get()))
        return error = "TN_NATIVE_PHYSICS_MISSING: resident installation failed", false;
#endif

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
    auto platform = v8::Object::New(isolate_);
    platform->Set(ctx, v8str(isolate_, "runtime"), v8str(isolate_, "native")).Check();
#if defined(_WIN32)
    const char* os = "windows";
#elif defined(__APPLE__)
    const char* os = "macos";
#else
    const char* os = "linux";
#endif
    platform->Set(ctx, v8str(isolate_, "os"), v8str(isolate_, os)).Check();
    platform->Set(ctx, v8str(isolate_, "formFactor"), v8str(isolate_, "desktop")).Check();
    platform->Set(ctx, v8str(isolate_, "maxTouchPoints"), v8::Integer::New(isolate_, 0)).Check();
    host->Set(ctx, v8str(isolate_, "platform"), platform).Check();
    const auto sceneWalk = v8::Function::New(ctx, &sceneWalkCallback, v8::External::New(isolate_, adapter_.get())).ToLocalChecked();
    host->Set(ctx, v8str(isolate_, "children"), sceneWalk).Check();
    host->Set(ctx, v8str(isolate_, "traverse"), sceneWalk).Check();
    host->Set(ctx, v8str(isolate_, "log"), v8::Function::New(ctx, &logCallback).ToLocalChecked()).Check();
    auto self = v8::External::New(isolate_, this);
    host->Set(ctx, v8str(isolate_, "loadAsset"), v8::Function::New(ctx, &loadAsset, self).ToLocalChecked()).Check();
#if TN_PLAYER_NATIVE_GLTF
    // Only a player with the decoder answers createImageBitmap; without it the facade installs none.
    host->Set(ctx, v8str(isolate_, "decodeImage"), v8::Function::New(ctx, &decodeImage, self).ToLocalChecked()).Check();
#endif
    host->Set(ctx, v8str(isolate_, "setPostGraph"), v8::Function::New(ctx, &setPost, self).ToLocalChecked()).Check();
    host->Set(ctx, v8str(isolate_, "setRendererState"), v8::Function::New(ctx, &setRendererState, self).ToLocalChecked()).Check();
    host->Set(ctx, v8str(isolate_, "requestAdapter"), v8::Function::New(ctx, &requestAdapter, self).ToLocalChecked()).Check();
    host->Set(ctx, v8str(isolate_, "renderInfo"), v8::Function::New(ctx, &renderInfo, self).ToLocalChecked()).Check();
    v8::Local<v8::Script> script;
    if (!v8::Script::Compile(ctx, v8str(isolate_, source.str())).ToLocal(&script) || !script->Run(ctx).ToLocal(&ignored)) {
        v8::String::Utf8Value message(isolate_, tryCatch.Exception());
        return error = std::string("the game bundle failed: ") + (*message ? *message : "?"), false;
    }
    isolate_->PerformMicrotaskCheckpoint();
    const auto failed = [&] {
        v8::Local<v8::Value> startupError;
        if (!host->Get(ctx, v8str(isolate_, "__startupError")).ToLocal(&startupError) || startupError->IsUndefined())
            return false;
        v8::String::Utf8Value message(isolate_, startupError);
        error = std::string("core startup failed: ") + (*message ? *message : "?");
        return true;
    };
    if (failed()) return false;

    v8::Local<v8::Value> tnValue;
    if (!ctx->Global()->Get(ctx, v8str(isolate_, "tn")).ToLocal(&tnValue) || !tnValue->IsObject())
        return error = "the game bundle left no `tn` host object", false;
    v8::Local<v8::Object> tn = tnValue.As<v8::Object>();
    v8::Local<v8::Value> update;
    if (!tn->Get(ctx, v8str(isolate_, "__update")).ToLocal(&update) || !update->IsFunction())
        return error = "the game bundle registered no tn.onUpdate(fn)", false;
    update_.Reset(isolate_, update.As<v8::Function>());
    return view(error) >= 0;
}

int V8Game::view(std::string& error) {
    v8::Isolate::Scope isolateScope(isolate_);
    v8::HandleScope scope(isolate_);
    v8::Local<v8::Context> ctx = js_.Get(isolate_);
    v8::Context::Scope contextScope(ctx);
    v8::Local<v8::Value> tnValue, startupError, sceneValue, cameraValue;
    if (!ctx->Global()->Get(ctx, v8str(isolate_, "tn")).ToLocal(&tnValue) || !tnValue->IsObject())
        return error = "the game bundle left no `tn` host object", -1;
    v8::Local<v8::Object> tn = tnValue.As<v8::Object>();
    // An async boot that fails after start() returned reports through the same field.
    if (tn->Get(ctx, v8str(isolate_, "__startupError")).ToLocal(&startupError) && !startupError->IsUndefined()) {
        v8::String::Utf8Value message(isolate_, startupError);
        return error = std::string("core startup failed: ") + (*message ? *message : "?"), -1;
    }
    if (!tn->Get(ctx, v8str(isolate_, "scene")).ToLocal(&sceneValue) ||
        !tn->Get(ctx, v8str(isolate_, "camera")).ToLocal(&cameraValue))
        return error = "tn.scene or tn.camera could not be read", -1;
    if (sceneValue->IsNullOrUndefined() || cameraValue->IsNullOrUndefined())
        return 0;
    tn_handle_t handle{};
    tn::binding::Object* scene = adapter_->unwrap(sceneValue, handle) ? tn::abi::objectOf(handle) : nullptr;
    if (scene == nullptr || scene->cls != "Scene")
        return error = "tn.scene is not a Scene", -1;
    tn::binding::Object* camera = adapter_->unwrap(cameraValue, handle) ? tn::abi::objectOf(handle) : nullptr;
    if (camera == nullptr || (camera->cls != "PerspectiveCamera" && camera->cls != "OrthographicCamera"))
        return error = "tn.camera is not a camera", -1;
    sceneHold_ = scene->ptr;
    cameraHold_ = camera->ptr;
    scene_ = static_cast<Scene*>(scene->ptr.get());
    camera_ = camera->cls == "PerspectiveCamera"
                  ? static_cast<Camera*>(static_cast<PerspectiveCamera*>(camera->ptr.get()))
                  : static_cast<Camera*>(static_cast<OrthographicCamera*>(camera->ptr.get()));
    return 1;
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
        mystral::audio::cleanupAudioBindings();
        adapter_.reset();
    }
    if (context_ != nullptr) {
        tn_diagnostic_t diagnostic{nullptr, 0};
        tn_context_destroy(context_, &diagnostic);
        tn_diagnostic_release(&diagnostic);
    }
    services_.reset();
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
    // Finished decodes settle and ended sources fire `onended` before the game's update reads them.
    mystral::audio::processAudioEvents();
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

/** The high-performance adapter's `info` fields, empty ones left out; empty when there is none. */
std::vector<std::pair<std::string, std::string>> adapterIdentity() {
    struct Request {
        WGPUAdapter adapter = nullptr;
        bool done = false;
    } request;
    WGPUInstance instance = wgpuCreateInstance(nullptr);
    if (!instance) return {};
    WGPURequestAdapterOptions options = {};
    options.powerPreference = WGPUPowerPreference_HighPerformance;
#if WGPU_USES_CALLBACK_INFO_PATTERN
    WGPURequestAdapterCallbackInfo callback = {};
    callback.mode = WGPUCallbackMode_AllowProcessEvents;
    callback.callback = [](WGPURequestAdapterStatus status, WGPUAdapter adapter, WGPUStringView, void* data, void*) {
        auto& r = *static_cast<Request*>(data);
        if (status == WGPURequestAdapterStatus_Success) r.adapter = adapter;
        r.done = true;
    };
    callback.userdata1 = &request;
    wgpuInstanceRequestAdapter(instance, &options, callback);
#else
    wgpuInstanceRequestAdapter(instance, &options, [](WGPURequestAdapterStatus status, WGPUAdapter adapter, char const*, void* data) {
        auto& r = *static_cast<Request*>(data);
        if (status == WGPURequestAdapterStatus_Success) r.adapter = adapter;
        r.done = true;
    }, &request);
#endif
    for (int i = 0; i < 1000000 && !request.done; ++i) wgpuInstanceProcessEvents(instance);
    std::vector<std::pair<std::string, std::string>> fields;
    if (request.adapter) {
        WGPUAdapterInfo info = {};
        wgpuAdapterGetInfo(request.adapter, &info);
        for (const auto& [name, value] : {std::pair{"architecture", WGPU_PRINT_STRING_VIEW(info.architecture)},
                                          std::pair{"description", WGPU_PRINT_STRING_VIEW(info.description)},
                                          std::pair{"device", WGPU_PRINT_STRING_VIEW(info.device)},
                                          std::pair{"vendor", WGPU_PRINT_STRING_VIEW(info.vendor)}})
            if (!value.empty() && value != "unknown") fields.emplace_back(name, value);  // the macro's empty
        wgpuAdapterInfoFreeMembers(info);
        wgpuAdapterRelease(request.adapter);
    }
    wgpuInstanceRelease(instance);
    return fields;
}

int main(int argc, char** argv) {
    // The game's log is a stream tools read live; a pipe would otherwise hold it until exit, and a
    // killed player would lose it.
    std::setvbuf(stdout, nullptr, _IOLBF, 0);
    std::string gamePath;
    std::string checkRequest;
    bool checkGame = false;
    for (int i = 1; i < argc; ++i) {
        const std::string argument = argv[i];
        if ((argument == "--game" || argument == "--bundle") && i + 1 < argc)
            gamePath = argv[++i];
        else if (argument == "--check-game")
            checkGame = true;
        else if (argument == "--check-request" && i + 1 < argc)
            checkRequest = argv[++i];
        else if (argument.rfind("--", 0) != 0)
            gamePath = argument;
        else
            return std::fprintf(stderr, "TN_PLAYER_V8_ARGS: unknown argument %s\n", argument.c_str()), 2;
    }
    if (gamePath.empty())
        return std::fprintf(stderr, "TN_PLAYER_V8_ARGS: a game bundle path is required\n"), 2;
    if (!checkRequest.empty() && !checkGame)
        return std::fprintf(stderr, "TN_PLAYER_V8_ARGS: --check-request requires --check-game\n"), 2;

    V8Game game;
    // The adapter's identity, read the way core reads it (a request of its own beside the renderer's):
    // what the game's `adapter.info` and the playtest's adapter class come from. A check has no GPU.
    if (!checkGame) game.setAdapter(adapterIdentity());
    std::string error;
    if (!game.start(gamePath, error))
        return std::fprintf(stderr, "TN_PLAYER_V8_GAME: %s\n", error.c_str()), 1;

    // Boot the real bundle and validate its native handles without opening a GPU/window.
    // This establishes startup only; a desktop playtest still proves the journey and rendering.
    if (checkGame) {
        // An async boot (audio decodes, timers) publishes its scene ticks later. A check has no frame
        // loop, so it turns fixed ticks in real time itself, for at most two minutes.
        // ponytail: spins between ticks; the engine thread never sleeps (native_engine_no_blocking_waits).
        const auto begin = std::chrono::steady_clock::now();
        int bound = game.scene() != nullptr ? 1 : 0;
        for (uint64_t ticks = 0; bound == 0; bound = game.view(error)) {
            const double elapsed = std::chrono::duration<double>(std::chrono::steady_clock::now() - begin).count();
            if (elapsed > 120) {
                error = "the game published no scene within 120 s";
                bound = -1;
                break;
            }
            if (elapsed * 60 >= double(ticks + 1)) {
                game.tick(1.0 / 60.0);
                ++ticks;
            }
        }
        if (bound < 0)
            return std::fprintf(stderr, "TN_PLAYER_V8_GAME: %s\n", error.c_str()), 1;
        if (!checkRequest.empty()) {
            inspect::Host host;
            host.scene = game.scene(); host.gameRuntime = "v8";
            host.observe = [&game](const std::string& method, const json::Value* argument,
                                  json::Value& result, std::string& error) {
                return game.observe(method, argument, result, error);
            };
            inspect::Endpoint endpoint(host);
            const std::string response = endpoint.handle(checkRequest);
            std::printf("TN_PLAYER_V8_INSPECT_CHECK: %s\n", response.c_str());
            json::Value parsed; json::Error error;
            if (!json::parse(response, parsed, error) || parsed.find("error")) return 1;
        }
        return std::printf("TN_PLAYER_V8_GAME_CHECK: engine=native gameRuntime=v8 startup=passed shadowMap=%s:%d\n",
                           game.shadowMapEnabled() ? "on" : "off", game.shadowMapType()), 0;
    }

    player::Game configured;
    configured.name = "game-v8-demo";
    configured.scene = game.scene();
    configured.camera = game.camera();
    configured.gameRuntime = "v8";
    configured.update = [&game](double dt) { game.tick(dt); };
    configured.initialize = [&game](Renderer& renderer) { game.initialize(renderer); };
    configured.beforeRender = [&game](Renderer& renderer, RenderDatabase& database) { game.beforeRender(renderer, database); };
    configured.frameComplete = [&game](Renderer& renderer, const std::vector<std::string>&) { game.frameDrawn(renderer); };
    configured.observe = [&game](const std::string& method, const json::Value* argument,
                                 json::Value& result, std::string& error) {
        return game.observe(method, argument, result, error);
    };
    configured.resource = [&game](const std::string& id, uint64_t tick) { return game.resource(id, tick); };
    configured.afterRender = [&game] { game.safePoint(); };
    configured.attach = [&game](inspect::Endpoint& endpoint) { game.attach(endpoint); };
    configured.view = [&game](Object3D*& scene, Camera*& camera, std::string& error) {
        const int bound = game.view(error);
        if (bound > 0) { scene = game.scene(); camera = game.camera(); }
        return bound;
    };
    return player::run(configured);
}
