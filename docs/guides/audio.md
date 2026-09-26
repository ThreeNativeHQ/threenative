# Audio

Play sound effects, music and positional audio through `AudioBus`, mix categories apart, and check
in a playtest which sounds the game played.

## Play a sound

An `AudioBus` owns a group of sounds and attaches its listener to a camera. Load buffers once
through `ctx.assets.audio` and reuse them.

```ts
import { AudioBus } from "@threenative/core";

const effects = new AudioBus({ camera: ctx.camera, maxVoices: 24 });
const hit = await ctx.assets.audio("audio/hit.ogg");

// On a gameplay event, not every frame:
effects.play(hit, { cue: "player-hit", volume: 0.6 });
```

Browsers block audio until the player interacts with the page. The bus waits for that gesture
and queues sounds until then. Call `dispose()` when the owning scene or service ends.

## Play options

| Option | Effect |
| --- | --- |
| `volume` | Linear gain for this sound |
| `loop` | Repeat until stopped |
| `fade` | Fade-in time in seconds |
| `cue` | A label that playtests can count. It does not change the sound. |
| `refDistance` | Metres from the source where distance falloff begins (`playAt` only) |
| `rolloffFactor` | How fast volume drops past `refDistance`. 0 means no falloff (`playAt` only). |
| `detune` | Pitch offset in cents. Web only. |
| `lowpassHz` | Low-pass filter corner in Hz. Web only. |
| `cutoffSeconds` | Cut the sound off after this many seconds |

## Voices and positional sound

Each sounding clip uses a voice. The bus reuses voices and allows 48 one-shots at once by
default. Set `maxVoices` to change that. Past the limit, the oldest one-shot stops and the new
sound takes its slot. Looping sounds do not count toward the limit, so stop them yourself.
`music(buffer, options)` is `play` with `loop: true` by default.

`play` returns the voice. Treat it as valid only while that sound plays, because the bus reuses
it afterwards. Call `stopVoice(voice)` to stop one sound early.

`playAt(buffer, source, options)` plays a sound in the world. Pass an `Object3D` as `source` and
the sound follows it, or pass a `Vector3` for a fixed spot. Three.js defaults `refDistance` to
1 m, which makes a sound 20 m away nearly silent. Tune both distance options to your world scale.

## Mix and pause

```ts
effects.pause();             // opening a pause menu
effects.resume();            // back to gameplay
effects.setVolume(0.4, 0.2); // linear gain, fade in seconds
```

`pause()` and `resume()` keep each sound's position. `stop()` ends playback. `setVolume` moves the
whole bus and applies to sounds already playing.

Create one bus each for music, effects and ambience to mix them apart. Buses that share a
`listener` also share its master volume.

## Native formats

The native runtime decodes only RIFF/WAVE and Ogg Vorbis. An MP3 plays nothing on any native
target, so the asset build fails on it and names the file to re-encode.

The native host does not implement `detune` or `lowpassHz`. It ignores them and lists them in the
bus's `unsupported` report. Check that your mix still works without them.

You can declare loops and positional clips in `threenative.config.ts`. The build then cross-fades
loop seams and downmixes positional clips to mono.

```ts
assets: {
  audio: {
    overrides: [
      { glob: "audio/*-bed.ogg", loop: true },
      { glob: "audio/step-*.ogg", positional: true },
    ],
  },
},
```

The [asset pipeline README](../../packages/assets/README.md) covers normalisation, spectrum checks
and the other declarations.

## Check audio in a playtest

Give important sounds a `cue` label. ThreeNative counts every labelled cue and keeps a short
history. A [playtest](playtesting.md) scenario can then assert that a hit sound fired, or that a
narration line played only once. Audio assertions run on web and desktop.

```ts
audio: [{ cue: "speech:p01", maxPlays: 1 }]
```

Cue counts show what the game asked for. Listen on your target device too, for speech clarity,
distance falloff and the balance between music and effects.

## Source

- [audio.ts](../../packages/core/src/audio.ts)
- [README.md](../../packages/assets/README.md)
