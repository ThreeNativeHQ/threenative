# Screenshot retention decision note

**Observed 2026-08-16.** The sweep tree contains 105 archive directories, 506 tracked PNG
files, and 105,741,539 bytes (100.84 MiB). No PNG is deleted by this change. The table covers
every archive; zero means that archive contains no PNG.

The citation scan ran before this note existed over `docs/verification/round-*.md` and
`docs/PRDs/done/**/*.md`, searching for each archive directory name. The **Cited by** column
records matching round-ledger filenames. Twenty-two archives are cited by round ledgers; no
done PRD cites an archive directory name.

| Archive | PNG files | Bytes | Cited by |
|---|---:|---:|---|
| `endless-runner-2026-08-05` | 2 | 33622 | — |
| `endless-runner-2026-08-08` | 2 | 185729 | — |
| `endless-runner-2026-08-08-2` | 2 | 172154 | — |
| `endless-runner-2026-08-08-3` | 2 | 171846 | — |
| `endless-runner-2026-08-08-4` | 2 | 165043 | — |
| `endless-runner-2026-08-08-5` | 2 | 76513 | — |
| `endless-runner-2026-08-08-6` | 4 | 528238 | — |
| `endless-runner-2026-08-08-7` | 4 | 525374 | — |
| `endless-runner-2026-08-08-8` | 2 | 216168 | — |
| `endless-runner-2026-08-08-9` | 4 | 640358 | — |
| `endless-runner-2026-08-08-10` | 0 | 0 | — |
| `endless-runner-2026-08-08-11` | 2 | 245333 | — |
| `endless-runner-2026-08-08-12` | 0 | 0 | — |
| `exploration-2026-08-05` | 2 | 53736 | — |
| `exploration-2026-08-07` | 2 | 236826 | PRD-043-terrain-and-open-world, PRD-063-unreached-export-deletion-sweep, round-2-2026-08-07 |
| `exploration-2026-08-07-2` | 2 | 224929 | — |
| `exploration-2026-08-07-3` | 2 | 180049 | PRD-043-terrain-and-open-world |
| `exploration-2026-08-07-4` | 2 | 576612 | — |
| `exploration-2026-08-07-5` | 4 | 1384774 | PRD-063-unreached-export-deletion-sweep, round-2-2026-08-07 |
| `exploration-2026-08-07-6` | 2 | 336403 | — |
| `exploration-2026-08-07-7` | 2 | 341083 | — |
| `exploration-2026-08-07-8` | 2 | 309039 | — |
| `exploration-2026-08-07-9` | 2 | 367634 | — |
| `exploration-2026-08-07-10` | 4 | 634246 | round-2-2026-08-07 |
| `exploration-2026-08-09` | 0 | 0 | — |
| `open-world-2026-08-09` | 4 | 64394 | PRD-063-unreached-export-deletion-sweep, round-3-2026-08-09 |
| `open-world-2026-08-09-2` | 4 | 35502 | — |
| `open-world-2026-08-09-3` | 3 | 53748 | PRD-063-unreached-export-deletion-sweep, round-3-2026-08-09 |
| `open-world-2026-08-09-4` | 0 | 0 | round-3-2026-08-09 |
| `physics-puzzle-2026-08-11` | 0 | 0 | PRD-107-plain-three-physics-evidence, round-4-2026-08-10 |
| `physics-puzzle-2026-08-11-2` | 0 | 0 | round-4-2026-08-10 |
| `physics-puzzle-2026-08-15` | 5 | 1728799 | PRD-107-plain-three-physics-evidence, PRD-114-paired-round-on-the-repaired-instrument, PRD-114-repair-diagnostics-side-effect-archive, PRD-121-delete-unreached-actuation-members, round-5-2026-08-14, round-6-2026-08-14, round-7-2026-08-15, round-8-2026-08-15, round-9-2026-08-15 |
| `physics-puzzle-2026-08-15-2` | 8 | 3164857 | PRD-121-delete-unreached-actuation-members, round-6-2026-08-14, round-7-2026-08-15 |
| `physics-puzzle-2026-08-15-3` | 6 | 218288 | PRD-114-repair-diagnostics-side-effect-archive, round-7-2026-08-15 |
| `physics-puzzle-2026-08-15-4` | 8 | 4407898 | PRD-114-repair-diagnostics-side-effect-archive, PRD-121-delete-unreached-actuation-members, round-7-2026-08-15 |
| `physics-puzzle-2026-08-15-5` | 7 | 1782188 | — |
| `physics-puzzle-2026-08-15-6` | 5 | 2892605 | round-8-2026-08-15 |
| `physics-puzzle-2026-08-15-7` | 7 | 1810795 | round-8-2026-08-15 |
| `physics-puzzle-2026-08-15-8` | 9 | 4102011 | round-8-2026-08-15 |
| `physics-puzzle-2026-08-15-9` | 11 | 4237791 | PRD-114-paired-round-on-the-repaired-instrument, PRD-121-delete-unreached-actuation-members, round-8-2026-08-15, round-9-2026-08-15 |
| `physics-puzzle-2026-08-15-10` | 5 | 2874352 | — |
| `physics-puzzle-2026-08-15-11` | 3 | 1675547 | — |
| `physics-puzzle-2026-08-16` | 7 | 1766010 | — |
| `platformer-2026-08-05` | 4 | 17016 | PRD-020-seeing-the-game, PRD-040-physics-collision-layers |
| `platformer-2026-08-05-2` | 8 | 272592 | PRD-020-seeing-the-game, PRD-040-physics-collision-layers |
| `platformer-2026-08-06` | 8 | 141218 | — |
| `platformer-2026-08-07` | 0 | 0 | PRD-023-framework-visual-parity, PRD-024-framework-authoring-cost, PRD-041-sweep-corpus-dry, round-1-2026-08-06, round-2-2026-08-07 |
| `platformer-2026-08-07-2` | 4 | 249651 | — |
| `platformer-2026-08-07-3` | 4 | 1128879 | PRD-041-sweep-corpus-dry |
| `platformer-2026-08-07-4` | 4 | 1143570 | — |
| `platformer-2026-08-07-5` | 4 | 1164036 | PRD-023-framework-visual-parity, PRD-024-framework-authoring-cost, round-1-2026-08-06, round-2-2026-08-07 |
| `platformer-2026-08-07-6` | 4 | 1174836 | — |
| `platformer-2026-08-07-7` | 8 | 2341838 | PRD-024-framework-authoring-cost |
| `platformer-2026-08-07-8` | 4 | 660307 | — |
| `platformer-2026-08-07-9` | 4 | 660043 | — |
| `platformer-2026-08-07-10` | 4 | 598012 | — |
| `platformer-2026-08-07-11` | 8 | 1265572 | PRD-024-framework-authoring-cost, round-1-2026-08-06 |
| `platformer-2026-08-07-12` | 4 | 203336 | — |
| `platformer-2026-08-07-13` | 4 | 203336 | — |
| `platformer-2026-08-07-14` | 4 | 203538 | — |
| `platformer-2026-08-07-15` | 4 | 203170 | — |
| `platformer-2026-08-07-16` | 0 | 0 | PRD-041-sweep-corpus-dry |
| `platformer-2026-08-07-17` | 4 | 317044 | — |
| `platformer-2026-08-07-18` | 4 | 604123 | — |
| `platformer-2026-08-07-19` | 8 | 1211554 | — |
| `platformer-2026-08-07-20` | 8 | 1225898 | — |
| `platformer-2026-08-07-21` | 8 | 1339950 | — |
| `platformer-2026-08-07-22` | 8 | 1337956 | — |
| `platformer-2026-08-07-23` | 8 | 1244502 | — |
| `platformer-2026-08-07-24` | 8 | 1170842 | — |
| `platformer-2026-08-07-25` | 8 | 1164712 | — |
| `platformer-2026-08-07-26` | 8 | 1242690 | — |
| `platformer-2026-08-07-27` | 4 | 690337 | — |
| `platformer-2026-08-07-28` | 8 | 1342964 | — |
| `platformer-2026-08-07-29` | 8 | 1263392 | — |
| `platformer-2026-08-07-30` | 4 | 627204 | — |
| `platformer-2026-08-07-31` | 4 | 624470 | — |
| `platformer-2026-08-07-32` | 8 | 1253950 | — |
| `platformer-2026-08-07-33` | 8 | 1331246 | — |
| `platformer-2026-08-07-34` | 8 | 1595700 | — |
| `platformer-2026-08-07-35` | 8 | 1628460 | — |
| `platformer-2026-08-07-36` | 8 | 1576614 | — |
| `platformer-2026-08-07-37` | 8 | 1582184 | — |
| `platformer-2026-08-07-38` | 8 | 1591424 | — |
| `platformer-2026-08-07-39` | 8 | 1476078 | — |
| `platformer-2026-08-07-40` | 8 | 1472910 | — |
| `platformer-2026-08-07-41` | 4 | 732778 | — |
| `platformer-2026-08-07-42` | 4 | 735664 | — |
| `platformer-2026-08-07-43` | 8 | 1474770 | — |
| `platformer-2026-08-07-44` | 8 | 1476462 | — |
| `platformer-2026-08-07-45` | 8 | 1476378 | — |
| `platformer-2026-08-07-46` | 8 | 1579642 | — |
| `platformer-2026-08-07-47` | 8 | 1583248 | — |
| `platformer-2026-08-07-48` | 8 | 1474082 | — |
| `platformer-2026-08-07-49` | 8 | 1483750 | — |
| `platformer-2026-08-07-50` | 8 | 1481298 | PRD-023-framework-visual-parity, PRD-024-framework-authoring-cost, round-1-2026-08-06, round-2-2026-08-07 |
| `platformer-2026-08-16` | 11 | 5891480 | round-9-2026-08-15 |
| `platformer-2026-08-16-2` | 9 | 4905712 | round-9-2026-08-15 |
| `topdown-action-2026-08-05` | 2 | 34110 | PRD-039-animation-state-machine, PRD-040-physics-collision-layers |
| `topdown-action-2026-08-05-2` | 0 | 0 | PRD-040-physics-collision-layers |
| `topdown-action-2026-08-05-3` | 2 | 661958 | — |
| `topdown-action-2026-08-07` | 0 | 0 | — |
| `topdown-action-2026-08-07-2` | 0 | 0 | — |
| `topdown-action-2026-08-07-3` | 4 | 360029 | — |
| `topdown-action-2026-08-07-4` | 4 | 1422530 | — |

## Options

1. **Keep all:** retain 506 PNGs / 105,741,539 bytes. This preserves every visual record but
   keeps the full 100.84 MiB in future checkouts.
2. **Keep ledger-cited archives:** retain 116 PNGs / 39,645,130 bytes across the 22 cited
   archives. This preserves named round evidence and removes 61.2 MiB of uncited captures,
   but requires the owner to accept that uncited visual history is no longer in the tree.
3. **Keep the newest run per genre:** retain the six newest archive directories
   (`endless-runner-2026-08-08-12`, `exploration-2026-08-09`,
   `open-world-2026-08-09-4`, `physics-puzzle-2026-08-16`,
   `platformer-2026-08-16-2`, `topdown-action-2026-08-07-4`): 20 PNGs / 8,094,252
   bytes. This is smallest, but it discards older cited evidence and leaves three newest
   genre archives with no captures.

**Recommendation:** Option 2, after owner approval. It preserves every archive named by a
round ledger while removing the largest uncited set. This note is a recommendation only:
the 506 PNGs remain tracked until the owner chooses.
