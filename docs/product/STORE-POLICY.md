# Store policy constraints

**Status:** external constraint, 2026-08-02. Not a proposal — this one shapes the
architecture whether or not we like it. Verify against current guidelines before any
submission; both stores revise them.

## The safe design

> **Each game becomes its own signed native binary, submitted through the creator's own
> Apple and Google developer accounts.**

## Why

**Apple.** The App Store Review Guidelines restrict apps from downloading and executing
code that changes app functionality, outside specific categories and conditions. Apple
also has rules for mini-app platforms and app-generation services, including expectations
about moderation, software indexing, and submission by the actual content provider.

**Google.** Play similarly scrutinizes dynamically downloaded executable code and
interpreted environments that can alter behaviour outside the reviewed package.

Sources are the App Store Review Guidelines and Android's dynamic-code-loading guidance.
Both are living documents; the summaries above are directional.

## What follows

| Do | Do not |
|---|---|
| Ship a ThreeNative **development preview app** that loads projects during development | Ship a production "ThreeNative Player" that downloads arbitrary games |
| Compile each production game's code and assets into its own release | Promise unrestricted over-the-air game-code changes after review |
| Submit under the customer's developer account | Submit customer games under ours |
| Automate submission with customer-authorized credentials | Take on mini-app-platform obligations by accident |

The universal-player option is not merely risky — it silently converts us into a platform
with moderation, indexing and provider-attribution duties. If we ever want it, that must
be a deliberate decision with the compliance work funded, not a side effect of a convenient
build architecture.

## This is also the better commercial answer

Creators own their app identity, ratings, revenue and customer relationship. That removes
the largest objection a serious developer has to any hosted game platform, and it aligns
with `CHARTER.md`'s stance elsewhere: no royalties, no revenue share, no lock-in, you own
the code.

## What it means for Cloud

Cloud's shipping product is therefore **build + sign + submit on the customer's behalf,
with their credentials** — closer to EAS than to a publishing platform. That is also the
cheaper thing to build, and it can orchestrate Expo/EAS rather than operating a build farm
(see [../strategy/ROADMAP.md](../strategy/ROADMAP.md) Phase 4).

Credential handling becomes a first-class security requirement the moment that ships:
Apple API keys and Play service accounts are the most sensitive material we would ever
hold, and holding them is not optional for the product to work.
