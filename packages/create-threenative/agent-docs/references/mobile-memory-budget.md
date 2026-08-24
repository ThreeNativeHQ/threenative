# What memory a phone actually gives you

Everything here was measured on a **physical Pixel 8** (Mali-G715, Vulkan, 2400x1080 surface) on
2026-08-23, running a real game through this framework. No estimates, no emulator.

## The headline

The game asked the GPU for 393 MiB of textures and buffers. Here is what that turned into:

| | |
| --- | --- |
| What the game asked `createTexture`/`createBuffer` for | 393 MiB |
| What the driver held (`dumpsys meminfo`: `GL mtrack` + `EGL mtrack`) | ~899 MiB |
| Process `VmRSS` | ~1.4 GiB |

That looks like the driver doubling everything you allocate. **It is not.** About **480 MiB was
already held at the first presented frame**, before the game had uploaded a single texture, and
across the entire asset load the driver then grew by *less* than the game requested.

So budget like this:

> **a ~500 MiB fixed floor, plus roughly the bytes you ask for.**

Not as a multiplier on your own textures. The practical consequence is that shaving 50 MiB off
your textures really does save about 50 MiB — but you start 500 MiB in the hole, and a phone
begins killing apps well under 2 GiB.

## Your sky is charged twice, and the second charge is the expensive one

Assigning one equirect to both `scene.background` and `scene.environment` looks free. It is not.
`scene.environment` builds an image-based light, and three.js sizes that light's render targets
from the **source equirect's width** — `cubeSize = width / 4`, rounded *down* to a power of two,
then two render targets of `3 x max(cubeSize, 112)` by `4 x cubeSize` in `rgba16float`.

Measured, on a real WebGPU adapter:

| equirect width | PMREM pair allocated | cost |
| --- | --- | --- |
| 3072 | 1536x2048 rgba16float x2 | **48 MiB** |
| 2048 | 1536x2048 rgba16float x2 | **48 MiB** |
| 1024 | 768x1024 rgba16float x2 | **12 MiB** |
| 512 | 384x512 rgba16float x2 | **3 MiB** |

Two things fall out of that table.

**Halving a 3072 sky to 2048 saves nothing.** The cost moves in power-of-two steps, so only
crossing a step changes anything. Resizing an asset "a bit smaller" is wasted work.

**Split the two uses.** The background is what the player looks at and wants every pixel it has.
The light does not: PMREM immediately convolves its source into roughness mips, so everything it
contributes is low-frequency, and the only detail that survives is a mirror reflection. Give the
environment its own smaller copy of the same image:

```ts
// One 3072-wide photograph, downsampled once to 1024 for the light.
scene.background = skyEquirect;      // full resolution — this is the visible sky
scene.environment = skyEquirectSmall; // 1024x512 copy — this is only ever blurred
```

That is 36 MiB back for a 2.7 MiB texture, with nothing visible changing. Pick 1024 over 512 if
your scene has polished metal or still water in it, since 512 halves the mirror again.

**Do this before you reach for texture compression.** It is one line, it costs nothing at
runtime, and it is larger than most compression wins on a small texture set.

## Where the rest of your budget goes

Ordinary things that are bigger than people expect, all from the same measured run:

- **Full-screen render targets scale with your device's real resolution, not your design
  resolution.** At 2400x1080 a single `rgba16float` colour target is 19 MiB and a `depth24plus`
  is 9.5 MiB. Post-processing chains multiply that by how many you keep alive.
- **Mip chains add a third.** A 2048x2048 `rgba8unorm-srgb` with a full mip pyramid is 21 MiB,
  not 16 MiB. Eight 1024x1024 maps with mips are 42 MiB between them.
- **Buffers are almost never the problem.** In that run, 3038 buffers came to 14 MiB total —
  under 4 % of the footprint. Do not spend your optimisation budget there.
- **A cubemap conversion is not free.** Setting `scene.background` to an equirect makes the
  renderer build a cubemap from it; at 3072x1536 that cubemap was 54 MiB on its own, separate
  from the 23 MiB source texture and separate again from the image-based light.

## How to check your own game

On native, the runtime prints its own accounting beside the present tick — watch `logcat` for
`TN_GPU_TEXTURES` and `TN_GPU_BUFFERS`, which bucket every texture by dimensions, format and mip
count so you can see which allocation is the big one rather than guessing. Read those numbers as
*what the game requested*; the driver's own total is a separate figure, and the floor above is why
the two never match.
