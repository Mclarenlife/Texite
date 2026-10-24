# Android offline runtime

Android uses pdfTeX from TeX Live 2023 compiled by
[BusyTeX](https://github.com/busytex/busytex/tree/4499aa69fd3cf77ad86a47287d9a5193cf5ad993).
The original BusyTeX repository declares its integration scripts MIT;
linked engines, libraries and TeX resources retain their upstream licenses.
Asset SHA-256 checksums are recorded in `apps/mobile/runtime-lock.json`.
The upstream source and complete build scripts are at that pinned commit.

The compiler module contains other entry points, but Texite Android invokes
only pdfLaTeX and BibTeX. It does not switch engines automatically. This is
not the desktop TeX Live 2025 build; identical output across different TeX
Live years is not guaranteed.

CJK and Arphic fonts come from Texite's existing TeX Live inventory. Their
licenses are retained in `runtime/licenses` and included in Android assets.
The Chinese template uses CJKutf8 with Arphic gbsn. XeLaTeX/fontspec documents
are unsupported. The runtime never downloads packages; missing packages
produce diagnostics. Shell escape, external programs and Biber are unsupported.

Upstream sources include TeX Live 2023.0, Ubuntu Lunar TeX packages, Expat
2.5.0 and Fontconfig 2.13.96. Bundled `versions.txt` lists their locations.
