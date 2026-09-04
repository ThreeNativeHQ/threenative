# AUDIO-REQUESTS.md

Changes the audio lane needs in files it does not own. Filed rather than applied, because
`packages/runtime-native/**` belongs to another lane right now.

Everything here was found while auditing `packages/core/src/audio.ts` against the native host for
wildwood's ambient bed. The core-side half of each item is already landed and green; these are the
native halves that would let core stop reporting the capability as missing.

## 1. `loopStart` / `loopEnd` never reach the C++ source node — a trimmed loop clicks on native

> **State it plainly, because a green browser run does not say it.** A loop authored the ordinary
> way — encode the file, then trim the encoder's padding at runtime with `loopStart`/`loopEnd` —
> **is seamless on web and clicks on every native target today**. The two properties are accepted
> and silently ignored over there, so the loop wraps at the whole buffer, padding included. Nothing
> reports it. Under this project's rule that a feature working on web only is unfinished, runtime
> loop trimming is not a shipped feature.
>
> The narrow exception, and the reason wildwood is not affected: a buffer that is *already* gapless
> and continuous from its last sample to its first loops correctly on native, because wrapping at
> the whole buffer is then exactly the right thing to do. That is why this game cross-fades its
> loops offline before encoding rather than trimming them at runtime — see `CREDITS-AUDIO.md` in
> the game. It is a workaround for this gap, not evidence that the gap is closed.


`packages/runtime-native/src/audio/audio_bindings.cpp:192-193` sets `loopStart` and `loopEnd` as
plain JS numbers on the buffer-source object. Nothing forwards them. The C++ node reads
`loopStart_` / `loopEnd_` in its mixer (`src/audio/audio_context.cpp:315-320`), so the machinery is
there and only the binding is missing — every native loop wraps at the whole buffer, whatever the
game asks for.

Three's `Audio.play()` assigns `source.loopStart = this.loopStart` on every start, so the moment
those become accessors the whole path works.

**Request**, mirroring the `loop` binding immediately above it:

- `audio_bindings.cpp`: add `_setLoopStart` / `_setLoopEnd` next to `_setLoop`, calling through to
  the node.
- `src/runtime-scripts/audio-source-properties.js`: define `loopStart` and `loopEnd` as accessors
  that call them, exactly as `loop` is defined today.

**Why the audio lane cares.** Encoder padding is the one thing that makes an otherwise seamless
loop click, and trimming it at runtime with `loopStart`/`loopEnd` is the portable fix. Without the
binding it would be a web-only helper, so `IAudioPlayOptions` does **not** expose those two, and
wildwood pays for it by trimming and cross-fading the file offline instead. That works, but it
means every game has to own an encoder, and the fix is about fifteen lines over there.

## 2. `createBiquadFilter` is absent — `lowpassHz` is dropped on native

`AudioContext` binds `createBuffer`, `createBufferSource`, `createGain` and `createPanner`, and no
filter factory. `AudioBus`'s `lowpassHz` — distance-and-air dulling, the difference between a mix
that is in a place and one that is not — therefore does nothing on any native target.

As of this commit core no longer drops it in silence: the bus names it in
`audioRuntimeSnapshot().unsupported`, and a playtest can fail a build on that. A native
`BiquadFilterNode` (lowpass alone would cover every current caller) would let core stop reporting
it.

## 3. `detune` is bound as an inert stand-in — cue de-phasing is dropped on native

`audio_bindings.cpp:220` gives the buffer source `createPassiveAudioParamJS(engine, 0.0f)` for
`detune`: it carries `setValueAtTime`, `setTargetAtTime` and `linearRampToValueAtTime`, and all
three return undefined without touching playback. `playbackRate` (line 221) is the same.

The visible effect is that a repeated sample — a footstep, above all — plays back bit-identical
every time on native and comb-filters with its own copies, which is exactly the artefact `detune`
exists to prevent. Core now reports this one too, discriminating a real `AudioParam` by
`cancelScheduledValues`, which the passive param does not carry.

Playback-rate detune in the C++ mixer would fix both properties at once.

## 5. There is no way to stop one voice — a per-entity loop cannot be ended

`AudioBus.stop()` stops everything on the bus. There is nothing that ends a single voice, and the
returned handle cannot be used for it either: three's `Audio.stop()` sets `source.onended = null`
before stopping, so the bus's reclaim hook never fires. The voice stays in `#live` for the life of
the bus — never returned to the pool, still counted in `voices`, still parented into the scene
graph. That is the leak the pool was built to prevent, reachable through the public API.

It bites the moment a game gives a loop to an entity, which is the obvious use of `playAt`:

```ts
// An animal starts grazing. There is no call that ends this when it stops.
const chewing = bus.playAt(buffer, animal.object, { loop: true });
```

Wildwood wanted exactly this for six grazing animals and could not have it. The workaround it
ships is intermittent one-shots — a bite every two seconds or so instead of a held loop, which
suits chewing and does not suit a river, a fire, a beehive or a machine.

**Request:** `AudioBus.release(voice)` (or `stop(voice?)`), which retires that one voice through
`#retire` so it leaves the scene graph and returns to the free list. Roughly:

```ts
release(voice: ThreeAudio<AudioNode>): void {
  const entry = this.#live.find((candidate) => candidate.voice === voice);
  if (entry !== undefined) this.#reclaim(entry);
}
```

It is portable — nothing here touches a browser-only API — and it wants a spec proving the released
voice leaves `voices`, returns to `pooled`, and leaves the scene graph, plus one proving a voice
released twice is not double-counted. I did not add it because the tarball rebuild is the
coordinator's and the game had a workaround; it is a small, contained addition to a file this lane
owns.

## For the asset-pipeline audio pass: the seam metric that must not throw on good audio

Written here rather than built, because conditioning is the pipeline's job and this is the one part
of it that is easy to get wrong in a way that blocks builds.

**A bare wrap step is not a threshold-able quantity.** `measureSeam` in the pass as drafted returns
`|x[0] − x[n−1]|` and nothing else. Absolute steps are not comparable between clips, because what
makes a join audible is how it compares to the signal *around* it. Measured on wildwood's three
loops, at their own sample rate:

| clip | wrap step | 99th-pct step within 50 ms of the join | ratio |
| --- | --- | --- | --- |
| `forest-bed.ogg` | 0.016142 | 0.041870 | 0.39x |
| `forest-birds.ogg` | 0.066752 | 0.298793 | **0.22x** |
| `lake-shore.ogg` | 0.000648 | 0.005415 | 0.12x |

By the bare step `forest-birds` looks four times worse than the bed. By the only measure that
tracks audibility it is the *better* join of the two. **A seam assertion that throws on the bare
step fails a clip whose wrap is fine** — and a throwing gate that is wrong is worse than no gate,
because the fix people reach for is deleting the assertion.

Three things worth copying rather than re-deriving:

1. **Ratio, not magnitude.** `wrap / p99(steps within 50 ms either side of the join)`. A sparse clip
   is mostly quiet, so a whole-clip percentile flatters its join; a dense one is mostly loud, so the
   same percentile condemns a join nobody could hear.
2. **A limit of 1.5x, not 1.0x.** A flawless wrap that lands on the signal's steepest point *is* the
   largest step in its neighbourhood and scores exactly 1.0 — a pure sine looped over a whole number
   of cycles measures 1.000000000000223. A 1.0 limit fails a perfect loop on float error.
3. **Never resample before measuring.** A resampler's FIR window runs off the end of the data at the
   first and last output sample and is zero-padded, so those two are the only wrong samples in the
   file and a seam test looks at exactly them. A 22.05 kHz decode of this set inflated the reported
   step three to sevenfold and reordered which clip looked worst.

All three are implemented and unit-tested in `packages/playtest/src/runner/audio.ts` —
`measureSeam` and the `seam` case of `checkClip`. Importing them, or matching the metric exactly,
keeps the build gate and the inspector from ever disagreeing about the same file, which is its own
class of wasted afternoon.

**One premise correction, offered because a lane about to build a gate should not inherit it.**
`forest-birds.ogg` was reported as clicking every cycle, and it was not: the cross-fade did take.
The pre-encode PCM and the decoded `.ogg` agree, and the ratio above is 0.22x. What that clip
genuinely had was 6.1% of its energy below 100 Hz — rumble a wood does not have — which is a content
defect, now high-passed at 110 Hz, and a different thing from a seam. The hand pass did have a real
gap, and it is worth naming precisely: it measured nothing about *content*. It never noticed the
discovery chime was 80% low-mid, and it never noticed fifteen footsteps carrying up to 45% of their
energy below 100 Hz. Those are the defects a pipeline pass and `threenative-playtest audio` between
them should make impossible.

## 4. Codec coverage is narrow, and already gated — no request, recorded so nobody re-finds it

`decodeAudioFile` sniffs the header and implements exactly two containers: RIFF/WAVE and Ogg
Vorbis. An mp3, AAC, FLAC or Opus file falls through to the WAV decoder and returns `nullptr`, which
reaches the game as a rejected `decodeAudioData` — a game shipping mp3 audio would simply be silent
on every native target.

**This is already caught**, and loudly: `packages/runtime-native/scripts/asset-preflight.mjs`
sniffs the same twelve bytes and fails the native build naming the container it found and the two
it accepts, and `tests/audio-decode-ogg.test.mjs` fails if that list and the decoder ever disagree.
So nobody ships an mp3 bed by accident. It is written down here only because it is the reason
wildwood's audio is Ogg Vorbis: it is the one lossy codec both targets read, and it is not a
preference.

## 5. There is no streaming path on either target — a long bed is resident PCM

Not a native-only gap, and not a request yet — recorded so the next lane does not rediscover it.

`ctx.assets.audio(path)` resolves to three's `AudioLoader`, which fetches the whole file and
`decodeAudioData`s it into an `AudioBuffer`. `AudioBus` takes `AudioBuffer` and nothing else. So a
four-minute stereo forest bed at 48 kHz costs about 92 MB of float PCM resident, from a file of
perhaps 3 MB, and no API in the engine can express anything cheaper.

The browser answer is `MediaElementAudioSourceNode`, which the native host has no equivalent of, so
adding it to core would ship a web-only feature — against the rules in `/AGENTS.md`. The portable
answer is a decode-on-demand ring fed from a fetched byte range, which is a real piece of work and
wants a PRD.

Until then the workaround is the one wildwood uses: **short loops**. Its bed is 22 s, which decodes
to about 7.7 MB, and the seam is made inaudible offline instead of at runtime.
