# PR381 rendered Strata comparison

These are actual unedited 1920x1080 hardware-WebGPU captures, scale1 and AA4.
BEFORE is the retained earlier global-batch baseline, not a baseline rerun in this session.
AFTER is local source2f00a5b6753e8c23b6149bdd1792ea8cfd7b88bf.
The candidate FAILED the unchanged performance gates. No FPS win is claimed.

| Metric | Retained baseline | Candidate | Limit |
|---|---:|---:|---:|
| Full prop readiness |24.25s|29.71s|15s|
| Longest observed task |2802ms|458ms|250ms|
| Maximum measured view GPU median |2.61ms|14.4ms|12ms|

Host contention differs; overview lacks a qualifying candidate GPU sample.
The files are rendered scene images only, with no raw licensed assets, source changes or workflows.
This separate evidence branch does not change the PR source branch.
