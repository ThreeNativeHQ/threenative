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

namespace tn::adapters::v8adapter {

struct Adapter::Wrapper {
    Adapter* adapter;
    tn_handle_t handle;
    v8::Global<v8::Object> object;
    std::set<std::string> callbacks;  // JS callbacks set on the object, by name
    bool held = false;                // strong: the engine may still call one of them
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

void throwStatus(v8::Isolate* isolate, tn_diagnostic_t& diagnostic) {
    const std::string message = diagnostic.message ? diagnostic.message : "TN_ABI error";
    tn_diagnostic_release(&diagnostic);
    isolate->ThrowException(v8::Exception::TypeError(str(isolate, message)));
}

// JS -> ABI values. Arrays become number arrays (fromArray), engine wrappers become handles.
bool toValues(Adapter& a, const v8::FunctionCallbackInfo<v8::Value>& info, std::vector<tn_value_t>& out,
              std::deque<std::string>& texts, std::vector<std::vector<double>>& arrays,
              std::deque<std::vector<tn_value_t>>& values, int limit = -1) {
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
};

}  // namespace

Adapter::Adapter(v8::Isolate* isolate, tn_context_t* context) : tsl_(std::make_unique<Tsl>(isolate)), isolate_(isolate), context_(context) {
    v8::HandleScope scope(isolate_);
    v8::Local<v8::ObjectTemplate> instance = v8::ObjectTemplate::New(isolate_);
    instance->SetInternalFieldCount(1);
    instanceTemplate_.Reset(isolate_, instance);
}

Adapter::~Adapter() {
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
    if (object->InternalFieldCount() < 1) return false;
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
        ctor->InstanceTemplate()->SetInternalFieldCount(1);
        v8::Local<v8::ObjectTemplate> proto = ctor->PrototypeTemplate();
        for (const auto& [method, fn] : binding.methods) {
            (void)fn;
            auto* data = new MethodData{this, method};  // ponytail: lives for the process; one per method per install
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
                               std::vector<tn_value_t> args;
                               std::deque<std::string> texts;
                               std::deque<std::vector<tn_value_t>> values;
                               std::vector<std::vector<double>> arrays;
                               const bool intersections = d->name == "intersectObject" || d->name == "intersectObjects";
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
        for (const auto& [path, getter] : binding.getters) {
            // A dotted path (`position.x`) is reached through the member object, not as a property.
            if (path.find('.') == std::string::npos) properties.push_back({path, binding.setters.count(path) > 0, false});
        }
        // Member objects read as properties too; tn_get answers them with the one alias Ref.
        for (const auto& [path, member] : binding.members) {
            properties.push_back({path, binding.setters.count(path) > 0, binding.fixedMembers.count(path) > 0});
        }
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
            if (fixed) data->cache.Reset(isolate_, v8::Private::New(isolate_, str(isolate_, "tn:" + path)));
            proto->SetAccessorProperty(
                str(isolate_, path),
                v8::FunctionTemplate::New(
                    isolate_,
                    [](const v8::FunctionCallbackInfo<v8::Value>& info) {
                        auto* d = static_cast<MethodData*>(info.Data().As<v8::External>()->Value());
                        v8::Isolate* isolate = info.GetIsolate();
                        v8::Local<v8::Context> ctx = isolate->GetCurrentContext();
                        if (!d->cache.IsEmpty()) {
                            v8::Local<v8::Value> cached;
                            if (info.This()->GetPrivate(ctx, d->cache.Get(isolate)).ToLocal(&cached) && !cached->IsUndefined()) {
                                info.GetReturnValue().Set(cached);
                                return;
                            }
                        }
                        tn_handle_t h{};
                        if (!d->adapter->unwrap(info.This(), h)) return;
                        tn_value_t result{};
                        tn_diagnostic_t diagnostic{nullptr, 0};
                        if (tn_get(h, d->name.c_str(), &result, &diagnostic) != TN_OK) {
                            throwStatus(isolate, diagnostic);
                            return;
                        }
                        v8::Local<v8::Value> value = fromValue(*d->adapter, result);
                        if (!d->cache.IsEmpty()) info.This()->SetPrivate(ctx, d->cache.Get(isolate), value).Check();
                        info.GetReturnValue().Set(value);
                    },
                    v8::External::New(isolate_, data)),
                settable ? v8::FunctionTemplate::New(
                               isolate_,
                               [](const v8::FunctionCallbackInfo<v8::Value>& info) {
                                   auto* d = static_cast<MethodData*>(info.Data().As<v8::External>()->Value());
                                   tn_handle_t h{};
                                   if (!d->adapter->unwrap(info.This(), h)) return;
                                   std::vector<tn_value_t> args;
                                   std::deque<std::string> texts;
                               std::deque<std::vector<tn_value_t>> values;
                                   std::vector<std::vector<double>> arrays;
                                   tn_diagnostic_t diagnostic{nullptr, 0};
                                   if (!toValues(*d->adapter, info, args, texts, arrays, values) || args.size() != 1 ||
                                       tn_set(h, d->name.c_str(), &args[0], &diagnostic) != TN_OK) {
                                       throwStatus(info.GetIsolate(), diagnostic);
                                   }
                               },
                               v8::External::New(isolate_, data))
                         : v8::Local<v8::FunctionTemplate>());
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
}

}  // namespace tn::adapters::v8adapter
