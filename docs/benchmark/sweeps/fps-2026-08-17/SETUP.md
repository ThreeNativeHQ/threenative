# Running this build from a fresh clone

The game loads the kit's models, textures and sky from `public/assets/`, and those files are
deliberately untracked (see `.gitignore` here and at the repository root — two of the FPS
models are not cleared for redistribution). Recreate them before `pnpm dev`:

```sh
cp -r ../fps-kit/assets ../fps-kit/tools .
mkdir -p public/assets
cp assets/models/enemy-terrorist.glb assets/models/player-viewmodel.glb public/assets/
cp assets/textures/range-target-face.png assets/textures/range-target-face-hit.png public/assets/
cp assets/textures/ue-test-surface.jpg public/assets/
cp assets/imported/polyhaven/sky.outdoor-cloudy/environment.jpg public/assets/sky.jpg
```

Then:

```sh
pnpm dev --host 127.0.0.1 --port 5173 --strictPort &
sh tools/capture.sh node tools/capture.mjs --url http://127.0.0.1:5173 --out screenshots/iter.png
sh tools/capture.sh pnpm test    # needs a display; the scenarios run headed on real WebGPU
```
