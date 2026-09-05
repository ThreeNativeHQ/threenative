# Third-party notices

The private KTX2 adapter in this package derives from `ktx2-encoder` 0.6.0, copyright 2020
Hu Song, under the MIT License. Its bundled `basis_encoder.js` and `basis_encoder.wasm` derive
from Basis Universal, copyright 2016–2026 Binomial LLC, under Apache License 2.0.

The Basis build is intentionally modified from upstream commit
`1b33fd5098c6e7b58324146b8f5518cbb4cdfb72`: the wasm32 ceiling for the lower-memory ETC1S and
UASTC LDR 4x4 compressors is raised from 12 to 16 Mi texels. The conservative HDR ceiling is
unchanged. The modified source patch and reproducible build are in `scripts/`.

Build provenance:

- Emscripten 4.0.15 container digest:
  `sha256:27bc6267cb285223b8aebb7627bfebae7cb3ad2aaa0d5923b8aa5321793033e8`
- Configuration: wasm32, non-threaded Release, `KTX2_ZSTANDARD=ON`, `SUPPORT_ASTCENC=OFF`,
  `-s EXPORT_ES6=1`
- `basis_encoder.js` SHA-256:
  `059621ec63379c496ac93814f53afc6c7065ecdf6291b2ac8db951cb7bac4c64`
- `basis_encoder.wasm` SHA-256:
  `f020c8ed7d2ccadf752c0e64b86195f09e0bfeacc2de3d94b28c89ea72ce5bd5`

The complete MIT and Apache-2.0 license texts remain available from the upstream projects:
https://github.com/gz65555/ktx2-encoder and https://github.com/BinomialLLC/basis_universal.
The Apache-2.0 text is also shipped in `LICENSES/Basis-Universal-Apache-2.0.txt`.
Basis Universal's NOTICE attribution is:

> Basis Universal™ Supercompressed GPU Texture Compression Library. Copyright © 2016–2026
> Binomial LLC. All rights reserved except as granted under the Apache 2.0 license. Basis
> Universal is a trademark of Binomial LLC.

The MIT terms for the derived `ktx2-encoder` portions are:

> Copyright (c) 2020 HU SONG
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software
> and associated documentation files (the "Software"), to deal in the Software without
> restriction, including without limitation the rights to use, copy, modify, merge, publish,
> distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
> Software is furnished to do so, subject to the following conditions: the above copyright notice
> and this permission notice shall be included in all copies or substantial portions of the
> Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
> BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
