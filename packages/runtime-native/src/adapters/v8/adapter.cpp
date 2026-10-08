#include "adapter.h"
#include "tsl.h"

#include <algorithm>
#include <deque>
#include <cstdio>
#include <string>
#include <vector>

#include "engine/abi/bindings.h"
#include "engine/abi/abi_internal.h"
#include "engine/foundation/ThreeConstants.h"
#include "engine/scene/material.h"
#include "engine/scene/texture.h"
#include "engine/animation/skinning/skeleton.h"
#include "engine/animation/property_binding.h"

namespace tn::adapters::v8adapter {

// An engine wrapper's internal fields: 0 is its Wrapper record, 1.. cache the wrappers of its fixed
// members (`position`, `rotation`, ...) so a read is a slot load, not a property lookup. A
// PropertyBinding has two fields, so the count also tells the two kinds apart.
constexpr int kWrapperFields = 8;

struct Adapter::Wrapper {
    Adapter* adapter;
    tn_handle_t handle;
    v8::Global<v8::Object> object;
    std::set<std::string> callbacks;  // JS callbacks set on the object, by name
    bool held = false;                // strong: the engine may still call one of them
};

struct Adapter::PropertyWrapper {
    Adapter* adapter;
    std::shared_ptr<engine::Object3D> root;
    engine::animation::PropertyBinding binding;
    v8::Global<v8::Object> object;
    PropertyWrapper(Adapter* a, std::shared_ptr<engine::Object3D> r, std::string path)
        : adapter(a), root(std::move(r)), binding(root, std::move(path)) {}
};

// What the engine holds for one JS callback: which wrapper's function to call. Deleted by the
// engine's release, once, when it drops the callback.
struct Adapter::CallbackData {
    Adapter* adapter;
    uint64_t wrapper;
    std::string name;
};

namespace {

// The class registry is read once for names only; every call still goes through the C ABI.
const tn::binding::Registry& registry() {
    static const tn::binding::Registry classes = [] {
        tn::binding::Registry r;
        tn::binding::registerAll(r);
        return r;
    }();
    return classes;
}

v8::Local<v8::String> str(v8::Isolate* isolate, const std::string& s) {
    return v8::String::NewFromUtf8(isolate, s.c_str(), v8::NewStringType::kNormal, static_cast<int>(s.size()))
        .ToLocalChecked();
}

Adapter* adapterOf(const v8::FunctionCallbackInfo<v8::Value>& info) {
    return static_cast<Adapter*>(info.Data().As<v8::External>()->Value());
}

// The shape of nearly every hot call (`position.set(x, y, z)`, `rotation.x = v`): up to eight plain
// numbers. They cross as a stack array, with none of the containers the general converter builds.
constexpr int kFastArguments = 8;
bool numericArguments(const v8::FunctionCallbackInfo<v8::Value>& info, tn_value_t (&out)[kFastArguments]) {
    const int count = info.Length();
    if (count > kFastArguments) return false;
    for (int i = 0; i < count; ++i) {
        if (!info[i]->IsNumber()) return false;
        out[i] = tn_value_t{};
        out[i].kind = TN_VALUE_NUMBER;
        out[i].number = info[i].As<v8::Number>()->Value();
    }
    return true;
}

void throwStatus(v8::Isolate* isolate, tn_diagnostic_t& diagnostic) {
    const std::string message = diagnostic.message ? diagnostic.message : "TN_ABI error";
    tn_diagnostic_release(&diagnostic);
    isolate->ThrowException(v8::Exception::TypeError(str(isolate, message)));
}

// JS -> ABI values. Arrays become number arrays (fromArray), engine wrappers become handles.
bool toValues(Adapter& a, const v8::FunctionCallbackInfo<v8::Value>& info, std::vector<tn_value_t>& out,
              std::deque<std::string>& texts, std::vector<std::vector<double>>& arrays,
              std::deque<std::vector<tn_value_t>>& values, int limit = -1) {
    a.noteGenericArguments();
    v8::Isolate* isolate = info.GetIsolate();
    v8::Local<v8::Context> ctx = isolate->GetCurrentContext();
    arrays.reserve(info.Length());
    for (int i = 0; i < info.Length() && (limit < 0 || i < limit); ++i) {
        v8::Local<v8::Value> arg = info[i];
        tn_value_t v{};
        tn_handle_t h{};
        if (arg->IsNumber()) {
            v.kind = TN_VALUE_NUMBER;
            v.number = arg.As<v8::Number>()->Value();
        } else if (arg->IsBoolean()) {
            v.kind = TN_VALUE_BOOL;
            v.boolean = arg->IsTrue() ? 1 : 0;
        } else if (arg->IsString()) {
            v8::String::Utf8Value utf8(isolate, arg);
            texts.emplace_back(*utf8 ? *utf8 : "");
            v.kind = TN_VALUE_STRING;
            v.text = texts.back().c_str();
            v.count = texts.back().size();
        } else if (a.unwrap(arg, h)) {
            v.kind = TN_VALUE_HANDLE;
            v.handle = h;
            a.holdIfCallback(h);
        } else if (arg->IsArray()) {
            v8::Local<v8::Array> array = arg.As<v8::Array>();
            // Object arrays (intersectObjects, Skeleton) use the same handle values as scalar args.
            values.emplace_back(array->Length());
            auto& elements = values.back();
            for (uint32_t k = 0; k < array->Length(); ++k) {
                v8::Local<v8::Value> e;
                if (!array->Get(ctx, k).ToLocal(&e)) return false;
                if (e->IsNumber()) { elements[k].kind = TN_VALUE_NUMBER; elements[k].number = e.As<v8::Number>()->Value(); }
                else if (a.unwrap(e, h)) { elements[k].kind = TN_VALUE_HANDLE; elements[k].handle = h; a.holdIfCallback(h); }
                else return false;
            }
            if (std::all_of(elements.begin(), elements.end(), [](const auto& e) { return e.kind == TN_VALUE_NUMBER; })) {
                std::vector<double> numbers; for (const auto& e : elements) numbers.push_back(e.number);
                arrays.push_back(std::move(numbers)); v.kind = TN_VALUE_NUMBERS;
                v.numbers = arrays.back().data(); v.count = arrays.back().size();
            } else { v.kind = TN_VALUE_ARRAY; v.values = elements.data(); v.count = elements.size(); }
        } else if (arg->IsTypedArray()) {
            // The template builds attributes from real typed arrays (`new Float32Array(...)`), so a
            // typed array crosses as its binary64 values, exactly as a plain array of them would.
            v8::Local<v8::TypedArray> array = arg.As<v8::TypedArray>();
            std::vector<double> numbers(array->Length());
            for (uint32_t k = 0; k < array->Length(); ++k) {
                v8::Local<v8::Value> e;
                if (!array->Get(ctx, k).ToLocal(&e) || !e->IsNumber()) return false;
                numbers[k] = e.As<v8::Number>()->Value();
            }
            arrays.push_back(std::move(numbers));
            v.kind = TN_VALUE_NUMBERS;
            v.numbers = arrays.back().data();
            v.count = arrays.back().size();
        } else if (!arg->IsUndefined() && !arg->IsNull()) {
            return false;
        }
        out.push_back(v);
    }
    return true;
}

v8::Local<v8::Value> fromValue(Adapter& a, const tn_value_t& v) {
    v8::Isolate* isolate = a.isolate();
    switch (v.kind) {
        case TN_VALUE_NULL: return v8::Null(isolate);
        case TN_VALUE_UNDEFINED: return v8::Undefined(isolate);
        case TN_VALUE_NUMBER: return v8::Number::New(isolate, v.number);
        case TN_VALUE_BOOL: return v8::Boolean::New(isolate, v.boolean != 0);
        case TN_VALUE_STRING: return str(isolate, std::string(v.text, v.count));
        case TN_VALUE_HANDLE: return a.wrap(v.handle);
        case TN_VALUE_ARRAY: {
            auto array = v8::Array::New(isolate, int(v.count));
            for (uint32_t i = 0; i < v.count; ++i) {
                const auto written = array->CreateDataProperty(isolate->GetCurrentContext(), i, fromValue(a, v.values[i]));
                if (written.IsNothing() || !written.FromJust()) return v8::Undefined(isolate);
            }
            return array;
        }
        case TN_VALUE_RECORD: {
            auto record = v8::Object::New(isolate);
            for (uint64_t i = 0; i < v.count; ++i) {
                const auto& key = v.values[i * 2];
                record->CreateDataProperty(isolate->GetCurrentContext(), str(isolate, std::string(key.text, key.count)),
                    fromValue(a, v.values[i * 2 + 1])).Check();
            }
            return record;
        }
        case TN_VALUE_NUMBERS: {
            // three exposes `elements` and `toArray()` as plain arrays, so JS gets a plain array.
            v8::Local<v8::Array> array = v8::Array::New(isolate, static_cast<int>(v.count));
            v8::Local<v8::Context> ctx = isolate->GetCurrentContext();
            for (uint64_t k = 0; k < v.count; ++k) {
                const auto written = array->CreateDataProperty(ctx, static_cast<uint32_t>(k), v8::Number::New(isolate, v.numbers[k]));
                if (written.IsNothing() || !written.FromJust()) return v8::Undefined(isolate);
            }
            return array;
        }
        default: return v8::Undefined(isolate);
    }
}

struct MethodData {
    Adapter* adapter;
    std::string name;
    // A fixed member's wrapper, kept on the owner's JS object under this private key: the member
    // names the same native object for the owner's life, so later reads cross nothing.
    v8::Global<v8::Private> cache;
    bool intersections = false;  // intersectObject(s): the only methods whose third argument is a target array
    int slot = 0;                // a fixed member's internal-field cache slot; 0: none left, use the private key
    bool own = false;            // a read-only fixed member: once read, it becomes an own data property of the wrapper, as three defines it
    uint16_t type = 0;           // the catalog type whose wrappers own that slot: a getter borrowed by another class must not read it
};

// three defines position, rotation, quaternion and scale as read-only own data properties. Once a
// wrapper has handed out its fixed member, the member becomes one here too, so later reads are
// property loads that never enter the accessor.
void adopt(v8::Isolate* isolate, v8::Local<v8::Context> ctx, v8::Local<v8::Object> self, const std::string& name,
           v8::Local<v8::Value> value) {
    if (!value->IsObject()) return;
    self->DefineOwnProperty(ctx, str(isolate, name), value, v8::ReadOnly).FromMaybe(false);
}

}  // namespace

Adapter::Adapter(v8::Isolate* isolate, tn_context_t* context) : tsl_(std::make_unique<Tsl>(isolate)), isolate_(isolate), context_(context) {
    v8::HandleScope scope(isolate_);
    v8::Local<v8::ObjectTemplate> instance = v8::ObjectTemplate::New(isolate_);
    instance->SetInternalFieldCount(kWrapperFields);
    instanceTemplate_.Reset(isolate_, instance);
}

Adapter::~Adapter() {
    for (auto* wrapper : propertyWrappers_) {
        wrapper->object.Reset();
        delete wrapper;
    }
    // The isolate may outlive this adapter: wrappers left alive stop pointing at it, and the engine
    // stops calling into it.
    for (auto& [k, w] : wrappers_) {
        for (const std::string& name : w->callbacks) {
            tn_diagnostic_t diagnostic{nullptr, 0};
            tn_set_callback(w->handle, name.c_str(), nullptr, nullptr, nullptr, &diagnostic);
            tn_diagnostic_release(&diagnostic);
        }
        w->object.Reset();
        delete w;
    }
}

void Adapter::forget(uint64_t k) {
    const auto it = wrappers_.find(k);
    if (it == wrappers_.end()) return;
    tn_diagnostic_t diagnostic{nullptr, 0};
    // The engine must not call a function whose wrapper is gone.
    for (const std::string& name : it->second->callbacks) {
        tn_set_callback(it->second->handle, name.c_str(), nullptr, nullptr, nullptr, &diagnostic);
        tn_diagnostic_release(&diagnostic);
    }
    withCallbacks_.erase(it->second);
    tn_object_release(it->second->handle, &diagnostic);
    tn_diagnostic_release(&diagnostic);
    delete it->second;
    wrappers_.erase(it);
}

v8::Local<v8::Value> Adapter::wrap(tn_handle_t handle) {
    v8::EscapableHandleScope scope(isolate_);
    const uint64_t k = key(handle);
    if (const auto it = wrappers_.find(k); it != wrappers_.end()) {
        return scope.Escape(it->second->object.Get(isolate_));
    }
    v8::Local<v8::Context> ctx = isolate_->GetCurrentContext();
    v8::Local<v8::Object> object;
    const auto cls = classes_.find(handle.type);
    if (cls != classes_.end()) {
        object = cls->second.Get(isolate_)->InstanceTemplate()->NewInstance(ctx).ToLocalChecked();
    } else {
        object = instanceTemplate_.Get(isolate_)->NewInstance(ctx).ToLocalChecked();
    }
    auto* w = new Wrapper{this, handle, {}};
    track(w, object);
    wrappers_[k] = w;
    return scope.Escape(object);
}

bool Adapter::unwrap(v8::Local<v8::Value> value, tn_handle_t& out) const {
    if (!value->IsObject()) return false;
    v8::Local<v8::Object> object = value.As<v8::Object>();
    if (object->InternalFieldCount() != kWrapperFields) return false;
    auto* w = static_cast<Wrapper*>(object->GetAlignedPointerFromInternalField(0));
    if (!w || w->adapter != this) return false;
    out = w->handle;
    return true;
}

void Adapter::track(Wrapper* w, v8::Local<v8::Object> object) {
    object->SetAlignedPointerInInternalField(0, w);
    w->object.Reset(isolate_, object);
    weak(w);
}

void Adapter::weak(Wrapper* w) {
    w->held = false;
    w->object.SetWeak(w, [](const v8::WeakCallbackInfo<Wrapper>& info) {
        Wrapper* wrapper = info.GetParameter();
        wrapper->object.Reset();
        wrapper->adapter->forget(key(wrapper->handle));
    }, v8::WeakCallbackType::kParameter);
}

void Adapter::strong(Wrapper* w) {
    if (w->held) return;
    w->held = true;
    w->object.ClearWeak();
}

void Adapter::holdIfCallback(tn_handle_t handle) {
    const auto it = wrappers_.find(key(handle));
    if (it != wrappers_.end() && !it->second->callbacks.empty()) strong(it->second);
}

void Adapter::collect() {
    for (Wrapper* w : withCallbacks_) {
        tn_value_t parent{};
        tn_diagnostic_t diagnostic{nullptr, 0};
        const bool attached = tn_get(w->handle, "parent", &parent, &diagnostic) == TN_OK && parent.kind == TN_VALUE_HANDLE;
        tn_diagnostic_release(&diagnostic);
        if (attached) strong(w);
        else if (w->held) weak(w);
    }
}

tn_status_t Adapter::invokeCallback(void* context, const tn_value_t* args, uint32_t count, char* error, uint32_t capacity) {
    const auto* data = static_cast<CallbackData*>(context);
    Adapter& a = *data->adapter;
    v8::Isolate* isolate = a.isolate_;
    v8::Isolate::Scope isolateScope(isolate);  // the engine calls from outside any JS frame
    v8::HandleScope scope(isolate);
    v8::Local<v8::Context> ctx = a.context_v8_.Get(isolate);
    v8::Context::Scope contextScope(ctx);
    const auto it = a.wrappers_.find(data->wrapper);
    if (it == a.wrappers_.end()) {
        std::snprintf(error, capacity, "TN_V8_CALLBACK_GONE %s", data->name.c_str());
        return TN_ERROR_INVALID_STATE;
    }
    v8::Local<v8::Object> self = it->second->object.Get(isolate);
    v8::Local<v8::Value> fn;
    if (!self->GetPrivate(ctx, a.callbackKeys_.at(data->name).Get(isolate)).ToLocal(&fn) || !fn->IsFunction()) return TN_OK;
    std::vector<v8::Local<v8::Value>> argv;
    argv.reserve(count);
    for (uint32_t i = 0; i < count; ++i) argv.push_back(args[i].kind == TN_VALUE_NULL ? v8::Null(isolate).As<v8::Value>() : fromValue(a, args[i]));
    v8::TryCatch tryCatch(isolate);
    if (fn.As<v8::Function>()->Call(ctx, self, static_cast<int>(argv.size()), argv.data()).IsEmpty()) {
        v8::String::Utf8Value message(isolate, tryCatch.Exception());
        std::snprintf(error, capacity, "%s", *message ? *message : "the callback threw");
        return TN_ERROR_INVALID_STATE;
    }
    return TN_OK;
}

void Adapter::getCallback(const v8::FunctionCallbackInfo<v8::Value>& info) {
    auto* d = static_cast<MethodData*>(info.Data().As<v8::External>()->Value());
    v8::Isolate* isolate = info.GetIsolate();
    v8::Local<v8::Value> fn;
    if (info.This()->GetPrivate(isolate->GetCurrentContext(), d->adapter->callbackKeys_.at(d->name).Get(isolate)).ToLocal(&fn) &&
        fn->IsFunction()) {
        info.GetReturnValue().Set(fn);
    } else {
        info.GetReturnValue().SetNull();
    }
}

void Adapter::setCallback(const v8::FunctionCallbackInfo<v8::Value>& info) {
    auto* d = static_cast<MethodData*>(info.Data().As<v8::External>()->Value());
    Adapter& a = *d->adapter;
    v8::Isolate* isolate = info.GetIsolate();
    v8::Local<v8::Context> ctx = isolate->GetCurrentContext();
    tn_handle_t h{};
    if (!a.unwrap(info.This(), h)) return;
    Wrapper* w = a.wrappers_.at(key(h));
    v8::Local<v8::Private> slot = a.callbackKeys_.at(d->name).Get(isolate);
    v8::Local<v8::Value> value = info[0];
    tn_diagnostic_t diagnostic{nullptr, 0};
    if (value->IsNullOrUndefined()) {
        info.This()->DeletePrivate(ctx, slot).Check();
        w->callbacks.erase(d->name);
        if (w->callbacks.empty()) a.withCallbacks_.erase(w);
        if (tn_set_callback(h, d->name.c_str(), nullptr, nullptr, nullptr, &diagnostic) != TN_OK) throwStatus(isolate, diagnostic);
        return;
    }
    if (!value->IsFunction()) {
        isolate->ThrowException(v8::Exception::TypeError(str(isolate, d->name + " must be a function or null")));
        return;
    }
    auto* data = new CallbackData{&a, key(h), d->name};
    if (tn_set_callback(h, d->name.c_str(), &Adapter::invokeCallback, data,
                        [](void* c) { delete static_cast<CallbackData*>(c); }, &diagnostic) != TN_OK) {
        delete data;  // a refused callback was never taken
        throwStatus(isolate, diagnostic);
        return;
    }
    // The function lives on the wrapper: wrapper -> closure is a JS edge the collector sees.
    info.This()->SetPrivate(ctx, slot, value).Check();
    w->callbacks.insert(d->name);
    a.withCallbacks_.insert(w);
    a.strong(w);  // until the next safe point finds the object attached or not
}

void Adapter::animationCall(const v8::FunctionCallbackInfo<v8::Value>& info) {
    auto* isolate = info.GetIsolate();
    const auto ctx = isolate->GetCurrentContext();
    const auto data = info.Data().As<v8::Array>();
    auto& a = *static_cast<Adapter*>(data->Get(ctx, 0).ToLocalChecked().As<v8::External>()->Value());
    const int operation = data->Get(ctx, 1).ToLocalChecked().As<v8::Integer>()->Value();
    const auto global = ctx->Global();
    const auto label = [&](v8::Local<v8::Value> value) {
        if (!value->IsString()) throw binding::Unsupported{"TN_NATIVE_PROPERTY_BINDING: expected a string"};
        v8::String::Utf8Value text(isolate, value);
        return std::string(*text, text.length());
    };
    const auto root = [&](v8::Local<v8::Value> value) -> std::shared_ptr<engine::Object3D> {
        tn_handle_t handle{};
        tn_value_t parent{}; tn_diagnostic_t diagnostic{nullptr, 0};
        const bool valid = a.unwrap(value, handle) && tn_get(handle, "parent", &parent, &diagnostic) == TN_OK;
        tn_diagnostic_release(&diagnostic);
        if (!valid) throw binding::Unsupported{"TN_NATIVE_PROPERTY_BINDING: expected a native Object3D"};
        return std::static_pointer_cast<engine::Object3D>(tn::abi::objectOf(handle)->ptr);
    };
    const auto node = [&](engine::Object3D* object) -> v8::Local<v8::Value> {
        if (!object) return v8::Null(isolate);
        auto shared = object->weak_from_this().lock();
        if (!shared) throw binding::Unsupported{"TN_NATIVE_PROPERTY_BINDING: node has no shared owner"};
        return a.wrap(tn::abi::shareObject(a.context(), std::string(object->type()), std::move(shared)));
    };
    try {
        if (operation == 6) { // getConsoleFunction
            const auto hook = global->Get(ctx, str(isolate, "__tnConsoleHook")).ToLocalChecked();
            info.GetReturnValue().Set(hook->IsUndefined() ? v8::Local<v8::Value>(v8::Null(isolate)) : hook);
            return;
        }
        if (operation == 7) { // setConsoleFunction
            if (info.Length() != 1 || (!info[0]->IsUndefined() && !info[0]->IsNull() && !info[0]->IsFunction()))
                throw binding::Unsupported{"TN_NATIVE_CONSOLE_HOOK: expected a function, null or undefined"};
            global->Set(ctx, str(isolate, "__tnConsoleHook"), info[0]).Check();
            return;
        }
        if (operation == 4) { // parseTrackName
            if (info.Length() != 1) throw binding::Unsupported{"TN_NATIVE_PROPERTY_BINDING: expected one track path"};
            engine::animation::ParsedPath parsed; std::string error;
            if (!engine::animation::parseTrackName(label(info[0]), parsed, error)) throw binding::Unsupported{error};
            auto record = v8::Object::New(isolate);
            for (const auto& [name, part] : std::vector<std::pair<const char*, std::optional<std::string>>>{
                {"nodeName", parsed.nodeName}, {"objectName", parsed.objectName}, {"objectIndex", parsed.objectIndex},
                {"propertyName", parsed.propertyName}, {"propertyIndex", parsed.propertyIndex}})
                record->Set(ctx, str(isolate, name), part ? v8::Local<v8::Value>(str(isolate, *part)) : v8::Local<v8::Value>(v8::Undefined(isolate))).Check();
            info.GetReturnValue().Set(record);
            return;
        }
        if (operation == 5) { // findNode
            if (info.Length() != 2) throw binding::Unsupported{"TN_NATIVE_PROPERTY_BINDING: expected root and node name"};
            const auto held = root(info[0]);
            const auto name = info[1]->IsUndefined() ? std::optional<std::string>{} : std::optional<std::string>{label(info[1])};
            info.GetReturnValue().Set(node(engine::animation::findNode(*held, name)));
            return;
        }
        if (operation == 0) { // constructor
            if (!info.IsConstructCall() || info.Length() != 2) throw binding::Unsupported{"TN_NATIVE_PROPERTY_BINDING: construct with root and path"};
            auto held = root(info[0]); const auto path = label(info[1]);
            engine::animation::ParsedPath parsed; std::string error;
            if (!engine::animation::parseTrackName(path, parsed, error)) throw binding::Unsupported{error};
            auto* wrapper = new PropertyWrapper(&a, std::move(held), path);
            info.This()->SetInternalField(0, v8::External::New(isolate, &a));
            info.This()->SetInternalField(1, v8::External::New(isolate, wrapper));
            wrapper->object.Reset(isolate, info.This());
            a.propertyWrappers_.insert(wrapper);
            wrapper->object.SetWeak(wrapper, [](const v8::WeakCallbackInfo<PropertyWrapper>& weak) {
                auto* wrapper = weak.GetParameter();
                wrapper->object.Reset(); wrapper->adapter->propertyWrappers_.erase(wrapper); delete wrapper;
            }, v8::WeakCallbackType::kParameter);
            return;
        }
        const auto self = info.This();
        if (self->InternalFieldCount() != 2 || !self->GetInternalField(0)->IsValue() || !self->GetInternalField(0).As<v8::Value>()->IsExternal() ||
            self->GetInternalField(0).As<v8::External>()->Value() != &a || !self->GetInternalField(1)->IsValue() || !self->GetInternalField(1).As<v8::Value>()->IsExternal())
            throw binding::Unsupported{"TN_NATIVE_PROPERTY_BINDING: invalid receiver"};
        auto* wrapper = static_cast<PropertyWrapper*>(self->GetInternalField(1).As<v8::External>()->Value());
        if (!a.propertyWrappers_.contains(wrapper)) throw binding::Unsupported{"TN_NATIVE_PROPERTY_BINDING: invalid receiver"};
        if (operation == 1) {
            wrapper->binding.bind();
            const auto& diagnostic = wrapper->binding.diagnostic;
            if (!diagnostic.empty()) {
                v8::Local<v8::Value> hook = global->Get(ctx, str(isolate, "__tnConsoleHook")).ToLocalChecked();
                v8::Local<v8::Value> args[] = {str(isolate, "error"), str(isolate, diagnostic)};
                if (hook->IsFunction()) {
                    v8::Local<v8::Value> ignored;
                    if (!hook.As<v8::Function>()->Call(ctx, global, 2, args).ToLocal(&ignored)) return;
                } else {
                    auto console = global->Get(ctx, str(isolate, "console")).ToLocalChecked();
                    if (console->IsObject()) {
                        auto error = console.As<v8::Object>()->Get(ctx, str(isolate, "error")).ToLocalChecked();
                        if (error->IsFunction()) { v8::Local<v8::Value> ignored;
                            if (!error.As<v8::Function>()->Call(ctx, console, 1, args + 1).ToLocal(&ignored)) return; }
                    }
                }
            }
        } else if (operation == 2) wrapper->binding.unbind();
        else if (operation == 3) {
            if (auto material = wrapper->binding.targetMaterial()) {
                const auto cls = std::string(material->typeName());
                info.GetReturnValue().Set(a.wrap(tn::abi::shareObject(a.context(), cls, std::move(material))));
            } else info.GetReturnValue().Set(node(wrapper->binding.targetNode().get()));
        }
    } catch (const binding::Unsupported& error) {
        isolate->ThrowException(v8::Exception::TypeError(str(isolate, error.reason)));
    } catch (const std::exception& error) {
        isolate->ThrowException(v8::Exception::Error(str(isolate, error.what())));
    }
}

void Adapter::install(v8::Local<v8::Context> context, v8::Local<v8::Object> target) {
    tsl_->install(context, target);
    v8::HandleScope scope(isolate_);
    context_v8_.Reset(isolate_, context);
    v8::Local<v8::External> self = v8::External::New(isolate_, this);
    for (const auto& [name, binding] : registry()) {
        const uint16_t type = tn_type_id(name.c_str());
        // Every supported class is a global, constructible or not: a class the engine only hands out
        // (an AnimationAction from clipAction) still needs its prototype for `instanceof` and
        // members, and `new` on it is refused by tn_construct with a diagnostic naming it.
        if (type == 0) continue;
        v8::Local<v8::FunctionTemplate> ctor = v8::FunctionTemplate::New(
            isolate_,
            [](const v8::FunctionCallbackInfo<v8::Value>& info) {
                v8::Isolate* isolate = info.GetIsolate();
                if (!info.IsConstructCall()) {
                    isolate->ThrowException(v8::Exception::TypeError(str(isolate, "use new")));
                    return;
                }
                Adapter& a = *adapterOf(info);
                std::vector<tn_value_t> args;
                std::deque<std::string> texts;
                               std::deque<std::vector<tn_value_t>> values;
                std::vector<std::vector<double>> arrays;
                if (!toValues(a, info, args, texts, arrays, values)) {
                    isolate->ThrowException(v8::Exception::TypeError(str(isolate, "TN_ABI_VALUE: unsupported argument")));
                    return;
                }
                v8::String::Utf8Value cls(isolate, info.NewTarget().As<v8::Function>()->GetName());
                tn_handle_t h{};
                tn_diagnostic_t diagnostic{nullptr, 0};
                if (tn_construct(a.context(), *cls, args.data(), static_cast<uint32_t>(args.size()), &h, &diagnostic) != TN_OK) {
                    throwStatus(isolate, diagnostic);
                    return;
                }
                // The construct call's own receiver becomes the wrapper: `new` returns it.
                v8::Local<v8::Object> object = info.This();
                auto* w = new Wrapper{&a, h, {}};
                a.track(w, object);
                a.wrappers_[key(h)] = w;
            },
            self);
        ctor->SetClassName(str(isolate_, name));
        ctor->InstanceTemplate()->SetInternalFieldCount(kWrapperFields);
        v8::Local<v8::ObjectTemplate> proto = ctor->PrototypeTemplate();
        for (const auto& [method, fn] : binding.methods) {
            (void)fn;
            auto* data = new MethodData{this, method};  // ponytail: lives for the process; one per method per install
            data->intersections = method == "intersectObject" || method == "intersectObjects";
            proto->Set(str(isolate_, method),
                       v8::FunctionTemplate::New(
                           isolate_,
                           [](const v8::FunctionCallbackInfo<v8::Value>& info) {
                               auto* d = static_cast<MethodData*>(info.Data().As<v8::External>()->Value());
                               v8::Isolate* isolate = info.GetIsolate();
                               tn_handle_t h{};
                               if (!d->adapter->unwrap(info.This(), h)) {
                                   isolate->ThrowException(v8::Exception::TypeError(str(isolate, "not an engine object")));
                                   return;
                               }
                               tn_value_t fast[kFastArguments];
                               if (!d->intersections && numericArguments(info, fast)) {
                                   tn_value_t result{};
                                   tn_diagnostic_t diagnostic{nullptr, 0};
                                   if (tn_invoke(h, d->name.c_str(), fast, static_cast<uint32_t>(info.Length()), &result,
                                                 &diagnostic) != TN_OK) {
                                       throwStatus(isolate, diagnostic);
                                       return;
                                   }
                                   // A chaining call answers the object it was called on: that is this wrapper.
                                   if (result.kind == TN_VALUE_HANDLE && result.handle.index == h.index &&
                                       result.handle.generation == h.generation && result.handle.type == h.type &&
                                       result.handle.context == h.context)
                                       info.GetReturnValue().Set(info.This());
                                   else
                                       info.GetReturnValue().Set(fromValue(*d->adapter, result));
                                   return;
                               }
                               std::vector<tn_value_t> args;
                               std::deque<std::string> texts;
                               std::deque<std::vector<tn_value_t>> values;
                               std::vector<std::vector<double>> arrays;
                               const bool intersections = d->intersections;
                               if (!toValues(*d->adapter, info, args, texts, arrays, values, intersections ? 2 : -1)) {
                                   isolate->ThrowException(v8::Exception::TypeError(str(isolate, "TN_ABI_VALUE: unsupported argument")));
                                   return;
                               }
                               tn_value_t result{};
                               tn_diagnostic_t diagnostic{nullptr, 0};
                               if (tn_invoke(h, d->name.c_str(), args.data(), static_cast<uint32_t>(args.size()), &result,
                                             &diagnostic) != TN_OK) {
                                   throwStatus(isolate, diagnostic);
                                   return;
                               }
                               auto converted = fromValue(*d->adapter, result);
                               if (intersections && info.Length() > 2 && !info[2]->IsUndefined()) {
                                   if (!info[2]->IsArray() || !converted->IsArray()) {
                                       isolate->ThrowException(v8::Exception::TypeError(str(isolate, "intersection target must be an array"))); return;
                                   }
                                   const auto target = info[2].As<v8::Array>();
                                   const auto hits = converted.As<v8::Array>();
                                   const auto ctx = isolate->GetCurrentContext();
                                   for (uint32_t i = 0; i < hits->Length(); ++i) {
                                       v8::Local<v8::Value> hit, push;
                                       if (!hits->Get(ctx, i).ToLocal(&hit) || !target->Get(ctx, str(isolate, "push")).ToLocal(&push)) return;
                                       if (!push->IsFunction()) {
                                           isolate->ThrowException(v8::Exception::TypeError(str(isolate, "intersection target.push is not callable"))); return;
                                       }
                                       if (push.As<v8::Function>()->Call(ctx, target, 1, &hit).IsEmpty()) return;
                                   }
                                   // Sort the caller's target, preserving exceptions from getters and sort overrides.
                                   v8::Local<v8::Function> compare;
                                   if (!v8::Function::New(ctx, [](const v8::FunctionCallbackInfo<v8::Value>& args) {
                                       const auto context = args.GetIsolate()->GetCurrentContext();
                                       const auto key = str(args.GetIsolate(), "distance");
                                       v8::Local<v8::Object> left, right;
                                       v8::Local<v8::Value> a, b;
                                       if (!args[0]->ToObject(context).ToLocal(&left) || !args[1]->ToObject(context).ToLocal(&right) ||
                                           !left->Get(context, key).ToLocal(&a) || !right->Get(context, key).ToLocal(&b)) return;
                                       const auto av = a->NumberValue(context), bv = b->NumberValue(context);
                                       if (av.IsNothing() || bv.IsNothing()) return;
                                       args.GetReturnValue().Set(av.FromJust() - bv.FromJust());
                                   }).ToLocal(&compare)) return;
                                   v8::Local<v8::Value> sorter;
                                   if (!target->Get(ctx, str(isolate, "sort")).ToLocal(&sorter)) return;
                                   if (!sorter->IsFunction()) {
                                       isolate->ThrowException(v8::Exception::TypeError(str(isolate, "intersection target.sort is not callable"))); return;
                                   }
                                   v8::Local<v8::Value> argument = compare;
                                   if (sorter.As<v8::Function>()->Call(ctx, target, 1, &argument).IsEmpty()) return;
                                   converted = target;
                               }
                               info.GetReturnValue().Set(converted);
                           },
                           v8::External::New(isolate_, data)));
        }
        struct Property {
            std::string path;
            bool settable;
            bool fixed;
        };
        std::vector<Property> properties;
        // A list getter with indexed setters (`morphTargetInfluences.0`) reads as a live array below.
        const auto indexed = [&binding](const std::string& head) {
            return std::any_of(binding.setters.begin(), binding.setters.end(), [&head](const auto& entry) {
                const std::string& path = entry.first;
                return path.size() > head.size() + 1 && path.compare(0, head.size() + 1, head + ".") == 0 &&
                       std::all_of(path.begin() + head.size() + 1, path.end(), [](char c) { return c >= '0' && c <= '9'; });
            });
        };
        std::vector<MethodData*> liveArrays;
        for (const auto& [path, getter] : binding.getters) {
            // A dotted path (`position.x`) is reached through the member object, not as a property.
            if (path.find('.') != std::string::npos) continue;
            if (indexed(path)) liveArrays.push_back(new MethodData{this, path, {}});
            else properties.push_back({path, binding.setters.count(path) > 0, false});
        }
        // `mesh.morphTargetInfluences[0] = 0.5` must reach the engine, as it reaches three's plain
        // array: the getter's list comes back as a Proxy whose set trap forwards `<head>.<index>`.
        for (MethodData* live : liveArrays) {
            proto->SetAccessorProperty(str(isolate_, live->name), v8::FunctionTemplate::New(isolate_,
                [](const v8::FunctionCallbackInfo<v8::Value>& info) {
                    auto* d = static_cast<MethodData*>(info.Data().As<v8::External>()->Value());
                    v8::Isolate* isolate = info.GetIsolate();
                    v8::Local<v8::Context> ctx = isolate->GetCurrentContext();
                    tn_handle_t h{};
                    if (!d->adapter->unwrap(info.This(), h)) return;
                    tn_value_t result{};
                    tn_diagnostic_t diagnostic{nullptr, 0};
                    if (tn_get(h, d->name.c_str(), &result, &diagnostic) != TN_OK) {
                        throwStatus(isolate, diagnostic);
                        return;
                    }
                    v8::Local<v8::Value> list = fromValue(*d->adapter, result);
                    if (!list->IsObject()) {
                        info.GetReturnValue().Set(list);
                        return;
                    }
                    v8::Local<v8::Object> handler = v8::Object::New(isolate);
                    handler->SetPrivate(ctx, v8::Private::ForApi(isolate, str(isolate, "tn:holder-owner")), info.This()).Check();
                    v8::Local<v8::Function> set = v8::Function::New(ctx,
                        [](const v8::FunctionCallbackInfo<v8::Value>& info) {
                            auto* d = static_cast<MethodData*>(info.Data().As<v8::External>()->Value());
                            v8::Isolate* isolate = info.GetIsolate();
                            v8::Local<v8::Context> ctx = isolate->GetCurrentContext();
                            v8::Local<v8::Object> target = info[0].As<v8::Object>();
                            if (!target->Set(ctx, info[1], info[2]).FromMaybe(false)) return;
                            info.GetReturnValue().Set(true);
                            v8::String::Utf8Value key(isolate, info[1]);
                            const std::string index = *key ? *key : "";
                            if (index.empty() || !std::all_of(index.begin(), index.end(), [](char c) { return c >= '0' && c <= '9'; }))
                                return; // `length` and other keys stay on the JS array, as on three's
                            if (!info[2]->IsNumber()) {
                                isolate->ThrowException(v8::Exception::TypeError(str(isolate, "TN_ABI: " + d->name + " takes numbers")));
                                return;
                            }
                            v8::Local<v8::Value> owner;
                            tn_handle_t h{};
                            if (!info.This()->GetPrivate(ctx, v8::Private::ForApi(isolate, str(isolate, "tn:holder-owner"))).ToLocal(&owner) ||
                                !owner->IsObject() || !d->adapter->unwrap(owner.As<v8::Object>(), h)) return;
                            tn_value_t value{};
                            value.kind = TN_VALUE_NUMBER;
                            value.number = info[2].As<v8::Number>()->Value();
                            tn_diagnostic_t diagnostic{nullptr, 0};
                            if (tn_set(h, (d->name + "." + index).c_str(), &value, &diagnostic) != TN_OK)
                                throwStatus(isolate, diagnostic);
                        }, v8::External::New(isolate, d)).ToLocalChecked();
                    handler->Set(ctx, str(isolate, "set"), set).Check();
                    v8::Local<v8::Proxy> proxy;
                    if (v8::Proxy::New(ctx, list.As<v8::Object>(), handler).ToLocal(&proxy)) info.GetReturnValue().Set(proxy);
                }, v8::External::New(isolate_, live)));
        }
        // Member objects read as properties too; tn_get answers them with the one alias Ref.
        for (const auto& [path, member] : binding.members) {
            properties.push_back({path, binding.setters.count(path) > 0, binding.fixedMembers.count(path) > 0});
        }
        // Internal-field slots for this class's fixed members: the hot ones every setter chain reads
        // first, then the rest in registry order, while slots last.
        std::map<std::string, int> slots;
        for (const char* hot : {"position", "rotation", "quaternion", "scale"})
            if (binding.fixedMembers.count(hot) && int(slots.size()) + 1 < kWrapperFields) slots[hot] = int(slots.size()) + 1;
        for (const auto& [path, settable, fixed] : properties)
            if (fixed && !slots.count(path) && int(slots.size()) + 1 < kWrapperFields) slots[path] = int(slots.size()) + 1;
        for (const auto& [path, settable, fixed] : properties) {
            if ((name == "MeshBasicNodeMaterial" || name == "MeshStandardNodeMaterial") && path.ends_with("Node")) {
                auto* data = new MethodData{this, path, {}};
                proto->SetAccessorProperty(str(isolate_, path),
                    v8::FunctionTemplate::New(isolate_, [](const v8::FunctionCallbackInfo<v8::Value>& info) {
                        auto* d = static_cast<MethodData*>(info.Data().As<v8::External>()->Value());
                        tn_handle_t h{};
                        if (!d->adapter->unwrap(info.This(), h)) return;
                        try {
                            const auto node = tn::abi::shaderNode(h, d->name);
                            info.GetReturnValue().Set(node ? v8::Local<v8::Value>(d->adapter->tsl().wrap(node))
                                                          : v8::Local<v8::Value>(v8::Null(info.GetIsolate())));
                        } catch (const std::exception& e) {
                            info.GetIsolate()->ThrowException(v8::Exception::TypeError(str(info.GetIsolate(), e.what())));
                        }
                    }, v8::External::New(isolate_, data)),
                    v8::FunctionTemplate::New(isolate_, [](const v8::FunctionCallbackInfo<v8::Value>& info) {
                        auto* d = static_cast<MethodData*>(info.Data().As<v8::External>()->Value());
                        tn_handle_t h{};
                        if (!d->adapter->unwrap(info.This(), h)) return;
                        engine::shader::graph::Node node;
                        if (info.Length() != 1 || (!info[0]->IsNull() && !d->adapter->tsl().unwrap(info[0], node))) {
                            info.GetIsolate()->ThrowException(v8::Exception::TypeError(str(info.GetIsolate(), "TN_TSL_PROPERTY: expected a node or null")));
                            return;
                        }
                        try { tn::abi::setShaderNode(h, d->name, std::move(node)); }
                        catch (const tn::binding::Unsupported& e) {
                            info.GetIsolate()->ThrowException(v8::Exception::TypeError(str(info.GetIsolate(), e.reason)));
                        } catch (const std::exception& e) {
                            info.GetIsolate()->ThrowException(v8::Exception::TypeError(str(info.GetIsolate(), e.what())));
                        }
                    }, v8::External::New(isolate_, data)));
                continue;
            }
            auto* data = new MethodData{this, path, {}};
            data->own = fixed && !settable;
            if (fixed && slots.count(path)) { data->slot = slots[path]; data->type = type; }
            else if (fixed) data->cache.Reset(isolate_, v8::Private::New(isolate_, str(isolate_, "tn:" + path)));
            proto->SetAccessorProperty(
                str(isolate_, path),
                v8::FunctionTemplate::New(
                    isolate_,
                    [](const v8::FunctionCallbackInfo<v8::Value>& info) {
                        auto* d = static_cast<MethodData*>(info.Data().As<v8::External>()->Value());
                        v8::Isolate* isolate = info.GetIsolate();
                        v8::Local<v8::Context> ctx = isolate->GetCurrentContext();
                        v8::Local<v8::Object> self = info.This();
                        // The slot belongs to this class's wrappers only: a getter borrowed onto another
                        // class's object (or a plain object inheriting from one) never reads or writes it.
                        tn_handle_t h{};
                        const bool owner = d->slot > 0 && d->adapter->unwrap(self, h) && h.type == d->type;
                        if (owner) {
                            v8::Local<v8::Data> cached = self->GetInternalField(d->slot);
                            if (cached->IsValue() && !cached.As<v8::Value>()->IsUndefined()) {
                                if (d->own) adopt(isolate, ctx, self, d->name, cached.As<v8::Value>());
                                info.GetReturnValue().Set(cached.As<v8::Value>());
                                return;
                            }
                        } else if (!d->cache.IsEmpty()) {
                            v8::Local<v8::Value> cached;
                            if (self->GetPrivate(ctx, d->cache.Get(isolate)).ToLocal(&cached) && !cached->IsUndefined()) {
                                info.GetReturnValue().Set(cached);
                                return;
                            }
                        }
                        if (!owner && !d->adapter->unwrap(self, h)) return;
                        tn_value_t result{};
                        tn_diagnostic_t diagnostic{nullptr, 0};
                        if (tn_get(h, d->name.c_str(), &result, &diagnostic) != TN_OK) {
                            throwStatus(isolate, diagnostic);
                            return;
                        }
                        v8::Local<v8::Value> value = fromValue(*d->adapter, result);
                        if (owner) {
                            self->SetInternalField(d->slot, value);
                            if (d->own) adopt(isolate, ctx, self, d->name, value);
                        } else if (d->slot == 0 && !d->cache.IsEmpty()) self->SetPrivate(ctx, d->cache.Get(isolate), value).Check();
                        info.GetReturnValue().Set(value);
                    },
                    v8::External::New(isolate_, data)),
                settable ? v8::FunctionTemplate::New(
                               isolate_,
                               [](const v8::FunctionCallbackInfo<v8::Value>& info) {
                                   auto* d = static_cast<MethodData*>(info.Data().As<v8::External>()->Value());
                                   tn_handle_t h{};
                                   if (!d->adapter->unwrap(info.This(), h)) return;
                                   tn_diagnostic_t diagnostic{nullptr, 0};
                                   if (info.Length() == 1 && info[0]->IsNumber()) {
                                       tn_value_t number{};
                                       number.kind = TN_VALUE_NUMBER;
                                       number.number = info[0].As<v8::Number>()->Value();
                                       if (tn_set(h, d->name.c_str(), &number, &diagnostic) != TN_OK) throwStatus(info.GetIsolate(), diagnostic);
                                       return;
                                   }
                                   std::vector<tn_value_t> args;
                                   std::deque<std::string> texts;
                               std::deque<std::vector<tn_value_t>> values;
                                   std::vector<std::vector<double>> arrays;
                                   if (!toValues(*d->adapter, info, args, texts, arrays, values) || args.size() != 1 ||
                                       tn_set(h, d->name.c_str(), &args[0], &diagnostic) != TN_OK) {
                                       throwStatus(info.GetIsolate(), diagnostic);
                                   }
                               },
                               v8::External::New(isolate_, data))
                         : v8::Local<v8::FunctionTemplate>());
        }
        // A dotted setter whose head is no member object, as three's plain `morphAttributes` holder:
        // `geometry.morphAttributes.position = [...]` writes through a holder object made per read,
        // which keeps its owner privately and forwards each tail to tn_set with the full path.
        std::map<std::string, std::vector<MethodData*>> holders;
        for (const auto& [path, setter] : binding.setters) {
            (void)setter;
            const std::size_t dot = path.find('.');
            if (dot == std::string::npos) continue;
            const std::string head = path.substr(0, dot);
            if (binding.members.count(head) > 0 || binding.getters.count(head) > 0) continue;
            holders[head].push_back(new MethodData{this, path, {}});
        }
        for (const auto& [head, paths] : holders) {
            auto* tails = new std::vector<MethodData*>(paths);
            proto->SetAccessorProperty(str(isolate_, head), v8::FunctionTemplate::New(isolate_,
                [](const v8::FunctionCallbackInfo<v8::Value>& info) {
                    v8::Isolate* isolate = info.GetIsolate();
                    v8::Local<v8::Context> ctx = isolate->GetCurrentContext();
                    const auto* tails = static_cast<std::vector<MethodData*>*>(info.Data().As<v8::External>()->Value());
                    v8::Local<v8::Object> holder = v8::Object::New(isolate);
                    holder->SetPrivate(ctx, v8::Private::ForApi(isolate, str(isolate, "tn:holder-owner")), info.This()).Check();
                    for (MethodData* tail : *tails) {
                        const std::string name = tail->name.substr(tail->name.find('.') + 1);
                        v8::Local<v8::Function> set = v8::Function::New(ctx,
                            [](const v8::FunctionCallbackInfo<v8::Value>& info) {
                                auto* d = static_cast<MethodData*>(info.Data().As<v8::External>()->Value());
                                v8::Isolate* isolate = info.GetIsolate();
                                v8::Local<v8::Value> owner;
                                tn_handle_t h{};
                                if (!info.This()->GetPrivate(isolate->GetCurrentContext(),
                                        v8::Private::ForApi(isolate, str(isolate, "tn:holder-owner"))).ToLocal(&owner) ||
                                    !owner->IsObject() || !d->adapter->unwrap(owner.As<v8::Object>(), h)) return;
                                std::vector<tn_value_t> args;
                                std::deque<std::string> texts;
                                std::deque<std::vector<tn_value_t>> values;
                                std::vector<std::vector<double>> arrays;
                                tn_diagnostic_t diagnostic{nullptr, 0};
                                if (!toValues(*d->adapter, info, args, texts, arrays, values) || args.size() != 1 ||
                                    tn_set(h, d->name.c_str(), &args[0], &diagnostic) != TN_OK)
                                    throwStatus(isolate, diagnostic);
                            }, v8::External::New(isolate, tail)).ToLocalChecked();
                        holder->SetAccessorProperty(str(isolate, name), v8::Local<v8::Function>(), set);
                    }
                    info.GetReturnValue().Set(holder);
                }, v8::External::New(isolate_, tails)));
        }
        for (const auto& [name, set] : binding.callbacks) {
            (void)set;
            if (callbackKeys_.find(name) == callbackKeys_.end())
                callbackKeys_[name].Reset(isolate_, v8::Private::New(isolate_, str(isolate_, "tn:callback:" + name)));
            auto* data = new MethodData{this, name, {}};
            proto->SetAccessorProperty(str(isolate_, name),
                                       v8::FunctionTemplate::New(isolate_, &Adapter::getCallback, v8::External::New(isolate_, data)),
                                       v8::FunctionTemplate::New(isolate_, &Adapter::setCallback, v8::External::New(isolate_, data)));
        }
        classes_[type].Reset(isolate_, ctor);
        target->Set(context, str(isolate_, name), ctor->GetFunction(context).ToLocalChecked()).Check();
    }
    // three's scalar constants the minimal template imports (PRD-531 small bindings): plain values
    // beside the classes, read as globals the way the classes are. The values are three r185's
    // (ThreeConstants.h, proven bit-exact by the mathutils reference test); this only wires them.
    target->Set(context, str(isolate_, "ACESFilmicToneMapping"),
                v8::Number::New(isolate_, tn::engine::ACESFilmicToneMapping)).Check();
    target->Set(context, str(isolate_, "AgXToneMapping"),
                v8::Number::New(isolate_, tn::engine::AgXToneMapping)).Check();
    target->Set(context, str(isolate_, "NeutralToneMapping"),
                v8::Number::New(isolate_, tn::engine::NeutralToneMapping)).Check();
    target->Set(context, str(isolate_, "PCFSoftShadowMap"),
                v8::Number::New(isolate_, tn::engine::PCFSoftShadowMap)).Check();
    target->Set(context, str(isolate_, "NoColorSpace"), str(isolate_, tn::engine::NoColorSpace)).Check();
    target->Set(context, str(isolate_, "LinearSRGBColorSpace"),
                str(isolate_, tn::engine::LinearSRGBColorSpace)).Check();
    for (const auto& [name, value] : std::map<std::string, double>{
        {"RepeatWrapping", static_cast<double>(tn::engine::TextureWrap::Repeat)},
        {"ClampToEdgeWrapping", static_cast<double>(tn::engine::TextureWrap::ClampToEdge)},
        {"NearestFilter", static_cast<double>(tn::engine::TextureFilter::Nearest)},
        {"LinearFilter", static_cast<double>(tn::engine::TextureFilter::Linear)},
        {"LinearMipmapLinearFilter", static_cast<double>(tn::engine::TextureFilter::LinearMipmapLinear)},
        {"UnsignedByteType", tn::engine::kTextureUnsignedByteType},
        {"FloatType", tn::engine::kTextureFloatType},
        {"RGBAFormat", tn::engine::kTextureRGBAFormat},
        {"EquirectangularReflectionMapping", 303},
        {"NoToneMapping", 0}, {"LoopOnce", 2200}, {"LoopRepeat", 2201},
        {"FrontSide", static_cast<double>(tn::engine::Side::Front)},
        {"BackSide", static_cast<double>(tn::engine::Side::Back)},
        {"DoubleSide", static_cast<double>(tn::engine::Side::Double)},
    }) target->Set(context, str(isolate_, name), v8::Number::New(isolate_, value)).Check();
    const auto animation = [&](int operation) {
        auto data = v8::Array::New(isolate_, 2);
        data->Set(context, 0, v8::External::New(isolate_, this)).Check();
        data->Set(context, 1, v8::Integer::New(isolate_, operation)).Check();
        return v8::FunctionTemplate::New(isolate_, &Adapter::animationCall, data);
    };
    auto property = animation(0);
    property->SetClassName(str(isolate_, "PropertyBinding"));
    property->InstanceTemplate()->SetInternalFieldCount(2);
    property->PrototypeTemplate()->Set(str(isolate_, "bind"), animation(1));
    property->PrototypeTemplate()->Set(str(isolate_, "unbind"), animation(2));
    property->PrototypeTemplate()->SetAccessorProperty(str(isolate_, "targetObject"), animation(3));
    property->Set(str(isolate_, "parseTrackName"), animation(4));
    property->Set(str(isolate_, "findNode"), animation(5));
    target->Set(context, str(isolate_, "PropertyBinding"), property->GetFunction(context).ToLocalChecked()).Check();
    target->Set(context, str(isolate_, "getConsoleFunction"), animation(6)->GetFunction(context).ToLocalChecked()).Check();
    target->Set(context, str(isolate_, "setConsoleFunction"), animation(7)->GetFunction(context).ToLocalChecked()).Check();
    target->Set(context, str(isolate_, "__tnCloneSkeleton"), v8::Function::New(context,
        [](const v8::FunctionCallbackInfo<v8::Value>& info) {
            auto& a = *adapterOf(info);
            tn_handle_t handle{};
            tn_value_t parent{};
            tn_diagnostic_t diagnostic{nullptr, 0};
            if (info.Length() != 1 || !a.unwrap(info[0], handle) || tn_get(handle, "parent", &parent, &diagnostic) != TN_OK) {
                tn_diagnostic_release(&diagnostic);
                info.GetIsolate()->ThrowException(v8::Exception::TypeError(str(info.GetIsolate(), "TN_NATIVE_SKELETON_CLONE: expected a native Object3D")));
                return;
            }
            tn_diagnostic_release(&diagnostic);
            try {
                const auto* object = tn::abi::objectOf(handle);
                std::string error;
                auto clone = engine::cloneSkeleton(*static_cast<engine::Object3D*>(object->ptr.get()), error);
                if (!clone) throw tn::binding::Unsupported{error};
                const auto cls = std::string(clone->type());
                info.GetReturnValue().Set(a.wrap(tn::abi::shareObject(a.context(), cls, std::move(clone))));
            } catch (const tn::binding::Unsupported& error) {
                info.GetIsolate()->ThrowException(v8::Exception::TypeError(str(info.GetIsolate(), error.reason)));
            } catch (const std::exception& error) {
                info.GetIsolate()->ThrowException(v8::Exception::Error(str(info.GetIsolate(), error.what())));
            }
        }, v8::External::New(isolate_, this)).ToLocalChecked()).Check();
    target->Set(context, str(isolate_, "AttachedBindMode"), str(isolate_, "attached")).Check();
    target->Set(context, str(isolate_, "SRGBColorSpace"), str(isolate_, "srgb")).Check();
}

}  // namespace tn::adapters::v8adapter
