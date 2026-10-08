#include "post_effects.h"
#include "render_texture_pass.h"
#include "engine/shader/output.h"
#include "engine/shader/tsl/tsl.h"
#include <cmath>
#include <unordered_set>
#include <stdexcept>
#include <charconv>
#include <limits>

namespace tn::engine::shader::graph {
namespace {
std::string literal(float value) {
    char buffer[64];
    auto [end, error] = std::to_chars(buffer, buffer + sizeof(buffer), value, std::chars_format::scientific,
                                      std::numeric_limits<float>::max_digits10);
    if (error != std::errc())
        throw std::runtime_error("TN_POST_FLOAT_FORMAT");
    return std::string(buffer, end);
}
const json::Value empty;
const json::Value& get(const json::Value& v, const char* key) {
    const auto* x = v.find(key);
    return x ? *x : empty;
}
std::string textureName(Node n) {
    if (n && (n->kind == Kind::Texture || n->kind == Kind::PostEffect || n->kind == Kind::RenderTexture))
        return n->name;
    if (n && (n->kind == Kind::Swizzle || n->kind == Kind::Convert) && !n->args.empty())
        return textureName(n->args[0]);
    throw std::runtime_error("TN_TSL_POST_INPUT: expected a depth/normal texture");
}

// r185 PostProcessingUtils.getViewPosition/getScreenPosition/getNormalFromDepth. The nine
// integer depth loads and second-order discontinuity choice are preserved (no derivative proxy).
const char* kGeometry = R"WGSL(
fn viewPosition(coord: vec2<f32>, depth: f32) -> vec3<f32> {
    let clip = vec4<f32>(vec2<f32>(coord.x, 1.0-coord.y)*2.0-1.0, depth, 1.0);
    let view = u._cameraProjectionMatrixInverse * clip;
    return view.xyz/view.w;
}
fn normalFromDepth(coord: vec2<f32>) -> vec3<f32> {
    let size = vec2<f32>(textureDimensions(t_depth));
    let p = vec2<i32>(coord*size);
    let c0 = loadDepth(p);
    let l2 = loadDepth(p-vec2<i32>(2,0)); let l1 = loadDepth(p-vec2<i32>(1,0));
    let r1 = loadDepth(p+vec2<i32>(1,0)); let r2 = loadDepth(p+vec2<i32>(2,0));
    let b2 = loadDepth(p+vec2<i32>(0,2)); let b1 = loadDepth(p+vec2<i32>(0,1));
    let t1 = loadDepth(p-vec2<i32>(0,1)); let t2 = loadDepth(p-vec2<i32>(0,2));
    let dl = abs(2.0*l1-l2-c0); let dr = abs(2.0*r1-r2-c0);
    let db = abs(2.0*b1-b2-c0); let dt = abs(2.0*t1-t2-c0);
    let ce = viewPosition(coord,c0);
    let dx = select(-ce+viewPosition(coord+vec2<f32>(1.0/size.x,0),r1),
        ce-viewPosition(coord-vec2<f32>(1.0/size.x,0),l1),dl<dr);
    let dy = select(-ce+viewPosition(coord-vec2<f32>(0,1.0/size.y),t1),
        ce-viewPosition(coord+vec2<f32>(0,1.0/size.y),b1),db<dt);
    return normalize(cross(dx,dy));
}
)WGSL";

// three r185 GTAONode.setup: slice normal projection, two-sided horizon marching, Eq. 7
// cosine-weighted integration, foreshortening, radius/thickness/falloff/exponent/scale.
const char* kGtao = R"WGSL(
fn screenPosition(view: vec3<f32>) -> vec2<f32> {
    let clip = u._cameraProjectionMatrix*vec4<f32>(view,1.0);
    let coord = clip.xy/clip.w*0.5+0.5;
    return vec2<f32>(coord.x,1.0-coord.y);
}
@fragment fn main(@location(0) coord: vec2<f32>) -> @location(0) vec4<f32> {
    let depth = sampleDepth(coord);
    if (depth>=1.0) { discard; }
    let position = viewPosition(coord,depth);
    let normal = sampleNormal(coord);
    let noiseUv = vec2<f32>(coord.x,1.0-coord.y)*u.resolution/vec2<f32>(textureDimensions(t_noise));
    let noise = textureSampleLevel(t_noise,smp_noise,noiseUv,0.0);
    let randomVec = noise.xyz*2.0-1.0;
    let tangent = normalize(vec3<f32>(randomVec.xy,0.0));
    let bitangent = vec3<f32>(-tangent.y,tangent.x,0.0);
    let kernel = mat3x3<f32>(tangent,bitangent,vec3<f32>(0,0,1));
    let directions = select(5,3,u.samples<30.0);
    // STEPS stays floating, including the non-integral loop bound in r185.
    let steps = (u.samples+f32(directions-1))/f32(directions);
    var ao = 0.0;
    for (var i=0; i<directions; i++) {
        let angle = f32(i)/f32(directions)*3.141592653589793+u._temporalDirection;
        let sampleDir = normalize(kernel*vec3<f32>(cos(angle),sin(angle),0.0));
        let jitter = 0.5+0.5*noise.w;
        let viewDir = normalize(-position);
        let sliceBitangent = normalize(cross(sampleDir,viewDir));
        let sliceTangent = cross(sliceBitangent,viewDir);
        let projNRaw = normal-sliceBitangent*dot(normal,sliceBitangent);
        let projNLen = length(projNRaw);
        let projN = projNRaw/max(projNLen,0.0001);
        let nSin = dot(projN,sliceTangent);
        let nCos = clamp(dot(projN,viewDir),0.0,1.0);
        let angleN = select(-1.0,1.0,nSin>=0.0)*acos(nCos);
        let tangentN = cross(projN,sliceBitangent);
        var horizons = vec2<f32>(dot(viewDir,tangentN),dot(viewDir,-tangentN));
        for (var j=0; f32(j)<steps; j++) {
            let offset = sampleDir*u.radius*jitter*pow((f32(j)+1.0)/steps,u.distanceExponent);
            let sx = screenPosition(position+offset);
            let dx = viewPosition(sx,sampleDepth(sx))-position;
            if (abs(dx.z)<u.thickness) {
                let h = dot(viewDir,normalize(dx));
                horizons.x += max(0.0,(h-horizons.x)*mix(1.0,2.0/(f32(j)+2.0),u.distanceFallOff));
            }
            let sy = screenPosition(position-offset);
            let dy = viewPosition(sy,sampleDepth(sy))-position;
            if (abs(dy.z)<u.thickness) {
                let h = dot(viewDir,normalize(dy));
                horizons.y += max(0.0,(h-horizons.y)*mix(1.0,2.0/(f32(j)+2.0),u.distanceFallOff));
            }
        }
        let hPos = acos(horizons.y); let hNeg = -acos(horizons.x);
        let termPos = -cos(2.0*hPos-angleN)+nCos+2.0*hPos*nSin;
        let termNeg = -cos(2.0*hNeg-angleN)+nCos+2.0*hNeg*nSin;
        ao += projNLen*((termPos+termNeg)*0.25);
    }
    ao = pow(clamp(ao/f32(directions),0.0,1.0),u.scale);
    // GTAO's RedFormat render target samples as (r,0,0,1).
    return vec4<f32>(ao,0,0,1);
}
)WGSL";

// r185 DenoiseNode.setup, including its exact noise channel expression and rotation matrix.
const char* kDenoise = R"WGSL(
fn luma(color: vec3<f32>) -> f32 { return dot(color,vec3<f32>(0.2126,0.7152,0.0722)); }
fn denoiseSample(center: vec3<f32>, normal: vec3<f32>, position: vec3<f32>, coord: vec2<f32>) -> vec4<f32> {
    let texel = textureSampleLevel(t_input,smp_input,coord,0.0);
    let depth = sampleDepth(coord);
    let neighborNormal = sampleNormal(coord);
    let neighborPosition = viewPosition(coord,depth);
    let normalSimilarity = pow(max(dot(normal,neighborNormal),0.0),u.normalPhi);
    let lumaSimilarity = max(1.0-abs(luma(texel.rgb)-luma(center))/u.lumaPhi,0.0);
    let depthSimilarity = max(1.0-abs(dot(position-neighborPosition,normal))/u.depthPhi,0.0);
    let w = lumaSimilarity*depthSimilarity*normalSimilarity;
    return vec4<f32>(texel.rgb*w,w);
}
@fragment fn main(@location(0) coord: vec2<f32>) -> @location(0) vec4<f32> {
    let depth = sampleDepth(coord);
    let normal = sampleNormal(coord);
    let texel = textureSampleLevel(t_input,smp_input,coord,0.0);
    if (depth>=1.0 || dot(normal,normal)==0.0) { return texel; }
    let position = viewPosition(coord,depth);
    let noiseUv = vec2<f32>(coord.x,1.0-coord.y)*vec2<f32>(textureDimensions(t_input))/vec2<f32>(textureDimensions(t_noise));
    let noise = textureSampleLevel(t_noise,smp_noise,noiseUv,0.0);
    let channel = i32((u.index-floor(u.index/4.0)*4.0)*2.0*3.141592653589793);
    let x = sin(noise[channel]); let y = cos(noise[channel]);
    let rotation = mat2x2<f32>(x,-y,x,y);
    var totalWeight = 1.0; var denoised = texel.rgb;
    for (var i=0; i<16; i++) {
        let dir = samples[i];
        let offset = rotation*(dir.xy*(1.0+dir.z*(u.radius-1.0)))/vec2<f32>(textureDimensions(t_input));
        let result = denoiseSample(texel.rgb,normal,position,coord+offset);
        denoised += result.xyz; totalWeight += result.w;
    }
    if (totalWeight>0.0) { denoised /= totalWeight; }
    return vec4<f32>(denoised,texel.a);
}
)WGSL";

const char* kSmaaEdges = R"WGSL(
fn colorDelta(a: vec3<f32>, b: vec3<f32>) -> f32 { let t=abs(a-b); return max(max(t.r,t.g),t.b); }
@fragment fn main(@location(0) coord: vec2<f32>) -> @location(0) vec4<f32> {
    let inv = 1.0/vec2<f32>(textureDimensions(t_input));
    let c = textureSampleLevel(t_input,smp_input,coord,0.0).rgb;
    var delta = vec4<f32>(0.0);
    delta.x = colorDelta(c,textureSampleLevel(t_input,smp_input,coord+inv*vec2<f32>(-1,0),0.0).rgb);
    delta.y = colorDelta(c,textureSampleLevel(t_input,smp_input,coord+inv*vec2<f32>(0,-1),0.0).rgb);
    var edges = step(vec2<f32>(0.1),delta.xy);
    if (dot(edges,vec2<f32>(1.0))==0.0) { discard; }
    delta.z = colorDelta(c,textureSampleLevel(t_input,smp_input,coord+inv*vec2<f32>(1,0),0.0).rgb);
    delta.w = colorDelta(c,textureSampleLevel(t_input,smp_input,coord+inv*vec2<f32>(0,1),0.0).rgb);
    var maxDelta = max(max(delta.x,delta.y),max(delta.z,delta.w));
    delta.z = colorDelta(c,textureSampleLevel(t_input,smp_input,coord+inv*vec2<f32>(-2,0),0.0).rgb);
    delta.w = colorDelta(c,textureSampleLevel(t_input,smp_input,coord+inv*vec2<f32>(0,-2),0.0).rgb);
    maxDelta = max(maxDelta,max(delta.z,delta.w));
    edges *= step(vec2<f32>(0.5*maxDelta),delta.xy);
    return vec4<f32>(edges,0,0);
}
)WGSL";

// r185 SMAA searches preserve pseudo gather offsets, 8 two-pixel steps, search correction,
// crossing edges, quadratic area compression and zero subsample indices (SMAA 1x).
const char* kSmaaWeights = R"WGSL(
fn searchLength(e: vec2<f32>, bias: f32) -> f32 {
    return 255.0*textureSampleLevel(t_search,smp_search,vec2<f32>(bias+e.r*0.5,e.g),0.0).r;
}
fn area(dist: vec2<f32>, e1: f32, e2: f32) -> vec2<f32> {
    let pixel = vec2<f32>(1.0/160.0,1.0/560.0);
    let coord = pixel*(16.0*round(4.0*vec2<f32>(e1,e2))+dist)+0.5*pixel;
    return textureSampleLevel(t_area,smp_area,coord,0.0).rg;
}
fn searchX(start: vec2<f32>, end: f32, direction: f32, inv: vec2<f32>) -> f32 {
    var e = vec2<f32>(0,1); var coord = start;
    for (var i=0; i<8; i++) {
        e = textureSampleLevel(t_edges,smp_edges,coord,0.0).rg;
        coord += vec2<f32>(2.0*direction,0)*inv;
        if ((direction<0.0 && coord.x<=end) || (direction>0.0 && coord.x>=end) || e.g<=0.8281 || e.r!=0.0) { break; }
    }
    let bias = select(0.0,0.5,direction>0.0);
    if (direction<0.0) {
        coord.x += 0.25*inv.x; coord.x += inv.x; coord.x += 2.0*inv.x;
        coord.x -= inv.x*searchLength(e,bias);
    } else {
        coord.x -= 0.25*inv.x; coord.x -= inv.x; coord.x -= 2.0*inv.x;
        coord.x += inv.x*searchLength(e,bias);
    }
    return coord.x;
}
fn searchY(start: vec2<f32>, end: f32, direction: f32, inv: vec2<f32>) -> f32 {
    var e = vec2<f32>(1,0); var coord = start;
    for (var i=0; i<8; i++) {
        e = textureSampleLevel(t_edges,smp_edges,coord,0.0).rg;
        coord += vec2<f32>(0,2.0*direction)*inv;
        if ((direction<0.0 && coord.y<=end) || (direction>0.0 && coord.y>=end) || e.r<=0.8281 || e.g!=0.0) { break; }
    }
    let bias = select(0.0,0.5,direction>0.0);
    if (direction<0.0) {
        coord.y += 0.25*inv.y; coord.y += inv.y; coord.y += 2.0*inv.y;
        coord.y -= inv.y*searchLength(e.gr,bias);
    } else {
        coord.y -= 0.25*inv.y; coord.y -= inv.y; coord.y -= 2.0*inv.y;
        coord.y += inv.y*searchLength(e.gr,bias);
    }
    return coord.y;
}
@fragment fn main(@location(0) coord: vec2<f32>) -> @location(0) vec4<f32> {
    let inv = 1.0/vec2<f32>(textureDimensions(t_edges));
    let pixcoord = coord/inv;
    let o0 = coord.xyxy+inv.xyxy*vec4<f32>(-0.25,-0.125,1.25,-0.125);
    let o1 = coord.xyxy+inv.xyxy*vec4<f32>(-0.125,-0.25,-0.125,1.25);
    let o2 = vec4<f32>(o0.xz,o1.yw)+vec4<f32>(-2,2,-2,2)*vec4<f32>(inv.xx,inv.yy)*8.0;
    var weights = vec4<f32>(0.0);
    let e = textureSampleLevel(t_edges,smp_edges,coord,0.0).rg;
    if (e.g>0.0) {
        let left = vec2<f32>(searchX(o0.xy,o2.x,-1.0,inv),o1.y);
        let e1 = textureSampleLevel(t_edges,smp_edges,left,0.0).r;
        let right = vec2<f32>(searchX(o0.zw,o2.y,1.0,inv),o1.y);
        let d = vec2<f32>(left.x,right.x)/inv.x-pixcoord.x;
        let e2 = textureSampleLevel(t_edges,smp_edges,right+vec2<f32>(1,0)*inv,0.0).r;
        let a = area(sqrt(abs(d)),e1,e2); weights.r=a.x; weights.g=a.y;
    }
    if (e.r>0.0) {
        let up = vec2<f32>(o0.x,searchY(o1.xy,o2.z,-1.0,inv));
        let e1 = textureSampleLevel(t_edges,smp_edges,up,0.0).g;
        let down = vec2<f32>(o0.x,searchY(o1.zw,o2.w,1.0,inv));
        let d = vec2<f32>(up.y,down.y)/inv.y-pixcoord.y;
        let e2 = textureSampleLevel(t_edges,smp_edges,down+vec2<f32>(0,1)*inv,0.0).g;
        let a = area(sqrt(abs(d)),e1,e2); weights.b=a.x; weights.a=a.y;
    }
    return weights;
}
)WGSL";
const char* kSmaaBlend = R"WGSL(
@fragment fn main(@location(0) coord: vec2<f32>) -> @location(0) vec4<f32> {
    let inv = 1.0/vec2<f32>(textureDimensions(t_weights));
    let current = textureSampleLevel(t_weights,smp_weights,coord,0.0);
    let a = vec4<f32>(current.x,textureSampleLevel(t_weights,smp_weights,coord+inv*vec2<f32>(0,1),0.0).g,
        current.z,textureSampleLevel(t_weights,smp_weights,coord+inv*vec2<f32>(1,0),0.0).a);
    let c = textureSampleLevel(t_input,smp_input,coord,0.0);
    if (dot(a,vec4<f32>(1.0))<0.00001) { return c; }
    var offset = vec2<f32>(select(-a.b,a.a,a.a>a.b),select(-a.r,a.g,a.g>a.r));
    if (abs(offset.x)>abs(offset.y)) { offset.y=0.0; } else { offset.x=0.0; }
    let opposite = textureSampleLevel(t_input,smp_input,coord+sign(offset)*inv,0.0);
    let s = select(abs(offset.y),abs(offset.x),abs(offset.x)>abs(offset.y));
    return mix(c,opposite,s);
}
)WGSL";

StageModule vertex() { return buildStage(buildOutput(std::nullopt, false).vertex); }
PostPass rawPass(const PostEffect& effect, std::string output, const char* body,
                 std::map<std::string, std::string> reads, bool geometry = false) {
    PostPass pass;
    pass.output = std::move(output);
    pass.reads = std::move(reads);
    pass.package.name = pass.output;
    pass.resolutionScale = effect.resolutionScale;
    pass.uniforms = effect.parameters;
    pass.temporal = effect.temporal;
    pass.redFormat = effect.kind == "GTAONode";
    StageModule fragment{Stage::Fragment};
    std::string code;
    uint32_t binding = 0, offset = 0;
    if (geometry) {
        code += "struct Uniforms {\n";
        // Sorted names also determine native byte offsets: WGSL layout and metadata agree.
        auto params = effect.parameters;
        params.erase("sampleVectors");
        params["resolution"] = {1, 1};
        for (const auto& [name, values] : params) {
            const Type t = values.size() == 16 ? Type::mat(4, 4) : values.size() == 2 ? Type::vec(2) : Type::f32();
            const auto layout = uniformLayout(t);
            offset = (offset + layout.align - 1) / layout.align * layout.align;
            fragment.uniforms.push_back({name, t, offset, layout.size,
                                         name.find("Matrix") != std::string::npos ? UpdateSchedule::Camera
                                         : name == "resolution"                   ? UpdateSchedule::Render
                                                                                  : UpdateSchedule::Material});
            code += "  " + name + ": " + t.name() + ",\n";
            offset += layout.size;
        }
        fragment.uniformBlockSize = (offset + 15) / 16 * 16;
        code += "};\n@group(0) @binding(0) var<uniform> u: Uniforms;\n";
        fragment.bindings.push_back({0, binding++, BindingKind::Uniform, "u", fragment.uniformBlockSize});
    }
    for (const auto& [name, resource] : pass.reads) {
        const bool depth = name == "depth" && resource == "depth";
        code += "@group(0) @binding(" + std::to_string(binding) + ") var t_" + name + ": " +
                (depth ? "texture_depth_2d" : "texture_2d<f32>") + ";\n";
        fragment.bindings.push_back({0, binding++, BindingKind::Texture, "t_" + name, 0, depth});
        if (!depth) {
            code += "@group(0) @binding(" + std::to_string(binding) + ") var smp_" + name + ": sampler;\n";
            fragment.bindings.push_back({0, binding++, BindingKind::Sampler, "smp_" + name});
        }
    }
    if (geometry) {
        const bool depth = pass.reads.at("depth") == "depth";
        const std::string channel = depth ? "" : ".r";
        code += "fn loadDepth(p: vec2<i32>) -> f32 { return textureLoad(t_depth,p,0)" + channel + "; }\n";
        code += "fn sampleDepth(coord: vec2<f32>) -> f32 { let size=vec2<i32>(textureDimensions(t_depth)); return "
                "loadDepth(clamp(vec2<i32>(coord*vec2<f32>(size)),vec2<i32>(0),size-1)); }\n";
        code += kGeometry;
        // A pixel whose draw wrote no normal (an unlit material, the sky's edge) reads zero; normalize(0)
        // is NaN, which three leaves to the driver. The depth-derived normal is the defined answer.
        code += effect.normal ? "fn sampleNormal(coord: vec2<f32>) -> vec3<f32> { let n = "
                                "textureSampleLevel(t_normal,smp_normal,coord,0.0).rgb; "
                                "if (dot(n,n)==0.0) { return normalFromDepth(coord); } return normalize(n); }\n"
                              : "fn sampleNormal(coord: vec2<f32>) -> vec3<f32> { return normalFromDepth(coord); }\n";
    }
    if (effect.kind == "DenoiseNode") {
        const auto& samples = effect.parameters.at("sampleVectors");
        code += "const samples = array<vec3<f32>,16>(\n";
        for (size_t i = 0; i < 16; i++)
            code += "vec3<f32>(" + literal(samples[i * 3]) + "," + literal(samples[i * 3 + 1]) + "," +
                    literal(samples[i * 3 + 2]) + "),\n";
        code += ");\n";
    }
    fragment.wgsl.code = code + body;
    fragment.wgsl.id = 0;  // edited text: keyed by the text itself
    pass.package.variants.push_back({0, {vertex(), std::move(fragment)}});
    return pass;
}
} // namespace

Node importPostEffect(const json::Value& record, const std::vector<Node>& args, std::vector<std::string>& errors) {
    const auto invalid = [&](const std::string& reason) -> Node {
        errors.push_back("TN_TSL_POST_INVALID: " + get(record, "kind").string() + ": " + reason);
        return {};
    };
    auto effect = std::make_shared<PostEffect>();
    effect->kind = get(record, "kind").string();
    effect->output = get(record, "name").string();
    effect->inputs = args;
    const auto& post = get(record, "post");
    if (effect->output.empty() || !post.isObject() || !get(post, "normal").isBool() || !get(post, "temporal").isBool())
        return invalid("descriptor");
    effect->normal = get(post, "normal").boolean();
    effect->temporal = get(post, "temporal").boolean();
    const auto& scale = get(post, "resolutionScale");
    if (!scale.isNumber() || !std::isfinite(scale.number()) || scale.number() <= 0 || scale.number() > 8)
        return invalid("resolutionScale");
    effect->resolutionScale = static_cast<float>(scale.number());
    const size_t expected =
        effect->kind == "SMAANode" ? 1 : (effect->kind == "DenoiseNode" ? 2 : 1) + (effect->normal ? 1 : 0);
    if (args.size() != expected)
        return invalid("input count");
    const auto& parameters = get(post, "parameters");
    if (!parameters.isObject())
        return invalid("parameters");
    const std::vector<std::string> required =
        effect->kind == "GTAONode" ? std::vector<std::string>{"radius",
                                                              "thickness",
                                                              "distanceExponent",
                                                              "distanceFallOff",
                                                              "scale",
                                                              "samples",
                                                              "_cameraProjectionMatrix",
                                                              "_cameraProjectionMatrixInverse",
                                                              "_temporalDirection"}
        : effect->kind == "DenoiseNode"
            ? std::vector<std::string>{"lumaPhi",      "depthPhi", "normalPhi",
                                       "radius",       "index",    "_cameraProjectionMatrixInverse",
                                       "sampleVectors"}
            : std::vector<std::string>{};
    for (const auto& name : required) {
        const auto* v = parameters.find(name);
        const size_t count = name == "sampleVectors" ? 48 : name.find("Matrix") != std::string::npos ? 16 : 1;
        if (!v || !v->isArray() || v->items().size() != count)
            return invalid("parameter " + name);
        for (const auto& x : v->items()) {
            if (!x.isNumber() || !std::isfinite(x.number()) || !std::isfinite(static_cast<float>(x.number())))
                return invalid("finite parameter " + name);
            effect->parameters[name].push_back(static_cast<float>(x.number()));
        }
    }
    if (effect->kind == "GTAONode" &&
        (effect->parameters.at("samples")[0] < 1 || effect->parameters.at("samples")[0] > 256))
        return invalid("samples 1..256");
    const auto& images = get(post, "images");
    const size_t imageCount = effect->kind == "SMAANode" ? 2 : 1;
    if (!images.isArray() || images.items().size() != imageCount)
        return invalid("images");
    for (const auto& image : images.items()) {
        PostImage out;
        out.name = get(image, "name").string();
        const auto& w = get(image, "width");
        const auto& h = get(image, "height");
        const auto& bytes = get(image, "bytes");
        if (out.name.empty() || !w.isNumber() || !h.isNumber() || w.number() < 1 || h.number() < 1 ||
            w.number() > 4096 || h.number() > 4096 || w.number() != std::floor(w.number()) ||
            h.number() != std::floor(h.number()))
            return invalid("image dimensions");
        out.width = static_cast<uint32_t>(w.number());
        out.height = static_cast<uint32_t>(h.number());
        if (!bytes.isArray() || bytes.items().size() != size_t(out.width) * out.height * 4 ||
            !get(image, "nearest").isBool() || !get(image, "repeat").isBool() || !get(image, "flipY").isBool())
            return invalid("RGBA image");
        out.nearest = get(image, "nearest").boolean();
        out.repeat = get(image, "repeat").boolean();
        for (const auto& b : bytes.items()) {
            if (!b.isNumber() || b.number() < 0 || b.number() > 255 || b.number() != std::floor(b.number()))
                return invalid("image byte");
            out.bytes.push_back(static_cast<uint8_t>(b.number()));
        }
        if (get(image, "flipY").boolean())
            for (uint32_t y = 0; y < out.height / 2; y++)
                for (uint32_t x = 0; x < out.width * 4; x++)
                    std::swap(out.bytes[y * out.width * 4 + x], out.bytes[(out.height - 1 - y) * out.width * 4 + x]);
        effect->images.push_back(std::move(out));
    }
    if (effect->kind == "SMAANode" &&
        (effect->images[0].width != 160 || effect->images[0].height != 560 || effect->images[1].width != 66 ||
         effect->images[1].height != 33 || effect->images[0].nearest || !effect->images[1].nearest ||
         effect->images[0].repeat || effect->images[1].repeat))
        return invalid("r185 SMAA tables/samplers");
    try {
        if (effect->kind != "SMAANode")
            for (size_t i = effect->kind == "DenoiseNode" ? 1 : 0; i < args.size(); i++)
                textureName(args[i]);
    } catch (const std::exception& e) {
        return invalid(e.what());
    }
    auto n = std::make_shared<NodeData>();
    n->kind = Kind::PostEffect;
    n->type = effect->kind == "GTAONode" ? Type::f32() : Type::vec(4);
    n->name = effect->output;
    n->args = args;
    n->post = effect;
    return n;
}

std::vector<PostPass> postPasses(Node root) {
    std::vector<PostPass> passes;
    std::unordered_set<const NodeData*> seen;
    const std::function<void(Node)> visit = [&](Node n) {
        if (!n || !seen.insert(n.get()).second)
            return;
        for (const auto* list : {&n->args, &n->body, &n->otherwise})
            for (const auto& child : *list)
                visit(child);
        if (n->kind == Kind::RenderTexture)
            passes.push_back(renderTexturePass(n));
        if (!n->post)
            return;
        const auto& effect = *n->post;
        if (effect.kind == "SMAANode") {
            const std::string input = effect.output + "_input", edges = effect.output + "_edges",
                              weights = effect.output + "_weights";
            const PostNode post{key(effect.inputs[0]), [&](Program& p, uint32_t, ExprId coordinate) {
                                    tsl::Build scope(p);
                                    return lower(effect.inputs[0], p, {{"uv", coordinate}, {"screenUV", coordinate}});
                                }};
            auto programs = buildOutput(std::nullopt, false, &post, false);
            PostPass material;
            material.output = input;
            material.package.name = input;
            for (const Program* p : {&programs.vertex, &programs.fragment})
                for (const auto& d : p->diagnostics())
                    material.package.errors.push_back(d.code + ": " + d.node + ": " + d.reason);
            auto fragment = buildStage(programs.fragment);
            for (const auto& binding : fragment.bindings)
                if (binding.kind == BindingKind::Texture)
                    material.reads[binding.name.substr(2)] = binding.name.substr(2);
            material.uniforms = uniforms(effect.inputs[0]);
            material.package.variants.push_back({0, {buildStage(programs.vertex), std::move(fragment)}});
            passes.push_back(std::move(material));
            passes.push_back(rawPass(effect, edges, kSmaaEdges, {{"input", input}}));
            auto weight =
                rawPass(effect, weights, kSmaaWeights,
                        {{"edges", edges}, {"area", effect.images[0].name}, {"search", effect.images[1].name}});
            weight.images = effect.images;
            passes.push_back(std::move(weight));
            passes.push_back(rawPass(effect, effect.output, kSmaaBlend, {{"input", input}, {"weights", weights}}));
        } else {
            const bool denoise = effect.kind == "DenoiseNode";
            const size_t depth = denoise ? 1 : 0;
            std::map<std::string, std::string> reads{{"depth", textureName(effect.inputs[depth])},
                                                     {"noise", effect.images[0].name}};
            if (effect.normal)
                reads["normal"] = textureName(effect.inputs[depth + 1]);
            if (denoise)
                reads["input"] = textureName(effect.inputs[0]);
            auto pass = rawPass(effect, effect.output, denoise ? kDenoise : kGtao, std::move(reads), true);
            pass.images = effect.images;
            pass.clear = denoise ? 0 : 1;
            passes.push_back(std::move(pass));
        }
    };
    visit(root);
    return passes;
}
} // namespace tn::engine::shader::graph
