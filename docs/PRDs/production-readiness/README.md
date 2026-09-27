# Production readiness

**Release-critical PRDs live in [`critical/`](critical/).** Start with
[`RELEASE-READINESS-2026-09-23.md`](RELEASE-READINESS-2026-09-23.md): the verdict,
the owner's decisions, and every release-blocking PRD ranked by rung.

Owner decisions (2026-09-23):

- **Supported targets: web, Windows, macOS, Linux and Android. iOS is not supported.**
- The public announcement happens at the **public beta (R2)**; the 0.3.3 cohort ships quietly first.
- **Only the PRDs in `critical/` block a release.** Everything else in `docs/PRDs/` is post-launch.
- Each developer signs their own game; ThreeNative ships no certificate.

`critical/` holds release-blocking PRDs whatever their status, including blocked ones; a blocked
PRD there keeps its reason in its status line. A finished one moves to `docs/PRDs/done/` as usual.

The batch plan this folder used to carry (2026-09-08) and the one-day execution strategy of
2026-09-11 are superseded; both remain in git history.
