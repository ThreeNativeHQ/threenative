#include "engine/animation/property_binding.h"

#include <array>
#include <cmath>
#include <regex>
#include <utility>

namespace tn::engine::animation {

namespace {

// three's `_trackRe`, assembled from the same pieces: reserved characters are `[ ] . : /`.
const std::regex& trackRe() {
    static const std::regex re(
        R"(^((?:[^\[\]\.:\/]+[\/:])*)([^\[\]:\/]+)?(?:\.([^\[\]\.:\/]+)(?:\[(.+)\])?)?\.([^\[\]\.:\/]+)(?:\[(.+)\])?$)",
        std::regex::ECMAScript);
    return re;
}

constexpr std::array<std::string_view, 4> kSupportedObjectNames = {"material", "materials", "bones", "map"};

std::optional<std::string> group(const std::smatch& m, std::size_t i) {
    return m[i].matched ? std::optional<std::string>(m[i].str()) : std::nullopt;
}

Object3D* searchNodeSubtree(const std::vector<Object3D*>& children, const std::string& nodeName) {
    for (Object3D* child : children) {
        if (child->name == nodeName) return child;
        if (Object3D* result = searchNodeSubtree(child->children, nodeName)) return result;
    }
    return nullptr;
}

}  // namespace

bool parseTrackName(std::string_view trackName, ParsedPath& out, std::string& error) {
    const std::string name(trackName);
    std::smatch m;
    if (!std::regex_match(name, m, trackRe())) {
        error = "THREE.PropertyBinding: Cannot parse trackName: " + name;
        return false;
    }
    out = ParsedPath{group(m, 2), group(m, 3), group(m, 4), m[5].str(), group(m, 6)};
    if (out.nodeName) {
        const std::size_t lastDot = out.nodeName->rfind('.');
        if (lastDot != std::string::npos) {
            const std::string objectName = out.nodeName->substr(lastDot + 1);
            for (std::string_view supported : kSupportedObjectNames) {
                if (objectName == supported) {
                    out.nodeName = out.nodeName->substr(0, lastDot);
                    out.objectName = objectName;
                    break;
                }
            }
        }
    }
    if (out.propertyName.empty()) {
        error = "THREE.PropertyBinding: can not parse propertyName from trackName: " + name;
        return false;
    }
    return true;
}

Object3D* findNode(Object3D& root, const std::optional<std::string>& nodeName) {
    if (!nodeName || nodeName->empty() || *nodeName == "." || *nodeName == root.name) return &root;
    return searchNodeSubtree(root.children, *nodeName);
}

PropertyBinding::PropertyBinding(const std::shared_ptr<Object3D>& root, std::string trackPath)
    : path(std::move(trackPath)), root_(root) {
    std::string error;
    parsedOk_ = parseTrackName(path, parsed_, error);
    if (!parsedOk_) {
        diagnostic = error;
        return;
    }
    // Like three, the node is looked up once here; bind() searches again only after unbind().
    if (Object3D* found = findNode(*root, parsed_.nodeName)) node_ = found->weak_from_this();
}

void PropertyBinding::bind() {
    target_ = Target::Unavailable;
    if (!parsedOk_) return;  // three throws in the constructor; the diagnostic says why
    std::shared_ptr<Object3D> node = node_.lock();
    if (!node) {
        const std::shared_ptr<Object3D> root = root_.lock();
        Object3D* found = root ? findNode(*root, parsed_.nodeName) : nullptr;
        node = found ? found->weak_from_this().lock() : nullptr;
        node_ = node;  // an object no shared_ptr owns cannot be held, so it reads as not found
    }
    if (!node) {
        diagnostic = "PropertyBinding: No target node found for track: " + path + ".";
        return;
    }
    const auto unsupported = [&](const std::string& what) {
        diagnostic = "TN_NATIVE_ANIMATION_TRACK_UNSUPPORTED: " + path + " (" + what + ")";
    };
    if (parsed_.objectName) return unsupported("object " + *parsed_.objectName);
    const std::string& property = parsed_.propertyName;
    Vector3 Object3D::*vector = property == "position" ? &Object3D::position
                                : property == "scale"  ? &Object3D::scale
                                                       : nullptr;
    if (parsed_.propertyIndex) {
        static constexpr std::array<std::string_view, 3> kComponents = {"x", "y", "z"};
        for (int i = 0; i < 3 && vector; ++i) {
            if (*parsed_.propertyIndex == kComponents[i]) {
                vector_ = vector;
                component_ = i;
                target_ = Target::Component;
                diagnostic.clear();
                return;
            }
        }
        return unsupported("property " + property + "[" + *parsed_.propertyIndex + "]");
    }
    if (property == "position") target_ = Target::Position;
    else if (property == "scale") target_ = Target::Scale;
    else if (property == "quaternion") target_ = Target::Quaternion;
    else if (property == "visible") target_ = Target::Visible;
    else return unsupported("property " + property);
    diagnostic.clear();
}

void PropertyBinding::unbind() {
    node_.reset();
    target_ = Target::Unavailable;
}

void PropertyBinding::getValue(double* buffer, std::size_t offset) const {
    const std::shared_ptr<Object3D> node = node_.lock();
    if (!node) return;
    switch (target_) {
        case Target::Unavailable: return;
        case Target::Position: {
            const auto a = node->position.toArray();
            std::copy(a.begin(), a.end(), buffer + offset);
            return;
        }
        case Target::Scale: {
            const auto a = node->scale.toArray();
            std::copy(a.begin(), a.end(), buffer + offset);
            return;
        }
        case Target::Quaternion: {
            const auto a = node->quaternion.toArray();
            std::copy(a.begin(), a.end(), buffer + offset);
            return;
        }
        case Target::Component: buffer[offset] = ((*node).*vector_).getComponent(component_); return;
        case Target::Visible: buffer[offset] = node->visible() ? 1 : 0; return;
    }
}

// three's setters with MatrixWorldNeedsUpdate versioning: every write to an Object3D flags it.
void PropertyBinding::setValue(const double* buffer, std::size_t offset) {
    const std::shared_ptr<Object3D> node = node_.lock();
    if (!node || target_ == Target::Unavailable) return;
    switch (target_) {
        case Target::Unavailable: return;
        case Target::Position: node->position.fromArray(buffer, static_cast<int>(offset)); break;
        case Target::Scale: node->scale.fromArray(buffer, static_cast<int>(offset)); break;
        case Target::Quaternion: node->quaternion.fromArray(buffer, static_cast<int>(offset)); break;
        case Target::Component: ((*node).*vector_).setComponent(component_, buffer[offset]); break;
        // three stores the number itself; any read of `visible` treats it as JavaScript truthiness.
        case Target::Visible: node->setVisible(buffer[offset] != 0 && !std::isnan(buffer[offset])); break;
    }
    node->matrixWorldNeedsUpdate = true;
}

}  // namespace tn::engine::animation
