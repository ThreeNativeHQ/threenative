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
