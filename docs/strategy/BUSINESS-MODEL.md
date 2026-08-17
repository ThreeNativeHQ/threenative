# Business model

**Status:** hypotheses, 2026-08-02. No price here has been tested. This document is
downstream of the benchmark resolving.

## Open core, paid production services

| Never charged for | Charged for |
|---|---|
| Engine royalties | Cloud build minutes, Mac capacity |
| Revenue share on games | Physical-device test minutes |
| Exporting source code | Store submission automation |
| Local builds | Asset optimization jobs |
| — | Studio, local and hosted |
| — | Hosted preview bandwidth |
| — | Integrated AI credits (BYO key always free) |

**Studio moved columns on 2026-08-16, by owner decision.** It sat under *Never charged
for* until then. The engine stays MIT and free — every package, template, example and
script in this repository — and Studio is the paid surface. Its source left this
repository for a private one and no licence is granted to it. PRD-129 records the
decision and carried it out.

A new engine's largest adoption cost is licensing anxiety. Adding a Unity-shaped
royalty question to an unproven framework is how it never gets tried.

## Pricing hypotheses

Starting points to test with design partners, not decisions.

| Plan | Hypothesis | Included |
|---|---:|---|
| Free | $0 | Runtime, CLI, local web/iOS/Android builds, BYO AI key, community templates |
| Creator | $19–24/mo | AI credits, private cloud sync, hosted previews, limited cloud builds, asset optimization credits |
| Pro | $49–59/mo | More build and device minutes, TestFlight/Play automation, crash and performance analytics |
| Team | $39–49/user/mo + usage | Collaboration, permissions, shared assets, review environments, audit history |
| Enterprise | Custom | Private infra, SSO, SLAs, custom native modules, compliance, support |

Anchors from the 2026-08-02 strategy input (**vendor-stated, unverified here**):
PlayCanvas ≈ $15/mo individual and ≈ $50/seat organization; Expo Starter ≈ $19/mo with
build credits; GDevelop meters AI through credits rather than presenting unlimited
inference as free.

## Revenue streams, in order of defensibility

1. **Build, device-test and release usage.** Solves an operational problem instead of
   reselling commodity tokens. Charged by consumption, so it scales with customer
   success rather than seat count.
2. **Pro subscription.** Profiler, automated scenarios, regression screenshots, crash
   analytics, build history, release channels, device profiles — the tools that help
   someone *finish* games repeatedly.
3. **AI credits.** Monthly inclusion plus usage overage, provider choice, model routing,
   caching, cheap models for inspection and expensive ones for large changes. **Never
   unlimited inference at a flat price.** The agent runtime and semantic tools are the
   product; the model underneath is swappable.
4. **Ship Pack, $299–799 one-time.** Native project config, icons and splash screens,
   store screenshots, TestFlight and Play internal testing, privacy manifest, release
   checklist, first successful submission. Manual on purpose: it funds early work and
   maps every friction point in the shipping path before that path is automated.
5. **Curated marketplace, 15–20% fee.** Templates, character controllers, combat systems,
   AI behaviours, multiplayer modules, mobile-optimized assets, shader packs, UI kits.
   **Curated** is the load-bearing word: every listing tested against supported engine
   versions, mobile performance budgets, licensing metadata, automated scenarios, and all
   three platforms. An uncurated marketplace is a support liability, and the v1 framework
rules it out entirely.
6. **Enterprise and agencies.** Branded games, training simulations, product
   configurators needing native packaging, educational games, internal visualization.
   They buy private registries, reusable templates, white-label deployment, custom native
   modules, support.
7. **Multiplayer and live ops.** Auth, leaderboards, cloud saves, matchmaking, realtime
   rooms, remote config, experiments, push, economy. **Do not start here** — it is an
   infrastructure company on its own.

## What early revenue actually needs to look like

- 100 Pro at $59 = $5,900 MRR
- 250 Creator at $24 = $6,000 MRR
- 40 Team seats at $49 + build usage = meaningful
- A few Ship Packs a month funds product work and surfaces release bugs

The arithmetic is not the risk. Distribution and retention are.

## Validation plan

Recruit 12–20 design partners across TypeScript developers, Three.js freelancers,
AI-first creators and small studios. Each gets one small game onto a real phone. Then
test willingness to pay for Creator, Pro, and a managed Ship Pack — in that order,
separately, with real invoices.

**Precondition:** none of this is worth doing before a stranger has played a ThreeNative game
for five minutes. Selling
a shipping pipeline that has never shipped is how a framework earns its first refund.
