import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const resources = readFileSync(
  fileURLToPath(new URL("../src/webgpu/bindings_resources.cpp", import.meta.url)),
  "utf8",
);

test("should map every BC compressed format Three can select on desktop adapters", () => {
  const required = {
    "bc1-rgba-unorm": "WGPUTextureFormat_BC1RGBAUnorm",
    "bc1-rgba-unorm-srgb": "WGPUTextureFormat_BC1RGBAUnormSrgb",
    "bc2-rgba-unorm": "WGPUTextureFormat_BC2RGBAUnorm",
    "bc2-rgba-unorm-srgb": "WGPUTextureFormat_BC2RGBAUnormSrgb",
    "bc3-rgba-unorm": "WGPUTextureFormat_BC3RGBAUnorm",
    "bc3-rgba-unorm-srgb": "WGPUTextureFormat_BC3RGBAUnormSrgb",
    "bc4-r-unorm": "WGPUTextureFormat_BC4RUnorm",
    "bc4-r-snorm": "WGPUTextureFormat_BC4RSnorm",
    "bc5-rg-unorm": "WGPUTextureFormat_BC5RGUnorm",
    "bc5-rg-snorm": "WGPUTextureFormat_BC5RGSnorm",
    "bc6h-rgb-ufloat": "WGPUTextureFormat_BC6HRGBUfloat",
    "bc6h-rgb-float": "WGPUTextureFormat_BC6HRGBFloat",
    "bc7-rgba-unorm": "WGPUTextureFormat_BC7RGBAUnorm",
    "bc7-rgba-unorm-srgb": "WGPUTextureFormat_BC7RGBAUnormSrgb",
  };

  for (const [name, native] of Object.entries(required)) {
    expect(resources).toContain(`if (format == "${name}") return ${native};`);
  }
});
