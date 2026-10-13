`ps2pk35.map` is Thomas Esser's public-domain Base35 mapping table, unchanged
from TeX Live 2025 final's `texlive-scripts` package. The upstream copyright
and purpose comments are preserved in the file.

Source: https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/2025/tlnet-final/archive/texlive-scripts.tar.xz

Archive SHA-512: `7b3365e054384d1acd91eb50d34c43dbd7d7ea7bcc98eee91ccc62c6ede11b32c1bdebfa34593eda672b13918059e895e3aa969948d988b578a1482e2712efbb`

TeX Live's `updmap` adds this table independently of individual packages'
`addMap` directives (default `LW35=URWkb`, with Base14 fonts embedded).
Texite previously collected only `addMap` tables, leaving names such as
`ptmb8r` unmapped even though the Times metrics and URW outlines were bundled.
The runtime manager now supplements the map with entries for installed
resources only, so removing a font module does not leave dangling mappings.
This works with existing modular runtimes without reinstalling fonts.

`8r.enc` is the unchanged TeX Base1 encoding vector from the same release's
`dvips` package. pdfTeX needs it too; the full dvips binary is not required.
The original file and author credits are preserved unchanged; distribution
follows the upstream TeX Live package licensing.

Source: https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/2025/tlnet-final/archive/dvips.tar.xz

Archive SHA-512: `cc938ebf2fbeca40d430bc43a6b66dce9f6410a63459b6c9debdf537b0765b25d8024293d0ebb19adaa6a282f5302e3796779ba16357115e588a1264a46edce9`
