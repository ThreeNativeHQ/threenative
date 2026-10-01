// Standalone reference evaluator. It uses the upstream rl4 API directly, never
// tn_riglogic.h, so its numbers are independent evidence about the adapter.
//
//   tn_rl_reference <dna> <vectors.json> <out.json>
//
// vectors.json:
//
//   { "cases": [ { "name": "neutral", "lod": 0, "mode": "raw", "values": [0, 0, 0] } ] }
//
//   mode   "gui" -> values are GUI controls, mapped to raw by RigLogic
//         "raw" -> values are raw controls, used as-is
//   values length must equal the control count for that mode
//   name   free form, copied into the output
//
// out.json carries the rig counts, every name, the neutral joints, and per case the
// joint deltas, blend shape weights and animated map weights. JSON is written by hand;
// the reader is a small hand written parser for exactly the shape above.

#include <riglogic/RigLogic.h>

#include <dna/version/VersionInfo.h>

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace {

int fail(const std::string& message) {
    std::cerr << "tn_rl_reference: " << message << std::endl;
    return 1;
}

std::string readFile(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        throw std::runtime_error("cannot open " + path);
    }
    std::ostringstream buffer;
    buffer << in.rdbuf();
    return buffer.str();
}

// ---------------------------------------------------------------- minimal JSON

struct Json {
    enum class Kind { Null, Bool, Number, String, Array, Object };
    Kind kind = Kind::Null;
    bool boolean = false;
    double number = 0.0;
    std::string text;
    std::vector<Json> items;
    std::vector<std::pair<std::string, Json>> fields;

    const Json* find(const std::string& key) const {
        for (const auto& field : fields) {
            if (field.first == key) {
                return &field.second;
            }
        }
        return nullptr;
    }
};

class JsonParser {
public:
    explicit JsonParser(const std::string& source) :
        src{source} {}

    Json parse() {
        skipSpace();
        Json value = parseValue();
        skipSpace();
        if (pos != src.size()) {
            throw std::runtime_error("trailing content at offset " + std::to_string(pos));
        }
        return value;
    }

private:
    const std::string& src;
    std::size_t pos = 0;

    [[noreturn]] void bad(const std::string& what) const {
        throw std::runtime_error(what + " at offset " + std::to_string(pos));
    }

    void skipSpace() {
        while (pos < src.size()) {
            const char c = src[pos];
            if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
                ++pos;
            } else {
                break;
            }
        }
    }

    char peek() const {
        if (pos >= src.size()) {
            throw std::runtime_error("unexpected end of input");
        }
        return src[pos];
    }

    void expect(char c) {
        if (pos >= src.size() || src[pos] != c) {
            bad(std::string("expected '") + c + "'");
        }
        ++pos;
    }

    bool literal(const char* text) {
        const std::size_t length = std::string{text}.size();
        if (src.compare(pos, length, text) != 0) {
            return false;
        }
        pos += length;
        return true;
    }

    Json parseValue() {
        switch (peek()) {
        case '{':
            return parseObject();
        case '[':
            return parseArray();
        case '"': {
            Json value;
            value.kind = Json::Kind::String;
            value.text = parseString();
            return value;
        }
        case 't': {
            if (!literal("true")) {
                bad("bad literal");
            }
            Json value;
            value.kind = Json::Kind::Bool;
            value.boolean = true;
            return value;
        }
        case 'f': {
            if (!literal("false")) {
                bad("bad literal");
            }
            Json value;
            value.kind = Json::Kind::Bool;
            value.boolean = false;
            return value;
        }
        case 'n': {
            if (!literal("null")) {
                bad("bad literal");
            }
            return Json{};
        }
        default:
            return parseNumber();
        }
    }

    Json parseObject() {
        expect('{');
        Json value;
        value.kind = Json::Kind::Object;
        skipSpace();
        if (peek() == '}') {
            ++pos;
            return value;
        }
        while (true) {
            skipSpace();
            // Sequenced, not emplace_back(parseString(), parseValue()): the order of
            // argument evaluation is unspecified, which would parse the value first.
            const std::string key = parseString();
            skipSpace();
            expect(':');
            skipSpace();
            value.fields.emplace_back(key, parseValue());
            skipSpace();
            const char c = peek();
            ++pos;
            if (c == '}') {
                return value;
            }
            if (c != ',') {
                --pos;
                bad("expected ',' or '}'");
            }
        }
    }

    Json parseArray() {
        expect('[');
        Json value;
        value.kind = Json::Kind::Array;
        skipSpace();
        if (peek() == ']') {
            ++pos;
            return value;
        }
        while (true) {
            skipSpace();
            value.items.push_back(parseValue());
            skipSpace();
            const char c = peek();
            ++pos;
            if (c == ']') {
                return value;
            }
            if (c != ',') {
                --pos;
                bad("expected ',' or ']'");
            }
        }
    }

    std::string parseString() {
        expect('"');
        std::string out;
        while (true) {
            if (pos >= src.size()) {
                bad("unterminated string");
            }
            const char c = src[pos++];
            if (c == '"') {
                return out;
            }
            if (c != '\\') {
                out.push_back(c);
                continue;
            }
            if (pos >= src.size()) {
                bad("unterminated escape");
            }
            const char escape = src[pos++];
            switch (escape) {
            case '"':
                out.push_back('"');
                break;
            case '\\':
                out.push_back('\\');
                break;
            case '/':
                out.push_back('/');
                break;
            case 'b':
                out.push_back('\b');
                break;
            case 'f':
                out.push_back('\f');
                break;
            case 'n':
                out.push_back('\n');
                break;
            case 'r':
                out.push_back('\r');
                break;
            case 't':
                out.push_back('\t');
                break;
            case 'u': {
                if (pos + 4 > src.size()) {
                    bad("truncated \\u escape");
                }
                const unsigned code = std::stoul(src.substr(pos, 4), nullptr, 16);
                pos += 4;
                out.push_back(static_cast<char>(code & 0x7Fu));
                break;
            }
            default:
                bad("unknown escape");
            }
        }
    }

    Json parseNumber() {
        const std::size_t start = pos;
        if (pos < src.size() && (src[pos] == '-' || src[pos] == '+')) {
            ++pos;
        }
        while (pos < src.size()) {
            const char c = src[pos];
            if ((c >= '0' && c <= '9') || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') {
                ++pos;
            } else {
                break;
            }
        }
        if (pos == start) {
            bad("expected a number");
        }
        Json value;
        value.kind = Json::Kind::Number;
        value.number = std::stod(src.substr(start, pos - start));
        return value;
    }
};

// ------------------------------------------------------------------- JSON output

void writeNumber(std::ostream& out, float value) {
    char buffer[32];
    // %.9g round trips an IEEE float exactly.
    std::snprintf(buffer, sizeof(buffer), "%.9g", static_cast<double>(value));
    out << buffer;
}

void writeString(std::ostream& out, const std::string& value) {
    out << '"';
    for (const char c : value) {
        if (c == '"' || c == '\\') {
            out << '\\';
        }
        out << c;
    }
    out << '"';
}

void writeFloats(std::ostream& out, rl4::ConstArrayView<float> values) {
    out << '[';
    for (std::size_t i = 0; i < values.size(); ++i) {
        if (i != 0) {
            out << ',';
        }
        writeNumber(out, values[i]);
    }
    out << ']';
}

void writeNames(std::ostream& out, const std::string& key, const std::vector<std::string>& names) {
    out << '"' << key << "\":[";
    for (std::size_t i = 0; i < names.size(); ++i) {
        if (i != 0) {
            out << ',';
        }
        writeString(out, names[i]);
    }
    out << ']';
}

struct Case {
    std::string name;
    std::uint16_t lod = 0;
    bool useGui = false;
    std::vector<float> values;
};

std::vector<Case> parseCases(const std::string& path) {
    const Json root = JsonParser{readFile(path)}.parse();
    const Json* cases = root.find("cases");
    if (cases == nullptr || cases->kind != Json::Kind::Array) {
        throw std::runtime_error("vectors file needs a \"cases\" array");
    }
    std::vector<Case> parsed;
    for (const auto& entry : cases->items) {
        Case item;
        const Json* name = entry.find("name");
        const Json* lod = entry.find("lod");
        const Json* mode = entry.find("mode");
        const Json* values = entry.find("values");
        if (name == nullptr || name->kind != Json::Kind::String) {
            throw std::runtime_error("every case needs a string \"name\"");
        }
        if (lod == nullptr || lod->kind != Json::Kind::Number) {
            throw std::runtime_error("case \"" + name->text + "\" needs a numeric \"lod\"");
        }
        if (mode == nullptr || mode->kind != Json::Kind::String) {
            throw std::runtime_error("case \"" + name->text + "\" needs a string \"mode\"");
        }
        if (values == nullptr || values->kind != Json::Kind::Array) {
            throw std::runtime_error("case \"" + name->text + "\" needs a \"values\" array");
        }
        if (mode->text != "gui" && mode->text != "raw") {
            throw std::runtime_error("case \"" + name->text + "\" has mode \"" + mode->text + "\", expected gui or raw");
        }
        item.name = name->text;
        item.lod = static_cast<std::uint16_t>(lod->number);
        item.useGui = (mode->text == "gui");
        for (const auto& value : values->items) {
            if (value.kind != Json::Kind::Number) {
                throw std::runtime_error("case \"" + name->text + "\" has a non numeric value");
            }
            item.values.push_back(static_cast<float>(value.number));
        }
        parsed.push_back(std::move(item));
    }
    return parsed;
}

std::vector<std::string> readNames(const dna::Reader* reader,
                                  std::uint16_t count,
                                  rl4::StringView (dna::DefinitionReader::*getter)(std::uint16_t) const) {
    std::vector<std::string> names;
    names.reserve(count);
    for (std::uint16_t i = 0; i < count; ++i) {
        names.emplace_back((reader->*getter)(i).c_str());
    }
    return names;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc != 4) {
        std::cerr << "usage: tn_rl_reference <dna> <vectors.json> <out.json>" << std::endl;
        return 2;
    }
    const std::string dnaPath{argv[1]};
    const std::string vectorsPath{argv[2]};
    const std::string outPath{argv[3]};

    std::vector<Case> cases;
    try {
        cases = parseCases(vectorsPath);
    } catch (const std::exception& error) {
        return fail(std::string("vectors: ") + error.what());
    }

    auto stream = rl4::makeScoped<rl4::FileStream>(dnaPath.c_str(),
                                                  rl4::FileStream::AccessMode::Read,
                                                  rl4::FileStream::OpenMode::Binary);
    auto reader = rl4::makeScoped<rl4::BinaryStreamReader>(stream.get());
    reader->read();
    if (!rl4::Status::isOk()) {
        const auto status = rl4::Status::get();
        return fail(std::string{"cannot read "} + dnaPath + ": " + (status.message != nullptr ? status.message : "unknown"));
    }

    rl4::Configuration config;
    config.calculationType = rl4::CalculationType::Scalar;
    config.floatingPointType = rl4::FloatingPointType::Float;
    config.loadJoints = true;
    config.loadBlendShapes = true;
    config.loadAnimatedMaps = true;
    config.loadMachineLearnedBehavior = true;
    config.loadRBFBehavior = true;
    config.loadTwistSwingBehavior = true;
    config.rotationType = rl4::RotationType::Quaternions;

    auto logic = rl4::makeScoped<rl4::RigLogic>(reader.get(), config);
    if (logic.get() == nullptr) {
        const auto status = rl4::Status::get();
        return fail(std::string{"cannot create the rig: "} + (status.message != nullptr ? status.message : "unknown"));
    }
    auto instance = rl4::makeScoped<rl4::RigInstance>(logic.get());

    const auto guiCount = reader->getGUIControlCount();
    const auto rawCount = reader->getRawControlCount();
    const auto jointCount = reader->getJointCount();
    const auto blendShapeCount = reader->getBlendShapeChannelCount();
    const auto animatedMapCount = reader->getAnimatedMapCount();
    const auto lodCount = logic->getLODCount();

    const auto guiNames = readNames(reader.get(), guiCount, &dna::Reader::getGUIControlName);
    const auto rawNames = readNames(reader.get(), rawCount, &dna::Reader::getRawControlName);
    const auto jointNames = readNames(reader.get(), jointCount, &dna::Reader::getJointName);
    const auto blendShapeNames = readNames(reader.get(), blendShapeCount, &dna::Reader::getBlendShapeChannelName);
    const auto animatedMapNames = readNames(reader.get(), animatedMapCount, &dna::Reader::getAnimatedMapName);

    std::cout << "dna " << dnaPath << " generation " << reader->getFileFormatGeneration() << " version "
              << reader->getFileFormatVersion() << " dnaLib " << dna::VersionInfo::getVersionString().c_str()
              << " rigLogic " << rl4::VersionInfo::getVersionString().c_str() << "\n"
              << "gui " << guiCount << " raw " << rawCount << " joint " << jointCount << " blendshape "
              << blendShapeCount << " animatedMap " << animatedMapCount << " lod " << lodCount << " cases "
              << cases.size() << std::endl;

    std::ostringstream body;
    body << "{\n  \"dna\": ";
    writeString(body, dnaPath);
    body << ",\n  \"dnaFileFormatGeneration\": " << reader->getFileFormatGeneration()
         << ",\n  \"dnaFileFormatVersion\": " << reader->getFileFormatVersion() << ",\n  \"dnaLibVersion\": ";
    writeString(body, dna::VersionInfo::getVersionString().c_str());
    body << ",\n  \"rigLogicVersion\": ";
    writeString(body, rl4::VersionInfo::getVersionString().c_str());
    body << ",\n  \"configuration\": {\"calculationType\":\"Scalar\",\"floatingPointType\":\"Float\",\"rotationType\":"
            "\"Quaternions\",\"jointStride\":10},\n  \"counts\": {";
    const std::pair<const char*, int> counts[] = {{"gui", guiCount},
                                                  {"raw", rawCount},
                                                  {"joint", jointCount},
                                                  {"blendshape", blendShapeCount},
                                                  {"animatedMap", animatedMapCount},
                                                  {"lod", lodCount}};
    for (std::size_t i = 0; i < sizeof(counts) / sizeof(counts[0]); ++i) {
        if (i != 0) {
            body << ',';
        }
        body << '"' << counts[i].first << "\":" << counts[i].second;
    }
    body << "},\n  \"names\": {";
    writeNames(body, "gui", guiNames);
    body << ',';
    writeNames(body, "raw", rawNames);
    body << ',';
    writeNames(body, "joint", jointNames);
    body << ',';
    writeNames(body, "blendshape", blendShapeNames);
    body << ',';
    writeNames(body, "animatedMap", animatedMapNames);
    body << "},\n  \"jointParents\": [";
    for (std::uint16_t i = 0; i < jointCount; ++i) {
        if (i != 0) {
            body << ',';
        }
        body << reader->getJointParentIndex(i);
    }
    body << "],\n  \"neutralJoints\": ";
    writeFloats(body, logic->getNeutralJointValues());
    body << ",\n  \"cases\": [\n";

    for (std::size_t c = 0; c < cases.size(); ++c) {
        const auto& item = cases[c];
        const std::size_t expected = item.useGui ? guiCount : rawCount;
        if (item.values.size() != expected) {
            return fail("case \"" + item.name + "\" has " + std::to_string(item.values.size()) + " values, expected " +
                        std::to_string(expected));
        }
        if (item.lod >= lodCount) {
            return fail("case \"" + item.name + "\" asks for lod " + std::to_string(item.lod) + ", only " +
                        std::to_string(lodCount) + " available");
        }
        for (const float value : item.values) {
            if (!std::isfinite(value)) {
                return fail("case \"" + item.name + "\" has a non finite value");
            }
        }

        // Every control is written on every case so results never depend on history.
        auto guiValues = instance->getGUIControlValues();
        for (std::uint16_t i = 0; i < guiCount; ++i) {
            guiValues[i] = 0.0f;
        }
        instance->setLOD(item.lod);
        if (item.useGui) {
            for (std::uint16_t i = 0; i < guiCount; ++i) {
                guiValues[i] = item.values[i];
            }
        } else {
            auto rawValues = instance->getRawControlValues();
            for (std::uint16_t i = 0; i < rawCount; ++i) {
                rawValues[i] = item.values[i];
            }
        }
        if (item.useGui) {
            logic->mapGUIToRawControls(instance.get());
        }
        logic->calculate(instance.get());

        if (c != 0) {
            body << ",\n";
        }
        body << "    {\"name\": ";
        writeString(body, item.name);
        body << ", \"lod\": " << item.lod << ", \"mode\": ";
        writeString(body, item.useGui ? "gui" : "raw");
        body << ", \"joints\": ";
        writeFloats(body, instance->getJointOutputs());
        body << ", \"blendshapes\": ";
        writeFloats(body, instance->getBlendShapeOutputs());
        body << ", \"animatedMaps\": ";
        writeFloats(body, instance->getAnimatedMapOutputs());
        body << '}';
        std::cout << "case " << item.name << " lod " << item.lod << " mode " << (item.useGui ? "gui" : "raw") << " ok"
                  << std::endl;
    }

    body << "\n  ]\n}\n";

    std::ofstream out(outPath, std::ios::binary);
    if (!out) {
        return fail("cannot write " + outPath);
    }
    out << body.str();
    if (!out) {
        return fail("failed while writing " + outPath);
    }
    return 0;
}
