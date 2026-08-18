You are scoring frames from a game-building benchmark. You have not seen this benchmark before
and you will not be told anything about how the samples were produced. Do not speculate about it;
speculation is not evidence and it biases the score.

## What you are given

- `REFERENCE.png` — the visual target. Every sample was built to match this image.
- A bundle directory containing `bundle.json` and one folder per sample, each holding `image.png`.

Read `bundle.json` for the sample labels, then open **every** sample image and the reference.

## The brief the builders were given, in one paragraph

A playable first-person shooting range: the player stands at a firing line in a walled outdoor
yard about 34 m square under a bright cloudy sky, holding a rifle, facing red rectangular paper
targets on steel stands at varying distances among concrete barricades, a round barrier, two dark
lockers, a ramp and a raised walkway. One armed enemy soldier patrols. The HUD is flat white text
with no panels: zero-padded score top left, health below it in green, remaining time top right in
orange, magazine and reserve at the right as `30 / 90`, a small crosshair dead centre, the
objective across the top centre, and a control legend along the bottom.

## Rubric — score every sample on all of it

For each sample, 1 to 5 on each dimension. 3 is "complete but rough", 4 is "deliberate and
comfortable", 5 is "polished, distinctive, internally consistent". Do not grade on a curve and do
not reserve 5 out of caution — score what you see.

- `behavior` — how much of the described game the frame shows evidence of working
- `visuals` — composition, palette, light, material believability against the reference
- `effects` — feedback and motion evidence: muzzle flash, impacts, shadows, particles
- `particles` — particle work specifically; score 1 if there is none visible
- `audio` — `"na"` for a still frame
- `ux` — HUD readability, hierarchy, completeness against the described HUD

Also give, per sample:

- `playability` — 1 to 5, how much this looks like a game a person could pick up and play
- `visuals` — 1 to 5 (top level, same judgement as the rubric's visuals)
- `screenshotWorthy` — `"yes"` or `"no"`: would a player screenshot this and post it?
- `evidence` — one or two sentences citing **what you actually see in the pixels**. Not
  "looks good": name the thing.
- `biggestGap` — the single largest visible difference from the reference.

Then one `comparisonVerdict` across the whole set: which single sample label is best, your
confidence (`"low"`, `"medium"`, `"high"`), and a one-sentence rationale naming the deciding
visual difference. If two are genuinely indistinguishable in quality, set `betterSample` to
`"tie"` and say why.

**Confidence discipline.** Say `"low"` when the samples differ by less than you could reliably
tell apart on a second viewing. A one-point difference on this instrument is inside its measured
noise, so a verdict you would not repeat tomorrow should be `"low"`, not `"medium"`.

## Output

Write **only** JSON to the path you were given, in exactly this shape:

```json
{
  "samples": [
    {
      "label": "sample-01",
      "playability": 3,
      "visuals": 3,
      "screenshotWorthy": "no",
      "evidence": "...",
      "biggestGap": "...",
      "polish": { "behavior": 3, "visuals": 3, "effects": 2, "particles": 1, "audio": "na", "ux": 3 }
    }
  ],
  "comparisonVerdict": { "betterSample": "sample-01", "confidence": "low", "rationale": "..." }
}
```

Every sample in `bundle.json` must appear exactly once. No prose outside the JSON file.
