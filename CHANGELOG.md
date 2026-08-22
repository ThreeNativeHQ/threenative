# Changelog

All notable changes to this project are documented in this file.

The history before 0.2.0 was not reconstructed from git.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `create-threenative` ships an `optimizeModels()` Vite plugin, and every template
  wires it into `vite.config.ts`. At build time it regenerates each `public/assets/*.glb`
  from its source in `assets/models/` via gltf-transform whenever the source is newer
  (quantization + WebP + separate vertex layout; measured ~75–88 % smaller with mesh,
  bone and clip names preserved). Disable per project with
  `optimizeModels({ disabled: true })` or per invocation with `TN_NO_OPTIMIZE_MODELS=1`.
  Projects without an `assets/models/` directory are unaffected. Requires the template's
  new `@gltf-transform/cli` dev dependency only when a model is actually stale.
- `create-threenative` bumped to 0.2.3 for the above; templates pin 0.2.3.

## [0.2.0] - 2026-08-16

### Changed

- Moved every publishable package and every template pin to the 0.2.0 release line.

[unreleased]: https://github.com/jonit-dev/threenative/compare/main...HEAD
[0.2.0]: https://github.com/jonit-dev/threenative/releases/tag/0.2.0
