/**
 * Snapshot-only adaptation of OpenDLSS-NR numerics.wgsl and frame.wgsl at
 * 9d08f4184bbcb9d858e2fb7a7834ec0837a9d2f1. Copyright (c) 2026 maan, MIT.
 * See LICENSE.OpenDLSS-NR. Changes: GPU textures instead of CPU-staged buffers;
 * no motion/history/style; scene-linear HDR storage output instead of packed display pixels.
 * These changes require numerical qualification; upstream parity is not claimed.
 */
const COMMON = /* wgsl */ `
struct Params {
  size: vec4<u32>, // valid width/height, padded width/height
  control: vec4<f32>, // paper white, tone, structure, skin structure
  mix_control: vec4<f32>, // auto mask, intensity, color strength, reserved
  seed_and_padding: vec4<u32>,
};
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var original: texture_2d<f32>;

fn round_shift_right_even(value: u32, shift: u32) -> u32 {
  if (shift == 0u) { return value; }
  if (shift > 31u) { return 0u; }
  let quotient = value >> shift;
  let remainder = value & ((1u << shift) - 1u);
  let halfway = 1u << (shift - 1u);
  let up = (remainder > halfway) || (remainder == halfway && (quotient & 1u) != 0u);
  return quotient + select(0u, 1u, up);
}
fn f16_bits(value: f32) -> u32 {
  let bits = bitcast<u32>(value);
  let sign = (bits >> 16u) & 0x8000u;
  let exponent = (bits >> 23u) & 0xffu;
  let mantissa = bits & 0x7fffffu;
  if (exponent == 0xffu) { return sign | select(0x7c00u, 0x7e00u, mantissa != 0u); }
  var half_exponent = i32(exponent) - 112;
  if (half_exponent >= 31) { return sign | 0x7c00u; }
  if (half_exponent <= 0) {
    if (half_exponent < -10) { return sign; }
    return sign | round_shift_right_even(mantissa | 0x800000u, u32(14 - half_exponent));
  }
  var rounded = round_shift_right_even(mantissa, 13u);
  if (rounded == 0x400u) { rounded = 0u; half_exponent = half_exponent + 1; }
  if (half_exponent >= 31) { return sign | 0x7c00u; }
  return sign | (u32(half_exponent) << 10u) | rounded;
}
fn f16_to_f32(bits: u32) -> f32 {
  let sign = (bits & 0x8000u) << 16u;
  let exponent = (bits >> 10u) & 0x1fu;
  let mantissa = bits & 0x3ffu;
  if (exponent == 0u) {
    if (mantissa == 0u) { return bitcast<f32>(sign); }
    let shift = countLeadingZeros(mantissa) - 21u;
    let normalized = (mantissa << shift) & 0x3ffu;
    return bitcast<f32>(sign | ((113u - shift) << 23u) | (normalized << 13u));
  }
  if (exponent == 0x1fu) { return bitcast<f32>(sign | 0x7f800000u | (mantissa << 13u)); }
  return bitcast<f32>(sign | ((exponent + 112u) << 23u) | (mantissa << 13u));
}
fn round_f16(value: f32) -> f32 { return f16_to_f32(f16_bits(value)); }
fn srgb_encode(value: f32) -> f32 {
  let bounded = clamp(value, 0.0, 1.0);
  return select(1.055 * pow(bounded, 1.0 / 2.4) - 0.055, 12.92 * bounded, bounded <= 0.0031308);
}
fn srgb_decode(value: f32) -> f32 {
  let bounded = clamp(value, 0.0, 1.0);
  return select(pow((bounded + 0.055) / 1.055, 2.4), bounded / 12.92, bounded <= 0.04045);
}
fn proxy_component(value: f32) -> f32 {
  let finite = select(0.0, max(value, 0.0), value == value && abs(value) <= 65504.0);
  var relative = finite / max(params.control.x, 0.05);
  if (relative > 0.75) { relative = 0.75 + 0.25 * (1.0 - exp(-5.770780 * (relative - 0.75))); }
  return round_f16(srgb_encode(relative));
}
fn proxy_rgb(rgb: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(proxy_component(rgb.r), proxy_component(rgb.g), proxy_component(rgb.b));
}
fn centre(code: f32) -> f32 { return round_f16(round_f16(round_f16(code) - 0.5) * 0.125); }
`;

export const OPEN_DLSS_INPUT = COMMON + /* wgsl */ `
@group(0) @binding(2) var<storage, read_write> features: array<f32>;
fn hash_uniform(value: u32) -> f32 {
  var mixed = value;
  mixed = (mixed >> ((mixed >> 28u) + 4u)) ^ mixed;
  mixed = mixed * 0x108ef2d9u;
  let integer = ((mixed >> 30u) ^ (mixed >> 8u)) + 1u;
  return f32(integer) * bitcast<f32>(0x33800000u);
}
fn gaussian3(x: u32, y: u32, seed: u32) -> vec3<f32> {
  var base = (x * 0x8da6b343u) ^ (seed * 0x9e3779b9u) ^ (y * 0xd8163841u) ^ 0x243f6a88u;
  base = (base >> ((base >> 28u) + 4u)) ^ base;
  base = base * 0x108ef2d9u;
  base = (base >> 22u) ^ base;
  let u0 = hash_uniform(base * 0x2c9277b5u + 0xac564b05u);
  let u1 = hash_uniform(base * 0xfa6dc5f9u + 0x4712a88eu);
  let u2 = hash_uniform(base * 0xcaa5b80du + 0x21dd796bu);
  let u3 = hash_uniform(base * 0x83232c31u + 0x3463e0acu);
  let radius0 = sqrt(log2(u0) * bitcast<f32>(0x3f317218u) * -2.0);
  let radius1 = sqrt(log2(u2) * bitcast<f32>(0x3f317218u) * -2.0);
  let angle0 = u1 * bitcast<f32>(0x40c90fdbu);
  let angle1 = u3 * bitcast<f32>(0x40c90fdbu);
  return vec3<f32>(round_f16(radius0 * cos(angle0)), round_f16(radius0 * sin(angle0)),
                   round_f16(radius1 * cos(angle1)));
}
@compute @workgroup_size(8, 8)
fn input_features(@builtin(global_invocation_id) id: vec3<u32>) {
  if (any(id.xy >= params.size.zw)) { return; }
  let x = select(2u * params.size.x - id.x - 2u, id.x, id.x < params.size.x);
  let y = select(2u * params.size.y - id.y - 2u, id.y, id.y < params.size.y);
  let code = proxy_rgb(textureLoad(original, vec2<i32>(i32(x), i32(y)), 0).rgb);
  let centered = vec3<f32>(centre(code.r), centre(code.g), centre(code.b));
  let noise = gaussian3(id.x, id.y, params.seed_and_padding.x);
  let base = (id.y * params.size.z + id.x) * 16u;
  features[base + 0u] = noise.x;
  features[base + 1u] = noise.y;
  features[base + 2u] = noise.z;
  features[base + 3u] = 1.0;
  features[base + 4u] = centered.r;
  features[base + 5u] = centered.g;
  features[base + 6u] = centered.b;
  features[base + 7u] = centered.r;
  features[base + 8u] = centered.g;
  features[base + 9u] = centered.b;
  features[base + 10u] = 0.0; // no style in the snapshot interface
  features[base + 11u] = round_f16(params.control.y);
  features[base + 12u] = round_f16(select(params.control.z, 1.0, params.mix_control.x > 0.0));
  features[base + 13u] = round_f16(select(-1.0,
    select(params.control.w, params.control.z, params.control.w < 0.0), params.mix_control.x > 0.0));
  features[base + 14u] = round_f16(select(-1.0, params.control.z, params.mix_control.x > 0.0));
  features[base + 15u] = 0.0;
}`;

export const OPEN_DLSS_COMPOSE = COMMON + /* wgsl */ `
@group(0) @binding(2) var<storage, read> head: array<f32>;
@group(0) @binding(3) var enhanced: texture_storage_2d<rgba16float, write>;
fn truncate_half(value: f32) -> u32 {
  let bits = bitcast<u32>(value);
  let sign = (bits >> 16u) & 0x8000u;
  let exponent = (bits >> 23u) & 0xffu;
  let mantissa = bits & 0x7fffffu;
  if (exponent == 0xffu) { return sign | select(0x7c00u, 0x7e00u, mantissa != 0u); }
  let half_exponent = i32(exponent) - 112;
  if (half_exponent >= 31) { return sign | 0x7c00u; }
  if (half_exponent <= 0) {
    if (half_exponent < -10) { return sign; }
    return sign | ((mantissa | 0x800000u) >> u32(14 - half_exponent));
  }
  return sign | (u32(half_exponent) << 10u) | (mantissa >> 13u);
}
fn row3(a: vec3<f32>, b: vec3<f32>, c: vec3<f32>, value: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(dot(a, value), dot(b, value), dot(c, value));
}
fn luminance(color: vec3<f32>) -> f32 { return dot(color, vec3<f32>(0.212639, 0.715169, 0.072192)); }
fn to_oklab(color: vec3<f32>) -> vec3<f32> {
  var lms = row3(vec3<f32>(0.4122214708, 0.5363325363, 0.0514459929),
    vec3<f32>(0.2119034982, 0.6806995451, 0.1073969566),
    vec3<f32>(0.0883024619, 0.2817188376, 0.6299787005), color);
  lms = sign(lms) * pow(abs(lms), vec3<f32>(1.0 / 3.0));
  return row3(vec3<f32>(0.2104542553, 0.7936177850, -0.0040720468),
    vec3<f32>(1.9779984951, -2.4285922050, 0.4505937099),
    vec3<f32>(0.0259040371, 0.7827717662, -0.8086757660), lms);
}
fn from_oklab(lab: vec3<f32>) -> vec3<f32> {
  var lms = row3(vec3<f32>(1.0, 0.3963377774, 0.2158037573),
    vec3<f32>(1.0, -0.1055613458, -0.0638541728),
    vec3<f32>(1.0, -0.0894841775, -1.2914855480), lab);
  lms = lms * lms * lms;
  return row3(vec3<f32>(4.0767416621, -3.3077115913, 0.2309699292),
    vec3<f32>(-1.2684380046, 2.6097574011, -0.3413193965),
    vec3<f32>(-0.0041960863, -0.7034186147, 1.7076147010), lms);
}
fn clamp_ap1(color: vec3<f32>) -> vec3<f32> {
  let ap1 = max(row3(vec3<f32>(0.613097, 0.339523, 0.047379),
    vec3<f32>(0.070194, 0.916354, 0.013452), vec3<f32>(0.020616, 0.109570, 0.869815), color), vec3<f32>(0.0));
  return row3(vec3<f32>(1.705051, -0.621792, -0.083259),
    vec3<f32>(-0.130256, 1.140805, -0.010548), vec3<f32>(-0.024003, -0.128969, 1.152972), ap1);
}
fn hue_oklab(incorrect: vec3<f32>, correct: vec3<f32>) -> vec3<f32> {
  var result = to_oklab(incorrect);
  let correct_lab = to_oklab(correct);
  let incorrect_chroma = length(result.yz);
  let correct_chroma = length(correct_lab.yz);
  let scale = select(incorrect_chroma / correct_chroma, 1.0, correct_chroma == 0.0);
  result = vec3<f32>(result.x, correct_lab.y * scale, correct_lab.z * scale);
  return clamp_ap1(from_oklab(result));
}
fn upgrade_tone_map(original_color: vec3<f32>, proxy: vec3<f32>, neural: vec3<f32>) -> vec3<f32> {
  let original_y = luminance(original_color);
  let proxy_y = luminance(proxy);
  let neural_y = luminance(neural);
  if (neural_y <= 0.00001) { return original_color; }
  let ratio = select((neural_y + max(0.0, original_y - proxy_y)) / neural_y,
    original_y / max(proxy_y, 0.000001), original_y < proxy_y);
  return original_color + (hue_oklab(neural * ratio, neural) - original_color);
}
@compute @workgroup_size(8, 8)
fn compose_hdr(@builtin(global_invocation_id) id: vec3<u32>) {
  if (any(id.xy >= params.size.xy)) { return; }
  let source = textureLoad(original, vec2<i32>(id.xy), 0);
  let code = proxy_rgb(source.rgb);
  let field = (id.y * params.size.z + id.x) * 4u;
  let neural = clamp(code + vec3<f32>(head[field], head[field + 1u], head[field + 2u]) * 0.25,
    vec3<f32>(0.0), vec3<f32>(1.0));
  var published: vec3<f32>;
  for (var c = 0u; c < 3u; c = c + 1u) {
    let value = select(clamp(fma(params.mix_control.y, neural[c] - code[c], code[c]), 0.0, 1.0),
      neural[c], params.mix_control.y == 1.0);
    published[c] = f16_to_f32(truncate_half(value));
  }
  let paper = max(params.control.x, 0.05);
  let original_color = source.rgb / paper;
  let proxy_linear = vec3<f32>(srgb_decode(code.r), srgb_decode(code.g), srgb_decode(code.b));
  let neural_linear = vec3<f32>(srgb_decode(published.r), srgb_decode(published.g), srgb_decode(published.b));
  let upgraded = upgrade_tone_map(original_color, proxy_linear, neural_linear);
  let original_y = luminance(original_color);
  let ratio = select(clamp(luminance(upgraded) / original_y, 0.0, 4.0), 1.0, original_y == 0.0);
  let luminance_only = original_color * ratio;
  let result = (luminance_only + (upgraded - luminance_only) * params.mix_control.z) * paper;
  // No ACES or sRGB here: the game's existing output pipeline applies those exactly once.
  textureStore(enhanced, vec2<i32>(id.xy), vec4<f32>(result, source.a));
}`;
