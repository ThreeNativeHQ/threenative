---
name: score-build-experience
description: Score a finished build run 0–100 across six weighted axes, then score the vanilla Three.js counterfactual the same way. Use after a build-on-sandbox run, an adopter pilot, or any session where someone built a game with the framework and asks how good the experience was. Never use it on a build that was not executed.
---

# Scoring a build experience

You just built something. This turns that into two numbers that survive being read back in
three months: what the framework experience was worth, and what it would have been worth
without the framework.

**The score is worthless without the run.** No estimating from a code read, no scoring a build
someone else did and described to you, no scoring a plan. If nothing was executed, say so and
stop — an invented number outlives the caveat attached to it.

## The one rule that makes the number honest

**Every axis score cites one observed fact**: a command and its exit code, an error code, a
count, a measured LOC, a timestamp. An axis you cannot attach a fact to is **unscored** — write
`—` and reduce the denominator. A score with six citations is evidence; a score with six
opinions is a vibe with a decimal point.

## The axes

| # | Axis | Weight | What it measures |
|---|---|---|---|
| 1 | Setup → first rendered frame | 15 | Everything between "I want to build this" and a pixel on screen |
| 2 | Authoring the look | 20 | Getting the thing to resemble what you were aiming at |
| 3 | Gameplay plumbing | 20 | Loop, input, state, restart, entities — the parts every game repeats |
| 4 | Proving it works | 25 | Whether you finished holding evidence or holding a feeling |
| 5 | Iteration speed | 10 | The edit → observe → fix cycle, including how much it lies to you |
| 6 | Cognitive load | 10 | What you had to read, learn, and delete before you could work |

Weights are fixed. Do not retune them per run — a rubric you adjust after seeing the result is
a rubric that always agrees with you. If a run genuinely has no work on an axis (no visual
target, say), mark it unscored rather than reweighting.

### Anchors

Score each axis against its full weight. These are the calibration points:

**1. Setup → first frame.** Full: one command, no hand-edits, frame on screen. Half: one known
workaround, documented, under ten minutes. Zero: it did not install, or you edited a manifest by
hand to get past a dependency that does not resolve.

**2. Authoring the look.** Full: the target look was reachable with ordinary domain code and
nothing fought you. Half: you worked around a framework opinion about rendering. Zero: the
framework owns the look and you cannot get out of its house style.

**3. Gameplay plumbing.** Full: loop, input, state and restart were there, correct, and cheaper
than writing them. Half: they were there but you paid a tax to use them — dead dependencies you
could not remove, generics to thread, an abstraction you routed around. Zero: you hand-rolled
what the framework claimed to own. **Score restart honestly**: a hand-written reset that quietly
misses the scheduler is the classic silent bug, and "I would have written it myself" should be
scored as the bug it usually becomes, not the fifteen lines it looks like.

**4. Proving it works.** Full: behaviour is asserted by a harness that fails closed, you ran it,
and it caught at least one thing you got wrong. Half: assertions exist but only you ran them,
once. Zero: you finished on screenshots and confidence. **This is the heaviest axis on purpose.**
It is the one where "I could write that myself in 20 lines" is false, and it is the one people
skip when nobody is watching.

**5. Iteration speed.** Full: edit → observe took seconds and what you observed was true. Half:
fast but misleading — a throttled tab, a stale bundle, a screenshot that lies. Zero: you could
not see your change without a rebuild you had to babysit.

**6. Cognitive load.** Full: what you needed was where you looked. Half: real docs, with a
contract you only found by reading a failure. Zero: you read more than you wrote, or deleted
more scaffold than you kept.

## The counterfactual

Score the same six axes for the same game built in plain Three.js. Rules:

- **Label it an estimate, every time it appears.** It was not run. n=1. It is a judgement about
  work you know how to do, not a measurement of work you did.
- **Assume competence, not heroics.** The vanilla arm writes the loop, the input map and the
  restart — those are cheap and known. It does **not** build a browser-driving assertion harness
  in an afternoon, and pretending it does is how the framework's real margin gets scored away.
- **Assume what actually happens.** If the honest answer is "in vanilla I would have shipped this
  with no automated proof", score axis 4 as the zero it is. Do not score the vanilla arm as the
  disciplined engineer nobody is at 1am.
- **The look is usually a tie.** If the framework's rule is that games own their rendering, then
  axis 2 is the same code on both sides and should score the same. Say so rather than inventing a
  gap.

## The swing test — run it every time

Recompute both totals **with axis 4 removed**. Report both pairs.

If the framework only wins with the proof axis included, that is the headline finding, not a
footnote: everything else it gave you was replaceable, and the harness is the product. If it
wins without axis 4 too, name which axis carried it. This single check has more information in
it than the totals do.

## Output

Lead with the two numbers. Then the table, one row per axis, both columns, with the citation in
the "why" cell. Then the swing test. Then at most two caveats about what the run did **not**
exercise — assets, save/load, hot reload, a native target, scale beyond a few hundred lines —
because a small game is the worst case for a framework and the score means less than it looks.

```
**Framework: NN/100. Vanilla (estimate): NN/100.**

| Axis (weight) | Framework | Vanilla (est.) | Why |
|---|---|---|---|
| Setup → first frame (15) | N | N | one fact |
...
| **Total** | **NN** | **NN** | |

Swing test: without axis 4, framework NN, vanilla NN.
```

Keep the whole thing under a screen. The value is in the citations and the swing test, not in
paragraphs about them.

## What not to do

- Do not score a run you did not execute, and do not score someone's description of one.
- Do not adjust the weights, invent axes, or drop the swing test because the answer is awkward.
- Do not average the two totals into a verdict. They are two readings, and the reader owns the
  decision.
- Do not carry a score forward to a later run. Re-score, or say the old number is stale.
