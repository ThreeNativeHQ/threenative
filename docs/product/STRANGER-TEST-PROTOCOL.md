# The five-minute stranger test — the protocol

**This file is the single definition.** Every other document links here and states no second
version. PRD-080 Phase 0, decided 2026-08-15.

> **The test:** one stranger plays one ThreeNative game, on their own device, at a URL, with no
> clone and no install. The result is how long they play before they stop of their own accord,
> and a transcript of what they said while doing it.

Nothing else is the five-minute stranger test. If a document describes a different experiment, it
is describing a different experiment and must name it as one.

## Why this one, and what the other one is

Four tracked documents called this the project's decisive test and two of them described
**different experiments with different subjects**. `METRICS.md` asks for a *player*; the
`ROADMAP.md` Tier 2 trigger asks for *the first external user who installs the framework and asks
for a device build* — a *developer who adopts*. A player finishing five minutes tells you nothing
about whether anyone would build with it. A developer asking for a device build tells you nothing
about whether the result is fun.

The player test wins the name for one reason: **`METRICS.md` is the document that defines the
criterion and warns what happens if it stays unrun**, and it says *played*. It is also the cheaper
of the two, needs no registry, and its subject has existed since the first template rendered.

The developer test is real and is not abandoned. It is **the successor experiment**, and it needs
its own PRD, its own protocol and its own trigger wording — not a second reading of this one.
Until that PRD exists, the Tier 2 trigger's developer clause is an open question with an owner,
rather than a contradiction hiding inside a criterion everybody cites.

**This test does not depend on the npm publish.** A stranger opens a URL; nothing installs. The
adopting-developer successor is the one that needs a registry that does not 404.

## What is fixed, in writing, before anyone is invited

### Subject

One deployed build of one ThreeNative game, at a public URL, chosen and named here before the
session — never chosen after seeing who turned up. It runs on the stranger's own device: a
laptop or a phone they already own, on a browser they already use.

The device class is recorded, not constrained. A browser that cannot run WebGPU is a result about
reach, not a session to redo on better hardware — the build must say so on screen rather than
showing a blank canvas, and that outcome is published like any other.

### Stranger

Someone who:

- has not seen this project,
- is not a member of the household or the immediate professional circle,
- and **did not know what they would be shown before arriving.**

The relationship to the operator is disclosed in the record either way. "A friend" is a valid
result with a caveat attached; a friend recorded as a stranger is not a result at all.

### Five minutes

Measured **from the first rendered frame to the moment they stop of their own accord**, by
stopwatch, recorded to the second.

**Not** to the moment they are asked to stop. The number this test produces is how long someone
chose to keep playing. Stopping the clock at five minutes because five minutes elapsed would
convert the measurement into its own name.

If they are still playing at five minutes, the clock keeps running and the longer number is the
result.

### The operator's script

Verbatim, and nothing else is said:

> "This is a game. Here's the link. Play it for as long as you like, and say out loud whatever
> you're thinking — including if it's boring or confusing. I'm going to be quiet. When you're
> done, just stop."

When asked for help: **nothing.** Not a hint, not a correction, not a "try clicking there." The
operator may say *"I can't help with that — do whatever seems right to you"* and no more. A
session in which the operator explained the controls has measured the operator.

If the build fails to load or crashes, the session ends there and that is the result. It is
published.

### What is recorded

- the screen,
- the audio,
- a written transcript of what they said,
- the stopwatch reading, to the second,
- the device, browser and whether WebGPU was available,
- the relationship between the operator and the person.

### Consent

Obtained **before** recording starts, and the person is told: what is recorded, that it will be
published in this repository as a transcript, whether their name appears (default: it does not),
and that they may stop the recording at any time and have it deleted.

A session without recorded consent is not published, and is not counted as a run.

## The result is published whatever it says

The first session **is** the result. Running it repeatedly until someone lasts five minutes
converts an experiment into an audition. A second session is a second data point published beside
the first, never a replacement for it.

A stranger who quits at forty seconds is a finding — the most valuable one this project could get
right now — and it goes in `docs/verification/` with the transcript attached, exactly like a
green one.

## The negative control for this file

`grep -rn "five minutes\|five-minute" docs/ | grep -v STRANGER-TEST-PROTOCOL` must return links
and characterisations, and **no second definition**. A document that re-states what the test is,
rather than pointing here, has recreated the failure this file exists to end.

`METRICS.md` records why that matters: v1 spent seven weeks unable to say whether it was working,
because its decisive experiment was specified three times and never run. This one has now been
specified four times. It has still never been run.
