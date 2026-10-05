#include "adapter.h"

#include <string>
#include <vector>

#include "engine/abi/bindings.h"

namespace tn::adapters::v8adapter {

struct Adapter::Wrapper {
    Adapter* adapter;
    tn_handle_t handle;
    v8::Global<v8::Object> object;
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
              std::vector<std::string>& texts, std::vector<std::vector<double>>& arrays) {
    v8::Isolate* isolate = info.GetIsolate();
    v8::Local<v8::Context> ctx = isolate->GetCurrentContext();
    texts.reserve(info.Length());
    arrays.reserve(info.Length());
    for (int i = 0; i < info.Length(); ++i) {
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
        } else if (arg->IsArray()) {
            v8::Local<v8::Array> array = arg.As<v8::Array>();
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
        case TN_VALUE_NUMBER: return v8::Number::New(isolate, v.number);
        case TN_VALUE_BOOL: return v8::Boolean::New(isolate, v.boolean != 0);
        case TN_VALUE_STRING: return str(isolate, std::string(v.text, v.count));
        case TN_VALUE_HANDLE: return a.wrap(v.handle);
        case TN_VALUE_NUMBERS: {
            // three exposes `elements` and `toArray()` as plain arrays, so JS gets a plain array.
            v8::Local<v8::Array> array = v8::Array::New(isolate, static_cast<int>(v.count));
            v8::Local<v8::Context> ctx = isolate->GetCurrentContext();
            for (uint64_t k = 0; k < v.count; ++k) {
                array->Set(ctx, static_cast<uint32_t>(k), v8::Number::New(isolate, v.numbers[k])).Check();
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

Adapter::Adapter(v8::Isolate* isolate, tn_context_t* context) : isolate_(isolate), context_(context) {
    v8::HandleScope scope(isolate_);
    v8::Local<v8::ObjectTemplate> instance = v8::ObjectTemplate::New(isolate_);
    instance->SetInternalFieldCount(1);
    instanceTemplate_.Reset(isolate_, instance);
}

Adapter::~Adapter() {
    // The isolate may outlive this adapter: wrappers left alive stop pointing at it.
    for (auto& [k, w] : wrappers_) {
        w->object.Reset();
        delete w;
    }
}

void Adapter::forget(uint64_t k) {
    const auto it = wrappers_.find(k);
    if (it == wrappers_.end()) return;
    tn_diagnostic_t diagnostic{nullptr, 0};
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
    object->SetAlignedPointerInInternalField(0, w);
    w->object.Reset(isolate_, object);
    w->object.SetWeak(w, [](const v8::WeakCallbackInfo<Wrapper>& info) {
        Wrapper* wrapper = info.GetParameter();
        wrapper->object.Reset();
        wrapper->adapter->forget(key(wrapper->handle));
    }, v8::WeakCallbackType::kParameter);
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

void Adapter::install(v8::Local<v8::Context> context, v8::Local<v8::Object> target) {
    v8::HandleScope scope(isolate_);
    v8::Local<v8::External> self = v8::External::New(isolate_, this);
    for (const auto& [name, binding] : registry()) {
        const uint16_t type = tn_type_id(name.c_str());
        if (type == 0 || !binding.ctor) continue;
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
                std::vector<std::string> texts;
                std::vector<std::vector<double>> arrays;
                if (!toValues(a, info, args, texts, arrays)) {
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
                object->SetAlignedPointerInInternalField(0, w);
                w->object.Reset(isolate, object);
                w->object.SetWeak(w, [](const v8::WeakCallbackInfo<Wrapper>& weak) {
                    Wrapper* wrapper = weak.GetParameter();
                    wrapper->object.Reset();
                    wrapper->adapter->forget(key(wrapper->handle));
                }, v8::WeakCallbackType::kParameter);
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
                               std::vector<std::string> texts;
                               std::vector<std::vector<double>> arrays;
                               if (!toValues(*d->adapter, info, args, texts, arrays)) {
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
                               info.GetReturnValue().Set(fromValue(*d->adapter, result));
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
            properties.push_back({path, false, binding.fixedMembers.count(path) > 0});
        }
        for (const auto& [path, settable, fixed] : properties) {
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
                                   std::vector<std::string> texts;
                                   std::vector<std::vector<double>> arrays;
                                   tn_diagnostic_t diagnostic{nullptr, 0};
                                   if (!toValues(*d->adapter, info, args, texts, arrays) || args.size() != 1 ||
                                       tn_set(h, d->name.c_str(), &args[0], &diagnostic) != TN_OK) {
                                       throwStatus(info.GetIsolate(), diagnostic);
                                   }
                               },
                               v8::External::New(isolate_, data))
                         : v8::Local<v8::FunctionTemplate>());
        }
        classes_[type].Reset(isolate_, ctor);
        target->Set(context, str(isolate_, name), ctor->GetFunction(context).ToLocalChecked()).Check();
    }
}

}  // namespace tn::adapters::v8adapter
