/**
 * Synthesises the adventure kit's sound: eleven one-shots, a wind-and-birds bed and a slow melody.
 *
 * Every sample is computed here from sine, saw and noise, so the clips are original and carry no
 * licence. Mono 16-bit PCM at 16 kHz (11.025 kHz for the melody) keeps the whole set near 650 KB. The two
 * loops are made seamless by cross-fading their tail into their head, because a click at the seam
 * is the first thing a listener hears in a bed that repeats.
 *
 *   pnpm tsx scripts/adventure-audio.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.resolve("packages/create-threenative/templates/adventure/assets");
const SR = 16_000;
const TAU = Math.PI * 2;

/** A tiny deterministic noise source: the same bytes every run, so the asset diff is empty. */
function noise(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/** Attack-decay envelope: linear up over `attack`, exponential down with time constant `decay`. */
const env = (t: number, attack: number, decay: number): number =>
  (t < attack ? t / attack : 1) * Math.exp(-Math.max(0, t - attack) / decay);

function render(
  seconds: number,
  rate: number,
  sample: (t: number, i: number) => number,
): Float32Array {
  const out = new Float32Array(Math.floor(seconds * rate));
  for (let i = 0; i < out.length; i += 1) out[i] = sample(i / rate, i);
  return out;
}

/** A one-pole low-pass whose corner may move: `corner(t)` in Hz. */
function lowpass(input: Float32Array, rate: number, corner: (t: number) => number): Float32Array {
  const out = new Float32Array(input.length);
  let y = 0;
  for (let i = 0; i < input.length; i += 1) {
    const a = 1 - Math.exp((-TAU * corner(i / rate)) / rate);
    y += a * ((input[i] as number) - y);
    out[i] = y;
  }
  return out;
}

function normalise(data: Float32Array, peak: number): Float32Array {
  let max = 1e-9;
  for (const v of data) max = Math.max(max, Math.abs(v));
  return data.map((v) => (v / max) * peak);
}

function write(name: string, data: Float32Array, rate = SR): void {
  const pcm = Buffer.alloc(data.length * 2);
  data.forEach((v, i) => pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  writeFileSync(path.join(OUT, name), Buffer.concat([header, pcm]));
  console.info(
    `${name}: ${(data.length / rate).toFixed(2)} s, ${((44 + pcm.length) / 1024).toFixed(0)} KB`,
  );
}

/** Folds the last `seconds` of a loop into its start so the wrap point is continuous. */
function loop(data: Float32Array, rate: number, seconds: number): Float32Array {
  const fade = Math.floor(seconds * rate);
  const body = data.slice(0, data.length - fade);
  for (let i = 0; i < fade; i += 1) {
    const w = i / fade;
    body[i] = (body[i] as number) * w + (data[body.length + i] as number) * (1 - w);
  }
  return body;
}

const sine = (f: number, t: number): number => Math.sin(TAU * f * t);
mkdirSync(OUT, { recursive: true });

// --- one-shots ---------------------------------------------------------------------------------
{
  const n = noise(1);
  const raw = render(0.3, SR, (t) => n() * env(t, 0.03, 0.09));
  write(
    "swing.wav",
    normalise(
      lowpass(raw, SR, (t) => 500 + t * 9000),
      0.55,
    ),
  );
}
{
  const n = noise(2);
  const raw = render(0.34, SR, (t) => n() * Math.sin((Math.PI * t) / 0.34) ** 2);
  write(
    "roll.wav",
    normalise(
      lowpass(raw, SR, () => 1100),
      0.4,
    ),
  );
}
{
  const n = noise(3);
  write(
    "hit.wav",
    normalise(
      render(
        0.26,
        SR,
        (t) =>
          sine(140 - 90 * (t / 0.26), t) * env(t, 0.004, 0.07) + n() * env(t, 0.001, 0.02) * 0.6,
      ),
      0.8,
    ),
  );
}
write(
  "hurt.wav",
  normalise(
    render(
      0.42,
      SR,
      (t) =>
        Math.tanh(2.2 * sine(96 - 50 * (t / 0.42), t)) * env(t, 0.005, 0.12) +
        sine(55, t) * env(t, 0.01, 0.2) * 0.5,
    ),
    0.85,
  ),
);
write(
  "block.wav",
  normalise(
    render(
      0.42,
      SR,
      (t) =>
        (sine(880, t) + 0.7 * sine(1327, t) + 0.5 * sine(1782, t) + 0.3 * sine(2365, t)) *
        env(t, 0.002, 0.09),
    ),
    0.6,
  ),
);
write(
  "gem.wav",
  normalise(
    render(
      0.5,
      SR,
      (t) =>
        sine(880, t) * env(t, 0.004, 0.09) +
        (t > 0.07 ? sine(1320, t - 0.07) * env(t - 0.07, 0.004, 0.14) : 0),
    ),
    0.55,
  ),
);
write(
  "sigil.wav",
  normalise(
    render(1.6, SR, (t) => {
      let v = 0;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => {
        const u = t - k * 0.13;
        if (u > 0) v += (sine(f, u) + 0.25 * sine(f * 2, u)) * env(u, 0.01, 0.5);
      });
      return v;
    }),
    0.6,
  ),
);
{
  const n = noise(4);
  write(
    "pot.wav",
    normalise(
      render(0.4, SR, (t) => {
        const bursts = [0, 0.05, 0.11, 0.19].reduce(
          (a, b) => a + (t > b ? env(t - b, 0.001, 0.035) : 0),
          0,
        );
        return n() * bursts * (0.6 + 0.4 * sine(190, t));
      }),
      0.6,
    ),
  );
}
{
  const n = noise(5);
  const creak = render(0.5, SR, (t) => {
    const saw = ((110 + 40 * t) * t) % 1;
    return (saw * 2 - 1) * Math.sin((Math.PI * t) / 0.5) * (0.6 + 0.4 * n());
  });
  const shaped = lowpass(creak, SR, () => 700);
  write(
    "chest.wav",
    normalise(
      render(
        1.4,
        SR,
        (t, i) =>
          (i < shaped.length ? (shaped[i] as number) * 0.7 : 0) +
          (t > 0.45
            ? (sine(659.25, t - 0.45) + 0.5 * sine(987.77, t - 0.45)) * env(t - 0.45, 0.01, 0.35)
            : 0),
      ),
      0.6,
    ),
  );
}
write(
  "altar.wav",
  normalise(
    render(3.2, SR, (t) => {
      const swell = env(t, 1.1, 1.3);
      let v = 0;
      for (const f of [130.81, 196, 261.63, 329.63, 392, 523.25])
        v += sine(f, t) * (1 + 0.2 * sine(5, t));
      return v * swell + sine(1046.5, t - 0.6) * (t > 0.6 ? env(t - 0.6, 0.02, 0.8) * 0.6 : 0);
    }),
    0.6,
  ),
);
write(
  "talk.wav",
  normalise(
    render(0.11, SR, (t) => sine(392, t) * env(t, 0.005, 0.03)),
    0.35,
  ),
);
{
  const n = noise(6);
  write(
    "step.wav",
    normalise(
      lowpass(
        render(0.13, SR, (t) => n() * env(t, 0.004, 0.03)),
        SR,
        () => 650,
      ),
      0.45,
    ),
  );
}

// --- the bed: wind that breathes, and three distant birds ---------------------------------------------
{
  const seconds = 7;
  const n = noise(7);
  const wind = lowpass(
    render(seconds, SR, () => n()),
    SR,
    (t) => 380 + 260 * (0.5 + 0.5 * sine(0.19, t)),
  );
  const bird = (t: number, at: number, base: number): number => {
    const u = t - at;
    if (u < 0 || u > 0.35) return 0;
    const warble = base + 500 * Math.sin(TAU * 9 * u) * u + 900 * u;
    return sine(warble, u) * Math.sin((Math.PI * u) / 0.35) ** 2;
  };
  const bed = render(
    seconds,
    SR,
    (t, i) =>
      (wind[i] as number) * 5 +
      0.05 * (bird(t, 1.2, 2300) + bird(t, 1.55, 2650) + bird(t, 4.6, 2100)),
  );
  write("ambience.wav", normalise(loop(bed, SR, 0.6), 0.5));
}

// --- the melody: a slow pentatonic walk over a low drone -----------------------------------------------------
{
  const rate = 11_025;
  const notes = [196, 293.66, 329.63, 392, 293.66, 246.94, 220, 293.66];
  const step = 1.6;
  const seconds = notes.length * step + 2.4;
  const song = render(seconds, rate, (t) => {
    let v = 0;
    notes.forEach((f, k) => {
      const u = t - k * step;
      if (u > 0) v += (sine(f, u) + 0.18 * sine(f * 2, u)) * env(u, 0.06, 1.2) * 0.5;
    });
    v += sine(98, t) * (0.16 + 0.05 * sine(0.25, t)) + sine(147, t) * 0.07;
    for (const at of [3.1, 8.3])
      if (t > at) v += sine(1568, t - at) * env(t - at, 0.01, 0.35) * 0.05;
    return v;
  });
  write("music.wav", normalise(loop(song, rate, 2.4), 0.5), rate);
}
