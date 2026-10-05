// PRD-515 phase 1: every glTF in the corpus loads into the hierarchy three's GLTFLoader builds —
// names, types, parents, transforms, geometry layout, materials, skeletons and the clip list —
// compared against gltf_reference.json (written by gltf-reference.ts from the real loader).
#include <algorithm>
#include <cstdio>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include "engine/animation/skinning/skeleton.h"
#include "engine/assets/gltf/loader.h"
#include "engine/foundation/json.h"
#include "engine/scene/geometry.h"
#include "engine/scene/material.h"

using namespace tn::engine;
using tn::engine::json::Value;
using namespace tn::engine::animation;

namespace {

std::string readFile(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    return std::string(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
}

Value num(double v) { return Value::makeNumber(v); }
Value str(std::string s) { return Value::makeString(std::move(s)); }
Value flag(bool b) { return Value::makeBool(b); }
Value numbers(std::initializer_list<double> values) {
    std::vector<Value> items;
    for (double v : values) items.push_back(num(v));
    return Value::makeArray(std::move(items));
}

// Members sorted by key, all the way down: the comparison is of content, not of insertion order.
Value canonical(const Value& v) {
    if (v.isArray()) {
        std::vector<Value> items;
        for (const Value& item : v.items()) items.push_back(canonical(item));
        return Value::makeArray(std::move(items));
    }
    if (v.isObject()) {
        std::vector<std::pair<std::string, Value>> members;
        for (const auto& [key, value] : v.members()) members.emplace_back(key, canonical(value));
        std::sort(members.begin(), members.end(), [](const auto& a, const auto& b) { return a.first < b.first; });
        return Value::makeObject(std::move(members));
    }
    return v;
}

const char* arrayName(Scalar s) {
    switch (s) {
        case Scalar::I8: return "Int8Array";
        case Scalar::U8: return "Uint8Array";
        case Scalar::I16: return "Int16Array";
        case Scalar::U16: return "Uint16Array";
        case Scalar::U32: return "Uint32Array";
        case Scalar::I32: return "Int32Array";
        case Scalar::F64: return "Float64Array";
        default: return "Float32Array";
    }
}

const char* const kMapSlots[] = {
    "map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap", "alphaMap", "clearcoatMap",
    "clearcoatNormalMap", "clearcoatRoughnessMap", "sheenColorMap", "sheenRoughnessMap", "transmissionMap",
    "thicknessMap", "specularIntensityMap", "specularColorMap", "iridescenceMap", "iridescenceThicknessMap",
    "anisotropyMap"};

Value material(const Material& m) {
    std::vector<Value> maps;
    for (const char* slot : kMapSlots)
        if (m.maps.count(slot)) maps.push_back(str(slot));
    return Value::makeObject({{"type", str(std::string(m.typeName()))},
                              {"name", str(m.name)},
                              {"opacity", num(m.opacity)},
                              {"transparent", flag(m.transparent)},
                              {"side", num(static_cast<double>(m.side))},
                              {"alphaTest", num(m.alphaTest)},
                              {"depthWrite", flag(m.depthWrite)},
                              {"vertexColors", flag(m.vertexColors)},
                              {"color", numbers({m.color.r, m.color.g, m.color.b})},
                              {"emissive", numbers({m.emissive.r, m.emissive.g, m.emissive.b})},
                              {"roughness", num(m.roughness)},
                              {"metalness", num(m.metalness)},
                              {"emissiveIntensity", num(m.emissiveIntensity)},
                              {"flatShading", flag(m.flatShading)},
                              {"maps", Value::makeArray(std::move(maps))}});
}

void traverse(Object3D& object, std::vector<Object3D*>& out) {
    out.push_back(&object);
    for (Object3D* child : object.children) traverse(*child, out);
}

Value node(Object3D& o, const std::vector<Object3D*>& order) {
    const auto indexOf = [&](const Object3D* p) {
        const auto it = std::find(order.begin(), order.end(), p);
        return it == order.end() ? -1.0 : double(it - order.begin());
    };
    const auto q = o.quaternion.toArray();
    std::vector<std::pair<std::string, Value>> m = {
        {"name", str(o.name)},
        {"type", str(std::string(o.type()))},
        {"parent", num(o.parent ? indexOf(o.parent) : -1)},
        {"position", numbers({o.position.x, o.position.y, o.position.z})},
        {"quaternion", numbers({q[0], q[1], q[2], q[3]})},
        {"scale", numbers({o.scale.x, o.scale.y, o.scale.z})}};
    if (auto* mesh = dynamic_cast<Mesh*>(&o)) {
        std::vector<Value> attributes;
        for (const auto& [name, attribute] : mesh->geometry->attributes) // std::map: sorted by name
            attributes.push_back(Value::makeObject({{"name", str(name)},
                                                    {"itemSize", num(attribute->itemSize)},
                                                    {"count", num(double(attribute->count()))},
                                                    {"normalized", flag(attribute->normalized)},
                                                    {"array", str(arrayName(attribute->store->scalar()))}}));
        m.emplace_back("geometry",
                       Value::makeObject({{"attributes", Value::makeArray(std::move(attributes))},
                                          {"index", mesh->geometry->index ? num(double(mesh->geometry->index->count()))
                                                                          : Value::makeNull()},
                                          {"morphTargets", num(double(mesh->geometry->morphPositions.size()))},
                                          {"groups", num(0)}}));
        m.emplace_back("materials", Value::makeArray({material(*mesh->material)}));
        if (!mesh->morphTargetInfluences.empty()) {
            std::vector<Value> influences;
            for (double v : mesh->morphTargetInfluences) influences.push_back(num(v));
            m.emplace_back("morphTargetInfluences", Value::makeArray(std::move(influences)));
        }
    }
    if (auto* skinned = dynamic_cast<SkinnedMesh*>(&o)) {
        std::vector<Value> bones;
        for (std::size_t i = 0; i < skinned->skeleton->bones.size(); ++i) {
            const Bone* bone = skinned->skeleton->bone(i);
            bones.push_back(str(bone ? bone->name : ""));
        }
        m.emplace_back("skeleton", Value::makeArray(std::move(bones)));
    }
    return Value::makeObject(std::move(m));
}

const char* typeName(TrackType t) {
    switch (t) {
        case TrackType::Quaternion: return "quaternion";
        case TrackType::Number: return "number";
        case TrackType::Color: return "color";
        case TrackType::Bool: return "bool";
        default: return "vector";
    }
}

double interpolation(Interpolation i) {
    return i == Interpolation::Discrete ? 2300 : i == Interpolation::Smooth ? 2302 : 2301; // QuaternionLinear reads as Linear
}

Value dump(const std::string& file, gltf::LoadResult& loaded) {
    std::vector<Object3D*> order;
    traverse(*loaded.scene, order);
    std::vector<Value> nodes;
    for (Object3D* o : order) nodes.push_back(node(*o, order));
    std::vector<Value> clips;
    for (const auto& clip : loaded.animations) {
        std::vector<Value> tracks;
        for (const KeyframeTrack& t : clip->tracks)
            tracks.push_back(Value::makeObject({{"name", str(t.name)},
                                                {"type", str(typeName(t.type))},
                                                {"times", num(double(t.times.size()))},
                                                {"values", num(double(t.values.size()))},
                                                {"interpolation", num(interpolation(t.interpolation))}}));
        clips.push_back(Value::makeObject(
            {{"name", str(clip->name)}, {"duration", num(clip->duration)}, {"tracks", Value::makeArray(std::move(tracks))}}));
    }
    return Value::makeObject(
        {{"file", str(file)}, {"nodes", Value::makeArray(std::move(nodes))}, {"animations", Value::makeArray(std::move(clips))}});
}

// The first place two dumps differ, as a path.
std::string firstDifference(const Value& a, const Value& b, const std::string& at) {
    if (a.kind() != b.kind()) return at + " (kind)";
    if (a.isArray()) {
        if (a.items().size() != b.items().size())
            return at + " (length " + std::to_string(a.items().size()) + " vs " + std::to_string(b.items().size()) + ")";
        for (std::size_t i = 0; i < a.items().size(); ++i)
            if (std::string d = firstDifference(a.items()[i], b.items()[i], at + "[" + std::to_string(i) + "]"); !d.empty())
                return d;
        return "";
    }
    if (a.isObject()) {
        if (a.members().size() != b.members().size()) return at + " (keys)";
        for (std::size_t i = 0; i < a.members().size(); ++i) {
            if (a.members()[i].first != b.members()[i].first) return at + " (key " + a.members()[i].first + ")";
            if (std::string d = firstDifference(a.members()[i].second, b.members()[i].second, at + "." + a.members()[i].first);
                !d.empty())
                return d;
        }
        return "";
    }
    return json::stringify(a) == json::stringify(b) ? "" : at + ": " + json::stringify(a) + " vs " + json::stringify(b);
}

} // namespace

int main() {
    Value reference;
    json::Error error;
    if (!json::parse(readFile(TN_GLTF_REFERENCE), reference, error)) {
        std::printf("FAIL: cannot read %s\n", TN_GLTF_REFERENCE);
        return 1;
    }
    int files = 0, differ = 0;
    for (const Value& expected : reference.find("files")->items()) {
        const std::string file = expected.find("file")->string();
        const std::string bytes = readFile(std::string(TN_REPO_ROOT) + "/" + file);
        gltf::LoadResult loaded =
            gltf::load(std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(bytes.data()), bytes.size()));
        ++files;
        if (!loaded.error.empty() || !loaded.scene) {
            std::printf("  %s: %s\n", file.c_str(), loaded.error.c_str());
            ++differ;
            continue;
        }
        const std::string d = firstDifference(canonical(dump(file, loaded)), canonical(expected), "");
        if (!d.empty()) {
            std::printf("  %s differs at %s\n", file.c_str(), d.c_str());
            ++differ;
        }
    }
    std::printf("gltf hierarchy: %d files, %d differ\n", files, differ);
    if (files == 0 || differ != 0) {
        std::printf("FAIL\n");
        return 1;
    }
    std::printf("PASS\n");
    return 0;
}
