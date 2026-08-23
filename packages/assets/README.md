# @threenative/assets

The asset compile step for ThreeNative games. Walks a game's `assets/` source
directory, applies ordered passes over each input, and writes content-addressed
outputs into `public/` alongside an `assets.manifest.json` describing every
managed file.

Node-only. Carries the encoder dependencies the runtime must never inherit.
