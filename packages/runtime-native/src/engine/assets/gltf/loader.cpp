// glTF to a native scene in GLTFLoader's shape (PRD-515 phase 1). Read loader.h first.
//
// Numbers a game sees (node transforms, material factors) are read from the JSON chunk as doubles,
// as JSON.parse gives them to three; cgltf stores them as float. cgltf owns the structure, the
// bounds checks and the binary data.
#include "engine/assets/gltf/loader.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <map>
#include <set>

#include "cgltf.h"
#include "engine/animation/skinning/skeleton.h"
#include "engine/foundation/json.h"
#include "engine/scene/geometry.h"
#include "engine/scene/material.h"

namespace tn::engine::gltf {
namespace {

using json::Value;
using animation::AnimationClip;
using animation::Interpolation;
using animation::KeyframeTrack;
using animation::TrackType;

const Value* member(const Value* v, std::string_view key) { return v && v->isObject() ? v->find(key) : nullptr; }
const Value* item(const Value* v, std::size_t i) {
    return v && v->isArray() && i < v->items().size() ? &v->items()[i] : nullptr;
}
double number(const Value* v, double fallback) { return v && v->isNumber() ? v->number() : fallback; }
std::string text(const Value* v) { return v && v->isString() ? v->string() : std::string(); }
bool truthyName(const Value* v) { return v && v->isString() && !v->string().empty(); }

// PropertyBinding.sanitizeNodeName: whitespace to '_', then the reserved characters "[].:/" removed.
// ponytail: JS \s also matches Unicode spaces beyond NBSP; ASCII and U+00A0 cover the corpus.
std::string sanitizeNodeName(const std::string& name) {
    std::string out;
    for (std::size_t i = 0; i < name.size(); ++i) {
        const unsigned char c = static_cast<unsigned char>(name[i]);
        if (c == ' ' || c == '\t' || c == '\n' || c == '\v' || c == '\f' || c == '\r') {
            out += '_';
        } else if (c == 0xC2 && i + 1 < name.size() && static_cast<unsigned char>(name[i + 1]) == 0xA0) {
            out += '_';
            ++i;
        } else if (c != '[' && c != ']' && c != '.' && c != ':' && c != '/') {
            out += static_cast<char>(c);
        }
    }
    return out;
}

// The extensions GLTFLoader implements; one of these in a file changes what three builds, so this
// loader refuses it rather than build something else.
const std::set<std::string> kThreeExtensions = {
    "KHR_binary_glTF", "KHR_draco_mesh_compression", "KHR_lights_punctual", "KHR_materials_clearcoat",
    "KHR_materials_dispersion", "KHR_materials_ior", "KHR_materials_sheen", "KHR_materials_specular",
    "KHR_materials_transmission", "KHR_materials_iridescence", "KHR_materials_anisotropy", "KHR_materials_unlit",
    "KHR_materials_volume", "KHR_texture_basisu", "KHR_texture_transform", "KHR_mesh_quantization",
    "KHR_materials_emissive_strength", "EXT_materials_bump", "EXT_texture_webp", "EXT_texture_avif",
    "EXT_meshopt_compression", "KHR_meshopt_compression", "EXT_mesh_gpu_instancing"};
const std::set<std::string> kSupported = {"KHR_mesh_quantization"};

class Builder {
  public:
    Builder(const cgltf_data& data, const Value& json) : data_(data), json_(json) {}

    LoadResult run() {
        LoadResult result;
        if (!checkExtensions()) return fail(result);
        markDefs();
        const Value* scenes = member(&json_, "scenes");
        for (std::size_t i = 0; i < data_.scenes_count; ++i) {
            result.scenes.push_back(loadScene(i, item(scenes, i)));
            if (!error_.empty()) return fail(result);
        }
        resolveMeshes();
        if (!error_.empty()) return fail(result);
        bindSkins();
        if (!error_.empty()) return fail(result);
        const Value* animations = member(&json_, "animations");
        for (std::size_t i = 0; i < data_.animations_count; ++i) {
            result.animations.push_back(loadAnimation(i, item(animations, i)));
            if (!error_.empty()) return fail(result);
        }
        const std::size_t sceneIndex = data_.scene ? static_cast<std::size_t>(data_.scene - data_.scenes) : 0;
        if (sceneIndex < result.scenes.size()) result.scene = result.scenes[sceneIndex];
        return result;
    }

  private:
    LoadResult& fail(LoadResult& result) {
        result = LoadResult{};
        result.error = error_;
        return result;
    }
    void refuse(std::string error) {
        if (error_.empty()) error_ = std::move(error);
    }

    bool checkExtensions() {
        for (std::size_t i = 0; i < data_.extensions_used_count; ++i) {
            const std::string name = data_.extensions_used[i];
            if (kThreeExtensions.count(name) && !kSupported.count(name)) {
                refuse("TN_NATIVE_GLTF_EXTENSION_UNSUPPORTED " + name);
                return false;
            }
        }
        for (std::size_t i = 0; i < data_.extensions_required_count; ++i) {
            const std::string name = data_.extensions_required[i];
            if (!kSupported.count(name)) {
                refuse("TN_NATIVE_GLTF_EXTENSION_UNSUPPORTED " + name);
                return false;
            }
        }
        return true;
    }

    // _markDefs: joints become Bones, meshes under a skinned node become SkinnedMeshes.
    void markDefs() {
        bones_.assign(data_.nodes_count, false);
        skinnedMesh_.assign(data_.meshes_count, false);
        for (std::size_t s = 0; s < data_.skins_count; ++s)
            for (std::size_t j = 0; j < data_.skins[s].joints_count; ++j)
                bones_[data_.skins[s].joints[j] - data_.nodes] = true;
        for (std::size_t n = 0; n < data_.nodes_count; ++n)
            if (data_.nodes[n].mesh && data_.nodes[n].skin) skinnedMesh_[data_.nodes[n].mesh - data_.meshes] = true;
    }

    // createUniqueName: the sanitized name, then name_1, name_2 for its repeats.
    std::string uniqueName(const std::string& original) {
        const std::string sanitized = sanitizeNodeName(original);
        const auto found = namesUsed_.find(sanitized);
        if (found != namesUsed_.end()) return sanitized + "_" + std::to_string(++found->second);
        namesUsed_[sanitized] = 0;
        return sanitized;
    }

    std::shared_ptr<Group> loadScene(std::size_t index, const Value* def) {
        auto scene = std::make_shared<Group>();
        if (truthyName(member(def, "name"))) scene->name = uniqueName(text(member(def, "name")));
        const cgltf_scene& s = data_.scenes[index];
        for (std::size_t i = 0; i < s.nodes_count && error_.empty(); ++i) {
            const std::size_t n = s.nodes[i] - data_.nodes;
            std::shared_ptr<Object3D> node = loadNode(n);
            if (!node) return scene;
            if (node->parent != nullptr) {
                refuse("TN_NATIVE_GLTF_SHARED_NODE_UNSUPPORTED node " + std::to_string(n));
                return scene;
            }
            scene->add(*node);
        }
        return scene;
    }

    // loadNode: the node itself (_loadNodeShallow, which takes its name now), then its children in
    // order; skins bind once every node exists (bindSkins).
    std::shared_ptr<Object3D> loadNode(std::size_t index) {
        if (nodes_.size() < data_.nodes_count) nodes_.resize(data_.nodes_count);
        if (nodes_[index]) return nodes_[index];
        std::shared_ptr<Object3D> node = loadNodeShallow(index);
        if (!node) return nullptr;
        const cgltf_node& def = data_.nodes[index];
        for (std::size_t i = 0; i < def.children_count; ++i) {
            std::shared_ptr<Object3D> child = loadNode(def.children[i] - data_.nodes);
            if (!child) return nullptr;
            node->add(*child);
        }
        return node;
    }

    std::shared_ptr<Object3D> loadNodeShallow(std::size_t index) {
        const cgltf_node& def = data_.nodes[index];
        const Value* json = item(member(&json_, "nodes"), index);
        const bool named = truthyName(member(json, "name"));
        const std::string nodeName = named ? uniqueName(text(member(json, "name"))) : std::string();
        if (def.camera || def.light) {
            refuse(std::string("TN_NATIVE_GLTF_") + (def.camera ? "CAMERA" : "LIGHT") + "_UNSUPPORTED node " +
                   std::to_string(index));
            return nullptr;
        }
        // The mesh object (one Mesh, or a Group of primitives) is built later, when its name is taken
        // (resolveMeshes); a placeholder Group stands in when the node *is* the mesh object.
        std::shared_ptr<Object3D> node;
        std::shared_ptr<Object3D> meshObject;
        if (def.mesh) meshObject = meshObjectFor(def.mesh - data_.meshes, index);
        if (bones_[index]) {
            node = std::make_shared<Bone>();
            if (meshObject) node->add(*meshObject);
        } else if (meshObject) {
            node = meshObject;
        } else {
            node = std::make_shared<Object3D>();
        }
        if (named) {
            node->name = nodeName;
            nodeNames_[node.get()] = nodeName; // the node's name outlives the mesh name taken later
        }
        // Transforms, from the JSON doubles.
        if (const Value* matrix = member(json, "matrix"); matrix && matrix->isArray() && matrix->items().size() == 16) {
            std::array<double, 16> e{};
            for (int i = 0; i < 16; ++i) e[i] = number(item(matrix, i), 0);
            Matrix4 m;
            m.fromArray(e.data());
            node->applyMatrix4(m);
        } else {
            if (const Value* t = member(json, "translation"))
                node->position.set(number(item(t, 0), 0), number(item(t, 1), 0), number(item(t, 2), 0));
            if (const Value* r = member(json, "rotation"))
                node->quaternion.set(number(item(r, 0), 0), number(item(r, 1), 0), number(item(r, 2), 0),
                                     number(item(r, 3), 1));
            if (const Value* s = member(json, "scale"))
                node->scale.set(number(item(s, 0), 1), number(item(s, 1), 1), number(item(s, 2), 1));
        }
        nodes_[index] = node;
        return node;
    }

    // A mesh's object for one node: the first use builds it (its name is taken in resolveMeshes);
    // a later node shares the geometry and materials through objects of its own, as three's clone does.
    struct Primitive {
        std::shared_ptr<BufferGeometry> geometry;
        std::shared_ptr<Material> material;
        std::shared_ptr<Mesh> mesh;
    };
    struct MeshUse {
        std::size_t mesh;
        std::shared_ptr<Object3D> object;     // the Mesh, or the Group of primitive meshes
        std::vector<std::shared_ptr<Mesh>> meshes;
    };
    std::shared_ptr<Object3D> meshObjectFor(std::size_t meshIndex, std::size_t /*nodeIndex*/) {
        const cgltf_mesh& def = data_.meshes[meshIndex];
        MeshUse use{meshIndex, nullptr, {}};
        for (std::size_t p = 0; p < def.primitives_count; ++p) {
            std::shared_ptr<Mesh> mesh =
                skinnedMesh_[meshIndex] ? std::make_shared<SkinnedMesh>() : std::make_shared<Mesh>();
            use.meshes.push_back(mesh);
        }
        if (use.meshes.size() == 1) {
            use.object = use.meshes[0];
        } else {
            auto group = std::make_shared<Group>();
            for (const auto& mesh : use.meshes) group->add(*mesh);
            use.object = group;
        }
        uses_.push_back(use);
        return use.object;
    }

    // loadMesh's continuation, in the order the meshes were first asked for: geometry, final
    // material, then the unique name (from the mesh's name, or mesh_<index>), which a node object
    // that *is* the mesh then overrides with its own.
    void resolveMeshes() {
        std::map<std::size_t, std::vector<std::string>> named; // first use takes the names
        for (MeshUse& use : uses_) {
            const cgltf_mesh& def = data_.meshes[use.mesh];
            const Value* json = item(member(&json_, "meshes"), use.mesh);
            const bool first = !named.count(use.mesh);
            std::vector<std::string>& names = named[use.mesh];
            for (std::size_t p = 0; p < def.primitives_count; ++p) {
                const cgltf_primitive& primitive = def.primitives[p];
                if (primitive.type != cgltf_primitive_type_triangles) {
                    refuse("TN_NATIVE_GLTF_PRIMITIVE_UNSUPPORTED mode " + std::to_string(int(primitive.type)) +
                           " in mesh " + std::to_string(use.mesh));
                    return;
                }
                Mesh& mesh = *use.meshes[p];
                mesh.geometry = geometryFor(primitive);
                if (!error_.empty()) return;
                mesh.material = finalMaterial(primitive, *mesh.geometry);
                if (!error_.empty()) return;
                if (auto* skinned = dynamic_cast<SkinnedMesh*>(&mesh)) normalizeSkinWeights(*skinned);
                if (!mesh.geometry->morphPositions.empty() || !mesh.geometry->morphNormals.empty()) {
                    mesh.updateMorphTargets();
                    if (const Value* weights = member(json, "weights"))
                        for (std::size_t w = 0; w < mesh.morphTargetInfluences.size(); ++w)
                            mesh.morphTargetInfluences[w] = number(item(weights, w), 0);
                }
                if (first) {
                    const std::string base =
                        truthyName(member(json, "name")) ? text(member(json, "name")) : "mesh_" + std::to_string(use.mesh);
                    names.push_back(uniqueName(base));
                }
                mesh.name = names[p];
            }
            // The node object that is this mesh keeps the node's name.
            if (const auto found = nodeNames_.find(use.object.get()); found != nodeNames_.end())
                use.object->name = found->second;
        }
    }

    // GLTFLoader's ATTRIBUTES, else the lower-cased glTF name; the first accessor for a name wins.
    static std::string attributeName(const std::string& gltf) {
        static const std::map<std::string, std::string> kNames = {
            {"POSITION", "position"},   {"NORMAL", "normal"},   {"TANGENT", "tangent"},  {"TEXCOORD_0", "uv"},
            {"TEXCOORD_1", "uv1"},      {"TEXCOORD_2", "uv2"},  {"TEXCOORD_3", "uv3"},   {"COLOR_0", "color"},
            {"WEIGHTS_0", "skinWeight"}, {"JOINTS_0", "skinIndex"}};
        if (const auto found = kNames.find(gltf); found != kNames.end()) return found->second;
        std::string lower = gltf;
        for (char& c : lower) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        return lower;
    }

    std::shared_ptr<BufferGeometry> geometryFor(const cgltf_primitive& primitive) {
        auto geometry = std::make_shared<BufferGeometry>();
        for (std::size_t a = 0; a < primitive.attributes_count; ++a) {
            const cgltf_attribute& attribute = primitive.attributes[a];
            const std::string name = attributeName(attribute.name ? attribute.name : "");
            if (geometry->attributes.count(name)) continue;
            std::shared_ptr<BufferAttribute> loaded = accessor(*attribute.data);
            if (!loaded) return geometry;
            geometry->setAttribute(name, loaded);
        }
        if (primitive.indices) {
            std::shared_ptr<BufferAttribute> index = accessor(*primitive.indices);
            if (!index) return geometry;
            geometry->index = index;
        }
        // addMorphTargets: relative targets; a missing position or normal target is the base data.
        bool hasPosition = false, hasNormal = false;
        for (std::size_t t = 0; t < primitive.targets_count; ++t)
            for (std::size_t a = 0; a < primitive.targets[t].attributes_count; ++a) {
                const std::string name = primitive.targets[t].attributes[a].name;
                hasPosition = hasPosition || name == "POSITION";
                hasNormal = hasNormal || name == "NORMAL";
            }
        for (std::size_t t = 0; t < primitive.targets_count; ++t) {
            std::shared_ptr<BufferAttribute> position, normal;
            for (std::size_t a = 0; a < primitive.targets[t].attributes_count; ++a) {
                const cgltf_attribute& target = primitive.targets[t].attributes[a];
                const std::string name = target.name;
                if (name == "POSITION") position = accessor(*target.data);
                if (name == "NORMAL") normal = accessor(*target.data);
                if (!error_.empty()) return geometry;
            }
            if (hasPosition) geometry->morphPositions.push_back(position ? position : zeroLike(geometry->attributes["position"]));
            if (hasNormal) geometry->morphNormals.push_back(normal ? normal : zeroLike(geometry->attributes["normal"]));
        }
        if (primitive.targets_count) geometry->morphTargetsRelative = true;
        return geometry;
    }

    static std::shared_ptr<BufferAttribute> zeroLike(const std::shared_ptr<BufferAttribute>& base) {
        if (!base) return std::make_shared<BufferAttribute>(Scalar::F32, 0, 3);
        return std::make_shared<BufferAttribute>(Scalar::F32, base->count(), base->itemSize);
    }

    // loadAccessor: the accessor's own typed array (interleaved views de-interleaved, sparse values
    // applied), its item size and normalized flag.
    std::shared_ptr<BufferAttribute> accessor(const cgltf_accessor& a) {
        Scalar scalar = Scalar::F32;
        std::vector<double> values;
        if (!rawValues(a, values, scalar)) return nullptr;
        return BufferAttribute::fromDoubles(scalar, values, static_cast<int>(cgltf_num_components(a.type)), a.normalized != 0);
    }

    // The accessor's stored values, in order, as the typed array holds them (not normalized).
    bool rawValues(const cgltf_accessor& a, std::vector<double>& values, Scalar& scalar) {
        switch (a.component_type) {
            case cgltf_component_type_r_8: scalar = Scalar::I8; break;
            case cgltf_component_type_r_8u: scalar = Scalar::U8; break;
            case cgltf_component_type_r_16: scalar = Scalar::I16; break;
            case cgltf_component_type_r_16u: scalar = Scalar::U16; break;
            case cgltf_component_type_r_32u: scalar = Scalar::U32; break;
            case cgltf_component_type_r_32f: scalar = Scalar::F32; break;
            default:
                refuse("TN_NATIVE_GLTF_ACCESSOR_INVALID component type " + std::to_string(int(a.component_type)));
                return false;
        }
        const int itemSize = static_cast<int>(cgltf_num_components(a.type));
        const std::size_t elementBytes = cgltf_component_size(a.component_type);
        values.assign(a.count * itemSize, 0.0);
        if (a.buffer_view) {
            const uint8_t* base = cgltf_buffer_view_data(a.buffer_view);
            if (!base) {
                refuse("TN_NATIVE_GLTF_BUFFER_MISSING accessor data");
                return false;
            }
            const std::size_t stride = a.buffer_view->stride ? a.buffer_view->stride : elementBytes * itemSize;
            for (std::size_t i = 0; i < a.count; ++i)
                for (int c = 0; c < itemSize; ++c)
                    values[i * itemSize + c] = read(base + a.offset + i * stride + c * elementBytes, a.component_type);
        }
        if (a.is_sparse) {
            const cgltf_accessor_sparse& s = a.sparse;
            const uint8_t* indices = cgltf_buffer_view_data(s.indices_buffer_view);
            const uint8_t* sparseValues = cgltf_buffer_view_data(s.values_buffer_view);
            if (!indices || !sparseValues) {
                refuse("TN_NATIVE_GLTF_BUFFER_MISSING sparse data");
                return false;
            }
            const std::size_t indexBytes = cgltf_component_size(s.indices_component_type);
            for (std::size_t i = 0; i < s.count; ++i) {
                const auto at = static_cast<std::size_t>(read(indices + s.indices_byte_offset + i * indexBytes, s.indices_component_type));
                if (at >= a.count) {
                    refuse("TN_NATIVE_GLTF_ACCESSOR_INVALID sparse index out of range");
                    return false;
                }
                for (int c = 0; c < itemSize; ++c)
                    values[at * itemSize + c] =
                        read(sparseValues + s.values_byte_offset + (i * itemSize + c) * elementBytes, a.component_type);
            }
        }
        return true;
    }

    static double read(const uint8_t* p, cgltf_component_type type) {
        switch (type) {
            case cgltf_component_type_r_8: { int8_t v; std::memcpy(&v, p, 1); return v; }
            case cgltf_component_type_r_8u: return *p;
            case cgltf_component_type_r_16: { int16_t v; std::memcpy(&v, p, 2); return v; }
            case cgltf_component_type_r_16u: { uint16_t v; std::memcpy(&v, p, 2); return v; }
            case cgltf_component_type_r_32u: { uint32_t v; std::memcpy(&v, p, 4); return v; }
            case cgltf_component_type_r_32f: { float v; std::memcpy(&v, p, 4); return v; }
            default: return 0;
        }
    }

    // loadMaterial (core glTF; refused extensions never reach here), then assignFinalMaterial: a
    // geometry without tangents, with colours or without normals takes a cached clone flagged so.
    std::shared_ptr<Material> finalMaterial(const cgltf_primitive& primitive, const BufferGeometry& geometry) {
        const long index = primitive.material ? long(primitive.material - data_.materials) : -1;
        std::shared_ptr<Material> base = baseMaterial(index);
        const bool derivativeTangents = !geometry.attributes.count("tangent");
        const bool vertexColors = geometry.attributes.count("color") > 0;
        const bool flatShading = !geometry.attributes.count("normal");
        if (!derivativeTangents && !vertexColors && !flatShading) return base;
        const std::string key = std::to_string(index) + (derivativeTangents ? ":d" : "") + (vertexColors ? ":c" : "") +
                                (flatShading ? ":f" : "");
        std::shared_ptr<Material>& cached = finalMaterials_[key];
        if (!cached) {
            cached = std::make_shared<Material>(base->type);
            copyMaterial(*base, *cached);
            if (vertexColors) cached->vertexColors = true;
            if (flatShading) cached->flatShading = true;
            if (derivativeTangents && base->maps.count("normalMap")) cached->normalScaleY *= -1;
        }
        return cached;
    }

    static void copyMaterial(const Material& from, Material& to) {
        to.name = from.name;
        to.transparent = from.transparent;
        to.opacity = from.opacity;
        to.alphaTest = from.alphaTest;
        to.depthTest = from.depthTest;
        to.depthWrite = from.depthWrite;
        to.side = from.side;
        to.visible = from.visible;
        to.color = from.color;
        to.emissive = from.emissive;
        to.emissiveIntensity = from.emissiveIntensity;
        to.roughness = from.roughness;
        to.metalness = from.metalness;
        to.vertexColors = from.vertexColors;
        to.flatShading = from.flatShading;
        to.normalScaleX = from.normalScaleX;
        to.normalScaleY = from.normalScaleY;
        to.aoMapIntensity = from.aoMapIntensity;
        to.maps = from.maps;
    }

    std::shared_ptr<Material> baseMaterial(long index) {
        if (const auto found = materials_.find(index); found != materials_.end()) return found->second;
        auto material = std::make_shared<Material>(MaterialType::Standard);
        if (index < 0) {
            // createDefaultMaterial
            material->metalness = 1;
            material->roughness = 1;
            return materials_[index] = material;
        }
        const Value* def = item(member(&json_, "materials"), static_cast<std::size_t>(index));
        const Value* pbr = member(def, "pbrMetallicRoughness");
        if (const Value* factor = member(pbr, "baseColorFactor"); factor && factor->isArray()) {
            material->color = Color(number(item(factor, 0), 1), number(item(factor, 1), 1), number(item(factor, 2), 1));
            material->opacity = number(item(factor, 3), 1);
        }
        assignTexture(*material, "map", member(pbr, "baseColorTexture"));
        material->metalness = number(member(pbr, "metallicFactor"), 1.0);
        material->roughness = number(member(pbr, "roughnessFactor"), 1.0);
        assignTexture(*material, "metalnessMap", member(pbr, "metallicRoughnessTexture"));
        assignTexture(*material, "roughnessMap", member(pbr, "metallicRoughnessTexture"));
        if (const Value* sided = member(def, "doubleSided"); sided && sided->kind() == Value::Kind::Bool && sided->boolean())
            material->side = Side::Double;
        const std::string alphaMode = member(def, "alphaMode") ? text(member(def, "alphaMode")) : "OPAQUE";
        if (alphaMode == "BLEND") {
            material->transparent = true;
            material->depthWrite = false;
        } else {
            material->transparent = false;
            if (alphaMode == "MASK") material->alphaTest = number(member(def, "alphaCutoff"), 0.5);
        }
        if (const Value* normal = member(def, "normalTexture")) {
            assignTexture(*material, "normalMap", normal);
            material->normalScaleX = material->normalScaleY = number(member(normal, "scale"), 1);
        }
        if (const Value* occlusion = member(def, "occlusionTexture")) {
            assignTexture(*material, "aoMap", occlusion);
            if (member(occlusion, "strength")) material->aoMapIntensity = number(member(occlusion, "strength"), 1);
        }
        if (const Value* emissive = member(def, "emissiveFactor"))
            material->emissive = Color(number(item(emissive, 0), 0), number(item(emissive, 1), 0), number(item(emissive, 2), 0));
        assignTexture(*material, "emissiveMap", member(def, "emissiveTexture"));
        if (truthyName(member(def, "name"))) material->name = text(member(def, "name"));
        return materials_[index] = material;
    }

    void assignTexture(Material& material, const char* slot, const Value* info) {
        if (!info) return;
        const auto index = static_cast<std::size_t>(number(member(info, "index"), -1));
        const Value* def = item(member(&json_, "textures"), index);
        if (!def) {
            refuse(std::string("TN_NATIVE_GLTF_TEXTURE_INVALID ") + slot);
            return;
        }
        std::shared_ptr<const Texture>& texture = textures_[index];
        if (!texture) {
            auto made = std::make_shared<Texture>();
            made->name = text(member(def, "name"));
            made->source = static_cast<int>(number(member(def, "source"), -1));
            texture = made;
        }
        material.maps[slot] = texture;
    }

    // SkinnedMesh.normalizeSkinWeights: each vertex's weights over their sum; all zero becomes (1,0,0,0).
    static void normalizeSkinWeights(SkinnedMesh& mesh) {
        auto found = mesh.geometry->attributes.find("skinWeight");
        if (found == mesh.geometry->attributes.end()) return;
        BufferAttribute& weights = *found->second;
        for (uint64_t i = 0; i < weights.count(); ++i) {
            const double x = weights.getX(i), y = weights.getY(i), z = weights.getZ(i), w = weights.getW(i);
            const double length = std::abs(x) + std::abs(y) + std::abs(z) + std::abs(w); // manhattanLength
            const double scale = 1.0 / length;
            if (scale != INFINITY) {
                weights.setX(i, x * scale).setY(i, y * scale).setZ(i, z * scale).setW(i, w * scale);
            } else {
                weights.setX(i, 1).setY(i, 0).setZ(i, 0).setW(i, 0);
            }
        }
    }

    // loadNode's skin step: every SkinnedMesh under a skinned node binds the skin's Skeleton with
    // an identity bind matrix.
    void bindSkins() {
        const Value* skins = member(&json_, "skins");
        std::vector<std::shared_ptr<Skeleton>> skeletons(data_.skins_count);
        for (std::size_t n = 0; n < data_.nodes_count; ++n) {
            const cgltf_node& def = data_.nodes[n];
            if (!def.skin || n >= nodes_.size() || !nodes_[n]) continue;
            const std::size_t s = def.skin - data_.skins;
            if (!skeletons[s]) skeletons[s] = loadSkin(s, item(skins, s));
            if (!error_.empty()) return;
            bindUnder(*nodes_[n], skeletons[s]);
        }
    }
    void bindUnder(Object3D& object, const std::shared_ptr<Skeleton>& skeleton) {
        if (auto* skinned = dynamic_cast<SkinnedMesh*>(&object)) {
            const Matrix4 identity;
            skinned->bind(skeleton, &identity);
        }
        for (Object3D* child : object.children) bindUnder(*child, skeleton);
    }
    std::shared_ptr<Skeleton> loadSkin(std::size_t index, const Value* /*def*/) {
        const cgltf_skin& skin = data_.skins[index];
        std::vector<std::shared_ptr<Bone>> bones;
        std::vector<Matrix4> inverses;
        std::shared_ptr<BufferAttribute> matrices = skin.inverse_bind_matrices ? accessor(*skin.inverse_bind_matrices) : nullptr;
        for (std::size_t j = 0; j < skin.joints_count; ++j) {
            const std::size_t n = skin.joints[j] - data_.nodes;
            auto bone = n < nodes_.size() ? std::dynamic_pointer_cast<Bone>(nodes_[n]) : nullptr;
            if (!bone) {
                refuse("TN_NATIVE_GLTF_SKIN_INVALID joint " + std::to_string(n) + " is not in a scene");
                return nullptr;
            }
            bones.push_back(bone);
            Matrix4 inverse;
            if (matrices) {
                std::array<double, 16> e{};
                for (int k = 0; k < 16; ++k) e[k] = matrices->getComponent(j, k);
                inverse.fromArray(e.data());
            }
            inverses.push_back(inverse);
        }
        return std::make_shared<Skeleton>(std::move(bones), std::move(inverses));
    }

    // loadAnimation: one track per channel (per morph-target mesh for weights), named
    // `<node name>.<property>`; a channel without a target node is skipped.
    std::shared_ptr<AnimationClip> loadAnimation(std::size_t index, const Value* def) {
        const cgltf_animation& animation = data_.animations[index];
        std::vector<KeyframeTrack> tracks;
        for (std::size_t c = 0; c < animation.channels_count; ++c) {
            const cgltf_animation_channel& channel = animation.channels[c];
            if (!channel.target_node) continue;
            const std::size_t n = channel.target_node - data_.nodes;
            if (n >= nodes_.size() || !nodes_[n]) continue;
            Object3D& node = *nodes_[n];
            const cgltf_animation_sampler& sampler = *channel.sampler;
            if (sampler.interpolation == cgltf_interpolation_type_cubic_spline) {
                refuse("TN_NATIVE_GLTF_CUBICSPLINE_UNSUPPORTED animation " + std::to_string(index));
                return nullptr;
            }
            const Interpolation interpolation =
                sampler.interpolation == cgltf_interpolation_type_step ? Interpolation::Discrete : Interpolation::Linear;
            std::vector<double> times, values;
            Scalar inputScalar = Scalar::F32, outputScalar = Scalar::F32;
            if (!rawValues(*sampler.input, times, inputScalar) || !rawValues(*sampler.output, values, outputScalar))
                return nullptr;
            // _getArrayFromAccessor: normalized output is the raw value times getNormalizedComponentScale
            // (1/127, 1/255, 1/32767, 1/65535), not BufferAttribute's clamped division.
            const cgltf_accessor& raw = *sampler.output;
            const double scale = !raw.normalized                                      ? 1.0
                                 : raw.component_type == cgltf_component_type_r_8    ? 1.0 / 127
                                 : raw.component_type == cgltf_component_type_r_8u   ? 1.0 / 255
                                 : raw.component_type == cgltf_component_type_r_16   ? 1.0 / 32767
                                                                                     : 1.0 / 65535;
            if (raw.normalized)
                for (double& value : values) value *= scale;
            std::string property;
            TrackType type;
            std::vector<std::string> targets;
            switch (channel.target_path) {
                case cgltf_animation_path_type_translation: property = "position"; type = TrackType::Vector; break;
                case cgltf_animation_path_type_rotation: property = "quaternion"; type = TrackType::Quaternion; break;
                case cgltf_animation_path_type_scale: property = "scale"; type = TrackType::Vector; break;
                case cgltf_animation_path_type_weights: property = "morphTargetInfluences"; type = TrackType::Number; break;
                default:
                    refuse("TN_NATIVE_GLTF_ANIMATION_PATH_UNSUPPORTED animation " + std::to_string(index));
                    return nullptr;
            }
            if (channel.target_path == cgltf_animation_path_type_weights) {
                auto collect = [&](Object3D& object) {
                    auto* mesh = dynamic_cast<Mesh*>(&object);
                    if (mesh && !mesh->morphTargetInfluences.empty()) targets.push_back(object.name);
                };
                collect(node);
                if (dynamic_cast<Group*>(&node))
                    for (Object3D* child : node.children) collect(*child);
            } else {
                targets.push_back(node.name);
            }
            for (const std::string& target : targets) {
                if (target.empty()) {
                    refuse("TN_NATIVE_GLTF_ANIMATION_TARGET_UNNAMED node " + std::to_string(n)); // three uses the uuid
                    return nullptr;
                }
                tracks.emplace_back(target + "." + property, type, times, values, interpolation);
            }
        }
        const std::string name = truthyName(member(def, "name")) ? text(member(def, "name")) : "animation_" + std::to_string(index);
        return std::make_shared<AnimationClip>(name, -1, std::move(tracks));
    }

    const cgltf_data& data_;
    const Value& json_;
    std::string error_;
    std::vector<bool> bones_, skinnedMesh_;
    std::map<std::string, int> namesUsed_;
    std::vector<std::shared_ptr<Object3D>> nodes_;
    std::map<const Object3D*, std::string> nodeNames_;
    std::vector<MeshUse> uses_;
    std::map<long, std::shared_ptr<Material>> materials_;
    std::map<std::string, std::shared_ptr<Material>> finalMaterials_;
    std::map<std::size_t, std::shared_ptr<const Texture>> textures_;
};

} // namespace

namespace {
bool alignedView(const cgltf_buffer_view* view, cgltf_size offset, cgltf_size componentSize) {
    if (!view || componentSize == 0) return true;
    return (view->offset + offset) % componentSize == 0 && view->stride % componentSize == 0;
}
bool aligned(const cgltf_data& data) {
    for (cgltf_size i = 0; i < data.accessors_count; ++i) {
        const cgltf_accessor& a = data.accessors[i];
        if (!alignedView(a.buffer_view, a.offset, cgltf_component_size(a.component_type))) return false;
        if (a.is_sparse &&
            (!alignedView(a.sparse.indices_buffer_view, a.sparse.indices_byte_offset,
                          cgltf_component_size(a.sparse.indices_component_type)) ||
             !alignedView(a.sparse.values_buffer_view, a.sparse.values_byte_offset, cgltf_component_size(a.component_type))))
            return false;
    }
    return true;
}
} // namespace

LoadResult load(std::span<const uint8_t> bytes) {
    LoadResult result;
    cgltf_options options{};
    cgltf_data* data = nullptr;
    if (cgltf_parse(&options, bytes.data(), bytes.size(), &data) != cgltf_result_success) {
        result.error = "TN_NATIVE_GLTF_PARSE_FAILED";
        return result;
    }
    // External files are not read: a GLB's own chunk and data URIs only.
    if (cgltf_load_buffers(&options, data, nullptr) != cgltf_result_success) {
        cgltf_free(data);
        result.error = "TN_NATIVE_GLTF_BUFFER_MISSING an external or unreadable buffer";
        return result;
    }
    // glTF 2.0 requires an accessor's offset and stride to be multiples of its component size; three
    // fails on such a file too (a typed array cannot start there). Checked before cgltf_validate,
    // whose index-bound pass reads index data through an aligned cast.
    if (!aligned(*data)) {
        cgltf_free(data);
        result.error = "TN_NATIVE_GLTF_ACCESSOR_INVALID misaligned accessor";
        return result;
    }
    if (cgltf_validate(data) != cgltf_result_success) {
        cgltf_free(data);
        result.error = "TN_NATIVE_GLTF_INVALID";
        return result;
    }
    json::Value json;
    json::Error error;
    if (!json::parse(std::string_view(data->json, data->json_size), json, error)) {
        cgltf_free(data);
        result.error = "TN_NATIVE_GLTF_PARSE_FAILED json";
        return result;
    }
    result = Builder(*data, json).run();
    cgltf_free(data);
    return result;
}

} // namespace tn::engine::gltf
