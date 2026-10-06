#include "tsl.h"

#include <cmath>
#include <bit>
#include <limits>
#include <stdexcept>
#include <utility>

namespace tn::adapters::v8adapter {
namespace g = engine::shader::graph;
using engine::shader::Type;

struct Tsl::Wrapper {
    Tsl* owner;
    g::Node node;
    g::Storage storage;
    v8::Global<v8::Object> object;
    uint64_t scope = 0;
    size_t statement = 0;
};
struct Tsl::Call {
    Tsl* owner;
    std::string name;
    bool method;
};

namespace {
struct JsFailure {}; // A callback/property getter already threw; preserve its JS exception.

v8::Local<v8::String> str(v8::Isolate* isolate, const std::string& text) {
    return v8::String::NewFromUtf8(isolate, text.c_str()).ToLocalChecked();
}
std::string text(v8::Isolate* isolate, v8::Local<v8::Value> value) {
    if (!value->IsString())
        throw std::runtime_error("expected a string");
    v8::String::Utf8Value utf8(isolate, value);
    return std::string(*utf8, utf8.length());
}
double number(v8::Local<v8::Value> value) {
    if (!value->IsNumber() || !std::isfinite(value.As<v8::Number>()->Value()))
        throw std::runtime_error("expected a finite number");
    return value.As<v8::Number>()->Value();
}
int32_t count(v8::Local<v8::Value> value) {
    const double n = number(value);
    if (n < 0 || n > std::numeric_limits<int32_t>::max() || n != std::floor(n))
        throw std::runtime_error("expected a nonnegative i32 count");
    return static_cast<int32_t>(n);
}
Type type(const std::string& name) {
    if (name == "float")
        return Type::f32();
    if (name == "int")
        return Type::i32();
    if (name == "uint")
        return Type::u32();
    if (name == "vec2")
        return Type::vec(2);
    if (name == "vec3")
        return Type::vec(3);
    if (name == "vec4")
        return Type::vec(4);
    throw std::runtime_error("unsupported TSL type: " + name);
}
v8::Local<v8::Function> callback(v8::Local<v8::Value> value) {
    if (!value->IsFunction())
        throw std::runtime_error("expected a callback");
    return value.As<v8::Function>();
}
} // namespace

Tsl::Tsl(v8::Isolate* isolate) : isolate_(isolate) {}

Tsl::~Tsl() {
    v8::HandleScope scope(isolate_);
    for (Wrapper* w : wrappers_) {
        w->object.Get(isolate_)->SetInternalField(1, v8::External::New(isolate_, nullptr));
        w->object.Reset();
        delete w;
    }
}

Tsl::Wrapper* Tsl::wrapper(v8::Local<v8::Value> value) const {
    if (!value->IsObject())
        return nullptr;
    const auto object = value.As<v8::Object>();
    if (object->InternalFieldCount() != 2)
        return nullptr;
    const auto tag = object->GetInternalField(0);
    const auto handle = object->GetInternalField(1);
    if (!tag->IsValue() || !tag.As<v8::Value>()->IsExternal() || tag.As<v8::External>()->Value() != this ||
        !handle->IsValue() || !handle.As<v8::Value>()->IsExternal())
        return nullptr;
    return static_cast<Wrapper*>(handle.As<v8::External>()->Value());
}

bool Tsl::unwrap(v8::Local<v8::Value> value, g::Node& node) const {
    Wrapper* w = wrapper(value);
    if (!w || !w->node)
        return false;
    node = w->node;
    return true;
}

g::Node Tsl::input(v8::Local<v8::Value> value) const {
    if (value->IsNumber())
        return g::float_(number(value));
    Wrapper* w = wrapper(value);
    if (!w || !w->node)
        throw std::runtime_error("expected a TSL node or number");
    return w->node->kind == g::Kind::Var ? g::Var{w->node, w->node->type}.read() : w->node;
}

v8::Local<v8::Object> Tsl::wrap(g::Node node) {
    if (node) for (const auto* w : wrappers_) if (w->node == node) return w->object.Get(isolate_);
    const auto object = nodeTemplate_.Get(isolate_)->NewInstance(isolate_->GetCurrentContext()).ToLocalChecked();
    auto* w = new Wrapper{this, std::move(node), {}, {}, 0, 0};
    object->SetInternalField(0, v8::External::New(isolate_, this));
    object->SetInternalField(1, v8::External::New(isolate_, w));
    w->object.Reset(isolate_, object);
    wrappers_.insert(w);
    w->object.SetWeak(
        w,
        [](const v8::WeakCallbackInfo<Wrapper>& info) {
            Wrapper* w = info.GetParameter();
            w->owner->wrappers_.erase(w);
            w->object.Reset();
            delete w;
        },
        v8::WeakCallbackType::kParameter);
    return object;
}

g::Node Tsl::capture(v8::Local<v8::Function> callback, v8::Local<v8::Value> argument) {
    std::vector<g::Node> body;
    auto* parent = statements_;
    const uint64_t parentScope = scope_;
    statements_ = &body;
    scope_ = ++nextScope_;
    v8::Local<v8::Value> result;
    const auto ctx = isolate_->GetCurrentContext();
    const bool ok =
        callback
            ->Call(ctx, v8::Undefined(isolate_), argument.IsEmpty() ? 0 : 1, argument.IsEmpty() ? nullptr : &argument)
            .ToLocal(&result);
    statements_ = parent;
    scope_ = parentScope;
    if (!ok)
        throw JsFailure{};
    if (body.empty() && !result->IsUndefined())
        return input(result);
    auto node = std::make_shared<g::NodeData>();
    node->kind = g::Kind::Body;
    node->body = std::move(body);
    return node;
}

v8::Local<v8::FunctionTemplate> Tsl::function(v8::Local<v8::Context> context, const char* name, bool method) {
    auto data = std::make_unique<Call>(Call{this, name, method});
    const auto fn = v8::FunctionTemplate::New(isolate_, dispatch, v8::External::New(isolate_, data.get()));
    fn->SetClassName(str(isolate_, name));
    calls_.push_back(std::move(data));
    return fn;
}

void Tsl::dispatch(const v8::FunctionCallbackInfo<v8::Value>& info) {
    const auto* call = static_cast<Call*>(info.Data().As<v8::External>()->Value());
    try {
        call->owner->call(*call, info);
    } catch (const JsFailure&) {
        // The original JS exception is still pending.
    } catch (const std::exception& error) {
        info.GetIsolate()->ThrowException(
            v8::Exception::TypeError(str(info.GetIsolate(), "TN_TSL " + call->name + ": " + error.what())));
    }
}

void Tsl::call(const Call& call, const v8::FunctionCallbackInfo<v8::Value>& info) {
    const std::string& name = call.name;
    const auto ctx = isolate_->GetCurrentContext();
    const auto arity = [&](int n) {
        if (info.Length() != n)
            throw std::runtime_error("expected " + std::to_string(n) + " arguments");
    };
    Wrapper* self = call.method ? wrapper(info.This()) : nullptr;
    if (call.method && !self)
        throw std::runtime_error("invalid TSL receiver");
    const auto arg = [&](int i) { return input(info[i]); };
    const auto lhs = [&] { return call.method ? input(info.This()) : arg(0); };
    const auto rhs = [&] { return arg(call.method ? 0 : 1); };
    const auto result = [&](g::Node node) { info.GetReturnValue().Set(wrap(std::move(node))); };
    const auto statement = [&] {
        if (!statements_)
            throw std::runtime_error("statement outside Fn");
    };

    if (name == "setName") {
        arity(1);
        const std::string label = text(isolate_, info[0]);
        if (label.empty())
            throw std::runtime_error("empty name");
        if (!self->node)
            self->storage.name = label;
        else if (self->node->kind == g::Kind::Uniform)
            self->node = g::uniform(label, self->node->type, self->node->values);
        else
            throw std::runtime_error("setName requires a uniform or storage buffer");
        info.GetReturnValue().Set(info.This());
        return;
    }
    if (name == "element") {
        arity(1);
        if (self->node)
            throw std::runtime_error("element requires a storage buffer");
        if (self->storage.name.empty())
            throw std::runtime_error("storage buffer needs setName");
        return result(self->storage.element(arg(0)));
    }
    if (name == "toVar") {
        arity(0);
        statement();
        g::Block block;
        const auto variable = block.var(lhs());
        statements_->push_back(variable.declaration);
        return result(variable.declaration);
    }
    if (name == "assign") {
        arity(1);
        statement();
        if (!self->node || (self->node->kind != g::Kind::Var && self->node->kind != g::Kind::StorageElement))
            throw std::runtime_error("assign requires a variable or storage element");
        g::Block block;
        block.assign(self->node, arg(0));
        statements_->push_back(block.node()->body[0]);
        info.GetReturnValue().Set(info.This());
        return;
    }
    if (name == "Else") {
        arity(1);
        statement();
        if (!self->node || self->node->kind != g::Kind::If || self->scope != scope_ ||
            self->statement >= statements_->size() || (*statements_)[self->statement] != self->node ||
            !self->node->otherwise.empty())
            throw std::runtime_error("Else requires an If in this stack");
        const auto branch = capture(callback(info[0]));
        if (branch->kind != g::Kind::Body)
            throw std::runtime_error("Else callback must contain statements");
        auto node = std::make_shared<g::NodeData>(*self->node);
        node->otherwise = branch->body;
        self->node = node;
        (*statements_)[self->statement] = node;
        info.GetReturnValue().Set(info.This());
        return;
    }
    if (name == "Fn") {
        arity(1);
        const auto graph = wrap(capture(callback(info[0])));
        // Fn builds once at definition. Calling the returned function only returns that graph.
        const auto fn =
            v8::Function::New(
                ctx, [](const v8::FunctionCallbackInfo<v8::Value>& call) { call.GetReturnValue().Set(call.Data()); },
                graph)
                .ToLocalChecked();
        info.GetReturnValue().Set(fn);
        return;
    }
    if (name == "If") {
        arity(2);
        statement();
        const auto condition = arg(0);
        const auto branch = capture(callback(info[1]));
        if (branch->kind != g::Kind::Body)
            throw std::runtime_error("If callback must contain statements");
        auto node = std::make_shared<g::NodeData>();
        node->kind = g::Kind::If;
        node->args = {condition};
        node->body = branch->body;
        const auto object = wrap(node);
        Wrapper* w = wrapper(object);
        w->scope = scope_;
        w->statement = statements_->size();
        statements_->push_back(node);
        info.GetReturnValue().Set(object);
        return;
    }
    if (name == "Loop") {
        arity(2);
        statement();
        const int32_t n = count(info[0]);
        const auto body = callback(info[1]);
        // Reuse the graph's loop/index creation; the adapter only captures its JS statements.
        g::Block block;
        g::Node captured;
        block.Loop(n, [&](g::Node index) {
            const auto inputs = v8::Object::New(isolate_);
            inputs->Set(ctx, str(isolate_, "i"), wrap(index)).Check();
            captured = capture(body, inputs);
            if (captured->kind != g::Kind::Body)
                throw std::runtime_error("Loop callback must contain statements");
        });
        auto node = std::make_shared<g::NodeData>(*block.node()->body[0]);
        node->body = captured->body;
        statements_->push_back(node);
        return result(node);
    }
    if (name == "instancedArray") {
        arity(2);
        if (count(info[0]) == 0)
            throw std::runtime_error("storage count must be positive");
        const auto object = wrap({});
        wrapper(object)->storage = g::storage("", type(text(isolate_, info[1])));
        info.GetReturnValue().Set(object);
        return;
    }
    if (name == "uniform") {
        arity(1);
        const auto value = arg(0);
        if (value->type == Type{})
            throw std::runtime_error("uniform value needs a concrete type");
        std::vector<float> values;
        const std::function<void(g::Node)> constant = [&](g::Node n) {
            if (n->kind == g::Kind::Constant && n->type == Type::f32()) {
                values.push_back(std::bit_cast<float>(static_cast<uint32_t>(n->bits)));
            } else if (n->kind == g::Kind::Join) {
                const size_t start = values.size();
                for (const auto& part : n->args) constant(part);
                if (values.size() - start == 1) values.resize(start + n->type.rows, values.back());
            } else throw std::runtime_error("uniform needs a constant float or vector value");
        };
        constant(value);
        return result(g::uniform("nodeUniform" + std::to_string(++nextScope_), value->type, std::move(values)));
    }
    if (name == "attribute") {
        arity(2);
        return result(g::attribute(text(isolate_, info[0]), type(text(isolate_, info[1]))));
    }
    if (name == "texture") {
        arity(2);
        if (!info[0]->IsObject())
            throw std::runtime_error("expected a texture with a name");
        v8::Local<v8::Value> label;
        if (!info[0].As<v8::Object>()->Get(ctx, str(isolate_, "name")).ToLocal(&label))
            throw JsFailure{};
        const auto map = text(isolate_, label);
        if (map.empty())
            throw std::runtime_error("texture needs a name");
        return result(g::texture(map, arg(1)));
    }
    if (name == "uv") {
        arity(0);
        return result(g::uv());
    }
    if (name == "float" || name == "int" || name == "uint") {
        arity(1);
        if (info[0]->IsNumber()) {
            const double n = number(info[0]);
            if (name == "float")
                return result(g::float_(n));
            const double minimum = name == "uint" ? 0 : std::numeric_limits<int32_t>::min();
            const double maximum =
                name == "uint" ? std::numeric_limits<uint32_t>::max() : std::numeric_limits<int32_t>::max();
            if (n < minimum || n > maximum || n != std::floor(n))
                throw std::runtime_error("integer out of range");
            return result(name == "int" ? g::int_(static_cast<int32_t>(n)) : g::uint_(static_cast<uint32_t>(n)));
        }
        if (name == "float")
            return result(g::float_(arg(0)));
        if (name == "uint")
            return result(g::uint_(arg(0)));
        auto node = std::make_shared<g::NodeData>();
        node->kind = g::Kind::Convert;
        node->type = Type::i32();
        node->args = {arg(0)};
        return result(node);
    }
    if (name == "vec2" || name == "vec3" || name == "vec4") {
        const int lanes = name.back() - '0';
        if (info.Length() < 1 || info.Length() > lanes)
            throw std::runtime_error("invalid vector argument count");
        std::vector<g::Node> parts;
        for (int i = 0; i < info.Length(); ++i)
            parts.push_back(arg(i));
        // graph.h's fixed initializer-list API: the vector's lane count is still checked by lower().
        const auto join = [&](std::initializer_list<g::Node> args) {
            return lanes == 2 ? g::vec2(args) : lanes == 3 ? g::vec3(args) : g::vec4(args);
        };
        if (parts.size() == 1)
            return result(join({parts[0]}));
        if (parts.size() == 2)
            return result(join({parts[0], parts[1]}));
        if (parts.size() == 3)
            return result(join({parts[0], parts[1], parts[2]}));
        return result(join({parts[0], parts[1], parts[2], parts[3]}));
    }
    if (name.rfind("swizzle:", 0) == 0) {
        arity(0);
        return result(g::swizzle(lhs(), name.substr(8)));
    }
#define BINARY(symbol)                                                                                                 \
    if (name == #symbol) {                                                                                             \
        arity(call.method ? 1 : 2);                                                                                    \
        return result(g::symbol(lhs(), rhs()));                                                                        \
    }
    BINARY(add)
    BINARY(sub)
    BINARY(mul) BINARY(div) BINARY(lessThan) BINARY(greaterThan) BINARY(equal) BINARY(min) BINARY(max) BINARY(pow)
        BINARY(step) BINARY(dot) BINARY(distance) BINARY(cross)
#undef BINARY
#define UNARY(symbol)                                                                                                  \
    if (name == #symbol) {                                                                                             \
        arity(call.method ? 0 : 1);                                                                                    \
        return result(g::symbol(lhs()));                                                                               \
    }
            UNARY(negate) UNARY(abs) UNARY(sin) UNARY(cos) UNARY(floor) UNARY(fract) UNARY(sqrt) UNARY(exp) UNARY(exp2)
                UNARY(log2) UNARY(normalize) UNARY(length)
#undef UNARY
#define TERNARY(symbol)                                                                                                \
    if (name == #symbol) {                                                                                             \
        arity(3);                                                                                                      \
        return result(g::symbol(arg(0), arg(1), arg(2)));                                                              \
    }
                    TERNARY(select) TERNARY(mix) TERNARY(clamp) TERNARY(smoothstep)
#undef TERNARY
                        throw std::runtime_error("unsupported operation");
}

void Tsl::install(v8::Local<v8::Context> context, v8::Local<v8::Object> target) {
    const auto node = v8::ObjectTemplate::New(isolate_);
    node->SetInternalFieldCount(2);
    for (const char* name : {"add", "sub", "mul", "div", "negate", "lessThan", "greaterThan", "equal", "setName",
                             "toVar", "assign", "element", "Else"})
        node->Set(str(isolate_, name), function(context, name, true));
    for (const char* lanes : {"x", "y", "z", "w", "xy", "xyz", "zyx", "yx"}) {
        auto data = std::make_unique<Call>(Call{this, std::string("swizzle:") + lanes, true});
        node->SetAccessorProperty(
            str(isolate_, lanes),
            v8::FunctionTemplate::New(isolate_, dispatch, v8::External::New(isolate_, data.get())));
        calls_.push_back(std::move(data));
    }
    nodeTemplate_.Reset(isolate_, node);
    const auto module = v8::Object::New(isolate_);
    for (const char* name : {"float",      "int",   "uint",    "vec2",      "vec3",   "vec4",     "uniform",
                             "attribute",  "uv",    "texture", "Fn",        "If",     "Loop",     "instancedArray",
                             "add",        "sub",   "mul",     "div",       "negate", "lessThan", "greaterThan",
                             "equal",      "abs",   "sin",     "cos",       "floor",  "fract",    "sqrt",
                             "exp",        "exp2",  "log2",    "normalize", "length", "min",      "max",
                             "pow",        "step",  "dot",     "distance",  "cross",  "mix",      "clamp",
                             "smoothstep", "select"})
        module->Set(context, str(isolate_, name), function(context, name, false)->GetFunction(context).ToLocalChecked())
            .Check();
    module->Set(context, str(isolate_, "positionLocal"), wrap(g::positionLocal())).Check();
    module->Set(context, str(isolate_, "positionWorld"), wrap(g::varying("positionWorld", Type::vec(3)))).Check();
    module->Set(context, str(isolate_, "normalViewGeometry"), wrap(g::varying("normalViewGeometry", Type::vec(3)))).Check();
    module->Set(context, str(isolate_, "instanceIndex"), wrap(g::instanceIndex())).Check();
    // The existing V8 hosts execute bundled scripts with globals; they have no ES module resolver.
    target->Set(context, str(isolate_, "tsl"), module).Check();
}

} // namespace tn::adapters::v8adapter
