// BufferGeometry, BufferAttribute and the geometry generators in the engine's one binding registry
// (PRD-508 phase 3). Members (`attributes.position`, `index`, `boundingBox`, `boundingSphere`) are
// read as Refs to the member itself, so a caller writes through the object rather than a copy; plain
// values (`array`, `parameters`, `groups`) are getters.

#include "engine/abi/bindings.h"

#include "engine/foundation/math/Matrix.h"
#include "engine/scene/geometry.h"
#include "engine/scene/geometries.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <memory>
#include <string>
#include <vector>

namespace tn::binding {

using namespace tn::engine;

namespace {

double optional(const Args& a, size_t i, double fallback) {
    return i < a.size() ? number(a.at(i)) : fallback;
}

bool flag(const Value& v) { return v.kind == Value::Kind::Bool ? v.flag : number(v) != 0; }

bool boolean(const Args& a, size_t i, bool fallback) {
    return i < a.size() ? flag(a.at(i)) : fallback;
}

template <typename T>
T* as(void* self) {
    return static_cast<T*>(self);
}

Value numbers(const std::vector<double>& values) { return Value::list(values); }

/** Any geometry class a fixture can name, matched against one base pointer. */
BufferGeometry& geometryArg(Store& store, const Value& arg) {
    static const char* const kClasses[] = {
        "BufferGeometry", "PlaneGeometry",  "BoxGeometry",   "SphereGeometry", "CylinderGeometry",
        "ConeGeometry",   "CircleGeometry", "TorusGeometry", "RingGeometry"};
    Object* found = store.find(arg);
    if (found == nullptr) throw Unsupported{"argument is not a BufferGeometry"};
    for (const char* cls : kClasses) {
        if (found->cls == cls) return *static_cast<BufferGeometry*>(found->ptr.get());
    }
    throw Unsupported{"argument is not a BufferGeometry, it is a " + found->cls};
}

/** Any buffer attribute class a fixture can name, matched against one base pointer. */
/**
 * A JS array index: a non-negative safe integer. Anything else (a fraction, a negative number, NaN)
 * names no element, so it maps to an index past every array: reads answer undefined and writes do
 * nothing, as typed-array access does.
 */
uint64_t jsIndex(const Value& v) {
    const double i = number(v);
    if (!(i >= 0 && i <= 9007199254740991.0) || i != std::floor(i)) return UINT64_MAX;
    return static_cast<uint64_t>(i);
}

int jsComponent(const Value& v) {
    const double c = number(v);
    return (c >= 0 && c < 2147483647.0 && c == std::floor(c)) ? static_cast<int>(c) : -1;  // -1 names nothing
}

/** One component, or undefined (null) past the end of the array. */
Value component(const BufferAttribute& attribute, uint64_t index, int c) {
    uint64_t at = 0;
    return attribute.element(index, c, at) ? Value::of(attribute.getComponent(index, c)) : Value{};
}

/** The caller's attribute itself (not a copy): three stores the reference it is handed. */
std::shared_ptr<BufferAttribute> sharedAttributeArg(Store& store, const Value& arg) {
    Object* found = store.find(arg);
    if (found == nullptr) throw Unsupported{"argument is not a BufferAttribute"};
    if (found->cls == "BufferAttribute" || found->cls == "Float32BufferAttribute" ||
        found->cls == "Uint16BufferAttribute" || found->cls == "Uint32BufferAttribute") {
        return std::static_pointer_cast<BufferAttribute>(found->ptr);
    }
    throw Unsupported{"argument is not a BufferAttribute, it is a " + found->cls};
}

BufferAttribute& attributeArg(Store& store, const Value& arg) {
    Object* found = store.find(arg);
    if (found == nullptr) throw Unsupported{"argument is not a BufferAttribute"};
    if (found->cls == "BufferAttribute" || found->cls == "Float32BufferAttribute" ||
        found->cls == "Uint16BufferAttribute" || found->cls == "Uint32BufferAttribute") {
        return *static_cast<BufferAttribute*>(found->ptr.get());
    }
    throw Unsupported{"argument is not a BufferAttribute, it is a " + found->cls};
}

Value string(std::string text) { return Value{Value::Kind::String, 0, std::move(text)}; }

Value attributeArray(const BufferGeometry& geometry, const char* name) {
    const std::shared_ptr<BufferAttribute> attribute = geometry.getAttribute(name);
    if (attribute == nullptr) throw Unsupported{std::string("this geometry has no ") + name + " attribute"};
    return numbers(attribute->toNumbers());
}


// ---------------------------------------------------------------- BufferAttribute

void registerBufferAttribute(ClassBinding& b) {
    b.ctor = [](const Args& a, Store&) {
        std::vector<double> values;
        if (!a.empty() && a.at(0).kind == Value::Kind::Numbers) values = a.at(0).numbers;
        // BufferAttribute( array, itemSize, normalized = false ); itemSize is a positive integer.
        const double itemSize = optional(a, 1, 1);
        if (!(itemSize >= 1 && itemSize <= 65536) || itemSize != std::floor(itemSize)) throw Unsupported{"itemSize must be a positive integer"};
        const bool normalized = a.size() > 2 && flag(a.at(2));
        return std::static_pointer_cast<void>(
            BufferAttribute::fromDoubles(Scalar::F32, values, static_cast<int>(itemSize), normalized));
    };
    b.getters["array"] = [](void* self) { return numbers(as<BufferAttribute>(self)->toNumbers()); };
    b.getters["count"] = [](void* self) { return Value::of(double(as<BufferAttribute>(self)->count())); };
    b.getters["itemSize"] = [](void* self) { return Value::of(double(as<BufferAttribute>(self)->itemSize)); };
    b.getters["normalized"] = [](void* self) { return Value::of(as<BufferAttribute>(self)->normalized); };
    b.getters["usage"] = [](void* self) { return Value::of(double(as<BufferAttribute>(self)->usage)); };
    b.getters["gpuType"] = [](void* self) { return Value::of(double(as<BufferAttribute>(self)->gpuType)); };
    b.getters["version"] = [](void* self) { return Value::of(double(as<BufferAttribute>(self)->version())); };
    b.getters["id"] = [](void* self) { return Value::of(double(as<BufferAttribute>(self)->id)); };
    b.getters["name"] = [](void* self) { return string(as<BufferAttribute>(self)->name); };
    b.setters["name"] = [](void* self, const Value& v) {
        if (v.kind != Value::Kind::String) throw Unsupported{"name must be a string"};
        as<BufferAttribute>(self)->name = v.text;
    };
    b.setters["needsUpdate"] = [](void* self, const Value& v) {
        if (flag(v)) as<BufferAttribute>(self)->setNeedsUpdate();
    };

    b.methods["getX"] = [](void* self, const Args& a, Store&) {
        return component(*as<BufferAttribute>(self), jsIndex(a.at(0)), 0);
    };
    b.methods["getY"] = [](void* self, const Args& a, Store&) {
        return component(*as<BufferAttribute>(self), jsIndex(a.at(0)), 1);
    };
    b.methods["getZ"] = [](void* self, const Args& a, Store&) {
        return component(*as<BufferAttribute>(self), jsIndex(a.at(0)), 2);
    };
    b.methods["getW"] = [](void* self, const Args& a, Store&) {
        return component(*as<BufferAttribute>(self), jsIndex(a.at(0)), 3);
    };
    b.methods["getComponent"] = [](void* self, const Args& a, Store&) {
        const double c = number(a.at(1));
        if (!(c >= 0 && c < 2147483647.0) || c != std::floor(c)) return Value{};
        return component(*as<BufferAttribute>(self), jsIndex(a.at(0)), static_cast<int>(c));
    };
    b.methods["setComponent"] = [](void* self, const Args& a, Store&) {
        as<BufferAttribute>(self)->setComponent(jsIndex(a.at(0)),
                                                jsComponent(a.at(1)), number(a.at(2)));
        return chain();
    };
    b.methods["setX"] = [](void* self, const Args& a, Store&) {
        as<BufferAttribute>(self)->setX(jsIndex(a.at(0)), number(a.at(1)));
        return chain();
    };
    b.methods["setY"] = [](void* self, const Args& a, Store&) {
        as<BufferAttribute>(self)->setY(jsIndex(a.at(0)), number(a.at(1)));
        return chain();
    };
    b.methods["setZ"] = [](void* self, const Args& a, Store&) {
        as<BufferAttribute>(self)->setZ(jsIndex(a.at(0)), number(a.at(1)));
        return chain();
    };
    b.methods["setW"] = [](void* self, const Args& a, Store&) {
        as<BufferAttribute>(self)->setW(jsIndex(a.at(0)), number(a.at(1)));
        return chain();
    };
    b.methods["setXY"] = [](void* self, const Args& a, Store&) {
        as<BufferAttribute>(self)->setXY(jsIndex(a.at(0)), number(a.at(1)),
                                         number(a.at(2)));
        return chain();
    };
    b.methods["setXYZ"] = [](void* self, const Args& a, Store&) {
        as<BufferAttribute>(self)->setXYZ(jsIndex(a.at(0)), number(a.at(1)),
                                          number(a.at(2)), number(a.at(3)));
        return chain();
    };
    b.methods["setXYZW"] = [](void* self, const Args& a, Store&) {
        as<BufferAttribute>(self)->setXYZW(jsIndex(a.at(0)), number(a.at(1)),
                                           number(a.at(2)), number(a.at(3)), number(a.at(4)));
        return chain();
    };
    b.methods["copyAt"] = [](void* self, const Args& a, Store& store) {
        as<BufferAttribute>(self)->copyAt(jsIndex(a.at(0)),
                                          attributeArg(store, a.at(1)), jsIndex(a.at(2)));
        return chain();
    };
    b.methods["applyMatrix3"] = [](void* self, const Args& a, Store& store) {
        as<BufferAttribute>(self)->applyMatrix3(store.ref<Matrix3>(a.at(0), "Matrix3"));
        return chain();
    };
    b.methods["applyMatrix4"] = [](void* self, const Args& a, Store& store) {
        as<BufferAttribute>(self)->applyMatrix4(store.ref<Matrix4>(a.at(0), "Matrix4"));
        return chain();
    };
    b.methods["applyNormalMatrix"] = [](void* self, const Args& a, Store& store) {
        as<BufferAttribute>(self)->applyNormalMatrix(store.ref<Matrix3>(a.at(0), "Matrix3"));
        return chain();
    };
    b.methods["transformDirection"] = [](void* self, const Args& a, Store& store) {
        as<BufferAttribute>(self)->transformDirection(store.ref<Matrix4>(a.at(0), "Matrix4"));
        return chain();
    };
}

// ----------------------------------------------------------------- BufferGeometry

void registerBufferGeometry(ClassBinding& b) {
    b.ctor = [](const Args&, Store&) {
        return std::static_pointer_cast<void>(std::make_shared<BufferGeometry>());
    };
    b.getters["type"] = [](void* self) { return string(as<BufferGeometry>(self)->type); };
    b.getters["name"] = [](void* self) { return string(as<BufferGeometry>(self)->name); };
    b.setters["name"] = [](void* self, const Value& v) { as<BufferGeometry>(self)->name = v.text; };
    b.getters["id"] = [](void* self) { return Value::of(double(as<BufferGeometry>(self)->id)); };
    b.getters["revision"] = [](void* self) { return Value::of(double(as<BufferGeometry>(self)->revision())); };
    b.getters["drawRange.start"] = [](void* self) { return Value::of(as<BufferGeometry>(self)->drawRange.start); };
    b.getters["drawRange.count"] = [](void* self) { return Value::of(as<BufferGeometry>(self)->drawRange.count); };
    b.getters["groups"] = [](void* self) { return string(as<BufferGeometry>(self)->groupsJson()); };
    b.getters["parameters"] = [](void* self) {
        std::string json = as<BufferGeometry>(self)->parametersJson();
        if (json.empty()) throw Unsupported{"this geometry has no parameters"};
        return string(std::move(json));
    };
    b.getters["attributes.position.array"] = [](void* self) {
        return attributeArray(*as<BufferGeometry>(self), "position");
    };
    b.getters["attributes.normal.array"] = [](void* self) {
        return attributeArray(*as<BufferGeometry>(self), "normal");
    };
    b.getters["attributes.uv.array"] = [](void* self) {
        return attributeArray(*as<BufferGeometry>(self), "uv");
    };
    b.getters["attributes.color.array"] = [](void* self) {
        return attributeArray(*as<BufferGeometry>(self), "color");
    };
    b.getters["index.array"] = [](void* self) {
        const std::shared_ptr<BufferAttribute> index = as<BufferGeometry>(self)->index;
        if (index == nullptr) throw Unsupported{"this geometry has no index"};
        return numbers(index->toNumbers());
    };
    b.getters["boundingSphere.radius"] = [](void* self) {
        const std::shared_ptr<Sphere> sphere = as<BufferGeometry>(self)->boundingSphere;
        if (sphere == nullptr) throw Unsupported{"computeBoundingSphere() has not run"};
        return Value::of(sphere->radius);
    };
    b.getters["boundingSphere.center.x"] = [](void* self) {
        const std::shared_ptr<Sphere> sphere = as<BufferGeometry>(self)->boundingSphere;
        if (sphere == nullptr) throw Unsupported{"computeBoundingSphere() has not run"};
        return Value::of(sphere->center.x);
    };
    b.getters["boundingSphere.center.y"] = [](void* self) {
        const std::shared_ptr<Sphere> sphere = as<BufferGeometry>(self)->boundingSphere;
        if (sphere == nullptr) throw Unsupported{"computeBoundingSphere() has not run"};
        return Value::of(sphere->center.y);
    };
    b.getters["boundingSphere.center.z"] = [](void* self) {
        const std::shared_ptr<Sphere> sphere = as<BufferGeometry>(self)->boundingSphere;
        if (sphere == nullptr) throw Unsupported{"computeBoundingSphere() has not run"};
        return Value::of(sphere->center.z);
    };
    for (int i = 0; i < 3; ++i) {
        b.getters[std::string("boundingBox.min.") + "xyz"[i]] = [i](void* self) {
            const std::shared_ptr<Box3> box = as<BufferGeometry>(self)->boundingBox;
            if (box == nullptr) throw Unsupported{"computeBoundingBox() has not run"};
            return Value::of(i == 0 ? box->min.x : (i == 1 ? box->min.y : box->min.z));
        };
        b.getters[std::string("boundingBox.max.") + "xyz"[i]] = [i](void* self) {
            const std::shared_ptr<Box3> box = as<BufferGeometry>(self)->boundingBox;
            if (box == nullptr) throw Unsupported{"computeBoundingBox() has not run"};
            return Value::of(i == 0 ? box->max.x : (i == 1 ? box->max.y : box->max.z));
        };
    }

    b.members["attributes.position"] = [](void* self, const Args&, Store& store) {
        BufferGeometry* geometry = as<BufferGeometry>(self);
        return store.share("BufferAttribute", geometry->getAttribute("position"));
    };
    b.members["attributes.normal"] = [](void* self, const Args&, Store& store) {
        BufferGeometry* geometry = as<BufferGeometry>(self);
        return store.share("BufferAttribute", geometry->getAttribute("normal"));
    };
    b.members["attributes.uv"] = [](void* self, const Args&, Store& store) {
        BufferGeometry* geometry = as<BufferGeometry>(self);
        return store.share("BufferAttribute", geometry->getAttribute("uv"));
    };
    b.members["index"] = [](void* self, const Args&, Store& store) {
        BufferGeometry* geometry = as<BufferGeometry>(self);
        return store.share("BufferAttribute", geometry->index);
    };
    b.members["boundingBox"] = [](void* self, const Args&, Store& store) {
        return store.share("Box3", as<BufferGeometry>(self)->boundingBox);
    };
    b.members["boundingSphere"] = [](void* self, const Args&, Store& store) {
        return store.share("Sphere", as<BufferGeometry>(self)->boundingSphere);
    };

    b.methods["setIndex"] = [](void* self, const Args& a, Store& store) {
        BufferGeometry* geometry = as<BufferGeometry>(self);
        if (!a.empty() && a.at(0).kind == Value::Kind::Ref) {
            geometry->setIndex(sharedAttributeArg(store, a.at(0)));
        } else if (!a.empty() && a.at(0).kind == Value::Kind::Numbers) {
            // three: new (arrayNeedsUint32(index) ? Uint32 : Uint16)BufferAttribute(index, 1), deciding on the
            // numbers as given and then converting each as the typed array does (ToUint16/32).
            const std::vector<double>& values = a.at(0).numbers;
            const bool wide = std::any_of(values.begin(), values.end(), [](double v) { return v >= 65535; });
            geometry->setIndex(BufferAttribute::fromDoubles(wide ? Scalar::U32 : Scalar::U16, values, 1));
        } else {
            throw Unsupported{"setIndex needs a BufferAttribute or an array"};
        }
        return chain();
    };
    b.methods["getIndex"] = [](void* self, const Args&, Store& store) {
        BufferGeometry* geometry = as<BufferGeometry>(self);
        if (geometry->index == nullptr) return Value{};
        return store.share("BufferAttribute", geometry->index);
    };
    b.methods["setAttribute"] = [](void* self, const Args& a, Store& store) {
        if (a.at(0).kind != Value::Kind::String) throw Unsupported{"setAttribute needs a name"};
        as<BufferGeometry>(self)->setAttribute(a.at(0).text, sharedAttributeArg(store, a.at(1)));
        return chain();
    };
    b.methods["getAttribute"] = [](void* self, const Args& a, Store& store) {
        const std::shared_ptr<BufferAttribute> attribute = as<BufferGeometry>(self)->getAttribute(a.at(0).text);
        if (attribute == nullptr) return Value{};
        return store.share("BufferAttribute", attribute);
    };
    b.methods["deleteAttribute"] = [](void* self, const Args& a, Store&) {
        as<BufferGeometry>(self)->deleteAttribute(a.at(0).text);
        return chain();
    };
    b.methods["hasAttribute"] = [](void* self, const Args& a, Store&) {
        return Value::of(as<BufferGeometry>(self)->hasAttribute(a.at(0).text));
    };
    b.methods["addGroup"] = [](void* self, const Args& a, Store&) {
        // addGroup( start, count, materialIndex = 0 ); a missing count is Infinity in practice (three
        // passes it through), and the numbers stay JS numbers.
        as<BufferGeometry>(self)->addGroup(number(a.at(0)), optional(a, 1, std::numeric_limits<double>::infinity()),
                                           optional(a, 2, 0));
        return chain();
    };
    b.methods["clearGroups"] = [](void* self, const Args&, Store&) {
        as<BufferGeometry>(self)->clearGroups();
        return chain();
    };
    b.methods["setDrawRange"] = [](void* self, const Args& a, Store&) {
        as<BufferGeometry>(self)->setDrawRange(number(a.at(0)), number(a.at(1)));
        return chain();
    };
    b.methods["computeBoundingBox"] = [](void* self, const Args&, Store&) {
        as<BufferGeometry>(self)->computeBoundingBox();
        return chain();
    };
    b.methods["computeBoundingSphere"] = [](void* self, const Args&, Store&) {
        as<BufferGeometry>(self)->computeBoundingSphere();
        return chain();
    };
    b.methods["computeVertexNormals"] = [](void* self, const Args&, Store&) {
        as<BufferGeometry>(self)->computeVertexNormals();
        return chain();
    };
    b.methods["normalizeNormals"] = [](void* self, const Args&, Store&) {
        as<BufferGeometry>(self)->normalizeNormals();
        return chain();
    };
    b.methods["applyMatrix4"] = [](void* self, const Args& a, Store& store) {
        as<BufferGeometry>(self)->applyMatrix4(store.ref<Matrix4>(a.at(0), "Matrix4"));
        return chain();
    };
    b.methods["translate"] = [](void* self, const Args& a, Store&) {
        as<BufferGeometry>(self)->translate(number(a.at(0)), number(a.at(1)), number(a.at(2)));
        return chain();
    };
    b.methods["rotateX"] = [](void* self, const Args& a, Store&) {
        as<BufferGeometry>(self)->rotateX(number(a.at(0)));
        return chain();
    };
    b.methods["rotateY"] = [](void* self, const Args& a, Store&) {
        as<BufferGeometry>(self)->rotateY(number(a.at(0)));
        return chain();
    };
    b.methods["rotateZ"] = [](void* self, const Args& a, Store&) {
        as<BufferGeometry>(self)->rotateZ(number(a.at(0)));
        return chain();
    };
    b.methods["scale"] = [](void* self, const Args& a, Store&) {
        as<BufferGeometry>(self)->scale(number(a.at(0)), number(a.at(1)), number(a.at(2)));
        return chain();
    };
    b.methods["center"] = [](void* self, const Args&, Store&) {
        as<BufferGeometry>(self)->center();
        return chain();
    };
    b.methods["toNonIndexed"] = [](void* self, const Args&, Store& store) {
        std::shared_ptr<BufferGeometry> nonIndexed = as<BufferGeometry>(self)->toNonIndexed();
        if (nonIndexed == nullptr) return chain();
        return store.adopt("BufferGeometry", std::static_pointer_cast<void>(nonIndexed));
    };
}

// -------------------------------------------------------------------- generators

template <typename Make>
void registerGenerator(Registry& classes, const char* name, Make make) {
    ClassBinding& b = classes[name];
    // A generator is a BufferGeometry in three, so it carries every base getter and method.
    registerBufferGeometry(b);
    b.ctor = [make](const Args& a, Store&) { return std::static_pointer_cast<void>(make(a)); };
}

void registerGeometryGenerators(Registry& classes) {
    registerGenerator(classes, "PlaneGeometry", [](const Args& a) {
        return makePlaneGeometry(optional(a, 0, 1), optional(a, 1, 1), optional(a, 2, 1),
                                 optional(a, 3, 1));
    });
    registerGenerator(classes, "BoxGeometry", [](const Args& a) {
        return makeBoxGeometry(optional(a, 0, 1), optional(a, 1, 1), optional(a, 2, 1), optional(a, 3, 1),
                               optional(a, 4, 1), optional(a, 5, 1));
    });
    registerGenerator(classes, "SphereGeometry", [](const Args& a) {
        return makeSphereGeometry(optional(a, 0, 1), optional(a, 1, 32), optional(a, 2, 16),
                                  optional(a, 3, 0), optional(a, 4, 6.283185307179586),
                                  optional(a, 5, 0), optional(a, 6, 3.141592653589793));
    });
    registerGenerator(classes, "CylinderGeometry", [](const Args& a) {
        return makeCylinderGeometry(optional(a, 0, 1), optional(a, 1, 1), optional(a, 2, 1),
                                    optional(a, 3, 32), optional(a, 4, 1), boolean(a, 5, false),
                                    optional(a, 6, 0), optional(a, 7, 6.283185307179586));
    });
    registerGenerator(classes, "ConeGeometry", [](const Args& a) {
        return makeConeGeometry(optional(a, 0, 1), optional(a, 1, 1), optional(a, 2, 32),
                                optional(a, 3, 1), boolean(a, 4, false), optional(a, 5, 0),
                                optional(a, 6, 6.283185307179586));
    });
    registerGenerator(classes, "CircleGeometry", [](const Args& a) {
        return makeCircleGeometry(optional(a, 0, 1), optional(a, 1, 32), optional(a, 2, 0),
                                  optional(a, 3, 6.283185307179586));
    });
    registerGenerator(classes, "TorusGeometry", [](const Args& a) {
        return makeTorusGeometry(optional(a, 0, 1), optional(a, 1, 0.4), optional(a, 2, 12),
                                 optional(a, 3, 48), optional(a, 4, 6.283185307179586),
                                 optional(a, 5, 0), optional(a, 6, 6.283185307179586));
    });
    registerGenerator(classes, "RingGeometry", [](const Args& a) {
        return makeRingGeometry(optional(a, 0, 0.5), optional(a, 1, 1), optional(a, 2, 32),
                                optional(a, 3, 1), optional(a, 4, 0), optional(a, 5, 6.283185307179586));
    });
}

}  // namespace

void registerGeometryBindings(Registry& classes) {
    registerBufferAttribute(classes["BufferAttribute"]);
    registerBufferGeometry(classes["BufferGeometry"]);
    registerGeometryGenerators(classes);
}

}  // namespace tn::binding
