# Optional VRM 1 avatar reader

Actual three-vrm model loading with editable WebGPU material selection in src/render/vrm-materials.ts. Normal core dependencies and games remain unchanged.

```sh
cd examples/integrations/vrm
npm install --ignore-scripts
npm test
```

```ts
const reader = createVrmModelReader(configuredGltfLoader);
// Supply reader.model through createAssetLoader's existing model override.
// Preserve ordinary KTX2/decoder/plugin configuration on configuredGltfLoader.
const asset = await assets.model<IVrmAsset>('characters/survivor.vrm');
const avatar = await asset.instantiate();
scene.add(avatar.scene);
avatar.setExpression('happy', 0.6);
avatar.update(dt); // after the existing AnimationPlayer/mixer on the fixed step
avatar.dispose(); // scene teardown
```

Core retains logical-path resolution and caching. Its cached VRM value is a byte-backed asset descriptor, not a shared live avatar. Each instantiate reparses independent humanoid/expression/spring state; scene cloning is not sufficient. Ordinary glTF returns ordinary GLTF results from the same configured loader. No second asset cache or loop is installed.

Format detection uses bytes, not extensions, so hashed GLBs work. The container gate admits glTF 2 and VRM 1.0 and validates chunk lengths/UTF8/required metadata. Legacy VRM 0 and unsupported versions fail explicitly. This is not full glTF validation. Cooking must preserve VRM extensions; use the existing pass-through path until retention is proven.

Asset disposal blocks future instances without destroying live avatars. Reader disposal unregisters its plugin. Cancellation after a completed parse releases its owned scene. Default disposal assumes fresh parses own their resources; pass release for plugins borrowing shared assets. readBytes is injectable for the existing platform transport. No browser globals are added beyond capabilities already required by Three's loader.

Executed locally: 10 format-contract tests pass after the failing baseline; document.ts passes strict TypeScript 5.8.3. The real VRM/GLTF suite uses synthetic metadata/bones and is included in npm test, but dependency-backed tests/build are unrun locally because downloads are unavailable. Integration vrm runs the complete command on PR changes. Actual MToon GPU rendering, spring motion, cook retention, native parity, reviewed lockfile and licensed real-avatar fixture remain open. Test the actual framework-patched renderer before merging.

three-vrm and Three.js remain MIT dependencies. No third-party avatar is redistributed; avatar permissions remain separate from library licensing.
