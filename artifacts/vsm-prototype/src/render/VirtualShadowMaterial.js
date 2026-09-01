const MAX_CLIP_LEVELS = 4;

const vertexShader = /* glsl */ `
out vec3 vWorldPosition;
out vec3 vWorldNormal;
out vec3 vViewPosition;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vViewPosition = viewPosition.xyz;
  gl_Position = projectionMatrix * viewPosition;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
precision highp int;

#define MAX_CLIP_LEVELS 4

uniform sampler2D uShadowAtlas;
uniform sampler2D uPageTable;
uniform vec3 uLightBasisU;
uniform vec3 uLightBasisV;
uniform vec3 uLightBasisW;
uniform vec3 uSunDirection;
uniform vec3 uCameraWorldPosition;
uniform vec2 uCameraLightUV;
uniform vec2 uClipMinPage[MAX_CLIP_LEVELS];
uniform float uPageWorldSize[MAX_CLIP_LEVELS];
uniform float uClipExtents[MAX_CLIP_LEVELS];
uniform int uClipCount;
uniform int uPagesPerAxis;
uniform float uAtlasPagesPerAxis;
uniform float uPageSize;
uniform float uLightDistance;
uniform float uLightNear;
uniform float uLightFar;
uniform float uSelectionGuard;
uniform float uShadowBias;
uniform float uNormalBias;
uniform float uFilterRadius;
uniform float uShadowStrength;
uniform int uDebugMode;

uniform vec3 uBaseColor;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform float uAmbientIntensity;
uniform float uSunIntensity;
uniform float uRoughness;
uniform float uMetalness;
uniform float uFogDensity;
uniform vec3 uFogColor;
uniform float uMaterialVariation;

in vec3 vWorldPosition;
in vec3 vWorldNormal;
in vec3 vViewPosition;
out vec4 outColor;

const float UnpackDownscale = 255.0 / 256.0;
const vec3 PackFactors = vec3(256.0 * 256.0 * 256.0, 256.0 * 256.0, 256.0);
const vec4 UnpackFactors = UnpackDownscale / vec4(PackFactors, 1.0);

float unpackRGBAToDepth(const in vec4 value) {
  return dot(value, UnpackFactors);
}

vec2 worldToLightUV(vec3 worldPosition) {
  return vec2(dot(worldPosition, uLightBasisU), dot(worldPosition, uLightBasisV));
}

int chooseClipLevel(vec3 worldPosition) {
  vec2 lightUV = worldToLightUV(worldPosition);
  float distanceFromCenter = max(
    abs(lightUV.x - uCameraLightUV.x),
    abs(lightUV.y - uCameraLightUV.y)
  );
  int selected = max(uClipCount - 1, 0);
  for (int level = 0; level < MAX_CLIP_LEVELS; level += 1) {
    if (level < uClipCount && distanceFromCenter <= uClipExtents[level] * uSelectionGuard) {
      selected = level;
      break;
    }
  }
  return selected;
}

bool lookupVirtualPage(
  vec3 worldPosition,
  int requestedLevel,
  out float lit,
  out int resolvedLevel,
  out bool usedFallback
) {
  vec2 lightUV = worldToLightUV(worldPosition);
  float receiverDistance = uLightDistance - dot(worldPosition, uLightBasisW);
  float receiverDepth = clamp(
    (receiverDistance - uLightNear) / (uLightFar - uLightNear),
    0.0,
    1.0
  );

  for (int fallback = 0; fallback < MAX_CLIP_LEVELS; fallback += 1) {
    int level = requestedLevel + fallback;
    if (level >= uClipCount) break;

    float pageWorldSize = uPageWorldSize[level];
    vec2 virtualCoordinate = lightUV / pageWorldSize;
    ivec2 absolutePage = ivec2(floor(virtualCoordinate));
    ivec2 localPage = absolutePage - ivec2(round(uClipMinPage[level]));

    if (
      localPage.x < 0 || localPage.y < 0
      || localPage.x >= uPagesPerAxis || localPage.y >= uPagesPerAxis
    ) {
      continue;
    }

    int tableIndex = localPage.y * uPagesPerAxis + localPage.x;
    vec4 pageEntry = texelFetch(uPageTable, ivec2(tableIndex, level), 0);
    if (pageEntry.b < 0.5) continue;

    vec2 physicalSlot = floor(pageEntry.rg * 255.0 + 0.5);
    vec2 localPageUV = fract(virtualCoordinate);
    vec2 atlasUV = (physicalSlot + localPageUV) / uAtlasPagesPerAxis;
    float storedDepth = unpackRGBAToDepth(texture(uShadowAtlas, atlasUV));

    lit = receiverDepth - uShadowBias <= storedDepth ? 1.0 : 0.0;
    resolvedLevel = level;
    usedFallback = fallback > 0;
    return true;
  }

  lit = 1.0;
  resolvedLevel = max(uClipCount - 1, 0);
  usedFallback = true;
  return false;
}

float sampleVirtualShadow(
  vec3 worldPosition,
  vec3 worldNormal,
  out int requestedLevel,
  out int resolvedLevel,
  out bool usedFallback
) {
  requestedLevel = chooseClipLevel(worldPosition);
  float texelWorldSize = uPageWorldSize[requestedLevel] / uPageSize;
  float radius = max(texelWorldSize * uFilterRadius, 0.00001);
  float sum = 0.0;
  int lastResolved = requestedLevel;
  bool anyFallback = false;

  for (int tapY = -1; tapY <= 1; tapY += 1) {
    for (int tapX = -1; tapX <= 1; tapX += 1) {
      vec3 tapPosition = worldPosition
        + worldNormal * uNormalBias
        + uLightBasisU * (float(tapX) * radius)
        + uLightBasisV * (float(tapY) * radius);
      float tapLit = 1.0;
      int tapResolved = requestedLevel;
      bool tapFallback = false;
      lookupVirtualPage(tapPosition, requestedLevel, tapLit, tapResolved, tapFallback);
      sum += tapLit;
      lastResolved = max(lastResolved, tapResolved);
      anyFallback = anyFallback || tapFallback;
    }
  }

  resolvedLevel = lastResolved;
  usedFallback = anyFallback;
  float filtered = sum / 9.0;
  return mix(1.0, filtered, uShadowStrength);
}

vec3 clipDebugColor(int level) {
  if (level == 0) return vec3(0.12, 0.83, 1.0);
  if (level == 1) return vec3(0.22, 1.0, 0.48);
  if (level == 2) return vec3(1.0, 0.73, 0.18);
  return vec3(1.0, 0.22, 0.42);
}

float pageGrid(vec3 worldPosition, int level) {
  vec2 pageUV = fract(worldToLightUV(worldPosition) / uPageWorldSize[level]);
  vec2 edgeDistance = min(pageUV, 1.0 - pageUV);
  float closestEdge = min(edgeDistance.x, edgeDistance.y);
  return smoothstep(0.0, 0.018, closestEdge);
}

float hash21(vec2 point) {
  point = fract(point * vec2(123.34, 456.21));
  point += dot(point, point + 45.32);
  return fract(point.x * point.y);
}

void main() {
  vec3 normal = normalize(vWorldNormal);
  vec3 viewDirection = normalize(uCameraWorldPosition - vWorldPosition);
  vec3 lightDirection = normalize(uSunDirection);

  int requestedLevel = 0;
  int resolvedLevel = 0;
  bool usedFallback = false;
  float shadow = sampleVirtualShadow(
    vWorldPosition,
    normal,
    requestedLevel,
    resolvedLevel,
    usedFallback
  );

  float nDotL = max(dot(normal, lightDirection), 0.0);
  float skyWeight = normal.y * 0.5 + 0.5;
  vec3 ambientColor = mix(uGroundColor, uSkyColor, skyWeight) * uAmbientIntensity;

  float variation = hash21(floor(vWorldPosition.xz * 0.85));
  vec3 albedo = uBaseColor * mix(0.93, 1.07, variation * uMaterialVariation);
  vec3 direct = uSunColor * (uSunIntensity * nDotL * shadow);

  vec3 halfVector = normalize(lightDirection + viewDirection);
  float specularPower = mix(110.0, 10.0, clamp(uRoughness, 0.0, 1.0));
  float specular = pow(max(dot(normal, halfVector), 0.0), specularPower);
  vec3 dielectricSpecular = mix(vec3(0.04), albedo, uMetalness);
  vec3 color = albedo * (ambientColor + direct) + dielectricSpecular * specular * shadow * 0.42;

  if (uDebugMode == 1) {
    vec3 debugColor = clipDebugColor(requestedLevel);
    float grid = pageGrid(vWorldPosition, requestedLevel);
    color = mix(color, debugColor, 0.48);
    color *= mix(0.18, 1.0, grid);
  } else if (uDebugMode == 2) {
    color = vec3(shadow);
  } else if (uDebugMode == 3) {
    vec3 requestedColor = clipDebugColor(requestedLevel);
    vec3 resolvedColor = clipDebugColor(resolvedLevel);
    color = usedFallback ? mix(requestedColor, resolvedColor, 0.72) : resolvedColor;
    color *= 0.35 + shadow * 0.65;
  }

  float fogDistance = length(vViewPosition);
  float fogAmount = 1.0 - exp(-uFogDensity * uFogDensity * fogDistance * fogDistance);
  color = mix(color, uFogColor, clamp(fogAmount, 0.0, 0.94));

  color = color / (color + vec3(1.0));
  color = pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));
  outColor = vec4(color, 1.0);
}
`;

export function createVirtualShadowMaterial(THREE, sharedUniforms, {
  color = 0x8b8e91,
  roughness = 0.72,
  metalness = 0,
  materialVariation = 0.2,
  side = THREE.FrontSide,
  polygonOffset = false,
  polygonOffsetFactor = 0,
  polygonOffsetUnits = 0,
} = {}) {
  if (!THREE?.ShaderMaterial || !sharedUniforms) {
    throw new TypeError('THREE and shared virtual-shadow uniforms are required');
  }

  const material = new THREE.ShaderMaterial({
    name: 'ThreeNativeVirtualShadowMaterial',
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    uniforms: {
      ...sharedUniforms,
      uBaseColor: { value: new THREE.Color(color) },
      uRoughness: { value: roughness },
      uMetalness: { value: metalness },
      uMaterialVariation: { value: materialVariation },
    },
    side,
    polygonOffset,
    polygonOffsetFactor,
    polygonOffsetUnits,
  });
  material.toneMapped = false;
  material.userData.threeNativeVirtualShadow = true;
  return material;
}

export function getVirtualShadowShaderSource() {
  return { vertexShader, fragmentShader, maxClipLevels: MAX_CLIP_LEVELS };
}
