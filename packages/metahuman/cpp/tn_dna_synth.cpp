// Writes packages/metahuman/fixtures/synthetic.dna: a small redistributable rig that
// exercises the same behaviour modules as the licensed OpenRigLogic sample, so CI needs
// no licensed content. Built from scratch with the upstream DNA writer.
//
//   tn_dna_synth <out.dna>
//
// What it contains, and why each part is there:
//
//   3 GUI controls  jawOpen, browRaise, smile
//   3 raw controls  raw_jawOpen, raw_browRaise, raw_smile
//   GUI -> raw      3 conditional rows with non identity slopes, so a consumer that skips
//                   mapGUIToRawControls cannot produce these numbers
//   3 joints        face_root -> jaw -> brow_center, neutral translations, zero rotations
//   1 joint group   27 rows (3 joints x 9 DNA attributes) x 3 raw control columns
//   4 blend shapes  4 channels, LOD1 keeps the first 2
//   2 animated maps 4 conditional rows, LOD1 keeps the first 2
//   2 LODs          LOD1 is a subset: 2 joints instead of 3, and fewer rows everywhere
//
// Not written: geometry, machine learned behavior, RBF, twist/swing. RigLogic loads them
// as empty layers, which is what a geometry-less fixture needs; adding populated RBF or
// twist/swing data is the next fixture, not a requirement for this one.
//
// Units: metres, radians. The descriptor states both, so nothing depends on defaults.

#include <riglogic/RigLogic.h>

#include <cstdint>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

namespace {

constexpr std::uint16_t kLodCount = 2;
constexpr std::uint16_t kJointCount = 3;
constexpr std::uint16_t kGuiControlCount = 3;
constexpr std::uint16_t kRawControlCount = 3;
constexpr std::uint16_t kBlendShapeCount = 4;
constexpr std::uint16_t kAnimatedMapCount = 2;
constexpr std::uint16_t kRowsPerJoint = 9;  // DNA side: tx ty tz rx ry rz sx sy sz
constexpr std::uint16_t kRows = kJointCount * kRowsPerJoint;
constexpr std::uint16_t kColumns = kRawControlCount;
constexpr std::uint16_t kRowsLod1 = 2 * kRowsPerJoint;  // first two joints only

struct Joint {
    const char* name;
    std::uint16_t parent;
    float tx;
    float ty;
    float tz;
};

constexpr Joint kJoints[kJointCount] = {
    {"face_root", 0u, 0.0f, 0.0f, 0.0f},
    {"jaw", 0u, 0.0f, -0.090f, 0.020f},
    {"brow_center", 1u, 0.0f, 0.110f, 0.060f},
};

const char* const kGuiNames[kGuiControlCount] = {"jawOpen", "browRaise", "smile"};
const char* const kRawNames[kRawControlCount] = {"raw_jawOpen", "raw_browRaise", "raw_smile"};
const char* const kBlendShapeNames[kBlendShapeCount] = {"syn_jawOpen", "syn_smile_L", "syn_smile_R", "syn_browRaise"};
const char* const kAnimatedMapNames[kAnimatedMapCount] = {"syn_map_smile", "syn_map_brow"};

int fail(const std::string& message) {
    std::cerr << "tn_dna_synth: " << message << std::endl;
    return 1;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc != 2) {
        std::cerr << "usage: tn_dna_synth <out.dna>" << std::endl;
        return 2;
    }
    const std::string outPath{argv[1]};

    // No initial capacity, so size() is exactly the bytes the writer produced.
    auto stream = rl4::makeScoped<rl4::MemoryStream>();
    auto writer = rl4::makeScoped<rl4::BinaryStreamWriter>(stream.get());
    if (writer.get() == nullptr) {
        return fail("could not create the DNA writer");
    }

    // ---------------------------------------------------------------- descriptor
    writer->setFileFormatGeneration(2u);
    writer->setFileFormatVersion(8u);
    writer->setName("threenative-synthetic-face");
    writer->setArchetype(dna::Archetype::other);
    writer->setGender(dna::Gender::other);
    writer->setAge(0u);
    writer->setTranslationUnit(dna::TranslationUnit::m);
    writer->setRotationUnit(dna::RotationUnit::radians);
    // X left, Y up, Z front: the Unreal authored convention, so nothing is transformed
    // on load and the fixture matches a real specimen's declared basis.
    writer->setCoordinateSystem(dna::CoordinateSystem{tdm::axis_dir::left, tdm::axis_dir::up, tdm::axis_dir::front});
    writer->setRotationSequence(tdm::rot_seq::xyz);
    writer->setRotationSign(tdm::rot_sign{tdm::rot_dir::positive, tdm::rot_dir::positive, tdm::rot_dir::positive});
    writer->setLODCount(kLodCount);
    writer->setDBMaxLOD(kLodCount - 1u);
    writer->setDBName("threenative-synthetic");
    writer->setDBComplexity("synthetic");

    // ---------------------------------------------------------------- definition
    for (std::uint16_t i = 0; i < kGuiControlCount; ++i) {
        writer->setGUIControlName(i, kGuiNames[i]);
    }
    for (std::uint16_t i = 0; i < kRawControlCount; ++i) {
        writer->setRawControlName(i, kRawNames[i]);
    }
    for (std::uint16_t i = 0; i < kJointCount; ++i) {
        writer->setJointName(i, kJoints[i].name);
    }
    for (std::uint16_t i = 0; i < kBlendShapeCount; ++i) {
        writer->setBlendShapeChannelName(i, kBlendShapeNames[i]);
    }
    for (std::uint16_t i = 0; i < kAnimatedMapCount; ++i) {
        writer->setAnimatedMapName(i, kAnimatedMapNames[i]);
    }

    const std::uint16_t jointIndexList[kJointCount] = {0u, 1u, 2u};
    writer->setJointIndices(0u, jointIndexList, kJointCount);
    writer->setLODJointMapping(0u, 0u);
    const std::uint16_t jointIndexListLod1[2] = {0u, 1u};
    writer->setJointIndices(1u, jointIndexListLod1, 2u);
    writer->setLODJointMapping(1u, 1u);

    const std::uint16_t blendShapeIndexList[kBlendShapeCount] = {0u, 1u, 2u, 3u};
    writer->setBlendShapeChannelIndices(0u, blendShapeIndexList, kBlendShapeCount);
    writer->setLODBlendShapeChannelMapping(0u, 0u);
    const std::uint16_t blendShapeIndexListLod1[2] = {0u, 1u};
    writer->setBlendShapeChannelIndices(1u, blendShapeIndexListLod1, 2u);
    writer->setLODBlendShapeChannelMapping(1u, 1u);

    const std::uint16_t animatedMapIndexList[kAnimatedMapCount] = {0u, 1u};
    writer->setAnimatedMapIndices(0u, animatedMapIndexList, kAnimatedMapCount);
    writer->setLODAnimatedMapMapping(0u, 0u);
    const std::uint16_t animatedMapIndexListLod1[1] = {0u};
    writer->setAnimatedMapIndices(1u, animatedMapIndexListLod1, 1u);
    writer->setLODAnimatedMapMapping(1u, 1u);

    std::vector<std::uint16_t> hierarchy;
    for (std::uint16_t i = 0; i < kJointCount; ++i) {
        hierarchy.push_back(kJoints[i].parent);
    }
    writer->setJointHierarchy(hierarchy.data(), kJointCount);

    std::vector<rl4::Vector3> translations;
    std::vector<rl4::Vector3> rotations;
    for (const auto& joint : kJoints) {
        translations.push_back(rl4::Vector3{joint.tx, joint.ty, joint.tz});
        rotations.push_back(rl4::Vector3{0.0f, 0.0f, 0.0f});
    }
    writer->setNeutralJointTranslations(translations.data(), kJointCount);
    writer->setNeutralJointRotations(rotations.data(), kJointCount);

    // ---------------------------------------------------------- joint behaviours
    // Every attribute is Vector/EulerAngles/Vector, which is what RigLogic needs to
    // emit a 10 float joint stride with a quaternion rotation.
    for (std::uint16_t i = 0; i < kJointCount; ++i) {
        writer->setJointTranslationRepresentation(i, dna::TranslationRepresentation::Vector);
        writer->setJointRotationRepresentation(i, dna::RotationRepresentation::EulerAngles);
        writer->setJointScaleRepresentation(i, dna::ScaleRepresentation::Vector);
    }

    // ------------------------------------------------------------------ behavior
    // GUI -> raw, one conditional row per control, all with a non identity slope so a
    // skipped mapping changes every downstream number.
    const std::uint16_t guiToRawInput[kGuiControlCount] = {0u, 1u, 2u};
    const std::uint16_t guiToRawOutput[kGuiControlCount] = {0u, 1u, 2u};
    const float guiToRawFrom[kGuiControlCount] = {0.0f, 0.0f, 0.0f};
    const float guiToRawTo[kGuiControlCount] = {1.0f, 1.0f, 1.0f};
    const float guiToRawSlope[kGuiControlCount] = {0.8f, 1.0f, 0.5f};
    const float guiToRawCut[kGuiControlCount] = {0.1f, 0.0f, 0.25f};
    writer->setGUIToRawInputIndices(guiToRawInput, kGuiControlCount);
    writer->setGUIToRawOutputIndices(guiToRawOutput, kGuiControlCount);
    writer->setGUIToRawFromValues(guiToRawFrom, kGuiControlCount);
    writer->setGUIToRawToValues(guiToRawTo, kGuiControlCount);
    writer->setGUIToRawSlopeValues(guiToRawSlope, kGuiControlCount);
    writer->setGUIToRawCutValues(guiToRawCut, kGuiControlCount);

    // One joint group: every LOD0 joint attribute, every raw control as a column.
    // values[] is row major: values[row * kColumns + column].
    std::vector<float> values(static_cast<std::size_t>(kRows) * kColumns, 0.0f);
    const auto set = [&values](std::uint16_t row, std::uint16_t column, float value) {
        values[static_cast<std::size_t>(row) * kColumns + column] = value;
    };
    const auto attr = [](std::uint16_t jointIndex, std::uint16_t relative) {
        return static_cast<std::uint16_t>(jointIndex * kRowsPerJoint + relative);
    };
    // jaw: opens on X, drops on Y, nudges on Z, rotates about X.
    set(attr(1u, 0u), 0u, 0.000f);
    set(attr(1u, 1u), 0u, -0.040f);
    set(attr(1u, 2u), 0u, 0.010f);
    set(attr(1u, 3u), 0u, -0.300f);
    // brow_center: rises on Y, rotates about Z.
    set(attr(2u, 1u), 1u, 0.015f);
    set(attr(2u, 5u), 1u, 0.100f);
    // face_root: smiles stretch it on Z.
    set(attr(0u, 8u), 2u, 0.010f);

    std::uint16_t outputIndices[kRows];
    for (std::uint16_t row = 0; row < kRows; ++row) {
        outputIndices[row] = row;
    }
    const std::uint16_t inputIndices[kColumns] = {0u, 1u, 2u};
    const std::uint16_t jointGroupLods[kLodCount] = {kRows, kRowsLod1};
    writer->setJointRowCount(kRows);
    writer->setJointColumnCount(kColumns);
    writer->setJointGroupLODs(0u, jointGroupLods, kLodCount);
    writer->setJointGroupInputIndices(0u, inputIndices, kColumns);
    writer->setJointGroupOutputIndices(0u, outputIndices, kRows);
    writer->setJointGroupValues(0u, values.data(), static_cast<std::uint32_t>(values.size()));
    writer->setJointGroupJointIndices(0u, jointIndexList, kJointCount);

    // Blend shapes are a pass through of the raw control buffer, LOD1 keeps 2 channels.
    const std::uint16_t blendShapeInput[kBlendShapeCount] = {0u, 0u, 1u, 2u};
    const std::uint16_t blendShapeOutput[kBlendShapeCount] = {0u, 1u, 2u, 3u};
    const std::uint16_t blendShapeLods[kLodCount] = {kBlendShapeCount, 2u};
    writer->setBlendShapeChannelLODs(blendShapeLods, kLodCount);
    writer->setBlendShapeChannelInputIndices(blendShapeInput, kBlendShapeCount);
    writer->setBlendShapeChannelOutputIndices(blendShapeOutput, kBlendShapeCount);

    // Animated maps: 4 conditional rows over 2 outputs, LOD1 keeps the first 2.
    const std::uint16_t animatedMapLods[kLodCount] = {4u, 2u};
    const std::uint16_t animatedMapInput[4] = {0u, 2u, 1u, 2u};
    const std::uint16_t animatedMapOutput[4] = {0u, 0u, 1u, 1u};
    const float animatedMapFrom[4] = {0.0f, 0.0f, 0.0f, 0.0f};
    const float animatedMapTo[4] = {1.0f, 1.0f, 1.0f, 1.0f};
    const float animatedMapSlope[4] = {0.5f, 0.5f, 1.0f, 0.25f};
    const float animatedMapCut[4] = {0.25f, 0.0f, 0.0f, 0.0f};
    writer->setAnimatedMapLODs(animatedMapLods, kLodCount);
    writer->setAnimatedMapInputIndices(animatedMapInput, 4u);
    writer->setAnimatedMapOutputIndices(animatedMapOutput, 4u);
    writer->setAnimatedMapFromValues(animatedMapFrom, 4u);
    writer->setAnimatedMapToValues(animatedMapTo, 4u);
    writer->setAnimatedMapSlopeValues(animatedMapSlope, 4u);
    writer->setAnimatedMapCutValues(animatedMapCut, 4u);

    writer->write();
    if (!rl4::Status::isOk()) {
        const auto status = rl4::Status::get();
        return fail(std::string{"could not write the DNA: "} + (status.message != nullptr ? status.message : "unknown"));
    }

    const auto size = stream->size();
    std::ofstream out(outPath, std::ios::binary);
    if (!out) {
        return fail("cannot write " + outPath);
    }
    char buffer[4096];
    stream->open();
    while (stream->tell() < size) {
        const auto chunk = stream->read(buffer, sizeof(buffer));
        if (chunk == 0) {
            break;
        }
        out.write(buffer, static_cast<std::streamsize>(chunk));
    }
    out.close();

    std::cout << "wrote " << outPath << " " << size << " bytes (gui " << kGuiControlCount << " raw " << kRawControlCount
              << " joint " << kJointCount << " blendshape " << kBlendShapeCount << " animatedMap " << kAnimatedMapCount
              << " lod " << kLodCount << ")" << std::endl;
    return out ? 0 : fail("failed while writing " + outPath);
}
